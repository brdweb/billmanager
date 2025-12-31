"""
Authentication tests for BillManager.

Tests:
- Login success/failure
- JWT token generation and refresh
- Password change required flow
- Logout functionality
"""
import json
import pytest


class TestLogin:
    """Test login functionality."""

    def test_login_success(self, client, admin_user):
        """Test successful login with valid credentials."""
        response = client.post('/login', json={
            'username': 'testadmin',
            'password': 'testpassword123'
        })
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'databases' in data

    def test_login_wrong_password(self, client, admin_user):
        """Test login fails with wrong password."""
        response = client.post('/login', json={
            'username': 'testadmin',
            'password': 'wrongpassword'
        })
        assert response.status_code == 401
        data = json.loads(response.data)
        assert 'error' in data

    def test_login_nonexistent_user(self, client):
        """Test login fails for non-existent user."""
        response = client.post('/login', json={
            'username': 'nonexistent',
            'password': 'anypassword'
        })
        assert response.status_code == 401

    def test_login_missing_fields(self, client):
        """Test login fails with missing fields."""
        response = client.post('/login', json={
            'username': 'testadmin'
        })
        assert response.status_code == 400


class TestJWTAuth:
    """Test JWT authentication (API v2)."""

    def test_jwt_login_success(self, client, admin_user):
        """Test JWT login returns access and refresh tokens."""
        response = client.post('/api/v2/auth/login', json={
            'username': 'testadmin',
            'password': 'testpassword123'
        })
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data.get('success') is True
        assert 'data' in data
        assert 'access_token' in data['data']
        assert 'refresh_token' in data['data']
        assert 'databases' in data['data']

    def test_jwt_login_wrong_password(self, client, admin_user):
        """Test JWT login fails with wrong password."""
        response = client.post('/api/v2/auth/login', json={
            'username': 'testadmin',
            'password': 'wrongpassword'
        })
        assert response.status_code == 401
        data = json.loads(response.data)
        assert data.get('success') is False

    def test_jwt_protected_endpoint_without_token(self, client):
        """Test accessing protected endpoint without token fails."""
        response = client.get('/api/v2/me')
        assert response.status_code == 401

    def test_jwt_protected_endpoint_with_token(self, client, admin_auth_headers):
        """Test accessing protected endpoint with valid token."""
        response = client.get('/api/v2/me', headers=admin_auth_headers)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data.get('success') is True
        assert 'user' in data.get('data', {}) or 'username' in data.get('data', {})

    def test_jwt_refresh_token(self, client, admin_user):
        """Test refreshing access token."""
        # First, login to get tokens
        login_response = client.post('/api/v2/auth/login', json={
            'username': 'testadmin',
            'password': 'testpassword123'
        })
        login_data = json.loads(login_response.data)
        refresh_token = login_data['data']['refresh_token']

        # Use refresh token to get new access token
        response = client.post('/api/v2/auth/refresh', json={
            'refresh_token': refresh_token
        })
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'access_token' in data or 'access_token' in data.get('data', {})


class TestPasswordChange:
    """Test password change functionality."""

    def test_password_change_required_flow(self, client, app, db_session):
        """Test that users with password_change_required must change password."""
        from models import User

        with app.app_context():
            # Create user that requires password change
            user = User(
                username='newuser',
                role='user',
                password_change_required=True
            )
            user.set_password('initialpassword')
            db_session.add(user)
            db_session.commit()

            # Try to login - should return password change required
            response = client.post('/api/v2/auth/login', json={
                'username': 'newuser',
                'password': 'initialpassword'
            })
            data = json.loads(response.data)
            assert data.get('password_change_required') is True
            assert 'change_token' in data

    def test_v1_password_change_sets_session(self, client, app, db_session):
        """Test v1 /change-password endpoint sets up session correctly."""
        from models import User, Database

        with app.app_context():
            # Create admin user that requires password change
            user = User(
                username='firstadmin',
                role='admin',
                password_change_required=True
            )
            user.set_password('initialpassword')
            db_session.add(user)

            # Create a database and grant access
            test_db = Database(
                name='testdb',
                display_name='Test Database'
            )
            db_session.add(test_db)
            db_session.flush()
            user.accessible_databases.append(test_db)
            db_session.commit()

            # Login - should return password change required
            login_response = client.post('/login', json={
                'username': 'firstadmin',
                'password': 'initialpassword'
            })
            login_data = json.loads(login_response.data)
            assert login_data.get('password_change_required') is True
            change_token = login_data.get('change_token')
            assert change_token is not None

            # Use v1 change-password endpoint
            change_response = client.post('/change-password', json={
                'change_token': change_token,
                'new_password': 'newsecurepassword123'
            })
            assert change_response.status_code == 200
            change_data = json.loads(change_response.data)
            assert change_data.get('role') == 'admin'
            assert 'databases' in change_data
            assert len(change_data['databases']) == 1
            assert change_data['databases'][0]['name'] == 'testdb'

            # Session should now be valid - /me should work
            me_response = client.get('/me')
            assert me_response.status_code == 200
            me_data = json.loads(me_response.data)
            assert me_data.get('role') == 'admin'
            assert me_data.get('current_db') == 'testdb'


class TestLogout:
    """Test logout functionality."""

    def test_session_logout(self, client, admin_user):
        """Test session-based logout."""
        # Login first
        client.post('/login', json={
            'username': 'testadmin',
            'password': 'testpassword123'
        })

        # Logout
        response = client.post('/logout')
        assert response.status_code == 200

    def test_jwt_logout(self, client, admin_user, admin_auth_headers):
        """Test JWT logout revokes refresh token."""
        # Login to get refresh token
        login_response = client.post('/api/v2/auth/login', json={
            'username': 'testadmin',
            'password': 'testpassword123'
        })
        login_data = json.loads(login_response.data)
        refresh_token = login_data.get('refresh_token')
        access_token = login_data.get('access_token')

        # Logout with the token
        logout_headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        }
        response = client.post('/api/v2/auth/logout',
                               headers=logout_headers,
                               json={'refresh_token': refresh_token})
        assert response.status_code == 200

        # Verify refresh token no longer works
        refresh_response = client.post('/api/v2/auth/refresh', json={
            'refresh_token': refresh_token
        })
        assert refresh_response.status_code in [401, 400]
