"""
Push Notification Service for BillManager.

Supports Firebase Cloud Messaging (FCM) for both iOS and Android.
FCM is the recommended approach as it works for both platforms.

Setup:
1. Create a Firebase project at https://console.firebase.google.com
2. Enable Cloud Messaging
3. Get your Server Key from Project Settings > Cloud Messaging
4. Set FCM_SERVER_KEY environment variable

Usage:
    from services.push_notifications import send_push_notification, send_bill_reminder

    # Send to single device
    send_push_notification(push_token, "Title", "Body")

    # Send bill reminder
    send_bill_reminder(user_id, bill_name, due_date, amount)
"""

import os
import json
import logging
import requests
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

# Firebase Cloud Messaging configuration
FCM_SERVER_KEY = os.environ.get('FCM_SERVER_KEY')
FCM_API_URL = 'https://fcm.googleapis.com/fcm/send'

# Notification types
class NotificationType:
    BILL_REMINDER = 'bill_reminder'
    PAYMENT_CONFIRMED = 'payment_confirmed'
    ACCOUNT_ACTIVITY = 'account_activity'
    SECURITY_ALERT = 'security_alert'


def is_push_enabled() -> bool:
    """Check if push notifications are configured."""
    return bool(FCM_SERVER_KEY)


def send_push_notification(
    push_token: str,
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
    notification_type: str = None,
    badge: int = None,
    sound: str = 'default'
) -> bool:
    """
    Send a push notification to a single device via FCM.

    Args:
        push_token: FCM device token
        title: Notification title
        body: Notification body text
        data: Optional data payload (delivered to app)
        notification_type: Type of notification for client handling
        badge: iOS badge number
        sound: Notification sound ('default' or custom)

    Returns:
        True if sent successfully, False otherwise
    """
    if not FCM_SERVER_KEY:
        logger.warning("FCM_SERVER_KEY not configured, skipping push notification")
        return False

    if not push_token:
        logger.warning("No push token provided")
        return False

    headers = {
        'Authorization': f'key={FCM_SERVER_KEY}',
        'Content-Type': 'application/json'
    }

    # Build notification payload
    payload = {
        'to': push_token,
        'notification': {
            'title': title,
            'body': body,
            'sound': sound
        },
        'data': data or {}
    }

    # Add notification type to data for client handling
    if notification_type:
        payload['data']['type'] = notification_type

    # iOS-specific options
    if badge is not None:
        payload['notification']['badge'] = badge

    # Android-specific options
    payload['android'] = {
        'priority': 'high',
        'notification': {
            'click_action': 'OPEN_APP'
        }
    }

    try:
        response = requests.post(FCM_API_URL, headers=headers, json=payload, timeout=10)
        response.raise_for_status()

        result = response.json()
        if result.get('success', 0) > 0:
            logger.info(f"Push notification sent successfully to {push_token[:20]}...")
            return True
        else:
            logger.error(f"FCM returned failure: {result}")
            return False

    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to send push notification: {e}")
        return False


def send_push_to_user(
    user_id: int,
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
    notification_type: str = None
) -> int:
    """
    Send push notification to all devices registered for a user.

    Args:
        user_id: User ID to send to
        title: Notification title
        body: Notification body
        data: Optional data payload
        notification_type: Type for client handling

    Returns:
        Number of devices successfully notified
    """
    # Import here to avoid circular imports
    from models import UserDevice

    devices = UserDevice.query.filter_by(user_id=user_id).filter(
        UserDevice.push_token.isnot(None)
    ).all()

    if not devices:
        logger.info(f"No devices with push tokens for user {user_id}")
        return 0

    success_count = 0
    for device in devices:
        # Check notification settings
        settings = json.loads(device.notification_settings or '{}')
        if notification_type and not settings.get(notification_type, True):
            # User has disabled this notification type
            continue

        if send_push_notification(
            device.push_token,
            title,
            body,
            data,
            notification_type
        ):
            success_count += 1

    return success_count


