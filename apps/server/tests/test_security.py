import datetime
import json

from models import BillShare, User, UserInvite
from services import telemetry_receiver


def _future(hours=1):
    return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=hours)


class TestOneTimeTokenStorage:
    def test_password_change_token_is_hashed_at_rest(self, client, app, db_session):
        with app.app_context():
            user = User(username="changeme", role="user", password_change_required=True)
            user.set_password("Initialpassword123")
            db_session.add(user)
            db_session.commit()

            response = client.post(
                "/api/v2/auth/login",
                json={"username": "changeme", "password": "Initialpassword123"},
            )

            assert response.status_code == 403
            data = json.loads(response.data)
            raw_token = data["change_token"]

            db_session.refresh(user)
            assert user.change_token != raw_token
            assert len(user.change_token) == 64
            assert User.find_by_change_token(raw_token).id == user.id
            assert user.verify_change_token(raw_token) is True

    def test_user_tokens_support_hashed_storage_and_legacy_raw_values(self, app, db_session):
        with app.app_context():
            user = User(username="tokens", role="user", email="tokens@example.com")
            db_session.add(user)
            db_session.commit()

            email_token = user.generate_email_verification_token()
            reset_token = user.generate_password_reset_token()
            change_token = user.generate_change_token(datetime.timedelta(hours=1))
            db_session.commit()

            assert user.email_verification_token != email_token
            assert user.password_reset_token != reset_token
            assert user.change_token != change_token

            assert User.find_by_email_verification_token(email_token).id == user.id
            assert User.find_by_password_reset_token(reset_token).id == user.id
            assert User.find_by_change_token(change_token).id == user.id

            assert user.verify_email_token(email_token) is True
            assert user.verify_password_reset_token(reset_token) is True
            assert user.verify_change_token(change_token) is True

            legacy_email = "legacy-email-token"
            legacy_reset = "legacy-reset-token"
            legacy_change = "legacy-change-token"
            user.email_verification_token = legacy_email
            user.email_verification_expires = _future()
            user.password_reset_token = legacy_reset
            user.password_reset_expires = _future()
            user.change_token = legacy_change
            user.change_token_expires = _future()
            db_session.commit()

            assert User.find_by_email_verification_token(legacy_email).id == user.id
            assert User.find_by_password_reset_token(legacy_reset).id == user.id
            assert User.find_by_change_token(legacy_change).id == user.id

            assert user.verify_email_token(legacy_email) is True
            assert user.verify_password_reset_token(legacy_reset) is True
            assert user.verify_change_token(legacy_change) is True

    def test_invite_and_share_tokens_are_hashed_at_rest(self, app, db_session, admin_user, test_bill):
        with app.app_context():
            invite = UserInvite(
                email="invitee@example.com",
                role="user",
                invited_by_id=admin_user.id,
                expires_at=_future(24),
            )
            raw_invite_token = invite.set_token()
            db_session.add(invite)

            share = BillShare(
                bill_id=test_bill.id,
                owner_user_id=admin_user.id,
                shared_with_identifier="sharee@example.com",
                identifier_type="email",
                status="pending",
                expires_at=_future(24),
            )
            raw_share_token = share.set_invite_token()
            db_session.add(share)
            db_session.commit()

            assert invite.token != raw_invite_token
            assert share.invite_token != raw_share_token

            assert UserInvite.find_by_token(raw_invite_token).id == invite.id
            assert BillShare.find_by_invite_token(raw_share_token).id == share.id

            assert invite.verify_token(raw_invite_token) is True
            assert share.verify_invite_token(raw_share_token) is True


class TestTelemetryRateLimitProxyHandling:
    def test_rate_limit_ignores_spoofed_forwarded_for_without_trusted_proxy(self, app, monkeypatch):
        monkeypatch.setattr(telemetry_receiver, "TELEMETRY_TRUSTED_PROXY_IPS", set())

        with app.test_request_context(
            "/api/telemetry",
            headers={"X-Forwarded-For": "203.0.113.7"},
            environ_base={"REMOTE_ADDR": "198.51.100.10"},
        ):
            assert telemetry_receiver._get_rate_limit_ip() == "198.51.100.10"

    def test_rate_limit_uses_forwarded_for_from_trusted_proxy(self, app, monkeypatch):
        monkeypatch.setattr(telemetry_receiver, "TELEMETRY_TRUSTED_PROXY_IPS", {"127.0.0.1"})

        with app.test_request_context(
            "/api/telemetry",
            headers={"X-Forwarded-For": "203.0.113.7, 127.0.0.1"},
            environ_base={"REMOTE_ADDR": "127.0.0.1"},
        ):
            assert telemetry_receiver._get_rate_limit_ip() == "203.0.113.7"
