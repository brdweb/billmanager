"""End-to-end contract tests for telemetry collection and ingestion."""

import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

from flask import Flask
import pytest

import config
from models import db, TelemetryLog, TelemetrySettings, TelemetrySubmission, User
from services.scheduler import TaskScheduler
from services.telemetry import TelemetryCollector
from services import telemetry_receiver


SAAS_ONLY = pytest.mark.skipif(
    not config.is_saas(), reason='requires a SaaS-mode application process'
)
SELF_HOSTED_ONLY = pytest.mark.skipif(
    config.is_saas(), reason='requires a self-hosted-mode application process'
)


def _response_status(result):
    if isinstance(result, tuple):
        return result[0], result[1]
    return result, result.status_code


def test_disabled_sender_does_not_collect_or_use_network(monkeypatch):
    collector = TelemetryCollector()
    collector.telemetry_enabled = False
    collector.telemetry_url = "https://telemetry.invalid/api"
    monkeypatch.setattr(
        collector,
        "collect_metrics",
        Mock(side_effect=AssertionError("disabled telemetry must not collect metrics")),
    )
    monkeypatch.setattr(
        telemetry_receiver.requests,
        "post",
        Mock(side_effect=AssertionError("disabled telemetry must not use the network")),
    )

    assert collector.send_telemetry() is False


def test_sender_posts_payload_and_logs_result(monkeypatch):
    collector = TelemetryCollector()
    collector.telemetry_enabled = True
    collector.telemetry_url = "https://telemetry.invalid/api"
    collector.instance_id = str(uuid.uuid4())
    metrics = {"instance_id": collector.instance_id, "version": "4.3.2"}
    response = Mock(status_code=200, text="ok")
    post = Mock(return_value=response)
    log_submission = Mock()

    monkeypatch.setattr(collector, "_is_opted_out", Mock(return_value=False))
    monkeypatch.setattr("services.telemetry.requests.post", post)
    monkeypatch.setattr(collector, "_log_submission", log_submission)

    assert collector.send_telemetry(metrics) is True
    assert post.call_args.kwargs["json"] == metrics
    assert post.call_args.kwargs["timeout"] == 10
    assert post.call_args.kwargs["headers"]["User-Agent"] == "BillManager/4.3.2"
    log_submission.assert_called_once_with(metrics, True, None)


def test_sender_retries_transient_failures_and_logs_once(monkeypatch):
    collector = TelemetryCollector()
    collector.telemetry_enabled = True
    collector.telemetry_url = "https://telemetry.invalid/api"
    collector.instance_id = str(uuid.uuid4())
    collector.send_attempts = 3
    metrics = {"instance_id": collector.instance_id, "version": "4.3.2"}
    post = Mock(side_effect=[
        telemetry_receiver.requests.exceptions.Timeout(),
        Mock(status_code=503, text="unavailable"),
        Mock(status_code=200, text="ok"),
    ])
    log_submission = Mock()
    sleep = Mock()

    monkeypatch.setattr(collector, "_is_opted_out", Mock(return_value=False))
    monkeypatch.setattr("services.telemetry.requests.post", post)
    monkeypatch.setattr("services.telemetry.time.sleep", sleep)
    monkeypatch.setattr(collector, "_log_submission", log_submission)

    assert collector.send_telemetry(metrics) is True
    assert post.call_count == 3
    assert sleep.call_count == 2
    log_submission.assert_called_once_with(metrics, True, None)


def test_sender_does_not_retry_non_retryable_client_error(monkeypatch):
    collector = TelemetryCollector()
    collector.telemetry_enabled = True
    collector.telemetry_url = "https://telemetry.invalid/api"
    collector.instance_id = str(uuid.uuid4())
    metrics = {"instance_id": collector.instance_id, "version": "4.3.2"}
    post = Mock(return_value=Mock(status_code=400, text="invalid"))
    log_submission = Mock()
    sleep = Mock()

    monkeypatch.setattr(collector, "_is_opted_out", Mock(return_value=False))
    monkeypatch.setattr("services.telemetry.requests.post", post)
    monkeypatch.setattr("services.telemetry.time.sleep", sleep)
    monkeypatch.setattr(collector, "_log_submission", log_submission)

    assert collector.send_telemetry(metrics) is False
    post.assert_called_once()
    sleep.assert_not_called()
    log_submission.assert_called_once_with(metrics, False, "HTTP 400: invalid")


