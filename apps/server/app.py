import os
import secrets
import hashlib
import datetime
import logging
import json
import calendar
from datetime import date, timedelta
from functools import wraps

import jwt
from flask import Flask, request, jsonify, send_from_directory, session, g, Blueprint
from flask_cors import CORS
from flask_migrate import Migrate
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_talisman import Talisman
from sqlalchemy import func, extract, desc

from models import db, User, Database, Bill, Payment, RefreshToken, Subscription, UserInvite, UserDevice
from migration import migrate_sqlite_to_pg
from db_migrations import run_pending_migrations
from services.email import send_verification_email, send_password_reset_email, send_welcome_email, send_invite_email
from services.stripe_service import (
    create_checkout_session, create_portal_session, construct_webhook_event,
    get_subscription, cancel_subscription, update_subscription, STRIPE_PUBLISHABLE_KEY
)
from config import (
    DEPLOYMENT_MODE, ENABLE_REGISTRATION, REQUIRE_EMAIL_VERIFICATION,
    ENABLE_BILLING, is_saas, is_self_hosted, get_public_config
)
from validation import (
    validate_email, validate_username, validate_password, validate_amount,
    validate_date, validate_frequency, validate_bill_name, validate_database_name
)

# --- JWT Configuration ---
# In production, JWT_SECRET_KEY must be explicitly set
_jwt_secret = os.environ.get('JWT_SECRET_KEY') or os.environ.get('FLASK_SECRET_KEY')
if not _jwt_secret:
    if os.environ.get('FLASK_ENV') == 'production' or os.environ.get('ENVIRONMENT') == 'production':
        raise RuntimeError("JWT_SECRET_KEY or FLASK_SECRET_KEY must be set in production")
    # Development only - generate ephemeral key with warning
    _jwt_secret = secrets.token_hex(32)
    logger.warning("No JWT_SECRET_KEY set - using ephemeral key. Tokens will be invalid after restart.")
JWT_SECRET_KEY = _jwt_secret
JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=15)
JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=7)

# --- Global Logging ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Blueprints ---
api_bp = Blueprint('api', __name__)
api_v2_bp = Blueprint('api_v2', __name__, url_prefix='/api/v2')
spa_bp = Blueprint('spa', __name__)

# --- Rate Limiter (initialized in create_app) ---
# No default limits - only apply rate limiting to sensitive endpoints (auth)
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri="memory://",
)

# --- CSRF Protection ---

def check_csrf():
    """
    Check Origin/Referer header for CSRF protection on state-changing requests.
    Used in combination with SameSite=Lax cookies.
    """
    if request.method in ('GET', 'HEAD', 'OPTIONS'):
        return True  # Safe methods don't need CSRF check

    # Build allowed origins dynamically based on request host and env
    app_url = os.environ.get('APP_URL', '')
    host = request.headers.get('Host', '')

    allowed_origins = {
        'http://localhost:5173',  # Vite dev server
        'http://localhost:5001',  # Flask dev server
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5001',
    }

    # Add APP_URL if set
    if app_url:
        allowed_origins.add(app_url)

    # Dynamically allow the request's own host (same-origin)
    if host:
        allowed_origins.add(f"https://{host}")
        allowed_origins.add(f"http://{host}")

    origin = request.headers.get('Origin')
    referer = request.headers.get('Referer')

    # Check Origin header first (most reliable)
    if origin:
        return origin in allowed_origins

    # Fall back to Referer header
    if referer:
        from urllib.parse import urlparse
        referer_origin = f"{urlparse(referer).scheme}://{urlparse(referer).netloc}"
        return referer_origin in allowed_origins

    # If neither header present, allow it (same-origin requests don't always send Origin)
    # Combined with SameSite=Lax cookies, this provides good CSRF protection
    # Cross-origin requests from browsers always send Origin header
    return True

# --- Decorators ---

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session: return jsonify({'error': 'Authentication required'}), 401
        if not check_csrf(): return jsonify({'error': 'CSRF validation failed'}), 403
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'role' not in session or session['role'] != 'admin': return jsonify({'error': 'Admin access required'}), 403
        if not check_csrf(): return jsonify({'error': 'CSRF validation failed'}), 403
        return f(*args, **kwargs)
    return decorated_function

# --- JWT Helper Functions ---

def create_access_token(user_id, role):
    """Create a short-lived access token."""
    payload = {
        'user_id': user_id,
        'role': role,
        'type': 'access',
        'exp': datetime.datetime.now(datetime.timezone.utc) + JWT_ACCESS_TOKEN_EXPIRES,
        'iat': datetime.datetime.now(datetime.timezone.utc)
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm='HS256')

def create_refresh_token(user_id, device_info=None):
    """Create a long-lived refresh token and store hash in database."""
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires_at = datetime.datetime.now(datetime.timezone.utc) + JWT_REFRESH_TOKEN_EXPIRES

    refresh = RefreshToken(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at,
        device_info=device_info
    )
    db.session.add(refresh)
    db.session.commit()

    return token

def verify_access_token(token):
    """Verify and decode an access token."""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=['HS256'])
        if payload.get('type') != 'access':
            return None
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def verify_refresh_token(token):
    """Verify a refresh token against stored hash."""
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    refresh = RefreshToken.query.filter_by(token_hash=token_hash, revoked=False).first()
    if not refresh:
        return None
    # Handle comparison between naive (from DB) and aware datetimes
    expires_at = refresh.expires_at.replace(tzinfo=datetime.timezone.utc) if refresh.expires_at.tzinfo is None else refresh.expires_at
    if expires_at < datetime.datetime.now(datetime.timezone.utc):
        refresh.revoked = True
        db.session.commit()
        return None
    return refresh

def jwt_required(f):
    """Decorator for JWT-protected endpoints. Sets g.jwt_user_id and g.jwt_role."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'success': False, 'error': 'Missing or invalid Authorization header'}), 401

        token = auth_header.split(' ')[1]
        payload = verify_access_token(token)
        if not payload:
            return jsonify({'success': False, 'error': 'Invalid or expired token'}), 401

        g.jwt_user_id = payload['user_id']
        g.jwt_role = payload['role']

        # Get database from X-Database header for mobile clients
        db_name = request.headers.get('X-Database')
        if db_name:
            user = db.session.get(User,g.jwt_user_id)
            target_db = Database.query.filter_by(name=db_name).first()
            if target_db and target_db in user.accessible_databases:
                g.jwt_db_name = db_name
            else:
                return jsonify({'success': False, 'error': 'Access denied to database'}), 403
        else:
            g.jwt_db_name = None

        return f(*args, **kwargs)
    return decorated_function

def jwt_admin_required(f):
    """Decorator for JWT-protected admin-only endpoints."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'success': False, 'error': 'Missing or invalid Authorization header'}), 401

        token = auth_header.split(' ')[1]
        payload = verify_access_token(token)
        if not payload:
            return jsonify({'success': False, 'error': 'Invalid or expired token'}), 401

        if payload['role'] != 'admin':
            return jsonify({'success': False, 'error': 'Admin access required'}), 403

        g.jwt_user_id = payload['user_id']
        g.jwt_role = payload['role']
        return f(*args, **kwargs)
    return decorated_function

def auth_required(f):
    """Decorator that accepts both session auth (web) and JWT auth (mobile).
    Sets g.auth_user_id regardless of auth method used."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Try JWT auth first (check Authorization header)
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
            payload = verify_access_token(token)
            if payload:
                g.auth_user_id = payload['user_id']
                g.auth_role = payload['role']
                g.auth_method = 'jwt'
                return f(*args, **kwargs)
            return jsonify({'success': False, 'error': 'Invalid or expired token'}), 401

        # Fall back to session auth
        if 'user_id' in session:
            if not check_csrf():
                return jsonify({'success': False, 'error': 'CSRF validation failed'}), 403
            g.auth_user_id = session['user_id']
            g.auth_role = session.get('role', 'user')
            g.auth_method = 'session'
            return f(*args, **kwargs)

        return jsonify({'success': False, 'error': 'Authentication required'}), 401
    return decorated_function

# --- Subscription & Tier Helpers ---

def get_user_effective_tier(user):
    """
    Get the effective tier for a user based on their subscription status.
    Returns 'free', 'basic', or 'plus'.
    """
    from config import is_saas

    # Self-hosted mode: everyone gets unlimited (plus tier)
    if not is_saas():
        return 'plus'

    if not user.subscription:
        return 'free'

    return user.subscription.effective_tier


def check_tier_limit(user, feature: str) -> tuple[bool, dict]:
    """
    Check if user is within their tier limit for a feature.

    Returns:
        tuple: (allowed: bool, info: dict with limit details)
    """
    from config import is_saas, get_tier_limits

    # Self-hosted mode: no limits
    if not is_saas():
        return True, {'limit': -1, 'used': 0, 'unlimited': True}

    tier = get_user_effective_tier(user)
    limits = get_tier_limits(tier)
    limit = limits.get(feature)

    # Boolean features (export, full_analytics)
    if isinstance(limit, bool):
        return limit, {'allowed': limit, 'tier': tier}

    # Numeric limits (-1 = unlimited)
    if limit == -1:
        return True, {'limit': -1, 'used': 0, 'unlimited': True, 'tier': tier}

    # Count current usage
    if feature == 'bills':
        # Count active (non-archived) bills across user's databases
        from models import Bill
        if is_saas():
            # In SaaS mode, count bills in databases owned by this user
            used = Bill.query.join(Database).filter(
                Database.owner_id == user.id,
                Bill.archived == False
            ).count()
        else:
            # In self-hosted mode, count bills in accessible databases
            used = Bill.query.join(Database).filter(
                Database.id.in_([db.id for db in user.accessible_databases]),
                Bill.archived == False
            ).count()
    elif feature == 'bill_groups':
        # In SaaS mode, count databases owned by this user
        # In self-hosted mode, count databases accessible to this user
        if is_saas():
            used = Database.query.filter_by(owner_id=user.id).count()
        else:
            used = len(user.accessible_databases)
    elif feature == 'users':
        # Count users who have access to databases owned by this user
        # This includes the owner themselves plus any invited users
        if is_saas():
            # Get all databases owned by this user
            owned_dbs = Database.query.filter_by(owner_id=user.id).all()
            if owned_dbs:
                # Get unique user IDs that have access to these databases
                user_ids = set()
                for owned_db in owned_dbs:
                    for u in owned_db.users:
                        user_ids.add(u.id)
                used = len(user_ids)
            else:
                used = 1  # Just the owner

            # Also count pending invitations for databases owned by this user
            pending_invites = UserInvite.query.filter_by(invited_by_id=user.id).filter(
                UserInvite.accepted_at == None,
                UserInvite.expires_at > datetime.datetime.now(datetime.timezone.utc)
            ).count()
            used += pending_invites
        else:
            used = User.query.count()
    else:
        used = 0

    allowed = used < limit
    return allowed, {
        'limit': limit,
        'used': used,
        'remaining': max(0, limit - used),
        'tier': tier
    }


def subscription_required(feature: str = None, min_tier: str = None):
    """
    Decorator to require active subscription and optionally check feature limits.

    Args:
        feature: Feature to check limit for (e.g., 'bills', 'export')
        min_tier: Minimum tier required ('basic' or 'plus')
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            from config import is_saas

            # Skip checks in self-hosted mode
            if not is_saas():
                return f(*args, **kwargs)

            user = db.session.get(User,g.jwt_user_id)
            if not user:
                return jsonify({'success': False, 'error': 'User not found'}), 404

            tier = get_user_effective_tier(user)

            # Check minimum tier if specified
            if min_tier:
                tier_order = {'free': 0, 'basic': 1, 'plus': 2}
                if tier_order.get(tier, 0) < tier_order.get(min_tier, 0):
                    return jsonify({
                        'success': False,
                        'error': f'This feature requires {min_tier.title()} tier or higher',
                        'upgrade_required': True,
                        'required_tier': min_tier,
                        'current_tier': tier
                    }), 403

            # Check feature limit if specified
            if feature:
                allowed, info = check_tier_limit(user, feature)
                if not allowed:
                    return jsonify({
                        'success': False,
                        'error': f'You have reached your {feature} limit. Upgrade for more.',
                        'upgrade_required': True,
                        'limit_info': info
                    }), 403

            return f(*args, **kwargs)
        return decorated_function
    return decorator


# --- Logic Helpers ---

def calculate_next_due_date(current_due, frequency, frequency_type='simple', frequency_config=None):
    if frequency_config is None: frequency_config = {}
    if isinstance(current_due, str): current_date = datetime.date.fromisoformat(current_due)
    else: current_date = current_due
    
    if frequency == 'weekly': return current_date + timedelta(days=7)
    elif frequency in ('bi-weekly', 'biweekly'): return current_date + timedelta(days=14)
    elif frequency == 'monthly':
        if frequency_type == 'specific_dates' and 'dates' in frequency_config:
            dates = frequency_config['dates']; current_day = current_date.day
            next_dates = [d for d in dates if d > current_day]
            if next_dates:
                next_day = min(next_dates)
                try: return current_date.replace(day=next_day)
                except ValueError: pass
            next_month = current_date.month + 1; next_year = current_date.year
            if next_month > 12: next_month = 1; next_year += 1
            next_day = min(dates); max_day = calendar.monthrange(next_year, next_month)[1]
            return datetime.date(next_year, next_month, min(next_day, max_day))
        else:
            month = current_date.month + 1; year = current_date.year
            if month > 12: month = 1; year += 1
            day = min(current_date.day, calendar.monthrange(year, month)[1])
            return datetime.date(year, month, day)
    elif frequency == 'quarterly':
        month = current_date.month + 3; year = current_date.year
        if month > 12: month -= 12; year += 1
        day = min(current_date.day, calendar.monthrange(year, month)[1])
        return datetime.date(year, month, day)
    elif frequency == 'yearly':
        try: return current_date.replace(year=current_date.year + 1)
        except ValueError: return current_date.replace(year=current_date.year + 1, day=28)
    elif frequency == 'custom' and frequency_type == 'multiple_weekly':
        days_of_week = frequency_config.get('days', [])
        if not days_of_week: return current_date + timedelta(days=7)
        current_weekday = current_date.weekday()
        next_days = [d for d in days_of_week if d > current_weekday]
        if next_days: return current_date + timedelta(days=min(next_days) - current_weekday)
        else: return current_date + timedelta(days=7 - current_weekday + min(days_of_week))
    return current_date + timedelta(days=30)

