"""
Structured logging configuration for BillManager.

Environment Variables:
- LOG_LEVEL: Set logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL). Default: INFO
- LOG_FORMAT: Log output format ('json' for structured JSON, 'text' for human-readable). Default: text
- LOG_REQUESTS: Enable request/response logging ('true'/'false'). Default: false
- LOG_SQL: Enable SQL query logging ('true'/'false'). Default: false

Usage:
    from services.logging_config import get_logger, setup_logging

    # Initialize logging once at app startup
    setup_logging()

    # Get a logger for your module
    logger = get_logger(__name__)

    # Log with context
    logger.info("User logged in", extra={"user_id": 123, "ip": "1.2.3.4"})
"""

import os
import sys
import json
import logging
import uuid
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Optional
from flask import request, g, has_request_context


# Environment configuration
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
LOG_FORMAT = os.environ.get('LOG_FORMAT', 'text').lower()
LOG_REQUESTS = os.environ.get('LOG_REQUESTS', 'false').lower() == 'true'
LOG_SQL = os.environ.get('LOG_SQL', 'false').lower() == 'true'


class StructuredFormatter(logging.Formatter):
    """JSON formatter for structured logging in production."""

    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
        }

        # Add request context if available
        if has_request_context():
            log_data['request_id'] = getattr(g, 'request_id', None)
            log_data['method'] = request.method
            log_data['path'] = request.path
            log_data['remote_addr'] = request.remote_addr

        # Add extra fields from the log record
        if hasattr(record, 'extra_data'):
            log_data.update(record.extra_data)

        # Add exception info if present
        if record.exc_info:
            log_data['exception'] = self.formatException(record.exc_info)

        # Add any custom attributes passed via extra
        for key, value in record.__dict__.items():
            if key not in ('name', 'msg', 'args', 'created', 'filename', 'funcName',
                          'levelname', 'levelno', 'lineno', 'module', 'msecs',
                          'pathname', 'process', 'processName', 'relativeCreated',
                          'stack_info', 'exc_info', 'exc_text', 'message', 'extra_data'):
                if not key.startswith('_'):
                    log_data[key] = value

        return json.dumps(log_data, default=str)


class TextFormatter(logging.Formatter):
    """Human-readable formatter for development."""

    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

        # Build base message
        base = f"[{timestamp}] {record.levelname:8} {record.name}: {record.getMessage()}"

        # Add request context if available
        if has_request_context():
            request_id = getattr(g, 'request_id', None)
            if request_id:
                base = f"[{request_id[:8]}] {base}"

        # Add extra context if present
        extra_parts = []
        if hasattr(record, 'extra_data') and record.extra_data:
            for key, value in record.extra_data.items():
                extra_parts.append(f"{key}={value}")

        if extra_parts:
            base = f"{base} | {' '.join(extra_parts)}"

        # Add exception if present
        if record.exc_info:
            base = f"{base}\n{self.formatException(record.exc_info)}"

        return base


class ContextLogger(logging.Logger):
    """Logger that automatically includes request context."""

    def _log(self, level, msg, args, exc_info=None, extra=None, stack_info=False, stacklevel=1):
        if extra is None:
            extra = {}

        # Store extra data for formatters
        extra['extra_data'] = extra.copy()

        super()._log(level, msg, args, exc_info, extra, stack_info, stacklevel + 1)


