"""Safety contracts for full SaaS account erasure."""

from unittest.mock import Mock

import pytest

import config
from app import create_access_token
from models import Bill, Database, Subscription, User, db


pytestmark = pytest.mark.skipif(
    not config.is_saas(), reason="requires a SaaS-mode application process"
)


def _headers_for(user):
    token = create_access_token(user.id, user.role)
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _create_user(db_session, username, *, role="user", creator=None):
    user = User(
        username=username,
        role=role,
        email=f"{username}@test.com",
        password_change_required=False,
        created_by_id=creator.id if creator else None,
    )
    user.set_password("pw12345678")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_delete_account_erases_nested_users_and_their_owned_databases(
    client, db_session, admin_user
):
    subadmin = _create_user(
        db_session, "erasure-subadmin", role="admin", creator=admin_user
    )
    nested_admin = _create_user(
        db_session, "erasure-nested-admin", role="admin", creator=subadmin
    )
    nested_user = _create_user(
        db_session, "erasure-nested-user", creator=nested_admin
    )

    nested_database = Database(
        name="erasure-nested-db",
        display_name="Nested account data",
        owner_id=nested_admin.id,
    )
    nested_database.users.extend([nested_admin, nested_user])
    nested_bill = Bill(
        database=nested_database,
        name="Nested bill",
        amount=42.00,
        frequency="monthly",
        due_date="2026-08-01",
        type="expense",
    )
    db_session.add_all([nested_database, nested_bill])
    db_session.commit()

    other_owner = _create_user(db_session, "erasure-other-owner", role="admin")
    unrelated_database = Database(
        name="erasure-unrelated-db",
        display_name="Another tenant's data",
        owner_id=other_owner.id,
    )
    unrelated_database.users.extend([other_owner, nested_user])
    db_session.add(unrelated_database)
    db_session.commit()

    account_user_ids = {
        admin_user.id,
        subadmin.id,
        nested_admin.id,
        nested_user.id,
    }
    nested_database_id = nested_database.id
    nested_bill_id = nested_bill.id
    other_owner_id = other_owner.id
    unrelated_database_id = unrelated_database.id

    response = client.delete(
        "/api/v2/account",
        json={"password": "testpassword123"},
        headers=_headers_for(admin_user),
    )

    assert response.status_code == 200
    db.session.expire_all()
    assert all(db.session.get(User, user_id) is None for user_id in account_user_ids)
    assert db.session.get(Database, nested_database_id) is None
    assert db.session.get(Bill, nested_bill_id) is None

    unrelated_owner = db.session.get(User, other_owner_id)
    unrelated = db.session.get(Database, unrelated_database_id)
    assert unrelated_owner is not None
    assert unrelated is not None
    assert unrelated.owner_id == other_owner_id
    assert {user.id for user in unrelated.users} == {other_owner_id}


def test_delete_account_cancels_external_subscriptions_immediately(
    client, db_session, admin_user, monkeypatch
):
    managed_user = _create_user(
        db_session, "erasure-subscriber", creator=admin_user
    )
    subscriptions = [
        Subscription(
            user_id=admin_user.id,
            stripe_customer_id="cus_erasure_owner",
            stripe_subscription_id="sub_erasure_owner",
            tier="plus",
            status="active",
        ),
        Subscription(
            user_id=managed_user.id,
            stripe_customer_id="cus_erasure_member",
            stripe_subscription_id="sub_erasure_member",
            tier="basic",
            status="trialing",
        ),
    ]
    db_session.add_all(subscriptions)
    db_session.commit()
    owner_id = admin_user.id
    managed_user_id = managed_user.id

    cancel = Mock(side_effect=lambda subscription_id, at_period_end: {
        "id": subscription_id,
        "status": "canceled",
    })
    monkeypatch.setattr("app.cancel_subscription", cancel)

    response = client.delete(
        "/api/v2/account",
        json={"password": "testpassword123"},
        headers=_headers_for(admin_user),
    )

    assert response.status_code == 200
    assert cancel.call_count == 2
    assert {
        (call.args[0], call.kwargs["at_period_end"])
        for call in cancel.call_args_list
    } == {
        ("sub_erasure_owner", False),
        ("sub_erasure_member", False),
    }
    assert db.session.get(User, owner_id) is None
    assert db.session.get(User, managed_user_id) is None
    assert Subscription.query.count() == 0


def test_stripe_cancellation_failure_preserves_local_account_data(
    client, db_session, admin_user, monkeypatch
):
    subscription = Subscription(
        user_id=admin_user.id,
        stripe_customer_id="cus_erasure_failure",
        stripe_subscription_id="sub_erasure_failure",
        tier="plus",
        status="active",
    )
    database = Database(
        name="erasure-failure-db",
        display_name="Must survive failed cancellation",
        owner_id=admin_user.id,
    )
    database.users.append(admin_user)
    db_session.add_all([subscription, database])
    db_session.commit()
    user_id = admin_user.id
    database_id = database.id

    cancel = Mock(return_value={"error": "Stripe unavailable"})
    monkeypatch.setattr("app.cancel_subscription", cancel)

    response = client.delete(
        "/api/v2/account",
        json={"password": "testpassword123"},
        headers=_headers_for(admin_user),
    )

    assert response.status_code == 502
    assert response.get_json() == {
        "success": False,
        "error": "Unable to cancel subscription; account was not deleted",
    }
    cancel.assert_called_once_with("sub_erasure_failure", at_period_end=False)
    db.session.expire_all()
    assert db.session.get(User, user_id) is not None
    assert db.session.get(Database, database_id) is not None
    assert Subscription.query.filter_by(user_id=user_id).count() == 1


def test_invalid_password_does_not_cancel_or_delete(
    client, db_session, admin_user, monkeypatch
):
    subscription = Subscription(
        user_id=admin_user.id,
        stripe_subscription_id="sub_wrong_password",
        status="active",
    )
    db_session.add(subscription)
    db_session.commit()
    owner_id = admin_user.id

    cancel = Mock()
    monkeypatch.setattr("app.cancel_subscription", cancel)

    response = client.delete(
        "/api/v2/account",
        json={"password": "definitely-wrong"},
        headers=_headers_for(admin_user),
    )

    assert response.status_code == 401
    cancel.assert_not_called()
    assert db.session.get(User, owner_id) is not None
    assert Subscription.query.filter_by(user_id=owner_id).count() == 1


def test_managed_user_cannot_delete_the_account(client, db_session, admin_user):
    managed_user = _create_user(
        db_session, "erasure-non-owner", creator=admin_user
    )

    response = client.delete(
        "/api/v2/account",
        json={"password": "pw12345678"},
        headers=_headers_for(managed_user),
    )

    assert response.status_code == 403
    assert db.session.get(User, admin_user.id) is not None
    assert db.session.get(User, managed_user.id) is not None
