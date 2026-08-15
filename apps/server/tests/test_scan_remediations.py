import datetime
import hashlib
from pathlib import Path

import app as app_module
from models import BillShare, Payment, RefreshToken, Subscription, TwoFAChallenge, TwoFAConfig, UserDevice, UserInvite


def _future(minutes=10):
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(minutes=minutes)


def test_refresh_token_is_consumed_once(app, db_session, regular_user):
    with app.app_context():
        raw = "single-use-refresh-token"
        db_session.add(
            RefreshToken(
                user_id=regular_user.id,
                token_hash=hashlib.sha256(raw.encode()).hexdigest(),
                expires_at=_future(),
            )
        )
        db_session.commit()

        first = app_module.consume_refresh_token(raw)
        second = app_module.consume_refresh_token(raw)

        assert first["user_id"] == regular_user.id
        assert second is None


def test_password_change_revokes_prior_refresh_session(
    client, app, db_session, regular_user
):
    with app.app_context():
        old_refresh = app_module.create_refresh_token(regular_user.id)
        access = app_module.create_access_token(regular_user.id, regular_user.role)

    changed = client.post(
        "/api/v2/auth/change-password",
        headers={"Authorization": f"Bearer {access}"},
        json={
            "current_password": "userpassword123",
            "new_password": "ReplacementPassword123!",
        },
    )
    replay = client.post("/api/v2/auth/refresh", json={"refresh_token": old_refresh})

    assert changed.status_code == 200
    assert replay.status_code == 401


def test_disabled_email_otp_cannot_complete_challenge(
    client, app, db_session, regular_user
):
    from werkzeug.security import generate_password_hash

    raw_session = "disabled-email-session"
    with app.app_context():
        db_session.add(
            TwoFAConfig(
                user_id=regular_user.id,
                email_otp_enabled=False,
                passkey_enabled=True,
            )
        )
        db_session.add(
            TwoFAChallenge(
                user_id=regular_user.id,
                token_hash=hashlib.sha256(raw_session.encode()).hexdigest(),
                challenge_type="email_otp",
                otp_code_hash=generate_password_hash("123456"),
                expires_at=_future(),
            )
        )
        db_session.commit()

    response = client.post(
        "/api/v2/auth/2fa/verify",
        json={"session_token": raw_session, "method": "email_otp", "code": "123456"},
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "2FA method is not enabled"


def test_sync_rejects_oversized_collection(client, auth_headers_with_db):
    response = client.post(
        "/api/v2/sync/push",
        headers=auth_headers_with_db,
        json={"bills": [{}] * 501},
    )
    assert response.status_code == 413
    assert response.get_json()["code"] == "sync_collection_too_large"


def test_revoked_share_recipient_cannot_edit_payment(
    client, app, db_session, admin_user, regular_user, test_bill, test_database
):
    with app.app_context():
        regular_user.accessible_databases.append(test_database)
        share = BillShare(
            bill_id=test_bill.id,
            owner_user_id=admin_user.id,
            shared_with_user_id=regular_user.id,
            shared_with_identifier=regular_user.email,
            identifier_type="email",
            status="revoked",
        )
        db_session.add(share)
        db_session.flush()
        payment = Payment(
            bill_id=test_bill.id,
            share_id=share.id,
            amount=10,
            payment_date="2026-08-15",
        )
        db_session.add(payment)
        db_session.commit()
        payment_id = payment.id
        token = app_module.create_access_token(regular_user.id, regular_user.role)

    response = client.put(
        f"/api/v2/payments/{payment_id}",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Database": test_database.name,
        },
        json={"amount": 11},
    )
    assert response.status_code == 403


def test_saas_collaborator_cannot_create_external_share(
    client, app, db_session, regular_user, test_bill, test_database, monkeypatch
):
    monkeypatch.setattr(app_module, "is_saas", lambda: True)
    with app.app_context():
        regular_user.accessible_databases.append(test_database)
        db_session.commit()
        token = app_module.create_access_token(regular_user.id, regular_user.role)

    response = client.post(
        f"/api/v2/bills/{test_bill.id}/share",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Database": test_database.name,
        },
        json={"identifier": "outside@example.com"},
    )
    assert response.status_code == 403


def test_saas_tenant_admin_is_not_instance_operator(
    client, app, admin_user, monkeypatch
):
    monkeypatch.setattr(app_module, "is_saas", lambda: True)
    monkeypatch.delenv("INSTANCE_OPERATOR_USER_IDS", raising=False)
    with app.app_context():
        token = app_module.create_access_token(admin_user.id, admin_user.role)

    response = client.post(
        "/api/v2/notifications/reminders",
        headers={"Authorization": f"Bearer {token}"},
        json={},
    )
    assert response.status_code == 403
    assert response.get_json()["error"] == "Operator access required"


