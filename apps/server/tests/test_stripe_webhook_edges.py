"""Regression coverage for webhook delivery edge cases."""
import pytest

import app as server
from models import StripeWebhookEvent, Subscription


def post_event(client):
    return client.post('/api/v2/webhooks/stripe', data=b'{}', headers={'Stripe-Signature': 'test'})


def test_subscription_update_preserves_scheduled_cancellation(client, db_session, regular_user, monkeypatch):
    sub = Subscription(user_id=regular_user.id, stripe_subscription_id='sub_cancel', status='active')
    db_session.add(sub)
    db_session.commit()
    monkeypatch.setattr(server, 'construct_webhook_event', lambda *_: {
        'id': 'evt_cancel', 'created': 100, 'type': 'customer.subscription.updated',
        'data': {'object': {'id': 'sub_cancel', 'status': 'active', 'cancel_at_period_end': True}},
    })
    assert post_event(client).status_code == 200
    db_session.refresh(sub)
    assert sub.canceled_at is not None


def test_non_subscription_invoice_is_intentionally_ignored(client, db_session, monkeypatch):
    monkeypatch.setattr(server, 'construct_webhook_event', lambda *_: {
        'id': 'evt_standalone', 'created': 100, 'type': 'invoice.paid',
        'data': {'object': {'subscription': None}},
    })
    assert post_event(client).status_code == 200
    assert StripeWebhookEvent.query.filter_by(event_id='evt_standalone').count() == 1


def test_equal_timestamp_reconciles_current_provider_state(client, db_session, regular_user, monkeypatch):
    sub = Subscription(user_id=regular_user.id, stripe_subscription_id='sub_equal_live', status='active', stripe_last_event_created=100)
    db_session.add(sub)
    db_session.commit()
    monkeypatch.setattr(server, 'construct_webhook_event', lambda *_: {
        'id': 'evt_equal_live', 'created': 100, 'type': 'invoice.payment_failed',
        'data': {'object': {'subscription': 'sub_equal_live'}},
    })
    monkeypatch.setattr(server, 'get_subscription', lambda *_: {
        'status': 'canceled', 'price_id': 'price_basic', 'current_period_start': 1,
        'current_period_end': 200, 'cancel_at_period_end': False, 'canceled_at': 150,
    })
    monkeypatch.setattr(server, 'get_plan_for_stripe_price_id', lambda _: ('basic', 'monthly'))
    assert post_event(client).status_code == 200
    db_session.refresh(sub)
    assert sub.status == 'canceled'
    assert StripeWebhookEvent.query.filter_by(event_id='evt_equal_live').count() == 1


@pytest.mark.parametrize('kind', ['invoice.paid', 'invoice.payment_failed', 'checkout.session.completed'])
def test_old_cross_type_event_cannot_reactivate_canceled_subscription(client, db_session, regular_user, monkeypatch, kind):
    sub = Subscription(user_id=regular_user.id, stripe_subscription_id='sub_stale', status='canceled', stripe_last_event_created=200)
    db_session.add(sub)
    db_session.commit()
    monkeypatch.setattr(server, 'construct_webhook_event', lambda *_: {
        'id': 'evt_stale', 'created': 100, 'type': kind,
        'data': {'object': {'subscription': 'sub_stale', 'metadata': {'user_id': str(regular_user.id)}}},
    })
    assert post_event(client).status_code == 200
    db_session.refresh(sub)
    assert sub.status == 'canceled'
