"""Local entitlements do not imply provider portal management availability."""
import pytest

import app as server
from models import Subscription
from services import stripe_service


@pytest.mark.parametrize('customer,configured,owner,saas,expected', [
    (None, True, True, True, False),
    ('cus_unit_fixture', True, True, True, True),
    ('cus_unit_fixture', False, True, True, False),
    ('cus_unit_fixture', True, False, True, False),
    ('cus_unit_fixture', True, True, False, False),
])
def test_management_availability_is_separate_from_active_pro_entitlement(
    client, db_session, admin_user, admin_auth_headers, monkeypatch,
    customer, configured, owner, saas, expected,
):
    sub = Subscription(user=admin_user, tier='pro', status='active', stripe_customer_id=customer)
    db_session.add(sub)
    if not owner:
        admin_user.role = 'user'
    db_session.commit()
    monkeypatch.setattr(server, 'is_saas', lambda: saas)
    monkeypatch.setattr(stripe_service, 'STRIPE_AVAILABLE', True)
    monkeypatch.setattr(stripe_service, 'STRIPE_SECRET_KEY', 'unit-only-key' if configured else None)
    def forbidden(*args, **kwargs):
        raise AssertionError('Status must not contact Stripe')
    monkeypatch.setattr(server, 'create_portal_session', forbidden)
    monkeypatch.setattr(stripe_service.stripe.billing_portal.Session, 'create', forbidden)
    response = client.get('/api/v2/billing/status', headers=admin_auth_headers)
    assert response.status_code == 200
    data = response.get_json()['data']
    assert data['has_subscription'] is True
    assert data['is_active'] is True
    assert data['effective_tier'] == 'pro'
    assert data['can_manage_subscription'] is expected
    assert 'cus_unit_fixture' not in response.get_data(as_text=True)
    assert 'stripe_customer_id' not in data
    assert 'stripe_subscription_id' not in data
    if customer is None:
        assert client.post('/api/v2/billing/portal', headers=admin_auth_headers).status_code == 404


def test_no_subscription_cannot_offer_management(client, admin_auth_headers):
    data = client.get('/api/v2/billing/status', headers=admin_auth_headers).get_json()['data']
    assert data['has_subscription'] is False
    assert data['can_manage_subscription'] is False


def test_portal_configuration_requires_sdk_and_key(monkeypatch):
    monkeypatch.setattr(stripe_service, 'STRIPE_AVAILABLE', False)
    monkeypatch.setattr(stripe_service, 'STRIPE_SECRET_KEY', 'unit-only-key')
    assert stripe_service.is_portal_configured() is False
    monkeypatch.setattr(stripe_service, 'STRIPE_AVAILABLE', True)
    assert stripe_service.is_portal_configured() is True
    monkeypatch.setattr(stripe_service, 'STRIPE_SECRET_KEY', None)
    assert stripe_service.is_portal_configured() is False
