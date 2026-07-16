"""
Regression tests for v2 (JWT) admin endpoints that had drifted from their
v1 (session) counterparts: database description handling, database access
grant/revoke, SaaS cross-account isolation, and user role-change guards.
"""
import datetime
import json

import config
from app import create_access_token
from models import (
    BillShare,
    Database,
    RefreshToken,
    ShareAuditLog,
    User,
    UserInvite,
    db,
)


def _headers_for(user):
    token = create_access_token(user.id, user.role)
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


class TestV2DatabaseDescription:
    def test_create_database_saves_description(self, client, admin_auth_headers):
        response = client.post(
            '/api/v2/databases',
            json={
                'name': 'newgroup',
                'display_name': 'New Group',
                'description': 'a helpful description',
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 201
        data = json.loads(response.data)['data']
        assert data['description'] == 'a helpful description'

    def test_list_databases_includes_description(self, client, admin_auth_headers, test_database):
        response = client.get('/api/v2/databases', headers=admin_auth_headers)
        assert response.status_code == 200
        data = json.loads(response.data)['data']
        match = next(d for d in data if d['id'] == test_database.id)
        assert match['description'] == test_database.description


class TestV2DatabaseAccessGet:
    def test_get_access_lists_users_with_access(self, client, admin_auth_headers, test_database, admin_user):
        response = client.get(
            f'/api/v2/databases/{test_database.id}/access', headers=admin_auth_headers
        )
        assert response.status_code == 200
        data = json.loads(response.data)['data']
        assert any(u['id'] == admin_user.id for u in data)


class TestV2AccessGrantRevokeIdempotency:
    def test_repeat_grant_is_idempotent(self, client, admin_auth_headers, test_database, regular_user):
        first = client.post(
            f'/api/v2/databases/{test_database.id}/access',
            json={'user_id': regular_user.id},
            headers=admin_auth_headers,
        )
        assert first.status_code == 200

        second = client.post(
            f'/api/v2/databases/{test_database.id}/access',
            json={'user_id': regular_user.id},
            headers=admin_auth_headers,
        )
        assert second.status_code == 200
        assert json.loads(second.data)['success'] is True

    def test_repeat_revoke_is_idempotent(self, client, admin_auth_headers, test_database, regular_user):
        first = client.delete(
            f'/api/v2/databases/{test_database.id}/access/{regular_user.id}',
            headers=admin_auth_headers,
        )
        assert first.status_code == 200

        second = client.delete(
            f'/api/v2/databases/{test_database.id}/access/{regular_user.id}',
            headers=admin_auth_headers,
        )
        assert second.status_code == 200
        assert json.loads(second.data)['success'] is True


class TestV2SaaSCrossAccountGrantDenial:
    def test_cannot_grant_access_to_user_outside_account(
        self, client, db_session, admin_user, monkeypatch
    ):
        monkeypatch.setattr(config, 'DEPLOYMENT_MODE', 'saas')

        database = Database(name='ownerdb', display_name='Owner DB', owner_id=admin_user.id)
        db_session.add(database)
        db_session.commit()

        other_admin = User(username='otheradmin', role='admin', email='otheradmin@test.com')
        other_admin.set_password('pw12345678')
        db_session.add(other_admin)
        db_session.commit()

        outside_user = User(
            username='outsider',
            role='user',
            email='outsider@test.com',
            created_by_id=other_admin.id,
        )
        outside_user.set_password('pw12345678')
        db_session.add(outside_user)
        db_session.commit()

        response = client.post(
            f'/api/v2/databases/{database.id}/access',
            json={'user_id': outside_user.id},
            headers=_headers_for(admin_user),
        )
        assert response.status_code == 403
        assert json.loads(response.data)['success'] is False

    def test_can_grant_access_to_own_created_user(self, client, db_session, admin_user, regular_user, monkeypatch):
        monkeypatch.setattr(config, 'DEPLOYMENT_MODE', 'saas')

        database = Database(name='ownerdb2', display_name='Owner DB 2', owner_id=admin_user.id)
        db_session.add(database)
        db_session.commit()

        response = client.post(
            f'/api/v2/databases/{database.id}/access',
            json={'user_id': regular_user.id},
            headers=_headers_for(admin_user),
        )
        assert response.status_code == 200


class TestV2UserRoleChangeGuards:
    def test_admin_cannot_demote_self(self, client, admin_auth_headers, admin_user):
        response = client.put(
            f'/api/v2/users/{admin_user.id}',
            json={'role': 'user'},
            headers=admin_auth_headers,
        )
        assert response.status_code == 400
        assert 'own role' in json.loads(response.data)['error'].lower()

    def test_invalid_role_rejected(self, client, admin_auth_headers, regular_user):
        response = client.put(
            f'/api/v2/users/{regular_user.id}',
            json={'role': 'superadmin'},
            headers=admin_auth_headers,
        )
        assert response.status_code == 400

    def test_cannot_demote_account_owner_in_saas_mode(self, client, db_session, admin_user, monkeypatch):
        monkeypatch.setattr(config, 'DEPLOYMENT_MODE', 'saas')

        sub_admin = User(
            username='subadmin',
            role='admin',
            email='subadmin@test.com',
            created_by_id=admin_user.id,
        )
        sub_admin.set_password('pw12345678')
        db_session.add(sub_admin)
        db_session.commit()

        response = client.put(
            f'/api/v2/users/{admin_user.id}',
            json={'role': 'user'},
            headers=_headers_for(sub_admin),
        )
        assert response.status_code == 400
        assert 'account owner' in json.loads(response.data)['error'].lower()


class TestV2UserDeletion:
    """Regression: several foreign keys onto users.id had no ON DELETE
    clause (created_by_id, refresh_tokens.user_id, user_invites.invited_by_id,
    bill_shares.owner_user_id, share_audit_log.actor_user_id), so deleting a
    user who had ever logged in, invited someone, or shared a bill raised a
    Postgres IntegrityError, surfaced to admins as a generic server error.
    jwt_delete_user now cleans up the same tables jwt_delete_account already
    did, scoped to just the one user being removed.
    """

    def test_deleting_user_with_related_history_does_not_500(
        self, client, db_session, admin_user, regular_user, test_bill
    ):
        second_admin = User(
            username='seconddeleter',
            role='admin',
            email='seconddeleter@test.com',
        )
        second_admin.set_password('pw12345678')
        db_session.add(second_admin)
        db_session.commit()

        # admin_user created regular_user (via the fixture) -> created_by_id
        db_session.add(RefreshToken(
            user_id=admin_user.id,
            token_hash='a' * 64,
            expires_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1),
        ))
        db_session.add(UserInvite(
            email='invitee@test.com',
            token='b' * 64,
            invited_by_id=admin_user.id,
            expires_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7),
        ))
        share = BillShare(
            bill_id=test_bill.id,
            owner_user_id=admin_user.id,
            shared_with_user_id=regular_user.id,
            shared_with_identifier=regular_user.username,
            identifier_type='username',
            status='accepted',
        )
        db_session.add(share)
        db_session.commit()
        db_session.refresh(share)
        ShareAuditLog.log_action(
            action='created', bill_id=test_bill.id, actor_user_id=admin_user.id, share_id=share.id,
        )
        db_session.commit()

        response = client.delete(
            f'/api/v2/users/{admin_user.id}', headers=_headers_for(second_admin)
        )
        assert response.status_code == 200
        assert json.loads(response.data)['success'] is True

        assert db.session.get(User, admin_user.id) is None
        # created_by_id is orphaned rather than blocking the delete, or
        # taking regular_user down with it
        db_session.refresh(regular_user)
        assert regular_user.created_by_id is None
        assert db.session.get(User, regular_user.id) is not None
        # dependent rows owned by the deleted user are cleaned up rather
        # than left dangling
        assert RefreshToken.query.filter_by(user_id=admin_user.id).count() == 0
        assert UserInvite.query.filter_by(invited_by_id=admin_user.id).count() == 0
        # share.id was bulk-deleted (synchronize_session=False), so the
        # already-loaded `share` instance is a stale identity-map entry;
        # db.session.get() would try to refresh it and raise
        # ObjectDeletedError instead of returning None. Query fresh instead.
        assert BillShare.query.filter_by(id=share.id).first() is None
        assert ShareAuditLog.query.filter_by(actor_user_id=admin_user.id).count() == 0


