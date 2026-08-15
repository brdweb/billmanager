"""
Tests for provider-neutral outbound email.
"""

import importlib
from types import SimpleNamespace

from services.email_config import get_email_config


EMAIL_ENV_KEYS = (
    "EMAIL_PROVIDER",
    "RESEND_API_KEY",
    "FROM_EMAIL",
    "APP_URL",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USERNAME",
    "SMTP_PASSWORD",
    "SMTP_USE_TLS",
    "SMTP_USE_SSL",
    "SMTP_TIMEOUT",
)


class FakeSMTP:
    instances = []

    def __init__(self, host, port, timeout):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.started_tls = False
        self.login_args = None
        self.message = None
        self.closed = False
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.closed = True

    def starttls(self):
        self.started_tls = True

    def login(self, username, password):
        self.login_args = (username, password)

    def send_message(self, message):
        self.message = message


class FailingSMTP(FakeSMTP):
    def send_message(self, message):
        raise RuntimeError("SMTP send failed")


def _clear_email_env(monkeypatch):
    for key in EMAIL_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def _reload_email_service(monkeypatch, **env):
    _clear_email_env(monkeypatch)
    for key, value in env.items():
        monkeypatch.setenv(key, str(value))

    import services.email as email_service

    return importlib.reload(email_service)


def _html_parts(message):
    return [
        part.get_content()
        for part in message.walk()
        if part.get_content_type() == "text/html"
    ]


def test_email_config_selects_smtp_when_smtp_host_is_configured():
    config = get_email_config({"SMTP_HOST": "smtp.example.com"})

    assert config.provider == "smtp"
    assert config.is_configured is True
    assert config.smtp.port == 587


def test_email_config_prefers_legacy_resend_when_api_key_exists():
    config = get_email_config(
        {"RESEND_API_KEY": "re_test", "SMTP_HOST": "smtp.example.com"}
    )

    assert config.provider == "resend"
    assert config.is_configured is True


def test_email_config_allows_explicit_smtp_to_override_resend():
    config = get_email_config(
        {
            "EMAIL_PROVIDER": "smtp",
            "RESEND_API_KEY": "re_test",
            "SMTP_HOST": "smtp.example.com",
        }
    )

    assert config.provider == "smtp"
    assert config.is_configured is True


def test_email_config_is_disabled_without_provider_settings():
    config = get_email_config({})

    assert config.provider == "none"
    assert config.is_configured is False


def test_smtp_send_uses_starttls_auth_and_expected_message(monkeypatch):
    FakeSMTP.instances = []
    email_service = _reload_email_service(
        monkeypatch,
        EMAIL_PROVIDER="smtp",
        SMTP_HOST="smtp.example.com",
        SMTP_PORT="2525",
        SMTP_USERNAME="smtp-user",
        SMTP_PASSWORD="smtp-pass",
        SMTP_USE_TLS="true",
        SMTP_USE_SSL="false",
        SMTP_TIMEOUT="7",
        FROM_EMAIL="billing@example.com",
    )
    monkeypatch.setattr(email_service.smtplib, "SMTP", FakeSMTP)

    sent = email_service.send_email("user@example.com", "Test subject", "<p>Hello</p>")

    assert sent is True
    smtp = FakeSMTP.instances[0]
    assert smtp.host == "smtp.example.com"
    assert smtp.port == 2525
    assert smtp.timeout == 7.0
    assert smtp.started_tls is True
    assert smtp.login_args == ("smtp-user", "smtp-pass")
    assert smtp.message["From"] == "billing@example.com"
    assert smtp.message["To"] == "user@example.com"
    assert smtp.message["Subject"] == "Test subject"
    assert "<p>Hello</p>" in _html_parts(smtp.message)[0]


def test_smtp_send_supports_ssl_without_auth(monkeypatch):
    FakeSMTP.instances = []
    email_service = _reload_email_service(
        monkeypatch,
        EMAIL_PROVIDER="smtp",
        SMTP_HOST="mail-relay.local",
        SMTP_USE_SSL="true",
        SMTP_USE_TLS="false",
        FROM_EMAIL="billing@example.com",
    )
    monkeypatch.setattr(email_service.smtplib, "SMTP_SSL", FakeSMTP)

    sent = email_service.send_email("user@example.com", "SSL subject", "<p>SSL</p>")

    assert sent is True
    smtp = FakeSMTP.instances[0]
    assert smtp.host == "mail-relay.local"
    assert smtp.port == 465
    assert smtp.started_tls is False
    assert smtp.login_args is None


