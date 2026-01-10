from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()

# Association table for User-Database access (Tenancy)
user_database_access = db.Table('user_database_access',
    db.Column('user_id', db.Integer, db.ForeignKey('users.id'), primary_key=True),
    db.Column('database_id', db.Integer, db.ForeignKey('databases.id'), primary_key=True)
)

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(20), default='user')
    password_change_required = db.Column(db.Boolean, default=False)
    change_token = db.Column(db.String(64), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    # SaaS multi-tenancy: track which admin created this user (null for self-registered admins)
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # Email and verification (for SaaS registration)
    email = db.Column(db.String(255), unique=True, nullable=True)
    email_verified_at = db.Column(db.DateTime, nullable=True)
    email_verification_token = db.Column(db.String(64), nullable=True)
    email_verification_expires = db.Column(db.DateTime, nullable=True)

    # Password reset
    password_reset_token = db.Column(db.String(64), nullable=True)
    password_reset_expires = db.Column(db.DateTime, nullable=True)

    # Trial tracking
    trial_ends_at = db.Column(db.DateTime, nullable=True)

    # Telemetry consent (for existing users opt-out notification)
    telemetry_notice_shown_at = db.Column(db.DateTime, nullable=True)
    telemetry_opt_out = db.Column(db.Boolean, default=False)

    # Relationships
    accessible_databases = db.relationship('Database', secondary=user_database_access, backref='users')
    created_by = db.relationship('User', remote_side='User.id', foreign_keys=[created_by_id], backref='created_users')

    @property
    def is_account_owner(self):
        """Check if this user is an account owner (self-registered admin, not a sub-user)"""
        return self.role == 'admin' and self.created_by_id is None

    @property
    def account_owner(self):
        """Get the account owner for this user (self if admin, or the admin who created them)"""
        if self.is_account_owner:
            return self
        if self.created_by_id:
            return db.session.get(User, self.created_by_id)
        return None

    def set_password(self, password):
        """Hash password using werkzeug's secure method (pbkdf2:sha256)."""
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        """
        Verify password. Supports both:
        - New bcrypt/pbkdf2 hashes (werkzeug format)
        - Legacy SHA-256 hashes (for migration)
        """
        # Check if this is a legacy SHA-256 hash (64 hex chars, no prefix)
        if len(self.password_hash) == 64 and not self.password_hash.startswith(('pbkdf2:', 'scrypt:')):
            # Legacy SHA-256 verification - intentionally kept for migration
            # lgtm[py/weak-sensitive-data-hashing] - This is migration code for old passwords
            if self.password_hash == hashlib.sha256(password.encode()).hexdigest():  # nosec B324
                # Auto-migrate to secure hash on successful login
                self.set_password(password)
                return True
            return False
        # Modern werkzeug hash verification
        return check_password_hash(self.password_hash, password)

    def generate_email_verification_token(self):
        """Generate a secure token for email verification (24 hour expiry)"""
        self.email_verification_token = secrets.token_urlsafe(32)
        self.email_verification_expires = datetime.now(timezone.utc) + timedelta(hours=24)
        return self.email_verification_token

    def generate_password_reset_token(self):
        """Generate a secure token for password reset (1 hour expiry)"""
        self.password_reset_token = secrets.token_urlsafe(32)
        self.password_reset_expires = datetime.now(timezone.utc) + timedelta(hours=1)
        return self.password_reset_token

    def verify_email_token(self, token):
        """Verify the email verification token"""
        if not self.email_verification_token or not self.email_verification_expires:
            return False
        if self.email_verification_token != token:
            return False
        if datetime.now(timezone.utc) > self.email_verification_expires:
            return False
        return True

    def verify_password_reset_token(self, token):
        """Verify the password reset token"""
        if not self.password_reset_token or not self.password_reset_expires:
            return False
        if self.password_reset_token != token:
            return False
        if datetime.now(timezone.utc) > self.password_reset_expires:
            return False
        return True

    @property
    def is_email_verified(self):
        return self.email_verified_at is not None

    @property
    def is_trial_active(self):
        if not self.trial_ends_at:
            return False
        return datetime.now(timezone.utc) < self.trial_ends_at

    @property
    def has_active_subscription(self):
        """Check if user has an active subscription"""
        if not hasattr(self, 'subscription') or not self.subscription:
            return False
        return self.subscription.status in ('active', 'trialing')

class Database(db.Model):
    __tablename__ = 'databases'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    display_name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    # Owner tracking for SaaS multi-tenancy (which admin owns this database)
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # Relationships
    bills = db.relationship('Bill', backref='database', lazy=True, cascade="all, delete-orphan")
    owner = db.relationship('User', foreign_keys=[owner_id], backref='owned_databases')

class Bill(db.Model):
    __tablename__ = 'bills'
    id = db.Column(db.Integer, primary_key=True)
    database_id = db.Column(db.Integer, db.ForeignKey('databases.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    amount = db.Column(db.Float, nullable=True)
    is_variable = db.Column(db.Boolean, default=False)
    frequency = db.Column(db.String(50), nullable=False) # monthly, weekly, etc.
    due_date = db.Column(db.String(10), nullable=False) # YYYY-MM-DD
    type = db.Column(db.String(20), default='expense') # expense or deposit
    account = db.Column(db.String(100))
    icon = db.Column(db.String(50))
    auto_pay = db.Column(db.Boolean, default=False)
    
    # Legacy/Advanced Frequency Support
    frequency_type = db.Column(db.String(20), default='simple')
    frequency_config = db.Column(db.Text, default='{}') # JSON string
    archived = db.Column(db.Boolean, default=False)
    
    category = db.Column(db.String(50))
    notes = db.Column(db.Text)
    last_updated = db.Column(db.DateTime, default=datetime.utcnow, onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    payments = db.relationship('Payment', backref='bill', lazy=True, cascade="all, delete-orphan")

class Payment(db.Model):
    __tablename__ = 'payments'
    id = db.Column(db.Integer, primary_key=True)
    bill_id = db.Column(db.Integer, db.ForeignKey('bills.id'), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    payment_date = db.Column(db.String(10), nullable=False) # YYYY-MM-DD
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=lambda: datetime.now(timezone.utc))


class RefreshToken(db.Model):
    """Stores refresh tokens for JWT authentication (mobile apps)"""
    __tablename__ = 'refresh_tokens'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    token_hash = db.Column(db.String(64), nullable=False, unique=True)
    expires_at = db.Column(db.DateTime, nullable=False)
    revoked = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    # Track device/client info for token management
    device_info = db.Column(db.String(255), nullable=True)

    # Relationship
    user = db.relationship('User', backref=db.backref('refresh_tokens', lazy=True))


class UserDevice(db.Model):
    """Stores registered devices for push notifications"""
    __tablename__ = 'user_devices'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)

    # Device identification
    device_id = db.Column(db.String(255), nullable=False)  # Unique device identifier
    device_name = db.Column(db.String(100), nullable=True)  # User-friendly name (e.g., "iPhone 15")
    platform = db.Column(db.String(20), nullable=False)  # ios, android, web, desktop

    # Push notification tokens
    push_token = db.Column(db.String(500), nullable=True)  # FCM/APNS token
    push_provider = db.Column(db.String(20), nullable=True)  # fcm, apns, expo

    # Device metadata
    app_version = db.Column(db.String(20), nullable=True)
    os_version = db.Column(db.String(50), nullable=True)
    last_active_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    # Notification preferences (JSON string)
    notification_settings = db.Column(db.Text, default='{}')

    # Relationship
    user = db.relationship('User', backref=db.backref('devices', lazy=True))

    # Unique constraint: one device_id per user
    __table_args__ = (
        db.UniqueConstraint('user_id', 'device_id', name='uq_user_device'),
    )


class UserInvite(db.Model):
    """Stores pending user invitations"""
    __tablename__ = 'user_invites'
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), nullable=False)
    token = db.Column(db.String(64), unique=True, nullable=False)
    role = db.Column(db.String(20), default='user')
    invited_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    database_ids = db.Column(db.String(255), default='')  # Comma-separated list of database IDs
    expires_at = db.Column(db.DateTime, nullable=False)
    accepted_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationship
    invited_by = db.relationship('User', backref=db.backref('sent_invites', lazy=True))

    @property
    def is_expired(self):
        return datetime.now(timezone.utc) > self.expires_at

    @property
    def is_accepted(self):
        return self.accepted_at is not None

    @property
    def is_valid(self):
        return not self.is_expired and not self.is_accepted


class Subscription(db.Model):
    """Stores Stripe subscription information for billing"""
    __tablename__ = 'subscriptions'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, unique=True)

    # Stripe identifiers
    stripe_customer_id = db.Column(db.String(255), nullable=True)
    stripe_subscription_id = db.Column(db.String(255), nullable=True)

    # Plan and tier info
    plan = db.Column(db.String(50), default='early_adopter')  # Legacy: early_adopter
    tier = db.Column(db.String(20), default='free')  # free, basic, plus
    billing_interval = db.Column(db.String(20), default='monthly')  # monthly, annual
    status = db.Column(db.String(50), default='trialing')  # trialing, active, canceled, past_due, unpaid

    # Billing dates
    trial_ends_at = db.Column(db.DateTime, nullable=True)
    current_period_start = db.Column(db.DateTime, nullable=True)
    current_period_end = db.Column(db.DateTime, nullable=True)
    canceled_at = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=lambda: datetime.now(timezone.utc))

    # Relationship
    user = db.relationship('User', backref=db.backref('subscription', uselist=False))

    @property
    def is_active(self):
        """Check if subscription allows full access"""
        return self.status in ('active', 'trialing')

    @property
    def is_trialing(self):
        return self.status == 'trialing'

    @property
    def is_trial_expired(self):
        """Check if trial period has ended without converting to paid"""
        if self.status != 'trialing':
            return False
        if not self.trial_ends_at:
            return False
        return datetime.now(timezone.utc) > self.trial_ends_at

    @property
    def effective_tier(self):
        """Get the effective tier based on subscription status"""
        # Active paid subscription gets their tier
        if self.status == 'active' and self.tier in ('basic', 'plus'):
            return self.tier
        # Trialing users get basic tier features during trial
        if self.status == 'trialing' and not self.is_trial_expired:
            return 'basic'
        # Expired trial or no subscription = free tier
        return 'free'

    @property
    def days_until_renewal(self):
        if not self.current_period_end:
            return None
        delta = self.current_period_end - datetime.now(timezone.utc)
        return max(0, delta.days)

    @property
    def trial_days_remaining(self):
        """Calculate days remaining in trial period"""
        if not self.trial_ends_at:
            return None
        if not self.is_trialing:
            return None
        delta = self.trial_ends_at - datetime.now(timezone.utc)
        return max(0, delta.days)

    @property
    def cancel_at_period_end(self):
        """Check if subscription is canceled but active until period end"""
        if not self.canceled_at:
            return False
        if not self.current_period_end:
            return False
        # If canceled but current period hasn't ended yet
        return datetime.now(timezone.utc) < self.current_period_end


