"""Regression coverage for the September security review."""
import datetime
import hashlib
import uuid
from unittest.mock import Mock

import pytest
import app as server
import config
from models import db, User, UserInvite, Database, BillShare, SecurityConfirmation, Subscription, TwoFAConfig
from services import telemetry_receiver as receiver


def proof(client, headers, purpose):
    response = client.post('/api/v2/auth/security-confirmation', headers=headers,
                           json={'purpose': purpose, 'password': 'testpassword123'})
    assert response.status_code == 200, response.json
    return {**headers, 'X-Security-Confirmation': response.json['data']['confirmation_token']}


@pytest.mark.parametrize('ids', [[99999999], ['1'], [True], [1.0], '1', [0]])
def test_invitation_rejects_missing_and_ambiguous_ids(client, db_session, admin_user, admin_auth_headers, monkeypatch, ids):
    monkeypatch.setattr(server, 'check_tier_limit', lambda *args: (True, {}))
    result = client.post('/api/v2/invitations', headers=admin_auth_headers,
                         json={'email': 'invite@example.com', 'database_ids': ids})
    assert result.status_code in (400, 403)
    assert UserInvite.query.count() == 0


def test_invitation_revalidates_ownership_at_acceptance(client, db_session, admin_user, regular_user, monkeypatch):
    monkeypatch.setattr(server, 'is_saas', lambda: True)
    database = Database(name='future-victim', display_name='Victim', owner_id=regular_user.id)
    db_session.add(database)
    db_session.flush()
    invite = UserInvite(email='attacker@example.com', role='user', invited_by_id=admin_user.id,
        database_ids=str(database.id), expires_at=server._naive_utcnow() + datetime.timedelta(days=1))
    token = invite.set_token()
    db_session.add(invite)
    db_session.commit()
    denied = client.post('/api/v2/invitations/accept', json={'token': token, 'username': 'attacker', 'password': 'StrongPassword123!'})
    assert denied.status_code == 403
    assert User.query.filter_by(username='attacker').first() is None
    database.owner_id = admin_user.id
    db_session.commit()
    allowed = client.post('/api/v2/invitations/accept', json={'token': token, 'username': 'legitimate', 'password': 'StrongPassword123!'})
    assert allowed.status_code == 201
    assert database in User.query.filter_by(username='legitimate').one().accessible_databases


@pytest.mark.parametrize('route', ['accept', 'decline', 'token'])
def test_share_recipient_cannot_be_replaced_by_matching_email(client, db_session, admin_user, regular_user, test_bill, admin_auth_headers, user_auth_headers, route):
    share = BillShare(bill_id=test_bill.id, owner_user_id=admin_user.id,
        shared_with_user_id=regular_user.id, shared_with_identifier=admin_user.email.upper(),
        identifier_type='email', status='pending')
    token = share.set_invite_token()
    db_session.add(share)
    db_session.commit()
    path = '/api/v2/shares/accept-token' if route == 'token' else f'/api/v2/shares/{share.id}/{route}'
    # The token route's name is discovered from the app's public contract.
    if route == 'token':
        path = next(rule.rule for rule in server.app.url_map.iter_rules() if rule.endpoint.endswith('jwt_accept_share_by_token'))
    denied = client.post(path, headers=admin_auth_headers, json={'token': token})
    assert denied.status_code == 403
    db_session.refresh(share)
    assert share.shared_with_user_id == regular_user.id
    if route != 'token':
        assert client.post(path, headers=user_auth_headers, json={}).status_code == 200


def test_administration_cannot_redirect_a_verified_identity(client, db_session, admin_user, regular_user, admin_auth_headers):
    regular_user.email_verified_at = server._naive_utcnow()
    original = regular_user.email
    db_session.commit()
    result = client.put(f'/api/v2/users/{regular_user.id}', headers=admin_auth_headers, json={'email': 'attacker@gmail.com'})
    assert result.status_code == 403
    db_session.refresh(regular_user)
    assert regular_user.email == original
    assert regular_user.email_verified_at is not None
    assert client.put(f'/api/v2/users/{regular_user.id}', headers=admin_auth_headers, json={'role': 'user', 'email': original}).status_code == 200


@pytest.mark.parametrize('action', ['accept', 'decline'])
def test_future_email_recipient_must_verify_before_numeric_acceptance(client, db_session, admin_user, regular_user, test_bill, user_auth_headers, action):
    share = BillShare(bill_id=test_bill.id, owner_user_id=admin_user.id,
        shared_with_identifier=regular_user.email.upper(), identifier_type='email', status='pending')
    db_session.add(share)
    regular_user.email_verified_at = None
    db_session.commit()
    path = f'/api/v2/shares/{share.id}/{action}'
    assert client.post(path, headers=user_auth_headers, json={}).status_code == 403
    assert not client.get('/api/v2/shared-bills/pending', headers=user_auth_headers).json['data']
    regular_user.email_verified_at = server._naive_utcnow()
    db_session.commit()
    assert client.get('/api/v2/shared-bills/pending', headers=user_auth_headers).json['data'][0]['share_id'] == share.id
    assert client.post(path, headers=user_auth_headers, json={}).status_code == 200


