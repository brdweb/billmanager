"""The public plan-change response must match its existing provider behavior."""
from unittest.mock import Mock

import pytest

import app as server
from models import Subscription


@pytest.mark.parametrize("interval", ["monthly", "annual"])
@pytest.mark.parametrize("provider_fails", [False, True])
def test_plan_change_is_immediate_only_after_provider_success(
    client, admin_user, admin_auth_headers, db_session, monkeypatch, interval, provider_fails
):
    subscription = Subscription(
        user_id=admin_user.id, tier="plus", status="active",
        billing_interval="annual" if interval == "monthly" else "monthly",
        stripe_customer_id="cus_synthetic", stripe_subscription_id="sub_synthetic",
    )
    db_session.add(subscription)
    db_session.commit()
    original_interval = subscription.billing_interval
    monkeypatch.setattr("config.get_stripe_price_id", lambda *_: "price_synthetic")
    provider = Mock(return_value={"error": "Provider unavailable"} if provider_fails else {
        "id": "sub_synthetic", "status": "active", "current_period_end": 200,
    })
    monkeypatch.setattr(server, "update_subscription", provider)

    response = client.post("/api/v2/billing/change-plan", headers=admin_auth_headers,
        json={"tier": "pro", "interval": interval})

    provider.assert_called_once_with("sub_synthetic", "price_synthetic", prorate=False)
    db_session.refresh(subscription)
    if provider_fails:
        assert response.status_code == 400
        assert (subscription.tier, subscription.billing_interval) == ("plus", original_interval)
    else:
        assert response.status_code == 200
        assert response.get_json()["effective"] == "immediately"
        assert response.get_json()["message"] == "Plan updated to Pro"
        assert (subscription.tier, subscription.billing_interval) == ("pro", interval)
    assert subscription.stripe_customer_id == "cus_synthetic"
    assert subscription.stripe_subscription_id == "sub_synthetic"
    assert subscription.trial_ends_at is None
    assert subscription.current_period_end is None
