"""
Provider-neutral outbound email service for transactional emails.
"""
import logging
import os
import smtplib
from html import escape
from email.message import EmailMessage

from services.email_config import get_email_config

logger = logging.getLogger(__name__)

# Try to import resend, but allow app to run without it during development
try:
    import resend
    RESEND_AVAILABLE = True
except ImportError:
    RESEND_AVAILABLE = False
    logger.warning("Resend not installed. Resend email provider disabled.")

# Configuration from environment
EMAIL_CONFIG = get_email_config(os.environ)
EMAIL_PROVIDER = EMAIL_CONFIG.provider
RESEND_API_KEY = EMAIL_CONFIG.resend_api_key
FROM_EMAIL = EMAIL_CONFIG.from_email
APP_URL = EMAIL_CONFIG.app_url


def init_resend():
    """Initialize Resend with API key"""
    if RESEND_AVAILABLE and EMAIL_CONFIG.provider == "resend" and RESEND_API_KEY:
        resend.api_key = RESEND_API_KEY
        return True
    return False


def send_email(to: str, subject: str, html: str) -> bool:
    """
    Send an email using the configured outbound email provider.

    Returns True if sent successfully, False otherwise.
    """
    if EMAIL_CONFIG.provider == "resend":
        return _send_resend_email(to, subject, html)
    if EMAIL_CONFIG.provider == "smtp":
        return _send_smtp_email(to, subject, html)

    logger.warning(f"Email not sent (email provider disabled): {subject} to {to}")
    return False


def _send_resend_email(to: str, subject: str, html: str) -> bool:
    """Send an email using Resend."""
    if not RESEND_AVAILABLE:
        logger.warning(f"Email not sent (Resend not available): {subject} to {to}")
        return False

    if not EMAIL_CONFIG.resend_api_key:
        logger.warning(f"Email not sent (Resend API key missing): {subject} to {to}")
        return False

    try:
        resend.api_key = EMAIL_CONFIG.resend_api_key
        params = {
            "from": EMAIL_CONFIG.from_email,
            "to": [to],
            "subject": subject,
            "html": html,
        }
        response = resend.Emails.send(params)
        email_id = response.get("id") if isinstance(response, dict) else None
        logger.info(
            f"Email sent successfully via Resend: {subject} to {to}, id={email_id}"
        )
        return True
    except Exception as e:
        logger.error(f"Failed to send email via Resend: {subject} to {to}, error={e}")
        return False


def _send_smtp_email(to: str, subject: str, html: str) -> bool:
    """Send an email using SMTP."""
    smtp_config = EMAIL_CONFIG.smtp
    if not smtp_config.is_configured:
        logger.warning(
            f"Email not sent (SMTP is not fully configured): {subject} to {to}"
        )
        return False

    message = EmailMessage()
    message["From"] = EMAIL_CONFIG.from_email
    message["To"] = to
    message["Subject"] = subject
    message.set_content("This email requires an HTML-capable email client.")
    message.add_alternative(html, subtype="html")

    smtp_client = smtplib.SMTP_SSL if smtp_config.use_ssl else smtplib.SMTP
    try:
        with smtp_client(
            smtp_config.host, smtp_config.port, timeout=smtp_config.timeout
        ) as server:
            if smtp_config.use_tls and not smtp_config.use_ssl:
                server.starttls()
            if smtp_config.has_auth:
                server.login(smtp_config.username, smtp_config.password)
            server.send_message(message)
        logger.info(f"Email sent successfully via SMTP: {subject} to {to}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email via SMTP: {subject} to {to}, error={e}")
        return False


