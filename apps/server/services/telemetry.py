"""
Anonymous telemetry collection for BillManager.

Collects anonymous usage statistics to help improve the product.
- Optional for self-hosted users (TELEMETRY_ENABLED=false to disable)
- Alerts maintainer when new SaaS deployments are detected
- Never collects PII (usernames, emails, bill amounts, etc.)
"""

import os
import secrets
import time
import uuid
import platform
import logging
import requests
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional
from sqlalchemy import func, text

logger = logging.getLogger(__name__)

RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
_jitter_random = secrets.SystemRandom()


class TelemetryCollector:
    """Collects and sends anonymous usage statistics."""

    def __init__(self, app=None, db=None):
        self.app = app
        self.db = db
        self.instance_id = None
        self.telemetry_enabled = True
        self.telemetry_url = None
        self.instance_file = '.instance_id'
        self.send_attempts = 3
        self.retry_base_seconds = 1.0
        self.retry_max_seconds = 30.0
        self.min_send_interval_hours = 20.0
        self.local_log_retention_days = 90
        self._last_log_cleanup_at = None

        if app:
            self.init_app(app, db)

    def init_app(self, app, db):
        """Initialize telemetry with Flask app."""
        self.app = app
        self.db = db

        # Get configuration
        self.telemetry_enabled = os.environ.get('TELEMETRY_ENABLED', 'true').lower() == 'true'
        self.telemetry_url = os.environ.get('TELEMETRY_URL', 'https://app.billmanager.app/api/telemetry')
        self.instance_file = os.environ.get('TELEMETRY_INSTANCE_ID_FILE', '.instance_id')
        self.send_attempts = self._get_int_config('TELEMETRY_SEND_ATTEMPTS', 3, 1)
        self.retry_base_seconds = self._get_float_config(
            'TELEMETRY_RETRY_BASE_SECONDS', 1.0, 0.0
        )
        self.retry_max_seconds = self._get_float_config(
            'TELEMETRY_RETRY_MAX_SECONDS', 30.0, 0.0
        )
        self.min_send_interval_hours = self._get_float_config(
            'TELEMETRY_MIN_SEND_INTERVAL_HOURS', 20.0, 0.0
        )
        self.local_log_retention_days = self._get_int_config(
            'TELEMETRY_LOCAL_LOG_RETENTION_DAYS', 90, 1
        )

        # Avoid generating an identifier when telemetry is globally disabled.
        self.instance_id = (
            self._get_or_create_instance_id() if self.telemetry_enabled else None
        )

        logger.info("Telemetry initialized - Enabled: %s", self.telemetry_enabled)

    @staticmethod
    def _get_int_config(name: str, default: int, minimum: int) -> int:
        try:
            return max(minimum, int(os.environ.get(name, str(default))))
        except ValueError:
            logger.warning("Ignoring invalid %s; using %s", name, default)
            return default

    @staticmethod
    def _get_float_config(name: str, default: float, minimum: float) -> float:
        try:
            return max(minimum, float(os.environ.get(name, str(default))))
        except ValueError:
            logger.warning("Ignoring invalid %s; using %s", name, default)
            return default

    @staticmethod
    def _is_valid_instance_id(instance_id: Any) -> bool:
        """Return whether a value is a canonical UUID suitable for telemetry."""
        if not isinstance(instance_id, str):
            return False
        try:
            return str(uuid.UUID(instance_id)) == instance_id.lower()
        except (ValueError, AttributeError):
            return False

    def _get_or_create_instance_id(self) -> str:
        """Get existing instance ID or generate new one."""
        configured_id = os.environ.get('TELEMETRY_INSTANCE_ID', '').strip()
        if configured_id:
            if self._is_valid_instance_id(configured_id):
                return configured_id.lower()
            logger.warning("Ignoring invalid TELEMETRY_INSTANCE_ID; expected a UUID")

        # Try to read existing ID
        if os.path.exists(self.instance_file):
            try:
                with open(self.instance_file, 'r', encoding='utf-8') as f:
                    instance_id = f.read().strip()
                    if self._is_valid_instance_id(instance_id):
                        return instance_id.lower()
                    logger.warning("Ignoring invalid telemetry instance ID file")
            except Exception as e:
                logger.warning(f"Failed to read instance ID: {e}")

        # Generate new ID
        instance_id = str(uuid.uuid4())

        # Save for future use
        try:
            with open(self.instance_file, 'w', encoding='utf-8') as f:
                f.write(instance_id)
        except Exception as e:
            logger.warning(f"Failed to save instance ID: {e}")

        return instance_id

    def _restore_instance_id_from_log(self) -> None:
        """Recover a stable instance ID from the persistent telemetry log."""
        if os.environ.get('TELEMETRY_INSTANCE_ID'):
            return

        try:
            from models import TelemetryLog

            previous = TelemetryLog.query.order_by(TelemetryLog.id.desc()).first()
            if previous and self._is_valid_instance_id(previous.instance_id):
                self.instance_id = previous.instance_id.lower()
        except Exception as e:
            # Fresh installs may call this before the telemetry table exists.
            logger.debug(f"Failed to restore telemetry instance ID from database: {e}")

    def collect_metrics(self) -> Dict[str, Any]:
        """Collect all anonymous usage metrics."""
        from config import DEPLOYMENT_MODE
        from services.stripe_service import get_billing_readiness

        try:
            if not self.instance_id:
                self.instance_id = self._get_or_create_instance_id()
            self._restore_instance_id_from_log()

            metrics = {
                "instance_id": self.instance_id,
                "version": self._get_version(),
                "deployment_mode": DEPLOYMENT_MODE,
                "installation_date": self._get_installation_date(),
                "timestamp": datetime.now(timezone.utc).isoformat(),

                # User metrics
                "metrics": {
                    "users": self._get_user_metrics(),
                    "data": self._get_data_metrics(),
                    "features": self._get_feature_metrics(),
                    "engagement": self._get_engagement_metrics(),
                },

                # Platform info
                "platform": self._get_platform_info(),
            }

            # Add subscription metrics only for SaaS deployments
            if get_billing_readiness()["billing_enabled"] and DEPLOYMENT_MODE == 'saas':
                metrics["metrics"]["subscriptions"] = self._get_subscription_metrics()

            # Deployment identifiers are only used to alert the operator about
            # a newly detected SaaS deployment. Self-hosted instances remain
            # limited to the anonymous aggregate payload documented above.
            if DEPLOYMENT_MODE == 'saas':
                metrics["server_url"] = self._get_server_url()
                metrics["server_ip"] = self._get_server_ip()

            return metrics

        except Exception as e:
            logger.error(f"Failed to collect telemetry metrics: {e}", exc_info=True)
            return {}

    def _get_version(self) -> str:
        """Get current BillManager version."""
        try:
            # Read from package.json in web app
            import json
            package_json = os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                '../web/package.json'
            )
            if os.path.exists(package_json):
                with open(package_json, 'r') as f:
                    data = json.load(f)
                    return data.get('version', 'unknown')
        except Exception as e:
            logger.debug(f"Failed to read version from package.json: {e}")

        return 'unknown'

    def _get_installation_date(self) -> Optional[str]:
        """Get installation date from first user creation."""
        from models import User

        try:
            first_user = self.db.session.query(User).order_by(User.created_at).first()
            if first_user and first_user.created_at:
                return first_user.created_at.isoformat()
        except Exception as e:
            logger.debug(f"Failed to get installation date: {e}")

        return None

    def _get_user_metrics(self) -> Dict[str, Any]:
        """Collect user-related metrics."""
        from models import User

        try:
            total_users = self.db.session.query(func.count(User.id)).scalar() or 0
            admin_users = self.db.session.query(func.count(User.id)).filter(User.role == 'admin').scalar() or 0

            thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
            active_30d = self.db.session.query(func.count(User.id)).filter(
                User.last_login_at >= thirty_days_ago
            ).scalar() or 0

            return {
                "total": total_users,
                "admins": admin_users,
                "regular": total_users - admin_users,
                "active_30d": active_30d,
                "account_owners": self.db.session.query(func.count(User.id)).filter(User.created_by_id.is_(None), User.role == 'admin').scalar() or 0,
            }
        except Exception as e:
            logger.error(f"Failed to collect user metrics: {e}")
            return {}

    def _get_data_metrics(self) -> Dict[str, Any]:
        """Collect data volume metrics."""
        from models import Database, Bill, Payment

        try:
            return {
                "databases": self.db.session.query(func.count(Database.id)).scalar() or 0,
                "bills": self.db.session.query(func.count(Bill.id)).scalar() or 0,
                "active_bills": self.db.session.query(func.count(Bill.id)).filter(Bill.archived == False).scalar() or 0,
                "archived_bills": self.db.session.query(func.count(Bill.id)).filter(Bill.archived == True).scalar() or 0,
                "payments": self.db.session.query(func.count(Payment.id)).scalar() or 0,
            }
        except Exception as e:
            logger.error(f"Failed to collect data metrics: {e}")
            return {}

    def _get_feature_metrics(self) -> Dict[str, Any]:
        """Collect feature usage metrics."""
        from models import Bill, UserDevice

        try:
            total_bills = self.db.session.query(func.count(Bill.id)).scalar() or 0

            metrics = {
                "auto_pay_enabled": self.db.session.query(func.count(Bill.id)).filter(Bill.auto_pay == True).scalar() or 0,
                "variable_bills": self.db.session.query(func.count(Bill.id)).filter(Bill.is_variable == True).scalar() or 0,
                "mobile_devices": self.db.session.query(func.count(UserDevice.id)).scalar() or 0,
                "deposits": self.db.session.query(func.count(Bill.id)).filter(Bill.type == 'deposit').scalar() or 0,
                "expenses": self.db.session.query(func.count(Bill.id)).filter(Bill.type == 'expense').scalar() or 0,
            }

            # Calculate percentages
            if total_bills > 0:
                metrics["auto_pay_percentage"] = round((metrics["auto_pay_enabled"] / total_bills) * 100, 1)
                metrics["variable_percentage"] = round((metrics["variable_bills"] / total_bills) * 100, 1)

            # Count unique platforms
            try:
                platforms = self.db.session.query(UserDevice.platform, func.count(UserDevice.id)).group_by(UserDevice.platform).all()
                metrics["mobile_platforms"] = {platform: count for platform, count in platforms}
            except Exception as e:
                logger.debug(f"Failed to get mobile platform metrics: {e}")

            return metrics
        except Exception as e:
            logger.error(f"Failed to collect feature metrics: {e}")
            return {}

    def _get_engagement_metrics(self) -> Dict[str, Any]:
        """Collect engagement metrics."""
        try:
            # Calculate average bills per database
            from models import Database, Bill

            databases_with_bills = self.db.session.query(
                Database.id,
                func.count(Bill.id).label('bill_count')
            ).join(Bill, Database.id == Bill.database_id).group_by(Database.id).all()

            if databases_with_bills:
                avg_bills_per_db = sum(db.bill_count for db in databases_with_bills) / len(databases_with_bills)
            else:
                avg_bills_per_db = 0

            return {
                "avg_bills_per_database": round(avg_bills_per_db, 1),
                "databases_with_bills": len(databases_with_bills),
            }
        except Exception as e:
            logger.error(f"Failed to collect engagement metrics: {e}")
            return {}

    def _get_subscription_metrics(self) -> Dict[str, Any]:
        """Collect subscription-related metrics (SaaS only)."""
        from models import Subscription

        try:
            total_subscriptions = self.db.session.query(func.count(Subscription.id)).scalar() or 0

            # Count by tier
            tier_counts = self.db.session.query(
                Subscription.tier,
                func.count(Subscription.id)
            ).group_by(Subscription.tier).all()

            # Count by status
            status_counts = self.db.session.query(
                Subscription.status,
                func.count(Subscription.id)
            ).group_by(Subscription.status).all()

            # Count by billing interval
            interval_counts = self.db.session.query(
                Subscription.billing_interval,
                func.count(Subscription.id)
            ).group_by(Subscription.billing_interval).all()

            return {
                "total": total_subscriptions,
                "by_tier": {tier: count for tier, count in tier_counts},
                "by_status": {status: count for status, count in status_counts},
                "by_interval": {interval: count for interval, count in interval_counts},
            }
        except Exception as e:
            logger.error(f"Failed to collect subscription metrics: {e}")
            return {}

    def _get_platform_info(self) -> Dict[str, Any]:
        """Collect platform/environment information."""
        import sys

        try:
            # Get database version
            db_version = "unknown"
            try:
                result = self.db.session.execute(text("SELECT version()")).fetchone()
                if result:
                    db_version = result[0].split(',')[0]  # e.g., "PostgreSQL 15.2"
            except Exception as e:
                logger.debug(f"Failed to get database version: {e}")

            return {
                "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
                "os": platform.system(),
                "os_release": platform.release(),
                "architecture": platform.machine(),
                "database": db_version,
                "deployment": os.environ.get('DEPLOYMENT_METHOD', 'unknown'),  # docker, bare-metal, k8s, etc.
            }
        except Exception as e:
            logger.error(f"Failed to collect platform info: {e}")
            return {}

    def _get_server_url(self) -> Optional[str]:
        """Get the server URL from APP_URL environment variable."""
        return os.environ.get('APP_URL', None)

    def _get_server_ip(self) -> Optional[str]:
        """Get the server's external IP address."""
        try:
            # Try to get external IP from ipify.org
            response = requests.get('https://api.ipify.org?format=text', timeout=5)
            if response.status_code == 200:
                return response.text.strip()
        except Exception as e:
            logger.debug(f"Failed to get external IP: {e}")

        return None

    def _is_opted_out(self) -> bool:
        """Check if any account owner has opted out of telemetry."""
        from models import TelemetrySettings, User

        try:
            settings = self.db.session.get(TelemetrySettings, 1)
            if settings:
                # Pending consent fails closed until an owner explicitly enables it.
                return settings.state != 'enabled'

            # Conservative compatibility fallback for an upgrade where the
            # settings migration has not yet completed.
            owners = self.db.session.query(User).filter(
                User.role == 'admin',
                User.created_by_id.is_(None),
            ).all()
            if any(owner.telemetry_opt_out is True for owner in owners):
                return True
            return not any(
                owner.telemetry_notice_shown_at
                and owner.telemetry_opt_out is not True
                for owner in owners
            )
        except Exception as e:
            logger.error(f"Failed to check telemetry opt-out status: {e}")
            # If we can't check, err on the side of privacy - don't send
            return True

    def _sent_recently(self) -> bool:
        """Avoid duplicate startup/daily sends across workers and restarts."""
        if not self.db or self.min_send_interval_hours <= 0:
            return False

        try:
            from models import TelemetryLog

            cutoff = datetime.now(timezone.utc) - timedelta(
                hours=self.min_send_interval_hours
            )
            return TelemetryLog.query.filter(
                TelemetryLog.send_successful.is_(True),
                TelemetryLog.last_sent_at >= cutoff,
            ).first() is not None
        except Exception as e:
            # A missing table on a new install should not permanently disable
            # telemetry. The receiver also deduplicates retried payloads.
            logger.debug("Failed to check recent telemetry submissions: %s", e)
            return False

    def _retry_delay(self, failed_attempt: int) -> float:
        base_delay = self.retry_base_seconds * (2 ** (failed_attempt - 1))
        bounded_delay = min(self.retry_max_seconds, base_delay)
        jitter = _jitter_random.uniform(0, min(bounded_delay * 0.25, 1.0))
        return bounded_delay + jitter

    def send_telemetry(
        self,
        metrics: Optional[Dict[str, Any]] = None,
        force: bool = False,
    ) -> bool:
        """
        Send telemetry data to collection endpoint.

        Returns:
            bool: True if sent successfully, False otherwise
        """
        if not self.telemetry_enabled:
            logger.debug("Telemetry disabled via TELEMETRY_ENABLED, skipping send")
            return False

        # Check if account owner has opted out
        if self._is_opted_out():
            logger.debug("Telemetry disabled by user opt-out, skipping send")
            return False

        if not self.telemetry_url:
            logger.warning("No telemetry URL configured, skipping send")
            return False

        if not force and self._sent_recently():
            logger.debug("Telemetry was sent recently, skipping duplicate send")
            return False

        if metrics is None:
            metrics = self.collect_metrics()

        if not metrics:
            logger.warning("No metrics collected, skipping send")
            return False

        success = False
        error_msg = None

        logger.info("Sending telemetry to %s", self.telemetry_url)
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': f'BillManager/{metrics.get("version", "unknown")}',
        }
        api_key = os.environ.get('TELEMETRY_API_KEY')
        if api_key:
            headers['X-Telemetry-Api-Key'] = api_key

        for attempt in range(1, self.send_attempts + 1):
            retryable = False
            try:
                response = requests.post(
                    self.telemetry_url,
                    json=metrics,
                    timeout=10,
                    headers=headers
                )

                if response.status_code == 200:
                    logger.info("Telemetry sent successfully")
                    success = True
                    error_msg = None
                    break

                response_text = str(response.text)[:500]
                error_msg = f"HTTP {response.status_code}: {response_text}"
                retryable = response.status_code in RETRYABLE_STATUS_CODES
                logger.warning(
                    "Telemetry send failed with status %s: %s",
                    response.status_code,
                    response_text,
                )
            except requests.exceptions.Timeout:
                error_msg = "Request timed out"
                retryable = True
                logger.warning("Telemetry send timed out")
            except requests.exceptions.RequestException as e:
                error_msg = str(e)[:500]
                retryable = True
                logger.warning("Failed to send telemetry: %s", e)
            except Exception as e:
                error_msg = str(e)[:500]
                logger.error("Unexpected error sending telemetry: %s", e, exc_info=True)

            if not retryable or attempt >= self.send_attempts:
                break

            delay = self._retry_delay(attempt)
            logger.info(
                "Retrying telemetry send in %.2f seconds (attempt %s/%s)",
                delay,
                attempt + 1,
                self.send_attempts,
            )
            time.sleep(delay)

        # Log the submission to database
        self._log_submission(metrics, success, error_msg)

        return success

    def _log_submission(self, metrics: Dict[str, Any], success: bool, error_msg: Optional[str] = None):
        """Log telemetry submission to local database."""
        from models import TelemetryLog

        try:
            import json

            log_entry = TelemetryLog(
                instance_id=self.instance_id,
                version=metrics.get('version'),
                deployment_mode=metrics.get('deployment_mode'),
                last_sent_at=datetime.now(timezone.utc),
                metrics_snapshot=json.dumps(metrics),
                send_successful=success,
                error_message=error_msg
            )

            self.db.session.add(log_entry)
            self.db.session.commit()
            self._cleanup_local_logs()

        except Exception as e:
            logger.error(f"Failed to log telemetry submission: {e}", exc_info=True)
            # Don't re-raise - telemetry logging failures shouldn't break the app
            try:
                self.db.session.rollback()
            except Exception as e:
                logger.debug(f"Failed to rollback telemetry transaction: {e}")

    def _cleanup_local_logs(self) -> None:
        """Bound local telemetry history while retaining ID recovery data."""
        now = datetime.now(timezone.utc)
        if (
            self._last_log_cleanup_at
            and now - self._last_log_cleanup_at < timedelta(days=1)
        ):
            return

        from models import TelemetryLog

        try:
            latest = TelemetryLog.query.order_by(TelemetryLog.id.desc()).first()
            if not latest:
                self._last_log_cleanup_at = now
                return

            cutoff = now - timedelta(days=self.local_log_retention_days)
            TelemetryLog.query.filter(
                TelemetryLog.last_sent_at < cutoff,
                TelemetryLog.id != latest.id,
            ).delete(synchronize_session=False)
            self.db.session.commit()
            self._last_log_cleanup_at = now
        except Exception as e:
            logger.debug("Failed to clean up old telemetry logs: %s", e)
            try:
                self.db.session.rollback()
            except Exception as rollback_error:
                logger.debug(
                    "Failed to roll back telemetry cleanup: %s", rollback_error
                )


# Global instance
telemetry = TelemetryCollector()
