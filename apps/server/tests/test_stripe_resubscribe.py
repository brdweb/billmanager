"""Returning customers: checkout eligibility and subscription replacement."""
import datetime
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

import app as server
from models import db, StripeWebhookEvent, Subscription


def _checkout_completed(user_id, event_id="evt_resubscribe", subscription="sub_new", customer="cus_owner", created=400):
    return {
        "id": event_id, "type": "checkout.session.completed", "created": created,
        "data": {"object": {"subscription": subscription, "customer": customer,
                            "metadata": {"user_id": str(user_id)}}},
    }


def _post(client, payload=b"{}"):
    return client.post("/api/v2/webhooks/stripe", data=payload, headers={"Stripe-Signature": "sig"})


def _stripe(old_status="canceled"):
    statuses = {"sub_old": old_status, "sub_new": "active"}

    def get_subscription(sub_id):
        return {"id": sub_id, "status": statuses[sub_id], "price_id": "price_pm",
                "current_period_start": 1_800_000_000, "current_period_end": 1_802_592_000}
    return get_subscription


@pytest.fixture
def previous(db_session, admin_user, monkeypatch):
    monkeypatch.setattr(server, "get_plan_for_stripe_price_id", lambda price: ("pro", "monthly") if price == "price_pm" else None)
    subscription = Subscription(
        user_id=admin_user.id, stripe_customer_id="cus_owner", stripe_subscription_id="sub_old",
        status="canceled", tier="pro", canceled_at=datetime.datetime(2026, 1, 1),
        current_period_end=datetime.datetime(2099, 1, 1), stripe_last_event_created=300,
    )
    db_session.add(subscription)
    db_session.commit()
    return subscription


@pytest.mark.parametrize("status", ["past_due", "unpaid", "incomplete", "paused"])
def test_checkout_refuses_a_second_subscription_while_the_current_one_can_bill(client, admin_auth_headers, previous, db_session, monkeypatch, status):
    previous.status = status
    db_session.commit()
    calls = []
    monkeypatch.setattr(server, "get_billing_readiness", lambda: {"billing_enabled": True})
    monkeypatch.setattr(server, "create_checkout_session", lambda *args: calls.append(args) or {"url": "u", "session_id": "s"})

    response = client.post("/api/v2/billing/create-checkout", json={"tier": "pro", "interval": "monthly"}, headers=admin_auth_headers)

    assert response.status_code == 400
    body = response.get_json()
    assert body["success"] is False
    assert "billing portal" in body["error"]
    assert calls == []


@pytest.mark.parametrize("status", ["canceled", "incomplete_expired"])
def test_checkout_reuses_the_customer_after_a_terminal_subscription(client, admin_auth_headers, previous, db_session, monkeypatch, status):
    previous.status = status
    db_session.commit()
    calls = []
    monkeypatch.setattr(server, "get_billing_readiness", lambda: {"billing_enabled": True})
    monkeypatch.setattr(server, "create_checkout_session", lambda *args: calls.append(args) or {"url": "u", "session_id": "s"})

    response = client.post("/api/v2/billing/create-checkout", json={"tier": "pro", "interval": "monthly"}, headers=admin_auth_headers)

    assert response.status_code == 200
    assert calls[0][2] == "cus_owner"


@pytest.mark.parametrize("status", ["canceled", "incomplete_expired"])
def test_returning_customer_checkout_replaces_a_terminal_subscription(client, db_session, admin_user, previous, monkeypatch, status):
    previous.status = status
    db_session.commit()
    monkeypatch.setattr(server, "get_subscription", _stripe(old_status=status))
    monkeypatch.setattr(server, "construct_webhook_event", lambda *_: _checkout_completed(admin_user.id))

    assert _post(client).status_code == 200
    assert _post(client).get_json() == {"received": True, "duplicate": True}

    db_session.refresh(previous)
    assert previous.stripe_subscription_id == "sub_new"
    assert previous.stripe_customer_id == "cus_owner"
    assert (previous.status, previous.effective_tier) == ("active", "pro")
    assert previous.canceled_at is None and previous.cancel_at_period_end is False
    assert previous.stripe_last_event_created == 400
    assert StripeWebhookEvent.query.filter_by(event_id="evt_resubscribe").count() == 1


