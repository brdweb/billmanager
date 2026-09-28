"""Inspect real SDK envelopes without sending anything to a Sentry service."""

import json
from pathlib import Path

from flask import Flask, request
import pytest
import sentry_sdk
from sentry_sdk.envelope import Envelope, Item, PayloadRef
from sentry_sdk.transport import HttpTransport

from services.crash_reporting import (
    ErrorOnlyTransport, init_crash_reporting, scrub_event,
)

# A synthetic non-routable DSN, never an account/project configuration.
_TEST_DSN = "https://test@example.invalid/1"
_CANARY = "PRIVATE_BILL_PAYEE_94713"


@pytest.fixture
def envelopes(monkeypatch):
    captured = []
    previous = sentry_sdk.get_global_scope().client
    monkeypatch.setenv("SENTRY_DSN", _TEST_DSN)
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "test")
    monkeypatch.delenv("SENTRY_RELEASE", raising=False)
    # Preserve the production privacy transport, replacing only its network sink.
    monkeypatch.setattr(HttpTransport, "capture_envelope", lambda self, envelope: captured.append(envelope))
    init_crash_reporting("test-build")
    with sentry_sdk.isolation_scope():
        yield captured
    sentry_sdk.get_client().close()
    sentry_sdk.get_global_scope().set_client(previous)


@pytest.mark.parametrize("mode", ["self-hosted", "saas"])
@pytest.mark.parametrize("dsn", [None, "", "  "])
def test_unconfigured_reporting_never_initializes(monkeypatch, mode, dsn):
    monkeypatch.setenv("DEPLOYMENT_MODE", mode)
    if dsn is None:
        monkeypatch.delenv("SENTRY_DSN", raising=False)
    else:
        monkeypatch.setenv("SENTRY_DSN", dsn)
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: pytest.fail("Sentry initialized without a DSN"))
    init_crash_reporting("test")


def test_invalid_configuration_does_not_echo_dsn(monkeypatch, caplog):
    monkeypatch.setenv("SENTRY_DSN", _CANARY)
    init_crash_reporting("test")
    assert "Crash reporting disabled: invalid Sentry configuration" in caplog.text
    assert _CANARY not in caplog.text


def test_flask_exception_is_captured_and_scrubbed(envelopes):
    app = Flask(__name__)
    app.logger.disabled = True

    @app.post("/crash/<payee>")
    def crash(payee):
        sentry_sdk.set_user({"id": _CANARY, "email": _CANARY})
        sentry_sdk.set_context("bill", request.get_json())
        sentry_sdk.set_tag("payee", payee)
        sentry_sdk.set_extra("authorization", request.headers.get("Authorization"))
        sentry_sdk.add_breadcrumb(message=_CANARY, data=request.get_json())
        sentry_sdk.get_current_scope().add_attachment(bytes=_CANARY.encode(), filename=f"{_CANARY}.txt")
        raise ValueError(f"{payee}: amount 9371.23, token {_CANARY}")

    client = app.test_client()
    client.set_cookie("session", _CANARY)
    response = client.post(
        f"/crash/{_CANARY}?token={_CANARY}",
        headers={"Authorization": f"Bearer {_CANARY}", "X-Forwarded-For": "192.0.2.99"},
        json={"name": _CANARY, "amount": 9371.23},
    )
    assert response.status_code == 500
    assert len(envelopes) == 1
    serialized = envelopes[0].serialize().decode()
    for forbidden in (_CANARY, "9371.23", "192.0.2.99", "Authorization", '"request"', '"user"', '"breadcrumbs"', '"vars"', '"attachment"'):
        assert forbidden not in serialized
    event = envelopes[0].get_event()
    assert event["release"] == "server-vtest-build"
    assert event["environment"] == "test"
    exception = event["exception"]["values"][0]
    assert exception["type"] == "ValueError"
    assert any(frame["function"] == "crash" and frame["lineno"] > 0 for frame in exception["stacktrace"]["frames"])
    assert {item.type for item in envelopes[0].items} == {"event"}


def test_manual_exception_and_exception_chain_are_scrubbed(envelopes):
    try:
        try:
            raise ValueError(_CANARY)
        except ValueError as cause:
            raise RuntimeError(_CANARY) from cause
    except RuntimeError:
        sentry_sdk.capture_exception()
    assert len(envelopes) == 1
    assert _CANARY not in envelopes[0].serialize().decode()
    assert [error["type"] for error in envelopes[0].get_event()["exception"]["values"]] == ["ValueError", "RuntimeError"]


def test_messages_traces_metrics_logs_and_sessions_are_disabled(envelopes):
    sentry_sdk.capture_message(_CANARY)
    with sentry_sdk.start_transaction(name=_CANARY):
        pass
    sentry_sdk.start_session()
    sentry_sdk.end_session()
    assert not envelopes
    options = sentry_sdk.get_client().options
    assert set(sentry_sdk.get_client().integrations) == {"flask"}
    for setting in ("send_default_pii", "include_local_variables", "include_source_context", "enable_logs", "enable_metrics", "auto_session_tracking", "send_client_reports"):
        assert options[setting] is False
    assert options["max_request_body_size"] == "never"
    assert options["trace_propagation_targets"] == []


def test_unknown_fields_and_host_paths_are_discarded():
    event = {
        "extra": {"bill": _CANARY}, "future_sdk_field": _CANARY,
        "exception": {"values": [{
            "type": "ValueError", "value": _CANARY,
            "mechanism": {"data": _CANARY},
            "stacktrace": {"frames": [
                {"abs_path": f"/customers/{_CANARY}/run.py", "vars": {"bill": _CANARY}},
                {"abs_path": str(Path(__file__).resolve()), "lineno": 1, "function": "crash",
                 "pre_context": [_CANARY], "context_line": _CANARY, "vars": {"bill": _CANARY}},
            ]},
        }]},
    }
    clean = scrub_event(event, {})
    assert _CANARY not in json.dumps(clean)
    frames = clean["exception"]["values"][0]["stacktrace"]["frames"]
    assert len(frames) == 1
    assert frames[0]["filename"] == "server/tests/test_crash_reporting.py"


def test_transport_drops_non_error_items_and_envelope_baggage(envelopes):
    transport = sentry_sdk.get_client().transport
    assert isinstance(transport, ErrorOnlyTransport)
    dirty = Envelope(headers={"trace": {"user_segment": _CANARY}, "arbitrary": _CANARY})
    for kind in ("attachment", "session", "sessions", "transaction", "profile", "log", "metric", "client_report"):
        dirty.add_item(Item(type=kind, payload=PayloadRef(bytes=_CANARY.encode())))
    transport.capture_envelope(dirty)
    assert not envelopes
    dirty.add_event({"exception": {"values": [{"type": "ValueError"}]}})
    transport.capture_envelope(dirty)
    assert len(envelopes) == 1
    assert _CANARY not in envelopes[0].serialize().decode()
    assert {item.type for item in envelopes[0].items} == {"event"}


def test_explicit_release_label(envelopes, monkeypatch):
    sentry_sdk.get_client().close()
    monkeypatch.setenv("SENTRY_RELEASE", "server-v1.2.3-build.4")
    init_crash_reporting("ignored")
    assert sentry_sdk.get_client().options["release"] == "server-v1.2.3-build.4"


def test_app_factory_wires_reporting(app, monkeypatch):
    # The session app fixture creates the real BillManager app in both test modes.
    import app as app_module
    calls = []
    monkeypatch.setattr(app_module, "init_crash_reporting", calls.append)
    app_module.create_app()
    assert calls == [app_module.SERVER_VERSION]