# --- API Routes ---

@api_bp.route('/login', methods=['POST'])
@limiter.limit("5 per minute")
def login():
    data = request.get_json() or {}
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400
    user = User.query.filter_by(username=username).first()
    if user and user.check_password(password):
        # Commit any password hash migration that occurred during check_password
        db.session.commit()
        if user.password_change_required:
            token = secrets.token_hex(32); user.change_token = token; db.session.commit()
            return jsonify({'require_password_change': True, 'user_id': user.id, 'change_token': token, 'role': user.role})
        session['user_id'] = user.id; session['role'] = user.role
        dbs = [{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases]
        if dbs: session['db_name'] = dbs[0]['name']
        return jsonify({'message': 'Login successful', 'role': user.role, 'databases': dbs})
    return jsonify({'error': 'Invalid username or password'}), 401

@api_bp.route('/logout', methods=['POST'])
def logout():
    session.clear(); return jsonify({'message': 'Logged out successfully'})

@api_bp.route('/me', methods=['GET'])
@login_required
def me():
    user = db.session.get(User,session['user_id'])
    dbs = [{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases]
    return jsonify({
        'username': user.username,
        'role': user.role,
        'databases': dbs,
        'current_db': session.get('db_name'),
        'is_account_owner': user.is_account_owner if is_saas() else (user.role == 'admin')
    })

@api_bp.route('/select-db/<string:db_name>', methods=['POST'])
@login_required
def select_database(db_name):
    user = db.session.get(User,session['user_id']); target_db = Database.query.filter_by(name=db_name).first()
    if target_db and target_db in user.accessible_databases:
        session['db_name'] = db_name; return jsonify({'message': f'Selected database: {db_name}'})
    return jsonify({'error': 'Access denied'}), 403

@api_bp.route('/databases', methods=['GET', 'POST'])
@admin_required
def databases_handler():
    current_user = db.session.get(User,session.get('user_id'))
    if request.method == 'GET':
        # In SaaS mode, only show databases owned by this admin
        if is_saas():
            dbs = Database.query.filter_by(owner_id=current_user.id).order_by(Database.created_at.desc()).all()
        else:
            dbs = Database.query.order_by(Database.created_at.desc()).all()
        return jsonify([{'id': d.id, 'name': d.name, 'display_name': d.display_name, 'description': d.description} for d in dbs])
    else:
        data = request.get_json()
        name = data.get('name', '').strip()
        display_name = data.get('display_name', '').strip()

        # Validate database name
        is_valid, error = validate_database_name(name)
        if not is_valid:
            return jsonify({'error': error}), 400

        # Check if name already exists
        if Database.query.filter_by(name=name).first():
            return jsonify({'error': 'A database with this name already exists'}), 400
        new_db = Database(name=name, display_name=display_name, description=data.get('description', ''))
        # In SaaS mode, set owner to current admin
        if is_saas():
            new_db.owner_id = current_user.id
        db.session.add(new_db)
        # In SaaS mode, only grant access to this admin; in self-hosted, grant to all admins
        if is_saas():
            current_user.accessible_databases.append(new_db)
        else:
            for admin in User.query.filter_by(role='admin').all(): admin.accessible_databases.append(new_db)
        db.session.commit(); return jsonify({'message': 'Created', 'id': new_db.id}), 201

@api_bp.route('/databases/<int:db_id>', methods=['DELETE'])
@admin_required
def delete_database(db_id):
    target_db = db.get_or_404(Database,db_id)
    # In SaaS mode, only allow deleting databases you own
    if is_saas():
        current_user_id = session.get('user_id')
        if target_db.owner_id != current_user_id:
            return jsonify({'error': 'Access denied'}), 403
    db.session.delete(target_db); db.session.commit(); return jsonify({'message': 'Deleted'})

@api_bp.route('/databases/<int:db_id>/access', methods=['GET', 'POST'])
@admin_required
def database_access_handler(db_id):
    target_db = db.get_or_404(Database,db_id)
    current_user_id = session.get('user_id')
    # In SaaS mode, only allow managing access to databases you own
    if is_saas() and target_db.owner_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403
    if request.method == 'GET':
        return jsonify([{'id': u.id, 'username': u.username, 'role': u.role} for u in target_db.users])
    else:
        user = db.get_or_404(User,request.get_json().get('user_id'))
        # In SaaS mode, only allow granting access to users you created
        if is_saas() and user.created_by_id != current_user_id and user.id != current_user_id:
            return jsonify({'error': 'Cannot grant access to users outside your account'}), 403
        if target_db not in user.accessible_databases:
            user.accessible_databases.append(target_db); db.session.commit()
        return jsonify({'message': 'Granted'})

@api_bp.route('/databases/<int:db_id>/access/<int:user_id>', methods=['DELETE'])
@admin_required
def revoke_database_access(db_id, user_id):
    target_db = db.get_or_404(Database,db_id); user = db.get_or_404(User,user_id)
    current_user_id = session.get('user_id')
    # In SaaS mode, only allow revoking access to databases you own
    if is_saas() and target_db.owner_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403
    if target_db in user.accessible_databases:
        user.accessible_databases.remove(target_db); db.session.commit()
    return jsonify({'message': 'Revoked'})

@api_bp.route('/users', methods=['GET', 'POST'])
@admin_required
def users_handler():
    current_user_id = session.get('user_id')
    current_user = db.session.get(User,current_user_id)
    if request.method == 'GET':
        # In SaaS mode, only show users created by this admin (plus themselves)
        if is_saas():
            users = User.query.filter(
                (User.created_by_id == current_user_id) | (User.id == current_user_id)
            ).all()
        else:
            users = User.query.all()
        return jsonify([{'id': u.id, 'username': u.username, 'role': u.role, 'email': u.email} for u in users])
    else:
        data = request.get_json()
        username = data.get('username', '').strip().lower()
        password = data.get('password', '')

        # Validate username
        is_valid, error = validate_username(username)
        if not is_valid:
            return jsonify({'error': error}), 400

        # Validate password
        is_valid, error = validate_password(password)
        if not is_valid:
            return jsonify({'error': error}), 400

        # Check if username already taken
        if User.query.filter_by(username=username).first():
            return jsonify({'error': 'Username already taken'}), 400

        new_user = User(username=username, role=data.get('role', 'user'), password_change_required=True)
        # In SaaS mode, track who created this user
        if is_saas():
            new_user.created_by_id = current_user_id
        new_user.set_password(data.get('password')); db.session.add(new_user)
        for db_id in data.get('database_ids', []):
            d = db.session.get(Database,db_id)
            # In SaaS mode, only allow assigning access to databases you own
            if d:
                if is_saas() and d.owner_id != current_user_id:
                    continue  # Skip databases not owned by this admin
                new_user.accessible_databases.append(d)
        db.session.commit(); return jsonify({'message': 'Created', 'id': new_user.id}), 201

@api_bp.route('/users/<int:user_id>', methods=['PUT'])
@admin_required
def update_user(user_id):
    user = db.get_or_404(User,user_id)
    current_user_id = session.get('user_id')
    # In SaaS mode, only allow updating users you created (or yourself, or legacy users)
    if is_saas() and user.id != current_user_id:
        if user.created_by_id is not None and user.created_by_id != current_user_id:
            return jsonify({'error': 'Access denied'}), 403
    data = request.get_json()
    # Update email if provided
    if 'email' in data:
        new_email = data['email'].strip() if data['email'] else None
        if new_email and new_email != user.email:
            # Check for uniqueness
            existing = User.query.filter(User.email == new_email, User.id != user_id).first()
            if existing:
                return jsonify({'error': 'Email already in use'}), 400
        user.email = new_email
    db.session.commit()
    return jsonify({'id': user.id, 'username': user.username, 'role': user.role, 'email': user.email})

@api_bp.route('/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    if user_id == session.get('user_id'): return jsonify({'error': 'Self'}), 400
    user = db.get_or_404(User,user_id)
    # In SaaS mode, check permissions
    if is_saas():
        current_user_id = session.get('user_id')
        current_user = db.session.get(User,current_user_id)
        # Account owners can delete any user (except themselves, checked above)
        if current_user.is_account_owner:
            pass  # Allow deletion
        # Non-owner admins can only delete users they created or legacy users
        elif user.created_by_id is not None and user.created_by_id != current_user_id:
            return jsonify({'error': 'Access denied'}), 403
    db.session.delete(user); db.session.commit(); return jsonify({'message': 'Deleted'})

@api_bp.route('/users/invite', methods=['POST'])
@admin_required
def invite_user():
    """Send an invitation email to a new user"""
    data = request.get_json()
    email = data.get('email', '').strip().lower()
    role = data.get('role', 'user')
    database_ids = data.get('database_ids', [])

    # Validate email
    is_valid, error = validate_email(email)
    if not is_valid:
        return jsonify({'error': error}), 400

    # Check if user with this email already exists
    existing_user = User.query.filter_by(email=email).first()
    if existing_user:
        return jsonify({'error': 'A user with this email already exists'}), 400

    # Check for pending invite to same email
    pending_invite = UserInvite.query.filter_by(email=email, accepted_at=None).filter(
        UserInvite.expires_at > datetime.datetime.now(datetime.timezone.utc)
    ).first()
    if pending_invite:
        return jsonify({'error': 'An invitation has already been sent to this email'}), 400

    current_user_id = session.get('user_id')
    current_user = db.session.get(User,current_user_id)

    # In SaaS mode, validate database access
    if is_saas():
        for db_id in database_ids:
            d = db.session.get(Database,db_id)
            if d and d.owner_id != current_user_id:
                return jsonify({'error': 'Cannot grant access to databases you do not own'}), 403

    # Create invitation
    import secrets
    token = secrets.token_urlsafe(32)
    invite = UserInvite(
        email=email,
        token=token,
        role=role,
        invited_by_id=current_user_id,
        expires_at=datetime.datetime.now(datetime.timezone.utc) + timedelta(days=7)
    )
    # Store database IDs in a simple format (we'll use them when accepting)
    invite.database_ids = ','.join(str(id) for id in database_ids) if database_ids else ''

    db.session.add(invite)
    db.session.commit()

    # Send invitation email
    invited_by_name = current_user.username
    if send_invite_email(email, token, invited_by_name):
        return jsonify({'message': 'Invitation sent', 'id': invite.id}), 201
    else:
        return jsonify({'message': 'Invitation created but email failed to send', 'id': invite.id}), 201

@api_bp.route('/users/invites', methods=['GET'])
@admin_required
def get_invites():
    """Get pending invitations sent by current admin"""
    current_user_id = session.get('user_id')
    invites = UserInvite.query.filter_by(invited_by_id=current_user_id, accepted_at=None).filter(
        UserInvite.expires_at > datetime.datetime.now(datetime.timezone.utc)
    ).all()
    return jsonify([{
        'id': inv.id,
        'email': inv.email,
        'role': inv.role,
        'created_at': inv.created_at.isoformat(),
        'expires_at': inv.expires_at.isoformat()
    } for inv in invites])

@api_bp.route('/users/invites/<int:invite_id>', methods=['DELETE'])
@admin_required
def cancel_invite(invite_id):
    """Cancel a pending invitation"""
    current_user_id = session.get('user_id')
    invite = db.get_or_404(UserInvite,invite_id)
    if invite.invited_by_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403
    if invite.is_accepted:
        return jsonify({'error': 'Invitation already accepted'}), 400
    db.session.delete(invite)
    db.session.commit()
    return jsonify({'message': 'Invitation cancelled'})

@api_bp.route('/accept-invite', methods=['POST'])
def accept_invite():
    """Accept an invitation and create user account (public endpoint)"""
    data = request.get_json()
    token = data.get('token', '').strip()
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not token or not username or not password:
        return jsonify({'error': 'Token, username, and password are required'}), 400

    # Find the invitation
    invite = UserInvite.query.filter_by(token=token).first()
    if not invite:
        return jsonify({'error': 'Invalid invitation token'}), 400
    if invite.is_accepted:
        return jsonify({'error': 'Invitation has already been accepted'}), 400
    if invite.is_expired:
        return jsonify({'error': 'Invitation has expired'}), 400

    # Check username availability
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username is already taken'}), 400

    # Create the user
    new_user = User(
        username=username,
        email=invite.email,
        role=invite.role,
        created_by_id=invite.invited_by_id,
        email_verified_at=datetime.datetime.now(datetime.timezone.utc)  # Auto-verify since they received the invite email
    )
    new_user.set_password(password)
    db.session.add(new_user)

    # Grant access to specified databases
    if hasattr(invite, 'database_ids') and invite.database_ids:
        for db_id_str in invite.database_ids.split(','):
            try:
                db_id = int(db_id_str)
                d = db.session.get(Database,db_id)
                if d:
                    new_user.accessible_databases.append(d)
            except ValueError:
                pass

    # Mark invitation as accepted
    invite.accepted_at = datetime.datetime.now(datetime.timezone.utc)
    db.session.commit()

    return jsonify({'message': 'Account created successfully', 'username': username}), 201

@api_bp.route('/invite-info', methods=['GET'])
def get_invite_info():
    """Get information about an invitation (public endpoint)"""
    token = request.args.get('token', '').strip()
    if not token:
        return jsonify({'error': 'Token is required'}), 400

    invite = UserInvite.query.filter_by(token=token).first()
    if not invite:
        return jsonify({'error': 'Invalid invitation token'}), 404
    if invite.is_accepted:
        return jsonify({'error': 'Invitation has already been accepted'}), 400
    if invite.is_expired:
        return jsonify({'error': 'Invitation has expired'}), 400

    inviter = db.session.get(User,invite.invited_by_id)
    return jsonify({
        'email': invite.email,
        'invited_by': inviter.username if inviter else 'Unknown',
        'expires_at': invite.expires_at.isoformat()
    })

@api_bp.route('/users/<int:user_id>/databases', methods=['GET'])
@admin_required
def get_user_databases(user_id):
    user = db.get_or_404(User,user_id)
    current_user_id = session.get('user_id')
    # In SaaS mode, only allow viewing databases of users you created (or yourself, or legacy users)
    if is_saas() and user.id != current_user_id:
        if user.created_by_id is not None and user.created_by_id != current_user_id:
            return jsonify({'error': 'Access denied'}), 403
    return jsonify([{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases])

@api_bp.route('/api/accounts', methods=['GET'])
@login_required
def get_accounts():
    db_name = session.get('db_name'); target_db = Database.query.filter_by(name=db_name).first()
    if not target_db: return jsonify([])
    accounts = db.session.query(Bill.account).filter_by(database_id=target_db.id).distinct().all()
    return jsonify([a[0] for a in accounts if a[0]])

@api_bp.route('/bills', methods=['GET', 'POST'])
@login_required
def bills_handler():
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'DB invalid'}), 400
    if request.method == 'GET':
        include_archived = request.args.get('include_archived', 'false').lower() == 'true'
        query = Bill.query.filter_by(database_id=target_db.id)
        if not include_archived: query = query.filter_by(archived=False)
        bills = query.order_by(Bill.due_date).all(); result = []
        for bill in bills:
            b_dict = {
                'id': bill.id, 'name': bill.name, 'amount': bill.amount, 'varies': bill.is_variable,
                'frequency': bill.frequency, 'frequency_type': bill.frequency_type,
                'frequency_config': bill.frequency_config, 'next_due': bill.due_date,
                'auto_payment': bill.auto_pay, 'icon': bill.icon, 'type': bill.type,
                'account': bill.account, 'notes': bill.notes, 'archived': bill.archived
            }
            if bill.is_variable:
                avg = db.session.query(func.avg(Payment.amount)).filter_by(bill_id=bill.id).scalar()
                b_dict['avg_amount'] = float(avg) if avg else 0
            result.append(b_dict)
        return jsonify(result)
    else:
        # Check subscription limits before creating bill
        user = db.session.get(User,session.get('user_id'))
        if user:
            allowed, info = check_tier_limit(user, 'bills')
            if not allowed:
                return jsonify({
                    'error': f'You have reached your bill limit ({info.get("limit")}). Upgrade for more.',
                    'upgrade_required': True,
                    'limit_info': info
                }), 403

        data = request.get_json()

        # Validate bill name
        is_valid, error = validate_bill_name(data.get('name', ''))
        if not is_valid:
            return jsonify({'error': error}), 400

        # Validate amount if not variable
        if not data.get('varies', False):
            is_valid, error = validate_amount(data.get('amount'))
            if not is_valid:
                return jsonify({'error': error}), 400

        # Validate frequency
        is_valid, error = validate_frequency(data.get('frequency', 'monthly'))
        if not is_valid:
            return jsonify({'error': error}), 400

        # Validate next due date
        is_valid, error = validate_date(data.get('next_due', ''), 'Next due date')
        if not is_valid:
            return jsonify({'error': error}), 400

        new_bill = Bill(
            database_id=target_db.id, name=data['name'], amount=data.get('amount'),
            is_variable=data.get('varies', False), frequency=data.get('frequency', 'monthly'),
            frequency_type=data.get('frequency_type', 'simple'), frequency_config=data.get('frequency_config', '{}'),
            due_date=data['next_due'], auto_pay=data.get('auto_payment', False), icon=data.get('icon', 'payment'),
            type=data.get('type', 'expense'), account=data.get('account'), notes=data.get('notes'), archived=False
        )
        db.session.add(new_bill); db.session.commit(); return jsonify({'message': 'Added', 'id': new_bill.id}), 201

@api_bp.route('/bills/<int:bill_id>', methods=['PUT', 'DELETE'])
@login_required
def bill_detail_handler(bill_id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'No database selected'}), 400
    bill = db.get_or_404(Bill,bill_id)
    if bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    if request.method == 'PUT':
        data = request.get_json(); bill.name = data.get('name', bill.name); bill.amount = data.get('amount', bill.amount)
        bill.is_variable = data.get('varies', bill.is_variable); bill.frequency = data.get('frequency', bill.frequency)
        bill.frequency_type = data.get('frequency_type', bill.frequency_type); bill.frequency_config = data.get('frequency_config', bill.frequency_config)
        bill.due_date = data.get('next_due', bill.due_date); bill.auto_pay = data.get('auto_payment', bill.auto_pay)
        bill.icon = data.get('icon', bill.icon); bill.type = data.get('type', bill.type); bill.account = data.get('account', bill.account); bill.notes = data.get('notes', bill.notes)
        db.session.commit(); return jsonify({'message': 'Updated'})
    else: bill.archived = True; db.session.commit(); return jsonify({'message': 'Archived'})

@api_bp.route('/bills/<int:bill_id>/unarchive', methods=['POST'])
@login_required
def unarchive_bill(bill_id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'No database selected'}), 400
    bill = db.get_or_404(Bill,bill_id)
    if bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    bill.archived = False; db.session.commit(); return jsonify({'message': 'Unarchived'})