def setup_logging() -> None:
    """Initialize logging configuration. Call once at application startup."""
    # Set the custom logger class
    logging.setLoggerClass(ContextLogger)

    # Get numeric log level
    numeric_level = getattr(logging, LOG_LEVEL, logging.INFO)

    # Create handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(numeric_level)

    # Choose formatter based on environment
    if LOG_FORMAT == 'json':
        handler.setFormatter(StructuredFormatter())
    else:
        handler.setFormatter(TextFormatter())

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)

    # Remove existing handlers and add ours
    root_logger.handlers = []
    root_logger.addHandler(handler)

    # Configure SQLAlchemy logging
    if LOG_SQL:
        logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)
    else:
        logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)

    # Reduce noise from some libraries
    logging.getLogger('werkzeug').setLevel(logging.WARNING)
    logging.getLogger('urllib3').setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Get a logger instance for the given name."""
    return logging.getLogger(name)


def generate_request_id() -> str:
    """Generate a unique request ID for tracing."""
    return str(uuid.uuid4())


def request_logging_middleware(app):
    """
    Add request logging middleware to the Flask app.

    This middleware:
    1. Assigns a unique request ID to each request
    2. Logs request start and completion
    3. Includes timing information
    """
    @app.before_request
    def before_request():
        # Generate and store request ID
        g.request_id = request.headers.get('X-Request-ID') or generate_request_id()
        g.request_start_time = datetime.now(timezone.utc)

        if LOG_REQUESTS:
            logger = get_logger('request')
            logger.info(
                f"Request started: {request.method} {request.path}",
                extra={
                    'user_agent': request.user_agent.string[:100] if request.user_agent else None,
                    'content_length': request.content_length,
                }
            )

    @app.after_request
    def after_request(response):
        if LOG_REQUESTS and hasattr(g, 'request_start_time'):
            duration_ms = (datetime.now(timezone.utc) - g.request_start_time).total_seconds() * 1000
            logger = get_logger('request')
            logger.info(
                f"Request completed: {request.method} {request.path} -> {response.status_code}",
                extra={
                    'status_code': response.status_code,
                    'duration_ms': round(duration_ms, 2),
                    'content_length': response.content_length,
                }
            )

        # Add request ID to response headers for client-side correlation
        if hasattr(g, 'request_id'):
            response.headers['X-Request-ID'] = g.request_id

        return response

    return app


def log_function_call(logger: Optional[logging.Logger] = None):
    """
    Decorator to log function entry and exit with timing.

    Usage:
        @log_function_call()
        def my_function(arg1, arg2):
            ...
    """
    def decorator(func):
        func_logger = logger or get_logger(func.__module__)

        @wraps(func)
        def wrapper(*args, **kwargs):
            func_name = func.__name__
            func_logger.debug(f"Entering {func_name}", extra={'args': str(args)[:100], 'kwargs': str(kwargs)[:100]})

            start_time = datetime.now(timezone.utc)
            try:
                result = func(*args, **kwargs)
                duration_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
                func_logger.debug(f"Exiting {func_name}", extra={'duration_ms': round(duration_ms, 2)})
                return result
            except Exception as e:
                duration_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
                func_logger.error(
                    f"Exception in {func_name}: {str(e)}",
                    extra={'duration_ms': round(duration_ms, 2)},
                    exc_info=True
                )
                raise

        return wrapper
    return decorator


# Security event logging helpers
def log_auth_event(event_type: str, success: bool, user_id: Optional[int] = None,
                   username: Optional[str] = None, **extra):
    """Log authentication-related security events."""
    logger = get_logger('security.auth')
    level = logging.INFO if success else logging.WARNING

    extra_data = {
        'event_type': event_type,
        'success': success,
        'user_id': user_id,
        'username': username,
    }
    if has_request_context():
        extra_data['ip_address'] = request.remote_addr
        extra_data['user_agent'] = request.user_agent.string[:100] if request.user_agent else None

    extra_data.update(extra)

    logger.log(level, f"Auth event: {event_type}", extra=extra_data)


def log_security_event(event_type: str, severity: str = 'info', **extra):
    """Log general security events."""
    logger = get_logger('security')
    level = getattr(logging, severity.upper(), logging.INFO)

    extra_data = {
        'event_type': event_type,
        'severity': severity,
    }
    if has_request_context():
        extra_data['ip_address'] = request.remote_addr

    extra_data.update(extra)

    logger.log(level, f"Security event: {event_type}", extra=extra_data)


def log_audit_event(action: str, resource_type: str, resource_id: Any,
                    user_id: Optional[int] = None, **extra):
    """Log audit trail events for compliance."""
    logger = get_logger('audit')

    extra_data = {
        'action': action,
        'resource_type': resource_type,
        'resource_id': resource_id,
        'user_id': user_id,
    }
    if has_request_context():
        extra_data['ip_address'] = request.remote_addr

    extra_data.update(extra)

    logger.info(f"Audit: {action} on {resource_type}/{resource_id}", extra=extra_data)
