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
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Self-contained fixtures (override conftest's PostgreSQL-dependent versions)
# ---------------------------------------------------------------------------

config = importlib.import_module("config")
app_module = importlib.import_module("app")
models_module = importlib.import_module("models")
OAUTH_PROVIDERS = app_module.OAUTH_PROVIDERS
OAuthAccount = models_module.OAuthAccount
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
    application.config.update({"TESTING": True, "WTF_CSRF_ENABLED": False})

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
    metadata = {
        "issuer": f"https://issuer.example/{provider}",
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
