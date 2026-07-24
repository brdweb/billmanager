"""Push notification currency formatting contracts."""

import pytest

import config
from services import push_notifications


@pytest.mark.parametrize(
    ("currency", "amount", "expected_amount"),
    [
        ("JPY", 101, "JPY 101"),
        ("EUR", 12.5, "EUR 12.50"),
        ("CNY", 12.34, "CNY 12.34"),
    ],
)
def test_bill_reminder_uses_deployment_currency_and_minor_units(
    monkeypatch, currency, amount, expected_amount
):
    delivered_bodies = []

    def capture_push(user_id, title, body, data, notification_type):
        delivered_bodies.append(body)
        return 1

    monkeypatch.setattr(config, "DEFAULT_CURRENCY", currency)
    monkeypatch.setattr(push_notifications, "send_push_to_user", capture_push)

    sent = push_notifications.send_bill_reminder(
        user_id=7,
        bill_id=11,
        bill_name="Utilities",
        due_date="2026-07-24",
        amount=amount,
        days_until_due=1,
    )

    assert sent == 1
    assert delivered_bodies == [f"Utilities is due tomorrow ({expected_amount})"]
    assert "$" not in delivered_bodies[0]
