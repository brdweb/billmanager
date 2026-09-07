import datetime

import app as app_module
import config
from models import StripeWebhookEvent, Subscription
from services import stripe_service


def _event(event_id, event_type, created, obj):
    return {
        "id": event_id,
        "type": event_type,
        "created": created,
        "data": {"object": obj},
    }


def test_saas_readiness_requires_all_stripe_inputs(monkeypatch):
    monkeypatch.setattr(stripe_service, "STRIPE_AVAILABLE", True)
    monkeypatch.setattr(stripe_service, "STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.setattr(stripe_service, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setattr(
        stripe_service,
        "STRIPE_PRICES",
        {
            "basic": {"monthly": "price_bm", "annual": "price_ba"},
            "plus": {"monthly": "price_pm", "annual": None},
        },
    )
    monkeypatch.setattr(config, "DEPLOYMENT_MODE", "saas")

    readiness = stripe_service.get_billing_readiness()

    assert readiness["ready"] is False
    assert readiness["billing_enabled"] is False
    assert "missing" not in readiness


def test_self_hosted_billing_remains_disabled_even_when_stripe_is_ready(monkeypatch):
    monkeypatch.setattr(stripe_service, "STRIPE_AVAILABLE", True)
    monkeypatch.setattr(stripe_service, "STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.setattr(stripe_service, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setattr(
        stripe_service,
        "STRIPE_PRICES",
        {tier: {interval: "price" for interval in ("monthly", "annual")} for tier in ("basic", "plus")},
    )
    monkeypatch.setattr(config, "DEPLOYMENT_MODE", "self-hosted")

    readiness = stripe_service.get_billing_readiness()

    assert readiness["ready"] is True
    assert readiness["billing_enabled"] is False
    assert readiness["reason"] == "self_hosted"
    assert "missing" not in readiness


