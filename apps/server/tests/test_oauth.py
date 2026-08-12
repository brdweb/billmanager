"""
Unit tests for OAuth callback bug fixes (Microsoft OIDC + Generic OIDC).

Covers 4 bug fixes in oauth_callback():
  Bug 1: Microsoft issuer {tenantid} placeholder replacement
  Bug 2: OIDC claim mapping + userinfo endpoint fetch with sub validation
  Bug 3: Trusted provider email_verified bypass + OIDC skip env var
  Bug 4: Email fallback from preferred_username with format validation

These tests use SQLite in-memory and override conftest fixtures so they
can run without a live PostgreSQL instance:

    DATABASE_URL=sqlite:///  pytest tests/test_oauth.py -v
"""

import importlib
import os
from contextlib import contextmanager
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from unittest.mock import MagicMock, patch

import pytest
import time
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

# ---------------------------------------------------------------------------
# Self-contained fixtures (override conftest's PostgreSQL-dependent versions)
# ---------------------------------------------------------------------------

config = importlib.import_module("config")
app_module = importlib.import_module("app")
models_module = importlib.import_module("models")
db_migrations_module = importlib.import_module("db_migrations")
OAUTH_PROVIDERS = app_module.OAUTH_PROVIDERS
OAuthAccount = models_module.OAuthAccount
OAuthStateUse = models_module.OAuthStateUse
TwoFAConfig = models_module.TwoFAConfig
User = models_module.User
db_obj = models_module.db


@pytest.fixture(scope="module")
def app():
    """Create a Flask test app backed by SQLite in-memory."""
    original_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = "sqlite://"
    os.environ["FLASK_SECRET_KEY"] = "test-secret-key-for-testing-only"
    os.environ["FLASK_ENV"] = "testing"
    os.environ["RATE_LIMIT_ENABLED"] = "false"

    application = app_module.create_app()
    application.config.update({"TESTING": True})

    with application.app_context():
        db_obj.create_all()
        yield application

    # Restore original DATABASE_URL
    if original_url is not None:
        os.environ["DATABASE_URL"] = original_url
    else:
        os.environ.pop("DATABASE_URL", None)


@pytest.fixture()
def client(app):
    """Create test client."""
    return app.test_client()


@pytest.fixture()
def db_session(app):
    """Provide a clean DB session per test."""
    with app.app_context():
        for table in reversed(db_obj.metadata.sorted_tables):
            db_obj.session.execute(table.delete())
        db_obj.session.commit()
        yield db_obj.session
        db_obj.session.rollback()


@pytest.fixture()
def admin_user(db_session):
    """Create an admin user for testing."""
    user = User(
        username="testadmin",
        role="admin",
        email="admin@test.com",
        password_change_required=False,
    )
    user.set_password("testpassword123")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


class FakeClaims(dict):
    """Dict subclass with validate() for authlib compatibility."""

    def validate(self):
        return None


def _set_provider_config(monkeypatch, provider, client_id="test-client-id"):
    monkeypatch.setitem(
        OAUTH_PROVIDERS,
        provider,
        {
            "enabled": True,
            "client_id": client_id,
            "client_secret": "test-client-secret",
            "discovery_url": f"https://issuer.example/{provider}/.well-known/openid-configuration",
            "scopes": "openid email profile",
            "display_name": provider.title(),
            "icon": provider,
        },
    )
    return client_id


def _link_account(
    db_session, admin_user, provider, provider_user_id, provider_email="admin@test.com"
):
    account = OAuthAccount()
    account.user_id = admin_user.id
    account.provider = provider
    account.provider_user_id = provider_user_id
    account.provider_email = provider_email
    db_session.add(account)
    db_session.commit()
    return account