def test_recent_success_suppresses_duplicate_unless_forced(
    db_session, monkeypatch
):
    instance_id = str(uuid.uuid4())
    db_session.add(
        TelemetryLog(
            instance_id=instance_id,
            version="4.3.2",
            deployment_mode="self-hosted",
            send_successful=True,
            last_sent_at=datetime.now(timezone.utc),
        )
    )
    db_session.commit()
    collector = TelemetryCollector()
    collector.db = db
    collector.instance_id = instance_id
    collector.telemetry_enabled = True
    collector.telemetry_url = "https://telemetry.invalid/api"
    metrics = {"instance_id": instance_id, "version": "4.3.2"}
    post = Mock(return_value=Mock(status_code=200, text="ok"))

    monkeypatch.setattr(collector, "_is_opted_out", Mock(return_value=False))
    monkeypatch.setattr("services.telemetry.requests.post", post)
    monkeypatch.setattr(collector, "_log_submission", Mock())

    assert collector.send_telemetry(metrics) is False
    post.assert_not_called()
    assert collector.send_telemetry(metrics, force=True) is True
    post.assert_called_once()


def test_owner_opt_out_prevents_collection_and_network(
    admin_user, db_session, monkeypatch
):
    admin_user.telemetry_opt_out = True
    db_session.commit()
    collector = TelemetryCollector()
    collector.db = db
    collector.telemetry_enabled = True
    collector.telemetry_url = "https://telemetry.invalid/api"
    monkeypatch.setattr(
        collector,
        "collect_metrics",
        Mock(side_effect=AssertionError("opted-out telemetry must not collect metrics")),
    )
    post = Mock(side_effect=AssertionError("opted-out telemetry must not use the network"))
    monkeypatch.setattr("services.telemetry.requests.post", post)

    assert collector.send_telemetry() is False
    post.assert_not_called()


def test_pending_instance_consent_prevents_network(
    admin_user, db_session, monkeypatch
):
    db_session.add(TelemetrySettings(id=1, state="pending"))
    db_session.commit()
    collector = TelemetryCollector()
    collector.db = db
    collector.telemetry_enabled = True
    collector.telemetry_url = "https://telemetry.invalid/api"
    post = Mock(side_effect=AssertionError("pending consent must not use network"))
    monkeypatch.setattr("services.telemetry.requests.post", post)

    assert collector.send_telemetry({"version": "4.3.2"}) is False
    post.assert_not_called()


@SELF_HOSTED_ONLY
def test_collect_metrics_reads_real_database_without_self_host_identifiers(
    app, admin_user, test_database, test_bill, monkeypatch
):
    collector = TelemetryCollector()
    collector.app = app
    collector.db = db
    collector.instance_id = str(uuid.uuid4())
    monkeypatch.setattr(collector, "_restore_instance_id_from_log", Mock())
    monkeypatch.setattr(
        collector,
        "_get_server_ip",
        Mock(side_effect=AssertionError("self-hosted telemetry must not resolve public IP")),
    )

    metrics = collector.collect_metrics()

    assert metrics["deployment_mode"] == "self-hosted"
    assert metrics["metrics"]["users"]["total"] == 1
    assert metrics["metrics"]["data"]["databases"] == 1
    assert metrics["metrics"]["data"]["bills"] == 1
    assert metrics["platform"]["database"].startswith("PostgreSQL")
    assert "server_url" not in metrics
    assert "server_ip" not in metrics


@SAAS_ONLY
def test_collect_metrics_includes_saas_deployment_identifiers(
    app, admin_user, test_database, test_bill, monkeypatch
):
    collector = TelemetryCollector()
    collector.app = app
    collector.db = db
    collector.instance_id = str(uuid.uuid4())
    monkeypatch.setattr(collector, "_restore_instance_id_from_log", Mock())
    monkeypatch.setattr(
        collector, "_get_server_url", Mock(return_value="https://app.test")
    )
    monkeypatch.setattr(
        collector, "_get_server_ip", Mock(return_value="203.0.113.10")
    )

    metrics = collector.collect_metrics()

    assert metrics["deployment_mode"] == "saas"
    assert metrics["metrics"]["users"]["total"] == 1
    assert metrics["metrics"]["data"]["databases"] == 1
    assert metrics["metrics"]["data"]["bills"] == 1
    assert metrics["server_url"] == "https://app.test"
    assert metrics["server_ip"] == "203.0.113.10"


def test_collect_metrics_counts_users_active_within_thirty_days(
    app, admin_user, regular_user, db_session
):
    admin_user.last_login_at = datetime.now(timezone.utc) - timedelta(days=5)
    regular_user.last_login_at = datetime.now(timezone.utc) - timedelta(days=31)
    db_session.commit()
    collector = TelemetryCollector()
    collector.app = app
    collector.db = db
    collector.instance_id = str(uuid.uuid4())

    assert collector._get_user_metrics()["active_30d"] == 1


