"""Guarded mobile Mark paid must never undo another client or another occurrence."""
from datetime import datetime, timezone
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

import app as server
from models import Bill, BillShare, Payment, db


@pytest.fixture
def settlement(client, db_session, test_bill, admin_user, regular_user, user_auth_headers):
    share = BillShare(bill_id=test_bill.id, owner_user_id=admin_user.id,
        shared_with_user_id=regular_user.id, shared_with_identifier=regular_user.username,
        identifier_type="username", status="accepted", split_type="equal")
    db_session.add(share)
    db_session.commit()
    headers = {**user_auth_headers, "X-Database": "_all_"}
    row = client.get("/api/v2/settlements", headers=headers).get_json()["data"]["i_owe"][0]
    return share.id, test_bill.id, headers, {
        "client_mutation_id": str(uuid.uuid4()),
        "base_updated_at": row["share_updated_at"], "base_bill_updated_at": row["bill_updated_at"],
        "expected_due_date": row["due_date"],
    }


def post(client, fixture, payload=None):
    share_id, _, headers, original = fixture
    return client.post(f"/api/v2/shares/{share_id}/mark-paid", headers=headers,
        json=original if payload is None else payload)


def test_settlement_payment_capability_and_version_are_advertised(client, settlement):
    assert client.get("/api/v2/config").get_json()["data"]["mobile"]["features"]["settlement_payment_preconditions"] is True
    assert settlement[3]["base_updated_at"].endswith("Z")
    assert settlement[3]["base_bill_updated_at"].endswith("Z")


def test_stale_mark_paid_cannot_unpay_another_client_payment(client, settlement, db_session):
    assert post(client, settlement, {}).status_code == 200  # Another client paid it.
    payment_id = Payment.query.filter_by(share_id=settlement[0]).one().id
    response = post(client, settlement)
    assert response.status_code == 409
    assert response.get_json()["conflict"]["reason"] == "modified"
    db_session.expire_all()
    assert Payment.query.filter_by(share_id=settlement[0]).one().id == payment_id
    assert db_session.get(BillShare, settlement[0]).recipient_paid_date is not None


def test_current_paid_snapshot_is_not_a_guarded_unmark_intent(client, settlement, db_session):
    paid = post(client, settlement, {})
    payload = {**settlement[3], "base_updated_at": paid.get_json()["data"]["updated_at"]}
    response = post(client, settlement, payload)
    assert response.status_code == 409
    assert response.get_json()["conflict"]["reason"] == "already_paid"
    assert Payment.query.filter_by(share_id=settlement[0]).count() == 1
    # Legacy callers can still intentionally toggle their payment off.
    assert post(client, settlement, {}).status_code == 200
    assert Payment.query.filter_by(share_id=settlement[0]).count() == 0


def test_lost_response_retry_replays_before_new_version_or_occurrence_checks(client, settlement, db_session):
    first = post(client, settlement)
    assert first.status_code == 200
    bill = db_session.get(Bill, settlement[1])
    bill.due_date = "2026-02-15"
    bill.amount = float(bill.amount) + 10
    db_session.commit()
    retry = post(client, settlement)
    assert retry.status_code == 200
    assert retry.headers["Idempotency-Replayed"] == "true"
    assert retry.get_json() == first.get_json()
    assert Payment.query.filter_by(share_id=settlement[0]).count() == 1


@pytest.mark.parametrize("value", [None, "", "20260215", "2026-02-30", 12, []])
def test_malformed_occurrence_is_rejected_without_payment(client, settlement, value):
    response = post(client, settlement, {**settlement[3], "expected_due_date": value})
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_expected_due_date"
    assert Payment.query.filter_by(share_id=settlement[0]).count() == 0


def test_guarded_occurrence_requires_a_version(client, settlement):
    response = post(client, settlement, {"expected_due_date": settlement[3]["expected_due_date"]})
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_base_updated_at"


def test_stale_occurrence_cannot_pay_a_renewed_bill(client, settlement, db_session):
    db_session.get(Bill, settlement[1]).due_date = "2026-02-15"
    db_session.commit()
    response = post(client, settlement)
    assert response.status_code == 409
    assert response.get_json()["conflict"]["reason"] == "occurrence_changed"
    assert Payment.query.filter_by(share_id=settlement[0]).count() == 0


@pytest.mark.parametrize("change", ["due_date", "paid"])
def test_rechecks_preloaded_state_after_waiting_for_the_bill_lock(
    client, app, settlement, db_session, monkeypatch, change
):
    reached_lock = threading.Event()
    original_lock = server._get_bill_for_mutation
    preloaded = []
    def lock_bill(bill_id, **kwargs):
        preloaded.extend([db.session.get(Bill, bill_id), db.session.get(BillShare, settlement[0])])
        reached_lock.set()
        return original_lock(bill_id, **kwargs)
    monkeypatch.setattr(server, "_get_bill_for_mutation", lock_bill)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with db.engine.begin() as connection:
            connection.execute(db.select(Bill.id).where(Bill.id == settlement[1]).with_for_update())
            def pay():
                with app.test_client() as other:
                    response = post(other, settlement)
                    return response.status_code, response.get_json()
            pending = pool.submit(pay)
            assert reached_lock.wait(timeout=5)
            if change == "due_date":
                connection.execute(db.update(Bill).where(Bill.id == settlement[1]).values(due_date="2026-02-15"))
            else:
                connection.execute(db.update(BillShare).where(BillShare.id == settlement[0])
                    .values(recipient_paid_date=datetime.now(timezone.utc)))
                connection.execute(db.insert(Payment).values(bill_id=settlement[1], share_id=settlement[0],
                    amount=50, payment_date="2026-02-15"))
        status, body = pending.result(timeout=5)
    assert status == 409
    assert body["conflict"]["reason"] == ("occurrence_changed" if change == "due_date" else "modified")
    db_session.expire_all()
    if change == "due_date":
        assert body["conflict"]["server"]["due_date"] == "2026-02-15"
        assert server._isoformat_utc(db_session.get(BillShare, settlement[0]).updated_at) == settlement[3]["base_updated_at"]
    assert Payment.query.filter_by(share_id=settlement[0]).count() == (0 if change == "due_date" else 1)