def test_device_registration_has_account_cap(
    client, app, db_session, regular_user, monkeypatch
):
    monkeypatch.setenv("MAX_PUSH_DEVICES_PER_USER", "2")
    with app.app_context():
        for index in range(2):
            db_session.add(
                UserDevice(
                    user_id=regular_user.id,
                    device_id=f"device-{index}",
                    platform="ios",
                )
            )
        db_session.commit()
        token = app_module.create_access_token(regular_user.id, regular_user.role)

    response = client.post(
        "/api/v2/devices",
        headers={"Authorization": f"Bearer {token}"},
        json={"device_id": "device-3", "platform": "ios"},
    )
    assert response.status_code == 409


def test_request_body_limit_is_enabled(app):
    assert app.config["MAX_CONTENT_LENGTH"] == 1024 * 1024


def test_oversized_json_request_is_rejected(client):
    response = client.post(
        "/api/v2/auth/login",
        data=b'"' + (b"x" * (1024 * 1024)) + b'"',
        content_type="application/json",
    )
    assert response.status_code == 413


def test_deployment_templates_fail_closed_for_secrets_and_pr_permissions():
    root = Path(__file__).resolve().parents[3]
    compose = (root / "docker-compose.yml").read_text()
    dockerignore = (root / ".dockerignore").read_text()
    dockerfile = (root / "Dockerfile").read_text()
    workflow = (root / ".github/workflows/build.yml").read_text()

    assert "JWT_SECRET_KEY=${JWT_SECRET_KEY:?" in compose
    assert "JWT_SECRET_KEY=change-me" not in compose
    assert "**/.env" in dockerignore
    assert "COPY . ." not in dockerfile
    validate_job = workflow.split("  publish:", 1)[0]
    assert "packages: write" not in validate_job


def test_deployment_mode_requires_a_signing_secret():
    source = (Path(__file__).resolve().parents[1] / "app.py").read_text()
    production_guard = source.split("if not _jwt_secret:", 1)[1].split(
        "JWT_SECRET_KEY = _jwt_secret", 1
    )[0]
    assert 'DEPLOYMENT_MODE") in {"self-hosted", "saas"}' in production_guard


def test_expired_invitation_cannot_be_resent(
    client, app, db_session, admin_user, admin_auth_headers
):
    with app.app_context():
        invite = UserInvite(
            email="expired@example.com",
            role="user",
            invited_by_id=admin_user.id,
            expires_at=_future(minutes=-1),
        )
        invite.set_token()
        db_session.add(invite)
        db_session.commit()
        invite_id = invite.id

    response = client.post(
        f"/api/v2/invitations/{invite_id}/resend",
        headers=admin_auth_headers,
    )
    assert response.status_code == 400
    assert response.get_json()["error"] == "Invitation expired"


def test_invitation_resend_rotates_raw_token(
    client, app, db_session, admin_user, admin_auth_headers, monkeypatch
):
    sent_tokens = []
    monkeypatch.setattr(
        app_module,
        "send_invite_email",
        lambda email, token, username: sent_tokens.append(token) or True,
    )
    with app.app_context():
        invite = UserInvite(
            email="active@example.com",
            role="user",
            invited_by_id=admin_user.id,
            expires_at=_future(minutes=60),
        )
        invite.set_token()
        db_session.add(invite)
        db_session.commit()
        invite_id = invite.id

    response = client.post(
        f"/api/v2/invitations/{invite_id}/resend",
        headers=admin_auth_headers,
    )
    assert response.status_code == 200
    assert len(sent_tokens) == 1
    with app.app_context():
        refreshed = db_session.get(UserInvite, invite_id)
        assert refreshed.token != sent_tokens[0]
        assert refreshed.verify_token(sent_tokens[0]) is True


def test_stripe_webhook_derives_entitlement_from_paid_price(
    client, app, db_session, regular_user, monkeypatch
):
    monkeypatch.setattr(
        app_module,
        "construct_webhook_event",
        lambda payload, signature: {
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "metadata": {
                        "user_id": str(regular_user.id),
                        "tier": "plus",
                        "interval": "annual",
                    },
                    "customer": "cus_test",
                    "subscription": "sub_test",
                }
            },
        },
    )
    monkeypatch.setattr(
        app_module,
        "get_subscription",
        lambda subscription_id: {
            "price_id": "price_basic_monthly",
            "current_period_start": 1_700_000_000,
            "current_period_end": 1_700_100_000,
        },
    )
    monkeypatch.setattr(
        app_module,
        "get_plan_for_stripe_price_id",
        lambda price_id: ("basic", "monthly") if price_id == "price_basic_monthly" else None,
    )

    response = client.post(
        "/api/v2/webhooks/stripe",
        data=b"{}",
        headers={"Stripe-Signature": "valid-test-signature"},
    )
    assert response.status_code == 200
    with app.app_context():
        subscription = Subscription.query.filter_by(user_id=regular_user.id).one()
        assert subscription.tier == "basic"
        assert subscription.billing_interval == "monthly"