def test_smtp_send_fails_when_host_is_missing(monkeypatch):
    FakeSMTP.instances = []
    email_service = _reload_email_service(monkeypatch, EMAIL_PROVIDER="smtp")
    monkeypatch.setattr(email_service.smtplib, "SMTP", FakeSMTP)

    sent = email_service.send_email("user@example.com", "Missing host", "<p>Nope</p>")

    assert sent is False
    assert FakeSMTP.instances == []


def test_smtp_send_returns_false_on_delivery_error(monkeypatch):
    FakeSMTP.instances = []
    email_service = _reload_email_service(
        monkeypatch,
        EMAIL_PROVIDER="smtp",
        SMTP_HOST="smtp.example.com",
        FROM_EMAIL="billing@example.com",
    )
    monkeypatch.setattr(email_service.smtplib, "SMTP", FailingSMTP)

    sent = email_service.send_email("user@example.com", "Failure", "<p>Nope</p>")

    assert sent is False
    assert FakeSMTP.instances[0].closed is True


def test_resend_remains_default_when_api_key_exists(monkeypatch):
    email_service = _reload_email_service(
        monkeypatch,
        RESEND_API_KEY="re_test",
        FROM_EMAIL="billing@example.com",
    )

    class FakeEmails:
        params = None

        @staticmethod
        def send(params):
            FakeEmails.params = params
            return {"id": "email_123"}

    fake_resend = SimpleNamespace(Emails=FakeEmails, api_key=None)
    monkeypatch.setattr(email_service, "RESEND_AVAILABLE", True)
    monkeypatch.setattr(email_service, "resend", fake_resend, raising=False)

    sent = email_service.send_email("user@example.com", "Resend subject", "<p>Hi</p>")

    assert sent is True
    assert fake_resend.api_key == "re_test"
    assert FakeEmails.params == {
        "from": "billing@example.com",
        "to": ["user@example.com"],
        "subject": "Resend subject",
        "html": "<p>Hi</p>",
    }


def test_transactional_helpers_keep_existing_send_contract(monkeypatch):
    email_service = _reload_email_service(
        monkeypatch,
        EMAIL_PROVIDER="none",
        APP_URL="https://bills.example.com",
    )
    calls = []
    monkeypatch.setattr(
        email_service,
        "send_email",
        lambda to, subject, html: calls.append((to, subject, html)) or True,
    )

    assert email_service.send_verification_email("user@example.com", "token", "User")
    assert email_service.send_password_reset_email("user@example.com", "token", "User")
    assert email_service.send_invite_email("invite@example.com", "token", "Admin")
    assert email_service.send_welcome_email("user@example.com", "User")
    assert email_service.send_2fa_code_email("user@example.com", "123456", "User")
    assert email_service.send_bill_share_email(
        "share@example.com", "token", "Rent", "Admin"
    )

    assert len(calls) == 6
    assert any(
        "https://bills.example.com/reset-password?token=token" in c[2] for c in calls
    )


def test_bill_share_email_escapes_untrusted_html(monkeypatch):
    email_service = _reload_email_service(
        monkeypatch,
        EMAIL_PROVIDER="none",
        APP_URL="https://bills.example.com",
    )
    calls = []
    monkeypatch.setattr(
        email_service,
        "send_email",
        lambda to, subject, html: calls.append((to, subject, html)) or True,
    )

    assert email_service.send_bill_share_email(
        "share@example.com",
        "token",
        '<img src=x onerror="alert(1)">',
        "<b>Attacker</b>",
    )

    html = calls[0][2]
    assert '<img src=x onerror="alert(1)">' not in html
    assert "<b>Attacker</b>" not in html
    assert "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" in html


def test_forgot_password_does_not_enumerate_when_send_fails(
    client, db_session, monkeypatch
):
    from models import User

    user = User(
        username="resetuser",
        role="user",
        email="reset@example.com",
        password_change_required=False,
    )
    user.set_password("Password123")
    db_session.add(user)
    db_session.commit()

    monkeypatch.setattr("app.send_password_reset_email", lambda *args: False)

    response = client.post(
        "/api/v2/auth/forgot-password", json={"email": "reset@example.com"}
    )
    data = response.get_json()

    assert response.status_code == 200
    assert data["success"] is True
    assert data["message"] == "If this email is registered, a reset link has been sent."
