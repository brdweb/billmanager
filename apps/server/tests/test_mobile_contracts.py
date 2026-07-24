"""Focused tests for the additive mobile compatibility and mutation contract."""

import ast
import datetime
import re
import threading
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yaml

import config
import app as server_app

from models import (
    Bill,
    BillShare,
    ClientMutation,
    Database,
    Payment,
    ShareAuditLog,
    User,
    UserInvite,
)
from config import parse_webauthn_android_origins


SERVER_ROOT = Path(__file__).resolve().parents[1]
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}


def test_android_passkey_origins_are_exact_and_validated():
    valid = "android:apk-key-hash:" + ("A" * 43)
    assert parse_webauthn_android_origins(f" {valid}, ") == [valid]

    try:
        parse_webauthn_android_origins("https://example.com")
    except ValueError as error:
        assert "WEBAUTHN_ANDROID_ORIGINS" in str(error)
    else:
        raise AssertionError("Invalid Android passkey origin was accepted")


def _route_decorator(node):
    for decorator in node.decorator_list:
        if not isinstance(decorator, ast.Call) or not isinstance(
            decorator.func, ast.Attribute
        ):
            continue
        owner = decorator.func.value
        if (
            isinstance(owner, ast.Name)
            and owner.id == "api_v2_bp"
            and decorator.func.attr == "route"
        ):
            return decorator
    return None


def _decorator_names(node):
    names = set()
    for decorator in node.decorator_list:
        target = decorator.func if isinstance(decorator, ast.Call) else decorator
        if isinstance(target, ast.Name):
            names.add(target.id)
    return names


def _runtime_api_operations():
    tree = ast.parse((SERVER_ROOT / "app.py").read_text(encoding="utf-8"))
    operations = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        decorator = _route_decorator(node)
        if decorator is None:
            continue
        path = re.sub(
            r"<(?:int:)?([^>]+)>",
            r"{\1}",
            decorator.args[0].value,
        )
        methods = ["GET"]
        for keyword in decorator.keywords:
            if keyword.arg == "methods":
                methods = [element.value for element in keyword.value.elts]
        constants = {
            value.value
            for value in ast.walk(node)
            if isinstance(value, ast.Constant) and isinstance(value.value, str)
        }
        for method in methods:
            operations[(path, method.lower())] = {
                "decorators": _decorator_names(node),
                "requires_database": "X-Database header required" in constants,
            }
    return operations


def _resolve_local_ref(spec, reference):
    current = spec
    for part in reference.removeprefix("#/").split("/"):
        current = current[part.replace("~1", "/").replace("~0", "~")]
    return current


def test_openapi_covers_runtime_contract_and_resolves_all_local_refs():
    spec = yaml.safe_load((SERVER_ROOT / "openapi.yaml").read_text(encoding="utf-8"))
    runtime = _runtime_api_operations()
    documented = {
        (path, method): operation
        for path, path_item in spec["paths"].items()
        for method, operation in path_item.items()
        if method in HTTP_METHODS
    }

    assert documented.keys() == runtime.keys()

    operation_ids = [operation.get("operationId") for operation in documented.values()]
    assert all(operation_ids)
    assert not [key for key, count in Counter(operation_ids).items() if count > 1]

    capability_names = set(
        spec["components"]["schemas"]["MobileCapabilities"]["properties"]["features"][
            "properties"
        ]
    )
    for key, operation in documented.items():
        runtime_operation = runtime[key]
        decorators = runtime_operation["decorators"]
        security_names = {
            name
            for requirement in operation.get("security", [])
            for name in requirement
        }
        if key == ("/auth/change-password", "post"):
            # This endpoint intentionally supports both a public change-token
            # flow and an authenticated current-password flow.
            assert security_names == {"bearerAuth"}, key
        elif decorators & {"jwt_required", "jwt_admin_required"}:
            assert "bearerAuth" in security_names, key
        elif "auth_required" in decorators:
            assert security_names == {"bearerAuth", "cookieAuth"}, key
        else:
            assert not security_names, key

        parameters = operation.get("parameters", [])
        has_database = any(
            parameter.get("$ref") == "#/components/parameters/XDatabase"
            or parameter.get("name") == "X-Database"
            for parameter in parameters
        )
        assert has_database is runtime_operation["requires_database"], key

        capability = operation.get("x-capability")
        if capability:
            assert capability in capability_names, key

    references = []

    def collect_references(value):
        if isinstance(value, dict):
            reference = value.get("$ref")
            if isinstance(reference, str) and reference.startswith("#/"):
                references.append(reference)
            for child in value.values():
                collect_references(child)
        elif isinstance(value, list):
            for child in value:
                collect_references(child)

    collect_references(spec)
    for reference in references:
        assert _resolve_local_ref(spec, reference) is not None


def _bill_payload(**overrides):
    payload = {
        "name": "Idempotent utility",
        "amount": 120.0,
        "frequency": "monthly",
        "next_due": "2026-08-15",
        "type": "expense",
    }
    payload.update(overrides)
    return payload


def test_pre_auth_mobile_capability_envelope_is_consistent(client):
    config_response = client.get("/api/v2/config")
    version_response = client.get("/api/v2/version")

    assert config_response.status_code == 200
    assert version_response.status_code == 200

    config = config_response.get_json()["data"]
    version = version_response.get_json()["data"]
    mobile = config["mobile"]

    assert version["mobile"] == mobile
    assert mobile["mobile_contract_version"] == 1
    assert mobile["server_version"] == version["version"]
    assert mobile["deployment_mode"] == config["deployment_mode"]
    assert mobile["default_currency"] == config["default_currency"]
    assert mobile["default_locale"] == config["default_locale"]
    assert "minimum_mobile_version" in mobile
    assert mobile["features"]["idempotent_mutations"] is True
    assert mobile["features"]["optimistic_concurrency"] is True
    assert isinstance(mobile["oauth_providers"], list)


def test_public_config_exposes_supported_user_currencies(client):
    response = client.get("/api/v2/config")

    payload = response.get_json()["data"]
    assert payload["default_currency"] == "USD"
    assert payload["supported_currencies"] == list(config.SUPPORTED_CURRENCIES)
    assert payload["mobile"]["default_currency"] == "USD"


def test_openapi_default_currency_schemas_use_ordered_supported_enum():
    expected = [
        "USD",
        "EUR",
        "JPY",
        "GBP",
        "CNY",
        "CHF",
        "AUD",
        "CAD",
        "HKD",
        "SGD",
        "INR",
        "KRW",
        "SEK",
        "NZD",
        "MXN",
    ]
    spec = yaml.safe_load((SERVER_ROOT / "openapi.yaml").read_text(encoding="utf-8"))

    schemas = spec["components"]["schemas"]

    assert schemas["PublicConfig"]["properties"]["default_currency"]["enum"] == expected
    assert schemas["MobileCapabilities"]["properties"]["default_currency"]["enum"] == expected


def test_authenticated_password_change_requires_current_password(
    client, admin_auth_headers, admin_user, app, db_session
):
    wrong = client.post(
        "/api/v2/auth/change-password",
        headers=admin_auth_headers,
        json={"current_password": "wrong", "new_password": "NewPassword123!"},
    )
    assert wrong.status_code == 401

    changed = client.post(
        "/api/v2/auth/change-password",
        headers=admin_auth_headers,
        json={
            "current_password": "testpassword123",
            "new_password": "NewPassword123!",
        },
    )
    assert changed.status_code == 200
    assert changed.get_json()["success"] is True
    with app.app_context():
        assert db_session.get(User, admin_user.id).check_password("NewPassword123!")


