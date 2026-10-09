"""Approved pricing, entitlement compatibility, and no-card trial contracts."""
import datetime
from types import SimpleNamespace

import pytest
import app as server
import config
from app import create_access_token
from models import Subscription, User, UserInvite
from services import stripe_service, email


def test_only_pro_is_purchasable_and_free_is_unchanged():
    assert set(config.STRIPE_PRICES) == {'pro'}
    assert set(config.TIER_LIMITS) == {'free', 'pro'}
    assert config.STRIPE_PRICES['pro']['monthly_amount'] == 299
    assert config.STRIPE_PRICES['pro']['annual_amount'] == 2400
    assert config.TIER_LIMITS['free'] == dict(bills=10, users=1, bill_groups=1,
        export=False, full_analytics=False, priority_support=False)
    assert config.get_tier_limits('pro') == dict(bills=-1, users=6, bill_groups=3,
        export=True, full_analytics=True, priority_support=True)
    assert config.get_stripe_price_id('basic', 'monthly') is None
    assert config.get_stripe_price_id('plus', 'annual') is None


@pytest.mark.parametrize('tier', ['pro', 'basic', 'plus'])
@pytest.mark.parametrize('status,expected', [('active', 'pro'), ('past_due', 'free'),
    ('canceled', 'free'), ('unpaid', 'free')])
def test_existing_and_new_paid_entitlements(tier, status, expected):
    assert Subscription(tier=tier, status=status).effective_tier == expected
    assert config.get_tier_limits(tier)['users'] == 6


@pytest.mark.parametrize('expired', [False, True])
def test_trial_entitlement_expires_to_free(expired):
    end = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=-1 if expired else 30)
    sub = Subscription(status='trialing', trial_ends_at=end)
    assert sub.effective_tier == ('free' if expired else 'pro')


@pytest.mark.parametrize('interval', ['monthly', 'annual'])
def test_current_and_historical_price_resolution(monkeypatch, interval):
    monkeypatch.setattr(config, 'STRIPE_PRICES', {'pro': {interval: 'price_pro', 'name': 'Pro'}})
    monkeypatch.setattr(config, 'LEGACY_STRIPE_PRICES', {
        'basic': {interval: 'price_old_basic'}, 'plus': {interval: 'price_old_plus'}})
    for price in ('price_pro', 'price_old_basic', 'price_old_plus'):
        assert config.get_plan_for_stripe_price_id(price) == ('pro', interval)
    for invalid in (None, '', 'unknown', 'Pro'):
        assert config.get_plan_for_stripe_price_id(invalid) is None


@pytest.mark.parametrize('tier', ['pro', 'basic', 'plus'])
@pytest.mark.parametrize('interval', ['monthly', 'annual'])
def test_checkout_uses_only_pro_including_old_client_requests(client, admin_auth_headers, monkeypatch, tier, interval):
    monkeypatch.setattr(server, 'get_billing_readiness', lambda: {'billing_enabled': True})
    calls = []
    def checkout(*args):
        calls.append(args)
        return {'url': 'https://checkout.example/session', 'session_id': 'cs_test'}
    monkeypatch.setattr(server, 'create_checkout_session', checkout)
    response = client.post('/api/v2/billing/create-checkout', json={'tier': tier, 'interval': interval}, headers=admin_auth_headers)
    assert response.status_code == 200
    assert calls[0][3:] == ('pro', interval)


