"""Price and metadata must describe the same plan across billing writes."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import config
from services import stripe_service


PLANS = [(tier, interval) for tier in ("basic", "plus") for interval in ("monthly", "annual")]


@pytest.fixture
def billing(monkeypatch):
    prices = {
        tier: {interval: f"price_{tier}_{interval}" for interval in ("monthly", "annual")}
        for tier in ("basic", "plus")
    }
    monkeypatch.setattr(config, "STRIPE_PRICES", prices)
    monkeypatch.setattr(stripe_service, "STRIPE_PRICES", prices)
    monkeypatch.setattr(stripe_service, "STRIPE_AVAILABLE", True)
    monkeypatch.setattr(stripe_service, "STRIPE_SECRET_KEY", "sk_test_synthetic")
    monkeypatch.setattr(stripe_service, "get_billing_readiness", lambda: {"billing_enabled": True})
    customer = Mock(return_value=SimpleNamespace(id="cus_synthetic"))
    checkout = Mock(return_value=SimpleNamespace(id="cs_synthetic", url="https://example.invalid/checkout"))
    retrieve = Mock(return_value={"items": {"data": [{"id": "si_synthetic"}]}})
    modify = Mock(return_value=SimpleNamespace(id="sub_synthetic", status="active", current_period_end=200))
    monkeypatch.setattr(stripe_service.stripe.Customer, "create", customer)
    monkeypatch.setattr(stripe_service.stripe.checkout.Session, "create", checkout)
    monkeypatch.setattr(stripe_service.stripe.Subscription, "retrieve", retrieve)
    monkeypatch.setattr(stripe_service.stripe.Subscription, "modify", modify)
    return SimpleNamespace(customer=customer, checkout=checkout, retrieve=retrieve, modify=modify)


@pytest.mark.parametrize("tier,interval", PLANS)
@pytest.mark.parametrize("customer_id", [None, "cus_existing"])
def test_checkout_metadata_matches_purchased_price(billing, tier, interval, customer_id):
    result = stripe_service.create_checkout_session(7, "user@example.invalid", customer_id, tier, interval)

    assert "error" not in result
    payload = billing.checkout.call_args.kwargs
    assert payload["line_items"] == [{"price": f"price_{tier}_{interval}", "quantity": 1}]
    expected = {"user_id": "7", "tier": tier, "interval": interval}
    assert payload["metadata"] == expected
    assert payload["subscription_data"]["metadata"] == expected
    assert (result["tier"], result["interval"]) == config.get_plan_for_stripe_price_id(payload["line_items"][0]["price"])
    assert billing.customer.call_count == (0 if customer_id else 1)


@pytest.mark.parametrize("tier,interval", PLANS)
def test_checkout_metadata_uses_resolved_price_not_request(billing, monkeypatch, tier, interval):
    # Reproduce a resolver/configuration mismatch; the requested labels are not authoritative.
    monkeypatch.setattr(stripe_service, "get_stripe_price_id", lambda *_: f"price_{tier}_{interval}")
    requested_tier = "plus" if tier == "basic" else "basic"
    requested_interval = "annual" if interval == "monthly" else "monthly"

    result = stripe_service.create_checkout_session(7, "user@example.invalid", None, requested_tier, requested_interval)

    payload = billing.checkout.call_args.kwargs
    assert payload["line_items"][0]["price"] == f"price_{tier}_{interval}"
    expected = {"user_id": "7", "tier": tier, "interval": interval}
    assert payload["metadata"] == expected
    assert payload["subscription_data"]["metadata"] == expected
    assert (result["tier"], result["interval"]) == (tier, interval)


def test_checkout_rejects_unrecognized_price_before_provider_calls(billing, monkeypatch):
    monkeypatch.setattr(stripe_service, "get_stripe_price_id", lambda *_: "price_unrecognized")

    result = stripe_service.create_checkout_session(7, "user@example.invalid")

    assert "error" in result
    billing.customer.assert_not_called()
    billing.checkout.assert_not_called()


@pytest.mark.parametrize("tier,interval", PLANS)
@pytest.mark.parametrize("prorate", [True, False])
def test_plan_change_updates_metadata_with_price(billing, tier, interval, prorate):
    price_id = f"price_{tier}_{interval}"

    result = stripe_service.update_subscription("sub_synthetic", price_id, prorate=prorate)

    assert "error" not in result
    payload = billing.modify.call_args.kwargs
    assert payload["items"] == [{"id": "si_synthetic", "price": price_id}]
    assert payload["metadata"] == {"tier": tier, "interval": interval}
    assert payload["proration_behavior"] == ("create_prorations" if prorate else "none")


def test_plan_change_rejects_unrecognized_price_before_provider_calls(billing):
    result = stripe_service.update_subscription("sub_synthetic", "price_unrecognized")

    assert "error" in result
    billing.retrieve.assert_not_called()
    billing.modify.assert_not_called()


@pytest.mark.parametrize("has_trial", [False, True])
def test_checkout_persists_resolved_plan_for_new_customer(
    billing, monkeypatch, client, db_session, admin_user, admin_auth_headers, has_trial
):
    import app as server
    from models import Subscription

    monkeypatch.setattr(server, "get_billing_readiness", lambda: {"billing_enabled": True})
    # Both configured labels select one price; entitlement resolves it to Basic monthly.
    config.STRIPE_PRICES["plus"]["annual"] = "price_basic_monthly"
    if has_trial:
        db_session.add(Subscription(user_id=admin_user.id, status="trialing", tier="plus"))
        db_session.commit()

    response = client.post(
        "/api/v2/billing/create-checkout",
        json={"tier": "plus", "interval": "annual"},
        headers=admin_auth_headers,
    )

    assert response.status_code == 200
    subscription = Subscription.query.filter_by(user_id=admin_user.id).one()
    assert subscription.tier == "basic"
    assert subscription.billing_interval == "monthly"
    assert subscription.status == ("trialing" if has_trial else "pending")
    assert subscription.stripe_customer_id == "cus_synthetic"
    assert billing.checkout.call_args.kwargs["metadata"]["tier"] == "basic"


def test_checkout_entitlement_ignores_incorrect_metadata(
    billing, monkeypatch, client, db_session, admin_user
):
    import app as server
    from models import Subscription

    monkeypatch.setattr(server, "construct_webhook_event", lambda *_: {
        "id": "evt_metadata_mismatch", "created": 100,
        "type": "checkout.session.completed",
        "data": {"object": {
            "subscription": "sub_synthetic", "customer": "cus_synthetic",
            "metadata": {"user_id": str(admin_user.id), "tier": "plus", "interval": "annual"},
        }},
    })
    monkeypatch.setattr(server, "get_subscription", lambda *_: {
        "price_id": "price_basic_monthly", "status": "active",
        "current_period_start": 1, "current_period_end": 200,
    })

    response = client.post(
        "/api/v2/webhooks/stripe", data=b"{}", headers={"Stripe-Signature": "synthetic"}
    )

    assert response.status_code == 200
    subscription = Subscription.query.filter_by(user_id=admin_user.id).one()
    assert subscription.tier == "basic"
    assert subscription.billing_interval == "monthly"
    assert subscription.status == "active"
