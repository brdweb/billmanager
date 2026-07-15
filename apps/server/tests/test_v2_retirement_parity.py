"""Regression coverage for v1 capabilities migrated to the v2 API."""

import datetime

from models import Payment, User, UserInvite


def _create_invite(db_session, admin_user, *, database_ids=""):
    invite = UserInvite(
        email="invitee@example.com",
        role="user",
        invited_by_id=admin_user.id,
        database_ids=database_ids,
        expires_at=datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(days=1),
    )
    token = invite.set_token()
    db_session.add(invite)
    db_session.commit()
    return invite, token


class TestV2PublicUserInvitations:
    def test_get_invitation_info_uses_v2_response_envelope(
        self, client, db_session, admin_user
    ):
        _, token = _create_invite(db_session, admin_user)

        response = client.get(f"/api/v2/invitations/info?token={token}")

        assert response.status_code == 200
        payload = response.get_json()
        assert payload["success"] is True
        assert payload["data"]["email"] == "invitee@example.com"
        assert payload["data"]["invited_by"] == admin_user.username

    def test_accept_invitation_creates_user_and_grants_invited_database_access(
        self, client, db_session, admin_user, test_database
    ):
        invite, token = _create_invite(
            db_session, admin_user, database_ids=str(test_database.id)
        )

        response = client.post(
            "/api/v2/invitations/accept",
            json={
                "token": token,
                "username": "invited-user",
                "password": "StrongPassword123",
            },
        )

        assert response.status_code == 201
        assert response.get_json() == {
            "success": True,
            "data": {
                "message": "Account created successfully",
                "username": "invited-user",
            },
        }
        created_user = User.query.filter_by(username="invited-user").one()
        assert created_user.email == invite.email
        assert test_database in created_user.accessible_databases
        assert invite.accepted_at is not None


class TestV2BillMonthlyPayments:
    def test_get_monthly_payment_totals_by_bill_id(
        self, client, auth_headers_with_db, test_bill, db_session
    ):
        db_session.add_all(
            [
                Payment(
                    bill_id=test_bill.id,
                    amount=10.50,
                    payment_date="2026-05-02",
                ),
                Payment(
                    bill_id=test_bill.id,
                    amount=11.25,
                    payment_date="2026-05-15",
                ),
                Payment(
                    bill_id=test_bill.id,
                    amount=12.75,
                    payment_date="2026-06-03",
                ),
            ]
        )
        db_session.commit()

        response = client.get(
            f"/api/v2/bills/{test_bill.id}/payments/monthly",
            headers=auth_headers_with_db,
        )

        assert response.status_code == 200
        assert response.get_json() == {
            "success": True,
            "data": [
                {"month": "2026-06", "total": 12.75, "count": 1},
                {"month": "2026-05", "total": 21.75, "count": 2},
            ],
        }


def test_v2_ping_preserves_the_legacy_health_check_capability(client):
    response = client.get("/api/v2/ping")

    assert response.status_code == 200
    assert response.get_json() == {"success": True, "data": {"status": "ok"}}