@pytest.mark.parametrize("mode", ["duplicate", "distinct", "legacy"])
def test_concurrent_guarded_and_legacy_requests_share_one_lock_order(app, settlement, db_session, monkeypatch, mode):
    barrier = threading.Barrier(2)
    original_lock = server._get_bill_for_mutation
    def lock_bill(bill_id, **kwargs):
        barrier.wait(timeout=5)
        return original_lock(bill_id, **kwargs)
    monkeypatch.setattr(server, "_get_bill_for_mutation", lock_bill)
    def pay(index):
        payload = dict(settlement[3])
        if mode == "distinct": payload["client_mutation_id"] = str(uuid.uuid4())
        if mode == "legacy" and index == 1: payload = {}
        with app.test_client() as other:
            response = post(other, settlement, payload)
            return response.status_code, response.headers.get("Idempotency-Replayed")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(pay, range(2)))
    statuses = sorted(status for status, _ in results)
    assert statuses == ([200, 200] if mode == "duplicate" else [200, 409]) or (mode == "legacy" and statuses == [200, 200])
    if mode == "duplicate":
        assert sorted(replayed or "original" for _, replayed in results) == ["original", "true"]
    db_session.expire_all()
    assert Payment.query.filter_by(share_id=settlement[0]).count() == (0 if mode == "legacy" and statuses == [200, 200] else 1)


@pytest.mark.parametrize("payload", [[], False, 0, True, 1, ""])
def test_non_object_body_cannot_toggle_existing_payment(client, settlement, db_session, payload):
    assert post(client, settlement, {}).status_code == 200
    payment_id = Payment.query.filter_by(share_id=settlement[0]).one().id
    response = post(client, settlement, payload)
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_request_body"
    db_session.expire_all()
    assert Payment.query.filter_by(share_id=settlement[0]).one().id == payment_id
    assert db_session.get(BillShare, settlement[0]).recipient_paid_date is not None


def test_mark_paid_and_share_first_leave_do_not_deadlock(app, settlement, db_session, monkeypatch):
    share_locked = threading.Event()
    bill_locked = threading.Event()
    original_lock = server._get_share_for_mutation

    def lock_share(share_id, **kwargs):
        if kwargs.get("refresh"):
            # Mark paid already holds its bill lock and now waits for share.
            bill_locked.set()
            return original_lock(share_id, **kwargs)
        share = original_lock(share_id, **kwargs)
        share_locked.set()
        assert bill_locked.wait(timeout=5)
        return share  # Leave inserts an audit row requiring bill FK KEY SHARE.

    monkeypatch.setattr(server, "_get_share_for_mutation", lock_share)
    def leave():
        with app.test_client() as other:
            return other.post(f"/api/v2/shares/{settlement[0]}/leave", headers=settlement[2], json={}).status_code
    def pay():
        assert share_locked.wait(timeout=5)
        with app.test_client() as other:
            return post(other, settlement).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        leaving, paying = pool.submit(leave), pool.submit(pay)
        assert leaving.result(timeout=10) == 200
        assert paying.result(timeout=10) == 409
    db_session.expire_all()
    assert db_session.get(BillShare, settlement[0]).status == "revoked"
    assert Payment.query.filter_by(share_id=settlement[0]).count() == 0


def test_same_due_bill_amount_edit_requires_new_payment_intent(client, settlement, db_session):
    bill = db_session.get(Bill, settlement[1])
    bill.amount = float(bill.amount) + 10
    db_session.commit()
    response = post(client, settlement)
    assert response.status_code == 409
    assert response.get_json()["conflict"]["entity"] == "bill"
    assert response.get_json()["conflict"]["reason"] == "modified"
    assert Payment.query.filter_by(share_id=settlement[0]).count() == 0


@pytest.mark.parametrize("value", [None, "", "2026-01-01", 0, []])
def test_guarded_payment_rejects_invalid_bill_version(client, settlement, value):
    response = post(client, settlement, {**settlement[3], "base_bill_updated_at": value})
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_base_bill_updated_at"
    assert Payment.query.filter_by(share_id=settlement[0]).count() == 0


def test_guarded_payment_requires_bill_version(client, settlement):
    payload = dict(settlement[3])
    del payload["base_bill_updated_at"]
    assert post(client, settlement, payload).status_code == 400
    assert Payment.query.filter_by(share_id=settlement[0]).count() == 0