@contextmanager
def _mock_oauth_dependencies(
    provider,
    client_id,
    claims,
    metadata_overrides=None,
    state_overrides=None,
    token_overrides=None,
    userinfo_payload=None,
):
    claims = dict(claims)
    claims.setdefault("exp", int(time.time()) + 300)
    claims.setdefault("iat", int(time.time()))
    if provider == "google" and claims.get("iss") == "https://issuer.example/google":
        claims["iss"] = "https://accounts.google.com"
    metadata = {
        "issuer": (
            "https://accounts.google.com"
            if provider == "google"
            else f"https://issuer.example/{provider}"
        ),
        "token_endpoint": f"https://issuer.example/{provider}/token",
        "jwks_uri": f"https://issuer.example/{provider}/jwks",
        "userinfo_endpoint": f"https://issuer.example/{provider}/userinfo",
    }
    if metadata_overrides:
        metadata.update(metadata_overrides)

    state_payload = {
        "provider": provider,
        "code_verifier": "test-code-verifier",
        "id_token_nonce": "nonce-123",
        "flow": "login",
        "link_user_id": None,
        "channel": "browser",
    }
    if state_overrides:
        state_payload.update(state_overrides)

    token_json = {
        "access_token": "access-token-123",
        "id_token": "id-token-123",
    }
    if token_overrides:
        token_json.update(token_overrides)

    token_resp = MagicMock()
    token_resp.raise_for_status.return_value = None
    token_resp.json.return_value = token_json

    userinfo_resp = MagicMock()
    userinfo_resp.raise_for_status.return_value = None
    userinfo_resp.json.return_value = userinfo_payload or {"sub": claims.get("sub")}

    with (
        patch("app.get_enabled_oauth_providers", return_value=[provider]),
        patch("app._get_oidc_metadata", return_value=metadata),
        patch("app._verify_oauth_state", return_value=state_payload),
        patch("app._get_jwks", return_value={"keys": [{"kid": "1"}]}),
        patch("requests.post", return_value=token_resp) as post_mock,
        patch("requests.get", return_value=userinfo_resp) as get_mock,
        patch("authlib.jose.JsonWebKey.import_key_set", return_value=MagicMock()),
        patch("authlib.jose.jwt.decode", return_value=FakeClaims(claims)),
    ):
        yield {"post": post_mock, "get": get_mock}


def _call_callback(client, provider):
    return client.post(
        f"/api/v2/auth/oauth/{provider}/callback",
        json={"code": "auth-code", "state": "state-token"},
    )


def _oauth_account(provider, provider_user_id):
    return OAuthAccount.query.filter_by(
        provider=provider, provider_user_id=provider_user_id
    ).first()


def _native_state(flow="login", link_user_id=None):
    nonce = "native-nonce-123"
    state = app_module._generate_oauth_state(
        "google",
        None,
        nonce,
        flow=flow,
        link_user_id=link_user_id,
        channel="native_google",
    )
    return state, nonce


@contextmanager
def _mock_native_google_token(client_id, claims):
    metadata = {
        "issuer": "https://accounts.google.com",
        "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
    }
    with (
        patch("app.get_enabled_oauth_providers", return_value=["google"]),
        patch("app._get_oidc_metadata", return_value=metadata),
        patch("app._get_jwks", return_value={"keys": [{"kid": "1"}]}),
        patch("authlib.jose.JsonWebKey.import_key_set", return_value=MagicMock()),
        patch("authlib.jose.jwt.decode", return_value=FakeClaims(claims)),
    ):
        yield