def get_email_template(content: str, title: str = "BillManager") -> str:
    """Generate consistent email template with BillManager branding"""
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f1f5f9; }}
            .wrapper {{ padding: 40px 20px; }}
            .container {{ max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }}
            .header {{ background: #059669; color: white; padding: 30px 20px; text-align: center; }}
            .logo {{ width: 60px; height: 60px; margin-bottom: 15px; }}
            .header h1 {{ margin: 0; font-size: 24px; font-weight: 600; }}
            .content {{ padding: 40px 30px; }}
            .button {{ display: inline-block; background: #059669; color: white !important; padding: 14px 32px; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: 600; }}
            .button:hover {{ background: #047857; }}
            .link {{ color: #059669; word-break: break-all; }}
            .warning {{ background: #fef3c7; border: 1px solid #f59e0b; padding: 12px 16px; border-radius: 6px; margin: 15px 0; }}
            .feature {{ background: #f0fdf4; padding: 16px; border-radius: 8px; margin: 12px 0; border-left: 4px solid #059669; }}
            .footer {{ text-align: center; padding: 20px; color: #64748b; font-size: 12px; border-top: 1px solid #e2e8f0; }}
            .footer a {{ color: #059669; text-decoration: none; }}
        </style>
    </head>
    <body>
        <div class="wrapper">
            <div class="container">
                <div class="header">
                    <img src="https://billmanager.app/logo.svg" alt="BillManager" class="logo" />
                    <h1>{title}</h1>
                </div>
                <div class="content">
                    {content}
                </div>
                <div class="footer">
                    <p>&copy; 2025 BillManager. All rights reserved.</p>
                    <p><a href="https://billmanager.app">billmanager.app</a></p>
                </div>
            </div>
        </div>
    </body>
    </html>
    """


def send_verification_email(email: str, token: str, username: str) -> bool:
    """Send email verification link to new user"""
    verification_url = f"{APP_URL}/verify-email?token={token}"

    content = f"""
        <p>Hi {username},</p>
        <p>Thanks for signing up for BillManager! Please verify your email address to get started.</p>
        <p style="text-align: center;">
            <a href="{verification_url}" class="button">Verify Email Address</a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p class="link">{verification_url}</p>
        <p>This link will expire in 24 hours.</p>
        <p style="color: #64748b;">If you didn't create an account, you can safely ignore this email.</p>
    """

    html = get_email_template(content, "Welcome to BillManager!")
    return send_email(email, "Verify your BillManager account", html)


def send_password_reset_email(email: str, token: str, username: str) -> bool:
    """Send password reset link"""
    reset_url = f"{APP_URL}/reset-password?token={token}"

    content = f"""
        <p>Hi {username},</p>
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        <p style="text-align: center;">
            <a href="{reset_url}" class="button">Reset Password</a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p class="link">{reset_url}</p>
        <div class="warning">
            <strong>⏰ This link will expire in 1 hour.</strong>
        </div>
        <p style="color: #64748b;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
    """

    html = get_email_template(content, "Password Reset")
    return send_email(email, "Reset your BillManager password", html)


def send_invite_email(email: str, token: str, invited_by: str) -> bool:
    """Send invitation email to new user"""
    invite_url = f"{APP_URL}/accept-invite?token={token}"

    content = f"""
        <p>Hi there!</p>
        <p><strong>{invited_by}</strong> has invited you to join their BillManager account.</p>
        <p>BillManager helps you track recurring bills, income, and never miss a payment.</p>
        <p style="text-align: center;">
            <a href="{invite_url}" class="button">Accept Invitation</a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p class="link">{invite_url}</p>
        <div class="warning">
            <strong>⏰ This invitation will expire in 7 days.</strong>
        </div>
        <p style="color: #64748b;">If you weren't expecting this invitation, you can safely ignore this email.</p>
    """

    html = get_email_template(content, "You're Invited!")
    return send_email(email, f"{invited_by} invited you to BillManager", html)


def send_welcome_email(email: str, username: str) -> bool:
    """Send welcome email after email verification"""
    login_url = f"{APP_URL}/login"

    content = f"""
        <p>Hi {username},</p>
        <p>Your email has been verified and your BillManager account is ready to use!</p>

        <p><strong>Here's what you can do:</strong></p>

        <div class="feature">
            <strong>📋 Track Bills & Income</strong><br>
            Add all your recurring expenses and deposits in one place.
        </div>

        <div class="feature">
            <strong>📅 Never Miss a Due Date</strong><br>
            See upcoming bills on your calendar and get reminders.
        </div>

        <div class="feature">
            <strong>📊 Forecast Your Finances</strong><br>
            Know exactly where your money is going each month.
        </div>

        <p style="text-align: center;">
            <a href="{login_url}" class="button">Start Using BillManager</a>
        </p>

        <p>Your 14-day free trial has started. Enjoy full access to all features!</p>
    """

    html = get_email_template(content, "You're All Set!")
    return send_email(email, "Welcome to BillManager!", html)


def send_2fa_code_email(email: str, code: str, username: str) -> bool:
    """Send a 2FA verification code via email"""
    content = f"""
        <p>Hi {username},</p>
        <p>Your BillManager verification code is:</p>
        <div style="text-align: center; margin: 30px 0;">
            <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #059669; background: #f0fdf4; padding: 16px 32px; border-radius: 8px; display: inline-block;">{code}</span>
        </div>
        <p>This code will expire in <strong>10 minutes</strong>.</p>
        <div class="warning">
            <strong>If you didn't request this code, someone may be trying to access your account.</strong>
            Please change your password immediately.
        </div>
    """

    html = get_email_template(content, "Verification Code")
    return send_email(email, f"Your BillManager verification code: {code}", html)


def send_bill_share_email(email: str, token: str, bill_name: str, shared_by: str) -> bool:
    """Send bill share invitation email"""
    share_url = f"{APP_URL}/share/accept?token={token}"

    safe_bill_name = escape(bill_name, quote=True)
    safe_shared_by = escape(shared_by, quote=True)
    safe_share_url = escape(share_url, quote=True)
    content = f"""
        <p>Hi there!</p>
        <p><strong>{safe_shared_by}</strong> wants to share a bill with you on BillManager.</p>

        <div class="feature">
            <strong>Bill: {safe_bill_name}</strong><br>
            You'll be able to see when this bill is paid and track it alongside your own bills.
        </div>

        <p>This feature helps roommates and partners keep track of shared expenses together.</p>

        <p style="text-align: center;">
            <a href="{safe_share_url}" class="button">View Shared Bill</a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p class="link">{safe_share_url}</p>

        <div class="warning">
            <strong>⏰ This invitation will expire in 7 days.</strong>
        </div>

        <p style="color: #64748b;">If you don't have a BillManager account, you'll be able to create one when you accept this invitation.</p>
        <p style="color: #64748b;">If you weren't expecting this invitation, you can safely ignore this email.</p>
    """

    html = get_email_template(content, "Shared Bill Invitation")
    return send_email(email, f"{shared_by} shared a bill with you on BillManager", html)
