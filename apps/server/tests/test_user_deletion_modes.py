"""Mode-specific safety contracts for administrative user deletion."""

import datetime

import pytest

import config
from app import create_access_token
from models import Database, RefreshToken, Subscription, User, db


pytestmark = pytest.mark.skipif(
    not config.is_saas(), reason='requires a SaaS-mode application process'
)


def _headers_for(user):
    token = create_access_token(user.id, user.role)
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


def _create_user(db_session, username, *, role='user', creator=None):
    user = User(
        username=username,
        role=role,
        email=f'{username}@test.com',
        password_change_required=False,
        created_by_id=creator.id if creator else None,
    )
    user.set_password('pw12345678')
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_deleting_direct_subadmin_reparents_children_and_databases(
    client, db_session, admin_user
):
    subadmin = _create_user(
        db_session, 'transfer-subadmin', role='admin', creator=admin_user
    )
    child_admin = _create_user(
        db_session, 'transfer-child', role='admin', creator=subadmin
    )
    database = Database(
        name='transfer-db',
        display_name='Transfer DB',
        owner_id=subadmin.id,
    )
    database.users.append(subadmin)
    db_session.add(database)
    db_session.commit()

    subadmin_id = subadmin.id
    child_admin_id = child_admin.id
    database_id = database.id

    response = client.delete(
        f'/api/v2/users/{subadmin_id}', headers=_headers_for(admin_user)
    )

    assert response.status_code == 200
    db.session.expire_all()
    assert db.session.get(User, subadmin_id) is None
    reparented_child = db.session.get(User, child_admin_id)
    assert reparented_child.created_by_id == admin_user.id
    assert reparented_child.is_account_owner is False
    transferred_database = db.session.get(Database, database_id)
    assert transferred_database.owner_id == admin_user.id
    assert admin_user.id in {user.id for user in transferred_database.users}


def test_account_owner_cannot_delete_another_account_owner_without_cleanup(
    client, db_session, admin_user
):
    other_owner = _create_user(db_session, 'other-owner', role='admin')
    token = RefreshToken(
        user_id=other_owner.id,
        token_hash='1' * 64,
        expires_at=datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(days=1),
    )
    db_session.add(token)
    db_session.commit()

    response = client.delete(
        f'/api/v2/users/{other_owner.id}', headers=_headers_for(admin_user)
    )

    assert response.status_code == 403
    assert db.session.get(User, other_owner.id) is not None
    assert RefreshToken.query.filter_by(user_id=other_owner.id).count() == 1


def test_account_owner_cannot_delete_another_tenants_member(
    client, db_session, admin_user
):
    other_owner = _create_user(db_session, 'tenant-owner', role='admin')
    other_member = _create_user(
        db_session, 'tenant-member', creator=other_owner
    )

    response = client.delete(
        f'/api/v2/users/{other_member.id}', headers=_headers_for(admin_user)
    )

    assert response.status_code == 403
    assert db.session.get(User, other_member.id) is not None


def test_subadmin_cannot_delete_parent(client, db_session, admin_user):
    subadmin = _create_user(
        db_session, 'parent-guard-subadmin', role='admin', creator=admin_user
    )

    response = client.delete(
        f'/api/v2/users/{admin_user.id}', headers=_headers_for(subadmin)
    )

    assert response.status_code == 403
    assert db.session.get(User, admin_user.id) is not None


def test_subadmin_cannot_delete_sibling(client, db_session, admin_user):
    subadmin = _create_user(
        db_session, 'sibling-guard-subadmin', role='admin', creator=admin_user
    )
    sibling = _create_user(
        db_session, 'sibling-guard-user', creator=admin_user
    )

    response = client.delete(
        f'/api/v2/users/{sibling.id}', headers=_headers_for(subadmin)
    )

    assert response.status_code == 403
    assert db.session.get(User, sibling.id) is not None


def test_subadmin_can_delete_direct_child(client, db_session, admin_user):
    subadmin = _create_user(
        db_session, 'child-control-subadmin', role='admin', creator=admin_user
    )
    child = _create_user(db_session, 'child-control-user', creator=subadmin)
    child_id = child.id

    response = client.delete(
        f'/api/v2/users/{child_id}', headers=_headers_for(subadmin)
    )

    assert response.status_code == 200
    assert db.session.get(User, child_id) is None


def test_external_subscription_blocks_delete_without_partial_cleanup(
    client, db_session, admin_user, regular_user
):
    subscription = Subscription(
        user_id=regular_user.id,
        stripe_customer_id='cus_delete_guard',
        stripe_subscription_id='sub_delete_guard',
        tier='basic',
        status='active',
    )
    token = RefreshToken(
        user_id=regular_user.id,
        token_hash='2' * 64,
        expires_at=datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(days=1),
    )
    db_session.add_all([subscription, token])
    db_session.commit()

    response = client.delete(
        f'/api/v2/users/{regular_user.id}', headers=_headers_for(admin_user)
    )

    assert response.status_code == 409
    assert db.session.get(User, regular_user.id) is not None
    assert Subscription.query.filter_by(user_id=regular_user.id).count() == 1
    assert RefreshToken.query.filter_by(user_id=regular_user.id).count() == 1


def test_account_owner_cannot_update_or_inspect_another_account_owner(
    client, db_session, admin_user
):
    other_owner = _create_user(db_session, 'endpoint-owner', role='admin')
    database = Database(
        name='endpoint-owner-db',
        display_name='Endpoint Owner DB',
        owner_id=other_owner.id,
    )
    database.users.append(other_owner)
    db_session.add(database)
    db_session.commit()

    update_response = client.put(
        f'/api/v2/users/{other_owner.id}',
        json={'email': 'stolen@test.com'},
        headers=_headers_for(admin_user),
    )
    databases_response = client.get(
        f'/api/v2/users/{other_owner.id}/databases',
        headers=_headers_for(admin_user),
    )

    assert update_response.status_code == 403
    assert databases_response.status_code == 403
    db.session.expire_all()
    assert db.session.get(User, other_owner.id).email == 'endpoint-owner@test.com'