class TestNativeGoogleOAuth:
    def test_start_login_returns_public_client_binding(self, client, db_session, monkeypatch):
        client_id = _set_provider_config(monkeypatch, "google")
        response = client.post(
            "/api/v2/auth/oauth/google/native/start", json={"flow": "login"}
        )

        assert response.status_code == 200
        payload = response.get_json()["data"]
        assert payload["client_id"] == client_id
        assert payload["nonce"]
        state = app_module.jwt.decode(
            payload["state"], app_module.JWT_SECRET_KEY, algorithms=["HS256"]
        )
        assert state["provider"] == "google"
        assert state["flow"] == "login"
        assert state["channel"] == "native_google"
        assert state["id_token_nonce"] == payload["nonce"]
        assert "client_secret" not in payload

    def test_start_rejects_invalid_flow(self, client, db_session, monkeypatch):
        _set_provider_config(monkeypatch, "google")
        response = client.post(
            "/api/v2/auth/oauth/google/native/start", json={"flow": "elevate"}
        )
        assert response.status_code == 400
        assert response.get_json()["error"] == "Invalid OAuth flow"

    def test_start_link_requires_authentication(self, client, db_session, monkeypatch):
        _set_provider_config(monkeypatch, "google")
        response = client.post(
            "/api/v2/auth/oauth/google/native/start", json={"flow": "link"}
        )
        assert response.status_code == 401

    def test_login_verifies_token_and_issues_session(
        self, client, db_session, admin_user, monkeypatch
    ):
        client_id = _set_provider_config(monkeypatch, "google")
        sub = "native-google-user"
        _link_account(db_session, admin_user, "google", sub)
        state, nonce = _native_state()
        claims = {
            "iss": "https://accounts.google.com",
            "aud": client_id,
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "nonce": nonce,
            "sub": sub,
            "email": "admin@test.com",
            "email_verified": True,
        }
        with _mock_native_google_token(client_id, claims):
            response = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json={"id_token": "provider-id-token", "state": state},
            )

        assert response.status_code == 200
        payload = response.get_json()["data"]
        assert payload["access_token"]
        assert payload["refresh_token"]
        assert payload["user"]["id"] == admin_user.id

    @pytest.mark.parametrize(
        ("claim", "value", "error"),
        [
            ("iss", "https://evil.example", "ID token issuer mismatch"),
            ("aud", "wrong-client", "ID token audience mismatch"),
            ("nonce", "wrong-nonce", "ID token nonce mismatch"),
        ],
    )
    def test_callback_rejects_identity_binding_mismatches(
        self, client, db_session, admin_user, monkeypatch, claim, value, error
    ):
        client_id = _set_provider_config(monkeypatch, "google")
        sub = f"native-{claim}-user"
        _link_account(db_session, admin_user, "google", sub)
        state, nonce = _native_state()
        claims = {
            "iss": "https://accounts.google.com",
            "aud": client_id,
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "nonce": nonce,
            "sub": sub,
            "email": "admin@test.com",
            "email_verified": True,
            claim: value,
        }
        with _mock_native_google_token(client_id, claims):
            response = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json={"id_token": "provider-id-token", "state": state},
            )
        assert response.status_code == 401
        assert response.get_json()["error"] == error

    def test_callback_rejects_browser_state(self, client, db_session, monkeypatch):
        _set_provider_config(monkeypatch, "google")
        state = app_module._generate_oauth_state(
            "google", "verifier", "nonce", channel="browser"
        )
        response = client.post(
            "/api/v2/auth/oauth/google/native/callback",
            json={"id_token": "provider-id-token", "state": state},
        )
        assert response.status_code == 400
        assert response.get_json()["error"] == "State channel mismatch"

    def test_browser_callback_rejects_native_state(
        self, client, db_session, monkeypatch
    ):
        _set_provider_config(monkeypatch, "google")
        state, _ = _native_state()
        with patch("app.get_enabled_oauth_providers", return_value=["google"]):
            response = client.post(
                "/api/v2/auth/oauth/google/callback",
                json={"code": "authorization-code", "state": state},
            )
        assert response.status_code == 400
        assert response.get_json()["error"] == "State channel mismatch"

    def test_callback_returns_bad_gateway_when_jwks_are_unavailable(
        self, client, db_session, monkeypatch
    ):
        _set_provider_config(monkeypatch, "google")
        state, _ = _native_state()
        with (
            patch("app.get_enabled_oauth_providers", return_value=["google"]),
            patch(
                "app._get_oidc_metadata",
                return_value={"issuer": "https://accounts.google.com"},
            ),
            patch("app._get_jwks", return_value=None),
        ):
            response = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json={"id_token": "provider-id-token", "state": state},
            )
        assert response.status_code == 502
        assert response.get_json()["error"] == "Failed to fetch provider signing keys"

    def test_callback_rejects_invalid_signature(
        self, client, db_session, monkeypatch
    ):
        _set_provider_config(monkeypatch, "google")
        state, _ = _native_state()
        with (
            patch("app.get_enabled_oauth_providers", return_value=["google"]),
            patch(
                "app._get_oidc_metadata",
                return_value={"issuer": "https://accounts.google.com"},
            ),
            patch("app._get_jwks", return_value={"keys": [{"kid": "1"}]}),
            patch("authlib.jose.JsonWebKey.import_key_set", return_value=MagicMock()),
            patch("authlib.jose.jwt.decode", side_effect=ValueError("invalid token")),
        ):
            response = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json={"id_token": "provider-id-token", "state": state},
            )
        assert response.status_code == 401
        assert response.get_json()["error"] == "Failed to verify ID token"

    def test_callback_requires_authorized_party_for_multiple_audiences(
        self, client, db_session, admin_user, monkeypatch
    ):
        client_id = _set_provider_config(monkeypatch, "google")
        sub = "native-multiple-audiences"
        _link_account(db_session, admin_user, "google", sub)
        state, nonce = _native_state()
        claims = {
            "iss": "https://accounts.google.com",
            "aud": [client_id, "another-client"],
            "azp": "another-client",
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "nonce": nonce,
            "sub": sub,
        }
        with _mock_native_google_token(client_id, claims):
            response = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json={"id_token": "provider-id-token", "state": state},
            )
        assert response.status_code == 401
        assert response.get_json()["error"] == "ID token audience mismatch"

    def test_callback_replay_is_rejected(
        self, client, db_session, admin_user, monkeypatch
    ):
        client_id = _set_provider_config(monkeypatch, "google")
        sub = "native-replay-user"
        _link_account(db_session, admin_user, "google", sub)
        state, nonce = _native_state()
        claims = {
            "iss": "https://accounts.google.com",
            "aud": client_id,
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "nonce": nonce,
            "sub": sub,
            "email": "admin@test.com",
            "email_verified": True,
        }
        with _mock_native_google_token(client_id, claims):
            first = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json={"id_token": "provider-id-token", "state": state},
            )
            second = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json={"id_token": "provider-id-token", "state": state},
            )

        assert first.status_code == 200
        assert second.status_code == 400
        assert second.get_json()["error"] == "Invalid or expired state"
        assert OAuthStateUse.query.count() == 1

    def test_link_reauthenticates_same_user_and_issues_no_tokens(
        self, client, db_session, admin_user, monkeypatch
    ):
        client_id = _set_provider_config(monkeypatch, "google")
        access_token = app_module.create_access_token(admin_user.id, admin_user.role)
        headers = {"Authorization": f"Bearer {access_token}"}
        start = client.post(
            "/api/v2/auth/oauth/google/native/start",
            json={"flow": "link"},
            headers=headers,
        )
        start_data = start.get_json()["data"]
        claims = {
            "iss": "accounts.google.com",
            "aud": client_id,
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "nonce": start_data["nonce"],
            "sub": "native-link-user",
            "email": "linked@gmail.com",
            "email_verified": True,
        }
        with _mock_native_google_token(client_id, claims):
            response = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json={"id_token": "provider-id-token", "state": start_data["state"]},
                headers=headers,
            )

        assert response.status_code == 200
        assert response.get_json() == {"success": True, "data": {"linked": True}}
        assert _oauth_account("google", "native-link-user").user_id == admin_user.id

    def test_missing_link_bearer_does_not_consume_state_and_retry_succeeds(
        self, client, db_session, admin_user, monkeypatch
    ):
        client_id = _set_provider_config(monkeypatch, "google")
        access_token = app_module.create_access_token(admin_user.id, admin_user.role)
        headers = {"Authorization": f"Bearer {access_token}"}
        start = client.post(
            "/api/v2/auth/oauth/google/native/start",
            json={"flow": "link"},
            headers=headers,
        )
        start_data = start.get_json()["data"]
        callback_body = {
            "id_token": "provider-id-token",
            "state": start_data["state"],
        }
        claims = {
            "iss": "https://accounts.google.com",
            "aud": client_id,
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "nonce": start_data["nonce"],
            "sub": "native-link-retry-user",
            "email": "linked.retry@gmail.com",
            "email_verified": True,
        }

        with _mock_native_google_token(client_id, claims):
            missing_bearer = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json=callback_body,
            )
            assert OAuthStateUse.query.count() == 0

            invalid_bearer = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json=callback_body,
                headers={"Authorization": "Bearer invalid-token"},
            )
            assert OAuthStateUse.query.count() == 0

            retried = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json=callback_body,
                headers=headers,
            )

        assert missing_bearer.status_code == 401
        assert invalid_bearer.status_code == 401
        assert retried.status_code == 200
        assert retried.get_json() == {"success": True, "data": {"linked": True}}
        assert OAuthStateUse.query.count() == 1
        assert (
            _oauth_account("google", "native-link-retry-user").user_id
            == admin_user.id
        )

    def test_new_identity_rejects_non_authoritative_third_party_email(
        self, client, db_session, monkeypatch
    ):
        client_id = _set_provider_config(monkeypatch, "google")
        state, nonce = _native_state()
        claims = {
            "iss": "https://accounts.google.com",
            "aud": client_id,
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "nonce": nonce,
            "sub": "native-third-party-email",
            "email": "person@example.com",
            "email_verified": True,
        }
        with _mock_native_google_token(client_id, claims):
            response = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json={"id_token": "provider-id-token", "state": state},
            )
        assert response.status_code == 401
        assert response.get_json()["error"] == (
            "Google email cannot be used to create or link this account"
        )
        assert _oauth_account("google", "native-third-party-email") is None

    def test_new_workspace_identity_accepts_verified_hosted_domain_email(
        self, client, db_session, monkeypatch
    ):
        # SaaS deliberately disables OAuth auto-registration by default; this
        # test isolates Google email authority from that deployment policy.
        monkeypatch.setattr(app_module, "OAUTH_AUTO_REGISTER", True)
        client_id = _set_provider_config(monkeypatch, "google")
        state, nonce = _native_state()
        claims = {
            "iss": "https://accounts.google.com",
            "aud": client_id,
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "nonce": nonce,
            "sub": "native-workspace-email",
            "email": "person@example.com",
            "email_verified": True,
            "hd": "example.com",
        }
        with _mock_native_google_token(client_id, claims):
            response = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json={"id_token": "provider-id-token", "state": state},
            )
        assert response.status_code == 200
        assert _oauth_account("google", "native-workspace-email") is not None

    def test_link_callback_rejects_different_authenticated_user(
        self, client, db_session, admin_user, monkeypatch
    ):
        _set_provider_config(monkeypatch, "google")
        other = User(username="other", role="user", email="other@example.com")
        other.set_password("password-123")
        db_session.add(other)
        db_session.commit()
        state, _ = _native_state(flow="link", link_user_id=admin_user.id)
        other_token = app_module.create_access_token(other.id, other.role)
        response = client.post(
            "/api/v2/auth/oauth/google/native/callback",
            json={"id_token": "provider-id-token", "state": state},
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert response.status_code == 401
        assert response.get_json()["error"] == "Link session user mismatch"

    def test_existing_user_twofa_uses_normal_challenge(
        self, client, db_session, admin_user, monkeypatch
    ):
        client_id = _set_provider_config(monkeypatch, "google")
        sub = "native-twofa-user"
        _link_account(db_session, admin_user, "google", sub)
        db_session.add(
            TwoFAConfig(
                user_id=admin_user.id,
                passkey_enabled=True,
                email_otp_enabled=False,
            )
        )
        db_session.commit()
        state, nonce = _native_state()
        claims = {
            "iss": "https://accounts.google.com",
            "aud": client_id,
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "nonce": nonce,
            "sub": sub,
            "email": "admin@test.com",
            "email_verified": True,
        }
        with _mock_native_google_token(client_id, claims):
            response = client.post(
                "/api/v2/auth/oauth/google/native/callback",
                json={"id_token": "provider-id-token", "state": state},
            )
        assert response.status_code == 403
        payload = response.get_json()
        assert payload["twofa_required"] is True
        assert payload["twofa_methods"] == ["passkey", "recovery"]
        assert payload["twofa_session_token"]


def test_oauth_state_replay_migration_supports_sqlite():
    engine = create_engine("sqlite://")
    migration_db = SimpleNamespace(engine=engine, session=Session(engine))
    try:
        db_migrations_module.migrate_20260812_01_create_oauth_state_uses(
            migration_db
        )
        table_names = inspect(engine).get_table_names()
        indexes = inspect(engine).get_indexes("oauth_state_uses")
        assert "oauth_state_uses" in table_names
        assert any(
            index["name"] == "idx_oauth_state_uses_expires_at" for index in indexes
        )
    finally:
        migration_db.session.close()
        engine.dispose()


class TestNativeRedirectUris:
    """Native callbacks are exact-allowlisted and bound into OAuth state."""

    def test_authorize_uses_official_mobile_callback(self, client, monkeypatch):
        provider = "google"
        _set_provider_config(monkeypatch, provider)
        metadata = {
            "authorization_endpoint": "https://issuer.example/google/authorize",
        }

        with (
            patch("app.get_enabled_oauth_providers", return_value=[provider]),
            patch("app._get_oidc_metadata", return_value=metadata),
        ):
            response = client.get(
                f"/api/v2/auth/oauth/{provider}/authorize",
                query_string={"redirect_uri": "billmanager://auth/callback"},
            )

        assert response.status_code == 200
        data = response.get_json()["data"]
        params = parse_qs(urlparse(data["auth_url"]).query)
        assert data["redirect_uri"] == "billmanager://auth/callback"
        assert params["redirect_uri"] == ["billmanager://auth/callback"]

    def test_authorize_rejects_unlisted_callback(self, client, monkeypatch):
        provider = "google"
        _set_provider_config(monkeypatch, provider)

        with patch("app.get_enabled_oauth_providers", return_value=[provider]):
            response = client.get(
                f"/api/v2/auth/oauth/{provider}/authorize",
                query_string={"redirect_uri": "https://attacker.example/callback"},
            )

        assert response.status_code == 400
        assert response.get_json()["error"] == "Redirect URI is not allowed"

    def test_callback_reuses_redirect_bound_to_state(
        self, client, db_session, admin_user, monkeypatch
    ):
        provider = "google"
        client_id = _set_provider_config(monkeypatch, provider)
        sub = "google-native-user"
        _link_account(db_session, admin_user, provider, sub)
        claims = {
            "iss": f"https://issuer.example/{provider}",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": sub,
            "email": "admin@test.com",
            "email_verified": True,
        }

        with _mock_oauth_dependencies(
            provider,
            client_id,
            claims,
            state_overrides={"redirect_uri": "billmanager://auth/callback"},
        ) as mocks:
            response = client.post(
                f"/api/v2/auth/oauth/{provider}/callback",
                json={
                    "code": "auth-code",
                    "state": "state-token",
                    "redirect_uri": "billmanager://auth/callback",
                },
            )

        assert response.status_code == 200
        token_data = mocks["post"].call_args.kwargs["data"]
        assert token_data["redirect_uri"] == "billmanager://auth/callback"


# ---------------------------------------------------------------------------
# Bug 1: Microsoft issuer {tenantid} placeholder replacement
# ---------------------------------------------------------------------------


class TestMicrosoftIssuer:
    """Bug 1: Microsoft metadata uses {tenantid} placeholder in issuer."""

    def test_tenantid_placeholder_replaced(
        self, client, db_session, admin_user, monkeypatch
    ):
        """Issuer with {tenantid} should be replaced by token tid claim."""
        provider = "microsoft"
        client_id = _set_provider_config(monkeypatch, provider)
        sub = "ms-user-1"
        _link_account(db_session, admin_user, provider, sub)

        claims = {
            "iss": "https://login.microsoftonline.com/tenant-abc/v2.0",
            "tid": "tenant-abc",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": sub,
            "email": "admin@test.com",
        }

        with _mock_oauth_dependencies(
            provider,
            client_id,
            claims,
            metadata_overrides={
                "issuer": "https://login.microsoftonline.com/{tenantid}/v2.0"
            },
        ):
            response = _call_callback(client, provider)

        assert response.status_code == 200
        assert response.get_json()["success"] is True

    def test_specific_tenant_issuer_no_placeholder(
        self, client, db_session, admin_user, monkeypatch
    ):
        """Issuer without {tenantid} should work as-is."""
        provider = "microsoft"
        client_id = _set_provider_config(monkeypatch, provider)
        sub = "ms-user-2"
        _link_account(db_session, admin_user, provider, sub)

        claims = {
            "iss": "https://login.microsoftonline.com/tenant-fixed/v2.0",
            "tid": "tenant-fixed",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": sub,
            "email": "admin@test.com",
        }

        with _mock_oauth_dependencies(
            provider,
            client_id,
            claims,
            metadata_overrides={
                "issuer": "https://login.microsoftonline.com/tenant-fixed/v2.0"
            },
        ):
            response = _call_callback(client, provider)

        assert response.status_code == 200
        assert response.get_json()["success"] is True

    def test_issuer_mismatch_rejected(self, client, monkeypatch):
        """Mismatched issuer should return 401."""
        provider = "microsoft"
        client_id = _set_provider_config(monkeypatch, provider)

        claims = {
            "iss": "https://login.microsoftonline.com/tenant-b/v2.0",
            "tid": "tenant-b",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": "ms-user-3",
            "email": "admin@test.com",
        }

        with _mock_oauth_dependencies(
            provider,
            client_id,
            claims,
            metadata_overrides={
                "issuer": "https://login.microsoftonline.com/tenant-a/v2.0"
            },
        ):
            response = _call_callback(client, provider)

        assert response.status_code == 401
        assert response.get_json()["error"] == "ID token issuer mismatch"


# ---------------------------------------------------------------------------
# Generic OIDC token endpoint client authentication
# ---------------------------------------------------------------------------


class TestOidcTokenEndpointAuth:
    """Self-hosted IdPs may require different token endpoint auth methods."""

    def test_client_secret_basic_uses_http_basic_auth(
        self, client, db_session, admin_user, monkeypatch
    ):
        """Generic OIDC can authenticate the token request with HTTP Basic."""
        provider = "oidc"
        client_id = _set_provider_config(monkeypatch, provider)
        OAUTH_PROVIDERS[provider]["token_auth_method"] = "client_secret_basic"
        sub = "oidc-basic-user"
        _link_account(db_session, admin_user, provider, sub)

        claims = {
            "iss": f"https://issuer.example/{provider}",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": sub,
            "email": "admin@test.com",
            "email_verified": True,
        }

        with _mock_oauth_dependencies(provider, client_id, claims) as mocks:
            response = _call_callback(client, provider)

        token_request = mocks["post"].call_args
        assert response.status_code == 200
        assert response.get_json()["success"] is True
        assert token_request.kwargs["auth"] == (client_id, "test-client-secret")
        assert "client_secret" not in token_request.kwargs["data"]
        assert "client_id" not in token_request.kwargs["data"]

    def test_public_oidc_client_can_be_enabled_without_secret(self, monkeypatch):
        """Generic OIDC public clients can opt into token_auth_method=none."""
        monkeypatch.setitem(
            OAUTH_PROVIDERS,
            "oidc",
            {
                "enabled": True,
                "client_id": "public-client",
                "client_secret": None,
                "token_auth_method": "none",
                "discovery_url": "https://issuer.example/oidc/.well-known/openid-configuration",
                "scopes": "openid email profile",
                "display_name": "SSO",
                "icon": "lock",
            },
        )

        assert "oidc" in config.get_enabled_oauth_providers()


# ---------------------------------------------------------------------------
# Bug 2: Userinfo fetch when email missing from ID token
# ---------------------------------------------------------------------------


class TestUserinfoFetch:
    """Bug 2: OIDC claim mapping + userinfo endpoint fetch + sub validation."""

    def test_email_fetched_from_userinfo(
        self, client, db_session, admin_user, monkeypatch
    ):
        """When email is missing from ID token, fetch from userinfo endpoint."""
        provider = "google"
        client_id = _set_provider_config(monkeypatch, provider)
        sub = "google-user-10"
        _link_account(db_session, admin_user, provider, sub)

        claims = {
            "iss": f"https://issuer.example/{provider}",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": sub,
            "email_verified": True,
        }

        with _mock_oauth_dependencies(
            provider,
            client_id,
            claims,
            userinfo_payload={"sub": sub, "email": "userinfo@example.com"},
        ) as mocks:
            response = _call_callback(client, provider)

        account = _oauth_account(provider, sub)
        assert response.status_code == 200
        assert response.get_json()["success"] is True
        assert account is not None
        assert account.provider_email == "userinfo@example.com"
        mocks["get"].assert_called_once()

    def test_sub_mismatch_discards_userinfo(
        self, client, db_session, admin_user, monkeypatch
    ):
        """Userinfo with different sub should be discarded (OIDC spec §5.3.2)."""
        provider = "google"
        client_id = _set_provider_config(monkeypatch, provider)
        sub = "google-user-11"
        _link_account(db_session, admin_user, provider, sub)

        claims = {
            "iss": f"https://issuer.example/{provider}",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": sub,
            "email_verified": True,
        }

        with _mock_oauth_dependencies(
            provider,
            client_id,
            claims,
            userinfo_payload={
                "sub": "different-sub",
                "email": "mismatch@example.com",
            },
        ) as mocks:
            response = _call_callback(client, provider)

        account = _oauth_account(provider, sub)
        assert response.status_code == 200
        assert response.get_json()["success"] is True
        assert account is not None
        assert account.provider_email is None
        mocks["get"].assert_called_once()

    def test_no_userinfo_endpoint_graceful(
        self, client, db_session, admin_user, monkeypatch
    ):
        """Missing userinfo endpoint should not crash — email stays None."""
        provider = "google"
        client_id = _set_provider_config(monkeypatch, provider)
        sub = "google-user-12"
        _link_account(db_session, admin_user, provider, sub)

        claims = {
            "iss": f"https://issuer.example/{provider}",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": sub,
            "email_verified": True,
        }

        with _mock_oauth_dependencies(
            provider,
            client_id,
            claims,
            metadata_overrides={"userinfo_endpoint": None},
        ) as mocks:
            response = _call_callback(client, provider)

        account = _oauth_account(provider, sub)
        assert response.status_code == 200
        assert response.get_json()["success"] is True
        assert account is not None
        assert account.provider_email is None
        mocks["get"].assert_not_called()


# ---------------------------------------------------------------------------
# Bug 3: Trusted provider email_verified bypass
# ---------------------------------------------------------------------------


class TestEmailVerified:
    """Bug 3: Trusted providers skip email_verified; OIDC has env var toggle."""

    def test_microsoft_trusted_no_email_verified(
        self, client, db_session, admin_user, monkeypatch
    ):
        """Microsoft is trusted — missing email_verified should not block login."""
        provider = "microsoft"
        client_id = _set_provider_config(monkeypatch, provider)
        sub = "ms-user-4"
        _link_account(db_session, admin_user, provider, sub)

        claims = {
            "iss": f"https://issuer.example/{provider}",
            "tid": "tenant-xyz",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": sub,
            "email": "admin@test.com",
        }

        with _mock_oauth_dependencies(provider, client_id, claims):
            response = _call_callback(client, provider)

        assert response.status_code == 200
        assert response.get_json()["success"] is True

    def test_google_no_email_verified_rejected(self, client, monkeypatch):
        """Google without email_verified=true should be rejected."""
        provider = "google"
        client_id = _set_provider_config(monkeypatch, provider)

        claims = {
            "iss": f"https://issuer.example/{provider}",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": "google-user-1",
            "email": "admin@test.com",
        }

        with _mock_oauth_dependencies(provider, client_id, claims):
            response = _call_callback(client, provider)

        assert response.status_code == 401
        assert response.get_json()["error"] == "Provider email is not verified"

    def test_oidc_skip_verification_enabled(
        self, client, db_session, admin_user, monkeypatch
    ):
        """OIDC with SKIP_EMAIL_VERIFICATION=true should allow unverified emails."""
        provider = "oidc"
        client_id = _set_provider_config(monkeypatch, provider)
        sub = "oidc-user-1"
        _link_account(db_session, admin_user, provider, sub)
        monkeypatch.setattr(config, "OAUTH_OIDC_SKIP_EMAIL_VERIFICATION", True)

        claims = {
            "iss": f"https://issuer.example/{provider}",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": sub,
            "email": "admin@test.com",
        }

        with _mock_oauth_dependencies(provider, client_id, claims):
            response = _call_callback(client, provider)

        assert response.status_code == 200
        assert response.get_json()["success"] is True

    def test_oidc_skip_verification_disabled(self, client, monkeypatch):
        """OIDC with SKIP_EMAIL_VERIFICATION=false should reject unverified emails."""
        provider = "oidc"
        client_id = _set_provider_config(monkeypatch, provider)
        monkeypatch.setattr(config, "OAUTH_OIDC_SKIP_EMAIL_VERIFICATION", False)

        claims = {
            "iss": f"https://issuer.example/{provider}",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": "oidc-user-2",
            "email": "admin@test.com",
        }

        with _mock_oauth_dependencies(provider, client_id, claims):
            response = _call_callback(client, provider)

        assert response.status_code == 401
        assert response.get_json()["error"] == "Provider email is not verified"


# ---------------------------------------------------------------------------
# Bug 4: Email fallback from preferred_username
# ---------------------------------------------------------------------------


class TestEmailFallback:
    """Bug 4: preferred_username used as email fallback with format validation."""

    def test_preferred_username_as_email(
        self, client, db_session, admin_user, monkeypatch
    ):
        """Valid email in preferred_username should be used and lowercased."""
        provider = "microsoft"
        client_id = _set_provider_config(monkeypatch, provider)
        sub = "ms-user-8"
        _link_account(db_session, admin_user, provider, sub)

        claims = {
            "iss": f"https://issuer.example/{provider}",
            "tid": "tenant-fallback",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": sub,
            "preferred_username": "Fallback.User@Example.COM",
        }

        with _mock_oauth_dependencies(provider, client_id, claims):
            response = _call_callback(client, provider)

        account = _oauth_account(provider, sub)
        assert response.status_code == 200
        assert response.get_json()["success"] is True
        assert account is not None
        assert account.provider_email == "fallback.user@example.com"

    def test_phone_number_in_preferred_username_ignored(
        self, client, db_session, admin_user, monkeypatch
    ):
        """Phone number in preferred_username should NOT be used as email."""
        provider = "microsoft"
        client_id = _set_provider_config(monkeypatch, provider)
        sub = "ms-user-9"
        _link_account(
            db_session, admin_user, provider, sub, provider_email="before@test.com"
        )

        claims = {
            "iss": f"https://issuer.example/{provider}",
            "tid": "tenant-phone",
            "aud": client_id,
            "nonce": "nonce-123",
            "sub": sub,
            "preferred_username": "+15551234567",
        }

        with _mock_oauth_dependencies(provider, client_id, claims):
            response = _call_callback(client, provider)

        account = _oauth_account(provider, sub)
        assert response.status_code == 200
        assert response.get_json()["success"] is True
        assert account is not None
        assert account.provider_email is None
