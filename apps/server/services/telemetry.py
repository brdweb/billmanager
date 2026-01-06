"""
Anonymous telemetry collection for BillManager.

Collects anonymous usage statistics to help improve the product.
- Optional for self-hosted users (TELEMETRY_ENABLED=false to disable)
- Alerts maintainer when new SaaS deployments are detected
- Never collects PII (usernames, emails, bill amounts, etc.)
"""

import os
import uuid
import platform
import logging
import requests
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional
from sqlalchemy import func

logger = logging.getLogger(__name__)


class TelemetryCollector:
    """Collects and sends anonymous usage statistics."""

    def __init__(self, app=None, db=None):
        self.app = app
        self.db = db
        self.instance_id = None
        self.telemetry_enabled = True
        self.telemetry_url = None

        if app:
            self.init_app(app, db)

    def init_app(self, app, db):
        """Initialize telemetry with Flask app."""
        self.app = app
        self.db = db

        # Get configuration
        self.telemetry_enabled = os.environ.get('TELEMETRY_ENABLED', 'true').lower() == 'true'
        self.telemetry_url = os.environ.get('TELEMETRY_URL', 'https://app.billmanager.app/api/telemetry')

        # Load or generate instance ID
        self.instance_id = self._get_or_create_instance_id()

        logger.info(f"Telemetry initialized - Enabled: {self.telemetry_enabled}, Instance ID: {self.instance_id}")

    def _get_or_create_instance_id(self) -> str:
        """Get existing instance ID or generate new one."""
        instance_file = '.instance_id'

        # Try to read existing ID
        if os.path.exists(instance_file):
            try:
                with open(instance_file, 'r') as f:
                    instance_id = f.read().strip()
                    if instance_id:
                        return instance_id
            except Exception as e:
                logger.warning(f"Failed to read instance ID: {e}")

        # Generate new ID
        instance_id = str(uuid.uuid4())

        # Save for future use
        try:
            with open(instance_file, 'w') as f:
                f.write(instance_id)
        except Exception as e:
            logger.warning(f"Failed to save instance ID: {e}")

        return instance_id

    def collect_metrics(self) -> Dict[str, Any]:
        """Collect all anonymous usage metrics."""
        from models import User, Database, Bill, Payment, UserDevice, Subscription
        from config import DEPLOYMENT_MODE, ENABLE_BILLING

        try:
            # Import inside function to avoid circular imports
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
            if ENABLE_BILLING and DEPLOYMENT_MODE == 'saas':
                metrics["metrics"]["subscriptions"] = self._get_subscription_metrics()

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
        except Exception:
            pass

        return 'unknown'

    def _get_installation_date(self) -> Optional[str]:
        """Get installation date from first user creation."""
        from models import User

        try:
            first_user = self.db.session.query(User).order_by(User.created_at).first()
            if first_user and first_user.created_at:
                return first_user.created_at.isoformat()
        except Exception:
            pass

        return None

    def _get_user_metrics(self) -> Dict[str, Any]:
        """Collect user-related metrics."""
        from models import User

        try:
            total_users = self.db.session.query(func.count(User.id)).scalar() or 0
            admin_users = self.db.session.query(func.count(User.id)).filter(User.role == 'admin').scalar() or 0

            # Active users (logged in within 30 days)
            thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
            # Note: We don't track last_login, so this will be 0 for now
            active_30d = 0

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
            except Exception:
                pass

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
                result = self.db.session.execute("SELECT version()").fetchone()
                if result:
                    db_version = result[0].split(',')[0]  # e.g., "PostgreSQL 15.2"
            except Exception:
                pass

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

    def send_telemetry(self, metrics: Optional[Dict[str, Any]] = None) -> bool:
        """
        Send telemetry data to collection endpoint.

        Returns:
            bool: True if sent successfully, False otherwise
        """
        if not self.telemetry_enabled:
            logger.debug("Telemetry disabled, skipping send")
            return False

        if not self.telemetry_url:
            logger.warning("No telemetry URL configured, skipping send")
            return False

        if metrics is None:
            metrics = self.collect_metrics()

        if not metrics:
            logger.warning("No metrics collected, skipping send")
            return False

        success = False
        error_msg = None

        try:
            logger.info(f"Sending telemetry to {self.telemetry_url}")

            response = requests.post(
                self.telemetry_url,
                json=metrics,
                timeout=10,
                headers={
                    'Content-Type': 'application/json',
                    'User-Agent': f'BillManager/{metrics.get("version", "unknown")}',
                }
            )

            if response.status_code == 200:
                logger.info("Telemetry sent successfully")
                success = True
            else:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                logger.warning(f"Telemetry send failed with status {response.status_code}: {response.text}")

        except requests.exceptions.Timeout:
            error_msg = "Request timed out"
            logger.warning("Telemetry send timed out")
        except requests.exceptions.RequestException as e:
            error_msg = str(e)
            logger.warning(f"Failed to send telemetry: {e}")
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Unexpected error sending telemetry: {e}", exc_info=True)

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

        except Exception as e:
            logger.error(f"Failed to log telemetry submission: {e}", exc_info=True)
            # Don't re-raise - telemetry logging failures shouldn't break the app
            try:
                self.db.session.rollback()
            except Exception:
                pass


# Global instance
telemetry = TelemetryCollector()
