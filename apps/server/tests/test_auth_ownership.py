"""Authentication payloads must distinguish managed admins from account owners."""
import json

import pytest
from werkzeug.security import generate_password_hash

import app as server
import config
from models import TwoFAConfig


@pytest.mark.parametrize("managed", [False, True])
@pytest.mark.parametrize("method", ["password", "password_change", "oauth", "twofa"])
def test_session_ownership(client, app, admin_user, regular_user, db_session, monkeypatch, managed, method):
    user = regular_user if managed else admin_user
    user.role = "admin"
    db_session.commit()
    password = "userpassword123" if managed else "testpassword123"
    if method == "oauth":
        monkeypatch.setattr(server, "_resolve_oauth_user", lambda *_: (user, False, None))
        with app.test_request_context("/api/v2/auth/oauth/oidc/callback", method="POST"):
            response = server._complete_oauth_identity("oidc", {"sub": "test-subject"}, {"flow": "login"}, {})
    elif method == "password_change":
        response = client.post("/api/v2/auth/change-password", json={
            "user_id": user.id, "current_password": password, "new_password": "Newsecurepassword123",
        }, headers={"Authorization": f"Bearer {server.create_access_token(user.id, user.role)}"})
    else:
        if method == "twofa":
            db_session.add(TwoFAConfig(user_id=user.id, passkey_enabled=True,
                recovery_codes_hash=json.dumps([generate_password_hash("TEST-RECOVERY")])) )
            db_session.commit()
        response = client.post("/api/v2/auth/login", json={"username": user.username, "password": password})
        if method == "twofa":
            assert response.status_code == 403
            response = client.post("/api/v2/auth/2fa/verify", json={
                "session_token": response.get_json()["twofa_session_token"],
                "method": "recovery", "recovery_code": "TEST-RECOVERY",
            })
    assert response.status_code == 200
    assert response.get_json()["data"]["user"]["is_account_owner"] is (not managed or not config.is_saas())


def test_identity_recovers_with_removed_group_without_weakening_bill_access(client, admin_auth_headers):
    headers = {**admin_auth_headers, "X-Database": "removed-group"}
    response = client.get("/api/v2/me", headers=headers)
    assert response.status_code == 200
    assert response.get_json()["data"]["current_db"] is None
    assert client.get("/api/v2/bills", headers=headers).status_code == 403