def test_instance_id_is_recovered_from_persistent_log(db_session, monkeypatch):
    monkeypatch.delenv("TELEMETRY_INSTANCE_ID", raising=False)
    persisted_id = str(uuid.uuid4())
    db_session.add(
        TelemetryLog(
            instance_id=persisted_id,
            version="4.3.1",
            deployment_mode="self-hosted",
            send_successful=True,
        )
    )
    db_session.commit()

    collector = TelemetryCollector()
    collector.instance_id = str(uuid.uuid4())
    collector._restore_instance_id_from_log()

    assert collector.instance_id == persisted_id


def test_receiver_persists_valid_json(app, db_session, monkeypatch):
    monkeypatch.setattr(telemetry_receiver, "TELEMETRY_INGEST_REQUIRE_AUTH", False)
    telemetry_receiver._request_buckets.clear()
    instance_id = str(uuid.uuid4())
    payload = {
        "instance_id": instance_id,
        "version": "4.3.2",
        "deployment_mode": "self-hosted",
        "installation_date": "2026-07-15T12:00:00+00:00",
        "metrics": {"users": {"total": 2}},
        "platform": {"os": "Linux"},
    }

    with app.test_request_context("/api/telemetry", method="POST", json=payload):
        response, status = _response_status(telemetry_receiver.receive_telemetry())

    assert status == 200
    assert response.get_json()["success"] is True
    submission = TelemetrySubmission.query.filter_by(instance_id=instance_id).one()
    assert json.loads(submission.metrics_json) == payload["metrics"]
    assert json.loads(submission.platform_json) == payload["platform"]


def test_receiver_deduplicates_retried_payload(app, db_session, monkeypatch):
    monkeypatch.setattr(telemetry_receiver, "TELEMETRY_INGEST_REQUIRE_AUTH", False)
    telemetry_receiver._request_buckets.clear()
    instance_id = str(uuid.uuid4())
    payload = {
        "instance_id": instance_id,
        "version": "4.3.2",
        "deployment_mode": "self-hosted",
        "metrics": {"users": {"total": 2}},
        "platform": {"os": "Linux"},
    }

    responses = []
    for _ in range(2):
        with app.test_request_context("/api/telemetry", method="POST", json=payload):
            response, status = _response_status(
                telemetry_receiver.receive_telemetry()
            )
            responses.append((response.get_json(), status))

    assert responses[0][1] == 200
    assert responses[0][0]["duplicate"] is False
    assert responses[1][1] == 200
    assert responses[1][0]["duplicate"] is True
    assert TelemetrySubmission.query.filter_by(instance_id=instance_id).count() == 1


def test_rate_limiter_bounds_bucket_count(monkeypatch):
    telemetry_receiver._request_buckets.clear()
    monkeypatch.setattr(telemetry_receiver, "TELEMETRY_RATE_LIMIT_MAX_BUCKETS", 2)
    monkeypatch.setattr(telemetry_receiver, "_last_bucket_cleanup", 0.0)
    monkeypatch.setattr(telemetry_receiver.time, "time", Mock(return_value=1000.0))

    assert telemetry_receiver._rate_limit("one", 60) is True
    assert telemetry_receiver._rate_limit("two", 60) is True
    assert telemetry_receiver._rate_limit("three", 60) is True

    assert len(telemetry_receiver._request_buckets) == 2
    assert "three" in telemetry_receiver._request_buckets


def test_receiver_retention_removes_expired_submissions(db_session, monkeypatch):
    expired_id = str(uuid.uuid4())
    current_id = str(uuid.uuid4())
    db_session.add_all([
        TelemetrySubmission(
            instance_id=expired_id,
            version="4.3.2",
            deployment_mode="self-hosted",
            received_at=datetime.now(timezone.utc) - timedelta(days=31),
        ),
        TelemetrySubmission(
            instance_id=current_id,
            version="4.3.2",
            deployment_mode="self-hosted",
            received_at=datetime.now(timezone.utc),
        ),
    ])
    db_session.commit()
    monkeypatch.setattr(
        telemetry_receiver, "TELEMETRY_SUBMISSION_RETENTION_DAYS", 30
    )
    monkeypatch.setattr(telemetry_receiver, "_last_retention_cleanup", 0.0)

    telemetry_receiver._cleanup_old_submissions(db, TelemetrySubmission)

    assert TelemetrySubmission.query.filter_by(instance_id=expired_id).count() == 0
    assert TelemetrySubmission.query.filter_by(instance_id=current_id).count() == 1


