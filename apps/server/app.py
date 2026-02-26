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
from werkzeug.utils import safe_join
from werkzeug.security import generate_password_hash, check_password_hash
from flask_cors import CORS
from flask_migrate import Migrate
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_talisman import Talisman
from sqlalchemy import func, extract, desc

from models import db, User, Database, Bill, Payment, RefreshToken, Subscription, UserInvite, UserDevice, BillShare, ShareAuditLog, OAuthAccount, TwoFAConfig, TwoFAChallenge, WebAuthnCredential
from migration import migrate_sqlite_to_pg
from db_migrations import run_pending_migrations
from services.email import send_verification_email, send_password_reset_email, send_welcome_email, send_invite_email
from services.stripe_service import (
    create_checkout_session, create_portal_session, construct_webhook_event,
    get_subscription, cancel_subscription, update_subscription, STRIPE_PUBLISHABLE_KEY
)
from services.telemetry import telemetry
from services.scheduler import scheduler
from services.logging_config import (
    setup_logging, get_logger, request_logging_middleware,
    log_auth_event, log_security_event, log_audit_event
)
from config import (
    DEPLOYMENT_MODE, ENABLE_REGISTRATION, REQUIRE_EMAIL_VERIFICATION,
    ENABLE_BILLING, EMAIL_ENABLED, is_saas, is_self_hosted, get_public_config,
    OAUTH_PROVIDERS, get_enabled_oauth_providers, OAUTH_AUTO_REGISTER,
    ENABLE_2FA, ENABLE_PASSKEYS, WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME, WEBAUTHN_ORIGIN,
)
from validation import (
    validate_email, validate_username, validate_password, validate_amount,
    validate_date, validate_frequency, validate_bill_name, validate_database_name
)

# --- JWT Configuration ---
# In production, JWT_SECRET_KEY must be explicitly set
_jwt_secret = os.environ.get('JWT_SECRET_KEY') or os.environ.get('FLASK_SECRET_KEY')

# --- Initialize Structured Logging ---
# Environment variables: LOG_LEVEL, LOG_FORMAT, LOG_REQUESTS, LOG_SQL
setup_logging()
logger = get_logger(__name__)

if not _jwt_secret:
    if os.environ.get('FLASK_ENV') == 'production' or os.environ.get('ENVIRONMENT') == 'production':
        raise RuntimeError("JWT_SECRET_KEY or FLASK_SECRET_KEY must be set in production")
    # Development only - generate ephemeral key with warning
    _jwt_secret = secrets.token_hex(32)
    logger.warning("No JWT_SECRET_KEY set - using ephemeral key. Tokens will be invalid after restart.")
JWT_SECRET_KEY = _jwt_secret
JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=15)
JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=7)
CHANGE_TOKEN_EXPIRES = timedelta(minutes=15)
REFRESH_TOKEN_COOKIE_NAME = 'bm_refresh_token'  # nosec B105

# --- Blueprints ---
api_bp = Blueprint('api', __name__)
api_v2_bp = Blueprint('api_v2', __name__, url_prefix='/api/v2')
spa_bp = Blueprint('spa', __name__)

# --- Rate Limiter (initialized in create_app) ---
# No default limits - only apply rate limiting to sensitive endpoints (auth)
# Set RATE_LIMIT_ENABLED=false to disable rate limiting (for testing)
RATE_LIMIT_ENABLED = os.environ.get('RATE_LIMIT_ENABLED', 'true').lower() != 'false'

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri="memory://",
    enabled=RATE_LIMIT_ENABLED,
)


def _is_production_security_mode():
    """Return True when strict cookie/security defaults should be used."""
    return (
        os.environ.get('FLASK_ENV') == 'production' or
        os.environ.get('ENVIRONMENT') == 'production' or
        'billmanager.app' in os.environ.get('APP_URL', '')
    )


def _set_refresh_cookie(response, refresh_token):
    """Attach an HttpOnly refresh-token cookie to a response."""
    response.set_cookie(
        REFRESH_TOKEN_COOKIE_NAME,
        refresh_token,
        max_age=int(JWT_REFRESH_TOKEN_EXPIRES.total_seconds()),
        httponly=True,
        secure=_is_production_security_mode(),
        samesite='Lax',
        path='/api/v2/auth',
    )
    return response


def _clear_refresh_cookie(response):
    """Delete refresh-token cookie."""
    response.delete_cookie(
        REFRESH_TOKEN_COOKIE_NAME,
        path='/api/v2/auth',
        secure=_is_production_security_mode(),
        httponly=True,
        samesite='Lax',
    )
    return response


def _get_refresh_token_from_request():
    """Resolve refresh token from JSON body first, then HttpOnly cookie."""
    data = request.get_json(silent=True) or {}
    return data.get('refresh_token') or request.cookies.get(REFRESH_TOKEN_COOKIE_NAME)


# --- CSRF Protection ---

def issue_csrf_token():
    """Generate and persist CSRF token for session-authenticated routes."""
    token = secrets.token_urlsafe(32)
    session['csrf_token'] = token
    return token


# --- CSRF Protection ---

def check_csrf():
    """
    Check Origin/Referer and synchronizer token for CSRF protection.
    Requires both:
    1) Allowed Origin/Referer
    2) Matching X-CSRF-Token header against session token
    """
    if request.method in ('GET', 'HEAD', 'OPTIONS'):
        return True  # Safe methods don't need CSRF check

    # Build allowed origins dynamically based on request host and env
    app_url = os.environ.get('APP_URL', '')
    host = request.headers.get('Host', '')

    allowed_origins = {
        'http://localhost:5173',  # Vite dev server
        'http://localhost:5175',  # Vite dev server (alternate port)
        'http://localhost:5001',  # Flask dev server
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5175',
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

    # Require an origin signal (Origin preferred, Referer fallback)
    request_origin = None
    if origin:
        request_origin = origin
    elif referer:
        from urllib.parse import urlparse
        parsed = urlparse(referer)
        if not parsed.scheme or not parsed.netloc:
            return False
        request_origin = f"{parsed.scheme}://{parsed.netloc}"
    else:
        # Reject state-changing requests that omit both headers.
        return False

    if request_origin not in allowed_origins:
        return False

    csrf_session_token = session.get('csrf_token')
    csrf_header_token = request.headers.get('X-CSRF-Token')
    if not csrf_session_token or not csrf_header_token:
        return False

    return secrets.compare_digest(csrf_session_token, csrf_header_token)

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
    try:
        db.session.add(refresh)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.error(f"Failed to create refresh token for user {user_id}: {e}")
        raise

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

def check_bill_access(bill):
    """Check if the current JWT user can access a bill's database.

    In '_all_' mode, verifies the bill's database is in the user's accessible list.
    In single-database mode, verifies the bill belongs to the target database.

    Returns:
        True if access is granted, or a (response, status_code) tuple on failure.
    """
    if g.jwt_db_name == '_all_':
        user = db.session.get(User, g.jwt_user_id)
        bill_db = db.session.get(Database, bill.database_id)
        if not bill_db or bill_db not in user.accessible_databases:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
    else:
        target_db = Database.query.filter_by(name=g.jwt_db_name).first()
        if not target_db or bill.database_id != target_db.id:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
    return True


def resolve_accessible_db_ids():
    """Resolve the list of accessible database IDs for the current JWT user.

    In '_all_' mode, returns all databases the user can access.
    In single-database mode, returns just the target database.

    Returns:
        (accessible_db_ids, db_name_lookup) on success, or a (response, status_code) tuple on failure.
    """
    if g.jwt_db_name == '_all_':
        user = db.session.get(User, g.jwt_user_id)
        accessible_dbs = user.accessible_databases
        accessible_db_ids = [d.id for d in accessible_dbs]
        db_name_lookup = {d.id: d.display_name for d in accessible_dbs}
    else:
        target_db = Database.query.filter_by(name=g.jwt_db_name).first()
        if not target_db:
            return jsonify({'success': False, 'error': 'Database not found'}), 404
        accessible_db_ids = [target_db.id]
        db_name_lookup = {target_db.id: target_db.display_name}
    return accessible_db_ids, db_name_lookup


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
            if db_name == '_all_':
                # Special value for all-databases view
                g.jwt_db_name = '_all_'
            else:
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
@limiter.limit("20 per minute")
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
        log_auth_event('login', success=True, user_id=user.id, username=user.username)
        if user.password_change_required:
            token = secrets.token_hex(32)
            user.change_token = token
            user.change_token_expires = datetime.datetime.now(datetime.timezone.utc) + CHANGE_TOKEN_EXPIRES
            db.session.commit()
            return jsonify({'password_change_required': True, 'user_id': user.id, 'change_token': token, 'role': user.role})  # nosec B105
        session['user_id'] = user.id; session['role'] = user.role
        csrf_token = issue_csrf_token()
        dbs = [{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases]
        if dbs: session['db_name'] = dbs[0]['name']
        return jsonify({'message': 'Login successful', 'role': user.role, 'databases': dbs, 'csrf_token': csrf_token})
    log_auth_event('login', success=False, username=username)
    return jsonify({'error': 'Invalid username or password'}), 401

@api_bp.route('/change-password', methods=['POST'])
@limiter.limit("20 per minute")
def change_password():
    """Change password for users with password_change_required flag (first login)."""
    data = request.get_json() or {}
    change_token = data.get('change_token')
    new_password = data.get('new_password')

    if not change_token or not new_password:
        return jsonify({'error': 'change_token and new_password are required'}), 400

    is_valid, error = validate_password(new_password)
    if not is_valid:
        return jsonify({'error': error}), 400

    user = User.query.filter_by(change_token=change_token).first()
    if not user:
        return jsonify({'error': 'Invalid change token'}), 401
    if user.change_token_expires:
        expiry = (
            user.change_token_expires.replace(tzinfo=datetime.timezone.utc)
            if user.change_token_expires.tzinfo is None else user.change_token_expires
        )
        if expiry < datetime.datetime.now(datetime.timezone.utc):
            return jsonify({'error': 'Change token expired'}), 401

    user.set_password(new_password)
    user.password_change_required = False
    user.change_token = None
    user.change_token_expires = None
    db.session.commit()

    log_auth_event('password_change', success=True, user_id=user.id, username=user.username, first_login=True)

    # Set up session (like normal login)
    session['user_id'] = user.id
    session['role'] = user.role
    csrf_token = issue_csrf_token()
    dbs = [{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases]
    if dbs:
        session['db_name'] = dbs[0]['name']

    return jsonify({'message': 'Password changed successfully', 'role': user.role, 'databases': dbs, 'csrf_token': csrf_token})

@api_bp.route('/logout', methods=['POST'])
@login_required
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
        try:
            db.session.add(new_db)
            # In SaaS mode, only grant access to this admin; in self-hosted, grant to all admins
            if is_saas():
                current_user.accessible_databases.append(new_db)
            else:
                for admin in User.query.filter_by(role='admin').all(): admin.accessible_databases.append(new_db)
            db.session.commit()
            return jsonify({'message': 'Created', 'id': new_db.id}), 201
        except Exception as e:
            db.session.rollback()
            logger.error(f"Failed to create database '{name}': {e}")
            return jsonify({'error': 'Failed to create bill group. Please try again.'}), 500

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

@api_bp.route('/databases/<int:db_id>', methods=['PUT'])
@admin_required
def update_database(db_id):
    target_db = db.get_or_404(Database,db_id)
    # In SaaS mode, only allow updating databases you own
    if is_saas():
        current_user_id = session.get('user_id')
        if target_db.owner_id != current_user_id:
            return jsonify({'error': 'Access denied'}), 403
    data = request.get_json()
    if 'display_name' in data:
        display_name = data['display_name'].strip()
        if not display_name:
            return jsonify({'error': 'Display name cannot be empty'}), 400
        target_db.display_name = display_name
    if 'description' in data:
        target_db.description = data['description'].strip() if data['description'] else ''
    db.session.commit()
    return jsonify({'id': target_db.id, 'name': target_db.name, 'display_name': target_db.display_name, 'description': target_db.description})

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
    current_user = db.session.get(User,current_user_id)
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
    # Update role if provided
    if 'role' in data:
        new_role = data['role']
        if new_role not in ['admin', 'user']:
            return jsonify({'error': 'Invalid role. Must be "admin" or "user"'}), 400
        # Prevent demoting yourself
        if user.id == current_user_id and new_role != 'admin':
            return jsonify({'error': 'Cannot change your own role'}), 400
        # In SaaS mode, prevent changing account owner's role
        if is_saas() and user.is_account_owner and new_role != 'admin':
            return jsonify({'error': 'Cannot demote account owner'}), 400
        user.role = new_role
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

    try:
        db.session.add(invite)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.error(f"Failed to create invitation for {email}: {e}")
        return jsonify({'error': 'Failed to create invitation. Please try again.'}), 500

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
@limiter.limit("60 per minute", methods=['GET'])
@limiter.limit("30 per minute", methods=['POST'])
@login_required
def bills_handler():
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'DB invalid'}), 400
    if request.method == 'GET':
        current_user_id = session.get('user_id')
        include_archived = request.args.get('include_archived', 'false').lower() == 'true'

        # Get owned bills
        query = Bill.query.filter_by(database_id=target_db.id)
        if not include_archived: query = query.filter_by(archived=False)
        owned_bills = query.order_by(Bill.due_date).all()

        # Get shared bills (bills shared with current user)
        shared_bill_query = db.session.query(Bill).join(
            BillShare, Bill.id == BillShare.bill_id
        ).filter(
            BillShare.shared_with_user_id == current_user_id,
            BillShare.status == 'accepted'
        )
        if not include_archived:
            shared_bill_query = shared_bill_query.filter(Bill.archived == False)
        shared_bills_data = shared_bill_query.order_by(Bill.due_date).all()

        # Create a lookup for share info
        share_lookup = {}
        if shared_bills_data:
            shares = BillShare.query.filter(
                BillShare.shared_with_user_id == current_user_id,
                BillShare.status == 'accepted',
                BillShare.bill_id.in_([b.id for b in shared_bills_data])
            ).all()
            for share in shares:
                share_lookup[share.bill_id] = share

        result = []

        # Pre-compute average amounts for all variable bills in a single query (fixes N+1)
        all_bills = owned_bills + shared_bills_data
        variable_bill_ids = [b.id for b in all_bills if b.is_variable]
        avg_amounts_map = {}
        if variable_bill_ids:
            avg_query = db.session.query(
                Payment.bill_id,
                func.avg(Payment.amount).label('avg_amount')
            ).filter(Payment.bill_id.in_(variable_bill_ids)).group_by(Payment.bill_id).all()
            avg_amounts_map = {row.bill_id: float(row.avg_amount) for row in avg_query}

        # Pre-fetch database and owner info for shared bills (fixes N+1)
        owner_names_map = {}
        if shared_bills_data:
            db_ids = list(set(b.database_id for b in shared_bills_data))
            databases_with_owners = db.session.query(Database, User).join(
                User, Database.owner_id == User.id
            ).filter(Database.id.in_(db_ids)).all()
            for database, owner in databases_with_owners:
                owner_names_map[database.id] = owner.username if owner else 'Unknown'

        # Add owned bills
        for bill in owned_bills:
            b_dict = {
                'id': bill.id, 'name': bill.name, 'amount': bill.amount, 'varies': bill.is_variable,
                'frequency': bill.frequency, 'frequency_type': bill.frequency_type,
                'frequency_config': bill.frequency_config, 'next_due': bill.due_date,
                'auto_payment': bill.auto_pay, 'icon': bill.icon, 'type': bill.type,
                'account': bill.account, 'notes': bill.notes, 'archived': bill.archived,
                'is_shared': False
            }
            if bill.is_variable:
                b_dict['avg_amount'] = avg_amounts_map.get(bill.id, 0)
            result.append(b_dict)

        # Add shared bills
        for bill in shared_bills_data:
            share = share_lookup.get(bill.id)
            if not share:
                continue

            # Calculate recipient's portion
            my_portion = None
            if share.split_type and bill.amount is not None:
                my_portion = share.calculate_portion()

            owner_name = owner_names_map.get(bill.database_id, 'Unknown')

            b_dict = {
                'id': bill.id, 'name': bill.name, 'amount': bill.amount, 'varies': bill.is_variable,
                'frequency': bill.frequency, 'frequency_type': bill.frequency_type,
                'frequency_config': bill.frequency_config, 'next_due': bill.due_date,
                'auto_payment': bill.auto_pay, 'icon': bill.icon, 'type': bill.type,
                'account': bill.account, 'notes': bill.notes, 'archived': bill.archived,
                'is_shared': True,
                'share_info': {
                    'share_id': share.id,
                    'owner_name': owner_name,
                    'my_portion': my_portion,
                    'my_portion_paid': share.is_recipient_paid,
                    'my_portion_paid_date': share.recipient_paid_date.isoformat() if share.recipient_paid_date else None
                }
            }
            if bill.is_variable:
                b_dict['avg_amount'] = avg_amounts_map.get(bill.id, 0)
            result.append(b_dict)

        # Sort combined results by due date
        result.sort(key=lambda x: x['next_due'])
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
@limiter.limit("30 per minute")
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
@limiter.limit("30 per minute")
@login_required
def unarchive_bill(bill_id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'No database selected'}), 400
    bill = db.get_or_404(Bill,bill_id)
    if bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    bill.archived = False; db.session.commit(); return jsonify({'message': 'Unarchived'})

@api_bp.route('/bills/<int:bill_id>/permanent', methods=['DELETE'])
@limiter.limit("30 per minute")
@login_required
def delete_bill_permanent(bill_id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'No database selected'}), 400
    bill = db.get_or_404(Bill,bill_id)
    if bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    db.session.delete(bill); db.session.commit(); return jsonify({'message': 'Deleted'})

