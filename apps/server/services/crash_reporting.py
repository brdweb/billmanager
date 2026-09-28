"""Opt-in, error-only Sentry reporting with a closed outbound data contract."""

import logging
import os
from pathlib import Path
import platform
import re
import sysconfig

import sentry_sdk
from sentry_sdk.envelope import Envelope
from sentry_sdk.integrations.flask import FlaskIntegration
from sentry_sdk.transport import HttpTransport

logger = logging.getLogger(__name__)

_SERVER_ROOT = Path(__file__).resolve().parents[1]
_LIBRARY_ROOT = Path(sysconfig.get_path("purelib")).resolve()
_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_.<>]*\Z")


def _identifier(value, fallback):
    return value if isinstance(value, str) and _IDENTIFIER.fullmatch(value) else fallback


def _frame(frame):
    # Only deployed code locations survive; never send host paths or source/locals.
    path = Path(frame.get("abs_path") or frame.get("filename") or "")
    if not path.is_absolute():
        return None
    path = path.resolve()
    for root, prefix in ((_LIBRARY_ROOT, "dependencies"), (_SERVER_ROOT, "server")):
        if path.is_relative_to(root) and path.suffix == ".py":
            result = {
                "filename": f"{prefix}/{path.relative_to(root).as_posix()}",
                "function": _identifier(frame.get("function"), "<unknown>"),
                "in_app": prefix == "server",
            }
            if type(frame.get("lineno")) is int:
                result["lineno"] = frame["lineno"]
            return result
    return None


def scrub_event(event, hint):
    """Allowlist diagnostics; messages, request data and arbitrary scope are dropped."""
    exceptions = []
    for error in event.get("exception", {}).get("values", []):
        frames = [
            clean for frame in error.get("stacktrace", {}).get("frames", [])
            if (clean := _frame(frame)) is not None
        ]
        exceptions.append({
            "type": _identifier(error.get("type"), "Error"),
            "value": "[Removed for privacy]",
            "stacktrace": {"frames": frames},
        })
    if not exceptions:
        # capture_message/log events may contain financial data and have no stack.
        return None
    return {
        **{key: event[key] for key in ("event_id", "timestamp", "release", "environment")
           if key in event},
        "platform": "python",
        "level": "error",
        "exception": {"values": exceptions},
        "contexts": {"runtime": {"name": "CPython", "version": platform.python_version()}},
    }


class ErrorOnlyTransport(HttpTransport):
    """Attachments, sessions, tracing and envelope baggage never leave the process."""

    def capture_envelope(self, envelope):
        # Rebuild headers and items rather than forwarding arbitrary SDK additions.
        clean = Envelope(headers={
            key: envelope.headers[key] for key in ("event_id", "sent_at")
            if key in envelope.headers
        })
        for item in envelope.items:
            if item.type == "event":
                clean.add_event(item.get_event())
        if clean.items:
            super().capture_envelope(clean)


def init_crash_reporting(server_version):
    """Initialize once per app process; a blank DSN means no reporting in either mode."""
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        return
    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=os.environ.get("SENTRY_ENVIRONMENT") or "development",
            release=os.environ.get("SENTRY_RELEASE") or f"server-v{server_version}",
            integrations=[FlaskIntegration()],
            default_integrations=False,
            auto_enabling_integrations=False,
            send_default_pii=False,
            include_local_variables=False,
            include_source_context=False,
            max_request_body_size="never",
            max_breadcrumbs=0,
            before_breadcrumb=lambda breadcrumb, hint: None,
            before_send=scrub_event,
            transport=ErrorOnlyTransport,
            traces_sample_rate=0.0,
            profiles_sample_rate=0.0,
            profile_session_sample_rate=0.0,
            trace_propagation_targets=[],
            enable_logs=False,
            enable_metrics=False,
            auto_session_tracking=False,
            send_client_reports=False,
            server_name="",
            debug=False,
            spotlight=False,
        )
    except Exception:
        # SDK errors can contain the DSN; do not echo them into logs or tracebacks.
        logger.warning(
            "Crash reporting disabled: invalid Sentry configuration; "
            "check the operator runbook"
        )