def send_bill_reminder(
    user_id: int,
    bill_id: int,
    bill_name: str,
    due_date: str,
    amount: Optional[float] = None,
    days_until_due: int = 0
) -> int:
    """
    Send a bill reminder notification to a user.

    Args:
        user_id: User to notify
        bill_id: Bill ID for deep linking
        bill_name: Name of the bill
        due_date: Due date string (YYYY-MM-DD)
        amount: Bill amount (optional for variable bills)
        days_until_due: Days until bill is due

    Returns:
        Number of devices notified
    """
    if days_until_due == 0:
        title = f"Bill Due Today: {bill_name}"
        body = f"{bill_name} is due today"
    elif days_until_due == 1:
        title = f"Bill Due Tomorrow: {bill_name}"
        body = f"{bill_name} is due tomorrow"
    elif days_until_due < 0:
        title = f"Overdue Bill: {bill_name}"
        body = f"{bill_name} was due {abs(days_until_due)} day(s) ago"
    else:
        title = f"Upcoming Bill: {bill_name}"
        body = f"{bill_name} is due in {days_until_due} days"

    if amount:
        body += f" (${amount:.2f})"

    data = {
        'bill_id': str(bill_id),
        'due_date': due_date,
        'action': 'view_bill'
    }

    return send_push_to_user(
        user_id,
        title,
        body,
        data,
        NotificationType.BILL_REMINDER
    )


def send_payment_confirmation(
    user_id: int,
    bill_id: int,
    bill_name: str,
    amount: float,
    payment_date: str
) -> int:
    """
    Send a payment confirmation notification.

    Args:
        user_id: User to notify
        bill_id: Bill ID
        bill_name: Name of the bill
        amount: Payment amount
        payment_date: Date of payment

    Returns:
        Number of devices notified
    """
    title = "Payment Recorded"
    body = f"${amount:.2f} payment for {bill_name} recorded"

    data = {
        'bill_id': str(bill_id),
        'payment_date': payment_date,
        'action': 'view_payment'
    }

    return send_push_to_user(
        user_id,
        title,
        body,
        data,
        NotificationType.PAYMENT_CONFIRMED
    )


def send_account_activity_alert(
    user_id: int,
    activity_type: str,
    description: str,
    actor_name: Optional[str] = None
) -> int:
    """
    Send an account activity notification (for shared accounts).

    Args:
        user_id: User to notify
        activity_type: Type of activity (bill_created, payment_recorded, etc.)
        description: Human-readable description
        actor_name: Name of user who performed the action

    Returns:
        Number of devices notified
    """
    title = "Account Activity"
    body = description
    if actor_name:
        body = f"{actor_name}: {description}"

    data = {
        'activity_type': activity_type,
        'action': 'view_activity'
    }

    return send_push_to_user(
        user_id,
        title,
        body,
        data,
        NotificationType.ACCOUNT_ACTIVITY
    )


def send_security_alert(
    user_id: int,
    alert_type: str,
    description: str,
    device_info: Optional[str] = None
) -> int:
    """
    Send a security alert notification.

    Args:
        user_id: User to notify
        alert_type: Type of alert (new_login, password_changed, etc.)
        description: Human-readable description
        device_info: Device that triggered the alert

    Returns:
        Number of devices notified
    """
    title = "Security Alert"
    body = description

    data = {
        'alert_type': alert_type,
        'device_info': device_info,
        'action': 'view_security'
    }

    return send_push_to_user(
        user_id,
        title,
        body,
        data,
        NotificationType.SECURITY_ALERT
    )


def process_bill_reminders(days_ahead: List[int] = None) -> Dict[str, int]:
    """
    Process and send bill reminders for bills due soon.

    This should be called by a scheduled job (cron, celery, etc.)

    Args:
        days_ahead: List of days to check (default: [0, 1, 3, 7])

    Returns:
        Dict with counts of notifications sent
    """
    if days_ahead is None:
        days_ahead = [0, 1, 3, 7]  # Today, tomorrow, 3 days, 1 week

    # Import here to avoid circular imports
    from models import Bill, Database, db
    from sqlalchemy import func

    today = datetime.now(timezone.utc).date()
    stats = {'total_bills': 0, 'notifications_sent': 0}

    for days in days_ahead:
        target_date = (today + timedelta(days=days)).strftime('%Y-%m-%d')

        # Find all non-archived bills due on target date
        bills = Bill.query.filter(
            Bill.archived == False,
            Bill.due_date == target_date
        ).all()

        for bill in bills:
            stats['total_bills'] += 1

            # Get database owner to notify
            database = db.session.get(Database, bill.database_id)
            if not database or not database.owner_id:
                continue

            sent = send_bill_reminder(
                user_id=database.owner_id,
                bill_id=bill.id,
                bill_name=bill.name,
                due_date=bill.due_date,
                amount=bill.amount,
                days_until_due=days
            )
            stats['notifications_sent'] += sent

    logger.info(f"Bill reminder processing complete: {stats}")
    return stats