@api_bp.route('/bills/<int:bill_id>/pay', methods=['POST'])
@limiter.limit("30 per minute")
@login_required
def pay_bill(bill_id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'No database selected'}), 400
    bill = db.get_or_404(Bill,bill_id)
    if bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request data'}), 400

    amount = data.get('amount')
    if amount is None:
        return jsonify({'error': 'Payment amount is required'}), 400

    try:
        payment = Payment(bill_id=bill.id, amount=amount, payment_date=datetime.date.today().isoformat(), notes=data.get('notes'))
        db.session.add(payment)
        if data.get('advance_due', True):
            # Update existing bill instead of creating new
            freq_config = json.loads(bill.frequency_config) if bill.frequency_config else {}
            next_due = calculate_next_due_date(bill.due_date, bill.frequency, bill.frequency_type, freq_config)
            bill.due_date = next_due.isoformat()
            bill.archived = False # Ensure active
        db.session.commit()
        return jsonify({'message': 'Paid'})
    except json.JSONDecodeError:
        db.session.rollback()
        logger.error(f"Invalid frequency config for bill {bill_id}")
        return jsonify({'error': 'Invalid bill configuration'}), 500
    except Exception as e:
        db.session.rollback()
        logger.error(f"Failed to record payment for bill {bill_id}: {e}")
        return jsonify({'error': 'Failed to record payment. Please try again.'}), 500

@api_bp.route('/bills/<string:name>/payments', methods=['GET'])
@limiter.limit("60 per minute")
@login_required
def get_payments_by_name(name):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    payments = db.session.query(Payment).join(Bill).filter(Bill.database_id == target_db.id, Bill.name == name).order_by(desc(Payment.payment_date)).all()
    return jsonify([{'id': p.id, 'amount': p.amount, 'payment_date': p.payment_date, 'notes': p.notes} for p in payments])

@api_bp.route('/bills/<int:bill_id>/payments', methods=['GET'])
@limiter.limit("60 per minute")
@login_required
def get_payments_by_id(bill_id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    bill = db.get_or_404(Bill,bill_id)
    if bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    payments = Payment.query.filter_by(bill_id=bill_id).order_by(desc(Payment.payment_date)).all()
    return jsonify([{'id': p.id, 'amount': p.amount, 'payment_date': p.payment_date, 'notes': p.notes} for p in payments])

@api_bp.route('/payments/<int:id>', methods=['PUT'])
@limiter.limit("30 per minute")
@login_required
def update_payment(id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'No database selected'}), 400
    payment = db.get_or_404(Payment,id)
    if payment.bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request data'}), 400
    try:
        if 'amount' in data: payment.amount = data['amount']
        if 'payment_date' in data: payment.payment_date = data['payment_date']
        if 'notes' in data: payment.notes = data['notes']
        db.session.commit()
        return jsonify({'message': 'Payment updated'})
    except Exception as e:
        db.session.rollback()
        logger.error(f"Failed to update payment {id}: {e}")
        return jsonify({'error': 'Failed to update payment. Please try again.'}), 500

@api_bp.route('/payments/<int:id>', methods=['DELETE'])
@limiter.limit("30 per minute")
@login_required
def delete_payment(id):
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db: return jsonify({'error': 'No database selected'}), 400
    payment = db.get_or_404(Payment,id)
    if payment.bill.database_id != target_db.id: return jsonify({'error': 'Access denied'}), 403
    try:
        db.session.delete(payment)
        db.session.commit()
        return jsonify({'message': 'Payment deleted'})
    except Exception as e:
        db.session.rollback()
        logger.error(f"Failed to delete payment {id}: {e}")
        return jsonify({'error': 'Failed to delete payment. Please try again.'}), 500

# =============================================================================
# BILL SHARING ENDPOINTS (api_bp - session-based for web)
# =============================================================================

@api_bp.route('/bills/<int:bill_id>/share', methods=['POST'])
@limiter.limit("20 per minute")
@login_required
def share_bill(bill_id):
    """Share a bill with another user (session-based)."""
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db:
        return jsonify({'error': 'No database selected'}), 400

    bill = db.get_or_404(Bill, bill_id)
    if bill.database_id != target_db.id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request data'}), 400

    identifier = data.get('identifier', '').strip().lower()
    split_type = data.get('split_type')
    split_value = data.get('split_value')

    if not identifier:
        return jsonify({'error': 'Username or email is required'}), 400

    # Check for existing active share
    existing = BillShare.query.filter_by(
        bill_id=bill_id,
        shared_with_identifier=identifier
    ).filter(BillShare.status.in_(['pending', 'accepted'])).first()

    if existing:
        return jsonify({'error': 'Bill already shared with this user'}), 400

    current_user_id = session.get('user_id')

    # Determine identifier type
    if is_saas() and '@' in identifier:
        identifier_type = 'email'
        invite_token = secrets.token_urlsafe(32)
        expires_at = datetime.datetime.now(datetime.timezone.utc) + timedelta(days=7)
        # Case-insensitive email lookup
        from sqlalchemy import func
        target_user = User.query.filter(func.lower(User.email) == identifier).first()

        # Check if user already has access to this bill group
        if target_user:
            if target_db in target_user.accessible_databases:
                return jsonify({'error': 'User already has access to this bill group'}), 400

        shared_with_user_id = target_user.id if target_user else None
        status = 'accepted' if target_user else 'pending'
        accepted_at = datetime.datetime.now(datetime.timezone.utc) if target_user else None
    else:
        identifier_type = 'username'
        target_user = User.query.filter_by(username=identifier).first()

        if not target_user:
            return jsonify({'error': 'User not found'}), 404

        if target_user.id == current_user_id:
            return jsonify({'error': 'Cannot share with yourself'}), 400

        # Check if user already has access to this bill group
        if target_db in target_user.accessible_databases:
            return jsonify({'error': 'User already has access to this bill group'}), 400

        shared_with_user_id = target_user.id
        invite_token = None
        expires_at = None
        status = 'accepted'
        accepted_at = datetime.datetime.now(datetime.timezone.utc)

    share = BillShare(
        bill_id=bill_id,
        owner_user_id=current_user_id,
        shared_with_user_id=shared_with_user_id,
        shared_with_identifier=identifier,
        identifier_type=identifier_type,
        invite_token=invite_token,
        status=status,
        split_type=split_type,
        split_value=split_value,
        accepted_at=accepted_at,
        expires_at=expires_at
    )

    try:
        db.session.add(share)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.error(f"Failed to create bill share: {e}")
        return jsonify({'error': 'Failed to create share'}), 500

    # Send email if SaaS and pending
    if is_saas() and status == 'pending' and EMAIL_ENABLED:
        try:
            from services.email import send_bill_share_email
            current_user = db.session.get(User, current_user_id)
            send_bill_share_email(identifier, invite_token, bill.name, current_user.username)
        except Exception as e:
            logger.warning(f"Failed to send share invitation email: {e}")

    return jsonify({
        'share_id': share.id,
        'status': status,
        'message': 'Share created' if status == 'accepted' else 'Invitation sent'
    }), 201


@api_bp.route('/bills/<int:bill_id>/shares', methods=['GET'])
@limiter.limit("60 per minute")
@login_required
def get_bill_shares(bill_id):
    """Get all shares for a bill."""
    target_db = Database.query.filter_by(name=session.get('db_name')).first()
    if not target_db:
        return jsonify({'error': 'No database selected'}), 400

    bill = db.get_or_404(Bill, bill_id)
    if bill.database_id != target_db.id:
        return jsonify({'error': 'Access denied'}), 403

    # Security check: Only the database owner can view shares
    current_user_id = session.get('user_id')
    database = db.session.get(Database, bill.database_id)
    if not database or database.owner_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    shares = BillShare.query.filter_by(bill_id=bill_id).all()

    # Security: Only return shares owned by the current user
    filtered_shares = [s for s in shares if s.owner_user_id == current_user_id]

    return jsonify([{
        'id': s.id,
        'shared_with': s.shared_with_identifier,
        'identifier_type': s.identifier_type,
        'status': s.status,
        'split_type': s.split_type,
        'split_value': s.split_value,
        'created_at': s.created_at.isoformat() if s.created_at else None,
        'accepted_at': s.accepted_at.isoformat() if s.accepted_at else None
    } for s in filtered_shares])


@api_bp.route('/shares/<int:share_id>', methods=['DELETE'])
@limiter.limit("20 per minute")
@login_required
def revoke_share(share_id):
    """Revoke a bill share."""
    share = db.get_or_404(BillShare, share_id)
    current_user_id = session.get('user_id')

    if share.owner_user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    share.status = 'revoked'
    db.session.commit()
    return jsonify({'message': 'Share revoked'})


@api_bp.route('/shares/<int:share_id>', methods=['PUT'])
@limiter.limit("20 per minute")
@login_required
def update_share(share_id):
    """Update share split configuration."""
    share = db.get_or_404(BillShare, share_id)
    current_user_id = session.get('user_id')

    if share.owner_user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request data'}), 400

    if 'split_type' in data:
        split_type = data['split_type']
        # Validate split_type
        if split_type is not None and split_type not in ('percentage', 'fixed', 'equal'):
            return jsonify({'error': 'Invalid split_type. Must be one of: percentage, fixed, equal, or null'}), 400
        share.split_type = split_type
    if 'split_value' in data:
        share.split_value = data['split_value']

    db.session.commit()
    return jsonify({'message': 'Share updated'})


@api_bp.route('/shared-bills', methods=['GET'])
@login_required
def get_shared_bills():
    """Get bills shared with the current user."""
    from sqlalchemy.orm import joinedload

    current_user_id = session.get('user_id')

    # Use eager loading to avoid N+1 queries for bill and owner relationships
    shares = BillShare.query.filter_by(
        shared_with_user_id=current_user_id,
        status='accepted'
    ).options(
        joinedload(BillShare.bill),
        joinedload(BillShare.owner)
    ).all()

    # Batch fetch latest payments for all bills in a single query
    bill_ids = [share.bill.id for share in shares]
    latest_payments_subq = db.session.query(
        Payment.bill_id,
        func.max(Payment.payment_date).label('max_date')
    ).filter(Payment.bill_id.in_(bill_ids)).group_by(Payment.bill_id).subquery()

    latest_payments = db.session.query(Payment).join(
        latest_payments_subq,
        db.and_(
            Payment.bill_id == latest_payments_subq.c.bill_id,
            Payment.payment_date == latest_payments_subq.c.max_date
        )
    ).all() if bill_ids else []

    # Create a map of bill_id -> latest payment
    payments_map = {p.bill_id: p for p in latest_payments}

    result = []
    for share in shares:
        bill = share.bill
        latest_payment = payments_map.get(bill.id)

        result.append({
            'share_id': share.id,
            'bill': {
                'id': bill.id,
                'name': bill.name,
                'amount': bill.amount,
                'next_due': bill.due_date,
                'icon': bill.icon,
                'type': bill.type,
                'frequency': bill.frequency,
                'is_variable': bill.is_variable,
                'auto_pay': bill.auto_pay
            },
            'owner': share.owner.username,
            'owner_id': share.owner_user_id,
            'split_type': share.split_type,
            'split_value': share.split_value,
            'my_portion': share.calculate_portion(),
            'last_payment': {
                'id': latest_payment.id,
                'amount': latest_payment.amount,
                'date': latest_payment.payment_date,
                'notes': latest_payment.notes
            } if latest_payment else None,
            'created_at': share.created_at.isoformat() if share.created_at else None
        })

    return jsonify(result)


@api_bp.route('/shared-bills/pending', methods=['GET'])
@login_required
def get_pending_shares():
    """Get pending share invitations for the current user."""
    current_user_id = session.get('user_id')
    current_user = db.session.get(User, current_user_id)

    if not current_user or not current_user.email:
        return jsonify([])

    # Optimize: Filter out expired shares at database level instead of in Python loop
    from sqlalchemy import or_
    shares = BillShare.query.filter_by(
        shared_with_identifier=current_user.email.lower(),
        identifier_type='email',
        status='pending'
    ).filter(
        or_(
            BillShare.expires_at.is_(None),
            BillShare.expires_at > datetime.datetime.now(datetime.timezone.utc)
        )
    ).all()

    result = []
    for share in shares:
        bill = share.bill
        result.append({
            'share_id': share.id,
            'bill_name': bill.name,
            'bill_amount': bill.amount,
            'owner': share.owner.username,
            'split_type': share.split_type,
            'split_value': share.split_value,
            'my_portion': share.calculate_portion(),
            'expires_at': share.expires_at.isoformat() if share.expires_at else None
        })

    return jsonify(result)


@api_bp.route('/shares/<int:share_id>/accept', methods=['POST'])
@limiter.limit("20 per minute")
@login_required
def accept_share(share_id):
    """Accept a pending share invitation."""
    share = db.get_or_404(BillShare, share_id)
    current_user_id = session.get('user_id')
    current_user = db.session.get(User, current_user_id)

    # Verify access
    if share.identifier_type == 'email' and current_user.email:
        if share.shared_with_identifier.lower() != current_user.email.lower():
            return jsonify({'error': 'Access denied'}), 403
    elif share.identifier_type == 'username':
        # For username-based shares, must match the intended recipient (strict check)
        if not share.shared_with_user_id or share.shared_with_user_id != current_user_id:
            return jsonify({'error': 'Access denied'}), 403

    if share.status != 'pending':
        return jsonify({'error': f'Share is already {share.status}'}), 400

    if share.is_expired:
        return jsonify({'error': 'Share invitation has expired'}), 400

    share.status = 'accepted'
    share.shared_with_user_id = current_user_id
    share.accepted_at = datetime.datetime.now(datetime.timezone.utc)
    db.session.commit()

    return jsonify({'message': 'Share accepted'})


@api_bp.route('/shares/<int:share_id>/decline', methods=['POST'])
@limiter.limit("20 per minute")
@login_required
def decline_share(share_id):
    """Decline a pending share invitation."""
    share = db.get_or_404(BillShare, share_id)
    current_user_id = session.get('user_id')
    current_user = db.session.get(User, current_user_id)

    if share.identifier_type == 'email' and current_user.email:
        if share.shared_with_identifier.lower() != current_user.email.lower():
            return jsonify({'error': 'Access denied'}), 403
    elif share.identifier_type == 'username':
        # For username-based shares, must match the intended recipient (strict check)
        if not share.shared_with_user_id or share.shared_with_user_id != current_user_id:
            return jsonify({'error': 'Access denied'}), 403

    if share.status != 'pending':
        return jsonify({'error': f'Share is already {share.status}'}), 400

    share.status = 'declined'
    db.session.commit()

    return jsonify({'message': 'Share declined'})


@api_bp.route('/share/invite/<token>', methods=['GET'])
@limiter.limit("20 per minute")
def get_share_invite_details(token):
    """Get share invitation details by token (public endpoint)."""
    share = BillShare.query.filter_by(invite_token=token).first()
    if not share:
        return jsonify({'error': 'Invalid invitation'}), 404

    if share.status != 'pending':
        return jsonify({'error': f'Invitation already {share.status}'}), 400

    if share.is_expired:
        return jsonify({'error': 'Invitation has expired'}), 400

    # Get bill details
    bill = share.bill
    owner = share.owner

    return jsonify({
        'bill_name': bill.name,
        'bill_amount': bill.amount,
        'owner_username': owner.username,
        'shared_with_email': share.shared_with_identifier,
        'split_type': share.split_type,
        'split_value': share.split_value,
        'my_portion': share.calculate_portion() if share.split_type else None
    })


@api_bp.route('/share/accept-by-token', methods=['POST'])
@limiter.limit("20 per minute")
@login_required
def accept_share_by_token():
    """Accept a share invitation by token (for email-based invites)."""
    data = request.get_json()
    if not data or not data.get('token'):
        return jsonify({'error': 'Token required'}), 400

    share = BillShare.query.filter_by(invite_token=data['token']).first()
    if not share:
        return jsonify({'error': 'Invalid invitation'}), 404

    if share.status != 'pending':
        return jsonify({'error': f'Invitation already {share.status}'}), 400

    if share.is_expired:
        return jsonify({'error': 'Invitation has expired'}), 400

    current_user_id = session.get('user_id')
    current_user = db.session.get(User, current_user_id)

    # Verify the current user matches the invitation
    if share.identifier_type == 'email' and current_user.email:
        if share.shared_with_identifier.lower() != current_user.email.lower():
            return jsonify({'error': 'This invitation was sent to a different email address'}), 403

    # For username-based shares, verify username match
    if share.identifier_type == 'username':
        if not share.shared_with_user_id or share.shared_with_user_id != current_user_id:
            return jsonify({'error': 'Access denied'}), 403

    # Accept the share
    share.status = 'accepted'
    share.shared_with_user_id = current_user_id
    share.accepted_at = datetime.datetime.now(datetime.timezone.utc)
    db.session.commit()

    return jsonify({'message': 'Share accepted', 'share_id': share.id})


@api_bp.route('/shares/<int:share_id>/leave', methods=['POST'])
@limiter.limit("20 per minute")
@login_required
def leave_share(share_id):
    """Leave a shared bill."""
    share = db.get_or_404(BillShare, share_id)
    current_user_id = session.get('user_id')

    if share.shared_with_user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    if share.status != 'accepted':
        return jsonify({'error': 'Share is not active'}), 400

    share.status = 'revoked'
    db.session.commit()

    return jsonify({'message': 'Left shared bill'})