@api_bp.route('/bills/<int:bill_id>/permanent', methods=['DELETE'])
@login_required
def delete_bill_permanent(bill_id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'No database selected'}), 400
    bill = db.get_or_404(Bill,bill_id)
    if bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    db.session.delete(bill); db.session.commit(); return jsonify({'message': 'Deleted'})

@api_bp.route('/bills/<int:bill_id>/pay', methods=['POST'])
@login_required
def pay_bill(bill_id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'No database selected'}), 400
    bill = db.get_or_404(Bill,bill_id)
    if bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    data = request.get_json()
    payment = Payment(bill_id=bill.id, amount=data.get('amount'), payment_date=datetime.date.today().isoformat(), notes=data.get('notes'))
    db.session.add(payment)
    if data.get('advance_due', True):
        # Update existing bill instead of creating new
        next_due = calculate_next_due_date(bill.due_date, bill.frequency, bill.frequency_type, json.loads(bill.frequency_config))
        bill.due_date = next_due.isoformat()
        bill.archived = False # Ensure active
    db.session.commit(); return jsonify({'message': 'Paid'})

@api_bp.route('/bills/<string:name>/payments', methods=['GET'])
@login_required
def get_payments_by_name(name):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    payments = db.session.query(Payment).join(Bill).filter(Bill.database_id == target_db.id, Bill.name == name).order_by(desc(Payment.payment_date)).all()
    return jsonify([{'id': p.id, 'amount': p.amount, 'payment_date': p.payment_date, 'notes': p.notes} for p in payments])

@api_bp.route('/bills/<int:bill_id>/payments', methods=['GET'])
@login_required
def get_payments_by_id(bill_id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    bill = db.get_or_404(Bill,bill_id)
    if bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    payments = Payment.query.filter_by(bill_id=bill_id).order_by(desc(Payment.payment_date)).all()
    return jsonify([{'id': p.id, 'amount': p.amount, 'payment_date': p.payment_date, 'notes': p.notes} for p in payments])

@api_bp.route('/payments/<int:id>', methods=['PUT'])
@login_required
def update_payment(id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'No database selected'}), 400
    payment = db.get_or_404(Payment,id)
    if payment.bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    data = request.get_json()
    if 'amount' in data: payment.amount = data['amount']
    if 'payment_date' in data: payment.payment_date = data['payment_date']
    if 'notes' in data: payment.notes = data['notes']
    db.session.commit()
    return jsonify({'message': 'Payment updated'})

@api_bp.route('/payments/<int:id>', methods=['DELETE'])
@login_required
def delete_payment(id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'No database selected'}), 400
    payment = db.get_or_404(Payment,id)
    if payment.bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    db.session.delete(payment)
    db.session.commit()
    return jsonify({'message': 'Payment deleted'})

@api_bp.route('/api/payments/all', methods=['GET'])
@login_required
def get_all_payments():
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    payments = db.session.query(Payment).join(Bill).filter(Bill.database_id == target_db.id).order_by(desc(Payment.payment_date)).all()
    return jsonify([{'id': p.id, 'amount': p.amount, 'payment_date': p.payment_date, 'bill_name': p.bill.name, 'bill_icon': p.bill.icon} for p in payments])

@api_bp.route('/api/payments/monthly', methods=['GET'])
@login_required
def get_monthly_payments():
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    results = db.session.query(
        func.to_char(func.to_date(Payment.payment_date, 'YYYY-MM-DD'), 'YYYY-MM').label('month'),
        func.sum(Payment.amount)
    ).join(Bill).filter(
        Bill.database_id == target_db.id,
        Bill.type == 'expense'
    ).group_by('month').all()
    return jsonify({r[0]: float(r[1]) for r in results})

@api_bp.route('/api/payments/bill/<string:name>/monthly', methods=['GET'])
@login_required
def get_bill_monthly_payments(name):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    results = db.session.query(func.to_char(func.to_date(Payment.payment_date, 'YYYY-MM-DD'), 'YYYY-MM').label('month'), func.sum(Payment.amount), func.count(Payment.id)).join(Bill).filter(Bill.database_id == target_db.id, Bill.name == name).group_by('month').order_by(desc('month')).limit(12).all()
    return jsonify([{'month': r[0], 'total': float(r[1]), 'count': r[2]} for r in results])

@api_bp.route('/api/process-auto-payments', methods=['POST'])
@login_required
def process_auto_payments():
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    today = datetime.date.today().isoformat()
    auto_bills = Bill.query.filter_by(database_id=target_db.id, auto_pay=True, archived=False).filter(Bill.due_date <= today).all()
    for bill in auto_bills:
        payment = Payment(bill_id=bill.id, amount=bill.amount or 0, payment_date=today); db.session.add(payment)
        next_due = calculate_next_due_date(bill.due_date, bill.frequency, bill.frequency_type, json.loads(bill.frequency_config))
        bill.due_date = next_due.isoformat()
    db.session.commit(); return jsonify({'message': 'Processed', 'processed_count': len(auto_bills)})

@api_bp.route('/api/version', methods=['GET'])
def get_version():
    return jsonify({'version': '3.3.4', 'license': "O'Saasy", 'license_url': 'https://osaasy.dev/', 'features': ['enhanced_frequencies', 'auto_payments', 'postgresql_saas', 'row_tenancy', 'user_invites']})

@api_bp.route('/ping')
def ping(): return jsonify({'status': 'ok'})

# --- API v2 Routes (JWT Auth for Mobile) ---

