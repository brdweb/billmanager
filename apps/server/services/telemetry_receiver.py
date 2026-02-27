"""
Telemetry receiver endpoint for production server.

This module should be added to your production BillManager instance to:
1. Receive anonymous telemetry from all BillManager installations
2. Store telemetry data for analysis
3. Alert when new SaaS deployments are detected
4. Provide dashboard for viewing installation stats
"""

import os
import logging
import time
import secrets
import requests
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from sqlalchemy import desc

logger = logging.getLogger(__name__)

# Create blueprint for telemetry receiver
telemetry_receiver_bp = Blueprint('telemetry_receiver', __name__)

# Security controls
TELEMETRY_RECEIVER_REQUIRE_AUTH = os.environ.get('TELEMETRY_RECEIVER_REQUIRE_AUTH', 'true').lower() == 'true'
TELEMETRY_RECEIVER_API_KEY = os.environ.get('TELEMETRY_RECEIVER_API_KEY')
TELEMETRY_MAX_PAYLOAD_BYTES = int(os.environ.get('TELEMETRY_MAX_PAYLOAD_BYTES', '16384'))
TELEMETRY_INGEST_RATE_PER_MINUTE = int(os.environ.get('TELEMETRY_INGEST_RATE_PER_MINUTE', '60'))
TELEMETRY_STATS_RATE_PER_MINUTE = int(os.environ.get('TELEMETRY_STATS_RATE_PER_MINUTE', '30'))

_rate_window_seconds = 60
_request_buckets: dict[str, list[float]] = {}


def _rate_limit(bucket_key: str, limit_per_minute: int) -> bool:
    """Simple in-memory sliding-window limiter."""
    now = time.time()
    bucket = _request_buckets.get(bucket_key, [])
    bucket = [ts for ts in bucket if now - ts < _rate_window_seconds]
    if len(bucket) >= limit_per_minute:
        _request_buckets[bucket_key] = bucket
        return False
    bucket.append(now)
    _request_buckets[bucket_key] = bucket
    return True