class TestV2DatabaseDeletionWithShareHistory:
    """Regression: deleting a bill group cascade-deletes its bills via the
    Database.bills relationship, but share_audit_log.bill_id has no ON
    DELETE clause, so a group containing any bill that was ever shared
    would fail the whole delete with a foreign key violation.
    """

    def test_deleting_database_with_shared_bill_does_not_500(
        self, client, admin_auth_headers, db_session, admin_user, regular_user, test_bill, test_database
    ):
        share = BillShare(
            bill_id=test_bill.id,
            owner_user_id=admin_user.id,
            shared_with_user_id=regular_user.id,
            shared_with_identifier=regular_user.username,
            identifier_type='username',
            status='accepted',
        )
        db_session.add(share)
        db_session.commit()
        db_session.refresh(share)
        ShareAuditLog.log_action(
            action='created', bill_id=test_bill.id, actor_user_id=admin_user.id, share_id=share.id,
        )
        db_session.commit()

        response = client.delete(
            f'/api/v2/databases/{test_database.id}', headers=admin_auth_headers
        )
        assert response.status_code == 200
        assert json.loads(response.data)['success'] is True

        assert db.session.get(Database, test_database.id) is None
        assert ShareAuditLog.query.filter_by(bill_id=test_bill.id).count() == 0