def test_confirmation_is_bound_to_user_purpose_expiry_and_single_use(client, db_session, admin_user, regular_user, admin_auth_headers, user_auth_headers):
    db_session.add(TwoFAConfig(user_id=admin_user.id, email_otp_enabled=True))
    db_session.commit()
    route = '/api/v2/auth/2fa/recovery-codes'
    assert client.get(route, headers=admin_auth_headers).status_code in (404, 405)
    assert client.post(route, headers=admin_auth_headers).status_code == 428
    wrong = proof(client, admin_auth_headers, 'oauth_link')
    assert client.post(route, headers=wrong).status_code == 428
    valid = proof(client, admin_auth_headers, 'recovery_codes')
    cross_user = {**user_auth_headers, 'X-Security-Confirmation': valid['X-Security-Confirmation']}
    assert client.post(route, headers=cross_user).status_code == 428
    assert client.post(route, headers=valid).status_code == 200
    assert client.post(route, headers=valid).status_code == 428
    expired = proof(client, admin_auth_headers, 'recovery_codes')
    grant = SecurityConfirmation.query.filter_by(token_hash=hashlib.sha256(expired['X-Security-Confirmation'].encode()).hexdigest()).one()
    grant.expires_at = server._naive_utcnow() - datetime.timedelta(seconds=1)
    db_session.commit()
    assert client.post(route, headers=expired).status_code == 428


def test_passkey_enrollment_requires_fresh_confirmation(client, db_session, admin_user, admin_auth_headers, monkeypatch):
    monkeypatch.setattr(server, 'ENABLE_PASSKEYS', True)
    route = '/api/v2/auth/2fa/setup/passkey/options'
    assert client.post(route, headers=admin_auth_headers).status_code == 428
    assert client.post(route, headers=proof(client, admin_auth_headers, 'passkey_add')).status_code == 200


def test_oidc_deletion_requires_independent_email_proof(client, db_session, admin_user, admin_auth_headers, monkeypatch):
    admin_user.password_hash = None
    admin_user.email_verified_at = server._naive_utcnow()
    db_session.commit()
    denied = client.delete('/api/v2/account', headers=admin_auth_headers, json={'confirm': True})
    assert denied.status_code == 428
    sent = Mock(return_value=True)
    monkeypatch.setattr('services.email.send_2fa_code_email', sent)
    challenge = client.post('/api/v2/auth/security-confirmation/send-code', headers=admin_auth_headers, json={'purpose': 'delete_account'})
    assert challenge.status_code == 200
    body = {'purpose': 'delete_account', 'challenge': challenge.json['data']['challenge'], 'code': 'wrong'}
    assert client.post('/api/v2/auth/security-confirmation', headers=admin_auth_headers, json=body).status_code == 400
    body['code'] = sent.call_args.args[1]
    verified = client.post('/api/v2/auth/security-confirmation', headers=admin_auth_headers, json=body)
    assert verified.status_code == 200
    assert client.post('/api/v2/auth/security-confirmation', headers=admin_auth_headers, json=body).status_code == 400
    result = client.delete('/api/v2/account', headers={**admin_auth_headers, 'X-Security-Confirmation': verified.json['data']['confirmation_token']}, json={'confirm': True})
    assert result.status_code == 200


@pytest.mark.parametrize('price, expected', [('price_opaque123', 'basic'), ('price_unknown_plus', 'free')])
def test_stripe_updated_uses_exact_configured_price(client, db_session, admin_user, monkeypatch, price, expected):
    sub = Subscription(user_id=admin_user.id, tier='plus', status='active', stripe_subscription_id='sub_security')
    db_session.add(sub)
    db_session.commit()
    monkeypatch.setattr(config, 'STRIPE_PRICES', {'basic': {'monthly': 'price_opaque123'}})
    monkeypatch.setattr(server, 'construct_webhook_event', lambda *args: {'type': 'customer.subscription.updated', 'data': {'object': {
        'id': 'sub_security', 'status': 'active', 'items': {'data': [{'price': {'id': price, 'recurring': {'interval': 'month'}}}]}}}})
    assert client.post('/api/v2/webhooks/stripe', headers={'Stripe-Signature': 'test'}, data='{}').status_code == 200
    db_session.refresh(sub)
    assert sub.tier == expected


def test_ingest_key_cannot_read_stats_or_emit_trusted_alerts(app, db_session, monkeypatch):
    monkeypatch.setattr(receiver, 'TELEMETRY_RECEIVER_API_KEY', 'ingest-test')
    monkeypatch.setattr(receiver, 'TELEMETRY_STATS_API_KEY', 'operator-test')
    monkeypatch.setattr(receiver, 'TELEMETRY_INGEST_REQUIRE_AUTH', True)
    receiver._request_buckets.clear()
    alert = Mock()
    monkeypatch.setattr(receiver, '_send_saas_deployment_alert', alert)
    with app.test_request_context('/api/telemetry/stats', headers={'X-Telemetry-Api-Key': 'ingest-test'}):
        assert receiver.get_telemetry_stats()[1] == 401
    with app.test_request_context('/api/telemetry/stats', headers={'X-Telemetry-Api-Key': 'operator-test'}):
        assert receiver.get_telemetry_stats()[1] == 200
    with app.test_request_context('/api/telemetry', method='POST', headers={'X-Telemetry-Api-Key': 'ingest-test'}, json={'instance_id': str(uuid.uuid4()), 'deployment_mode': 'saas'}):
        assert receiver.receive_telemetry()[1] == 200
    alert.assert_not_called()
    monkeypatch.setattr(receiver, 'TELEMETRY_STATS_API_KEY', 'ingest-test')
    with app.test_request_context('/api/telemetry/stats', headers={'X-Telemetry-Api-Key': 'ingest-test'}):
        assert receiver.get_telemetry_stats()[1] == 401


def test_documentation_uses_only_local_scripts(client):
    response = client.get('/api/v2/docs')
    assert response.status_code == 200
    assert 'https://' not in response.text
    assert '/docs/swagger-ui-bundle.js' in response.text
