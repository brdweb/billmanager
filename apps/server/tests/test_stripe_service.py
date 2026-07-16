"""Focused contracts for Stripe service retry safety."""

import stripe

from services import stripe_service


def test_immediate_cancel_treats_missing_subscription_as_already_canceled(
    monkeypatch,
):
    monkeypatch.setattr(stripe_service, "STRIPE_AVAILABLE", True)
    monkeypatch.setattr(stripe_service, "STRIPE_SECRET_KEY", "sk_test_erasure")

    def missing_subscription(_subscription_id):
        raise stripe.error.InvalidRequestError(
            "No such subscription",
            "id",
            code="resource_missing",
        )

    monkeypatch.setattr(stripe_service.stripe.Subscription, "delete", missing_subscription)

    result = stripe_service.cancel_subscription(
        "sub_already_removed", at_period_end=False
    )

    assert result == {
        "id": "sub_already_removed",
        "status": "canceled",
        "cancel_at_period_end": None,
        "already_absent": True,
    }