def test_construct_webhook_distinguishes_valid_and_invalid_signature(monkeypatch):
    monkeypatch.setattr(stripe_service, "STRIPE_AVAILABLE", True)
    monkeypatch.setattr(stripe_service, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setattr(stripe_service.stripe.Webhook, "construct_event", lambda *args: {"id": "evt_valid"})
    assert stripe_service.construct_webhook_event(b"{}", "sig")["id"] == "evt_valid"

    def invalid(*args):
        raise stripe_service.stripe.error.SignatureVerificationError("bad", b"{}")

    monkeypatch.setattr(stripe_service.stripe.Webhook, "construct_event", invalid)
    assert stripe_service.construct_webhook_event(b"{}", "sig") == {
        "error": "Invalid signature",
        "error_code": "invalid_signature",
    }


def test_webhook_missing_configuration_is_service_unavailable(client, monkeypatch):
    monkeypatch.setattr(app_module, "construct_webhook_event", lambda *_: {"error": "Webhook secret not configured"})

    response = client.post("/api/v2/webhooks/stripe", data=b"{}", headers={"Stripe-Signature": "sig"})

    assert response.status_code == 503


def test_webhook_processing_failure_is_retryable_and_rolls_back(client, app, db_session, regular_user, monkeypatch):
    subscription = Subscription(user_id=regular_user.id, stripe_subscription_id="sub_missing", status="active")
    db_session.add(subscription)
    db_session.commit()
    event = _event("evt_failure", "invoice.paid", 100, {"subscription": "sub_missing"})
    monkeypatch.setattr(app_module, "construct_webhook_event", lambda *_: event)
    monkeypatch.setattr(app_module, "get_subscription", lambda *_: (_ for _ in ()).throw(RuntimeError("stripe down")))

    response = client.post("/api/v2/webhooks/stripe", data=b"{}", headers={"Stripe-Signature": "sig"})

    assert response.status_code == 500
    with app.app_context():
        assert StripeWebhookEvent.query.filter_by(event_id="evt_failure").count() == 0


def test_webhook_duplicate_event_is_acknowledged_once(client, app, db_session, regular_user, monkeypatch):
    db_session.add(Subscription(user_id=regular_user.id, stripe_subscription_id="sub_missing", status="active"))
    db_session.commit()
    event = _event("evt_duplicate", "invoice.payment_failed", 100, {"subscription": "sub_missing"})
    monkeypatch.setattr(app_module, "construct_webhook_event", lambda *_: event)

    first = client.post("/api/v2/webhooks/stripe", data=b"{}", headers={"Stripe-Signature": "sig"})
    second = client.post("/api/v2/webhooks/stripe", data=b"{}", headers={"Stripe-Signature": "sig"})

    assert first.status_code == 200
    assert second.status_code == 200
    with app.app_context():
        assert StripeWebhookEvent.query.filter_by(event_id="evt_duplicate").count() == 1


def test_subscription_events_do_not_regress_on_out_of_order_delivery(client, app, db_session, regular_user, monkeypatch):
    subscription = Subscription(user_id=regular_user.id, stripe_subscription_id="sub_order", status="active")
    db_session.add(subscription)
    db_session.commit()
    events = iter([
        _event("evt_new", "customer.subscription.updated", 200, {"id": "sub_order", "status": "canceled"}),
        _event("evt_old", "customer.subscription.updated", 100, {"id": "sub_order", "status": "active"}),
    ])
    monkeypatch.setattr(app_module, "construct_webhook_event", lambda *_: next(events))

    for _ in range(2):
        response = client.post("/api/v2/webhooks/stripe", data=b"{}", headers={"Stripe-Signature": "sig"})
        assert response.status_code == 200

    with app.app_context():
        assert Subscription.query.filter_by(stripe_subscription_id="sub_order").one().status == "canceled"


def test_supported_event_without_identity_is_rejected_before_ledger(client, app, monkeypatch):
    monkeypatch.setattr(app_module, "construct_webhook_event", lambda *_: {
        "type": "invoice.payment_failed", "created": 10,
        "data": {"object": {"subscription": "sub_invalid"}},
    })
    response = client.post("/api/v2/webhooks/stripe", data=b"{}", headers={"Stripe-Signature": "sig"})
    assert response.status_code == 400


def test_missing_local_subscription_is_retryable(client, app, monkeypatch):
    monkeypatch.setattr(app_module, "construct_webhook_event", lambda *_: _event(
        "evt_missing_local", "invoice.payment_failed", 10, {"subscription": "sub_late"}
    ))
    response = client.post("/api/v2/webhooks/stripe", data=b"{}", headers={"Stripe-Signature": "sig"})
    assert response.status_code == 500
    with app.app_context():
        assert StripeWebhookEvent.query.filter_by(event_id="evt_missing_local").first() is None


def test_equal_timestamp_distinct_event_fails_retryably(client, app, db_session, regular_user, monkeypatch):
    db_session.add(Subscription(user_id=regular_user.id, stripe_subscription_id="sub_equal", status="canceled"))
    db_session.commit()
    events = iter([
        _event("evt_equal_one", "customer.subscription.deleted", 50, {"id": "sub_equal"}),
        _event("evt_equal_two", "invoice.payment_failed", 50, {"subscription": "sub_equal"}),
    ])
    monkeypatch.setattr(app_module, "construct_webhook_event", lambda *_: next(events))
    assert client.post("/api/v2/webhooks/stripe", data=b"{}", headers={"Stripe-Signature": "sig"}).status_code == 200
    assert client.post("/api/v2/webhooks/stripe", data=b"{}", headers={"Stripe-Signature": "sig"}).status_code == 500


def test_commit_failure_rolls_back_ledger_and_business_change(client, app, db_session, regular_user, monkeypatch):
    db_session.add(Subscription(user_id=regular_user.id, stripe_subscription_id="sub_commit", status="active"))
    db_session.commit()
    monkeypatch.setattr(app_module, "construct_webhook_event", lambda *_: _event(
        "evt_commit_fail", "invoice.payment_failed", 60, {"subscription": "sub_commit"}
    ))
    original_commit = db_session.commit
    def fail_commit():
        raise RuntimeError("database unavailable")
    monkeypatch.setattr(db_session, "commit", fail_commit)
    response = client.post("/api/v2/webhooks/stripe", data=b"{}", headers={"Stripe-Signature": "sig"})
    assert response.status_code == 500
    monkeypatch.setattr(db_session, "commit", original_commit)
    db_session.rollback()
    with app.app_context():
        assert StripeWebhookEvent.query.filter_by(event_id="evt_commit_fail").first() is None
        assert Subscription.query.filter_by(stripe_subscription_id="sub_commit").one().status == "active"