@pytest.mark.parametrize("local_status,stripe_status,customer", [
    ("canceled", "active", "cus_owner"),      # Stripe says the old subscription can still bill
    ("canceled", "past_due", "cus_owner"),
    ("past_due", "canceled", "cus_owner"),    # local cancellation not yet processed
    ("active", "active", "cus_owner"),
    ("canceled", "canceled", "cus_someone_else"),
    ("canceled", "canceled", None),
])
def test_checkout_keeps_conflict_unless_previous_is_verifiably_terminal(client, db_session, admin_user, previous, monkeypatch, local_status, stripe_status, customer):
    previous.status = local_status
    db_session.commit()
    monkeypatch.setattr(server, "get_subscription", _stripe(old_status=stripe_status))
    monkeypatch.setattr(server, "construct_webhook_event", lambda *_: _checkout_completed(admin_user.id, customer=customer))

    assert _post(client).status_code == 500

    db_session.refresh(previous)
    assert (previous.stripe_subscription_id, previous.status) == ("sub_old", local_status)
    assert StripeWebhookEvent.query.filter_by(event_id="evt_resubscribe").count() == 0


def test_unverifiable_previous_subscription_is_retryable(client, db_session, admin_user, previous, monkeypatch):
    monkeypatch.setattr(server, "get_subscription", lambda sub_id: {"error": "Unable to retrieve subscription details."})
    monkeypatch.setattr(server, "construct_webhook_event", lambda *_: _checkout_completed(admin_user.id))

    assert _post(client).status_code == 500

    db_session.refresh(previous)
    assert previous.stripe_subscription_id == "sub_old"
    assert StripeWebhookEvent.query.filter_by(event_id="evt_resubscribe").count() == 0


def test_checkout_cannot_claim_another_users_subscription(client, db_session, admin_user, previous, regular_user, monkeypatch):
    other = Subscription(user_id=regular_user.id, stripe_customer_id="cus_other", stripe_subscription_id="sub_new", status="active")
    db_session.add(other)
    db_session.commit()
    monkeypatch.setattr(server, "get_subscription", _stripe())
    monkeypatch.setattr(server, "construct_webhook_event", lambda *_: _checkout_completed(admin_user.id))

    assert _post(client).status_code == 500

    db_session.refresh(previous)
    db_session.refresh(other)
    assert previous.stripe_subscription_id == "sub_old"
    assert (other.user_id, other.stripe_subscription_id) == (regular_user.id, "sub_new")


def test_replacement_waits_for_an_in_flight_previous_subscription_event(app, db_session, admin_user, previous, monkeypatch):
    """A late delivery for the old subscription must not overwrite the new association."""
    old_event_loaded = threading.Event()

    def plan(price):
        if price == "price_unknown":
            old_event_loaded.set()
            time.sleep(1)  # Without serialization the replacement commits meanwhile.
            return None
        return ("pro", "monthly") if price == "price_pm" else None

    old_update = {
        "id": "evt_old_update", "type": "customer.subscription.updated", "created": 350,
        "data": {"object": {"id": "sub_old", "status": "canceled",
                            "items": {"data": [{"price": {"id": "price_unknown"}}]}}},
    }
    monkeypatch.setattr(server, "get_plan_for_stripe_price_id", plan)
    monkeypatch.setattr(server, "get_subscription", _stripe())
    monkeypatch.setattr(server, "construct_webhook_event", lambda payload, _: (
        old_update if payload == b"old" else _checkout_completed(admin_user.id)))

    def deliver(payload):
        if payload == b"new":
            assert old_event_loaded.wait(timeout=10)
        with app.app_context():
            with app.test_client() as client:
                return _post(client, payload).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert list(executor.map(deliver, [b"old", b"new"])) == [200, 200]

    db.session.expire_all()
    current = db.session.get(Subscription, previous.id)
    assert (current.stripe_subscription_id, current.status, current.tier) == ("sub_new", "active", "pro")
    assert current.stripe_last_event_created == 400