@pytest.mark.parametrize('interval', ['monthly', 'annual'])
def test_pro_checkout_price_and_metadata_agree(monkeypatch, interval):
    monkeypatch.setattr(stripe_service, 'get_billing_readiness', lambda: {'billing_enabled': True})
    monkeypatch.setattr(config, 'STRIPE_PRICES', {'pro': {'monthly': 'price_pm', 'annual': 'price_pa'}})
    captured = {}
    def create(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(url='https://checkout.example/session', id='cs_test')
    monkeypatch.setattr(stripe_service.stripe.checkout.Session, 'create', create)
    result = stripe_service.create_checkout_session(1, 'test@example.com', 'cus_test', 'pro', interval)
    assert 'error' not in result
    assert captured['line_items'] == [{'price': 'price_pm' if interval == 'monthly' else 'price_pa', 'quantity': 1}]
    assert captured['metadata']['tier'] == captured['subscription_data']['metadata']['tier'] == 'pro'
    # Stripe API 2026-09-30.endive rejects payment_method_types on Checkout Sessions.
    assert captured['allowed_payment_method_types'] == ['card']
    assert 'payment_method_types' not in captured


def test_registration_creates_30_day_trial_without_payment(client, db_session, monkeypatch):
    monkeypatch.setattr(server, 'ENABLE_REGISTRATION', True)
    monkeypatch.setattr(server, 'ENABLE_BILLING', True)
    monkeypatch.setattr(server, 'REQUIRE_EMAIL_VERIFICATION', False)
    monkeypatch.setattr(server, 'is_saas', lambda: True)
    before = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    response = client.post('/api/v2/auth/register', json={
        'username': 'trialcustomer', 'email': 'trial@example.com', 'password': 'TrialPassword123!'})
    assert response.status_code == 201
    after = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    user = User.query.filter_by(username='trialcustomer').one()
    assert before + datetime.timedelta(days=30) <= user.trial_ends_at <= after + datetime.timedelta(days=30)
    assert user.subscription.trial_ends_at == user.trial_ends_at
    assert user.subscription.effective_tier == 'pro'
    assert user.subscription.stripe_customer_id is None
    assert user.subscription.stripe_subscription_id is None


def test_pro_allows_sixth_seat_but_rejects_seventh(admin_user, test_database, db_session, monkeypatch):
    monkeypatch.setattr(config, 'DEPLOYMENT_MODE', 'saas')
    test_database.owner_id = admin_user.id
    if admin_user.subscription is None:
        db_session.add(Subscription(user_id=admin_user.id, tier='pro', status='active'))
    for i in range(4):
        db_session.add(UserInvite(email=f'invite{i}@example.com', token=f'token{i}',
            invited_by_id=admin_user.id, expires_at=datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=1)))
    db_session.commit()
    allowed, info = server.check_tier_limit(admin_user, 'users')
    assert allowed and info['used'] == 5 and info['limit'] == 6
    db_session.add(UserInvite(email='sixth@example.com', token='sixth', invited_by_id=admin_user.id,
        expires_at=datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=1)))
    db_session.commit()
    allowed, info = server.check_tier_limit(admin_user, 'users')
    assert not allowed and info['used'] == 6


def _managed_user_headers(user, database):
    return {
        "Authorization": f"Bearer {create_access_token(user.id, user.role)}",
        "Content-Type": "application/json",
        "X-Database": database.name,
    }


def test_free_downgrade_hides_and_blocks_existing_managed_seat(
    client, admin_user, regular_user, test_database, test_bill, db_session, monkeypatch
):
    monkeypatch.setattr(config, "DEPLOYMENT_MODE", "saas")
    test_database.owner_id = admin_user.id
    regular_user.created_by_id = admin_user.id
    regular_user.accessible_databases.append(test_database)
    subscription = admin_user.subscription
    if subscription is None:
        subscription = Subscription(user_id=admin_user.id, tier="pro", status="active")
        db_session.add(subscription)
    db_session.commit()

    owner_headers = _managed_user_headers(admin_user, test_database)
    managed_headers = _managed_user_headers(regular_user, test_database)
    assert client.get("/api/v2/bills", headers=managed_headers).status_code == 200
    assert len(client.get("/api/v2/users", headers=owner_headers).get_json()["data"]) == 2

    subscription.status = "canceled"
    db_session.commit()

    listed_users = client.get("/api/v2/users", headers=owner_headers)
    managed_request = client.get("/api/v2/bills", headers=managed_headers)
    assert [user["id"] for user in listed_users.get_json()["data"]] == [admin_user.id]
    assert managed_request.status_code == 403

    subscription.status = "active"
    db_session.commit()
    assert client.get("/api/v2/bills", headers=managed_headers).status_code == 200


def test_free_downgrade_rejects_stale_invitation_without_creating_user_or_grant(
    client, admin_user, test_database, db_session, monkeypatch
):
    monkeypatch.setattr(config, "DEPLOYMENT_MODE", "saas")
    test_database.owner_id = admin_user.id
    subscription = admin_user.subscription
    if subscription is None:
        subscription = Subscription(user_id=admin_user.id, tier="pro", status="active")
        db_session.add(subscription)
    invite = UserInvite(
        email="stale-invite@example.com",
        role="user",
        invited_by_id=admin_user.id,
        database_ids=str(test_database.id),
        expires_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1),
    )
    token = invite.set_token()
    db_session.add(invite)
    db_session.commit()

    subscription.status = "canceled"
    db_session.commit()
    response = client.post("/api/v2/invitations/accept", json={
        "token": token,
        "username": "staleinvite",
        "password": "StrongPassword123!",
    })

    assert response.status_code == 403
    assert User.query.filter_by(username="staleinvite").first() is None
    assert invite.accepted_at is None
    assert {user.id for user in test_database.users} == {admin_user.id}


