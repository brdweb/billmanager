"""
Authentication tests for BillManager.

Tests:
- Login success/failure
- JWT token generation and refresh
- Password change required flow
- Logout functionality
"""

import json


class TestJWTAuth:
    """Test JWT authentication (API v2)."""

    def test_jwt_login_success(self, client, admin_user):
        """Test JWT login returns access and refresh tokens."""
        response = client.post(
            "/api/v2/auth/login",
            json={"username": "testadmin", "password": "testpassword123"},
        )
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data.get("success") is True
        assert "data" in data
        assert "access_token" in data["data"]
        assert "refresh_token" in data["data"]
        assert "databases" in data["data"]

    def test_jwt_login_wrong_password(self, client, admin_user):
        """Test JWT login fails with wrong password."""
        response = client.post(
            "/api/v2/auth/login",
            json={"username": "testadmin", "password": "wrongpassword"},
        )
        assert response.status_code == 401
        data = json.loads(response.data)
        assert data.get("success") is False

    def test_jwt_protected_endpoint_without_token(self, client):
        """Test accessing protected endpoint without token fails."""
        response = client.get("/api/v2/me")
        assert response.status_code == 401

    def test_jwt_protected_endpoint_with_token(self, client, admin_auth_headers):
        """Test accessing protected endpoint with valid token."""
        response = client.get("/api/v2/me", headers=admin_auth_headers)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data.get("success") is True
        assert "user" in data.get("data", {}) or "username" in data.get("data", {})

    def test_jwt_refresh_token(self, client, admin_user):
        """Test refreshing access token."""
        # First, login to get tokens
        login_response = client.post(
            "/api/v2/auth/login",
            json={"username": "testadmin", "password": "testpassword123"},
        )
        login_data = json.loads(login_response.data)
        refresh_token = login_data["data"]["refresh_token"]

        # Use refresh token to get new access token
        response = client.post(
            "/api/v2/auth/refresh", json={"refresh_token": refresh_token}
        )
        assert response.status_code == 200
        data = json.loads(response.data)
        assert "access_token" in data.get("data", {})
        assert "refresh_token" in data.get("data", {})
        assert data["data"]["refresh_token"] != refresh_token


class TestPasswordChange:
    """Test password change functionality."""

    def test_password_change_required_flow(self, client, app, db_session):
        """Test that users with password_change_required must change password."""
        from models import User

        with app.app_context():
            # Create user that requires password change
            user = User(username="newuser", role="user", password_change_required=True)
            user.set_password("initialpassword")
            db_session.add(user)
            db_session.commit()

            # Try to login - should return password change required
            response = client.post(
                "/api/v2/auth/login",
                json={"username": "newuser", "password": "initialpassword"},
            )
            data = json.loads(response.data)
            assert data.get("password_change_required") is True
            assert "change_token" in data

    def test_v2_authenticated_change_password_with_current_password(
        self, client, admin_auth_headers, admin_user
    ):
        """Mobile's Settings screen sends current_password, not change_token."""
        response = client.post(
            "/api/v2/auth/change-password",
            headers=admin_auth_headers,
            json={
                "current_password": "testpassword123",
                "new_password": "Newsecurepassword123",
            },
        )
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data["success"] is True
        assert "access_token" in data["data"]

        # Old password no longer works, new one does
        old_login = client.post(
            "/api/v2/auth/login",
            json={"username": admin_user.username, "password": "testpassword123"},
        )
        assert old_login.status_code == 401

        new_login = client.post(
            "/api/v2/auth/login",
            json={"username": admin_user.username, "password": "Newsecurepassword123"},
        )
        assert new_login.status_code == 200

    def test_v2_authenticated_change_password_rejects_wrong_current_password(
        self, client, admin_auth_headers
    ):
        response = client.post(
            "/api/v2/auth/change-password",
            headers=admin_auth_headers,
            json={
                "current_password": "totally-wrong-password",
                "new_password": "Newsecurepassword123",
            },
        )
        assert response.status_code == 401
        data = json.loads(response.data)
        assert data["success"] is False

    def test_v2_change_password_requires_token_or_current_password(self, client):
        response = client.post(
            "/api/v2/auth/change-password",
            json={"new_password": "Newsecurepassword123"},
        )
        assert response.status_code == 400


class TestLogout:
    """Test logout functionality."""

    def test_jwt_logout(self, client, admin_user, admin_auth_headers):
        """Test JWT logout revokes refresh token."""
        # Login to get refresh token
        login_response = client.post(
            "/api/v2/auth/login",
            json={"username": "testadmin", "password": "testpassword123"},
        )
        login_data = json.loads(login_response.data)
        assert login_data.get("success") is True
        assert "data" in login_data
        refresh_token = login_data["data"].get("refresh_token")
        access_token = login_data["data"].get("access_token")
        assert refresh_token
        assert access_token

        # Logout with the token
        logout_headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        response = client.post(
            "/api/v2/auth/logout",
            headers=logout_headers,
            json={"refresh_token": refresh_token},
        )
        assert response.status_code == 200

        # Verify refresh token no longer works
        refresh_response = client.post(
            "/api/v2/auth/refresh", json={"refresh_token": refresh_token}
        )
        assert refresh_response.status_code in [401, 400]
