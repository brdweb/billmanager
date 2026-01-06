"""
Background task scheduler for BillManager.

Handles periodic tasks like:
- Telemetry collection and sending
- Future: Auto-payment processing, reminders, etc.
"""

import logging
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)


class TaskScheduler:
    """Background task scheduler using APScheduler."""

    def __init__(self, app=None):
        self.app = app
        self.scheduler = BackgroundScheduler()
        self.started = False

        if app:
            self.init_app(app)

    def init_app(self, app):
        """Initialize scheduler with Flask app."""
        self.app = app

    def start(self):
        """Start the background scheduler."""
        if self.started:
            logger.warning("Scheduler already started")
            return

        logger.info("Starting background task scheduler")

        # Schedule telemetry collection (daily at 2 AM UTC)
        self.scheduler.add_job(
            func=self._send_telemetry,
            trigger=CronTrigger(hour=2, minute=0),
            id='telemetry_daily',
            name='Send daily telemetry',
            replace_existing=True
        )

        # Run telemetry on startup (with 5 minute delay)
        self.scheduler.add_job(
            func=self._send_telemetry,
            trigger='date',
            run_date=datetime.now().replace(microsecond=0),
            id='telemetry_startup',
            name='Send telemetry on startup'
        )

        self.scheduler.start()
        self.started = True
        logger.info("Background scheduler started")

    def stop(self):
        """Stop the background scheduler."""
        if not self.started:
            return

        logger.info("Stopping background task scheduler")
        self.scheduler.shutdown()
        self.started = False

    def _send_telemetry(self):
        """Send telemetry data (runs in background thread)."""
        from services.telemetry import telemetry

        # Use app context for database access
        with self.app.app_context():
            try:
                logger.info("Running scheduled telemetry collection")
                metrics = telemetry.collect_metrics()

                if metrics:
                    success = telemetry.send_telemetry(metrics)
                    if success:
                        logger.info("Telemetry sent successfully")
                    else:
                        logger.warning("Telemetry send failed")
                else:
                    logger.warning("No telemetry metrics collected")

            except Exception as e:
                logger.error(f"Failed to send scheduled telemetry: {e}", exc_info=True)


# Global instance
scheduler = TaskScheduler()