@api_v2_bp.route('/auth/login', methods=['POST'])
@limiter.limit("5 per minute")
def jwt_login():
    """JWT login endpoint for mobile apps."""
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    username = data.get('username')
    password = data.get('password')
    device_info = data.get('device_info')

    if not username or not password:
        return jsonify({'success': False, 'error': 'Username and password required'}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify({'success': False, 'error': 'Invalid username or password'}), 401

    # Commit any password hash migration that occurred during check_password
    db.session.commit()

    # Check email verification if required
    if REQUIRE_EMAIL_VERIFICATION and not user.is_email_verified:
        return jsonify({
            'success': False,
            'error': 'Please verify your email before logging in',
            'email_verification_required': True
        }), 403

    # Handle password change requirement
    if user.password_change_required:
        token = secrets.token_hex(32)
        user.change_token = token
        db.session.commit()
        return jsonify({
            'success': False,
            'error': 'Password change required',
            'require_password_change': True,
            'change_token': token
        }), 403

    # Create tokens
    access_token = create_access_token(user.id, user.role)
    refresh_token = create_refresh_token(user.id, device_info)

    # Get accessible databases
    databases = [{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases]

    return jsonify({
        'success': True,
        'data': {
            'access_token': access_token,
            'refresh_token': refresh_token,
            'expires_in': int(JWT_ACCESS_TOKEN_EXPIRES.total_seconds()),
            'token_type': 'Bearer',
            'user': {
                'id': user.id,
                'username': user.username,
                'role': user.role
            },
            'databases': databases
        }
    })

@api_v2_bp.route('/auth/refresh', methods=['POST'])
def jwt_refresh():
    """Refresh access token using a valid refresh token."""
    data = request.get_json()
    refresh_token = data.get('refresh_token')

    if not refresh_token:
        return jsonify({'success': False, 'error': 'Refresh token required'}), 400

    stored_token = verify_refresh_token(refresh_token)
    if not stored_token:
        return jsonify({'success': False, 'error': 'Invalid or expired refresh token'}), 401

    user = db.session.get(User,stored_token.user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 401

    # Create new access token
    access_token = create_access_token(user.id, user.role)

    return jsonify({
        'success': True,
        'data': {
            'access_token': access_token,
            'expires_in': int(JWT_ACCESS_TOKEN_EXPIRES.total_seconds()),
            'token_type': 'Bearer'
        }
    })

@api_v2_bp.route('/auth/logout', methods=['POST'])
def jwt_logout():
    """Revoke refresh token (logout from device)."""
    data = request.get_json()
    refresh_token = data.get('refresh_token')

    if refresh_token:
        token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
        stored_token = RefreshToken.query.filter_by(token_hash=token_hash).first()
        if stored_token:
            stored_token.revoked = True
            db.session.commit()

    return jsonify({'success': True, 'message': 'Logged out successfully'})

@api_v2_bp.route('/auth/logout-all', methods=['POST'])
@jwt_required
def jwt_logout_all():
    """Revoke all refresh tokens for the current user (logout from all devices)."""
    RefreshToken.query.filter_by(user_id=g.jwt_user_id, revoked=False).update({'revoked': True})
    db.session.commit()
    return jsonify({'success': True, 'message': 'Logged out from all devices'})


# --- Registration & Password Reset Endpoints ---

@api_v2_bp.route('/auth/register', methods=['POST'])
@limiter.limit("3 per minute;10 per hour")
def register():
    """Register a new user account."""
    # Check if registration is enabled
    if not ENABLE_REGISTRATION:
        return jsonify({'success': False, 'error': 'Registration is disabled'}), 403

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    username = data.get('username', '').strip().lower()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    # Validation
    errors = []

    # Validate username
    is_valid, error = validate_username(username)
    if not is_valid:
        errors.append(error)

    # Validate email
    is_valid, error = validate_email(email)
    if not is_valid:
        errors.append(error)

    # Validate password
    is_valid, error = validate_password(password)
    if not is_valid:
        errors.append(error)

    if errors:
        return jsonify({'success': False, 'error': errors[0], 'errors': errors}), 400

    # Check if username or email already exists
    if User.query.filter_by(username=username).first():
        return jsonify({'success': False, 'error': 'Username already taken'}), 409
    if User.query.filter_by(email=email).first():
        return jsonify({'success': False, 'error': 'Email already registered'}), 409

    # Create user - in SaaS mode, each registered user is an admin of their own account
    user_role = 'admin' if is_saas() else 'user'
    user = User(username=username, email=email, role=user_role)
    user.set_password(password)

    # For self-hosted mode without email verification, mark as verified
    if not REQUIRE_EMAIL_VERIFICATION:
        user.email_verified_at = datetime.datetime.now(datetime.timezone.utc)
        token = None
    else:
        # Generate email verification token
        token = user.generate_email_verification_token()

    # Set trial only in SaaS mode with billing
    if ENABLE_BILLING:
        user.trial_ends_at = datetime.datetime.now(datetime.timezone.utc) + timedelta(days=14)

    db.session.add(user)

    # Create a default "Personal" database for the user
    default_db = Database(
        name=f"{username}_personal",
        display_name="Personal Finances",
        description="Your personal finance tracker"
    )
    db.session.add(default_db)
    db.session.flush()  # Get the IDs

    # In SaaS mode, set the owner_id to track which admin owns this database
    if is_saas():
        default_db.owner_id = user.id

    # Grant user access to their default database
    user.accessible_databases.append(default_db)

    # Create subscription only in SaaS mode with billing
    if ENABLE_BILLING:
        subscription = Subscription(
            user_id=user.id,
            status='trialing',
            trial_ends_at=user.trial_ends_at
        )
        db.session.add(subscription)

    db.session.commit()

    # Send verification email if required
    email_sent = False
    if REQUIRE_EMAIL_VERIFICATION and token:
        email_sent = send_verification_email(email, token, username)
        message = 'Account created! Please check your email to verify your account.'
    else:
        message = 'Account created! You can now log in.'
        # Send welcome email directly if no verification needed
        send_welcome_email(email, username)

    return jsonify({
        'success': True,
        'message': message,
        'email_sent': email_sent,
        'email_verification_required': REQUIRE_EMAIL_VERIFICATION,
        'user': {
            'id': user.id,
            'username': user.username,
            'email': user.email
        }
    }), 201


@api_v2_bp.route('/auth/verify-email', methods=['POST'])
def verify_email():
    """Verify email address with token."""
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    token = data.get('token', '')
    if not token:
        return jsonify({'success': False, 'error': 'Token required'}), 400

    # Find user with this token
    user = User.query.filter_by(email_verification_token=token).first()
    if not user:
        return jsonify({'success': False, 'error': 'Invalid or expired token'}), 400

    if not user.verify_email_token(token):
        return jsonify({'success': False, 'error': 'Token expired'}), 400

    # Mark email as verified
    user.email_verified_at = datetime.datetime.now(datetime.timezone.utc)
    user.email_verification_token = None
    user.email_verification_expires = None
    db.session.commit()

    # Send welcome email
    send_welcome_email(user.email, user.username)

    return jsonify({
        'success': True,
        'message': 'Email verified successfully! You can now log in.'
    })


@api_v2_bp.route('/auth/resend-verification', methods=['POST'])
def resend_verification():
    """Resend email verification link."""
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    email = data.get('email', '').strip().lower()
    if not email:
        return jsonify({'success': False, 'error': 'Email required'}), 400

    user = User.query.filter_by(email=email).first()

    # Always return success to prevent email enumeration
    if not user or user.is_email_verified:
        return jsonify({'success': True, 'message': 'If this email exists and is unverified, a new link has been sent.'})

    # Generate new token
    token = user.generate_email_verification_token()
    db.session.commit()

    # Send verification email
    send_verification_email(email, token, user.username)

    return jsonify({'success': True, 'message': 'If this email exists and is unverified, a new link has been sent.'})


@api_v2_bp.route('/auth/forgot-password', methods=['POST'])
@limiter.limit("3 per minute;10 per hour")
def forgot_password():
    """Request password reset email."""
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    email = data.get('email', '').strip().lower()
    if not email:
        return jsonify({'success': False, 'error': 'Email required'}), 400

    user = User.query.filter_by(email=email).first()

    # Always return success to prevent email enumeration
    if not user:
        return jsonify({'success': True, 'message': 'If this email is registered, a reset link has been sent.'})

    # Generate reset token
    token = user.generate_password_reset_token()
    db.session.commit()

    # Send password reset email
    send_password_reset_email(email, token, user.username)

    return jsonify({'success': True, 'message': 'If this email is registered, a reset link has been sent.'})


@api_v2_bp.route('/auth/reset-password', methods=['POST'])
@limiter.limit("5 per minute;15 per hour")
def reset_password():
    """Reset password with token."""
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    token = data.get('token', '')
    new_password = data.get('password', '')

    if not token:
        return jsonify({'success': False, 'error': 'Token required'}), 400
    if not new_password or len(new_password) < 8:
        return jsonify({'success': False, 'error': 'Password must be at least 8 characters'}), 400

    # Password strength check
    has_upper = any(c.isupper() for c in new_password)
    has_lower = any(c.islower() for c in new_password)
    has_digit = any(c.isdigit() for c in new_password)
    if not (has_upper and has_lower and has_digit):
        return jsonify({'success': False, 'error': 'Password must contain uppercase, lowercase, and a number'}), 400

    # Find user with this token
    user = User.query.filter_by(password_reset_token=token).first()
    if not user:
        return jsonify({'success': False, 'error': 'Invalid or expired token'}), 400

    if not user.verify_password_reset_token(token):
        return jsonify({'success': False, 'error': 'Token expired'}), 400

    # Update password
    user.set_password(new_password)
    user.password_reset_token = None
    user.password_reset_expires = None
    user.password_change_required = False

    # Revoke all refresh tokens for security
    RefreshToken.query.filter_by(user_id=user.id, revoked=False).update({'revoked': True})

    db.session.commit()

    return jsonify({
        'success': True,
        'message': 'Password reset successfully! You can now log in with your new password.'
    })


# --- Billing Endpoints ---

@api_v2_bp.route('/billing/config', methods=['GET'])
def billing_config():
    """Get Stripe publishable key for frontend."""
    return jsonify({
        'success': True,
        'publishable_key': STRIPE_PUBLISHABLE_KEY
    })


@api_v2_bp.route('/billing/usage', methods=['GET'])
@auth_required
def billing_usage():
    """Get current usage against tier limits."""
    from config import is_saas, get_tier_limits

    user = db.session.get(User,g.auth_user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    tier = get_user_effective_tier(user)
    limits = get_tier_limits(tier)

    # Calculate current usage
    _, bills_info = check_tier_limit(user, 'bills')
    _, bill_groups_info = check_tier_limit(user, 'bill_groups')

    return jsonify({
        'success': True,
        'data': {
            'tier': tier,
            'is_saas': is_saas(),
            'limits': limits,
            'usage': {
                'bills': {
                    'used': bills_info.get('used', 0),
                    'limit': bills_info.get('limit', -1),
                    'unlimited': bills_info.get('unlimited', False),
                },
                'bill_groups': {
                    'used': bill_groups_info.get('used', 0),
                    'limit': bill_groups_info.get('limit', -1),
                    'unlimited': bill_groups_info.get('unlimited', False),
                },
            }
        }
    })


@api_v2_bp.route('/billing/create-checkout', methods=['POST'])
@auth_required
def create_checkout():
    """Create a Stripe Checkout session for subscription."""
    user = db.session.get(User,g.auth_user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    # Check if user already has active paid subscription (allow trialing users to convert)
    if user.subscription and user.subscription.is_active and not user.subscription.is_trialing:
        return jsonify({'success': False, 'error': 'You already have an active subscription'}), 400

    # Get tier and interval from request
    data = request.get_json() or {}
    tier = data.get('tier', 'basic')
    interval = data.get('interval', 'monthly')

    # Validate tier and interval
    if tier not in ('basic', 'plus'):
        return jsonify({'success': False, 'error': 'Invalid tier. Must be basic or plus'}), 400
    if interval not in ('monthly', 'annual'):
        return jsonify({'success': False, 'error': 'Invalid interval. Must be monthly or annual'}), 400

    # Get or create customer ID
    customer_id = None
    if user.subscription and user.subscription.stripe_customer_id:
        customer_id = user.subscription.stripe_customer_id

    result = create_checkout_session(user.id, user.email, customer_id, tier, interval)

    if 'error' in result:
        return jsonify({'success': False, 'error': result['error']}), 400

    # Save customer ID if new
    if result.get('customer_id') and not customer_id:
        if not user.subscription:
            subscription = Subscription(user_id=user.id, status='pending', tier=tier, billing_interval=interval)
            db.session.add(subscription)
        else:
            subscription = user.subscription
            subscription.tier = tier
            subscription.billing_interval = interval
        subscription.stripe_customer_id = result['customer_id']
        db.session.commit()

    return jsonify({
        'success': True,
        'url': result['url'],
        'session_id': result['session_id']
    })


@api_v2_bp.route('/billing/portal', methods=['POST'])
@auth_required
def billing_portal():
    """Create a Stripe Customer Portal session for subscription management."""
    user = db.session.get(User,g.auth_user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    if not user.subscription or not user.subscription.stripe_customer_id:
        return jsonify({'success': False, 'error': 'No subscription found'}), 404

    result = create_portal_session(user.subscription.stripe_customer_id)

    if 'error' in result:
        return jsonify({'success': False, 'error': result['error']}), 400

    return jsonify({
        'success': True,
        'url': result['url']
    })


@api_v2_bp.route('/billing/change-plan', methods=['POST'])
@auth_required
def change_plan():
    """Change subscription plan (upgrade or downgrade)."""
    from config import get_stripe_price_id

    user = db.session.get(User,g.auth_user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    if not user.subscription or not user.subscription.stripe_subscription_id:
        return jsonify({'success': False, 'error': 'No active subscription to change'}), 400

    # Only allow changes for active paid subscriptions
    if user.subscription.status not in ('active', 'past_due'):
        return jsonify({'success': False, 'error': 'Subscription must be active to change plans'}), 400

    data = request.get_json() or {}
    new_tier = data.get('tier')
    new_interval = data.get('interval')

    if not new_tier or new_tier not in ('basic', 'plus'):
        return jsonify({'success': False, 'error': 'Invalid tier. Must be basic or plus'}), 400
    if not new_interval or new_interval not in ('monthly', 'annual'):
        return jsonify({'success': False, 'error': 'Invalid interval. Must be monthly or annual'}), 400

    # Get new price ID
    new_price_id = get_stripe_price_id(new_tier, new_interval)
    if not new_price_id:
        return jsonify({'success': False, 'error': 'Price not configured for selected plan'}), 400

    # Determine if upgrade or downgrade based on tier/price
    current_tier = user.subscription.tier or 'basic'
    tier_order = {'basic': 1, 'plus': 2}
    is_upgrade = tier_order.get(new_tier, 1) > tier_order.get(current_tier, 1)

    # Upgrades: immediate with proration. Downgrades: at end of billing period
    result = update_subscription(
        user.subscription.stripe_subscription_id,
        new_price_id,
        prorate=is_upgrade
    )

    if 'error' in result:
        return jsonify({'success': False, 'error': result['error']}), 400

    # Update local subscription record
    # For upgrades: update immediately. For downgrades: keep current tier until period ends
    if is_upgrade:
        user.subscription.tier = new_tier
        user.subscription.billing_interval = new_interval
        db.session.commit()
    # For downgrades, Stripe will handle the change at period end via webhook

    return jsonify({
        'success': True,
        'message': f"Plan {'upgraded' if is_upgrade else 'downgraded'} to {new_tier.capitalize()}",
        'effective': 'immediately' if is_upgrade else 'at end of billing period',
        'data': result
    })


@api_v2_bp.route('/billing/status', methods=['GET'])
@auth_required
def billing_status():
    """Get current subscription status."""
    from config import get_tier_limits

    user = db.session.get(User,g.auth_user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    subscription = user.subscription

    if not subscription:
        return jsonify({
            'success': True,
            'data': {
                'status': 'none',
                'has_subscription': False,
                'is_active': False,
                'is_trialing': False,
                'tier': 'free',
                'effective_tier': 'free',
                'limits': get_tier_limits('free'),
                'trial_ends_at': user.trial_ends_at.isoformat() if user.trial_ends_at else None
            }
        })

    effective_tier = subscription.effective_tier

    return jsonify({
        'success': True,
        'data': {
            'status': subscription.status,
            'has_subscription': True,
            'is_active': subscription.is_active,
            'is_trialing': subscription.is_trialing,
            'is_trial_expired': subscription.is_trial_expired,
            'plan': subscription.plan,
            'tier': subscription.tier,
            'effective_tier': effective_tier,
            'billing_interval': subscription.billing_interval,
            'limits': get_tier_limits(effective_tier),
            'trial_ends_at': subscription.trial_ends_at.isoformat() if subscription.trial_ends_at else None,
            'current_period_end': subscription.current_period_end.isoformat() if subscription.current_period_end else None,
            'canceled_at': subscription.canceled_at.isoformat() if subscription.canceled_at else None,
            'days_until_renewal': subscription.days_until_renewal
        }
    })


@api_v2_bp.route('/webhooks/stripe', methods=['POST'])
def stripe_webhook():
    """Handle Stripe webhook events."""
    payload = request.get_data()
    sig_header = request.headers.get('Stripe-Signature')

    if not sig_header:
        return jsonify({'error': 'Missing signature'}), 400

    event = construct_webhook_event(payload, sig_header)

    if isinstance(event, dict) and 'error' in event:
        return jsonify({'error': event['error']}), 400

    event_type = event.get('type')
    data = event.get('data', {}).get('object', {})

    logger.info(f"Stripe webhook received: {event_type}")

    try:
        if event_type == 'checkout.session.completed':
            # Payment successful, activate subscription
            metadata = data.get('metadata', {})
            user_id = metadata.get('user_id')
            tier = metadata.get('tier', 'basic')
            interval = metadata.get('interval', 'monthly')
            customer_id = data.get('customer')
            subscription_id = data.get('subscription')

            if user_id:
                user = db.session.get(User,int(user_id))
                if user:
                    if not user.subscription:
                        subscription = Subscription(user_id=user.id)
                        db.session.add(subscription)
                    else:
                        subscription = user.subscription

                    subscription.stripe_customer_id = customer_id
                    subscription.stripe_subscription_id = subscription_id
                    subscription.status = 'active'
                    subscription.tier = tier
                    subscription.billing_interval = interval
                    subscription.plan = f"{tier}_{interval}"  # e.g., "basic_monthly"

                    # Get subscription details from Stripe
                    sub_details = get_subscription(subscription_id)
                    if 'error' not in sub_details:
                        subscription.current_period_start = datetime.datetime.fromtimestamp(sub_details['current_period_start'])
                        subscription.current_period_end = datetime.datetime.fromtimestamp(sub_details['current_period_end'])

                    db.session.commit()
                    logger.info(f"Subscription activated for user {user_id}: {tier}/{interval}")

        elif event_type == 'invoice.paid':
            # Recurring payment successful
            subscription_id = data.get('subscription')
            if subscription_id:
                subscription = Subscription.query.filter_by(stripe_subscription_id=subscription_id).first()
                if subscription:
                    subscription.status = 'active'
                    sub_details = get_subscription(subscription_id)
                    if 'error' not in sub_details:
                        subscription.current_period_start = datetime.datetime.fromtimestamp(sub_details['current_period_start'])
                        subscription.current_period_end = datetime.datetime.fromtimestamp(sub_details['current_period_end'])
                    db.session.commit()
                    logger.info(f"Subscription renewed for subscription {subscription_id}")

        elif event_type == 'invoice.payment_failed':
            # Payment failed
            subscription_id = data.get('subscription')
            if subscription_id:
                subscription = Subscription.query.filter_by(stripe_subscription_id=subscription_id).first()
                if subscription:
                    subscription.status = 'past_due'
                    db.session.commit()
                    logger.warning(f"Payment failed for subscription {subscription_id}")

        elif event_type == 'customer.subscription.deleted':
            # Subscription canceled
            subscription_id = data.get('id')
            if subscription_id:
                subscription = Subscription.query.filter_by(stripe_subscription_id=subscription_id).first()
                if subscription:
                    subscription.status = 'canceled'
                    subscription.canceled_at = datetime.datetime.now(datetime.timezone.utc)
                    db.session.commit()
                    logger.info(f"Subscription canceled: {subscription_id}")

        elif event_type == 'customer.subscription.updated':
            # Subscription updated (status change, plan change, etc.)
            subscription_id = data.get('id')
            status = data.get('status')
            if subscription_id:
                subscription = Subscription.query.filter_by(stripe_subscription_id=subscription_id).first()
                if subscription:
                    subscription.status = status
                    if data.get('cancel_at_period_end'):
                        subscription.canceled_at = datetime.datetime.now(datetime.timezone.utc)

                    # Update tier from current subscription items (handles scheduled downgrades)
                    items = data.get('items', {}).get('data', [])
                    if items:
                        price_id = items[0].get('price', {}).get('id', '')
                        # Determine tier from price ID
                        if 'plus' in price_id.lower():
                            subscription.tier = 'plus'
                        elif 'basic' in price_id.lower():
                            subscription.tier = 'basic'
                        # Update billing interval
                        interval = items[0].get('price', {}).get('recurring', {}).get('interval', 'month')
                        subscription.billing_interval = 'annual' if interval == 'year' else 'monthly'

                    # Update period end
                    if data.get('current_period_end'):
                        subscription.current_period_end = datetime.datetime.fromtimestamp(data['current_period_end'])

                    db.session.commit()
                    logger.info(f"Subscription updated: {subscription_id} -> {status}, tier: {subscription.tier}")

    except Exception as e:
        logger.error(f"Webhook processing error: {e}")
        # Return 200 anyway to prevent Stripe retries
        return jsonify({'received': True, 'error': str(e)}), 200

    return jsonify({'received': True}), 200


@api_v2_bp.route('/me', methods=['GET'])
@jwt_required
def jwt_me():
    """Get current user info (JWT version)."""
    user = db.session.get(User,g.jwt_user_id)
    databases = [{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases]
    return jsonify({
        'success': True,
        'data': {
            'id': user.id,
            'username': user.username,
            'role': user.role,
            'databases': databases,
            'current_db': g.jwt_db_name,
            'is_account_owner': user.is_account_owner if is_saas() else (user.role == 'admin')
        }
    })

@api_v2_bp.route('/bills', methods=['GET'])
@jwt_required
def jwt_get_bills():
    """Get bills for the selected database (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    if not target_db:
        return jsonify({'success': False, 'error': 'Database not found'}), 404

    include_archived = request.args.get('include_archived', 'false').lower() == 'true'
    query = Bill.query.filter_by(database_id=target_db.id)
    if not include_archived:
        query = query.filter_by(archived=False)
    bills = query.order_by(Bill.due_date).all()

    result = []
    for bill in bills:
        b_dict = {
            'id': bill.id, 'name': bill.name, 'amount': bill.amount, 'varies': bill.is_variable,
            'frequency': bill.frequency, 'frequency_type': bill.frequency_type,
            'frequency_config': bill.frequency_config, 'next_due': bill.due_date,
            'auto_payment': bill.auto_pay, 'icon': bill.icon, 'type': bill.type,
            'account': bill.account, 'notes': bill.notes, 'archived': bill.archived
        }
        if bill.is_variable:
            avg = db.session.query(func.avg(Payment.amount)).filter_by(bill_id=bill.id).scalar()
            b_dict['avg_amount'] = float(avg) if avg else 0
        result.append(b_dict)

    return jsonify({'success': True, 'data': result})

@api_v2_bp.route('/bills', methods=['POST'])
@jwt_required
@subscription_required(feature='bills')
def jwt_create_bill():
    """Create a new bill (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    if not target_db:
        return jsonify({'success': False, 'error': 'Database not found'}), 404

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    # Validate bill name
    is_valid, error = validate_bill_name(data.get('name', ''))
    if not is_valid:
        return jsonify({'success': False, 'error': error}), 400

    # Validate amount if not variable
    if not data.get('varies', False):
        is_valid, error = validate_amount(data.get('amount'))
        if not is_valid:
            return jsonify({'success': False, 'error': error}), 400

    # Validate frequency
    is_valid, error = validate_frequency(data.get('frequency', 'monthly'))
    if not is_valid:
        return jsonify({'success': False, 'error': error}), 400

    # Validate next due date
    is_valid, error = validate_date(data.get('next_due', ''), 'Next due date')
    if not is_valid:
        return jsonify({'success': False, 'error': error}), 400

    new_bill = Bill(
        database_id=target_db.id, name=data['name'], amount=data.get('amount'),
        is_variable=data.get('varies', False), frequency=data.get('frequency', 'monthly'),
        frequency_type=data.get('frequency_type', 'simple'), frequency_config=data.get('frequency_config', '{}'),
        due_date=data['next_due'], auto_pay=data.get('auto_payment', False), icon=data.get('icon', 'payment'),
        type=data.get('type', 'expense'), account=data.get('account'), notes=data.get('notes'), archived=False
    )
    db.session.add(new_bill)
    db.session.commit()

    return jsonify({'success': True, 'data': {'id': new_bill.id, 'message': 'Bill created'}}), 201

@api_v2_bp.route('/bills/<int:bill_id>', methods=['GET'])
@jwt_required
def jwt_get_bill(bill_id):
    """Get a single bill by ID (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    bill = db.get_or_404(Bill,bill_id)

    if bill.database_id != target_db.id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    b_dict = {
        'id': bill.id, 'name': bill.name, 'amount': bill.amount, 'varies': bill.is_variable,
        'frequency': bill.frequency, 'frequency_type': bill.frequency_type,
        'frequency_config': bill.frequency_config, 'next_due': bill.due_date,
        'auto_payment': bill.auto_pay, 'icon': bill.icon, 'type': bill.type,
        'account': bill.account, 'notes': bill.notes, 'archived': bill.archived
    }
    if bill.is_variable:
        avg = db.session.query(func.avg(Payment.amount)).filter_by(bill_id=bill.id).scalar()
        b_dict['avg_amount'] = float(avg) if avg else 0

    return jsonify({'success': True, 'data': b_dict})

@api_v2_bp.route('/bills/<int:bill_id>', methods=['PUT'])
@jwt_required
def jwt_update_bill(bill_id):
    """Update a bill (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    bill = db.get_or_404(Bill,bill_id)

    if bill.database_id != target_db.id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    if 'name' in data: bill.name = data['name']
    if 'amount' in data: bill.amount = data['amount']
    if 'varies' in data: bill.is_variable = data['varies']
    if 'frequency' in data: bill.frequency = data['frequency']
    if 'frequency_type' in data: bill.frequency_type = data['frequency_type']
    if 'frequency_config' in data: bill.frequency_config = data['frequency_config']
    if 'next_due' in data: bill.due_date = data['next_due']
    if 'auto_payment' in data: bill.auto_pay = data['auto_payment']
    if 'icon' in data: bill.icon = data['icon']
    if 'type' in data: bill.type = data['type']
    if 'account' in data: bill.account = data['account']
    if 'notes' in data: bill.notes = data['notes']

    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Bill updated'}})

@api_v2_bp.route('/bills/<int:bill_id>', methods=['DELETE'])
@jwt_required
def jwt_archive_bill(bill_id):
    """Archive a bill (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    bill = db.get_or_404(Bill,bill_id)

    if bill.database_id != target_db.id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    bill.archived = True
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Bill archived'}})

@api_v2_bp.route('/bills/<int:bill_id>/unarchive', methods=['POST'])
@jwt_required
def jwt_unarchive_bill(bill_id):
    """Unarchive a bill (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    bill = db.get_or_404(Bill,bill_id)

    if bill.database_id != target_db.id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    bill.archived = False
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Bill unarchived'}})

@api_v2_bp.route('/bills/<int:bill_id>/permanent', methods=['DELETE'])
@jwt_required
def jwt_delete_bill_permanent(bill_id):
    """Permanently delete a bill (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    bill = db.get_or_404(Bill,bill_id)

    if bill.database_id != target_db.id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    db.session.delete(bill)
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Bill permanently deleted'}})

@api_v2_bp.route('/bills/<int:bill_id>/pay', methods=['POST'])
@jwt_required
def jwt_pay_bill(bill_id):
    """Record a payment for a bill (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    bill = db.get_or_404(Bill,bill_id)

    if bill.database_id != target_db.id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    payment = Payment(
        bill_id=bill.id,
        amount=data.get('amount', bill.amount),
        payment_date=data.get('payment_date', datetime.date.today().isoformat()),
        notes=data.get('notes')
    )
    db.session.add(payment)

    if data.get('advance_due', True):
        next_due = calculate_next_due_date(bill.due_date, bill.frequency, bill.frequency_type, json.loads(bill.frequency_config))
        bill.due_date = next_due.isoformat()
        bill.archived = False

    db.session.commit()
    return jsonify({'success': True, 'data': {'id': payment.id, 'message': 'Payment recorded'}})

@api_v2_bp.route('/bills/<int:bill_id>/payments', methods=['GET'])
@jwt_required
def jwt_get_bill_payments(bill_id):
    """Get payment history for a bill (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    bill = db.get_or_404(Bill,bill_id)

    if bill.database_id != target_db.id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    payments = Payment.query.filter_by(bill_id=bill_id).order_by(desc(Payment.payment_date)).all()
    result = [{'id': p.id, 'amount': p.amount, 'payment_date': p.payment_date, 'notes': p.notes} for p in payments]

    return jsonify({'success': True, 'data': result})

@api_v2_bp.route('/payments', methods=['GET'])
@jwt_required
def jwt_get_all_payments():
    """Get all payments across all bills (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    payments = db.session.query(Payment).join(Bill).filter(Bill.database_id == target_db.id).order_by(desc(Payment.payment_date)).all()

    result = [{
        'id': p.id,
        'amount': p.amount,
        'payment_date': p.payment_date,
        'notes': p.notes,
        'bill_id': p.bill_id,
        'bill_name': p.bill.name,
        'bill_icon': p.bill.icon,
        'bill_type': p.bill.type
    } for p in payments]

    return jsonify({'success': True, 'data': result})

@api_v2_bp.route('/payments/<int:payment_id>', methods=['PUT'])
@jwt_required
def jwt_update_payment(payment_id):
    """Update a payment (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    payment = db.get_or_404(Payment,payment_id)

    if payment.bill.database_id != target_db.id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    if 'amount' in data: payment.amount = data['amount']
    if 'payment_date' in data: payment.payment_date = data['payment_date']
    if 'notes' in data: payment.notes = data['notes']

    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Payment updated'}})

@api_v2_bp.route('/payments/<int:payment_id>', methods=['DELETE'])
@jwt_required
def jwt_delete_payment(payment_id):
    """Delete a payment (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    payment = db.get_or_404(Payment,payment_id)

    if payment.bill.database_id != target_db.id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    db.session.delete(payment)
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Payment deleted'}})

@api_v2_bp.route('/accounts', methods=['GET'])
@jwt_required
def jwt_get_accounts():
    """Get list of distinct account names (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    if not target_db:
        return jsonify({'success': True, 'data': []})

    accounts = db.session.query(Bill.account).filter_by(database_id=target_db.id).distinct().all()
    result = [a[0] for a in accounts if a[0]]

    return jsonify({'success': True, 'data': result})

@api_v2_bp.route('/stats/monthly', methods=['GET'])
@jwt_required
def jwt_get_monthly_stats():
    """Get monthly payment totals (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    results = db.session.query(
        func.to_char(func.to_date(Payment.payment_date, 'YYYY-MM-DD'), 'YYYY-MM').label('month'),
        func.sum(Payment.amount),
        Bill.type
    ).join(Bill).filter(
        Bill.database_id == target_db.id
    ).group_by('month', Bill.type).all()

    # Organize by month with expense/deposit breakdown
    monthly = {}
    for r in results:
        month = r[0]
        if month not in monthly:
            monthly[month] = {'expenses': 0, 'deposits': 0}
        if r[2] == 'expense':
            monthly[month]['expenses'] = float(r[1])
        else:
            monthly[month]['deposits'] = float(r[1])

    return jsonify({'success': True, 'data': monthly})

@api_v2_bp.route('/process-auto-payments', methods=['POST'])
@jwt_required
def jwt_process_auto_payments():
    """Process auto-payments for bills due today or earlier (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    today = datetime.date.today().isoformat()
    auto_bills = Bill.query.filter_by(database_id=target_db.id, auto_pay=True, archived=False).filter(Bill.due_date <= today).all()

    processed = []
    for bill in auto_bills:
        payment = Payment(bill_id=bill.id, amount=bill.amount or 0, payment_date=today)
        db.session.add(payment)
        next_due = calculate_next_due_date(bill.due_date, bill.frequency, bill.frequency_type, json.loads(bill.frequency_config))
        bill.due_date = next_due.isoformat()
        processed.append({'bill_id': bill.id, 'name': bill.name, 'amount': bill.amount or 0})

    db.session.commit()
    return jsonify({'success': True, 'data': {'processed_count': len(processed), 'bills': processed}})

@api_v2_bp.route('/auth/change-password', methods=['POST'])
@limiter.limit("5 per minute;15 per hour")
def jwt_change_password():
    """Change password (for users with password_change_required or via change_token)."""
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    change_token = data.get('change_token')
    new_password = data.get('new_password')

    if not change_token or not new_password:
        return jsonify({'success': False, 'error': 'change_token and new_password are required'}), 400

    if len(new_password) < 8:
        return jsonify({'success': False, 'error': 'Password must be at least 8 characters'}), 400

    user = User.query.filter_by(change_token=change_token).first()
    if not user:
        return jsonify({'success': False, 'error': 'Invalid change token'}), 401

    user.set_password(new_password)
    user.password_change_required = False
    user.change_token = None
    db.session.commit()

    # Optionally auto-login after password change
    access_token = create_access_token(user.id, user.role)
    refresh_token = create_refresh_token(user.id, data.get('device_info'))
    databases = [{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases]

    return jsonify({
        'success': True,
        'data': {
            'message': 'Password changed successfully',
            'access_token': access_token,
            'refresh_token': refresh_token,
            'expires_in': int(JWT_ACCESS_TOKEN_EXPIRES.total_seconds()),
            'token_type': 'Bearer',
            'user': {'id': user.id, 'username': user.username, 'role': user.role},
            'databases': databases
        }
    })

# ============ API v2 Admin Endpoints ============

@api_v2_bp.route('/users', methods=['GET'])
@jwt_admin_required
def jwt_get_users():
    """Get all users (admin only)."""
    user_id = g.jwt_user_id
    current_user = db.session.get(User,user_id)
    if is_saas():
        users = User.query.filter(
            (User.created_by_id == user_id) | (User.id == user_id)
        ).all()
    else:
        users = User.query.all()
    return jsonify({
        'success': True,
        'data': [{'id': u.id, 'username': u.username, 'role': u.role, 'email': u.email, 'created_at': u.created_at.isoformat() if hasattr(u, 'created_at') and u.created_at else None} for u in users]
    })

@api_v2_bp.route('/users', methods=['POST'])
@jwt_admin_required
def jwt_create_user():
    """Create a new user directly (admin only, primarily for self-hosted mode)."""
    data = request.get_json()
    username = data.get('username', '').strip().lower()
    password = data.get('password', '')
    email = data.get('email', '').strip().lower() if data.get('email') else None
    role = data.get('role', 'user')
    database_ids = data.get('database_ids', [])

    # Validate username
    is_valid, error = validate_username(username)
    if not is_valid:
        return jsonify({'success': False, 'error': error}), 400

    # Validate password
    is_valid, error = validate_password(password)
    if not is_valid:
        return jsonify({'success': False, 'error': error}), 400

    # Validate email if provided
    if email:
        is_valid, error = validate_email(email)
        if not is_valid:
            return jsonify({'success': False, 'error': error}), 400

    if role not in ['admin', 'user']:
        return jsonify({'success': False, 'error': 'Invalid role'}), 400

    # Check if username already exists
    if User.query.filter_by(username=username).first():
        return jsonify({'success': False, 'error': 'Username already taken'}), 400

    # Check if email already exists (if provided)
    if email and User.query.filter_by(email=email).first():
        return jsonify({'success': False, 'error': 'Email already in use'}), 400

    current_user_id = g.jwt_user_id
    current_user = db.session.get(User,current_user_id)

    # Check users limit (only enforced in SaaS mode)
    allowed, info = check_tier_limit(current_user, 'users')
    if not allowed:
        return jsonify({
            'success': False,
            'error': f'You have reached your user limit ({info.get("limit")}). Upgrade your plan for more.',
            'upgrade_required': True,
            'limit_info': info
        }), 403

    # Create the new user
    new_user = User(
        username=username,
        role=role,
        email=email,
        password_change_required=True
    )
    if is_saas():
        new_user.created_by_id = current_user_id
    new_user.set_password(password)

    # Grant database access
    for db_id in database_ids:
        d = db.session.get(Database,db_id)
        if d:
            # In SaaS mode, only allow assigning access to databases you own
            if is_saas() and d.owner_id != current_user_id:
                continue
            new_user.accessible_databases.append(d)

    db.session.add(new_user)
    db.session.commit()

    return jsonify({
        'success': True,
        'data': {
            'id': new_user.id,
            'username': new_user.username,
            'role': new_user.role,
            'email': new_user.email
        }
    }), 201

@api_v2_bp.route('/users/<int:target_user_id>', methods=['PUT'])
@jwt_admin_required
def jwt_update_user(target_user_id):
    """Update user role (admin only)."""
    user = db.get_or_404(User,target_user_id)
    current_user_id = g.jwt_user_id
    if is_saas() and user.id != current_user_id:
        if user.created_by_id is not None and user.created_by_id != current_user_id:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
    data = request.get_json()
    if 'role' in data and data['role'] in ['admin', 'user']:
        user.role = data['role']
    if 'email' in data:
        new_email = data['email'].strip() if data['email'] else None
        if new_email and new_email != user.email:
            existing = User.query.filter(User.email == new_email, User.id != target_user_id).first()
            if existing:
                return jsonify({'success': False, 'error': 'Email already in use'}), 400
        user.email = new_email
    db.session.commit()
    return jsonify({'success': True, 'data': {'id': user.id, 'username': user.username, 'role': user.role, 'email': user.email}})

@api_v2_bp.route('/users/<int:target_user_id>', methods=['DELETE'])
@jwt_admin_required
def jwt_delete_user(target_user_id):
    """Delete a user (admin only)."""
    if target_user_id == g.jwt_user_id:
        return jsonify({'success': False, 'error': 'Cannot delete yourself'}), 400
    user = db.get_or_404(User,target_user_id)
    if is_saas():
        current_user_id = g.jwt_user_id
        current_user = db.session.get(User,current_user_id)
        if current_user.is_account_owner:
            pass
        elif user.created_by_id is not None and user.created_by_id != current_user_id:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
    db.session.delete(user)
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'User deleted'}})

@api_v2_bp.route('/invitations', methods=['GET'])
@jwt_admin_required
def jwt_get_invitations():
    """Get pending invitations (admin only)."""
    current_user_id = g.jwt_user_id
    invites = UserInvite.query.filter_by(invited_by_id=current_user_id, accepted_at=None).filter(
        UserInvite.expires_at > datetime.datetime.now(datetime.timezone.utc)
    ).all()
    return jsonify({
        'success': True,
        'data': [{
            'id': inv.id,
            'email': inv.email,
            'role': inv.role,
            'database_ids': [int(x) for x in inv.database_ids.split(',') if x] if hasattr(inv, 'database_ids') and inv.database_ids else [],
            'created_at': inv.created_at.isoformat(),
            'expires_at': inv.expires_at.isoformat()
        } for inv in invites]
    })

@api_v2_bp.route('/invitations', methods=['POST'])
@jwt_admin_required
def jwt_create_invitation():
    """Create a new invitation (admin only)."""
    import re
    import secrets
    data = request.get_json()
    email = data.get('email', '').strip().lower()
    role = data.get('role', 'user')
    database_ids = data.get('database_ids', [])

    if not email:
        return jsonify({'success': False, 'error': 'Email is required'}), 400
    if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
        return jsonify({'success': False, 'error': 'Invalid email format'}), 400

    existing_user = User.query.filter_by(email=email).first()
    if existing_user:
        return jsonify({'success': False, 'error': 'A user with this email already exists'}), 400

    pending_invite = UserInvite.query.filter_by(email=email, accepted_at=None).filter(
        UserInvite.expires_at > datetime.datetime.now(datetime.timezone.utc)
    ).first()
    if pending_invite:
        return jsonify({'success': False, 'error': 'An invitation has already been sent to this email'}), 400

    current_user_id = g.jwt_user_id
    current_user = db.session.get(User,current_user_id)

    # Check users limit (only enforced in SaaS mode)
    allowed, info = check_tier_limit(current_user, 'users')
    if not allowed:
        return jsonify({
            'success': False,
            'error': f'You have reached your user limit ({info.get("limit")}). Upgrade your plan for more.',
            'upgrade_required': True,
            'limit_info': info
        }), 403

    if is_saas():
        for db_id in database_ids:
            d = db.session.get(Database,db_id)
            if d and d.owner_id != current_user_id:
                return jsonify({'success': False, 'error': 'Cannot grant access to databases you do not own'}), 403

    token = secrets.token_urlsafe(32)
    invite = UserInvite(
        email=email,
        token=token,
        role=role,
        invited_by_id=current_user_id,
        expires_at=datetime.datetime.now(datetime.timezone.utc) + timedelta(days=7)
    )
    invite.database_ids = ','.join(str(id) for id in database_ids) if database_ids else ''

    db.session.add(invite)
    db.session.commit()

    invited_by_name = current_user.username
    email_sent = send_invite_email(email, token, invited_by_name)

    return jsonify({
        'success': True,
        'data': {'id': invite.id, 'message': 'Invitation sent' if email_sent else 'Invitation created but email failed to send'}
    }), 201

@api_v2_bp.route('/invitations/<int:invite_id>', methods=['DELETE'])
@jwt_admin_required
def jwt_delete_invitation(invite_id):
    """Cancel a pending invitation (admin only)."""
    current_user_id = g.jwt_user_id
    invite = db.get_or_404(UserInvite,invite_id)
    if invite.invited_by_id != current_user_id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    if invite.is_accepted:
        return jsonify({'success': False, 'error': 'Invitation already accepted'}), 400
    db.session.delete(invite)
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Invitation cancelled'}})

@api_v2_bp.route('/invitations/<int:invite_id>/resend', methods=['POST'])
@jwt_admin_required
def jwt_resend_invitation(invite_id):
    """Resend an invitation email (admin only)."""
    current_user_id = g.jwt_user_id
    invite = db.get_or_404(UserInvite,invite_id)
    if invite.invited_by_id != current_user_id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403
    if invite.is_accepted:
        return jsonify({'success': False, 'error': 'Invitation already accepted'}), 400

    current_user = db.session.get(User,current_user_id)
    email_sent = send_invite_email(invite.email, invite.token, current_user.username)

    return jsonify({'success': True, 'data': {'message': 'Invitation resent' if email_sent else 'Failed to resend invitation'}})

@api_v2_bp.route('/databases', methods=['GET'])
@jwt_admin_required
def jwt_get_databases():
    """Get all databases with access info (admin only)."""
    current_user_id = g.jwt_user_id
    current_user = db.session.get(User,current_user_id)

    if is_saas():
        databases = Database.query.filter_by(owner_id=current_user_id).all()
    else:
        databases = Database.query.all()

    result = []
    for d in databases:
        users_with_access = []
        for u in d.users:
            users_with_access.append({'user_id': u.id, 'username': u.username, 'role': u.role})
        result.append({
            'id': d.id,
            'name': d.name,
            'display_name': d.display_name,
            'users': users_with_access
        })

    return jsonify({'success': True, 'data': result})

@api_v2_bp.route('/databases', methods=['POST'])
@jwt_admin_required
def jwt_create_database():
    """Create a new database/bill group (admin only)."""
    data = request.get_json()
    name = data.get('name', '').strip().lower().replace(' ', '_')
    display_name = data.get('display_name', '').strip()

    # Validate database name
    is_valid, error = validate_database_name(name)
    if not is_valid:
        return jsonify({'success': False, 'error': error}), 400

    # Check if name already exists
    if Database.query.filter_by(name=name).first():
        return jsonify({'success': False, 'error': 'A database with this name already exists'}), 400

    current_user_id = g.jwt_user_id
    current_user = db.session.get(User,current_user_id)

    # Check bill_groups limit (only enforced in SaaS mode)
    allowed, info = check_tier_limit(current_user, 'bill_groups')
    if not allowed:
        return jsonify({
            'success': False,
            'error': f'You have reached your bill group limit ({info.get("limit")}). Upgrade your plan for more.',
            'upgrade_required': True,
            'limit_info': info
        }), 403

    new_db = Database(name=name, display_name=display_name)
    if is_saas():
        new_db.owner_id = current_user_id

    new_db.users.append(current_user)
    db.session.add(new_db)
    db.session.commit()

    return jsonify({'success': True, 'data': {'id': new_db.id, 'name': new_db.name, 'display_name': new_db.display_name}}), 201

@api_v2_bp.route('/databases/<int:database_id>', methods=['PUT'])
@jwt_admin_required
def jwt_update_database(database_id):
    """Update a database/bill group (admin only)."""
    database = db.get_or_404(Database,database_id)
    current_user_id = g.jwt_user_id

    if is_saas() and database.owner_id != current_user_id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    data = request.get_json()
    if 'display_name' in data:
        database.display_name = data['display_name'].strip()

    db.session.commit()
    return jsonify({'success': True, 'data': {'id': database.id, 'name': database.name, 'display_name': database.display_name}})

@api_v2_bp.route('/databases/<int:database_id>', methods=['DELETE'])
@jwt_admin_required
def jwt_delete_database(database_id):
    """Delete a database/bill group (admin only)."""
    database = db.get_or_404(Database,database_id)
    current_user_id = g.jwt_user_id

    if is_saas() and database.owner_id != current_user_id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    db.session.delete(database)
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Database deleted'}})

@api_v2_bp.route('/databases/<int:database_id>/access', methods=['POST'])
@jwt_admin_required
def jwt_add_database_access(database_id):
    """Grant user access to a database (admin only)."""
    database = db.get_or_404(Database,database_id)
    current_user_id = g.jwt_user_id

    if is_saas() and database.owner_id != current_user_id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    data = request.get_json()
    target_user_id = data.get('user_id')
    if not target_user_id:
        return jsonify({'success': False, 'error': 'user_id is required'}), 400

    target_user = db.get_or_404(User,target_user_id)

    if target_user in database.users:
        return jsonify({'success': False, 'error': 'User already has access'}), 400

    database.users.append(target_user)
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Access granted'}})

@api_v2_bp.route('/databases/<int:database_id>/access/<int:target_user_id>', methods=['DELETE'])
@jwt_admin_required
def jwt_remove_database_access(database_id, target_user_id):
    """Revoke user access from a database (admin only)."""
    database = db.get_or_404(Database,database_id)
    current_user_id = g.jwt_user_id

    if is_saas() and database.owner_id != current_user_id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    target_user = db.get_or_404(User,target_user_id)

    if target_user not in database.users:
        return jsonify({'success': False, 'error': 'User does not have access'}), 400

    database.users.remove(target_user)
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Access revoked'}})

@api_v2_bp.route('/version', methods=['GET'])
def jwt_get_version():
    """Get API version info."""
    return jsonify({
        'success': True,
        'data': {
            'version': '3.3.4',
            'api_version': 'v2',
            'license': "O'Saasy",
            'license_url': 'https://osaasy.dev/',
            'deployment_mode': DEPLOYMENT_MODE,
            'features': ['jwt_auth', 'mobile_api', 'enhanced_frequencies', 'auto_payments', 'postgresql_saas', 'row_tenancy', 'user_invites', 'device_management', 'delta_sync', 'conflict_resolution', 'push_notifications']
        }
    })


@api_v2_bp.route('/config', methods=['GET'])
def get_config():
    """Return public configuration for frontend."""
    return jsonify({
        'success': True,
        'data': get_public_config()
    })


@api_v2_bp.route('/notifications/config', methods=['GET'])
@jwt_required
def get_notification_config():
    """Get push notification configuration status."""
    from services.push_notifications import is_push_enabled
    return jsonify({
        'success': True,
        'data': {
            'push_enabled': is_push_enabled(),
            'supported_types': ['bill_reminder', 'payment_confirmed', 'account_activity', 'security_alert']
        }
    })


@api_v2_bp.route('/notifications/test', methods=['POST'])
@jwt_required
def send_test_notification():
    """Send a test push notification to verify device setup."""
    from services.push_notifications import send_push_to_user, is_push_enabled

    if not is_push_enabled():
        return jsonify({'success': False, 'error': 'Push notifications not configured (FCM_SERVER_KEY missing)'}), 503

    data = request.get_json(force=True, silent=True) or {}
    title = data.get('title', 'Test Notification')
    body = data.get('body', 'This is a test notification from BillManager')

    sent_count = send_push_to_user(
        g.jwt_user_id,
        title,
        body,
        {'action': 'test'},
        notification_type='test'
    )

    return jsonify({
        'success': True,
        'data': {
            'devices_notified': sent_count,
            'message': f'Test notification sent to {sent_count} device(s)'
        }
    })


@api_v2_bp.route('/notifications/reminders', methods=['POST'])
@jwt_admin_required
def trigger_bill_reminders():
    """
    Trigger bill reminder notifications (admin only).

    This endpoint is meant to be called by a cron job or scheduler.
    It sends reminders for bills due today, tomorrow, in 3 days, and in 7 days.

    Request body (optional):
    {
        "days_ahead": [0, 1, 3, 7]  // Days to check (default shown)
    }
    """
    from services.push_notifications import process_bill_reminders, is_push_enabled

    if not is_push_enabled():
        return jsonify({'success': False, 'error': 'Push notifications not configured'}), 503

    data = request.get_json(force=True, silent=True) or {}
    days_ahead = data.get('days_ahead')

    stats = process_bill_reminders(days_ahead)

    return jsonify({
        'success': True,
        'data': stats
    })

@api_v2_bp.route('/openapi.yaml', methods=['GET'])
def get_openapi_spec():
    """Serve the OpenAPI specification."""
    spec_path = os.path.join(os.path.dirname(__file__), 'openapi.yaml')
    if os.path.exists(spec_path):
        with open(spec_path, 'r') as f:
            return f.read(), 200, {'Content-Type': 'text/yaml'}
    return jsonify({'success': False, 'error': 'OpenAPI spec not found'}), 404

@api_v2_bp.route('/docs', methods=['GET'])
def api_docs():
    """Serve Swagger UI for API documentation."""
    return '''<!DOCTYPE html>
<html>
<head>
    <title>BillManager API - Documentation</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
        SwaggerUIBundle({
            url: "/api/v2/openapi.yaml",
            dom_id: '#swagger-ui',
            presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
            layout: "BaseLayout"
        });
    </script>
</body>
</html>''', 200, {'Content-Type': 'text/html'}

# --- Push Notification Helpers ---

def notify_payment_recorded(user_id: int, bill_id: int, bill_name: str, amount: float, payment_date: str):
    """Send push notification when a payment is recorded (async-safe)."""
    try:
        from services.push_notifications import send_payment_confirmation, is_push_enabled
        if is_push_enabled():
            send_payment_confirmation(user_id, bill_id, bill_name, amount, payment_date)
    except Exception as e:
        logger.warning(f"Failed to send payment notification: {e}")


# --- Device Management Endpoints (API v2) ---

@api_v2_bp.route('/devices', methods=['GET'])
@jwt_required
def jwt_get_devices():
    """Get all registered devices for the current user."""
    devices = UserDevice.query.filter_by(user_id=g.jwt_user_id).order_by(desc(UserDevice.last_active_at)).all()

    result = [{
        'id': d.id,
        'device_id': d.device_id,
        'device_name': d.device_name,
        'platform': d.platform,
        'app_version': d.app_version,
        'os_version': d.os_version,
        'last_active_at': d.last_active_at.isoformat() if d.last_active_at else None,
        'created_at': d.created_at.isoformat() if d.created_at else None,
        'has_push_token': d.push_token is not None
    } for d in devices]

    return jsonify({'success': True, 'data': result})


@api_v2_bp.route('/devices', methods=['POST'])
@jwt_required
def jwt_register_device():
    """Register or update a device for push notifications."""
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    device_id = data.get('device_id')
    platform = data.get('platform')

    if not device_id or not platform:
        return jsonify({'success': False, 'error': 'device_id and platform are required'}), 400

    if platform not in ('ios', 'android', 'web', 'desktop'):
        return jsonify({'success': False, 'error': 'Invalid platform. Must be ios, android, web, or desktop'}), 400

    # Check if device already exists for this user
    existing_device = UserDevice.query.filter_by(user_id=g.jwt_user_id, device_id=device_id).first()
    is_new = existing_device is None

    if existing_device:
        # Update existing device
        device = existing_device
        device.device_name = data.get('device_name', device.device_name)
        device.platform = platform
        device.push_token = data.get('push_token', device.push_token)
        device.push_provider = data.get('push_provider', device.push_provider)
        device.app_version = data.get('app_version', device.app_version)
        device.os_version = data.get('os_version', device.os_version)
        device.last_active_at = datetime.datetime.now(datetime.timezone.utc)
        if data.get('notification_settings'):
            device.notification_settings = json.dumps(data['notification_settings'])
    else:
        # Create new device
        device = UserDevice(
            user_id=g.jwt_user_id,
            device_id=device_id,
            device_name=data.get('device_name'),
            platform=platform,
            push_token=data.get('push_token'),
            push_provider=data.get('push_provider'),
            app_version=data.get('app_version'),
            os_version=data.get('os_version'),
            notification_settings=json.dumps(data.get('notification_settings', {}))
        )
        db.session.add(device)

    db.session.commit()

    return jsonify({
        'success': True,
        'data': {
            'id': device.id,
            'device_id': device.device_id,
            'message': 'Device registered successfully'
        }
    }), 201 if is_new else 200


@api_v2_bp.route('/devices/<int:device_id>', methods=['DELETE'])
@jwt_required
def jwt_unregister_device(device_id):
    """Unregister a device (remove from push notifications)."""
    device = UserDevice.query.filter_by(id=device_id, user_id=g.jwt_user_id).first()

    if not device:
        return jsonify({'success': False, 'error': 'Device not found'}), 404

    db.session.delete(device)
    db.session.commit()

    return jsonify({'success': True, 'data': {'message': 'Device unregistered'}})


@api_v2_bp.route('/devices/<int:device_id>/push-token', methods=['PUT'])
@jwt_required
def jwt_update_push_token(device_id):
    """Update push notification token for a device."""
    device = UserDevice.query.filter_by(id=device_id, user_id=g.jwt_user_id).first()

    if not device:
        return jsonify({'success': False, 'error': 'Device not found'}), 404

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    device.push_token = data.get('push_token')
    device.push_provider = data.get('push_provider', device.push_provider)
    device.last_active_at = datetime.datetime.now(datetime.timezone.utc)
    db.session.commit()

    return jsonify({'success': True, 'data': {'message': 'Push token updated'}})


# --- Sync Endpoints (API v2) ---

@api_v2_bp.route('/sync/push', methods=['POST'])
@jwt_required
def jwt_sync_push():
    """
    Push local changes to server with conflict resolution.

    Uses last-write-wins strategy based on timestamps.

    Request body:
    {
        "bills": [
            {"id": 1, "name": "...", "last_updated": "ISO timestamp", ...},
            {"id": null, "name": "...", ...}  // New bill (id=null)
        ],
        "payments": [
            {"id": 1, "bill_id": 1, "updated_at": "ISO timestamp", ...},
            {"id": null, "bill_id": 1, ...}  // New payment
        ],
        "deleted_bills": [1, 2],  // IDs of bills to archive
        "deleted_payments": [1, 2]  // IDs of payments to delete
    }

    Response includes:
    - accepted: changes that were applied
    - rejected: changes that lost to server version (includes current server data)
    - server_time: timestamp for next sync
    """
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    if not target_db:
        return jsonify({'success': False, 'error': 'Database not found'}), 404

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    accepted_bills = []
    rejected_bills = []
    accepted_payments = []
    rejected_payments = []

    # Process bill changes
    for bill_data in data.get('bills', []):
        bill_id = bill_data.get('id')
        client_updated = bill_data.get('last_updated')

        if client_updated:
            try:
                client_time = datetime.datetime.fromisoformat(client_updated.replace('Z', '+00:00'))
            except ValueError:
                client_time = None
        else:
            client_time = None

        if bill_id:
            # Update existing bill
            bill = db.session.get(Bill,bill_id)
            if not bill or bill.database_id != target_db.id:
                rejected_bills.append({'id': bill_id, 'reason': 'not_found'})
                continue

            # Conflict check: compare timestamps
            server_time = bill.last_updated
            if client_time and server_time and client_time < server_time:
                # Server wins - client data is stale
                rejected_bills.append({
                    'id': bill_id,
                    'reason': 'conflict',
                    'server_data': {
                        'id': bill.id, 'name': bill.name, 'amount': bill.amount,
                        'varies': bill.is_variable, 'frequency': bill.frequency,
                        'next_due': bill.due_date, 'auto_payment': bill.auto_pay,
                        'icon': bill.icon, 'type': bill.type, 'account': bill.account,
                        'notes': bill.notes, 'archived': bill.archived,
                        'last_updated': bill.last_updated.isoformat() if bill.last_updated else None
                    }
                })
                continue

            # Client wins - apply changes
            if 'name' in bill_data: bill.name = bill_data['name']
            if 'amount' in bill_data: bill.amount = bill_data['amount']
            if 'varies' in bill_data: bill.is_variable = bill_data['varies']
            if 'frequency' in bill_data: bill.frequency = bill_data['frequency']
            if 'frequency_type' in bill_data: bill.frequency_type = bill_data['frequency_type']
            if 'frequency_config' in bill_data: bill.frequency_config = bill_data['frequency_config']
            if 'next_due' in bill_data: bill.due_date = bill_data['next_due']
            if 'auto_payment' in bill_data: bill.auto_pay = bill_data['auto_payment']
            if 'icon' in bill_data: bill.icon = bill_data['icon']
            if 'type' in bill_data: bill.type = bill_data['type']
            if 'account' in bill_data: bill.account = bill_data['account']
            if 'notes' in bill_data: bill.notes = bill_data['notes']

            accepted_bills.append({'id': bill.id, 'action': 'updated'})
        else:
            # Create new bill
            if not bill_data.get('name') or not bill_data.get('next_due'):
                rejected_bills.append({'id': None, 'reason': 'missing_required_fields', 'data': bill_data})
                continue

            new_bill = Bill(
                database_id=target_db.id,
                name=bill_data['name'],
                amount=bill_data.get('amount'),
                is_variable=bill_data.get('varies', False),
                frequency=bill_data.get('frequency', 'monthly'),
                frequency_type=bill_data.get('frequency_type', 'simple'),
                frequency_config=bill_data.get('frequency_config', '{}'),
                due_date=bill_data['next_due'],
                auto_pay=bill_data.get('auto_payment', False),
                icon=bill_data.get('icon', 'payment'),
                type=bill_data.get('type', 'expense'),
                account=bill_data.get('account'),
                notes=bill_data.get('notes'),
                archived=False
            )
            db.session.add(new_bill)
            db.session.flush()  # Get the ID
            accepted_bills.append({
                'id': new_bill.id,
                'action': 'created',
                'client_ref': bill_data.get('client_ref')  # For client to map temp ID
            })

    # Process payment changes
    for payment_data in data.get('payments', []):
        payment_id = payment_data.get('id')
        client_updated = payment_data.get('updated_at')

        if client_updated:
            try:
                client_time = datetime.datetime.fromisoformat(client_updated.replace('Z', '+00:00'))
            except ValueError:
                client_time = None
        else:
            client_time = None

        if payment_id:
            # Update existing payment
            payment = db.session.get(Payment,payment_id)
            if not payment:
                rejected_payments.append({'id': payment_id, 'reason': 'not_found'})
                continue

            # Verify payment belongs to a bill in this database
            bill = db.session.get(Bill,payment.bill_id)
            if not bill or bill.database_id != target_db.id:
                rejected_payments.append({'id': payment_id, 'reason': 'access_denied'})
                continue

            # Conflict check
            server_time = payment.updated_at
            if client_time and server_time and client_time < server_time:
                rejected_payments.append({
                    'id': payment_id,
                    'reason': 'conflict',
                    'server_data': {
                        'id': payment.id, 'bill_id': payment.bill_id,
                        'amount': payment.amount, 'payment_date': payment.payment_date,
                        'notes': payment.notes,
                        'updated_at': payment.updated_at.isoformat() if payment.updated_at else None
                    }
                })
                continue

            # Apply changes
            if 'amount' in payment_data: payment.amount = payment_data['amount']
            if 'payment_date' in payment_data: payment.payment_date = payment_data['payment_date']
            if 'notes' in payment_data: payment.notes = payment_data['notes']

            accepted_payments.append({'id': payment.id, 'action': 'updated'})
        else:
            # Create new payment
            bill_id = payment_data.get('bill_id')
            if not bill_id or not payment_data.get('amount') or not payment_data.get('payment_date'):
                rejected_payments.append({'id': None, 'reason': 'missing_required_fields', 'data': payment_data})
                continue

            # Verify bill exists and belongs to this database
            bill = db.session.get(Bill,bill_id)
            if not bill or bill.database_id != target_db.id:
                rejected_payments.append({'id': None, 'reason': 'invalid_bill_id', 'data': payment_data})
                continue

            new_payment = Payment(
                bill_id=bill_id,
                amount=payment_data['amount'],
                payment_date=payment_data['payment_date'],
                notes=payment_data.get('notes')
            )
            db.session.add(new_payment)
            db.session.flush()
            accepted_payments.append({
                'id': new_payment.id,
                'action': 'created',
                'client_ref': payment_data.get('client_ref')
            })

    # Process deletions (archive bills, delete payments)
    for bill_id in data.get('deleted_bills', []):
        bill = db.session.get(Bill,bill_id)
        if bill and bill.database_id == target_db.id:
            bill.archived = True
            accepted_bills.append({'id': bill_id, 'action': 'archived'})

    for payment_id in data.get('deleted_payments', []):
        payment = db.session.get(Payment,payment_id)
        if payment:
            bill = db.session.get(Bill,payment.bill_id)
            if bill and bill.database_id == target_db.id:
                db.session.delete(payment)
                accepted_payments.append({'id': payment_id, 'action': 'deleted'})

    db.session.commit()

    server_time = datetime.datetime.now(datetime.timezone.utc).isoformat() + 'Z'

    return jsonify({
        'success': True,
        'data': {
            'accepted_bills': accepted_bills,
            'rejected_bills': rejected_bills,
            'accepted_payments': accepted_payments,
            'rejected_payments': rejected_payments,
            'server_time': server_time
        }
    })


@api_v2_bp.route('/sync', methods=['GET'])
@jwt_required
def jwt_sync():
    """
    Get changes since a given timestamp for offline sync.

    Query params:
    - since: ISO timestamp (required) - get changes after this time
    - include_archived: bool (optional) - include archived bills

    Returns bills and payments modified after the given timestamp.
    """
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    if not target_db:
        return jsonify({'success': False, 'error': 'Database not found'}), 404

    since_str = request.args.get('since')
    if not since_str:
        return jsonify({'success': False, 'error': 'since parameter is required (ISO timestamp)'}), 400

    try:
        since = datetime.datetime.fromisoformat(since_str.replace('Z', '+00:00'))
    except ValueError:
        return jsonify({'success': False, 'error': 'Invalid since timestamp format. Use ISO 8601.'}), 400

    include_archived = request.args.get('include_archived', 'false').lower() == 'true'

    # Get bills modified after since timestamp
    bill_query = Bill.query.filter(
        Bill.database_id == target_db.id,
        Bill.last_updated > since
    )
    if not include_archived:
        bill_query = bill_query.filter_by(archived=False)
    bills = bill_query.all()

    # Get bill IDs for payment query
    all_bill_ids = [b.id for b in Bill.query.filter_by(database_id=target_db.id).all()]

    # Get payments modified after since timestamp
    payments = Payment.query.filter(
        Payment.bill_id.in_(all_bill_ids),
        Payment.updated_at > since
    ).all() if all_bill_ids else []

    # Format response
    bills_data = [{
        'id': b.id,
        'name': b.name,
        'amount': b.amount,
        'varies': b.is_variable,
        'frequency': b.frequency,
        'frequency_type': b.frequency_type,
        'frequency_config': b.frequency_config,
        'next_due': b.due_date,
        'auto_payment': b.auto_pay,
        'icon': b.icon,
        'type': b.type,
        'account': b.account,
        'notes': b.notes,
        'archived': b.archived,
        'last_updated': b.last_updated.isoformat() if b.last_updated else None
    } for b in bills]

    payments_data = [{
        'id': p.id,
        'bill_id': p.bill_id,
        'amount': p.amount,
        'payment_date': p.payment_date,
        'notes': p.notes,
        'created_at': p.created_at.isoformat() if p.created_at else None,
        'updated_at': p.updated_at.isoformat() if p.updated_at else None
    } for p in payments]

    # Server timestamp for next sync
    server_time = datetime.datetime.now(datetime.timezone.utc).isoformat() + 'Z'

    return jsonify({
        'success': True,
        'data': {
            'bills': bills_data,
            'payments': payments_data,
            'server_time': server_time,
            'has_more': False  # For future pagination
        }
    })


@api_v2_bp.route('/sync/full', methods=['GET'])
@jwt_required
def jwt_sync_full():
    """
    Get full data dump for initial sync or recovery.

    Returns all bills and payments for the selected database.
    """
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    target_db = Database.query.filter_by(name=g.jwt_db_name).first()
    if not target_db:
        return jsonify({'success': False, 'error': 'Database not found'}), 404

    include_archived = request.args.get('include_archived', 'false').lower() == 'true'

    # Get all bills
    bill_query = Bill.query.filter_by(database_id=target_db.id)
    if not include_archived:
        bill_query = bill_query.filter_by(archived=False)
    bills = bill_query.order_by(Bill.due_date).all()

    # Get all payments
    bill_ids = [b.id for b in bills]
    payments = Payment.query.filter(Payment.bill_id.in_(bill_ids)).all() if bill_ids else []

    # Format response
    bills_data = [{
        'id': b.id,
        'name': b.name,
        'amount': b.amount,
        'varies': b.is_variable,
        'frequency': b.frequency,
        'frequency_type': b.frequency_type,
        'frequency_config': b.frequency_config,
        'next_due': b.due_date,
        'auto_payment': b.auto_pay,
        'icon': b.icon,
        'type': b.type,
        'account': b.account,
        'notes': b.notes,
        'archived': b.archived,
        'last_updated': b.last_updated.isoformat() if b.last_updated else None
    } for b in bills]

    payments_data = [{
        'id': p.id,
        'bill_id': p.bill_id,
        'amount': p.amount,
        'payment_date': p.payment_date,
        'notes': p.notes,
        'created_at': p.created_at.isoformat() if p.created_at else None,
        'updated_at': p.updated_at.isoformat() if p.updated_at else None
    } for p in payments]

    server_time = datetime.datetime.now(datetime.timezone.utc).isoformat() + 'Z'

    return jsonify({
        'success': True,
        'data': {
            'bills': bills_data,
            'payments': payments_data,
            'server_time': server_time
        }
    })


# --- SPA Catch-all Routes ---

def get_client_dir():
    """Return the path to the client directory (dist for production, client for dev)."""
    dist_dir = os.path.join(os.path.dirname(__file__), '..', 'web', 'dist')
    if os.path.exists(dist_dir):
        return dist_dir
    return os.path.join(os.path.dirname(__file__), '..', 'web')

@spa_bp.route('/', methods=['GET'])
def index():
    return send_from_directory(get_client_dir(), 'index.html')

@spa_bp.route('/<path:path>', methods=['GET'])
def serve_static(path):
    client_dir = get_client_dir()
    full_path = os.path.join(client_dir, path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        return send_from_directory(client_dir, path)
    return send_from_directory(client_dir, 'index.html')

# --- Application Factory ---

def create_app():
    app = Flask(__name__, static_folder=None); app.url_map.strict_slashes = False
    app.secret_key = os.environ.get('FLASK_SECRET_KEY', secrets.token_hex(32))

    # Get DATABASE_URL and convert to psycopg3 dialect if needed
    db_url = os.environ.get('DATABASE_URL', 'postgresql://billsuser:billspass@db:5432/billsdb')
    if db_url.startswith('postgresql://'):
        db_url = db_url.replace('postgresql://', 'postgresql+psycopg://', 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = db_url
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    # CORS Configuration with sensible defaults
    # Priority: ALLOWED_ORIGINS env var > APP_URL > localhost (development)
    allowed_origins_env = os.environ.get('ALLOWED_ORIGINS', '')
    app_url = os.environ.get('APP_URL', '')

    if allowed_origins_env:
        # Use explicit ALLOWED_ORIGINS if set (comma-separated list)
        allowed_origins = [origin.strip() for origin in allowed_origins_env.split(',') if origin.strip()]
    elif app_url:
        # Use APP_URL for single-origin setup (typical for production)
        allowed_origins = [app_url]
    else:
        # Default to localhost for development
        allowed_origins = [
            'http://localhost:5173',  # Vite dev server
            'http://localhost:5001',  # Flask dev server
            'http://127.0.0.1:5173',
            'http://127.0.0.1:5001',
        ]

    logger.info(f"CORS allowed origins: {allowed_origins}")
    CORS(app, origins=allowed_origins, supports_credentials=True)
    db.init_app(app); Migrate(app, db)

    # Initialize rate limiter
    limiter.init_app(app)

    # Security headers with Talisman (only in production - check for production URL or explicit env var)
    is_production = os.environ.get('FLASK_ENV') == 'production' or 'billmanager.app' in os.environ.get('APP_URL', '')
    if is_production:
        Talisman(
            app,
            force_https=True,
            strict_transport_security=True,
            strict_transport_security_max_age=31536000,
            content_security_policy={
                'default-src': "'self'",
                'script-src': ["'self'", "'unsafe-inline'", "unpkg.com", "analytics.billmanager.app"],  # Swagger UI + Umami
                'style-src': ["'self'", "'unsafe-inline'", "unpkg.com"],
                'img-src': ["'self'", "data:", "billmanager.app"],
                'connect-src': ["'self'", "analytics.billmanager.app"],  # Umami analytics
            },
            referrer_policy='strict-origin-when-cross-origin',
            x_content_type_options=True,
            x_xss_protection=True,
        )

    # Secure session cookie configuration
    app.config['SESSION_COOKIE_SECURE'] = is_production  # HTTPS only in production
    app.config['SESSION_COOKIE_HTTPONLY'] = True  # Prevent JS access
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # CSRF protection
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)

    @app.before_request
    def log_request_info():
        g.start_time = datetime.datetime.now(); logger.info(f"➡️  {request.method} {request.path}")
    
    @app.after_request
    def log_response_info(response):
        if hasattr(g, 'start_time'):
            duration = datetime.datetime.now() - g.start_time
            logger.info(f"⬅️  {response.status} ({duration.total_seconds():.3f}s)")
        return response

    # Register API Blueprints first, then SPA
    app.register_blueprint(api_bp)
    app.register_blueprint(api_v2_bp)  # JWT auth for mobile
    app.register_blueprint(spa_bp)

    with app.app_context():
        try:
            logger.info("🗺️  Registered Routes:")
            for rule in app.url_map.iter_rules(): logger.info(f"    {rule.methods} {rule.rule} -> {rule.endpoint}")
            db.create_all(); migrate_sqlite_to_pg(app)

            # Detect fresh install BEFORE running migrations
            # Fresh install = no users AND no schema_migrations table
            from sqlalchemy import inspect as sa_inspect
            inspector = sa_inspect(db.engine)
            is_fresh_install = 'schema_migrations' not in inspector.get_table_names() and User.query.count() == 0

            # Run any pending database migrations (skip on fresh install - schema is already current)
            logger.info("🔄 Checking for pending database migrations...")
            if is_fresh_install:
                from db_migrations import ensure_migrations_table, record_migration, MIGRATIONS
                ensure_migrations_table(db)
                for version, description, _ in MIGRATIONS:
                    record_migration(db, version, description)
                logger.info(f"✨ Fresh install - marked {len(MIGRATIONS)} migrations as applied (schema already current)")
            else:
                run_pending_migrations(db)

            # First-run detection: only create defaults if NO users exist
            user_count = User.query.count()
            if user_count == 0:
                logger.info("🚀 First run detected - creating default admin and database")
                # Generate secure random password for first admin
                initial_password = secrets.token_urlsafe(12)
                admin = User(username='admin', role='admin', password_change_required=True)
                admin.set_password(initial_password)
                db.session.add(admin)
                p_db = Database(name='personal', display_name='Personal Finances', description='Personal bills and expenses')
                db.session.add(p_db)
                db.session.flush()  # Get IDs before linking
                admin.accessible_databases.append(p_db)
                db.session.commit()
                # Print credentials to stderr so Docker logs capture them
                import sys
                print("\n" + "=" * 60, file=sys.stderr)
                print("🔐 INITIAL ADMIN CREDENTIALS (save these now!)", file=sys.stderr)
                print(f"   Username: admin", file=sys.stderr)
                print(f"   Password: {initial_password}", file=sys.stderr)
                print("   You will be required to change this password on first login.", file=sys.stderr)
                print("=" * 60 + "\n", file=sys.stderr)
                logger.info("✅ Default admin and database created")
            else:
                logger.info(f"📦 Existing installation detected ({user_count} users) - skipping default creation")
        except Exception as e: logger.error(f"❌ Startup Error: {e}")
    return app

app = create_app()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)  # nosec B104 - dev server bind