def test_local_log_retention_preserves_latest_identity(db_session):
    instance_id = str(uuid.uuid4())
    expired = TelemetryLog(
        instance_id=instance_id,
        version="4.3.1",
        deployment_mode="self-hosted",
        send_successful=True,
        last_sent_at=datetime.now(timezone.utc) - timedelta(days=91),
    )
    latest = TelemetryLog(
        instance_id=instance_id,
        version="4.3.2",
        deployment_mode="self-hosted",
        send_successful=True,
        last_sent_at=datetime.now(timezone.utc),
    )
    db_session.add_all([expired, latest])
    db_session.commit()
    expired_id = expired.id
    latest_id = latest.id
    collector = TelemetryCollector()
    collector.db = db
    collector.local_log_retention_days = 90

    collector._cleanup_local_logs()

    assert db.session.get(TelemetryLog, expired_id) is None
    assert db.session.get(TelemetryLog, latest_id) is not None


def test_sender_and_receiver_contract_end_to_end(app, db_session, monkeypatch):
    instance_id = str(uuid.uuid4())
    payload = {
        "instance_id": instance_id,
        "version": "4.3.2",
        "deployment_mode": "self-hosted",
        "metrics": {"users": {"total": 1}},
        "platform": {"os": "Linux"},
    }
    collector = TelemetryCollector()
    collector.db = db
    collector.instance_id = instance_id
    collector.telemetry_enabled = True
    collector.telemetry_url = "http://local.test/api/telemetry"
    monkeypatch.setattr(collector, "_is_opted_out", Mock(return_value=False))
    monkeypatch.setattr(telemetry_receiver, "TELEMETRY_INGEST_REQUIRE_AUTH", False)
    telemetry_receiver._request_buckets.clear()

    def local_post(_url, json, timeout, headers):
        assert timeout == 10
        with app.test_request_context(
            "/api/telemetry", method="POST", json=json, headers=headers
        ):
            response, status = _response_status(
                telemetry_receiver.receive_telemetry()
            )
        return Mock(status_code=status, text=response.get_data(as_text=True))

    monkeypatch.setattr("services.telemetry.requests.post", local_post)

    assert collector.send_telemetry(payload) is True
    assert TelemetrySubmission.query.filter_by(instance_id=instance_id).count() == 1
    local_log = TelemetryLog.query.filter_by(instance_id=instance_id).one()
    assert local_log.send_successful is True
    assert json.loads(local_log.metrics_snapshot) == payload


def test_receiver_rejects_malformed_and_oversized_identifiers(
    app, db_session, monkeypatch
):
    monkeypatch.setattr(telemetry_receiver, "TELEMETRY_INGEST_REQUIRE_AUTH", False)
    telemetry_receiver._request_buckets.clear()

    with app.test_request_context(
        "/api/telemetry",
        method="POST",
        data="{",
        content_type="application/json",
    ):
        _, malformed_status = _response_status(telemetry_receiver.receive_telemetry())

    with app.test_request_context(
        "/api/telemetry",
        method="POST",
        json={"instance_id": "x" * 65},
    ):
        _, oversized_status = _response_status(telemetry_receiver.receive_telemetry())

    with app.test_request_context(
        "/api/telemetry",
        method="POST",
        json={"instance_id": "not-a-uuid"},
    ):
        _, invalid_id_status = _response_status(telemetry_receiver.receive_telemetry())

    assert malformed_status == 400
    assert oversized_status == 400
    assert invalid_id_status == 400
    assert TelemetrySubmission.query.count() == 0


def test_public_ingest_does_not_make_stats_public(app, monkeypatch):
    monkeypatch.setattr(telemetry_receiver, "TELEMETRY_INGEST_REQUIRE_AUTH", False)
    monkeypatch.setattr(telemetry_receiver, "TELEMETRY_RECEIVER_API_KEY", None)
    telemetry_receiver._request_buckets.clear()

    with app.test_request_context("/api/telemetry/stats", method="GET"):
        _, status = _response_status(telemetry_receiver.get_telemetry_stats())

    assert status == 503


def test_notice_honors_global_disable(client, admin_auth_headers, monkeypatch):
    monkeypatch.setenv("TELEMETRY_ENABLED", "false")

    response = client.get("/api/v2/telemetry/notice", headers=admin_auth_headers)

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data == {
        "show_notice": False,
        "reason": "globally_disabled",
        "telemetry_enabled": False,
        "deployment_mode": config.DEPLOYMENT_MODE,
        "consent_state": "pending",
    }


