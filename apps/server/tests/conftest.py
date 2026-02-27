"""
Pytest fixtures for BillManager tests.

Provides:
- Test Flask app with PostgreSQL test database
- Test client for making requests
- Pre-created admin user and database
- JWT auth headers for authenticated requests
"""
import os
import sys
import json
import hashlib
import secrets
import datetime
import pytest

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Use PostgreSQL test database - CI sets DATABASE_URL, local dev uses default
if 'DATABASE_URL' not in os.environ:
    _test_db_host = os.environ.get('TEST_DB_HOST', '192.168.40.242')
    os.environ['DATABASE_URL'] = f'postgresql://billsuser:billspass@{_test_db_host}:5432/bills_test'
os.environ['FLASK_SECRET_KEY'] = 'test-secret-key-for-testing-only'
os.environ['FLASK_ENV'] = 'testing'
os.environ['RATE_LIMIT_ENABLED'] = 'false'

from app import create_app, create_access_token, JWT_SECRET_KEY
from models import (
    db, User, Database, Bill, Payment,
    OAuthAccount, TwoFAConfig, TwoFAChallenge, WebAuthnCredential,
)
from werkzeug.security import generate_password_hash


@pytest.fixture(scope='session')
def app():
    """Create application for testing."""
    application = create_app()
    application.config.update({
        'TESTING': True,
        'WTF_CSRF_ENABLED': False,
    })

    with application.app_context():
        db.create_all()
        yield application
        # Don't drop tables - keep test database intact


@pytest.fixture(scope='function')
def client(app):
    """Create test client for making requests."""
    return app.test_client()


@pytest.fixture(scope='function')
def db_session(app):
    """Create a fresh database session for each test."""
    with app.app_context():
        # Clear all data
        for table in reversed(db.metadata.sorted_tables):
            db.session.execute(table.delete())
        db.session.commit()
        yield db.session
        db.session.rollback()


@pytest.fixture(scope='function')
def admin_user(app, db_session):
    """Create an admin user for testing."""
    user = User(
        username='testadmin',
        role='admin',
        email='admin@test.com',
        password_change_required=False
    )
    user.set_password('testpassword123')
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope='function')
def regular_user(app, db_session, admin_user):
    """Create a regular user for testing."""
    user = User(
        username='testuser',
        role='user',
        email='user@test.com',
        password_change_required=False,
        created_by_id=admin_user.id
    )
    user.set_password('userpassword123')
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope='function')
def test_database(app, db_session, admin_user):
    """Create a test database (workspace) for testing."""
    database = Database(
        name='testdb',
        display_name='Test Database',
        description='Database for testing',
        owner_id=admin_user.id
    )
    db_session.add(database)
    db_session.commit()
    db_session.refresh(database)

    # Give admin access using the association table directly
    from models import user_database_access
    db_session.execute(
        user_database_access.insert().values(
            user_id=admin_user.id,
            database_id=database.id
        )
    )
    db_session.commit()
    return database


@pytest.fixture(scope='function')
def test_bill(app, db_session, test_database):
    """Create a test bill."""
    bill = Bill(
        database_id=test_database.id,
        name='Test Bill',
        amount=100.00,
        frequency='monthly',
        due_date='2025-01-15',
        type='expense',
        account='Checking'
    )
    db_session.add(bill)
    db_session.commit()
    db_session.refresh(bill)
    return bill


@pytest.fixture(scope='function')
def admin_auth_headers(app, admin_user):
    """Generate JWT auth headers for admin user."""
    token = create_access_token(admin_user.id, admin_user.role)
    return {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }


@pytest.fixture(scope='function')
def user_auth_headers(app, regular_user):
    """Generate JWT auth headers for regular user."""
    token = create_access_token(regular_user.id, regular_user.role)
    return {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }


@pytest.fixture(scope='function')
def auth_headers_with_db(admin_auth_headers, test_database):
    """Auth headers with X-Database header set."""
    headers = admin_auth_headers.copy()
    headers['X-Database'] = test_database.name
    return headers


# ============ OIDC / 2FA Fixtures ============

@pytest.fixture(scope='function')
def oauth_user(app, db_session):
    """Create a user who registered via OIDC (no password)."""
    user = User(
        username='oauthuser',
        role='admin',
        email='oauthuser@test.com',
        password_hash=None,
        auth_provider='google',
        password_change_required=False,
        email_verified_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope='function')
def oauth_user_headers(app, oauth_user):
    """Generate JWT auth headers for the OIDC-only user."""
    token = create_access_token(oauth_user.id, oauth_user.role)
    return {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }


@pytest.fixture(scope='function')
def oauth_account(app, db_session, admin_user):
    """Create an OAuthAccount linked to admin_user."""
    account = OAuthAccount(
        user_id=admin_user.id,
        provider='google',
        provider_user_id='google-12345',
        provider_email='admin@test.com',
        profile_data=json.dumps({'name': 'Test Admin'}),
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


@pytest.fixture(scope='function')
def twofa_enabled_user(app, db_session, admin_user):
    """Enable email OTP 2FA for admin_user and return the config."""
    config = TwoFAConfig(
        user_id=admin_user.id,
        email_otp_enabled=True,
        recovery_codes_hash=json.dumps([
            generate_password_hash('AAAA1111'),
            generate_password_hash('BBBB2222'),
        ]),
    )
    db_session.add(config)
    db_session.commit()
    db_session.refresh(config)
    return config


@pytest.fixture(scope='function')
def twofa_challenge(app, db_session, admin_user, twofa_enabled_user):
    """Create an active 2FA challenge for admin_user."""
    session_token = 'test-2fa-session-token'
    session_hash = hashlib.sha256(session_token.encode()).hexdigest()

    challenge = TwoFAChallenge(
        user_id=admin_user.id,
        token_hash=session_hash,
        challenge_type='pending',
        expires_at=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=1),
    )
    db_session.add(challenge)
    db_session.commit()
    db_session.refresh(challenge)
    return challenge, session_token


@pytest.fixture(scope='function')
def twofa_challenge_with_otp(app, db_session, admin_user, twofa_enabled_user):
    """Create a 2FA challenge with an OTP code set."""
    session_token = 'test-2fa-otp-session'
    session_hash = hashlib.sha256(session_token.encode()).hexdigest()
    otp_code = '123456'

    challenge = TwoFAChallenge(
        user_id=admin_user.id,
        token_hash=session_hash,
        challenge_type='email_otp',
        otp_code_hash=generate_password_hash(otp_code),
        expires_at=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=1),
    )
    db_session.add(challenge)
    db_session.commit()
    db_session.refresh(challenge)
    return challenge, session_token, otp_code
