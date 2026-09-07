"""PostgreSQL serialization and billing-readiness integration coverage."""
from concurrent.futures import ThreadPoolExecutor
import threading

import app as server
import config
from models import db, StripeWebhookEvent, Subscription
from services import stripe_service


def test_concurrent_duplicate_delivery_commits_once(app, db_session, regular_user, monkeypatch):
    db_session.add(Subscription(user_id=regular_user.id, stripe_subscription_id='sub_concurrent', status='active'))
    db_session.commit()
    barrier = threading.Barrier(2)

    def verified(*_):
        barrier.wait(timeout=10)
        return {'id': 'evt_concurrent', 'created': 100, 'type': 'invoice.payment_failed',
                'data': {'object': {'subscription': 'sub_concurrent'}}}

    monkeypatch.setattr(server, 'construct_webhook_event', verified)

    def deliver(_):
        with app.app_context():
            with app.test_client() as client:
                response = client.post('/api/v2/webhooks/stripe', data=b'{}', headers={'Stripe-Signature': 'test'})
                return response.status_code, response.get_json()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(deliver, range(2)))
    assert [status for status, _ in results] == [200, 200]
    assert sum(bool(body.get('duplicate')) for _, body in results) == 1
    db.session.expire_all()
    assert StripeWebhookEvent.query.filter_by(event_id='evt_concurrent').count() == 1
    assert Subscription.query.filter_by(stripe_subscription_id='sub_concurrent').one().status == 'past_due'


def test_checkout_and_capabilities_fail_closed_when_incomplete(client, admin_auth_headers, monkeypatch):
    monkeypatch.setattr(config, 'DEPLOYMENT_MODE', 'saas')
    monkeypatch.setattr(stripe_service, 'STRIPE_WEBHOOK_SECRET', None)
    response = client.post('/api/v2/billing/create-checkout', json={'tier': 'basic', 'interval': 'monthly'}, headers=admin_auth_headers)
    assert response.status_code == 503
    assert config.get_public_config()['billing_enabled'] is False
    assert config.get_mobile_capabilities()['features']['billing'] is False
    assert 'error' in stripe_service.create_checkout_session(1, 'synthetic@example.invalid')
