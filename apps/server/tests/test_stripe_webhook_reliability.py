import datetime
import hashlib
import hmac
import json
import time

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


def _signed(event, secret="whsec_test"):
    """Payload and Stripe-Signature header verifiable by the real SDK."""
    payload = json.dumps({"object": "event", **event})
    timestamp = int(time.time())
    digest = hmac.new(secret.encode(), f"{timestamp}.{payload}".encode(), hashlib.sha256).hexdigest()
    return payload.encode(), f"t={timestamp},v1={digest}"


def test_saas_readiness_requires_all_stripe_inputs(monkeypatch):
    monkeypatch.setattr(stripe_service, "STRIPE_AVAILABLE", True)
    monkeypatch.setattr(stripe_service, "STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.setattr(stripe_service, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setattr(
        stripe_service,
        "STRIPE_PRICES",
        {
            "pro": {"monthly": "price_pm", "annual": None},
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
        {tier: {interval: "price" for interval in ("monthly", "annual")} for tier in ("pro",)},
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
    payload, signature = _signed(_event("evt_valid", "invoice.paid", 1, {"subscription": "sub_1"}))
    event = stripe_service.construct_webhook_event(payload, signature)
    # Callers read events with dict methods; a raw StripeObject raises on .get().
    assert event.get("id") == "evt_valid"
    assert event.get("data", {}).get("object", {}).get("subscription") == "sub_1"

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


def test_signed_subscription_update_reads_item_billing_period(client, app, db_session, regular_user, monkeypatch):
    # End-to-end through the real SDK: current Stripe APIs put periods on items.
    monkeypatch.setattr(stripe_service, "STRIPE_AVAILABLE", True)
    monkeypatch.setattr(stripe_service, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setattr(app_module, "get_plan_for_stripe_price_id", lambda price: ("pro", "monthly") if price == "price_pm" else None)
    db_session.add(Subscription(user_id=regular_user.id, stripe_subscription_id="sub_signed", status="active"))
    db_session.commit()
    payload, signature = _signed(_event("evt_signed", "customer.subscription.updated", 100, {
        "id": "sub_signed", "object": "subscription", "status": "past_due",
        "items": {"object": "list", "data": [{
            "id": "si_1", "object": "subscription_item", "current_period_end": 1_800_000_000,
            "price": {"id": "price_pm", "object": "price"},
        }]},
    }))

    response = client.post("/api/v2/webhooks/stripe", data=payload, headers={"Stripe-Signature": signature})

    assert response.status_code == 200
    with app.app_context():
        subscription = Subscription.query.filter_by(stripe_subscription_id="sub_signed").one()
        assert subscription.status == "past_due"
        assert subscription.tier == "pro"
        assert subscription.current_period_end == datetime.datetime.fromtimestamp(1_800_000_000)


def test_get_subscription_reads_sdk_object_and_item_periods(monkeypatch):
    monkeypatch.setattr(stripe_service, "STRIPE_AVAILABLE", True)
    monkeypatch.setattr(stripe_service, "STRIPE_SECRET_KEY", "sk_test")
    retrieved = stripe_service.stripe.Subscription.construct_from({
        "id": "sub_1", "object": "subscription", "status": "active",
        "cancel_at_period_end": False, "canceled_at": None,
        "items": {"object": "list", "data": [{
            "id": "si_1", "object": "subscription_item",
            "current_period_start": 100, "current_period_end": 200,
            "price": {"id": "price_pm", "object": "price"},
        }]},
    }, "sk_test")
    monkeypatch.setattr(stripe_service.stripe.Subscription, "retrieve", lambda *_: retrieved)

    assert stripe_service.get_subscription("sub_1") == {
        "id": "sub_1", "status": "active", "current_period_start": 100, "current_period_end": 200,
        "cancel_at_period_end": False, "canceled_at": None, "price_id": "price_pm",
    }
