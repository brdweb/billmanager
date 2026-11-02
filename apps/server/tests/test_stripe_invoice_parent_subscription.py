"""Invoice webhooks on Stripe API 2025-03-31.basil and later.

Those API versions removed the top-level ``invoice.subscription`` field; the
subscription now lives at ``invoice.parent.subscription_details.subscription``.
"""
import datetime
import hashlib
import hmac
import json
import time

import pytest

import app as server
from models import StripeWebhookEvent, Subscription
from services import stripe_service


def _modern_invoice(subscription):
    return {
        "id": "in_modern", "object": "invoice",
        "parent": {
            "type": "subscription_details", "quote_details": None,
            "subscription_details": {"metadata": {}, "subscription": subscription},
        },
    }


def _event(event_id, event_type, obj, created=100):
    return {"id": event_id, "type": event_type, "created": created, "data": {"object": obj}}


def _post(client, payload=b"{}", signature="sig"):
    return client.post("/api/v2/webhooks/stripe", data=payload, headers={"Stripe-Signature": signature})


@pytest.fixture
def local_subscription(db_session, regular_user):
    subscription = Subscription(user_id=regular_user.id, stripe_subscription_id="sub_modern", status="active")
    db_session.add(subscription)
    db_session.commit()
    return subscription


def test_modern_invoice_payment_failed_marks_subscription_past_due(client, db_session, local_subscription, monkeypatch):
    monkeypatch.setattr(server, "construct_webhook_event", lambda *_: _event(
        "evt_modern_failed", "invoice.payment_failed", _modern_invoice("sub_modern")))

    assert _post(client).status_code == 200

    db_session.refresh(local_subscription)
    assert local_subscription.status == "past_due"
    assert local_subscription.stripe_last_event_created == 100


def test_modern_invoice_paid_reactivates_and_refreshes_period(client, db_session, local_subscription, monkeypatch):
    local_subscription.status = "past_due"
    db_session.commit()
    retrieved = []
    monkeypatch.setattr(server, "construct_webhook_event", lambda *_: _event(
        "evt_modern_paid", "invoice.paid", _modern_invoice("sub_modern")))
    monkeypatch.setattr(server, "get_subscription", lambda sub_id: retrieved.append(sub_id) or {
        "status": "active", "current_period_start": 1_800_000_000, "current_period_end": 1_802_592_000})

    assert _post(client).status_code == 200

    db_session.refresh(local_subscription)
    assert retrieved == ["sub_modern"]
    assert local_subscription.status == "active"
    assert local_subscription.current_period_end == datetime.datetime.fromtimestamp(1_802_592_000)


def test_modern_invoice_paid_stores_the_status_stripe_reports(client, db_session, local_subscription, monkeypatch):
    """Paying one of several open invoices does not make the subscription active."""
    local_subscription.status = "past_due"
    db_session.commit()
    monkeypatch.setattr(server, "construct_webhook_event", lambda *_: _event(
        "evt_modern_partial", "invoice.paid", _modern_invoice("sub_modern")))
    monkeypatch.setattr(server, "get_subscription", lambda sub_id: {
        "status": "unpaid", "current_period_start": 1_800_000_000, "current_period_end": 1_802_592_000})

    assert _post(client).status_code == 200

    db_session.refresh(local_subscription)
    assert local_subscription.status == "unpaid"


@pytest.mark.parametrize("details", [{"error": "Unable to retrieve subscription details."}, {"current_period_start": 1}])
def test_modern_invoice_paid_without_a_stripe_status_stays_retryable(client, db_session, local_subscription, monkeypatch, details):
    monkeypatch.setattr(server, "construct_webhook_event", lambda *_: _event(
        "evt_modern_unverified", "invoice.paid", _modern_invoice("sub_modern")))
    monkeypatch.setattr(server, "get_subscription", lambda sub_id: details)

    assert _post(client).status_code == 500
    assert StripeWebhookEvent.query.filter_by(event_id="evt_modern_unverified").count() == 0


def test_modern_invoice_for_unknown_subscription_stays_retryable(client, db_session, monkeypatch):
    monkeypatch.setattr(server, "construct_webhook_event", lambda *_: _event(
        "evt_modern_late", "invoice.payment_failed", _modern_invoice("sub_not_yet_local")))

    assert _post(client).status_code == 500
    assert StripeWebhookEvent.query.filter_by(event_id="evt_modern_late").count() == 0


def test_signed_modern_invoice_is_resolved_through_the_real_sdk(client, db_session, local_subscription, monkeypatch):
    monkeypatch.setattr(stripe_service, "STRIPE_AVAILABLE", True)
    monkeypatch.setattr(stripe_service, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    payload = json.dumps({"object": "event", **_event(
        "evt_modern_signed", "invoice.payment_failed", _modern_invoice("sub_modern"))})
    timestamp = int(time.time())
    digest = hmac.new(b"whsec_test", f"{timestamp}.{payload}".encode(), hashlib.sha256).hexdigest()

    assert _post(client, payload.encode(), f"t={timestamp},v1={digest}").status_code == 200

    db_session.refresh(local_subscription)
    assert local_subscription.status == "past_due"


@pytest.mark.parametrize("invoice,expected", [
    (_modern_invoice("sub_modern"), "sub_modern"),
    (_modern_invoice({"id": "sub_expanded", "object": "subscription"}), "sub_expanded"),
    ({"subscription": "sub_legacy", **_modern_invoice("sub_parent")}, "sub_legacy"),
    ({"subscription": "sub_legacy", "parent": None}, "sub_legacy"),
    ({"parent": None}, None),
    ({"parent": {"type": "quote_details", "quote_details": {"quote": "qt_1"}, "subscription_details": None}}, None),
])
def test_invoice_subscription_resolves_dict_and_sdk_objects(invoice, expected):
    assert server._invoice_subscription_id(invoice) == expected
    sdk_invoice = stripe_service.stripe.Invoice.construct_from({"object": "invoice", **invoice}, "sk_test")
    assert server._invoice_subscription_id(sdk_invoice) == expected


@pytest.mark.parametrize("event_type", ["invoice.paid", "invoice.payment_failed"])
def test_modern_non_subscription_invoice_is_acknowledged_without_changes(client, db_session, local_subscription, monkeypatch, event_type):
    monkeypatch.setattr(server, "construct_webhook_event", lambda *_: _event(
        "evt_modern_quote", event_type, {"object": "invoice", "parent": {"type": "quote_details", "subscription_details": None}}))

    assert _post(client).status_code == 200

    db_session.refresh(local_subscription)
    assert local_subscription.status == "active"
    assert StripeWebhookEvent.query.filter_by(event_id="evt_modern_quote").count() == 1