def test_delayed_checkout_preserves_provider_cancellation_and_free_seat_guards(
    client, admin_user, regular_user, test_database, test_bill, db_session, monkeypatch
):
    """A delayed checkout event must not reactivate a provider-canceled subscription."""
    monkeypatch.setattr(config, "DEPLOYMENT_MODE", "saas")
    monkeypatch.setattr(server, "get_billing_readiness", lambda: {"billing_enabled": True})
    monkeypatch.setattr(config, "STRIPE_PRICES", {
        "pro": {"monthly": "price_pro_monthly", "annual": "price_pro_annual"}
    })

    test_database.owner_id = admin_user.id
    regular_user.created_by_id = admin_user.id
    regular_user.accessible_databases.append(test_database)
    subscription = admin_user.subscription
    if subscription is None:
        subscription = Subscription(user_id=admin_user.id)
        db_session.add(subscription)
    subscription.tier = "pro"
    subscription.status = "trialing"
    subscription.trial_ends_at = (
        datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)
    )
    invite = UserInvite(
        email="delayed-checkout-invite@example.com",
        role="user",
        invited_by_id=admin_user.id,
        database_ids=str(test_database.id),
        expires_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1),
    )
    token = invite.set_token()
    db_session.add(invite)
    db_session.commit()

    owner_headers = _managed_user_headers(admin_user, test_database)
    managed_headers = _managed_user_headers(regular_user, test_database)
    assert subscription.effective_tier == "free"
    assert client.get("/api/v2/bills", headers=managed_headers).status_code == 403

    checkout_calls = []

    def create_checkout(user_id, email, customer_id, tier, interval):
        checkout_calls.append((user_id, email, customer_id, tier, interval))
        return {
            "url": "https://checkout.example/session",
            "session_id": "cs_delayed",
            "customer_id": "cus_synthetic",
            "tier": "pro",
            "interval": "monthly",
        }

    monkeypatch.setattr(server, "create_checkout_session", create_checkout)
    checkout = client.post(
        "/api/v2/billing/create-checkout",
        json={"tier": "pro", "interval": "monthly"},
        headers=owner_headers,
    )
    assert checkout.status_code == 200
    assert checkout_calls[0][3:] == ("pro", "monthly")
    assert subscription.tier == "pro"
    assert subscription.effective_tier == "free"

    monkeypatch.setattr(server, "construct_webhook_event", lambda *_: {
        "id": "evt_delayed_checkout", "created": 100,
        "type": "checkout.session.completed",
        "data": {"object": {
            "subscription": "sub_synthetic", "customer": "cus_synthetic",
            "metadata": {"user_id": str(admin_user.id), "tier": "pro", "interval": "monthly"},
        }},
    })
    monkeypatch.setattr(server, "get_subscription", lambda *_: {
        "price_id": "price_pro_monthly", "status": "canceled",
        "current_period_start": 1, "current_period_end": 300,
    })

    webhook = client.post(
        "/api/v2/webhooks/stripe", data=b"{}",
        headers={"Stripe-Signature": "synthetic"},
    )
    assert webhook.status_code == 200
    assert subscription.status == "canceled"
    assert subscription.effective_tier == "free"
    assert client.get("/api/v2/bills", headers=managed_headers).status_code == 403
    assert [
        user["id"]
        for user in client.get("/api/v2/users", headers=owner_headers).get_json()["data"]
    ] == [admin_user.id]

    invite_response = client.post("/api/v2/invitations/accept", json={
        "token": token, "username": "delayedcheckoutinvite",
        "password": "StrongPassword123!",
    })
    assert invite_response.status_code == 403
    assert User.query.filter_by(username="delayedcheckoutinvite").first() is None
    assert invite.accepted_at is None


def test_self_hosted_managed_user_remains_visible_and_authorized(
    client, admin_user, regular_user, test_database, test_bill, db_session, monkeypatch
):
    monkeypatch.setattr(config, "DEPLOYMENT_MODE", "self-hosted")
    regular_user.created_by_id = admin_user.id
    regular_user.accessible_databases.append(test_database)
    db_session.commit()

    owner_headers = _managed_user_headers(admin_user, test_database)
    managed_headers = _managed_user_headers(regular_user, test_database)
    listed_ids = {
        user["id"] for user in client.get("/api/v2/users", headers=owner_headers).get_json()["data"]
    }
    assert listed_ids == {admin_user.id, regular_user.id}
    assert client.get("/api/v2/bills", headers=managed_headers).status_code == 200


def test_welcome_email_reports_30_days(monkeypatch):
    sent = []
    monkeypatch.setattr(email, 'send_email', lambda *args: sent.append(args) or True)
    email.send_welcome_email('trial@example.com', 'Trial')
    assert '30-day free trial' in sent[0][2]
    assert '14-day' not in sent[0][2]


def test_public_catalog_preserves_old_response_keys_as_non_purchasable_aliases(monkeypatch):
    monkeypatch.setattr(config, 'DEPLOYMENT_MODE', 'saas')
    public = config.get_public_config()
    assert public['purchasable_tiers'] == ['pro']
    for tier in ('pro', 'basic', 'plus'):
        assert public['pricing'][tier]['monthly'] == 299
        assert public['pricing'][tier]['annual'] == 2400
        assert public['pricing'][tier]['purchasable'] == (tier == 'pro')
        assert public['tier_limits'][tier]['users'] == 6