@api_bp.route('/shares/<int:share_id>/mark-paid', methods=['POST'])
@limiter.limit("20 per minute")
@login_required
def mark_share_paid(share_id):
    """Mark recipient's portion of shared bill as paid and create payment record."""
    share = db.get_or_404(BillShare, share_id)
    current_user_id = session.get('user_id')

    # Only the share recipient can mark their portion as paid
    if share.shared_with_user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    if share.status != 'accepted':
        return jsonify({'error': 'Share is not active'}), 400

    payment_id = None

    # Toggle paid status
    if share.recipient_paid_date:
        # Already marked as paid, so unmark it - delete the associated payment
        existing_payment = Payment.query.filter_by(share_id=share.id).first()
        if existing_payment:
            db.session.delete(existing_payment)
        share.recipient_paid_date = None
        message = 'Marked as unpaid'
    else:
        # Mark as paid - create a payment record for tracking
        portion_amount = share.calculate_portion()
        if portion_amount is None:
            portion_amount = share.bill.amount or 0

        # Get recipient's username for the note
        recipient = db.session.get(User, current_user_id)
        recipient_name = recipient.username if recipient else 'Unknown'

        payment = Payment(
            bill_id=share.bill_id,
            amount=portion_amount,
            payment_date=datetime.date.today().isoformat(),
            notes=f"Share payment by {recipient_name}",
            share_id=share.id
        )
        db.session.add(payment)
        share.recipient_paid_date = datetime.datetime.now(datetime.timezone.utc)
        message = 'Marked as paid'
        db.session.flush()  # Get the payment ID
        payment_id = payment.id

    db.session.commit()

    return jsonify({
        'message': message,
        'recipient_paid_date': share.recipient_paid_date.isoformat() if share.recipient_paid_date else None,
        'payment_id': payment_id
    })


@api_bp.route('/users/search', methods=['GET'])
@limiter.limit("20 per minute")
@login_required
def search_users():
    """Search for users by username (for sharing)."""
    query = request.args.get('q', '').strip().lower()
    current_user_id = session.get('user_id')

    if len(query) < 2:
        return jsonify([])

    # Escape SQL wildcards to prevent pattern-based enumeration attacks
    query_escaped = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')

    users = User.query.filter(
        User.username.ilike(f'%{query_escaped}%', escape='\\'),
        User.id != current_user_id
    ).limit(10).all()

    return jsonify([{'id': u.id, 'username': u.username} for u in users])


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
    return jsonify({'version': '4.0.0', 'license': "O'Saasy", 'license_url': 'https://osaasy.dev/', 'features': ['enhanced_frequencies', 'auto_payments', 'postgresql_saas', 'row_tenancy', 'user_invites', 'shared_bills']})

@api_bp.route('/ping')
def ping(): return jsonify({'status': 'ok'})

# --- API v2 Routes (JWT Auth for Mobile) ---

@api_v2_bp.route('/auth/login', methods=['POST'])
@limiter.limit("20 per minute")
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

    # Check email verification only if email service is configured and verification is required
    if EMAIL_ENABLED and REQUIRE_EMAIL_VERIFICATION and not user.is_email_verified:
        return jsonify({
            'success': False,
            'error': 'Please verify your email before logging in',
            'email_verification_required': True
        }), 403

    # Handle password change requirement
    if user.password_change_required:
        token = secrets.token_hex(32)
        user.change_token = token
        user.change_token_expires = datetime.datetime.now(datetime.timezone.utc) + CHANGE_TOKEN_EXPIRES
        db.session.commit()
        return jsonify({
            'success': False,
            'error': 'Password change required',
            'password_change_required': True,  # nosec B105
            'change_token': token
        }), 403

    # Check if 2FA is enabled for this user
    if user.twofa_config and user.twofa_config.is_enabled:
        session_token = secrets.token_urlsafe(32)
        session_hash = hashlib.sha256(session_token.encode()).hexdigest()

        challenge = TwoFAChallenge(
            user_id=user.id,
            token_hash=session_hash,
            challenge_type='pending',
            expires_at=_naive_utcnow() + datetime.timedelta(minutes=10),
        )
        db.session.add(challenge)
        db.session.commit()

        methods = []
        if user.twofa_config.email_otp_enabled:
            methods.append('email_otp')
        if user.twofa_config.passkey_enabled:
            methods.append('passkey')
        methods.append('recovery')

        return jsonify({
            'success': False,
            'twofa_required': True,
            'twofa_session_token': session_token,
            'twofa_methods': methods,
        }), 403

    # Create tokens
    access_token = create_access_token(user.id, user.role)
    refresh_token = create_refresh_token(user.id, device_info)

    # Get accessible databases
    databases = [{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases]

    response = jsonify({
        'success': True,
        'data': {
            'access_token': access_token,
            'refresh_token': refresh_token,
            'expires_in': int(JWT_ACCESS_TOKEN_EXPIRES.total_seconds()),
            'token_type': 'Bearer',  # nosec B105
            'user': {
                'id': user.id,
                'username': user.username,
                'role': user.role
            },
            'databases': databases
        }
    })
    return _set_refresh_cookie(response, refresh_token)

@api_v2_bp.route('/auth/refresh', methods=['POST'])
def jwt_refresh():
    """Refresh access token using a valid refresh token."""
    refresh_token = _get_refresh_token_from_request()

    if not refresh_token:
        return jsonify({'success': False, 'error': 'Refresh token required'}), 400

    stored_token = verify_refresh_token(refresh_token)
    if not stored_token:
        return jsonify({'success': False, 'error': 'Invalid or expired refresh token'}), 401

    user = db.session.get(User,stored_token.user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 401

    # Rotate refresh token on every refresh to limit replay window.
    stored_token.revoked = True
    access_token = create_access_token(user.id, user.role)
    new_refresh_token = create_refresh_token(user.id, stored_token.device_info)

    response = jsonify({
        'success': True,
        'data': {
            'access_token': access_token,
            'refresh_token': new_refresh_token,
            'expires_in': int(JWT_ACCESS_TOKEN_EXPIRES.total_seconds()),
            'token_type': 'Bearer'  # nosec B105
        }
    })
    return _set_refresh_cookie(response, new_refresh_token)

@api_v2_bp.route('/auth/logout', methods=['POST'])
def jwt_logout():
    """Revoke refresh token (logout from device)."""
    refresh_token = _get_refresh_token_from_request()

    if refresh_token:
        token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
        stored_token = RefreshToken.query.filter_by(token_hash=token_hash).first()
        if stored_token:
            stored_token.revoked = True
            db.session.commit()

    response = jsonify({'success': True, 'message': 'Logged out successfully'})
    return _clear_refresh_cookie(response)

@api_v2_bp.route('/auth/logout-all', methods=['POST'])
@jwt_required
def jwt_logout_all():
    """Revoke all refresh tokens for the current user (logout from all devices)."""
    RefreshToken.query.filter_by(user_id=g.jwt_user_id, revoked=False).update({'revoked': True})
    db.session.commit()
    response = jsonify({'success': True, 'message': 'Logged out from all devices'})
    return _clear_refresh_cookie(response)


# --- Registration & Password Reset Endpoints ---

@api_v2_bp.route('/auth/register', methods=['POST'])
@limiter.limit("10 per minute;30 per hour")
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
@limiter.limit("10 per minute;30 per hour")
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
@limiter.limit("20 per minute;60 per hour")
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
        'data': {
            'url': result['url'],
            'session_id': result['session_id']
        }
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
        'data': {
            'url': result['url']
        }
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
            'trial_days_remaining': subscription.trial_days_remaining,
            'current_period_end': subscription.current_period_end.isoformat() if subscription.current_period_end else None,
            'canceled_at': subscription.canceled_at.isoformat() if subscription.canceled_at else None,
            'cancel_at_period_end': subscription.cancel_at_period_end,
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
        # Don't expose internal error details to external callers
        return jsonify({'received': True}), 200

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
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'role': user.role,
                'is_account_owner': user.is_account_owner if is_saas() else (user.role == 'admin')
            },
            'databases': databases,
            'current_db': g.jwt_db_name
        }
    })

