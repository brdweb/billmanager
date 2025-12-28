"""
Pytest fixtures for BillManager tests.

Provides:
- Test Flask app with SQLite in-memory database
- Test client for making requests
- Pre-created admin user and database
- JWT auth headers for authenticated requests
"""
import os
import sys
import pytest

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Override DATABASE_URL before importing app
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
os.environ['FLASK_SECRET_KEY'] = 'test-secret-key-for-testing-only'
os.environ['FLASK_ENV'] = 'testing'

from app import create_app, create_access_token, JWT_SECRET_KEY
from models import db, User, Database, Bill, Payment


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
        db.drop_all()


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
    with app.app_context():
        user = User(
            username='testadmin',
            role='admin',
            email='admin@test.com',
            password_change_required=False
        )
        user.set_password('testpassword123')
        db_session.add(user)
        db_session.commit()

        # Refresh to get the ID
        db_session.refresh(user)
        yield user


@pytest.fixture(scope='function')
def regular_user(app, db_session, admin_user):
    """Create a regular user for testing."""
    with app.app_context():
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
        yield user


@pytest.fixture(scope='function')
def test_database(app, db_session, admin_user):
    """Create a test database (workspace) for testing."""
    with app.app_context():
        database = Database(
            name='testdb',
            display_name='Test Database',
            description='Database for testing',
            owner_id=admin_user.id
        )
        db_session.add(database)
        db_session.commit()

        # Give admin access
        admin_user.accessible_databases.append(database)
        db_session.commit()
        db_session.refresh(database)
        yield database


@pytest.fixture(scope='function')
def test_bill(app, db_session, test_database):
    """Create a test bill."""
    with app.app_context():
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
        yield bill


@pytest.fixture(scope='function')
def admin_auth_headers(app, admin_user):
    """Generate JWT auth headers for admin user."""
    with app.app_context():
        token = create_access_token(admin_user.id, admin_user.role)
        return {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }


@pytest.fixture(scope='function')
def user_auth_headers(app, regular_user):
    """Generate JWT auth headers for regular user."""
    with app.app_context():
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