class TelemetryLog(db.Model):
    """Tracks telemetry submissions (local tracking only, not sent to server)"""
    __tablename__ = 'telemetry_log'
    id = db.Column(db.Integer, primary_key=True)
    instance_id = db.Column(db.String(64), nullable=False)
    version = db.Column(db.String(20), nullable=True)
    deployment_mode = db.Column(db.String(20), nullable=True)  # saas, self-hosted, local-dev
    last_sent_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    metrics_snapshot = db.Column(db.Text, nullable=True)  # JSON string of last metrics sent
    send_successful = db.Column(db.Boolean, default=True)
    error_message = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    @property
    def days_since_last_sent(self):
        """Calculate days since last successful send"""
        if not self.last_sent_at:
            return None
        delta = datetime.now(timezone.utc) - self.last_sent_at
        return delta.days


class BillShare(db.Model):
    """Tracks bill sharing between different users/accounts"""
    __tablename__ = 'bill_shares'
    id = db.Column(db.Integer, primary_key=True)
    bill_id = db.Column(db.Integer, db.ForeignKey('bills.id'), nullable=False)

    # Who owns the bill (the user who created the share)
    owner_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)

    # Who the bill is shared with - supports both username (self-hosted) and email (SaaS)
    shared_with_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)  # Set when accepted
    shared_with_identifier = db.Column(db.String(255), nullable=False)  # username or email
    identifier_type = db.Column(db.String(20), default='username')  # 'username' or 'email'

    # Invitation handling (only needed for email-based SaaS invites)
    invite_token = db.Column(db.String(64), unique=True, nullable=True)
    status = db.Column(db.String(20), default='pending')  # pending, accepted, declined, revoked

    # Split configuration (optional)
    split_type = db.Column(db.String(20), nullable=True)  # NULL, 'percentage', 'fixed', 'equal'
    split_value = db.Column(db.Float, nullable=True)  # percentage (0-100) or fixed amount

    # Timestamps
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    accepted_at = db.Column(db.DateTime, nullable=True)
    expires_at = db.Column(db.DateTime, nullable=True)  # Only for email invites
    recipient_paid_date = db.Column(db.DateTime, nullable=True)  # When recipient marks their portion as paid

    # Relationships
    bill = db.relationship('Bill', backref=db.backref('shares', lazy=True, cascade="all, delete-orphan"))
    owner = db.relationship('User', foreign_keys=[owner_user_id], backref=db.backref('owned_shares', lazy=True))
    shared_with = db.relationship('User', foreign_keys=[shared_with_user_id], backref=db.backref('received_shares', lazy=True))

    # Prevent duplicate active shares for same bill+user combination
    __table_args__ = (
        db.UniqueConstraint('bill_id', 'shared_with_identifier', name='uq_bill_share_identifier'),
    )

    @property
    def is_active(self):
        """Check if share is currently active"""
        return self.status == 'accepted'

    @property
    def is_pending(self):
        """Check if share invitation is pending and not expired"""
        if self.status != 'pending':
            return False
        if self.expires_at and datetime.now(timezone.utc) > self.expires_at:
            return False
        return True

    @property
    def is_expired(self):
        """Check if share invitation has expired"""
        if not self.expires_at:
            return False
        return datetime.now(timezone.utc) > self.expires_at

    @property
    def is_recipient_paid(self):
        """Check if recipient has marked their portion as paid"""
        return self.recipient_paid_date is not None

    def calculate_portion(self):
        """Calculate the recipient's portion of the bill amount"""
        if not self.bill.amount:
            return None
        if not self.split_type:
            return self.bill.amount  # Full amount if no split
        if self.split_type == 'equal':
            return self.bill.amount / 2
        if self.split_type == 'percentage' and self.split_value:
            return self.bill.amount * (self.split_value / 100)
        if self.split_type == 'fixed' and self.split_value:
            return min(self.split_value, self.bill.amount)
        return self.bill.amount


class TelemetrySubmission(db.Model):
    """Stores telemetry data received from BillManager installations (production server only)"""
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