@api_v2_bp.route('/bills', methods=['GET'])
@limiter.limit("60 per minute")
@jwt_required
def jwt_get_bills():
    """Get bills for the selected database (JWT version), including shared bills."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    current_user_id = g.jwt_user_id
    include_archived = request.args.get('include_archived', 'false').lower() == 'true'

    # Handle "all databases" mode
    result = resolve_accessible_db_ids()
    if not isinstance(result[0], list):
        return result  # Error response
    accessible_db_ids, db_name_lookup = result

    # Get owned bills from accessible database(s)
    query = Bill.query.filter(Bill.database_id.in_(accessible_db_ids))
    if not include_archived:
        query = query.filter_by(archived=False)
    owned_bills = query.order_by(Bill.due_date).all()

    # Get share counts for owned bills (how many people each bill is shared with)
    owned_bill_ids = [b.id for b in owned_bills]
    share_counts = {}
    if owned_bill_ids:
        share_count_query = db.session.query(
            BillShare.bill_id,
            func.count(BillShare.id).label('count')
        ).filter(
            BillShare.bill_id.in_(owned_bill_ids),
            BillShare.status.in_(['pending', 'accepted'])
        ).group_by(BillShare.bill_id).all()
        share_counts = {row[0]: row[1] for row in share_count_query}

    # Get shared bills (bills shared with current user)
    shared_bill_query = db.session.query(Bill).join(
        BillShare, Bill.id == BillShare.bill_id
    ).filter(
        BillShare.shared_with_user_id == current_user_id,
        BillShare.status == 'accepted'
    )
    if not include_archived:
        shared_bill_query = shared_bill_query.filter(Bill.archived == False)
    shared_bills_data = shared_bill_query.order_by(Bill.due_date).all()

    # Create a lookup for share info
    share_lookup = {}
    if shared_bills_data:
        shares = BillShare.query.filter(
            BillShare.shared_with_user_id == current_user_id,
            BillShare.status == 'accepted',
            BillShare.bill_id.in_([b.id for b in shared_bills_data])
        ).all()
        for share in shares:
            share_lookup[share.bill_id] = share

    result = []

    # Add owned bills
    for bill in owned_bills:
        b_dict = {
            'id': bill.id, 'name': bill.name, 'amount': bill.amount, 'varies': bill.is_variable,
            'frequency': bill.frequency, 'frequency_type': bill.frequency_type,
            'frequency_config': bill.frequency_config, 'next_due': bill.due_date,
            'auto_payment': bill.auto_pay, 'icon': bill.icon, 'type': bill.type,
            'account': bill.account, 'notes': bill.notes, 'archived': bill.archived,
            'is_shared': False,
            'share_count': share_counts.get(bill.id, 0),
            'database_id': bill.database_id,
            'database_name': db_name_lookup.get(bill.database_id, 'Unknown')
        }
        if bill.is_variable:
            avg = db.session.query(func.avg(Payment.amount)).filter_by(bill_id=bill.id).scalar()
            b_dict['avg_amount'] = float(avg) if avg else 0
        result.append(b_dict)

    # Add shared bills
    for bill in shared_bills_data:
        share = share_lookup.get(bill.id)
        if not share:
            continue

        # Calculate recipient's portion
        my_portion = None
        if share.split_type and bill.amount is not None:
            my_portion = share.calculate_portion()

        # Get owner username from database owner
        database_owner = db.session.get(Database, bill.database_id)
        owner = db.session.get(User, database_owner.owner_id) if database_owner else None
        owner_name = owner.username if owner else 'Unknown'

        b_dict = {
            'id': bill.id, 'name': bill.name, 'amount': bill.amount, 'varies': bill.is_variable,
            'frequency': bill.frequency, 'frequency_type': bill.frequency_type,
            'frequency_config': bill.frequency_config, 'next_due': bill.due_date,
            'auto_payment': bill.auto_pay, 'icon': bill.icon, 'type': bill.type,
            'account': bill.account, 'notes': bill.notes, 'archived': bill.archived,
            'is_shared': True,
            'share_info': {
                'share_id': share.id,
                'owner_name': owner_name,
                'my_portion': my_portion,
                'my_portion_paid': share.is_recipient_paid,
                'my_portion_paid_date': share.recipient_paid_date.isoformat() if share.recipient_paid_date else None
            },
            'database_id': bill.database_id,
            'database_name': database_owner.display_name if database_owner else 'Unknown'
        }
        if bill.is_variable:
            avg = db.session.query(func.avg(Payment.amount)).filter_by(bill_id=bill.id).scalar()
            b_dict['avg_amount'] = float(avg) if avg else 0
        result.append(b_dict)

    # Sort combined results by due date
    result.sort(key=lambda x: x['next_due'])

    return jsonify({'success': True, 'data': result})

@api_v2_bp.route('/bills', methods=['POST'])
@limiter.limit("30 per minute")
@jwt_required
@subscription_required(feature='bills')
def jwt_create_bill():
    """Create a new bill (JWT version). Supports explicit database_id for creation from All Buckets mode."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    user = db.session.get(User, g.jwt_user_id)

    # Determine target database: explicit database_id takes precedence over X-Database header
    if 'database_id' in data:
        target_db = db.session.get(Database, data['database_id'])
        if not target_db:
            return jsonify({'success': False, 'error': 'Target database not found'}), 404
        if target_db not in user.accessible_databases:
            return jsonify({'success': False, 'error': 'Access denied to target database'}), 403
    elif g.jwt_db_name == '_all_':
        # In All Buckets mode, database_id is required
        return jsonify({'success': False, 'error': 'database_id is required when creating from All Buckets view'}), 400
    else:
        target_db = Database.query.filter_by(name=g.jwt_db_name).first()
        if not target_db:
            return jsonify({'success': False, 'error': 'Database not found'}), 404

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
@limiter.limit("60 per minute")
@jwt_required
def jwt_get_bill(bill_id):
    """Get a single bill by ID (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    bill = db.get_or_404(Bill, bill_id)

    access = check_bill_access(bill)
    if access is not True:
        return access

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
@limiter.limit("30 per minute")
@jwt_required
def jwt_update_bill(bill_id):
    """Update a bill (JWT version). Supports moving bills between databases."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    bill = db.get_or_404(Bill, bill_id)
    user = db.session.get(User, g.jwt_user_id)

    # Validate user has access to the bill's current database
    current_bill_db = db.session.get(Database, bill.database_id)
    if current_bill_db not in user.accessible_databases:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    # For non-_all_ mode, also verify X-Database header matches bill's database
    if g.jwt_db_name != '_all_':
        target_db = Database.query.filter_by(name=g.jwt_db_name).first()
        if bill.database_id != target_db.id:
            return jsonify({'success': False, 'error': 'Access denied'}), 403

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    # Handle moving bill to a different database
    if 'database_id' in data:
        new_db_id = data['database_id']
        new_db = db.session.get(Database, new_db_id)
        if not new_db:
            return jsonify({'success': False, 'error': 'Target database not found'}), 404
        if new_db not in user.accessible_databases:
            return jsonify({'success': False, 'error': 'Access denied to target database'}), 403
        bill.database_id = new_db_id

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
@limiter.limit("30 per minute")
@jwt_required
def jwt_archive_bill(bill_id):
    """Archive a bill (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    bill = db.get_or_404(Bill, bill_id)

    access = check_bill_access(bill)
    if access is not True:
        return access

    bill.archived = True
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Bill archived'}})

@api_v2_bp.route('/bills/<int:bill_id>/unarchive', methods=['POST'])
@limiter.limit("30 per minute")
@jwt_required
def jwt_unarchive_bill(bill_id):
    """Unarchive a bill (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    bill = db.get_or_404(Bill, bill_id)

    access = check_bill_access(bill)
    if access is not True:
        return access

    bill.archived = False
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Bill unarchived'}})

@api_v2_bp.route('/bills/<int:bill_id>/permanent', methods=['DELETE'])
@limiter.limit("30 per minute")
@jwt_required
def jwt_delete_bill_permanent(bill_id):
    """Permanently delete a bill (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    bill = db.get_or_404(Bill, bill_id)

    access = check_bill_access(bill)
    if access is not True:
        return access

    db.session.delete(bill)
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Bill permanently deleted'}})

@api_v2_bp.route('/bills/<int:bill_id>/pay', methods=['POST'])
@limiter.limit("30 per minute")
@jwt_required
def jwt_pay_bill(bill_id):
    """Record a payment for a bill (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    bill = db.get_or_404(Bill, bill_id)
    user = db.session.get(User, g.jwt_user_id)

    access = check_bill_access(bill)
    if access is not True:
        return access

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
        freq_config = json.loads(bill.frequency_config) if bill.frequency_config else {}
        next_due = calculate_next_due_date(bill.due_date, bill.frequency, bill.frequency_type, freq_config)
        bill.due_date = next_due.isoformat()
        bill.archived = False

    db.session.commit()
    return jsonify({'success': True, 'data': {'id': payment.id, 'message': 'Payment recorded'}})

@api_v2_bp.route('/bills/<int:bill_id>/payments', methods=['GET'])
@limiter.limit("60 per minute")
@jwt_required
def jwt_get_bill_payments(bill_id):
    """Get payment history for a bill (JWT version), including for shared bills."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    bill = db.get_or_404(Bill, bill_id)

    # Check access: either owns the bill OR has an accepted share
    has_access = check_bill_access(bill) is True
    if not has_access:
        # Check if user has an accepted share for this bill
        share = BillShare.query.filter_by(
            bill_id=bill_id,
            shared_with_user_id=g.jwt_user_id,
            status='accepted'
        ).first()
        has_access = share is not None

    if not has_access:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    payments = Payment.query.filter_by(bill_id=bill_id).order_by(desc(Payment.payment_date)).all()
    result = [{
        'id': p.id,
        'amount': p.amount,
        'payment_date': p.payment_date,
        'notes': p.notes,
        'is_share_payment': p.share_id is not None
    } for p in payments]

    return jsonify({'success': True, 'data': result})

@api_v2_bp.route('/payments', methods=['GET'])
@limiter.limit("60 per minute")
@jwt_required
def jwt_get_all_payments():
    """Get all payments across all bills (JWT version), including shared bill payments."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    # Handle "all databases" mode
    result = resolve_accessible_db_ids()
    if not isinstance(result[0], list):
        return result  # Error response
    accessible_db_ids, db_name_lookup = result

    # Get payments for bills owned by user in accessible database(s)
    owned_payments = db.session.query(Payment).join(Bill).filter(
        Bill.database_id.in_(accessible_db_ids)
    ).all()

    # Get payments for shared bills where current user is the share recipient
    shared_payments = db.session.query(Payment).join(
        BillShare, Payment.share_id == BillShare.id
    ).filter(
        BillShare.shared_with_user_id == g.jwt_user_id,
        BillShare.status == 'accepted'
    ).all()

    # Build result with proper categorization
    result = []
    seen_ids = set()

    # Process owned payments
    for p in owned_payments:
        if p.id in seen_ids:
            continue
        seen_ids.add(p.id)

        # Check if this is a payment received from a sharee (share_id not null on owner's bill)
        is_received_from_sharee = p.share_id is not None

        # For owner: received share payments are income (deposit), own payments follow bill type
        if is_received_from_sharee:
            # Payment from sharee - show as deposit/income for the owner
            effective_type = 'deposit'
        else:
            # Owner's own payment - use bill type (treat 'bill' as 'expense')
            effective_type = 'deposit' if p.bill.type == 'deposit' else 'expense'

        result.append({
            'id': p.id,
            'amount': p.amount,
            'payment_date': p.payment_date,
            'notes': p.notes,
            'bill_id': p.bill_id,
            'bill_name': p.bill.name,
            'bill_icon': p.bill.icon,
            'bill_type': effective_type,  # Use effective type for proper categorization
            'original_bill_type': p.bill.type,  # Keep original for reference
            'is_share_payment': is_received_from_sharee,
            'is_received_payment': is_received_from_sharee,  # True = money received from sharee
            'database_id': p.bill.database_id,
            'database_name': db_name_lookup.get(p.bill.database_id, 'Unknown')
        })

    # Process sharee's own share payments (their outgoing expenses)
    for p in shared_payments:
        if p.id in seen_ids:
            continue
        seen_ids.add(p.id)

        # For sharee: their share payments are expenses (money they paid out)
        effective_type = 'deposit' if p.bill.type == 'deposit' else 'expense'

        # Get database name for shared bill (may not be in user's accessible databases)
        shared_bill_db = db.session.get(Database, p.bill.database_id)
        shared_db_name = shared_bill_db.display_name if shared_bill_db else 'Unknown'

        result.append({
            'id': p.id,
            'amount': p.amount,
            'payment_date': p.payment_date,
            'notes': p.notes,
            'bill_id': p.bill_id,
            'bill_name': p.bill.name,
            'bill_icon': p.bill.icon,
            'bill_type': effective_type,
            'original_bill_type': p.bill.type,
            'is_share_payment': True,
            'is_received_payment': False,  # False = money paid out by sharee
            'database_id': p.bill.database_id,
            'database_name': shared_db_name
        })

    # Sort by payment date descending
    result.sort(key=lambda x: x['payment_date'], reverse=True)

    return jsonify({'success': True, 'data': result})

@api_v2_bp.route('/payments/<int:payment_id>', methods=['PUT'])
@limiter.limit("30 per minute")
@jwt_required
def jwt_update_payment(payment_id):
    """Update a payment (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    payment = db.get_or_404(Payment, payment_id)

    # Check access permissions
    if payment.share_id:
        # This is a share payment - only the sharee who made it can edit
        share = db.session.get(BillShare, payment.share_id)
        if not share or share.shared_with_user_id != g.jwt_user_id:
            return jsonify({'success': False, 'error': 'Cannot edit payments made by others'}), 403
    else:
        # Regular payment - must own the bill's database
        access = check_bill_access(payment.bill)
        if access is not True:
            return access

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    if 'amount' in data: payment.amount = data['amount']
    if 'payment_date' in data: payment.payment_date = data['payment_date']
    if 'notes' in data: payment.notes = data['notes']

    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Payment updated'}})

@api_v2_bp.route('/payments/<int:payment_id>', methods=['DELETE'])
@limiter.limit("30 per minute")
@jwt_required
def jwt_delete_payment(payment_id):
    """Delete a payment (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    payment = db.get_or_404(Payment, payment_id)

    # Check access permissions
    if payment.share_id:
        # This is a share payment - only the sharee who made it can delete
        share = db.session.get(BillShare, payment.share_id)
        if not share or share.shared_with_user_id != g.jwt_user_id:
            return jsonify({'success': False, 'error': 'Cannot delete payments made by others'}), 403
        # Also clear the recipient_paid_date on the share since we're deleting the payment
        share.recipient_paid_date = None
    else:
        # Regular payment - must own the bill's database
        access = check_bill_access(payment.bill)
        if access is not True:
            return access

    db.session.delete(payment)
    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Payment deleted'}})


# =============================================================================
# BILL SHARING ENDPOINTS (api_v2)
# =============================================================================

@api_v2_bp.route('/bills/<int:bill_id>/share', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required
def jwt_share_bill(bill_id):
    """
    Share a bill with another user.

    Self-hosted mode: Share by username (instant, no invite required)
    SaaS mode: Share by email (sends invitation email)
    """
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    # Validate bill ownership
    bill = db.get_or_404(Bill, bill_id)

    access = check_bill_access(bill)
    if access is not True:
        return access

    # Get share parameters
    identifier = data.get('shared_with', '').strip().lower()  # username or email
    split_type = data.get('split_type')  # None, 'percentage', 'fixed', 'equal'
    split_value = data.get('split_value')

    if not identifier:
        return jsonify({'success': False, 'error': 'shared_with (username or email) is required'}), 400

    # Validate split configuration
    if split_type:
        if split_type not in ('percentage', 'fixed', 'equal'):
            return jsonify({'success': False, 'error': 'Invalid split type'}), 400
        if split_type in ('percentage', 'fixed') and split_value is None:
            return jsonify({'success': False, 'error': f'Split value required for {split_type} split'}), 400
        if split_type == 'percentage' and (split_value < 0 or split_value > 100):
            return jsonify({'success': False, 'error': 'Percentage must be between 0 and 100'}), 400
        if split_type == 'fixed' and split_value < 0:
            return jsonify({'success': False, 'error': 'Fixed amount cannot be negative'}), 400

    # Check for existing active share
    existing = BillShare.query.filter_by(
        bill_id=bill_id,
        shared_with_identifier=identifier
    ).filter(BillShare.status.in_(['pending', 'accepted'])).first()

    if existing:
        return jsonify({'success': False, 'error': 'Bill already shared with this user'}), 400

    # Determine identifier type and handle accordingly
    if '@' in identifier:
        # Email-based sharing (works in both SaaS and self-hosted modes)
        identifier_type = 'email'
        invite_token = secrets.token_urlsafe(32) if is_saas() else None
        expires_at = datetime.datetime.now(datetime.timezone.utc) + timedelta(days=7) if is_saas() else None

        # Case-insensitive email lookup
        from sqlalchemy import func
        target_user = User.query.filter(func.lower(User.email) == identifier).first()
        shared_with_user_id = target_user.id if target_user else None
        status = 'pending'  # Email shares require acceptance
        accepted_at = None
    else:
        # Username-based sharing (requires acceptance)
        identifier_type = 'username'
        target_user = User.query.filter_by(username=identifier).first()

        if not target_user:
            return jsonify({'success': False, 'error': 'User not found'}), 404

        if target_user.id == g.jwt_user_id:
            return jsonify({'success': False, 'error': 'Cannot share with yourself'}), 400

        shared_with_user_id = target_user.id
        invite_token = None
        expires_at = None
        status = 'pending'  # Username shares also require acceptance
        accepted_at = None

    # Create the share
    share = BillShare(
        bill_id=bill_id,
        owner_user_id=g.jwt_user_id,
        shared_with_user_id=shared_with_user_id,
        shared_with_identifier=identifier,
        identifier_type=identifier_type,
        invite_token=invite_token,
        status=status,
        split_type=split_type,
        split_value=split_value,
        accepted_at=accepted_at,
        expires_at=expires_at
    )

    try:
        db.session.add(share)
        db.session.commit()

        # Audit log: Share created
        ShareAuditLog.log_action(
            action='created',
            bill_id=bill_id,
            actor_user_id=g.jwt_user_id,
            share_id=share.id,
            affected_user_id=shared_with_user_id,
            metadata={'identifier_type': identifier_type, 'split_type': split_type, 'split_value': split_value},
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent')
        )
    except Exception as e:
        db.session.rollback()
        logger.error(f"Failed to create bill share: {e}")
        return jsonify({'success': False, 'error': 'Failed to create share'}), 500

    # Send email invitation if SaaS and pending
    if is_saas() and status == 'pending' and EMAIL_ENABLED:
        try:
            from services.email import send_bill_share_email
            current_user = db.session.get(User, g.jwt_user_id)
            send_bill_share_email(identifier, invite_token, bill.name, current_user.username)
        except Exception as e:
            logger.warning(f"Failed to send share invitation email: {e}")

    return jsonify({
        'success': True,
        'data': {
            'id': share.id,
            'shared_with_identifier': share.shared_with_identifier,
            'identifier_type': share.identifier_type,
            'status': share.status,
            'split_type': share.split_type,
            'split_value': share.split_value,
            'created_at': share.created_at.isoformat() if share.created_at else None,
            'accepted_at': share.accepted_at.isoformat() if share.accepted_at else None,
            'message': 'Share created' if status == 'accepted' else 'Invitation sent'
        }
    }), 201


@api_v2_bp.route('/bills/<int:bill_id>/shares', methods=['GET'])
@limiter.limit("60 per minute")
@jwt_required
def jwt_get_bill_shares(bill_id):
    """Get all shares for a bill (owner view)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    bill = db.get_or_404(Bill, bill_id)

    access = check_bill_access(bill)
    if access is not True:
        return access

    # Security check: Only the database owner can view shares
    database = db.session.get(Database, bill.database_id)
    if not database or database.owner_id != g.jwt_user_id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    shares = BillShare.query.filter_by(bill_id=bill_id).all()

    # Security: Only return shares owned by the current user
    filtered_shares = [s for s in shares if s.owner_user_id == g.jwt_user_id]

    result = [{
        'id': s.id,
        'shared_with': s.shared_with_identifier,
        'identifier_type': s.identifier_type,
        'status': s.status,
        'split_type': s.split_type,
        'split_value': s.split_value,
        'created_at': s.created_at.isoformat() if s.created_at else None,
        'accepted_at': s.accepted_at.isoformat() if s.accepted_at else None
    } for s in filtered_shares]

    return jsonify({'success': True, 'data': result})


@api_v2_bp.route('/shares/<int:share_id>', methods=['DELETE'])
@limiter.limit("20 per minute")
@jwt_required
def jwt_revoke_share(share_id):
    """Revoke a bill share (owner only)."""
    share = db.get_or_404(BillShare, share_id)

    if share.owner_user_id != g.jwt_user_id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    share.status = 'revoked'
    db.session.commit()

    return jsonify({'success': True, 'data': {'message': 'Share revoked'}})


@api_v2_bp.route('/shared-bills', methods=['GET'])
@limiter.limit("60 per minute")
@jwt_required
def jwt_get_shared_bills():
    """Get bills shared with the current user."""
    # Find shares where current user is the recipient
    shares = BillShare.query.filter_by(
        shared_with_user_id=g.jwt_user_id,
        status='accepted'
    ).all()

    result = []
    for share in shares:
        bill = share.bill
        # Get latest payment for this bill
        latest_payment = Payment.query.filter_by(bill_id=bill.id).order_by(
            desc(Payment.payment_date)
        ).first()

        result.append({
            'share_id': share.id,
            'bill': {
                'id': bill.id,
                'name': bill.name,
                'amount': bill.amount,
                'next_due': bill.due_date,
                'icon': bill.icon,
                'type': bill.type,
                'frequency': bill.frequency,
                'is_variable': bill.is_variable,
                'auto_pay': bill.auto_pay
            },
            'owner': share.owner.username,
            'owner_id': share.owner_user_id,
            'split_type': share.split_type,
            'split_value': share.split_value,
            'my_portion': share.calculate_portion(),
            'last_payment': {
                'id': latest_payment.id,
                'amount': latest_payment.amount,
                'date': latest_payment.payment_date,
                'notes': latest_payment.notes
            } if latest_payment else None,
            'created_at': share.created_at.isoformat() if share.created_at else None
        })

    return jsonify({'success': True, 'data': result})


@api_v2_bp.route('/shared-bills/pending', methods=['GET'])
@limiter.limit("60 per minute")
@jwt_required
def jwt_get_pending_shares():
    """Get pending share invitations for the current user."""
    current_user = db.session.get(User, g.jwt_user_id)
    if not current_user:
        return jsonify({'success': True, 'data': []})

    # Optimize: Filter out expired shares at database level instead of in Python loop
    from sqlalchemy import or_
    shares = BillShare.query.filter(
        BillShare.shared_with_user_id == current_user.id,
        BillShare.status == 'pending'
    ).filter(
        or_(
            BillShare.expires_at.is_(None),
            BillShare.expires_at > datetime.datetime.now(datetime.timezone.utc)
        )
    ).all()

    result = []
    for share in shares:
        bill = share.bill
        result.append({
            'share_id': share.id,
            'bill_name': bill.name,
            'bill_amount': bill.amount,
            'owner': share.owner.username,
            'split_type': share.split_type,
            'split_value': share.split_value,
            'my_portion': share.calculate_portion(),
            'expires_at': share.expires_at.isoformat() if share.expires_at else None
        })

    return jsonify({'success': True, 'data': result})


@api_v2_bp.route('/shares/<int:share_id>/accept', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required
def jwt_accept_share(share_id):
    """Accept a pending share invitation."""
    share = db.get_or_404(BillShare, share_id)

    # Verify the current user can accept this share
    current_user = db.session.get(User, g.jwt_user_id)

    # Strict verification based on identifier type
    if share.identifier_type == 'username':
        # For username-based shares, must match the intended recipient (strict check)
        if not share.shared_with_user_id or share.shared_with_user_id != g.jwt_user_id:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
    elif share.identifier_type == 'email':
        # For email-based shares, check email match
        if not current_user.email or share.shared_with_identifier.lower() != current_user.email.lower():
            return jsonify({'success': False, 'error': 'Access denied'}), 403

    if share.status != 'pending':
        return jsonify({'success': False, 'error': f'Share is already {share.status}'}), 400

    if share.is_expired:
        return jsonify({'success': False, 'error': 'Share invitation has expired'}), 400

    # Accept the share
    share.status = 'accepted'
    share.shared_with_user_id = g.jwt_user_id
    share.accepted_at = datetime.datetime.now(datetime.timezone.utc)
    db.session.commit()

    # Audit log: Share accepted
    ShareAuditLog.log_action(
        action='accepted',
        bill_id=share.bill_id,
        actor_user_id=g.jwt_user_id,
        share_id=share.id,
        affected_user_id=share.owner_user_id,
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent')
    )

    return jsonify({'success': True, 'data': {'message': 'Share accepted'}})


@api_v2_bp.route('/shares/<int:share_id>/decline', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required
def jwt_decline_share(share_id):
    """Decline a pending share invitation."""
    share = db.get_or_404(BillShare, share_id)

    # Verify the current user can decline this share
    current_user = db.session.get(User, g.jwt_user_id)

    # Strict verification based on identifier type
    if share.identifier_type == 'username':
        # For username-based shares, must match the intended recipient (strict check)
        if not share.shared_with_user_id or share.shared_with_user_id != g.jwt_user_id:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
    elif share.identifier_type == 'email':
        # For email-based shares, check email match
        if not current_user.email or share.shared_with_identifier.lower() != current_user.email.lower():
            return jsonify({'success': False, 'error': 'Access denied'}), 403

    if share.status != 'pending':
        return jsonify({'success': False, 'error': f'Share is already {share.status}'}), 400

    share.status = 'declined'
    db.session.commit()

    # Audit log: Share declined
    ShareAuditLog.log_action(
        action='declined',
        bill_id=share.bill_id,
        actor_user_id=g.jwt_user_id,
        share_id=share.id,
        affected_user_id=share.owner_user_id,
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent')
    )

    return jsonify({'success': True, 'data': {'message': 'Share declined'}})


@api_v2_bp.route('/share-info', methods=['GET'])
@limiter.limit("20 per minute")
def jwt_get_share_info():
    """Get share invitation info by token (public endpoint for SaaS)."""
    token = request.args.get('token')
    if not token:
        return jsonify({'success': False, 'error': 'Token required'}), 400

    share = BillShare.query.filter_by(invite_token=token).first()
    if not share:
        return jsonify({'success': False, 'error': 'Invalid invitation'}), 404

    if share.status != 'pending':
        return jsonify({'success': False, 'error': f'Invitation already {share.status}'}), 400

    if share.is_expired:
        return jsonify({'success': False, 'error': 'Invitation has expired'}), 400

    return jsonify({
        'success': True,
        'data': {
            'bill_name': share.bill.name,
            'bill_amount': share.bill.amount,
            'owner': share.owner.username,
            'split_type': share.split_type,
            'split_value': share.split_value,
            'my_portion': share.calculate_portion(),
            'expires_at': share.expires_at.isoformat() if share.expires_at else None
        }
    })


@api_v2_bp.route('/share/accept-by-token', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required
def jwt_accept_share_by_token():
    """Accept a share invitation by token (for email-based invites)."""
    data = request.get_json(force=True, silent=True)
    if not data or not data.get('token'):
        return jsonify({'success': False, 'error': 'Token required'}), 400

    share = BillShare.query.filter_by(invite_token=data['token']).first()
    if not share:
        return jsonify({'success': False, 'error': 'Invalid invitation'}), 404

    if share.status != 'pending':
        return jsonify({'success': False, 'error': f'Invitation already {share.status}'}), 400

    if share.is_expired:
        return jsonify({'success': False, 'error': 'Invitation has expired'}), 400

    # Verify the current user matches the invitation
    current_user = db.session.get(User, g.jwt_user_id)

    # For email-based shares, verify email match
    if share.identifier_type == 'email':
        if not current_user.email or share.shared_with_identifier.lower() != current_user.email.lower():
            return jsonify({'success': False, 'error': 'This invitation was sent to a different email address'}), 403

    # For username-based shares, verify username match
    if share.identifier_type == 'username':
        if not share.shared_with_user_id or share.shared_with_user_id != g.jwt_user_id:
            return jsonify({'success': False, 'error': 'Access denied'}), 403

    # Accept the share
    share.status = 'accepted'
    share.shared_with_user_id = g.jwt_user_id
    share.accepted_at = datetime.datetime.now(datetime.timezone.utc)
    db.session.commit()

    return jsonify({'success': True, 'data': {'message': 'Share accepted', 'share_id': share.id}})


@api_v2_bp.route('/shares/<int:share_id>', methods=['PUT'])
@limiter.limit("20 per minute")
@jwt_required
def jwt_update_share(share_id):
    """Update share split configuration (owner only)."""
    share = db.get_or_404(BillShare, share_id)

    if share.owner_user_id != g.jwt_user_id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    # Update split configuration
    if 'split_type' in data:
        split_type = data['split_type']
        if split_type and split_type not in ('percentage', 'fixed', 'equal'):
            return jsonify({'success': False, 'error': 'Invalid split type'}), 400
        share.split_type = split_type

    if 'split_value' in data:
        split_value = data['split_value']
        if share.split_type == 'percentage' and split_value is not None:
            if split_value < 0 or split_value > 100:
                return jsonify({'success': False, 'error': 'Percentage must be between 0 and 100'}), 400
        if share.split_type == 'fixed' and split_value is not None:
            if split_value < 0:
                return jsonify({'success': False, 'error': 'Fixed amount cannot be negative'}), 400
        share.split_value = split_value

    db.session.commit()

    # Audit log: Share split configuration updated
    ShareAuditLog.log_action(
        action='updated',
        bill_id=share.bill_id,
        actor_user_id=g.jwt_user_id,
        share_id=share.id,
        affected_user_id=share.shared_with_user_id,
        metadata={'split_type': share.split_type, 'split_value': share.split_value},
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent')
    )

    return jsonify({'success': True, 'data': {'message': 'Share updated'}})


@api_v2_bp.route('/shares/<int:share_id>/leave', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required
def jwt_leave_share(share_id):
    """Leave a shared bill (recipient only)."""
    share = db.get_or_404(BillShare, share_id)

    if share.shared_with_user_id != g.jwt_user_id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    if share.status != 'accepted':
        return jsonify({'success': False, 'error': 'Share is not active'}), 400

    share.status = 'revoked'
    db.session.commit()

    # Audit log: Share revoked (recipient left)
    ShareAuditLog.log_action(
        action='revoked',
        bill_id=share.bill_id,
        actor_user_id=g.jwt_user_id,
        share_id=share.id,
        affected_user_id=share.owner_user_id,
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent')
    )

    return jsonify({'success': True, 'data': {'message': 'Left shared bill'}})


@api_v2_bp.route('/shares/<int:share_id>/mark-paid', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required
def jwt_mark_share_paid(share_id):
    """Mark recipient's portion of shared bill as paid and create payment record."""
    share = db.get_or_404(BillShare, share_id)

    # Only the share recipient can mark their portion as paid
    if share.shared_with_user_id != g.jwt_user_id:
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    if share.status != 'accepted':
        return jsonify({'success': False, 'error': 'Share is not active'}), 400

    payment_id = None

    # Toggle paid status
    if share.recipient_paid_date:
        # Already marked as paid, so unmark it - delete the associated payment
        existing_payment = Payment.query.filter_by(share_id=share.id).first()
        if existing_payment:
            db.session.delete(existing_payment)
        share.recipient_paid_date = None
        message = 'Marked as unpaid'
    else:
        # Mark as paid - create a payment record for tracking
        portion_amount = share.calculate_portion()
        if portion_amount is None:
            portion_amount = share.bill.amount or 0

        # Get recipient's username for the note
        recipient = db.session.get(User, g.jwt_user_id)
        recipient_name = recipient.username if recipient else 'Unknown'

        payment = Payment(
            bill_id=share.bill_id,
            amount=portion_amount,
            payment_date=datetime.date.today().isoformat(),
            notes=f"Share payment by {recipient_name}",
            share_id=share.id
        )
        db.session.add(payment)
        share.recipient_paid_date = datetime.datetime.now(datetime.timezone.utc)
        message = 'Marked as paid'
        db.session.flush()  # Get the payment ID
        payment_id = payment.id

    db.session.commit()

    return jsonify({
        'success': True,
        'data': {
            'message': message,
            'recipient_paid_date': share.recipient_paid_date.isoformat() if share.recipient_paid_date else None,
            'payment_id': payment_id
        }
    })


@api_v2_bp.route('/users/search', methods=['GET'])
@limiter.limit("20 per minute")
@jwt_required
def jwt_search_users():
    """Search for users by username (for sharing)."""
    query = request.args.get('q', '').strip().lower()
    if len(query) < 2:
        return jsonify({'success': True, 'data': []})

    # Escape SQL wildcards to prevent pattern-based enumeration attacks
    query_escaped = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')

    # Search users by username (exclude current user)
    users = User.query.filter(
        User.username.ilike(f'%{query_escaped}%', escape='\\'),
        User.id != g.jwt_user_id
    ).limit(10).all()

    result = [{'id': u.id, 'username': u.username} for u in users]
    return jsonify({'success': True, 'data': result})


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
    """Get monthly payment totals (JWT version), including shared bill payments."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    # Handle "all databases" mode
    result = resolve_accessible_db_ids()
    if not isinstance(result[0], list):
        return result  # Error response
    accessible_db_ids, _ = result

    # Get owner's own payments on their bills (share_id IS NULL = owner paid it themselves)
    owner_payments = db.session.query(
        func.to_char(func.to_date(Payment.payment_date, 'YYYY-MM-DD'), 'YYYY-MM').label('month'),
        func.sum(Payment.amount),
        Bill.type
    ).join(Bill).filter(
        Bill.database_id.in_(accessible_db_ids),
        Payment.share_id == None  # Owner's own payments
    ).group_by('month', Bill.type).all()

    # Get payments received FROM sharees on owner's bills (share_id IS NOT NULL = sharee paid)
    # These count as deposits/income for the owner
    received_from_sharees = db.session.query(
        func.to_char(func.to_date(Payment.payment_date, 'YYYY-MM-DD'), 'YYYY-MM').label('month'),
        func.sum(Payment.amount)
    ).join(Bill).filter(
        Bill.database_id.in_(accessible_db_ids),
        Payment.share_id != None  # Payments made by sharees
    ).group_by('month').all()

    # Get payments for shared bills where current user is the share recipient
    # These are expenses the sharee paid on bills shared with them
    sharee_payments = db.session.query(
        func.to_char(func.to_date(Payment.payment_date, 'YYYY-MM-DD'), 'YYYY-MM').label('month'),
        func.sum(Payment.amount),
        Bill.type
    ).join(Bill).join(
        BillShare, Payment.share_id == BillShare.id
    ).filter(
        BillShare.shared_with_user_id == g.jwt_user_id,
        BillShare.status == 'accepted'
    ).group_by('month', Bill.type).all()

    # Organize by month with expense/deposit breakdown
    monthly = {}

    # Process owner's own payments (categorize by bill type)
    # Note: bill types can be 'expense', 'bill', or 'deposit'
    # 'bill' type should be treated as an expense (something you pay)
    for r in owner_payments:
        month = r[0]
        if month not in monthly:
            monthly[month] = {'expenses': 0, 'deposits': 0}
        if r[2] == 'deposit':
            monthly[month]['deposits'] += float(r[1])
        else:
            # 'expense' and 'bill' types are both expenses
            monthly[month]['expenses'] += float(r[1])

    # Add payments received from sharees as deposits (income for the owner)
    for r in received_from_sharees:
        month = r[0]
        if month not in monthly:
            monthly[month] = {'expenses': 0, 'deposits': 0}
        monthly[month]['deposits'] += float(r[1])

    # Add sharee's own share payments as expenses (money they paid out)
    for r in sharee_payments:
        month = r[0]
        if month not in monthly:
            monthly[month] = {'expenses': 0, 'deposits': 0}
        if r[2] == 'deposit':
            monthly[month]['deposits'] += float(r[1])
        else:
            # 'expense' and 'bill' types are both expenses
            monthly[month]['expenses'] += float(r[1])

    return jsonify({'success': True, 'data': monthly})


@api_v2_bp.route('/stats/by-account', methods=['GET'])
@limiter.limit("60 per minute")
@jwt_required
def jwt_get_stats_by_account():
    """Get payment totals grouped by account."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    # Handle "all databases" mode
    result = resolve_accessible_db_ids()
    if not isinstance(result[0], list):
        return result  # Error response
    accessible_db_ids, _ = result

    # Get payments grouped by account
    results = db.session.query(
        Bill.account,
        func.sum(Payment.amount),
        Bill.type
    ).join(Payment).filter(
        Bill.database_id.in_(accessible_db_ids),
        Bill.account != None,
        Bill.account != ''
    ).group_by(Bill.account, Bill.type).all()

    # Organize by account
    by_account = {}
    for r in results:
        account = r[0] or 'Uncategorized'
        if account not in by_account:
            by_account[account] = {'expenses': 0, 'deposits': 0, 'total': 0}
        if r[2] == 'deposit':
            by_account[account]['deposits'] += float(r[1])
        else:
            by_account[account]['expenses'] += float(r[1])
        by_account[account]['total'] = by_account[account]['expenses'] - by_account[account]['deposits']

    # Convert to sorted list
    result = [
        {'account': k, **v}
        for k, v in sorted(by_account.items(), key=lambda x: x[1]['expenses'], reverse=True)
    ]

    return jsonify({'success': True, 'data': result})


@api_v2_bp.route('/stats/yearly', methods=['GET'])
@limiter.limit("60 per minute")
@jwt_required
def jwt_get_stats_yearly():
    """Get yearly payment totals for year-over-year comparison."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    # Handle "all databases" mode
    result = resolve_accessible_db_ids()
    if not isinstance(result[0], list):
        return result  # Error response
    accessible_db_ids, _ = result

    # Get payments grouped by year
    results = db.session.query(
        func.to_char(func.to_date(Payment.payment_date, 'YYYY-MM-DD'), 'YYYY').label('year'),
        func.sum(Payment.amount),
        Bill.type
    ).join(Bill).filter(
        Bill.database_id.in_(accessible_db_ids)
    ).group_by('year', Bill.type).all()

    # Organize by year
    by_year = {}
    for r in results:
        year = r[0]
        if year not in by_year:
            by_year[year] = {'expenses': 0, 'deposits': 0}
        if r[2] == 'deposit':
            by_year[year]['deposits'] += float(r[1])
        else:
            by_year[year]['expenses'] += float(r[1])

    return jsonify({'success': True, 'data': by_year})


@api_v2_bp.route('/stats/monthly-comparison', methods=['GET'])
@limiter.limit("60 per minute")
@jwt_required
def jwt_get_monthly_comparison():
    """Get monthly comparison between this year and last year."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    # Handle "all databases" mode
    result = resolve_accessible_db_ids()
    if not isinstance(result[0], list):
        return result  # Error response
    accessible_db_ids, _ = result

    current_year = datetime.date.today().year
    last_year = current_year - 1

    # Get payments for current year and last year, grouped by month
    results = db.session.query(
        func.to_char(func.to_date(Payment.payment_date, 'YYYY-MM-DD'), 'YYYY').label('year'),
        func.to_char(func.to_date(Payment.payment_date, 'YYYY-MM-DD'), 'MM').label('month'),
        func.sum(Payment.amount),
        Bill.type
    ).join(Bill).filter(
        Bill.database_id.in_(accessible_db_ids),
        func.to_char(func.to_date(Payment.payment_date, 'YYYY-MM-DD'), 'YYYY').in_([str(current_year), str(last_year)])
    ).group_by('year', 'month', Bill.type).all()

    # Organize by month with year comparison
    monthly = {}
    for r in results:
        year = r[0]
        month = r[1]
        if month not in monthly:
            monthly[month] = {
                'month': month,
                'current_year_expenses': 0,
                'current_year_deposits': 0,
                'last_year_expenses': 0,
                'last_year_deposits': 0,
            }
        is_current = year == str(current_year)
        if r[3] == 'deposit':
            if is_current:
                monthly[month]['current_year_deposits'] += float(r[2])
            else:
                monthly[month]['last_year_deposits'] += float(r[2])
        else:
            if is_current:
                monthly[month]['current_year_expenses'] += float(r[2])
            else:
                monthly[month]['last_year_expenses'] += float(r[2])

    # Convert to sorted list (by month)
    result = sorted(monthly.values(), key=lambda x: x['month'])

    return jsonify({
        'success': True,
        'data': {
            'current_year': current_year,
            'last_year': last_year,
            'months': result
        }
    })


@api_v2_bp.route('/process-auto-payments', methods=['POST'])
@jwt_required
def jwt_process_auto_payments():
    """Process auto-payments for bills due today or earlier (JWT version)."""
    if not g.jwt_db_name:
        return jsonify({'success': False, 'error': 'X-Database header required'}), 400

    today = datetime.date.today().isoformat()
    user = db.session.get(User, g.jwt_user_id)

    # Handle all-buckets mode - process auto-payments across all accessible databases
    result = resolve_accessible_db_ids()
    if not isinstance(result[0], list):
        return result  # Error response
    accessible_db_ids, _ = result

    auto_bills = Bill.query.filter(
        Bill.database_id.in_(accessible_db_ids),
        Bill.auto_pay == True,
        Bill.archived == False,
        Bill.due_date <= today
    ).all()

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
@limiter.limit("20 per minute;60 per hour")
def jwt_change_password():
    """Change password (for users with password_change_required or via change_token)."""
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

    change_token = data.get('change_token')
    new_password = data.get('new_password')

    if not change_token or not new_password:
        return jsonify({'success': False, 'error': 'change_token and new_password are required'}), 400

    is_valid, error = validate_password(new_password)
    if not is_valid:
        return jsonify({'success': False, 'error': error}), 400

    user = User.query.filter_by(change_token=change_token).first()
    if not user:
        return jsonify({'success': False, 'error': 'Invalid change token'}), 401
    if user.change_token_expires:
        expiry = (
            user.change_token_expires.replace(tzinfo=datetime.timezone.utc)
            if user.change_token_expires.tzinfo is None else user.change_token_expires
        )
        if expiry < datetime.datetime.now(datetime.timezone.utc):
            return jsonify({'success': False, 'error': 'Change token expired'}), 401

    user.set_password(new_password)
    user.password_change_required = False
    user.change_token = None
    user.change_token_expires = None
    db.session.commit()

    # Optionally auto-login after password change
    access_token = create_access_token(user.id, user.role)
    refresh_token = create_refresh_token(user.id, data.get('device_info'))
    databases = [{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases]

    response = jsonify({
        'success': True,
        'data': {
            'message': 'Password changed successfully',
            'access_token': access_token,
            'refresh_token': refresh_token,
            'expires_in': int(JWT_ACCESS_TOKEN_EXPIRES.total_seconds()),
            'token_type': 'Bearer',  # nosec B105
            'user': {'id': user.id, 'username': user.username, 'role': user.role},
            'databases': databases
        }
    })
    return _set_refresh_cookie(response, refresh_token)

# ============ OIDC / OAuth Routes ============

# Cache for OIDC discovery metadata (provider -> (metadata_dict, fetched_at))
_oidc_metadata_cache = {}
_OIDC_CACHE_TTL = 3600  # 1 hour

# Cache for JWKS keys (provider -> (jwks_dict, fetched_at))
_jwks_cache = {}
_JWKS_CACHE_TTL = 3600  # 1 hour

# Used OAuth state nonces to prevent replay (nonce -> expiry_timestamp)
_used_oauth_nonces = {}
_NONCE_CLEANUP_INTERVAL = 300  # Clean up expired nonces every 5 minutes
_nonce_last_cleanup = 0

def _get_oidc_metadata(provider_key):
    """Fetch and cache OIDC discovery metadata for a provider."""
    import time
    import requests as http_requests

    cached = _oidc_metadata_cache.get(provider_key)
    if cached and (time.time() - cached[1]) < _OIDC_CACHE_TTL:
        return cached[0]

    cfg = OAUTH_PROVIDERS.get(provider_key)
    if not cfg or not cfg.get('discovery_url'):
        return None

    try:
        resp = http_requests.get(cfg['discovery_url'], timeout=10)
        resp.raise_for_status()
        metadata = resp.json()
        _oidc_metadata_cache[provider_key] = (metadata, time.time())
        return metadata
    except Exception as e:
        logger.error(f"Failed to fetch OIDC metadata for {provider_key}: {e}")
        return None


def _get_jwks(provider_key):
    """Fetch and cache JWKS (JSON Web Key Set) for a provider."""
    import time
    import requests as http_requests

    cached = _jwks_cache.get(provider_key)
    if cached and (time.time() - cached[1]) < _JWKS_CACHE_TTL:
        return cached[0]

    metadata = _get_oidc_metadata(provider_key)
    if not metadata or not metadata.get('jwks_uri'):
        return None

    try:
        resp = http_requests.get(metadata['jwks_uri'], timeout=10)
        resp.raise_for_status()
        jwks = resp.json()
        _jwks_cache[provider_key] = (jwks, time.time())
        return jwks
    except Exception as e:
        logger.error(f"Failed to fetch JWKS for {provider_key}: {e}")
        return None


def _cleanup_used_nonces():
    """Remove expired nonces from the used set."""
    import time
    global _nonce_last_cleanup
    now = time.time()
    if now - _nonce_last_cleanup < _NONCE_CLEANUP_INTERVAL:
        return
    _nonce_last_cleanup = now
    expired = [n for n, exp in _used_oauth_nonces.items() if exp < now]
    for n in expired:
        del _used_oauth_nonces[n]


def _generate_oauth_state(provider, code_verifier, nonce, flow='login', link_user_id=None):
    """Generate encrypted state parameter as signed JWT.

    The nonce is included so it can be validated in the ID token callback.
    A separate state_nonce prevents replay of the state token itself.
    """
    state_nonce = secrets.token_hex(16)
    state_payload = {
        'provider': provider,
        'flow': flow,
        'state_nonce': state_nonce,
        'id_token_nonce': nonce,
        'code_verifier': code_verifier,
        'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5),
        'iat': datetime.datetime.now(datetime.timezone.utc),
        'type': 'oauth_state',
    }
    if link_user_id is not None:
        state_payload['link_user_id'] = link_user_id
    return jwt.encode(state_payload, JWT_SECRET_KEY, algorithm='HS256')


def _verify_oauth_state(state_token):
    """Verify and decode the OAuth state parameter.

    Also checks that the state_nonce has not been used before (replay prevention).
    """
    import time
    _cleanup_used_nonces()

    try:
        payload = jwt.decode(state_token, JWT_SECRET_KEY, algorithms=['HS256'])
        if payload.get('type') != 'oauth_state':
            return None

        # Check state_nonce for replay (CRITICAL-5)
        state_nonce = payload.get('state_nonce')
        if not state_nonce:
            return None
        if state_nonce in _used_oauth_nonces:
            logger.warning(f"Replayed OAuth state nonce detected: {state_nonce[:8]}...")
            return None

        # Mark nonce as used (expires after 10 minutes to allow cleanup)
        _used_oauth_nonces[state_nonce] = time.time() + 600

        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def _resolve_oauth_user(provider, provider_user_id, email, profile_data=None):
    """Resolve or create a user from OIDC claims.

    Resolution order:
    1. Find existing OAuthAccount link -> return that user
    2. Find existing user with matching verified email -> auto-link
    3. Auto-register new user (OIDC-only, no password)

    Returns (user, is_new_user, error_message)
    """
    # 1. Check for existing OAuth link
    oauth_account = OAuthAccount.query.filter_by(
        provider=provider,
        provider_user_id=provider_user_id
    ).first()

    if oauth_account:
        user = db.session.get(User, oauth_account.user_id)
        if user:
            # Update profile data
            if profile_data:
                oauth_account.profile_data = json.dumps(profile_data)
                oauth_account.provider_email = email
                db.session.commit()
            return user, False, None
        # Orphaned OAuth account - clean up
        db.session.delete(oauth_account)
        db.session.commit()

    # 2. Auto-link by verified email
    if email:
        existing_user = User.query.filter(
            db.func.lower(User.email) == email.lower()
        ).first()
        if existing_user:
            # Only auto-link if email is verified (prevent takeover)
            if existing_user.email_verified_at:
                new_link = OAuthAccount(
                    user_id=existing_user.id,
                    provider=provider,
                    provider_user_id=provider_user_id,
                    provider_email=email,
                    profile_data=json.dumps(profile_data) if profile_data else None,
                )
                db.session.add(new_link)
                db.session.commit()
                return existing_user, False, None
            else:
                return None, False, 'An account with this email exists but is not verified. Please verify your email first or log in with your password.'

    # 3. Auto-register new user (HIGH-4: check if auto-registration is allowed)
    if not OAUTH_AUTO_REGISTER:
        return None, False, 'Account not found. Contact your administrator.'

    # Generate a unique username from email or provider info
    base_username = email.split('@')[0] if email else f'{provider}_user'
    username = base_username
    counter = 1
    while User.query.filter_by(username=username).first():
        username = f'{base_username}{counter}'
        counter += 1

    new_user = User(
        username=username,
        email=email,
        password_hash=None,  # OIDC-only user
        auth_provider=provider,
        role='admin',  # Account owner
        email_verified_at=datetime.datetime.now(datetime.timezone.utc),  # OIDC emails are pre-verified
    )
    db.session.add(new_user)
    db.session.flush()  # Get user.id

    # Create default database for new user
    db_name = f'db_{new_user.id}'
    new_db = Database(
        name=db_name,
        display_name='Personal',
        description='My bills and finances',
        owner_id=new_user.id,
    )
    db.session.add(new_db)
    db.session.flush()
    new_user.accessible_databases.append(new_db)

    # Link OAuth account
    new_link = OAuthAccount(
        user_id=new_user.id,
        provider=provider,
        provider_user_id=provider_user_id,
        provider_email=email,
        profile_data=json.dumps(profile_data) if profile_data else None,
    )
    db.session.add(new_link)
    db.session.commit()

    return new_user, True, None


@api_v2_bp.route('/auth/oauth/providers', methods=['GET'])
def oauth_list_providers():
    """List enabled OAuth/OIDC providers with display names and icons."""
    enabled = get_enabled_oauth_providers()
    providers = []
    for p in enabled:
        cfg = OAUTH_PROVIDERS[p]
        providers.append({
            'id': p,
            'display_name': cfg['display_name'],
            'icon': cfg['icon'],
        })
    return jsonify({'success': True, 'data': providers})


@api_v2_bp.route('/auth/oauth/<provider>/authorize', methods=['GET'])
@limiter.limit("20 per minute")
def oauth_authorize(provider):
    """Redirect browser to OIDC provider authorization URL (web flow)."""
    if provider not in get_enabled_oauth_providers():
        return jsonify({'success': False, 'error': f'Provider "{provider}" is not enabled'}), 400

    flow = request.args.get('flow', 'login')
    link_user_id = None
    if flow == 'link':
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'success': False, 'error': 'Authentication required for account linking'}), 401
        token = auth_header.split(' ')[1]
        payload = verify_access_token(token)
        if not payload:
            return jsonify({'success': False, 'error': 'Invalid or expired token'}), 401
        link_user_id = payload['user_id']

    cfg = OAUTH_PROVIDERS[provider]
    metadata = _get_oidc_metadata(provider)
    if not metadata:
        return jsonify({'success': False, 'error': 'Failed to fetch provider configuration'}), 502

    # Generate PKCE code verifier and challenge
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = hashlib.sha256(code_verifier.encode()).digest()
    import base64
    code_challenge_b64 = base64.urlsafe_b64encode(code_challenge).rstrip(b'=').decode()

    # Generate nonce for ID token validation (HIGH-2)
    id_token_nonce = secrets.token_hex(16)

    # Generate state token (includes nonce for later validation)
    state = _generate_oauth_state(
        provider,
        code_verifier,
        id_token_nonce,
        flow=flow,
        link_user_id=link_user_id,
    )

    # Build authorization URL
    auth_endpoint = metadata.get('authorization_endpoint')
    if not auth_endpoint:
        return jsonify({'success': False, 'error': 'Provider missing authorization endpoint'}), 502

    from urllib.parse import urlencode
    app_url = os.environ.get('APP_URL', 'http://localhost:5173')
    redirect_uri = f'{app_url}/auth/callback'

    params = {
        'response_type': 'code',
        'client_id': cfg['client_id'],
        'redirect_uri': redirect_uri,
        'scope': cfg['scopes'],
        'state': state,
        'code_challenge': code_challenge_b64,
        'code_challenge_method': 'S256',
        'nonce': id_token_nonce,
    }

    # Use query callback mode so browser returns to SPA route with GET.
    if provider == 'apple':
        params['response_mode'] = 'query'

    auth_url = f'{auth_endpoint}?{urlencode(params)}'
    return jsonify({'success': True, 'data': {'auth_url': auth_url, 'state': state}})


@api_v2_bp.route('/auth/oauth/<provider>/callback', methods=['POST'])
@limiter.limit("20 per minute")
def oauth_callback(provider):
    """Exchange authorization code for tokens and resolve user.

    Frontend sends: { code, state }
    Returns: JWT tokens or 2FA challenge.
    """
    if provider not in get_enabled_oauth_providers():
        return jsonify({'success': False, 'error': f'Provider "{provider}" is not enabled'}), 400

    data = request.get_json(force=True, silent=True) or {}
    code = data.get('code')
    state = data.get('state')

    if not code or not state:
        return jsonify({'success': False, 'error': 'Missing code or state'}), 400

    # Verify state token
    state_payload = _verify_oauth_state(state)
    if not state_payload:
        return jsonify({'success': False, 'error': 'Invalid or expired state'}), 400

    if state_payload.get('provider') != provider:
        return jsonify({'success': False, 'error': 'State provider mismatch'}), 400

    code_verifier = state_payload.get('code_verifier')
    cfg = OAUTH_PROVIDERS[provider]
    metadata = _get_oidc_metadata(provider)
    if not metadata:
        return jsonify({'success': False, 'error': 'Failed to fetch provider configuration'}), 502

    # Exchange code for tokens
    token_endpoint = metadata.get('token_endpoint')
    if not token_endpoint:
        return jsonify({'success': False, 'error': 'Provider missing token endpoint'}), 502

    import requests as http_requests
    app_url = os.environ.get('APP_URL', 'http://localhost:5173')
    redirect_uri = f'{app_url}/auth/callback'

    token_data = {
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': redirect_uri,
        'client_id': cfg['client_id'],
        'code_verifier': code_verifier,
    }

    # Apple uses client_secret differently (JWT-based), but for now use standard flow
    if cfg.get('client_secret'):
        token_data['client_secret'] = cfg['client_secret']

    try:
        token_resp = http_requests.post(token_endpoint, data=token_data, timeout=10)
        token_resp.raise_for_status()
        token_json = token_resp.json()
    except Exception as e:
        logger.error(f"OAuth token exchange failed for {provider}: {e}")
        return jsonify({'success': False, 'error': 'Failed to exchange authorization code'}), 502

    id_token = token_json.get('id_token')
    if not id_token:
        return jsonify({'success': False, 'error': 'No ID token in provider response'}), 502

    # Decode and validate ID token with JWKS signature verification (CRITICAL-1)
    try:
        from authlib.jose import JsonWebKey, jwt as authlib_jwt

        # Fetch JWKS for signature verification
        jwks_data = _get_jwks(provider)
        if not jwks_data:
            return jsonify({'success': False, 'error': 'Failed to fetch provider signing keys'}), 502

        jwk_set = JsonWebKey.import_key_set(jwks_data)

        # Decode and verify signature using provider's public keys
        claims = authlib_jwt.decode(id_token, jwk_set)
        claims.validate()  # Validates exp, iat, nbf

        # Validate issuer
        expected_issuer = metadata.get('issuer')
        if claims.get('iss') != expected_issuer:
            return jsonify({'success': False, 'error': 'ID token issuer mismatch'}), 401

        # Validate audience
        aud = claims.get('aud')
        if isinstance(aud, list):
            if cfg['client_id'] not in aud:
                return jsonify({'success': False, 'error': 'ID token audience mismatch'}), 401
        elif aud != cfg['client_id']:
            return jsonify({'success': False, 'error': 'ID token audience mismatch'}), 401

        # Validate nonce matches what we sent in the authorize request (HIGH-2)
        expected_nonce = state_payload.get('id_token_nonce')
        if expected_nonce and claims.get('nonce') != expected_nonce:
            return jsonify({'success': False, 'error': 'ID token nonce mismatch'}), 401

    except Exception as e:
        logger.error(f"ID token verification failed for {provider}: {e}")
        return jsonify({'success': False, 'error': 'Failed to verify ID token'}), 502

    email_verified_claim = claims.get('email_verified')
    if claims.get('email') is not None:
        is_email_verified = False
        if isinstance(email_verified_claim, bool):
            is_email_verified = email_verified_claim
        elif isinstance(email_verified_claim, int):
            is_email_verified = email_verified_claim == 1
        elif isinstance(email_verified_claim, str):
            is_email_verified = email_verified_claim.strip().lower() in ('true', '1', 'yes')
        if not is_email_verified:
            return jsonify({'success': False, 'error': 'Provider email is not verified'}), 401

    # Extract user info from claims
    provider_user_id = claims.get('sub')
    email = claims.get('email', '').strip().lower() if claims.get('email') else None  # HIGH-3: normalize email
    profile_data = {
        'name': claims.get('name'),
        'given_name': claims.get('given_name'),
        'family_name': claims.get('family_name'),
        'picture': claims.get('picture'),
    }

    if not provider_user_id:
        return jsonify({'success': False, 'error': 'No subject in ID token'}), 502

    # Link flow: bind provider to an existing authenticated account
    flow = state_payload.get('flow', 'login')
    if flow == 'link':
        link_user_id = state_payload.get('link_user_id')
        link_user = db.session.get(User, link_user_id) if link_user_id else None
        if not link_user:
            return jsonify({'success': False, 'error': 'Invalid link session'}), 400

        existing_provider_link = OAuthAccount.query.filter_by(
            provider=provider,
            provider_user_id=provider_user_id
        ).first()
        if existing_provider_link and existing_provider_link.user_id != link_user.id:
            return jsonify({'success': False, 'error': 'This social account is already linked to another user'}), 409

        account_for_user_provider = OAuthAccount.query.filter_by(
            user_id=link_user.id,
            provider=provider
        ).first()
        if account_for_user_provider:
            account_for_user_provider.provider_user_id = provider_user_id
            account_for_user_provider.provider_email = email
            account_for_user_provider.profile_data = json.dumps(profile_data) if profile_data else None
        else:
            db.session.add(OAuthAccount(
                user_id=link_user.id,
                provider=provider,
                provider_user_id=provider_user_id,
                provider_email=email,
                profile_data=json.dumps(profile_data) if profile_data else None,
            ))
        db.session.commit()
        user = link_user
        is_new_user = False
    else:
        # Resolve or create user
        user, is_new_user, error = _resolve_oauth_user(provider, provider_user_id, email, profile_data)
        if error:
            return jsonify({'success': False, 'error': error}), 409

        if not user:
            return jsonify({'success': False, 'error': 'Failed to resolve user'}), 500

    # Check if 2FA is enabled for this user
    if flow != 'link' and user.twofa_config and user.twofa_config.is_enabled:
        # Create 2FA challenge session
        session_token = secrets.token_urlsafe(32)
        session_hash = hashlib.sha256(session_token.encode()).hexdigest()

        challenge = TwoFAChallenge(
            user_id=user.id,
            token_hash=session_hash,
            challenge_type='pending',
            expires_at=_naive_utcnow() + datetime.timedelta(minutes=10),
        )
        db.session.add(challenge)
        db.session.commit()

        methods = []
        if user.twofa_config.email_otp_enabled:
            methods.append('email_otp')
        if user.twofa_config.passkey_enabled:
            methods.append('passkey')
        methods.append('recovery')

        return jsonify({
            'success': False,
            'twofa_required': True,
            'twofa_session_token': session_token,
            'twofa_methods': methods,
        }), 403

    # Issue JWT tokens
    access_token = create_access_token(user.id, user.role)
    refresh_token = create_refresh_token(user.id, data.get('device_info'))
    databases = [{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases]

    response = jsonify({
        'success': True,
        'data': {
            'access_token': access_token,
            'refresh_token': refresh_token,
            'expires_in': int(JWT_ACCESS_TOKEN_EXPIRES.total_seconds()),
            'token_type': 'Bearer',  # nosec B105
            'user': {
                'id': user.id,
                'username': user.username,
                'role': user.role,
                'is_new_user': is_new_user,
            },
            'databases': databases,
        }
    })
    return _set_refresh_cookie(response, refresh_token)


@api_v2_bp.route('/auth/oauth/accounts', methods=['GET'])
@jwt_required
def oauth_list_accounts():
    """List the current user's linked OAuth provider accounts."""
    accounts = OAuthAccount.query.filter_by(user_id=g.jwt_user_id).all()
    return jsonify({
        'success': True,
        'data': [{
            'id': a.id,
            'provider': a.provider,
            'provider_email': a.provider_email,
            'created_at': a.created_at.isoformat() if a.created_at else None,
        } for a in accounts]
    })


@api_v2_bp.route('/auth/oauth/<provider>', methods=['DELETE'])
@jwt_required
def oauth_unlink_provider(provider):
    """Unlink an OAuth provider from the current user's account."""
    user = db.session.get(User, g.jwt_user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    account = OAuthAccount.query.filter_by(
        user_id=g.jwt_user_id,
        provider=provider
    ).first()

    if not account:
        return jsonify({'success': False, 'error': f'No {provider} account linked'}), 404

    # Prevent unlinking if user has no password (would lock them out)
    if not user.password_hash:
        other_accounts = OAuthAccount.query.filter(
            OAuthAccount.user_id == g.jwt_user_id,
            OAuthAccount.provider != provider
        ).count()
        if other_accounts == 0:
            return jsonify({
                'success': False,
                'error': 'Cannot unlink your only login method. Set a password first.'
            }), 400

    db.session.delete(account)
    db.session.commit()

    return jsonify({'success': True, 'data': {'message': f'{provider} account unlinked'}})


# ============ Two-Factor Authentication Routes ============

def _naive_utcnow():
    """Return current UTC time as a naive datetime (no tzinfo).

    PostgreSQL 'timestamp without time zone' columns store naive datetimes.
    psycopg3 converts timezone-aware datetimes to server-local time before
    storing, which causes expiry comparisons to break when the DB server
    is in a different timezone from UTC. Using naive UTC datetimes avoids
    this conversion.
    """
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


def _verify_2fa_session(token):
    """Verify a 2FA session token. Returns (challenge, error_response).

    Returns remaining attempts in error response to help clients show feedback (HIGH-1).
    Protection layers: max_attempts=5 per challenge, rate limiter 5/min per IP on verify endpoint.
    """
    if not token:
        return None, (jsonify({'success': False, 'error': 'Missing 2FA session token'}), 400)

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    challenge = TwoFAChallenge.query.filter_by(token_hash=token_hash).first()

    if not challenge:
        return None, (jsonify({'success': False, 'error': 'Invalid or expired 2FA session'}), 401)

    if challenge.is_expired:
        return None, (jsonify({'success': False, 'error': '2FA session expired. Please log in again.'}), 401)

    if challenge.used:
        return None, (jsonify({'success': False, 'error': '2FA session already used'}), 401)

    if challenge.attempts >= challenge.max_attempts:
        return None, (jsonify({
            'success': False,
            'error': 'Too many failed attempts. Please log in again.',
            'locked': True,
        }), 429)

    return challenge, None


@api_v2_bp.route('/auth/2fa/status', methods=['GET'])
@jwt_required
def twofa_status():
    """Get the current user's 2FA configuration status."""
    user = db.session.get(User, g.jwt_user_id)
    config = user.twofa_config

    passkeys = []
    if config and config.passkey_enabled:
        creds = WebAuthnCredential.query.filter_by(user_id=g.jwt_user_id).all()
        passkeys = [{
            'id': c.id,
            'device_name': c.device_name,
            'created_at': c.created_at.isoformat() if c.created_at else None,
            'last_used_at': c.last_used_at.isoformat() if c.last_used_at else None,
        } for c in creds]

    return jsonify({
        'success': True,
        'data': {
            'enabled': config.is_enabled if config else False,
            'email_otp_enabled': config.email_otp_enabled if config else False,
            'passkey_enabled': config.passkey_enabled if config else False,
            'passkeys': passkeys,
            'has_recovery_codes': bool(config.recovery_codes_hash) if config else False,
        }
    })


@api_v2_bp.route('/auth/2fa/setup/email', methods=['POST'])
@jwt_required
@limiter.limit("10 per minute")
def twofa_setup_email():
    """Enable email OTP 2FA - sends a test code to verify email works."""
    user = db.session.get(User, g.jwt_user_id)
    if not user.email:
        return jsonify({'success': False, 'error': 'You must have an email address to enable email OTP'}), 400

    # Generate a 6-digit code using cryptographic randomness (CRITICAL-2)
    code = str(secrets.randbelow(900000) + 100000)
    code_hash = generate_password_hash(code)

    # Store as a challenge
    session_token = secrets.token_urlsafe(32)
    session_hash = hashlib.sha256(session_token.encode()).hexdigest()

    challenge = TwoFAChallenge(
        user_id=user.id,
        token_hash=session_hash,
        challenge_type='email_otp_setup',
        otp_code_hash=code_hash,
        expires_at=_naive_utcnow() + datetime.timedelta(minutes=10),
    )
    db.session.add(challenge)
    db.session.commit()

    # Send the code via email
    from services.email import send_2fa_code_email
    sent = send_2fa_code_email(user.email, code, user.username)
    if not sent:
        return jsonify({'success': False, 'error': 'Failed to send verification code. Check email configuration.'}), 502

    return jsonify({
        'success': True,
        'data': {
            'message': 'Verification code sent to your email',
            'setup_token': session_token,
        }
    })


@api_v2_bp.route('/auth/2fa/setup/email/confirm', methods=['POST'])
@jwt_required
@limiter.limit("5 per minute")
def twofa_setup_email_confirm():
    """Confirm email OTP setup with the test code."""
    data = request.get_json(force=True, silent=True) or {}
    setup_token = data.get('setup_token')
    code = data.get('code')

    if not setup_token or not code:
        return jsonify({'success': False, 'error': 'Missing setup_token or code'}), 400

    challenge, err = _verify_2fa_session(setup_token)
    if err:
        return err

    if challenge.user_id != g.jwt_user_id:
        return jsonify({'success': False, 'error': 'Invalid session'}), 403

    if challenge.challenge_type != 'email_otp_setup':
        return jsonify({'success': False, 'error': 'Invalid challenge type'}), 400

    # Verify code
    from werkzeug.security import check_password_hash as check_hash
    if not check_hash(challenge.otp_code_hash, code):
        challenge.attempts += 1
        db.session.commit()
        return jsonify({'success': False, 'error': 'Invalid verification code'}), 400

    # Mark challenge as used
    challenge.used = True

    # Enable email OTP for this user
    config = TwoFAConfig.query.filter_by(user_id=g.jwt_user_id).first()
    if not config:
        config = TwoFAConfig(user_id=g.jwt_user_id)
        db.session.add(config)
    config.email_otp_enabled = True
    db.session.commit()

    # Generate recovery codes if not already present
    recovery_codes = None
    if not config.recovery_codes_hash:
        recovery_codes = _generate_recovery_codes(config)

    return jsonify({
        'success': True,
        'data': {
            'message': 'Email OTP 2FA enabled successfully',
            'recovery_codes': recovery_codes,
        }
    })


def _generate_recovery_codes(twofa_config, count=10):
    """Generate and store recovery codes. Returns plaintext codes (show once)."""
    codes = [secrets.token_hex(4).upper() for _ in range(count)]  # 8-char hex codes
    hashes = [generate_password_hash(c) for c in codes]
    twofa_config.recovery_codes_hash = json.dumps(hashes)
    db.session.commit()
    return codes


@api_v2_bp.route('/auth/2fa/recovery-codes', methods=['GET'])
@jwt_required
def twofa_get_recovery_codes():
    """Regenerate recovery codes. Old codes are invalidated."""
    config = TwoFAConfig.query.filter_by(user_id=g.jwt_user_id).first()
    if not config or not config.is_enabled:
        return jsonify({'success': False, 'error': '2FA is not enabled'}), 400

    codes = _generate_recovery_codes(config)
    return jsonify({
        'success': True,
        'data': {'recovery_codes': codes}
    })


@api_v2_bp.route('/auth/2fa/setup/passkey/options', methods=['POST'])
@jwt_required
def twofa_passkey_registration_options():
    """Get WebAuthn registration options for adding a passkey."""
    if not ENABLE_PASSKEYS:
        return jsonify({'success': False, 'error': 'Passkeys are not enabled'}), 400

    from webauthn import generate_registration_options, options_to_json
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria,
        ResidentKeyRequirement,
        UserVerificationRequirement,
        PublicKeyCredentialDescriptor,
    )
    import base64

    user = db.session.get(User, g.jwt_user_id)

    # Get existing credentials to exclude
    existing_creds = WebAuthnCredential.query.filter_by(user_id=g.jwt_user_id).all()
    exclude_creds = []
    for c in existing_creds:
        exclude_creds.append(PublicKeyCredentialDescriptor(
            id=base64.urlsafe_b64decode(c.credential_id + '=='),
            transports=json.loads(c.transports) if c.transports else [],
        ))

    options = generate_registration_options(
        rp_id=WEBAUTHN_RP_ID,
        rp_name=WEBAUTHN_RP_NAME,
        user_id=str(user.id).encode(),
        user_name=user.username,
        user_display_name=user.username,
        exclude_credentials=exclude_creds,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )

    # Store challenge in session for verification
    options_json = json.loads(options_to_json(options))

    # Store the challenge
    session_token = secrets.token_urlsafe(32)
    session_hash = hashlib.sha256(session_token.encode()).hexdigest()
    challenge_b64 = options_json['challenge']

    twofa_challenge = TwoFAChallenge(
        user_id=user.id,
        token_hash=session_hash,
        challenge_type='passkey_registration',
        otp_code_hash=challenge_b64,  # Store the challenge for verification
        expires_at=_naive_utcnow() + datetime.timedelta(minutes=5),
    )
    db.session.add(twofa_challenge)
    db.session.commit()

    return jsonify({
        'success': True,
        'data': {
            'options': options_json,
            'registration_token': session_token,
        }
    })


@api_v2_bp.route('/auth/2fa/setup/passkey/register', methods=['POST'])
@jwt_required
def twofa_passkey_register():
    """Complete passkey registration with the attestation response."""
    if not ENABLE_PASSKEYS:
        return jsonify({'success': False, 'error': 'Passkeys are not enabled'}), 400

    from webauthn import verify_registration_response
    from webauthn.helpers.structs import RegistrationCredential
    import base64

    data = request.get_json(force=True, silent=True) or {}
    registration_token = data.get('registration_token')
    credential = data.get('credential')
    device_name = data.get('device_name', 'Security Key')

    if not registration_token or not credential:
        return jsonify({'success': False, 'error': 'Missing registration_token or credential'}), 400

    challenge, err = _verify_2fa_session(registration_token)
    if err:
        return err

    if challenge.user_id != g.jwt_user_id or challenge.challenge_type != 'passkey_registration':
        return jsonify({'success': False, 'error': 'Invalid registration session'}), 403

    expected_challenge = base64.urlsafe_b64decode(challenge.otp_code_hash + '==')

    try:
        registration = RegistrationCredential.parse_raw(json.dumps(credential))
        verification = verify_registration_response(
            credential=registration,
            expected_challenge=expected_challenge,
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGIN,
        )
    except Exception as e:
        logger.error(f"Passkey registration verification failed: {e}")
        return jsonify({'success': False, 'error': 'Passkey registration failed'}), 400

    # Store the credential
    cred_id_b64 = base64.urlsafe_b64encode(verification.credential_id).rstrip(b'=').decode()
    pub_key_b64 = base64.urlsafe_b64encode(verification.credential_public_key).rstrip(b'=').decode()

    webauthn_cred = WebAuthnCredential(
        user_id=g.jwt_user_id,
        credential_id=cred_id_b64,
        public_key=pub_key_b64,
        sign_count=verification.sign_count,
        device_name=device_name,
        transports=json.dumps(credential.get('response', {}).get('transports', [])) if isinstance(credential, dict) else None,
    )
    db.session.add(webauthn_cred)

    # Enable passkey 2FA
    config = TwoFAConfig.query.filter_by(user_id=g.jwt_user_id).first()
    if not config:
        config = TwoFAConfig(user_id=g.jwt_user_id)
        db.session.add(config)
    config.passkey_enabled = True

    # Mark challenge as used
    challenge.used = True
    db.session.commit()

    # Generate recovery codes if not already present
    recovery_codes = None
    if not config.recovery_codes_hash:
        recovery_codes = _generate_recovery_codes(config)

    return jsonify({
        'success': True,
        'data': {
            'message': 'Passkey registered successfully',
            'credential_id': webauthn_cred.id,
            'device_name': device_name,
            'recovery_codes': recovery_codes,
        }
    })


@api_v2_bp.route('/auth/2fa/setup/passkeys', methods=['GET'])
@jwt_required
def twofa_list_passkeys():
    """List registered passkeys for the current user."""
    creds = WebAuthnCredential.query.filter_by(user_id=g.jwt_user_id).all()
    return jsonify({
        'success': True,
        'data': [{
            'id': c.id,
            'device_name': c.device_name,
            'created_at': c.created_at.isoformat() if c.created_at else None,
            'last_used_at': c.last_used_at.isoformat() if c.last_used_at else None,
        } for c in creds]
    })


@api_v2_bp.route('/auth/2fa/setup/passkey/<int:passkey_id>', methods=['DELETE'])
@jwt_required
def twofa_delete_passkey(passkey_id):
    """Remove a registered passkey. Requires password or email OTP confirmation (HIGH-5)."""
    data = request.get_json(force=True, silent=True) or {}
    password = data.get('password')
    confirmation_code = data.get('confirmation_code')

    user = db.session.get(User, g.jwt_user_id)

    # Require confirmation before deleting a passkey
    if user.password_hash:
        if not password:
            return jsonify({'success': False, 'error': 'Password required to delete passkey'}), 400
        if not user.check_password(password):
            return jsonify({'success': False, 'error': 'Invalid password'}), 401
    else:
        # OIDC-only users: require email OTP
        if not confirmation_code:
            return jsonify({
                'success': False,
                'error': 'Email confirmation code required to delete passkey',
                'requires_email_confirmation': True,
            }), 400
        # Verify against most recent disable challenge (reuses disable_2fa_confirm type)
        confirm_challenge = TwoFAChallenge.query.filter_by(
            user_id=g.jwt_user_id,
            challenge_type='disable_2fa_confirm',
        ).order_by(TwoFAChallenge.created_at.desc()).first()

        if not confirm_challenge or not confirm_challenge.is_valid:
            return jsonify({'success': False, 'error': 'Invalid or expired confirmation code'}), 401

        from werkzeug.security import check_password_hash as check_hash
        if not check_hash(confirm_challenge.otp_code_hash, confirmation_code):
            confirm_challenge.attempts += 1
            db.session.commit()
            return jsonify({'success': False, 'error': 'Invalid confirmation code'}), 401

        confirm_challenge.used = True

    cred = WebAuthnCredential.query.filter_by(id=passkey_id, user_id=g.jwt_user_id).first()
    if not cred:
        return jsonify({'success': False, 'error': 'Passkey not found'}), 404

    db.session.delete(cred)

    # If no more passkeys, disable passkey 2FA
    remaining = WebAuthnCredential.query.filter_by(user_id=g.jwt_user_id).count()
    if remaining == 0:
        config = TwoFAConfig.query.filter_by(user_id=g.jwt_user_id).first()
        if config:
            config.passkey_enabled = False

    db.session.commit()
    return jsonify({'success': True, 'data': {'message': 'Passkey removed'}})


@api_v2_bp.route('/auth/2fa/disable', methods=['POST'])
@jwt_required
@limiter.limit("5 per minute")
def twofa_disable():
    """Disable all 2FA for the current user. Requires password or email OTP confirmation."""
    data = request.get_json(force=True, silent=True) or {}
    password = data.get('password')
    confirmation_code = data.get('confirmation_code')

    user = db.session.get(User, g.jwt_user_id)

    # Require password for local auth users
    if user.password_hash:
        if not password:
            return jsonify({'success': False, 'error': 'Password required to disable 2FA'}), 400
        if not user.check_password(password):
            return jsonify({'success': False, 'error': 'Invalid password'}), 401
    else:
        # OIDC-only users: require email OTP confirmation (CRITICAL-4)
        if not confirmation_code:
            return jsonify({
                'success': False,
                'error': 'Email confirmation code required to disable 2FA',
                'requires_email_confirmation': True,
            }), 400

        # Verify the confirmation code against the most recent disable challenge
        disable_challenge = TwoFAChallenge.query.filter_by(
            user_id=g.jwt_user_id,
            challenge_type='disable_2fa_confirm',
        ).order_by(TwoFAChallenge.created_at.desc()).first()

        if not disable_challenge or not disable_challenge.is_valid:
            return jsonify({'success': False, 'error': 'Invalid or expired confirmation code. Request a new one.'}), 401

        from werkzeug.security import check_password_hash as check_hash
        if not check_hash(disable_challenge.otp_code_hash, confirmation_code):
            disable_challenge.attempts += 1
            db.session.commit()
            return jsonify({'success': False, 'error': 'Invalid confirmation code'}), 401

        disable_challenge.used = True

    config = TwoFAConfig.query.filter_by(user_id=g.jwt_user_id).first()
    if config:
        config.email_otp_enabled = False
        config.passkey_enabled = False
        config.recovery_codes_hash = None

    # Remove all passkeys
    WebAuthnCredential.query.filter_by(user_id=g.jwt_user_id).delete()
    # Remove all pending challenges
    TwoFAChallenge.query.filter_by(user_id=g.jwt_user_id).delete()

    db.session.commit()
    return jsonify({'success': True, 'data': {'message': '2FA disabled successfully'}})


@api_v2_bp.route('/auth/2fa/disable/send-code', methods=['POST'])
@jwt_required
@limiter.limit("5 per minute")
def twofa_disable_send_code():
    """Send email confirmation code for OIDC-only users to disable 2FA."""
    user = db.session.get(User, g.jwt_user_id)

    if user.password_hash:
        return jsonify({'success': False, 'error': 'Use password confirmation instead'}), 400

    if not user.email:
        return jsonify({'success': False, 'error': 'No email address on account'}), 400

    # Generate and send code
    code = str(secrets.randbelow(900000) + 100000)
    code_hash = generate_password_hash(code)

    session_token = secrets.token_urlsafe(32)
    session_hash = hashlib.sha256(session_token.encode()).hexdigest()

    challenge = TwoFAChallenge(
        user_id=user.id,
        token_hash=session_hash,
        challenge_type='disable_2fa_confirm',
        otp_code_hash=code_hash,
        expires_at=_naive_utcnow() + datetime.timedelta(minutes=10),
    )
    db.session.add(challenge)
    db.session.commit()

    from services.email import send_2fa_code_email
    sent = send_2fa_code_email(user.email, code, user.username)
    if not sent:
        return jsonify({'success': False, 'error': 'Failed to send confirmation code'}), 502

    return jsonify({'success': True, 'data': {'message': 'Confirmation code sent to your email'}})


@api_v2_bp.route('/auth/2fa/challenge', methods=['POST'])
@limiter.limit("10 per minute")
def twofa_challenge():
    """Request a 2FA challenge. Sends email OTP if email_otp method is requested."""
    data = request.get_json(force=True, silent=True) or {}
    session_token = data.get('session_token')
    method = data.get('method', 'email_otp')

    challenge, err = _verify_2fa_session(session_token)
    if err:
        return err

    user = db.session.get(User, challenge.user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    if method == 'email_otp':
        if not user.email:
            return jsonify({'success': False, 'error': 'No email address configured'}), 400

        # Generate 6-digit code using cryptographic randomness (CRITICAL-2)
        code = str(secrets.randbelow(900000) + 100000)
        challenge.otp_code_hash = generate_password_hash(code)
        challenge.challenge_type = 'email_otp'
        db.session.commit()

        from services.email import send_2fa_code_email
        sent = send_2fa_code_email(user.email, code, user.username)
        if not sent:
            return jsonify({'success': False, 'error': 'Failed to send verification code'}), 502

        return jsonify({'success': True, 'data': {'message': 'Verification code sent to your email'}})

    elif method == 'passkey':
        return jsonify({'success': True, 'data': {'message': 'Use passkey to verify'}})

    return jsonify({'success': False, 'error': f'Unknown 2FA method: {method}'}), 400


@api_v2_bp.route('/auth/2fa/verify/passkey/options', methods=['POST'])
@limiter.limit("10 per minute")
def twofa_passkey_auth_options():
    """Get WebAuthn authentication options for 2FA passkey verification."""
    if not ENABLE_PASSKEYS:
        return jsonify({'success': False, 'error': 'Passkeys are not enabled'}), 400

    from webauthn import generate_authentication_options, options_to_json
    from webauthn.helpers.structs import PublicKeyCredentialDescriptor, UserVerificationRequirement
    import base64

    data = request.get_json(force=True, silent=True) or {}
    session_token = data.get('session_token')

    challenge, err = _verify_2fa_session(session_token)
    if err:
        return err

    # Get user's passkeys
    creds = WebAuthnCredential.query.filter_by(user_id=challenge.user_id).all()
    if not creds:
        return jsonify({'success': False, 'error': 'No passkeys registered'}), 400

    allow_creds = []
    for c in creds:
        allow_creds.append(PublicKeyCredentialDescriptor(
            id=base64.urlsafe_b64decode(c.credential_id + '=='),
            transports=json.loads(c.transports) if c.transports else [],
        ))

    options = generate_authentication_options(
        rp_id=WEBAUTHN_RP_ID,
        allow_credentials=allow_creds,
        user_verification=UserVerificationRequirement.PREFERRED,
    )

    options_json = json.loads(options_to_json(options))

    # Store the challenge for verification
    challenge.otp_code_hash = options_json['challenge']
    challenge.challenge_type = 'passkey'
    db.session.commit()

    return jsonify({
        'success': True,
        'data': {'options': options_json}
    })


@api_v2_bp.route('/auth/2fa/verify', methods=['POST'])
@limiter.limit("5 per minute")
def twofa_verify():
    """Verify a 2FA challenge. On success, issues JWT tokens.

    Accepts: { session_token, method, code/credential/recovery_code }
    """
    data = request.get_json(force=True, silent=True) or {}
    session_token = data.get('session_token')
    method = data.get('method', 'email_otp')

    challenge, err = _verify_2fa_session(session_token)
    if err:
        return err

    user = db.session.get(User, challenge.user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    verified = False

    if method == 'email_otp':
        code = data.get('code')
        if not code or not challenge.otp_code_hash:
            challenge.attempts += 1
            db.session.commit()
            return jsonify({'success': False, 'error': 'Missing verification code'}), 400

        from werkzeug.security import check_password_hash as check_hash
        if check_hash(challenge.otp_code_hash, code):
            verified = True
        else:
            challenge.attempts += 1
            db.session.commit()
            return jsonify({'success': False, 'error': 'Invalid verification code'}), 400

    elif method == 'passkey':
        credential_data = data.get('credential')
        if not credential_data:
            return jsonify({'success': False, 'error': 'Missing credential'}), 400

        if not ENABLE_PASSKEYS:
            return jsonify({'success': False, 'error': 'Passkeys are not enabled'}), 400

        from webauthn import verify_authentication_response
        from webauthn.helpers.structs import AuthenticationCredential
        import base64

        expected_challenge = base64.urlsafe_b64decode(challenge.otp_code_hash + '==')

        # Find the matching credential
        cred_id_from_response = credential_data.get('id', '')
        stored_cred = WebAuthnCredential.query.filter_by(
            user_id=challenge.user_id,
            credential_id=cred_id_from_response
        ).first()

        if not stored_cred:
            challenge.attempts += 1
            db.session.commit()
            return jsonify({'success': False, 'error': 'Unrecognized credential'}), 400

        try:
            auth_credential = AuthenticationCredential.parse_raw(json.dumps(credential_data))
            verification = verify_authentication_response(
                credential=auth_credential,
                expected_challenge=expected_challenge,
                expected_rp_id=WEBAUTHN_RP_ID,
                expected_origin=WEBAUTHN_ORIGIN,
                credential_public_key=base64.urlsafe_b64decode(stored_cred.public_key + '=='),
                credential_current_sign_count=stored_cred.sign_count,
            )
            stored_cred.sign_count = verification.new_sign_count
            stored_cred.last_used_at = datetime.datetime.now(datetime.timezone.utc)
            verified = True
        except Exception as e:
            logger.error(f"Passkey verification failed: {e}")
            challenge.attempts += 1
            db.session.commit()
            return jsonify({'success': False, 'error': 'Passkey verification failed'}), 400

    elif method == 'recovery':
        recovery_code = data.get('recovery_code')
        if not recovery_code:
            return jsonify({'success': False, 'error': 'Missing recovery code'}), 400

        # Lock the TwoFAConfig row to prevent race condition (CRITICAL-3)
        config = db.session.query(TwoFAConfig).filter_by(
            user_id=challenge.user_id
        ).with_for_update().first()
        if not config or not config.recovery_codes_hash:
            return jsonify({'success': False, 'error': 'No recovery codes available'}), 400

        from werkzeug.security import check_password_hash as check_hash
        code_hashes = json.loads(config.recovery_codes_hash)
        matched_idx = None
        for idx, h in enumerate(code_hashes):
            if check_hash(h, recovery_code.upper()):
                matched_idx = idx
                break

        if matched_idx is not None:
            # Consume the recovery code (single-use) - row is locked, safe from races
            code_hashes.pop(matched_idx)
            config.recovery_codes_hash = json.dumps(code_hashes)
            verified = True
        else:
            challenge.attempts += 1
            db.session.commit()
            return jsonify({'success': False, 'error': 'Invalid recovery code'}), 400
    else:
        return jsonify({'success': False, 'error': f'Unknown 2FA method: {method}'}), 400

    if not verified:
        return jsonify({'success': False, 'error': '2FA verification failed'}), 401

    # Mark challenge as used
    challenge.used = True
    db.session.commit()

    # Issue JWT tokens
    access_token = create_access_token(user.id, user.role)
    refresh_token = create_refresh_token(user.id, data.get('device_info'))
    databases = [{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases]

    response = jsonify({
        'success': True,
        'data': {
            'access_token': access_token,
            'refresh_token': refresh_token,
            'expires_in': int(JWT_ACCESS_TOKEN_EXPIRES.total_seconds()),
            'token_type': 'Bearer',  # nosec B105
            'user': {
                'id': user.id,
                'username': user.username,
                'role': user.role
            },
            'databases': databases,
        }
    })
    return _set_refresh_cookie(response, refresh_token)


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

@api_v2_bp.route('/users/<int:target_user_id>/databases', methods=['GET'])
@jwt_admin_required
def jwt_get_user_databases(target_user_id):
    """Get databases a user has access to (admin only)."""
    user = db.get_or_404(User, target_user_id)
    current_user_id = g.jwt_user_id
    # In SaaS mode, only allow viewing databases of users you created (or yourself)
    if is_saas() and user.id != current_user_id:
        if user.created_by_id is not None and user.created_by_id != current_user_id:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
    return jsonify({
        'success': True,
        'data': [{'id': d.id, 'name': d.name, 'display_name': d.display_name} for d in user.accessible_databases]
    })

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
    # Validate email: length check prevents ReDoS, simple check for @ and domain
    if len(email) > 254 or '@' not in email or '.' not in email.split('@')[-1]:
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
        display_name = data['display_name'].strip()
        if not display_name:
            return jsonify({'success': False, 'error': 'Display name cannot be empty'}), 400
        database.display_name = display_name
    if 'description' in data:
        database.description = data['description'].strip() if data['description'] else ''

    db.session.commit()
    return jsonify({'success': True, 'data': {'id': database.id, 'name': database.name, 'display_name': database.display_name, 'description': database.description}})

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
            'version': '4.0.0',
            'api_version': 'v2',
            'license': "O'Saasy",
            'license_url': 'https://osaasy.dev/',
            'deployment_mode': DEPLOYMENT_MODE,
            'features': ['jwt_auth', 'mobile_api', 'enhanced_frequencies', 'auto_payments', 'postgresql_saas', 'row_tenancy', 'user_invites', 'device_management', 'delta_sync', 'conflict_resolution', 'push_notifications', 'shared_bills']
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


@api_v2_bp.route('/shares/cleanup-expired', methods=['POST'])
@limiter.limit("10 per hour")
@jwt_admin_required
def cleanup_expired_shares():
    """
    Clean up expired pending bill share invitations (admin only).

    This endpoint is meant to be called by a cron job or scheduler to
    automatically remove expired share invitations that were never accepted.
    Only affects shares with status='pending' and expires_at in the past.

    Returns:
    {
        "success": true,
        "data": {
            "deleted_count": 5,
            "oldest_deleted": "2026-01-01T00:00:00Z"
        }
    }

    Setup as cron job (run daily at 3 AM):
    0 3 * * * curl -X POST https://your-domain.com/api/v2/shares/cleanup-expired \
        -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
    """
    try:
        stats = BillShare.cleanup_expired_shares()

        logger.info(
            f"Expired shares cleanup: deleted {stats['deleted_count']} share(s), "
            f"oldest from {stats['oldest_deleted'] or 'N/A'}"
        )

        return jsonify({
            'success': True,
            'data': stats
        })
    except Exception as e:
        logger.error(f"Failed to cleanup expired shares: {e}")
        return jsonify({
            'success': False,
            'error': 'Failed to cleanup expired shares'
        }), 500


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
            # Normalize to naive UTC for comparison (PostgreSQL returns naive datetimes)
            server_time = bill.last_updated
            client_time_naive = client_time.replace(tzinfo=None) if client_time and client_time.tzinfo else client_time
            if client_time_naive and server_time and client_time_naive < server_time:
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


# --- Telemetry Consent Endpoints (V1 - Session Auth) ---

@api_bp.route('/telemetry/notice', methods=['GET'])
@login_required
def get_telemetry_notice_v1():
    """
    Check if user needs to see telemetry notice (session auth version).

    Returns notice status and telemetry configuration.
    """
    user = User.query.get(session.get('user_id'))
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    # Only account owners see/manage telemetry settings
    if not user.is_account_owner:
        return jsonify({
            'success': True,
            'data': {
                'show_notice': False,
                'reason': 'not_account_owner'
            }
        })

    # Check if notice was already shown
    if user.telemetry_notice_shown_at:
        return jsonify({
            'success': True,
            'data': {
                'show_notice': False,
                'opted_out': user.telemetry_opt_out,
                'notice_shown_at': user.telemetry_notice_shown_at.isoformat()
            }
        })

    # User needs to see the notice
    return jsonify({
        'success': True,
        'data': {
            'show_notice': True,
            'telemetry_enabled': os.environ.get('TELEMETRY_ENABLED', 'true').lower() == 'true',
            'deployment_mode': os.environ.get('DEPLOYMENT_MODE', 'unknown')
        }
    })

@api_bp.route('/telemetry/accept', methods=['POST'])
@login_required
def accept_telemetry_v1():
    """Accept telemetry (session auth version)."""
    user = User.query.get(session.get('user_id'))
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    if not user.is_account_owner:
        return jsonify({'success': False, 'error': 'Only account owners can manage telemetry'}), 403

    user.telemetry_notice_shown_at = datetime.datetime.now(datetime.timezone.utc)
    user.telemetry_opt_out = False
    db.session.commit()

    logger.info(f"User {user.username} accepted telemetry")

    return jsonify({
        'success': True,
        'data': {
            'message': 'Telemetry accepted',
            'opted_out': False
        }
    })

@api_bp.route('/telemetry/opt-out', methods=['POST'])
@login_required
def opt_out_telemetry_v1():
    """Opt out of telemetry (session auth version)."""
    user = User.query.get(session.get('user_id'))
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    if not user.is_account_owner:
        return jsonify({'success': False, 'error': 'Only account owners can manage telemetry'}), 403

    user.telemetry_notice_shown_at = datetime.datetime.now(datetime.timezone.utc)
    user.telemetry_opt_out = True
    db.session.commit()

    logger.info(f"User {user.username} opted out of telemetry")

    return jsonify({
        'success': True,
        'data': {
            'message': 'Telemetry disabled',
            'opted_out': True
        }
    })

# --- Telemetry Consent Endpoints (V2 - JWT Auth) ---

@api_v2_bp.route('/telemetry/notice', methods=['GET'])
@jwt_required
def get_telemetry_notice():
    """
    Check if user needs to see telemetry notice.

    Returns notice status and telemetry configuration.
    """
    user = User.query.get(g.jwt_user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    # Only account owners see/manage telemetry settings
    if not user.is_account_owner:
        return jsonify({
            'success': True,
            'data': {
                'show_notice': False,
                'reason': 'not_account_owner'
            }
        })

    # Check if notice was already shown
    if user.telemetry_notice_shown_at:
        return jsonify({
            'success': True,
            'data': {
                'show_notice': False,
                'opted_out': user.telemetry_opt_out,
                'notice_shown_at': user.telemetry_notice_shown_at.isoformat()
            }
        })

    # User needs to see the notice
    return jsonify({
        'success': True,
        'data': {
            'show_notice': True,
            'telemetry_enabled': os.environ.get('TELEMETRY_ENABLED', 'true').lower() == 'true',
            'deployment_mode': os.environ.get('DEPLOYMENT_MODE', 'unknown')
        }
    })


@api_v2_bp.route('/telemetry/accept', methods=['POST'])
@jwt_required
def accept_telemetry():
    """Accept telemetry (dismiss notice without opting out)."""
    user = User.query.get(g.jwt_user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    if not user.is_account_owner:
        return jsonify({'success': False, 'error': 'Only account owners can manage telemetry'}), 403

    user.telemetry_notice_shown_at = datetime.datetime.now(datetime.timezone.utc)
    user.telemetry_opt_out = False
    db.session.commit()

    logger.info(f"User {user.username} accepted telemetry")

    return jsonify({
        'success': True,
        'data': {
            'message': 'Telemetry accepted',
            'opted_out': False
        }
    })


@api_v2_bp.route('/telemetry/opt-out', methods=['POST'])
@jwt_required
def opt_out_telemetry():
    """Opt out of telemetry."""
    user = User.query.get(g.jwt_user_id)
    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    if not user.is_account_owner:
        return jsonify({'success': False, 'error': 'Only account owners can manage telemetry'}), 403

    user.telemetry_notice_shown_at = datetime.datetime.now(datetime.timezone.utc)
    user.telemetry_opt_out = True
    db.session.commit()

    logger.info(f"User {user.username} opted out of telemetry")

    return jsonify({
        'success': True,
        'data': {
            'message': 'Telemetry disabled',
            'opted_out': True
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
    # Use safe_join to prevent path traversal attacks
    full_path = safe_join(client_dir, path)
    if full_path and os.path.exists(full_path) and os.path.isfile(full_path):
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

    # Initialize telemetry and scheduler
    telemetry.init_app(app, db)
    scheduler.init_app(app)

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
                'frame-ancestors': "'none'",  # Prevent clickjacking
                'form-action': "'self'",  # Prevent form hijacking
                'base-uri': "'self'",  # Prevent base tag injection
                'object-src': "'none'",  # Prevent plugin-based attacks (Flash, Java)
            },
            referrer_policy='strict-origin-when-cross-origin',
            x_content_type_options=True,
            x_xss_protection=True,
            frame_options='DENY',  # Additional clickjacking protection
        )

    # Secure session cookie configuration
    app.config['SESSION_COOKIE_SECURE'] = is_production  # HTTPS only in production
    app.config['SESSION_COOKIE_HTTPONLY'] = True  # Prevent JS access
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # CSRF protection
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)

    # Add request logging middleware (controlled by LOG_REQUESTS env var)
    # Also adds X-Request-ID header for request tracing
    request_logging_middleware(app)

    # Register API Blueprints first, then SPA
    app.register_blueprint(api_bp)
    app.register_blueprint(api_v2_bp)  # JWT auth for mobile

    # Register telemetry receiver (only on production server for collecting telemetry)
    enable_telemetry_receiver = os.environ.get('ENABLE_TELEMETRY_RECEIVER', 'false').lower() == 'true'
    if enable_telemetry_receiver:
        from services.telemetry_receiver import telemetry_receiver_bp
        app.register_blueprint(telemetry_receiver_bp)
        logger.info("📊 Telemetry receiver enabled - this server will collect installation statistics")

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

    # Start background scheduler for telemetry and other periodic tasks
    try:
        scheduler.start()
        logger.info("✅ Background scheduler started")
    except Exception as e:
        logger.error(f"Failed to start scheduler: {e}")

    return app

app = create_app()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)  # nosec B104 - dev server bind