def _is_admin_jwt() -> bool:
    """Validate Authorization bearer token and require admin role."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return False
    token = auth_header.split(' ', 1)[1].strip()
    if not token:
        return False

    try:
        from app import verify_access_token
        payload = verify_access_token(token)
    except Exception:
        return False

    return bool(payload and payload.get('role') == 'admin')


def _is_valid_api_key() -> bool:
    supplied = request.headers.get('X-Telemetry-Api-Key', '')
    if not TELEMETRY_RECEIVER_API_KEY:
        return False
    return secrets.compare_digest(supplied, TELEMETRY_RECEIVER_API_KEY)


def _require_receiver_auth():
    """Return (response, status) tuple when auth fails, else None."""
    if not TELEMETRY_RECEIVER_REQUIRE_AUTH:
        return None

    if not TELEMETRY_RECEIVER_API_KEY and not request.headers.get('Authorization'):
        logger.error("Telemetry receiver auth is enabled but no API key/JWT was provided")
        return jsonify({'error': 'Telemetry receiver authentication is not configured'}), 503

    if _is_valid_api_key() or _is_admin_jwt():
        return None
    return jsonify({'error': 'Authentication required'}), 401


def _require_rate_limit(route_name: str, limit_per_minute: int):
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr or 'unknown').split(',')[0].strip()
    bucket_key = f'{route_name}:{client_ip}'
    if _rate_limit(bucket_key, limit_per_minute):
        return None
    return jsonify({'error': 'Rate limit exceeded'}), 429


@telemetry_receiver_bp.route('/api/telemetry', methods=['POST'])
def receive_telemetry():
    """
    Receive telemetry data from BillManager installations.

    This endpoint should only be enabled on your production server.
    """
    from models import db, TelemetrySubmission

    try:
        # Request size guard to reduce abuse and accidental oversized payloads.
        content_length = request.content_length or 0
        if content_length > TELEMETRY_MAX_PAYLOAD_BYTES:
            return jsonify({'error': 'Payload too large'}), 413

        rate_limited = _require_rate_limit('telemetry_ingest', TELEMETRY_INGEST_RATE_PER_MINUTE)
        if rate_limited:
            return rate_limited

        auth_error = _require_receiver_auth()
        if auth_error:
            return auth_error

        data = request.get_json()

        if not data or 'instance_id' not in data:
            return jsonify({'error': 'Invalid telemetry data'}), 400

        instance_id = data.get('instance_id')
        if not isinstance(instance_id, str) or not instance_id.strip() or len(instance_id) > 128:
            return jsonify({'error': 'Invalid telemetry data'}), 400
        deployment_mode = data.get('deployment_mode', 'unknown')
        version = data.get('version', 'unknown')

        # Check if this is a new instance
        existing = TelemetrySubmission.query.filter_by(instance_id=instance_id).first()
        is_new_instance = existing is None

        # Check if this is a new SaaS deployment (alert-worthy)
        is_new_saas = is_new_instance and deployment_mode == 'saas'

        # Don't alert for your own production instance
        production_instance_id = os.environ.get('PRODUCTION_INSTANCE_ID')
        if production_instance_id and instance_id == production_instance_id:
            is_new_saas = False

        # Store telemetry submission
        submission = TelemetrySubmission(
            instance_id=instance_id,
            version=version,
            deployment_mode=deployment_mode,
            installation_date=data.get('installation_date'),
            metrics_json=str(data.get('metrics', {})),
            platform_json=str(data.get('platform', {})),
            received_at=datetime.now(timezone.utc)
        )

        db.session.add(submission)
        db.session.commit()

        logger.info(f"Telemetry received from {instance_id} (mode: {deployment_mode}, version: {version}, new: {is_new_instance})")

        # Send alert for new SaaS deployments
        if is_new_saas:
            _send_saas_deployment_alert(instance_id, data)

        return jsonify({
            'success': True,
            'message': 'Telemetry received',
            'is_new': is_new_instance
        }), 200

    except Exception as e:
        logger.error(f"Failed to process telemetry: {e}", exc_info=True)
        return jsonify({'error': 'Failed to process telemetry'}), 500


def _send_saas_deployment_alert(instance_id: str, data: dict):
    """Send alert when new SaaS deployment is detected."""
    ntfy_url = os.environ.get('NTFY_ALERT_URL', 'https://ntfy.brdweb.com/billmanager-alerts')

    try:
        metrics = data.get('metrics', {})
        platform = data.get('platform', {})
        version = data.get('version', 'unknown')
        server_url = data.get('server_url', 'Not set')
        server_ip = data.get('server_ip', 'Unknown')

        message = (
            f"🚀 New BillManager SaaS Deployment Detected!\n\n"
            f"Instance ID: {instance_id}\n"
            f"Version: {version}\n"
            f"Installation Date: {data.get('installation_date', 'unknown')}\n\n"
            f"Contact Info:\n"
            f"- Server URL: {server_url}\n"
            f"- Server IP: {server_ip}\n\n"
            f"Stats:\n"
            f"- Users: {metrics.get('users', {}).get('total', 0)}\n"
            f"- Databases: {metrics.get('data', {}).get('databases', 0)}\n"
            f"- Bills: {metrics.get('data', {}).get('bills', 0)}\n\n"
            f"Platform:\n"
            f"- Python: {platform.get('python_version', 'unknown')}\n"
            f"- OS: {platform.get('os', 'unknown')}\n"
            f"- Database: {platform.get('database', 'unknown')}"
        )

        response = requests.post(
            ntfy_url,
            data=message.encode('utf-8'),
            headers={
                'Title': '🚨 New SaaS Deployment',
                'Priority': 'high',
                'Tags': 'warning,rocket',
            },
            timeout=5
        )

        if response.status_code == 200:
            logger.info(f"Alert sent for new SaaS deployment: {instance_id}")
        else:
            logger.warning(f"Failed to send alert: {response.status_code}")

    except Exception as e:
        logger.error(f"Failed to send SaaS deployment alert: {e}")


@telemetry_receiver_bp.route('/api/telemetry/stats', methods=['GET'])
def get_telemetry_stats():
    """
    Get aggregated telemetry statistics.

    Requires admin authentication.
    """
    from models import db, TelemetrySubmission
    from sqlalchemy import func

    try:
        rate_limited = _require_rate_limit('telemetry_stats', TELEMETRY_STATS_RATE_PER_MINUTE)
        if rate_limited:
            return rate_limited

        auth_error = _require_receiver_auth()
        if auth_error:
            return auth_error

        # Get total unique instances
        total_instances = db.session.query(
            func.count(func.distinct(TelemetrySubmission.instance_id))
        ).scalar() or 0

        # Count by deployment mode
        by_mode = db.session.query(
            TelemetrySubmission.deployment_mode,
            func.count(func.distinct(TelemetrySubmission.instance_id))
        ).group_by(TelemetrySubmission.deployment_mode).all()

        # Count by version
        by_version = db.session.query(
            TelemetrySubmission.version,
            func.count(func.distinct(TelemetrySubmission.instance_id))
        ).group_by(TelemetrySubmission.version).all()

        # Get recent submissions
        recent = TelemetrySubmission.query.order_by(
            desc(TelemetrySubmission.received_at)
        ).limit(10).all()

        return jsonify({
            'success': True,
            'data': {
                'total_instances': total_instances,
                'by_deployment_mode': {mode: count for mode, count in by_mode},
                'by_version': {version: count for version, count in by_version},
                'recent_submissions': [
                    {
                        'instance_id': s.instance_id,
                        'version': s.version,
                        'deployment_mode': s.deployment_mode,
                        'received_at': s.received_at.isoformat()
                    }
                    for s in recent
                ]
            }
        }), 200

    except Exception as e:
        logger.error(f"Failed to get telemetry stats: {e}", exc_info=True)
        return jsonify({'error': 'Failed to get stats'}), 500


# Database model for storing received telemetry (add to models.py on production server)
"""
class TelemetrySubmission(db.Model):
    '''Stores telemetry data received from BillManager installations'''
    __tablename__ = 'telemetry_submissions'
    id = db.Column(db.Integer, primary_key=True)
    instance_id = db.Column(db.String(64), nullable=False, index=True)
    version = db.Column(db.String(20), nullable=True)
    deployment_mode = db.Column(db.String(20), nullable=True, index=True)
    installation_date = db.Column(db.String(50), nullable=True)
    metrics_json = db.Column(db.Text, nullable=True)
    platform_json = db.Column(db.Text, nullable=True)
    received_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), index=True)

    __table_args__ = (
        db.Index('idx_instance_received', 'instance_id', 'received_at'),
    )
"""