def test_password_reauthentication_does_not_rotate_session(
    client, admin_auth_headers
):
    rejected = client.post(
        "/api/v2/auth/reauthenticate",
        headers=admin_auth_headers,
        json={"password": "wrong"},
    )
    verified = client.post(
        "/api/v2/auth/reauthenticate",
        headers=admin_auth_headers,
        json={"password": "testpassword123"},
    )

    assert rejected.status_code == 401
    assert verified.status_code == 200
    assert verified.get_json() == {
        "success": True,
        "data": {"reauthenticated": True},
    }


def test_bill_create_replays_same_client_mutation(
    client, auth_headers_with_db, app, db_session
):
    mutation_id = str(uuid.uuid4())
    payload = _bill_payload(client_mutation_id=mutation_id)

    first = client.post("/api/v2/bills", headers=auth_headers_with_db, json=payload)
    second = client.post("/api/v2/bills", headers=auth_headers_with_db, json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.headers["Idempotency-Replayed"] == "true"
    assert second.get_json() == first.get_json()

    with app.app_context():
        assert Bill.query.filter_by(name="Idempotent utility").count() == 1
        assert ClientMutation.query.filter_by(
            client_mutation_id=mutation_id
        ).count() == 1


def test_client_mutation_id_cannot_be_reused_for_different_payload(
    client, auth_headers_with_db
):
    mutation_id = str(uuid.uuid4())
    first = client.post(
        "/api/v2/bills",
        headers=auth_headers_with_db,
        json=_bill_payload(client_mutation_id=mutation_id),
    )
    second = client.post(
        "/api/v2/bills",
        headers=auth_headers_with_db,
        json=_bill_payload(name="A different bill", client_mutation_id=mutation_id),
    )

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.get_json()["code"] == "client_mutation_id_reused"


def test_bill_move_replays_in_original_database_scope_after_post_state_change(
    client,
    auth_headers_with_db,
    user_auth_headers,
    admin_user,
    regular_user,
    test_database,
    test_bill,
    db_session,
):
    destination = Database(
        name="move_destination",
        display_name="Move Destination",
        owner_id=admin_user.id if config.is_saas() else None,
    )
    db_session.add(destination)
    admin_user.accessible_databases.append(destination)
    regular_user.accessible_databases.extend([test_database, destination])
    db_session.commit()
    destination_id = destination.id
    source_database_id = test_bill.database_id
    base_updated_at = test_bill.last_updated.replace(
        tzinfo=datetime.timezone.utc
    ).isoformat().replace("+00:00", "Z")

    mutation_id = str(uuid.uuid4())
    payload = {
        "database_id": destination_id,
        "name": "Moved exactly once",
        "base_updated_at": base_updated_at,
        "client_mutation_id": mutation_id,
    }

    first = client.put(
        f"/api/v2/bills/{test_bill.id}",
        headers=auth_headers_with_db,
        json=payload,
    )
    replay = client.put(
        f"/api/v2/bills/{test_bill.id}",
        headers=auth_headers_with_db,
        json=payload,
    )

    assert first.status_code == 200
    assert replay.status_code == 200
    assert replay.headers["Idempotency-Replayed"] == "true"
    assert replay.get_json() == first.get_json()
    stored_bill = db_session.get(Bill, test_bill.id)
    record = ClientMutation.query.filter_by(client_mutation_id=mutation_id).one()
    assert stored_bill.database_id == destination_id
    assert stored_bill.name == "Moved exactly once"
    assert record.database_id == source_database_id

    changed_payload = {**payload, "name": "Changed retry body"}
    changed = client.put(
        f"/api/v2/bills/{test_bill.id}",
        headers=auth_headers_with_db,
        json=changed_payload,
    )
    wrong_operation = client.delete(
        f"/api/v2/bills/{test_bill.id}/permanent",
        headers=auth_headers_with_db,
        json=payload,
    )
    destination_headers = {
        **auth_headers_with_db,
        "X-Database": destination.name,
    }
    wrong_database = client.put(
        f"/api/v2/bills/{test_bill.id}",
        headers=destination_headers,
        json=payload,
    )
    wrong_user_headers = {
        **user_auth_headers,
        "X-Database": test_database.name,
    }
    wrong_user = client.put(
        f"/api/v2/bills/{test_bill.id}",
        headers=wrong_user_headers,
        json=payload,
    )

    assert changed.status_code == 409
    assert changed.get_json()["code"] == "client_mutation_id_reused"
    assert wrong_operation.status_code == 409
    assert wrong_operation.get_json()["code"] == "client_mutation_id_reused"
    assert wrong_database.status_code == 409
    assert wrong_database.headers.get("Idempotency-Replayed") is None
    assert wrong_database.get_json()["code"] == "resource_conflict"
    assert wrong_user.status_code == 403
    assert wrong_user.headers.get("Idempotency-Replayed") is None


def test_deleted_resources_only_replay_in_the_original_database_scope(
    client,
    auth_headers_with_db,
    admin_user,
    test_bill,
    db_session,
):
    other_database = Database(
        name="wrong_replay_scope",
        display_name="Wrong Replay Scope",
        owner_id=admin_user.id if config.is_saas() else None,
    )
    payment = Payment(
        bill_id=test_bill.id,
        amount=80.0,
        payment_date="2026-07-15",
    )
    db_session.add_all([other_database, payment])
    admin_user.accessible_databases.append(other_database)
    db_session.commit()
    payment_id = payment.id

    wrong_scope_headers = {
        **auth_headers_with_db,
        "X-Database": other_database.name,
    }
    payment_payload = {"client_mutation_id": str(uuid.uuid4())}
    payment_delete = client.delete(
        f"/api/v2/payments/{payment_id}",
        headers=auth_headers_with_db,
        json=payment_payload,
    )
    payment_wrong_scope = client.delete(
        f"/api/v2/payments/{payment_id}",
        headers=wrong_scope_headers,
        json=payment_payload,
    )
    payment_replay = client.delete(
        f"/api/v2/payments/{payment_id}",
        headers=auth_headers_with_db,
        json=payment_payload,
    )

    assert payment_delete.status_code == 200
    assert payment_wrong_scope.status_code == 404
    assert payment_wrong_scope.headers.get("Idempotency-Replayed") is None
    assert payment_replay.status_code == 200
    assert payment_replay.headers["Idempotency-Replayed"] == "true"

    bill_payload = {"client_mutation_id": str(uuid.uuid4())}
    bill_delete = client.delete(
        f"/api/v2/bills/{test_bill.id}/permanent",
        headers=auth_headers_with_db,
        json=bill_payload,
    )
    bill_wrong_scope = client.delete(
        f"/api/v2/bills/{test_bill.id}/permanent",
        headers=wrong_scope_headers,
        json=bill_payload,
    )
    bill_replay = client.delete(
        f"/api/v2/bills/{test_bill.id}/permanent",
        headers=auth_headers_with_db,
        json=bill_payload,
    )

    assert bill_delete.status_code == 200
    assert bill_wrong_scope.status_code == 404
    assert bill_wrong_scope.headers.get("Idempotency-Replayed") is None
    assert bill_replay.status_code == 200
    assert bill_replay.headers["Idempotency-Replayed"] == "true"


def test_concurrent_bill_move_retries_replay_after_waiting_for_the_row_lock(
    auth_headers_with_db,
    admin_user,
    test_bill,
    app,
    db_session,
    monkeypatch,
):
    destination = Database(
        name="concurrent_move_destination",
        display_name="Concurrent Move Destination",
        owner_id=admin_user.id if config.is_saas() else None,
    )
    db_session.add(destination)
    admin_user.accessible_databases.append(destination)
    db_session.commit()

    mutation_id = str(uuid.uuid4())
    payload = {
        "database_id": destination.id,
        "name": "Concurrent move",
        "base_updated_at": test_bill.last_updated.replace(
            tzinfo=datetime.timezone.utc
        ).isoformat().replace("+00:00", "Z"),
        "client_mutation_id": mutation_id,
    }
    operation = f"bills.update:{test_bill.id}"
    initial_replay_barrier = threading.Barrier(2)
    thread_state = threading.local()
    original_replay = server_app._replay_client_mutation_before_resource

    def synchronize_initial_miss(data, requested_operation):
        result = original_replay(data, requested_operation)
        if (
            requested_operation == operation
            and result is None
            and not getattr(thread_state, "passed_initial_replay", False)
        ):
            thread_state.passed_initial_replay = True
            initial_replay_barrier.wait(timeout=3)
        return result

    monkeypatch.setattr(
        server_app,
        "_replay_client_mutation_before_resource",
        synchronize_initial_miss,
    )

    def move_bill(_):
        with app.test_client() as thread_client:
            response = thread_client.put(
                f"/api/v2/bills/{test_bill.id}",
                headers=dict(auth_headers_with_db),
                json=payload,
            )
            return (
                response.status_code,
                response.headers.get("Idempotency-Replayed"),
                response.get_json(),
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(move_bill, range(2)))

    assert [result[0] for result in results] == [200, 200]
    assert sorted(result[1] or "original" for result in results) == [
        "original",
        "true",
    ]
    assert results[0][2] == results[1][2]
    db_session.expire_all()
    assert db_session.get(Bill, test_bill.id).database_id == destination.id
    assert ClientMutation.query.filter_by(
        client_mutation_id=mutation_id
    ).count() == 1


def test_concurrent_payment_delete_retries_replay_after_resource_disappears(
    auth_headers_with_db,
    test_bill,
    app,
    db_session,
    monkeypatch,
):
    payment = Payment(
        bill_id=test_bill.id,
        amount=80.0,
        payment_date="2026-07-15",
    )
    db_session.add(payment)
    db_session.commit()
    payment_id = payment.id
    operation = f"payments.delete:{payment_id}"
    payload = {"client_mutation_id": str(uuid.uuid4())}
    initial_replay_barrier = threading.Barrier(2)
    thread_state = threading.local()
    original_replay = server_app._replay_client_mutation_before_resource

    def synchronize_initial_miss(data, requested_operation):
        result = original_replay(data, requested_operation)
        if (
            requested_operation == operation
            and result is None
            and not getattr(thread_state, "passed_initial_replay", False)
        ):
            thread_state.passed_initial_replay = True
            initial_replay_barrier.wait(timeout=3)
        return result

    monkeypatch.setattr(
        server_app,
        "_replay_client_mutation_before_resource",
        synchronize_initial_miss,
    )

    def delete_payment(_):
        with app.test_client() as thread_client:
            response = thread_client.delete(
                f"/api/v2/payments/{payment_id}",
                headers=dict(auth_headers_with_db),
                json=payload,
            )
            return (
                response.status_code,
                response.headers.get("Idempotency-Replayed"),
                response.get_json(),
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(delete_payment, range(2)))

    assert [result[0] for result in results] == [200, 200]
    assert sorted(result[1] or "original" for result in results) == [
        "original",
        "true",
    ]
    assert results[0][2] == results[1][2]
    db_session.expire_all()
    assert db_session.get(Payment, payment_id) is None


def test_stale_bill_update_returns_stable_conflict(
    client, auth_headers_with_db, test_bill, app, db_session
):
    server_updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    with app.app_context():
        test_bill.last_updated = server_updated_at
        db_session.commit()

    response = client.put(
        f"/api/v2/bills/{test_bill.id}",
        headers=auth_headers_with_db,
        json={
            "name": "Stale client edit",
            "base_updated_at": (
                server_updated_at - datetime.timedelta(minutes=1)
            ).isoformat()
            + "Z",
            "client_mutation_id": str(uuid.uuid4()),
        },
    )

    assert response.status_code == 409
    body = response.get_json()
    assert body["success"] is False
    assert body["code"] == "resource_conflict"
    assert body["conflict"]["entity"] == "bill"
    assert body["conflict"]["entity_id"] == test_bill.id
    assert body["conflict"]["reason"] == "modified"
    assert body["conflict"]["server"]["name"] == "Test Bill"


def test_payment_record_replay_does_not_duplicate_or_advance_twice(
    client, auth_headers_with_db, test_bill, app, db_session
):
    mutation_id = str(uuid.uuid4())
    payload = {
        "amount": 100.0,
        "payment_date": "2026-07-15",
        "advance_due": True,
        "client_mutation_id": mutation_id,
    }

    first = client.post(
        f"/api/v2/bills/{test_bill.id}/pay",
        headers=auth_headers_with_db,
        json=payload,
    )
    second = client.post(
        f"/api/v2/bills/{test_bill.id}/pay",
        headers=auth_headers_with_db,
        json=payload,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.headers["Idempotency-Replayed"] == "true"
    assert second.get_json() == first.get_json()

    with app.app_context():
        bill = db_session.get(Bill, test_bill.id)
        assert Payment.query.filter_by(bill_id=test_bill.id).count() == 1
        assert bill.due_date == "2025-02-15"


def test_stale_payment_update_returns_payment_snapshot(
    client, auth_headers_with_db, test_bill, app, db_session
):
    payment = Payment(
        bill_id=test_bill.id,
        amount=100.0,
        payment_date="2026-07-15",
        notes="server value",
    )
    server_updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    payment.updated_at = server_updated_at
    with app.app_context():
        db_session.add(payment)
        db_session.commit()
        payment_id = payment.id

    response = client.put(
        f"/api/v2/payments/{payment_id}",
        headers=auth_headers_with_db,
        json={
            "notes": "stale local value",
            "base_updated_at": (
                server_updated_at - datetime.timedelta(seconds=1)
            ).isoformat()
            + "Z",
        },
    )

    assert response.status_code == 409
    conflict = response.get_json()["conflict"]
    assert conflict["entity"] == "payment"
    assert conflict["server"]["notes"] == "server value"


def test_payment_delete_replays_after_resource_is_gone(
    client, auth_headers_with_db, test_bill, app, db_session
):
    payment = Payment(
        bill_id=test_bill.id,
        amount=80.0,
        payment_date="2026-07-15",
    )
    with app.app_context():
        db_session.add(payment)
        db_session.commit()
        payment_id = payment.id

    payload = {"client_mutation_id": str(uuid.uuid4())}
    first = client.delete(
        f"/api/v2/payments/{payment_id}",
        headers=auth_headers_with_db,
        json=payload,
    )
    second = client.delete(
        f"/api/v2/payments/{payment_id}",
        headers=auth_headers_with_db,
        json=payload,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.headers["Idempotency-Replayed"] == "true"
    assert second.get_json() == first.get_json()
    with app.app_context():
        assert db_session.get(Payment, payment_id) is None


def test_shared_payment_delete_replays_in_all_scope_without_database_membership(
    client,
    user_auth_headers,
    admin_auth_headers,
    test_bill,
    admin_user,
    regular_user,
    db_session,
):
    share = BillShare(
        bill_id=test_bill.id,
        owner_user_id=admin_user.id,
        shared_with_user_id=regular_user.id,
        shared_with_identifier=regular_user.username,
        identifier_type="username",
        status="accepted",
        split_type="equal",
    )
    payment = Payment(
        bill_id=test_bill.id,
        share=share,
        amount=80.0,
        payment_date="2026-07-15",
    )
    db_session.add_all([share, payment])
    db_session.commit()
    payment_id = payment.id

    recipient_headers = {**user_auth_headers, "X-Database": "_all_"}
    wrong_user_headers = {**admin_auth_headers, "X-Database": "_all_"}
    payload = {"client_mutation_id": str(uuid.uuid4())}
    first = client.delete(
        f"/api/v2/payments/{payment_id}",
        headers=recipient_headers,
        json=payload,
    )
    replay = client.delete(
        f"/api/v2/payments/{payment_id}",
        headers=recipient_headers,
        json=payload,
    )
    wrong_user = client.delete(
        f"/api/v2/payments/{payment_id}",
        headers=wrong_user_headers,
        json=payload,
    )

    assert first.status_code == 200
    assert replay.status_code == 200
    assert replay.headers["Idempotency-Replayed"] == "true"
    assert replay.get_json() == first.get_json()
    assert wrong_user.status_code == 404
    assert wrong_user.headers.get("Idempotency-Replayed") is None


def test_share_create_replays_without_duplicate_or_duplicate_audit(
    client,
    auth_headers_with_db,
    test_bill,
    regular_user,
    app,
    db_session,
):
    payload = {
        "identifier": regular_user.username,
        "split_type": "equal",
        "client_mutation_id": str(uuid.uuid4()),
    }

    first = client.post(
        f"/api/v2/bills/{test_bill.id}/share",
        headers=auth_headers_with_db,
        json=payload,
    )
    second = client.post(
        f"/api/v2/bills/{test_bill.id}/share",
        headers=auth_headers_with_db,
        json=payload,
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.headers["Idempotency-Replayed"] == "true"
    assert second.get_json() == first.get_json()
    with app.app_context():
        assert BillShare.query.filter_by(bill_id=test_bill.id).count() == 1
        assert ShareAuditLog.query.filter_by(
            bill_id=test_bill.id, action="created"
        ).count() == 1


def test_share_info_returns_owner_and_recipient_contract(
    client,
    test_bill,
    admin_user,
    regular_user,
    app,
    db_session,
):
    share = BillShare(
        bill_id=test_bill.id,
        owner_user_id=admin_user.id,
        shared_with_user_id=regular_user.id,
        shared_with_identifier=regular_user.email,
        identifier_type="email",
        status="pending",
        split_type="equal",
        expires_at=datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(days=7),
    )
    invite_token = share.set_invite_token()
    with app.app_context():
        db_session.add(share)
        db_session.commit()

    response = client.get("/api/v2/share-info", query_string={"token": invite_token})

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["owner_username"] == admin_user.username
    assert data["shared_with_email"] == regular_user.email
    assert data["owner"] == data["owner_username"]
    assert data["bill_name"] == test_bill.name
    assert data["my_portion"] == test_bill.amount / 2
    assert data["updated_at"]


def test_share_mark_paid_replays_instead_of_toggling_back(
    client,
    user_auth_headers,
    test_bill,
    admin_user,
    regular_user,
    app,
    db_session,
):
    share = BillShare(
        bill_id=test_bill.id,
        owner_user_id=admin_user.id,
        shared_with_user_id=regular_user.id,
        shared_with_identifier=regular_user.username,
        identifier_type="username",
        status="accepted",
        split_type="equal",
    )
    with app.app_context():
        db_session.add(share)
        db_session.commit()
        share_id = share.id

    payload = {"client_mutation_id": str(uuid.uuid4())}
    first = client.post(
        f"/api/v2/shares/{share_id}/mark-paid", headers=user_auth_headers, json=payload
    )
    second = client.post(
        f"/api/v2/shares/{share_id}/mark-paid", headers=user_auth_headers, json=payload
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.headers["Idempotency-Replayed"] == "true"
    assert second.get_json() == first.get_json()
    with app.app_context():
        stored_share = db_session.get(BillShare, share_id)
        assert stored_share.recipient_paid_date is not None
        assert Payment.query.filter_by(share_id=share_id).count() == 1


def test_stale_share_update_returns_share_snapshot(
    client,
    auth_headers_with_db,
    test_bill,
    admin_user,
    regular_user,
    app,
    db_session,
):
    server_updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    share = BillShare(
        bill_id=test_bill.id,
        owner_user_id=admin_user.id,
        shared_with_user_id=regular_user.id,
        shared_with_identifier=regular_user.username,
        identifier_type="username",
        status="accepted",
        split_type="equal",
        updated_at=server_updated_at,
    )
    with app.app_context():
        db_session.add(share)
        db_session.commit()
        share_id = share.id

    response = client.put(
        f"/api/v2/shares/{share_id}",
        headers=auth_headers_with_db,
        json={
            "split_type": "percentage",
            "split_value": 40,
            "base_updated_at": (
                server_updated_at - datetime.timedelta(seconds=1)
            ).isoformat()
            + "Z",
        },
    )

    assert response.status_code == 409
    conflict = response.get_json()["conflict"]
    assert conflict["entity"] == "share"
    assert conflict["server"]["split_type"] == "equal"


def test_sync_push_replays_complete_batch(client, auth_headers_with_db, app):
    payload = {
        "client_mutation_id": str(uuid.uuid4()),
        "bills": [
            {
                "client_ref": "local-bill-1",
                "name": "Offline-created bill",
                "amount": 35.0,
                "frequency": "monthly",
                "next_due": "2026-08-01",
            }
        ],
    }

    first = client.post("/api/v2/sync/push", headers=auth_headers_with_db, json=payload)
    second = client.post("/api/v2/sync/push", headers=auth_headers_with_db, json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.headers["Idempotency-Replayed"] == "true"
    assert second.get_json() == first.get_json()
    with app.app_context():
        assert Bill.query.filter_by(name="Offline-created bill").count() == 1


def test_sync_push_rejects_fractional_zero_minor_unit_bill_and_payment_mutations(
    client,
    auth_headers_with_db,
    test_bill,
    db_session,
    admin_user,
):
    payment = Payment(
        bill_id=test_bill.id,
        amount=100,
        payment_date="2026-08-01",
    )
    db_session.add(payment)
    db_session.commit()
    bill_base = test_bill.last_updated.replace(
        tzinfo=datetime.timezone.utc
    ).isoformat().replace("+00:00", "Z")
    payment_base = payment.updated_at.replace(
        tzinfo=datetime.timezone.utc
    ).isoformat().replace("+00:00", "Z")
    admin_user.currency = "JPY"
    db_session.commit()

    response = client.post(
        "/api/v2/sync/push",
        headers=auth_headers_with_db,
        json={
            "bills": [
                {
                    "id": test_bill.id,
                    "amount": 100.5,
                    "base_updated_at": bill_base,
                },
                {
                    "name": "Offline fractional yen bill",
                    "amount": 100.5,
                    "next_due": "2026-08-15",
                },
            ],
            "payments": [
                {
                    "id": payment.id,
                    "amount": 100.5,
                    "base_updated_at": payment_base,
                },
                {
                    "bill_id": test_bill.id,
                    "amount": 100.5,
                    "payment_date": "2026-08-15",
                },
            ],
        },
    )

    data = response.get_json()["data"]
    assert data["accepted_bills"] == []
    assert data["accepted_payments"] == []
    assert [item["reason"] for item in data["rejected_bills"]] == [
        "invalid_amount",
        "invalid_amount",
    ]
    assert [item["reason"] for item in data["rejected_payments"]] == [
        "invalid_amount",
        "invalid_amount",
    ]


def test_sync_push_accepts_base_updated_at_alias(
    client, auth_headers_with_db, test_bill, app, db_session
):
    server_updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    with app.app_context():
        test_bill.last_updated = server_updated_at
        db_session.commit()

    response = client.post(
        "/api/v2/sync/push",
        headers=auth_headers_with_db,
        json={
            "bills": [
                {
                    "id": test_bill.id,
                    "name": "stale sync edit",
                    "base_updated_at": (
                        server_updated_at - datetime.timedelta(seconds=1)
                    ).isoformat()
                    + "Z",
                }
            ]
        },
    )

    assert response.status_code == 200
    rejected = response.get_json()["data"]["rejected_bills"]
    assert rejected[0]["code"] == "resource_conflict"
    with app.app_context():
        assert db_session.get(Bill, test_bill.id).name == "Test Bill"


def test_sync_push_normalizes_aware_payment_timestamp_against_naive_database_value(
    client, auth_headers_with_db, test_bill, app, db_session
):
    server_updated_at = datetime.datetime(2026, 7, 15, 12, 0, 0)
    payment = Payment(
        bill_id=test_bill.id,
        amount=45.0,
        payment_date="2026-07-15",
        notes="before sync",
        updated_at=server_updated_at,
    )
    with app.app_context():
        db_session.add(payment)
        db_session.commit()
        payment_id = payment.id

    response = client.post(
        "/api/v2/sync/push",
        headers=auth_headers_with_db,
        json={
            "payments": [
                {
                    "id": payment_id,
                    "notes": "updated from mobile",
                    "base_updated_at": "2026-07-15T12:00:00Z",
                }
            ]
        },
    )

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["accepted_payments"] == [{"id": payment_id, "action": "updated"}]
    assert data["rejected_payments"] == []
    with app.app_context():
        assert db_session.get(Payment, payment_id).notes == "updated from mobile"


def test_sync_push_normalizes_rfc3339_offset_before_bill_conflict_comparison(
    client, auth_headers_with_db, test_bill, app, db_session
):
    server_updated_at = datetime.datetime(2026, 7, 15, 12, 0, 0)
    test_bill.last_updated = server_updated_at
    db_session.commit()

    response = client.post(
        "/api/v2/sync/push",
        headers=auth_headers_with_db,
        json={
            "bills": [
                {
                    "id": test_bill.id,
                    "name": "offset timestamp must lose",
                    # 13:00 at +02:00 is 11:00 UTC, one hour behind the server.
                    "base_updated_at": "2026-07-15T13:00:00+02:00",
                }
            ]
        },
    )

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["accepted_bills"] == []
    assert data["rejected_bills"][0]["code"] == "resource_conflict"
    assert data["rejected_bills"][0]["server_data"]["last_updated"].endswith("Z")
    with app.app_context():
        assert db_session.get(Bill, test_bill.id).name == "Test Bill"


def test_sync_push_serializes_distinct_mutations_with_the_same_bill_base(
    auth_headers_with_db,
    test_bill,
    app,
    db_session,
    monkeypatch,
):
    server_updated_at = datetime.datetime(2026, 1, 1, 12, 0, 0)
    test_bill.last_updated = server_updated_at
    db_session.commit()
    bill_id = test_bill.id

    comparison_barrier = threading.Barrier(2)
    original_comparison = server_app._sync_timestamp_conflicts

    def synchronized_comparison(client_time, current_server_time):
        # Without a row lock, both requests reach this point using the same old
        # snapshot and both writes are accepted. With the lock, the first request
        # times out here and commits before the second request performs its check.
        try:
            comparison_barrier.wait(timeout=1)
        except threading.BrokenBarrierError:
            pass
        return original_comparison(client_time, current_server_time)

    monkeypatch.setattr(
        server_app, "_sync_timestamp_conflicts", synchronized_comparison
    )

    def push(name):
        with app.test_client() as thread_client:
            response = thread_client.post(
                "/api/v2/sync/push",
                headers=dict(auth_headers_with_db),
                json={
                    "client_mutation_id": str(uuid.uuid4()),
                    "bills": [
                        {
                            "id": bill_id,
                            "name": name,
                            "base_updated_at": "2026-01-01T12:00:00Z",
                        }
                    ],
                },
            )
            assert response.status_code == 200
            return response.get_json()["data"]

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(push, ["first edit", "second edit"]))

    assert sum(len(result["accepted_bills"]) for result in results) == 1
    conflicts = [
        rejection
        for result in results
        for rejection in result["rejected_bills"]
        if rejection.get("code") == "resource_conflict"
    ]
    assert len(conflicts) == 1
    with app.app_context():
        db_session.expire_all()
        stored_name = db_session.get(Bill, bill_id).name
        assert stored_name in {"first edit", "second edit"}
        assert conflicts[0]["server_data"]["name"] == stored_name


def test_sync_push_serializes_distinct_mutations_with_the_same_payment_base(
    auth_headers_with_db,
    test_bill,
    app,
    db_session,
    monkeypatch,
):
    server_updated_at = datetime.datetime(2026, 1, 1, 12, 0, 0)
    payment = Payment(
        bill_id=test_bill.id,
        amount=45.0,
        payment_date="2026-01-01",
        notes="original",
        updated_at=server_updated_at,
    )
    db_session.add(payment)
    db_session.commit()
    payment_id = payment.id

    comparison_barrier = threading.Barrier(2)
    original_comparison = server_app._sync_timestamp_conflicts

    def synchronized_comparison(client_time, current_server_time):
        try:
            comparison_barrier.wait(timeout=1)
        except threading.BrokenBarrierError:
            pass
        return original_comparison(client_time, current_server_time)

    monkeypatch.setattr(
        server_app, "_sync_timestamp_conflicts", synchronized_comparison
    )

    def push(notes):
        with app.test_client() as thread_client:
            response = thread_client.post(
                "/api/v2/sync/push",
                headers=dict(auth_headers_with_db),
                json={
                    "client_mutation_id": str(uuid.uuid4()),
                    "payments": [
                        {
                            "id": payment_id,
                            "notes": notes,
                            "base_updated_at": "2026-01-01T12:00:00Z",
                        }
                    ],
                },
            )
            assert response.status_code == 200
            return response.get_json()["data"]

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(push, ["first edit", "second edit"]))

    assert sum(len(result["accepted_payments"]) for result in results) == 1
    conflicts = [
        rejection
        for result in results
        for rejection in result["rejected_payments"]
        if rejection.get("code") == "resource_conflict"
    ]
    assert len(conflicts) == 1
    with app.app_context():
        db_session.expire_all()
        stored_notes = db_session.get(Payment, payment_id).notes
        assert stored_notes in {
            "first edit",
            "second edit",
        }
        assert conflicts[0]["server_data"]["notes"] == stored_notes


def test_sync_push_rejects_future_version_tokens_for_updates_and_deletions(
    client, auth_headers_with_db, test_bill, app, db_session
):
    server_updated_at = datetime.datetime(2026, 1, 1, 12, 0, 0)
    test_bill.last_updated = server_updated_at
    payment = Payment(
        bill_id=test_bill.id,
        amount=45.0,
        payment_date="2026-01-01",
        notes="server payment",
        updated_at=server_updated_at,
    )
    db_session.add(payment)
    db_session.commit()
    payment_id = payment.id
    future_base = "2099-01-01T00:00:00Z"

    update_response = client.post(
        "/api/v2/sync/push",
        headers=auth_headers_with_db,
        json={
            "bills": [
                {
                    "id": test_bill.id,
                    "name": "future bill update",
                    "base_updated_at": future_base,
                }
            ],
            "payments": [
                {
                    "id": payment_id,
                    "notes": "future payment update",
                    "base_updated_at": future_base,
                }
            ],
        },
    )
    delete_response = client.post(
        "/api/v2/sync/push",
        headers=auth_headers_with_db,
        json={
            "deleted_bills": [
                {"id": test_bill.id, "base_updated_at": future_base}
            ],
            "deleted_payments": [
                {"id": payment_id, "base_updated_at": future_base}
            ],
        },
    )

    assert update_response.status_code == 200
    assert delete_response.status_code == 200
    update_data = update_response.get_json()["data"]
    delete_data = delete_response.get_json()["data"]
    assert update_data["accepted_bills"] == []
    assert update_data["accepted_payments"] == []
    assert update_data["rejected_bills"][0]["code"] == "resource_conflict"
    assert update_data["rejected_payments"][0]["code"] == "resource_conflict"
    assert delete_data["accepted_bills"] == []
    assert delete_data["accepted_payments"] == []
    assert delete_data["rejected_bills"][0]["code"] == "resource_conflict"
    assert delete_data["rejected_payments"][0]["code"] == "resource_conflict"
    with app.app_context():
        db_session.expire_all()
        assert db_session.get(Bill, test_bill.id).name == "Test Bill"
        assert db_session.get(Bill, test_bill.id).archived is False
        assert db_session.get(Payment, payment_id).notes == "server payment"


def test_sync_push_rejects_concurrent_future_version_updates_and_deletions(
    auth_headers_with_db, test_bill, app, db_session
):
    server_updated_at = datetime.datetime(2026, 1, 1, 12, 0, 0)
    test_bill.last_updated = server_updated_at
    payment = Payment(
        bill_id=test_bill.id,
        amount=45.0,
        payment_date="2026-01-01",
        notes="server payment",
        updated_at=server_updated_at,
    )
    db_session.add(payment)
    db_session.commit()
    bill_id = test_bill.id
    payment_id = payment.id
    future_base = "2099-01-01T00:00:00Z"

    def push(mode):
        if mode == "update":
            payload = {
                "bills": [
                    {
                        "id": bill_id,
                        "name": "future concurrent bill",
                        "base_updated_at": future_base,
                    }
                ],
                "payments": [
                    {
                        "id": payment_id,
                        "notes": "future concurrent payment",
                        "base_updated_at": future_base,
                    }
                ],
            }
        else:
            payload = {
                "deleted_bills": [
                    {"id": bill_id, "base_updated_at": future_base}
                ],
                "deleted_payments": [
                    {"id": payment_id, "base_updated_at": future_base}
                ],
            }
        with app.test_client() as thread_client:
            response = thread_client.post(
                "/api/v2/sync/push",
                headers=dict(auth_headers_with_db),
                json=payload,
            )
            assert response.status_code == 200
            return response.get_json()["data"]

    with ThreadPoolExecutor(max_workers=2) as executor:
        update_results = list(executor.map(push, ["update", "update"]))
    with ThreadPoolExecutor(max_workers=2) as executor:
        delete_results = list(executor.map(push, ["delete", "delete"]))

    for result in update_results + delete_results:
        assert result["accepted_bills"] == []
        assert result["accepted_payments"] == []
        assert result["rejected_bills"][0]["code"] == "resource_conflict"
        assert result["rejected_payments"][0]["code"] == "resource_conflict"
    with app.app_context():
        db_session.expire_all()
        assert db_session.get(Bill, bill_id).name == "Test Bill"
        assert db_session.get(Bill, bill_id).archived is False
        assert db_session.get(Payment, payment_id).notes == "server payment"


def test_individual_mutations_reject_future_version_tokens(
    client, auth_headers_with_db, test_bill, app, db_session
):
    server_updated_at = datetime.datetime(2026, 1, 1, 12, 0, 0)
    test_bill.last_updated = server_updated_at
    payment = Payment(
        bill_id=test_bill.id,
        amount=45.0,
        payment_date="2026-01-01",
        notes="server payment",
        updated_at=server_updated_at,
    )
    db_session.add(payment)
    db_session.commit()
    payment_id = payment.id
    future_payload = {"base_updated_at": "2099-01-01T00:00:00Z"}

    bill_update = client.put(
        f"/api/v2/bills/{test_bill.id}",
        headers=auth_headers_with_db,
        json={**future_payload, "name": "future bill update"},
    )
    payment_update = client.put(
        f"/api/v2/payments/{payment_id}",
        headers=auth_headers_with_db,
        json={**future_payload, "notes": "future payment update"},
    )
    bill_delete = client.delete(
        f"/api/v2/bills/{test_bill.id}",
        headers=auth_headers_with_db,
        json=future_payload,
    )
    payment_delete = client.delete(
        f"/api/v2/payments/{payment_id}",
        headers=auth_headers_with_db,
        json=future_payload,
    )

    assert [
        bill_update.status_code,
        payment_update.status_code,
        bill_delete.status_code,
        payment_delete.status_code,
    ] == [409, 409, 409, 409]
    with app.app_context():
        db_session.expire_all()
        assert db_session.get(Bill, test_bill.id).name == "Test Bill"
        assert db_session.get(Bill, test_bill.id).archived is False
        assert db_session.get(Payment, payment_id).notes == "server payment"


def test_individual_mutations_reject_explicit_invalid_version_tokens(
    client, auth_headers_with_db, test_bill, db_session
):
    payment = Payment(
        bill_id=test_bill.id,
        amount=45.0,
        payment_date="2026-01-01",
        notes="server payment",
    )
    db_session.add(payment)
    db_session.commit()
    payment_id = payment.id

    invalid_values = [
        None,
        "",
        "not-a-timestamp",
        123,
        "2026-07-15",
        "2026-07-15T12:00:00",
    ]
    for index, invalid_value in enumerate(invalid_values):
        bill_update = client.put(
            f"/api/v2/bills/{test_bill.id}",
            headers=auth_headers_with_db,
            json={
                "name": f"invalid bill update {index}",
                "base_updated_at": invalid_value,
            },
        )
        payment_update = client.put(
            f"/api/v2/payments/{payment_id}",
            headers=auth_headers_with_db,
            json={
                "notes": f"invalid payment update {index}",
                "base_updated_at": invalid_value,
            },
        )
        bill_archive = client.delete(
            f"/api/v2/bills/{test_bill.id}",
            headers=auth_headers_with_db,
            json={"base_updated_at": invalid_value},
        )
        payment_delete = client.delete(
            f"/api/v2/payments/{payment_id}",
            headers=auth_headers_with_db,
            json={"base_updated_at": invalid_value},
        )

        for response in [
            bill_update,
            payment_update,
            bill_archive,
            payment_delete,
        ]:
            assert response.status_code == 400
            assert response.get_json()["code"] == "invalid_base_updated_at"

    db_session.expire_all()
    assert db_session.get(Bill, test_bill.id).name == "Test Bill"
    assert db_session.get(Bill, test_bill.id).archived is False
    assert db_session.get(Payment, payment_id).notes == "server payment"


def test_individual_mutations_normalize_equivalent_rfc3339_offsets(
    client, auth_headers_with_db, test_bill, db_session
):
    server_updated_at = datetime.datetime(2026, 7, 15, 12, 0, 0)
    test_bill.last_updated = server_updated_at
    payment = Payment(
        bill_id=test_bill.id,
        amount=45.0,
        payment_date="2026-01-01",
        notes="server payment",
        updated_at=server_updated_at,
    )
    db_session.add(payment)
    db_session.commit()

    equivalent_offset = "2026-07-15T14:00:00+02:00"
    bill_update = client.put(
        f"/api/v2/bills/{test_bill.id}",
        headers=auth_headers_with_db,
        json={"name": "offset bill update", "base_updated_at": equivalent_offset},
    )
    payment_update = client.put(
        f"/api/v2/payments/{payment.id}",
        headers=auth_headers_with_db,
        json={"notes": "offset payment update", "base_updated_at": equivalent_offset},
    )

    assert bill_update.status_code == 200
    assert payment_update.status_code == 200
    db_session.expire_all()
    assert db_session.get(Bill, test_bill.id).name == "offset bill update"
    assert db_session.get(Payment, payment.id).notes == "offset payment update"


def test_sync_push_rejects_invalid_update_ids_and_created_payment_bill_ids(
    client, auth_headers_with_db, test_bill, app, db_session
):
    base_updated_at = test_bill.last_updated.replace(
        tzinfo=datetime.timezone.utc
    ).isoformat().replace("+00:00", "Z")
    invalid_update_ids = [0, False, str(test_bill.id), float(test_bill.id)]
    invalid_bill_ids = [0, False, str(test_bill.id), float(test_bill.id), 999999]

    response = client.post(
        "/api/v2/sync/push",
        headers=auth_headers_with_db,
        json={
            "bills": [
                {
                    "id": invalid_id,
                    "name": f"invalid bill id {index}",
                    "next_due": "2026-08-01",
                    "base_updated_at": base_updated_at,
                }
                for index, invalid_id in enumerate(invalid_update_ids)
            ],
            "payments": [
                *[
                    {
                        "id": invalid_id,
                        "bill_id": test_bill.id,
                        "amount": 45.0,
                        "payment_date": "2026-08-01",
                        "base_updated_at": base_updated_at,
                    }
                    for invalid_id in invalid_update_ids
                ],
                *[
                    {
                        "bill_id": invalid_bill_id,
                        "amount": 45.0,
                        "payment_date": "2026-08-01",
                    }
                    for invalid_bill_id in invalid_bill_ids
                ],
            ],
        },
    )

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["accepted_bills"] == []
    assert data["accepted_payments"] == []
    assert [item["reason"] for item in data["rejected_bills"]] == [
        "invalid_id"
    ] * len(invalid_update_ids)
    assert [item["reason"] for item in data["rejected_payments"]] == [
        *(["invalid_id"] * len(invalid_update_ids)),
        *(["invalid_bill_id"] * len(invalid_bill_ids)),
    ]
    with app.app_context():
        assert Bill.query.filter(Bill.name.like("invalid bill id %")).count() == 0
        assert Payment.query.filter_by(bill_id=test_bill.id).count() == 0


def test_sync_push_rejects_invalid_container_and_entry_types_without_500(
    client, auth_headers_with_db
):
    for invalid_body in [[{}], "not-an-object", 123]:
        response = client.post(
            "/api/v2/sync/push",
            headers=auth_headers_with_db,
            json=invalid_body,
        )
        assert response.status_code == 400

    for collection_name in [
        "bills",
        "payments",
        "deleted_bills",
        "deleted_payments",
    ]:
        response = client.post(
            "/api/v2/sync/push",
            headers=auth_headers_with_db,
            json={collection_name: {"not": "an array"}},
        )
        assert response.status_code == 400
        assert response.get_json()["code"] == "invalid_sync_payload"

    response = client.post(
        "/api/v2/sync/push",
        headers=auth_headers_with_db,
        json={
            "bills": [None, "invalid", 123, []],
            "payments": [None, "invalid", 123, []],
        },
    )
    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["accepted_bills"] == []
    assert data["accepted_payments"] == []
    assert data["rejected_bills"] == [
        {"id": None, "reason": "invalid_entry"}
    ] * 4
    assert data["rejected_payments"] == [
        {"id": None, "reason": "invalid_entry"}
    ] * 4


def test_sync_push_rejects_duplicate_entity_references_within_one_batch(
    client, auth_headers_with_db, test_bill, app, db_session
):
    server_updated_at = datetime.datetime(2026, 1, 1, 12, 0, 0)
    test_bill.last_updated = server_updated_at
    payment = Payment(
        bill_id=test_bill.id,
        amount=45.0,
        payment_date="2026-01-01",
        notes="server payment",
        updated_at=server_updated_at,
    )
    db_session.add(payment)
    db_session.commit()
    payment_id = payment.id
    base_updated_at = "2026-01-01T12:00:00Z"

    bill_updates = [
        {
            "id": test_bill.id,
            "name": name,
            "base_updated_at": base_updated_at,
        }
        for name in ["first duplicate", "second duplicate"]
    ]
    payment_updates = [
        {
            "id": payment_id,
            "notes": notes,
            "base_updated_at": base_updated_at,
        }
        for notes in ["first duplicate", "second duplicate"]
    ]
    bill_deletion = {"id": test_bill.id, "base_updated_at": base_updated_at}
    payment_deletion = {"id": payment_id, "base_updated_at": base_updated_at}
    payloads = [
        {"bills": bill_updates, "payments": payment_updates},
        {
            "deleted_bills": [bill_deletion, dict(bill_deletion)],
            "deleted_payments": [payment_deletion, dict(payment_deletion)],
        },
        {
            "bills": [bill_updates[0]],
            "payments": [payment_updates[0]],
            "deleted_bills": [bill_deletion],
            "deleted_payments": [payment_deletion],
        },
    ]

    for payload in payloads:
        response = client.post(
            "/api/v2/sync/push", headers=auth_headers_with_db, json=payload
        )
        assert response.status_code == 200
        data = response.get_json()["data"]
        assert data["accepted_bills"] == []
        assert data["accepted_payments"] == []
        assert [item["reason"] for item in data["rejected_bills"]] == [
            "duplicate_entity_mutation",
            "duplicate_entity_mutation",
        ]
        assert [item["reason"] for item in data["rejected_payments"]] == [
            "duplicate_entity_mutation",
            "duplicate_entity_mutation",
        ]

    with app.app_context():
        db_session.expire_all()
        assert db_session.get(Bill, test_bill.id).name == "Test Bill"
        assert db_session.get(Bill, test_bill.id).archived is False
        assert db_session.get(Payment, payment_id).notes == "server payment"


def test_sync_push_rejects_missing_and_malformed_update_timestamps(
    client, auth_headers_with_db, test_bill, app, db_session
):
    payment = Payment(
        bill_id=test_bill.id,
        amount=45.0,
        payment_date="2026-07-15",
        notes="server payment",
    )
    db_session.add(payment)
    db_session.commit()
    payment_id = payment.id

    invalid_timestamps = [None, "", "not-a-timestamp", 123, "2026-07-15"]
    bill_reasons = []
    payment_reasons = []
    for index, timestamp in enumerate(invalid_timestamps):
        timestamp_payload = (
            {"base_updated_at": timestamp} if timestamp is not None else {}
        )
        response = client.post(
            "/api/v2/sync/push",
            headers=auth_headers_with_db,
            json={
                "bills": [
                    {
                        "id": test_bill.id,
                        "name": f"invalid bill update {index}",
                        **timestamp_payload,
                    }
                ],
                "payments": [
                    {
                        "id": payment_id,
                        "notes": f"invalid payment update {index}",
                        **timestamp_payload,
                    }
                ],
            },
        )
        assert response.status_code == 200
        data = response.get_json()["data"]
        assert data["accepted_bills"] == []
        assert data["accepted_payments"] == []
        bill_reasons.append(data["rejected_bills"][0]["reason"])
        payment_reasons.append(data["rejected_payments"][0]["reason"])

    expected_reasons = [
        "missing_base_updated_at",
        "missing_base_updated_at",
        "invalid_base_updated_at",
        "invalid_base_updated_at",
        "invalid_base_updated_at",
    ]
    assert bill_reasons == expected_reasons
    assert payment_reasons == expected_reasons
    with app.app_context():
        db_session.expire_all()
        assert db_session.get(Bill, test_bill.id).name == "Test Bill"
        assert db_session.get(Payment, payment_id).notes == "server payment"


def test_sync_push_rejects_unversioned_and_malformed_deletions(
    client, auth_headers_with_db, test_bill, app, db_session
):
    payment = Payment(
        bill_id=test_bill.id,
        amount=45.0,
        payment_date="2026-07-15",
    )
    db_session.add(payment)
    db_session.commit()
    payment_id = payment.id

    def deletion_cases(entity_id):
        return [
            entity_id,
            {"id": entity_id},
            {"id": entity_id, "base_updated_at": ""},
            {"id": entity_id, "base_updated_at": "not-a-timestamp"},
            {"id": entity_id, "base_updated_at": 123},
            {"id": entity_id, "base_updated_at": "2026-07-15"},
            {"base_updated_at": "2026-07-15T12:00:00Z"},
            {"id": "not-an-id", "base_updated_at": "2026-07-15T12:00:00Z"},
        ]

    bill_reasons = []
    payment_reasons = []
    for bill_case, payment_case in zip(
        deletion_cases(test_bill.id), deletion_cases(payment_id)
    ):
        response = client.post(
            "/api/v2/sync/push",
            headers=auth_headers_with_db,
            json={
                "deleted_bills": [bill_case],
                "deleted_payments": [payment_case],
            },
        )
        assert response.status_code == 200
        data = response.get_json()["data"]
        assert data["accepted_bills"] == []
        assert data["accepted_payments"] == []
        bill_reasons.append(data["rejected_bills"][0]["reason"])
        payment_reasons.append(data["rejected_payments"][0]["reason"])

    expected_reasons = [
        "missing_base_updated_at",
        "missing_base_updated_at",
        "missing_base_updated_at",
        "invalid_base_updated_at",
        "invalid_base_updated_at",
        "invalid_base_updated_at",
        "invalid_id",
        "invalid_id",
    ]
    assert bill_reasons == expected_reasons
    assert payment_reasons == expected_reasons
    with app.app_context():
        db_session.expire_all()
        assert db_session.get(Bill, test_bill.id).archived is False
        assert db_session.get(Payment, payment_id) is not None


def test_sync_push_rejects_stale_structured_deletions(
    client, auth_headers_with_db, test_bill, app, db_session
):
    server_updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    payment = Payment(
        bill_id=test_bill.id,
        amount=45.0,
        payment_date="2026-07-15",
        updated_at=server_updated_at,
    )
    with app.app_context():
        test_bill.last_updated = server_updated_at
        db_session.add(payment)
        db_session.commit()
        payment_id = payment.id

    stale_timestamp = (
        server_updated_at - datetime.timedelta(seconds=1)
    ).isoformat() + "Z"
    response = client.post(
        "/api/v2/sync/push",
        headers=auth_headers_with_db,
        json={
            "deleted_bills": [
                {"id": test_bill.id, "base_updated_at": stale_timestamp}
            ],
            "deleted_payments": [
                {"id": payment_id, "base_updated_at": stale_timestamp}
            ],
        },
    )

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["rejected_bills"][0]["code"] == "resource_conflict"
    assert data["rejected_payments"][0]["code"] == "resource_conflict"
    with app.app_context():
        assert db_session.get(Bill, test_bill.id).archived is False
        assert db_session.get(Payment, payment_id) is not None


def test_invalid_client_mutation_id_is_rejected(client, auth_headers_with_db):
    for invalid_value in ["not-a-uuid", "", None, 123]:
        response = client.post(
            "/api/v2/bills",
            headers=auth_headers_with_db,
            json=_bill_payload(client_mutation_id=invalid_value),
        )

        assert response.status_code == 400
        assert response.get_json()["code"] == "invalid_client_mutation_id"


def test_sync_cursors_are_valid_rfc3339_timestamps(
    client, auth_headers_with_db, test_database
):
    response = client.get("/api/v2/sync/full", headers=auth_headers_with_db)

    assert response.status_code == 200
    server_time = response.get_json()["data"]["server_time"]
    assert server_time.endswith("Z")
    parsed = datetime.datetime.fromisoformat(server_time.replace("Z", "+00:00"))
    assert parsed.tzinfo is not None


def test_upcoming_alerts_reject_non_numeric_horizon(
    client, auth_headers_with_db, test_bill
):
    response = client.get(
        "/api/v2/alerts/upcoming?horizon_days=tomorrow",
        headers=auth_headers_with_db,
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "horizon_days must be a number"


def test_v2_team_invitation_endpoints_preserve_public_flow(
    client,
    admin_user,
    test_database,
    app,
    db_session,
):
    invite = UserInvite(
        email="mobile-invite@example.com",
        role="user",
        invited_by_id=admin_user.id,
        expires_at=datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(days=1),
    )
    token = invite.set_token()
    invite.database_ids = str(test_database.id)
    with app.app_context():
        db_session.add(invite)
        db_session.commit()

    mobile_info = client.get(
        "/api/v2/invitations/info", query_string={"token": token}
    )

    assert mobile_info.status_code == 200
    assert mobile_info.get_json()["success"] is True
    assert mobile_info.get_json()["data"]["email"] == "mobile-invite@example.com"
    assert mobile_info.get_json()["data"]["invited_by"] == admin_user.username

    accepted = client.post(
        "/api/v2/invitations/accept",
        json={
            "token": token,
            "username": "mobileinvitee",
            "password": "mobile-password-123",
        },
    )

    assert accepted.status_code == 201
    assert accepted.get_json()["success"] is True
    assert accepted.get_json()["data"]["username"] == "mobileinvitee"
    with app.app_context():
        created = User.query.filter_by(username="mobileinvitee").one()
        assert created.email == "mobile-invite@example.com"
        assert test_database.id in {database.id for database in created.accessible_databases}