def test_notice_keeps_config_after_owner_choice(
    client, admin_user, admin_auth_headers, db_session, monkeypatch
):
    monkeypatch.setenv("TELEMETRY_ENABLED", "true")
    admin_user.telemetry_notice_shown_at = datetime.now(timezone.utc)
    admin_user.telemetry_opt_out = False
    db_session.commit()

    response = client.get("/api/v2/telemetry/notice", headers=admin_auth_headers)

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["show_notice"] is False
    assert data["opted_out"] is False
    assert data["consent_state"] == "enabled"
    assert data["telemetry_enabled"] is True
    assert data["deployment_mode"] == config.DEPLOYMENT_MODE


def test_conservative_instance_migration_prefers_any_owner_opt_out(
    client, admin_user, admin_auth_headers, db_session
):
    admin_user.telemetry_notice_shown_at = datetime.now(timezone.utc)
    admin_user.telemetry_opt_out = False
    other_owner = User(username="otheradmin", role="admin")
    other_owner.set_password("testpassword123")
    other_owner.telemetry_notice_shown_at = datetime.now(timezone.utc)
    other_owner.telemetry_opt_out = True
    db_session.add(other_owner)
    db_session.commit()

    response = client.get("/api/v2/telemetry/notice", headers=admin_auth_headers)

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["consent_state"] == "disabled"
    assert data["opted_out"] is True
    settings = db.session.get(TelemetrySettings, 1)
    assert settings.decided_by_user_id == other_owner.id


def test_accept_and_opt_out_update_single_instance_setting(
    client, admin_auth_headers, db_session
):
    accepted = client.post(
        "/api/v2/telemetry/accept", headers=admin_auth_headers
    )
    assert accepted.status_code == 200
    assert db.session.get(TelemetrySettings, 1).state == "enabled"

    disabled = client.post(
        "/api/v2/telemetry/opt-out", headers=admin_auth_headers
    )
    assert disabled.status_code == 200
    settings = db.session.get(TelemetrySettings, 1)
    assert settings.state == "disabled"
    assert settings.decided_by_user_id is not None


def test_successful_login_updates_last_login_at_at_most_daily(
    client, admin_user, db_session
):
    response = client.post(
        "/api/v2/auth/login",
        json={"username": admin_user.username, "password": "testpassword123"},
    )
    assert response.status_code == 200
    db_session.refresh(admin_user)
    first_login = admin_user.last_login_at
    assert first_login is not None

    response = client.post(
        "/api/v2/auth/login",
        json={"username": admin_user.username, "password": "testpassword123"},
    )
    assert response.status_code == 200
    db_session.refresh(admin_user)
    assert admin_user.last_login_at == first_login

    admin_user.last_login_at = datetime.now(timezone.utc) - timedelta(hours=25)
    db_session.commit()
    response = client.post(
        "/api/v2/auth/login",
        json={"username": admin_user.username, "password": "testpassword123"},
    )
    assert response.status_code == 200
    db_session.refresh(admin_user)
    assert admin_user.last_login_at > first_login


def test_failed_login_does_not_update_last_login_at(
    client, admin_user, db_session
):
    response = client.post(
        "/api/v2/auth/login",
        json={"username": admin_user.username, "password": "wrong-password"},
    )
    assert response.status_code == 401
    db_session.refresh(admin_user)
    assert admin_user.last_login_at is None


def test_scheduler_uses_utc_and_five_minute_startup_delay(monkeypatch):
    monkeypatch.delenv("FLASK_ENV", raising=False)
    app = Flask(__name__)
    scheduler = TaskScheduler(app)
    before = datetime.now(timezone.utc)

    try:
        scheduler.start()
        startup_job = scheduler.scheduler.get_job("telemetry_startup")
        daily_job = scheduler.scheduler.get_job("telemetry_daily")

        assert before + timedelta(minutes=4, seconds=50) <= startup_job.next_run_time
        assert startup_job.next_run_time <= before + timedelta(minutes=5, seconds=10)
        assert str(daily_job.trigger.timezone) == "UTC"
    finally:
        scheduler.stop()


def test_scheduler_skips_send_when_another_worker_holds_lock(monkeypatch):
    app = Flask(__name__)
    scheduler = TaskScheduler(app)
    send = Mock()

    @contextmanager
    def unavailable_lock():
        yield False

    monkeypatch.setattr(scheduler, "_telemetry_job_lock", unavailable_lock)
    monkeypatch.setattr("services.telemetry.telemetry.send_telemetry", send)

    scheduler._send_telemetry()

    send.assert_not_called()
