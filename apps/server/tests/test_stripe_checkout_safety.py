"""Checkout association safety independent of provider networking."""
import app as server
from models import Subscription, StripeWebhookEvent


def test_checkout_does_not_replace_a_different_subscription(client, db_session, regular_user, monkeypatch):
    sub = Subscription(user_id=regular_user.id, stripe_subscription_id='sub_existing', status='active')
    db_session.add(sub)
    db_session.commit()
    monkeypatch.setattr(server, 'construct_webhook_event', lambda *_: {
        'id': 'evt_replace', 'created': 100, 'type': 'checkout.session.completed',
        'data': {'object': {'subscription': 'sub_other', 'customer': 'cus_synthetic', 'metadata': {'user_id': str(regular_user.id)}}},
    })
    monkeypatch.setattr(server, 'get_subscription', lambda *_: {'price_id': 'price_basic', 'status': 'active', 'current_period_start': 1, 'current_period_end': 200})
    monkeypatch.setattr(server, 'get_plan_for_stripe_price_id', lambda _: ('basic', 'monthly'))
    response = client.post('/api/v2/webhooks/stripe', data=b'{}', headers={'Stripe-Signature': 'test'})
    assert response.status_code == 500
    db_session.refresh(sub)
    assert sub.stripe_subscription_id == 'sub_existing'
    assert StripeWebhookEvent.query.filter_by(event_id='evt_replace').count() == 0


def test_checkout_requires_subscription_identity(client, monkeypatch):
    monkeypatch.setattr(server, 'construct_webhook_event', lambda *_: {
        'id': 'evt_invalid_checkout', 'created': 100, 'type': 'checkout.session.completed',
        'data': {'object': {'metadata': {'user_id': '1'}}},
    })
    response = client.post('/api/v2/webhooks/stripe', data=b'{}', headers={'Stripe-Signature': 'test'})
    assert response.status_code == 400
