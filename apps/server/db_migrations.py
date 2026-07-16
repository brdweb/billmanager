"""
Database Migration System for BillManager.

This module provides a versioned migration system that:
1. Tracks applied migrations in a schema_migrations table
2. Automatically runs pending migrations on app startup
3. Supports both forward migrations and data transformations

Usage:
    from db_migrations import run_pending_migrations

    with app.app_context():
        run_pending_migrations(db)

Adding new migrations:
    1. Create a new migration function: def migrate_XXXX_description(db):
    2. Add it to MIGRATIONS list with version number
    3. Migrations run in order and are tracked by version
"""

import logging
from datetime import datetime, timezone
from sqlalchemy import text, inspect

logger = logging.getLogger(__name__)


def ensure_migrations_table(db):
    """Create the schema_migrations table if it doesn't exist."""
    inspector = inspect(db.engine)
    if 'schema_migrations' not in inspector.get_table_names():
        db.session.execute(text('''
            CREATE TABLE schema_migrations (
                version VARCHAR(20) PRIMARY KEY,
                description VARCHAR(255) NOT NULL,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        '''))
        db.session.commit()
        logger.info("Created schema_migrations table")


def get_applied_migrations(db):
    """Get set of already applied migration versions."""
    result = db.session.execute(text('SELECT version FROM schema_migrations'))
    return {row[0] for row in result.fetchall()}


def record_migration(db, version, description):
    """Record a migration as applied."""
    db.session.execute(
        text('INSERT INTO schema_migrations (version, description, applied_at) VALUES (:version, :description, :applied_at)'),
        {'version': version, 'description': description, 'applied_at': datetime.now(timezone.utc)}
    )
    db.session.commit()


# =============================================================================
# MIGRATION DEFINITIONS
# Each migration is a tuple: (version, description, migration_function)
# Versions should be in format: YYYYMMDD_NN (date + sequence number)
# =============================================================================

def migrate_20241221_01_password_hash_length(db):
    """Increase password_hash column to 256 chars for bcrypt/pbkdf2 hashes."""
    db.session.execute(text('''
        ALTER TABLE users ALTER COLUMN password_hash TYPE VARCHAR(256)
    '''))
    db.session.commit()
    logger.info("Altered users.password_hash to VARCHAR(256)")


def migrate_20241221_02_add_migrations_index(db):
    """Add index on schema_migrations for faster lookups."""
    # This is a no-op since version is already PRIMARY KEY
    # Included as an example of a simple migration
    pass


def migrate_20241222_01_add_subscription_tier(db):
    """Add tier and billing_interval columns to subscriptions table."""
    inspector = inspect(db.engine)
    columns = [col['name'] for col in inspector.get_columns('subscriptions')]

    # Add tier column if not exists
    if 'tier' not in columns:
        db.session.execute(text('''
            ALTER TABLE subscriptions ADD COLUMN tier VARCHAR(20) DEFAULT 'free'
        '''))
        logger.info("Added subscriptions.tier column")

    # Add billing_interval column if not exists
    if 'billing_interval' not in columns:
        db.session.execute(text('''
            ALTER TABLE subscriptions ADD COLUMN billing_interval VARCHAR(20) DEFAULT 'monthly'
        '''))
        logger.info("Added subscriptions.billing_interval column")

    # Migrate existing early_adopter plans to basic tier
    db.session.execute(text('''
        UPDATE subscriptions SET tier = 'basic'
        WHERE plan = 'early_adopter' AND status IN ('active', 'trialing')
    '''))
    logger.info("Migrated early_adopter plans to basic tier")

    db.session.commit()


def migrate_20241223_01_add_saas_tenancy_columns(db):
    """Add owner_id to databases and created_by_id to users for SaaS multi-tenancy."""
    inspector = inspect(db.engine)

    # Add created_by_id to users table
    user_columns = [col['name'] for col in inspector.get_columns('users')]
    if 'created_by_id' not in user_columns:
        db.session.execute(text('''
            ALTER TABLE users ADD COLUMN created_by_id INTEGER REFERENCES users(id)
        '''))
        logger.info("Added users.created_by_id column")

    # Add owner_id to databases table
    db_columns = [col['name'] for col in inspector.get_columns('databases')]
    if 'owner_id' not in db_columns:
        db.session.execute(text('''
            ALTER TABLE databases ADD COLUMN owner_id INTEGER REFERENCES users(id)
        '''))
        logger.info("Added databases.owner_id column")

    db.session.commit()


def migrate_20241223_02_backfill_tenancy_ownership(db):
    """Backfill owner_id and created_by_id for existing data.

    For existing installations upgrading to SaaS multi-tenancy:
    - Set databases.owner_id to the first admin user for databases with NULL owner
    - Set users.created_by_id to the first admin user for users with NULL creator
    """
    # Find the first admin user (usually the original admin)
    result = db.session.execute(text('''
        SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1
    '''))
    row = result.fetchone()

    if not row:
        logger.warning("No admin user found, skipping tenancy backfill")
        return

    first_admin_id = row[0]
    logger.info(f"Using admin user ID {first_admin_id} for backfill")

    # Backfill databases.owner_id
    result = db.session.execute(text('''
        UPDATE databases SET owner_id = :admin_id WHERE owner_id IS NULL
    '''), {'admin_id': first_admin_id})
    db_count = result.rowcount
    logger.info(f"Set owner_id for {db_count} database(s)")

    # Backfill users.created_by_id (except for the admin themselves)
    result = db.session.execute(text('''
        UPDATE users SET created_by_id = :admin_id
        WHERE created_by_id IS NULL AND id != :admin_id
    '''), {'admin_id': first_admin_id})
    user_count = result.rowcount
    logger.info(f"Set created_by_id for {user_count} user(s)")

    db.session.commit()


def migrate_20241223_03_create_user_invites_table(db):
    """Create the user_invites table for invite-based user registration."""
    inspector = inspect(db.engine)
    if 'user_invites' in inspector.get_table_names():
        logger.info("user_invites table already exists")
        return

    db.session.execute(text('''
        CREATE TABLE user_invites (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            token VARCHAR(64) UNIQUE NOT NULL,
            role VARCHAR(20) DEFAULT 'user',
            invited_by_id INTEGER NOT NULL REFERENCES users(id),
            database_ids VARCHAR(255) DEFAULT '',
            expires_at TIMESTAMP NOT NULL,
            accepted_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    '''))
    db.session.commit()
    logger.info("Created user_invites table")


def migrate_20241224_01_add_payment_updated_at(db):
    """Add updated_at column to payments table for sync tracking."""
    inspector = inspect(db.engine)
    columns = [col['name'] for col in inspector.get_columns('payments')]

    if 'updated_at' not in columns:
        db.session.execute(text('''
            ALTER TABLE payments ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        '''))
        # Backfill existing payments with created_at value
        db.session.execute(text('''
            UPDATE payments SET updated_at = created_at WHERE updated_at IS NULL
        '''))
        logger.info("Added payments.updated_at column")

    db.session.commit()


def migrate_20241224_02_create_user_devices_table(db):
    """Create user_devices table for push notification token management."""
    inspector = inspect(db.engine)
    if 'user_devices' in inspector.get_table_names():
        logger.info("user_devices table already exists")
        return

    db.session.execute(text('''
        CREATE TABLE user_devices (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device_id VARCHAR(255) NOT NULL,
            device_name VARCHAR(100),
            platform VARCHAR(20) NOT NULL,
            push_token VARCHAR(500),
            push_provider VARCHAR(20),
            app_version VARCHAR(20),
            os_version VARCHAR(50),
            last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            notification_settings TEXT DEFAULT '{}',
            UNIQUE(user_id, device_id)
        )
    '''))
    # Add index for faster lookups by user
    db.session.execute(text('''
        CREATE INDEX idx_user_devices_user_id ON user_devices(user_id)
    '''))
    db.session.commit()
    logger.info("Created user_devices table")


def migrate_20260106_01_add_telemetry_columns(db):
    """Add telemetry tracking columns to users table."""
    inspector = inspect(db.engine)
    columns = [col['name'] for col in inspector.get_columns('users')]

    # Add telemetry_notice_shown_at column if not exists
    if 'telemetry_notice_shown_at' not in columns:
        db.session.execute(text('''
            ALTER TABLE users ADD COLUMN telemetry_notice_shown_at TIMESTAMP
        '''))
        logger.info("Added users.telemetry_notice_shown_at column")

    # Add telemetry_opt_out column if not exists
    if 'telemetry_opt_out' not in columns:
        db.session.execute(text('''
            ALTER TABLE users ADD COLUMN telemetry_opt_out BOOLEAN DEFAULT FALSE
        '''))
        logger.info("Added users.telemetry_opt_out column")

    db.session.commit()


def migrate_20260107_01_create_bill_shares_table(db):
    """Create bill_shares table for cross-account bill sharing."""
    inspector = inspect(db.engine)
    if 'bill_shares' in inspector.get_table_names():
        logger.info("bill_shares table already exists")
        return

    db.session.execute(text('''
        CREATE TABLE bill_shares (
            id SERIAL PRIMARY KEY,
            bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
            owner_user_id INTEGER NOT NULL REFERENCES users(id),
            shared_with_user_id INTEGER REFERENCES users(id),
            shared_with_identifier VARCHAR(255) NOT NULL,
            identifier_type VARCHAR(20) DEFAULT 'username',
            invite_token VARCHAR(64) UNIQUE,
            status VARCHAR(20) DEFAULT 'pending',
            split_type VARCHAR(20),
            split_value DECIMAL(10,2),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            accepted_at TIMESTAMP,
            expires_at TIMESTAMP,
            UNIQUE(bill_id, shared_with_identifier)
        )
    '''))

    # Add indexes for common queries
    db.session.execute(text('''
        CREATE INDEX idx_bill_shares_bill_id ON bill_shares(bill_id)
    '''))
    db.session.execute(text('''
        CREATE INDEX idx_bill_shares_shared_with_user ON bill_shares(shared_with_user_id)
    '''))
    db.session.execute(text('''
        CREATE INDEX idx_bill_shares_owner ON bill_shares(owner_user_id)
    '''))
    db.session.execute(text('''
        CREATE INDEX idx_bill_shares_status ON bill_shares(status)
    '''))

    db.session.commit()
    logger.info("Created bill_shares table")


def migrate_20260108_01_add_recipient_paid_date(db):
    """Add recipient_paid_date column to bill_shares table for tracking when share recipients mark their portion as paid"""
    logger.info("Running migration: 20260108_01_add_recipient_paid_date")

    # Check if column already exists
    result = db.session.execute(text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='bill_shares'
        AND column_name='recipient_paid_date'
    """))

    if result.fetchone():
        logger.info("recipient_paid_date column already exists")
        return

    # Add the recipient_paid_date column
    db.session.execute(text('''
        ALTER TABLE bill_shares
        ADD COLUMN recipient_paid_date TIMESTAMP
    '''))

    db.session.commit()
    logger.info("Added recipient_paid_date column to bill_shares table")


def migrate_20260109_01_fix_email_case_sensitivity(db):
    """Fix email case sensitivity by creating case-insensitive unique constraint on bill_shares"""
    logger.info("Running migration: 20260109_01_fix_email_case_sensitivity")

    # Check if new index already exists
    result = db.session.execute(text("""
        SELECT indexname
        FROM pg_indexes
        WHERE tablename='bill_shares'
        AND indexname='bill_shares_bill_id_identifier_lower_unique'
    """))

    if result.fetchone():
        logger.info("Case-insensitive unique index already exists")
        return

    # Drop the old unique constraint
    try:
        db.session.execute(text('''
            ALTER TABLE bill_shares
            DROP CONSTRAINT bill_shares_bill_id_shared_with_identifier_key
        '''))
        logger.info("Dropped old unique constraint")
    except Exception as e:
        # Constraint might not exist or have different name
        logger.warning(f"Could not drop old constraint: {e}")
        db.session.rollback()

    # Create new case-insensitive unique index
    db.session.execute(text('''
        CREATE UNIQUE INDEX bill_shares_bill_id_identifier_lower_unique
        ON bill_shares (bill_id, LOWER(shared_with_identifier))
    '''))

    db.session.commit()
    logger.info("Created case-insensitive unique index on bill_shares")


def migrate_20260112_01_add_share_id_to_payments(db):
    """Add share_id column to payments table for tracking shared bill payments."""
    logger.info("Running migration: 20260112_01_add_share_id_to_payments")

    # Check if column already exists
    result = db.session.execute(text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='payments'
        AND column_name='share_id'
    """))

    if result.fetchone():
        logger.info("share_id column already exists in payments table")
        return

    # Add the share_id column with foreign key reference
    db.session.execute(text('''
        ALTER TABLE payments
        ADD COLUMN share_id INTEGER REFERENCES bill_shares(id) ON DELETE SET NULL
    '''))

    # Add index for faster lookups
    db.session.execute(text('''
        CREATE INDEX idx_payments_share_id ON payments(share_id)
    '''))

    db.session.commit()
    logger.info("Added share_id column to payments table")


def migrate_20260114_01_add_performance_indexes(db):
    """Add composite indexes for improved query performance.

    Addresses N+1 query optimization by adding:
    1. payments(bill_id, payment_date DESC) - for ordered payment history queries
    2. bill_shares(shared_with_user_id, status) - for pending shares lookup
    3. payments(database_id, payment_date DESC) - for all-payments queries
    """
    logger.info("Running migration: 20260114_01_add_performance_indexes")

    # Check existing indexes to avoid duplicates
    result = db.session.execute(text("""
        SELECT indexname FROM pg_indexes
        WHERE tablename IN ('payments', 'bill_shares')
    """))
    existing_indexes = {row[0] for row in result.fetchall()}

    # Index for payment history queries (ORDER BY payment_date DESC)
    if 'idx_payments_bill_date' not in existing_indexes:
        db.session.execute(text('''
            CREATE INDEX idx_payments_bill_date
            ON payments(bill_id, payment_date DESC)
        '''))
        logger.info("Created index idx_payments_bill_date")

    # Note: payments table doesn't have database_id column directly
    # Payments are linked to databases through bills.database_id
    # Index removed as it referenced non-existent column

    # Composite index for pending shares lookup
    if 'idx_bill_shares_user_status' not in existing_indexes:
        db.session.execute(text('''
            CREATE INDEX idx_bill_shares_user_status
            ON bill_shares(shared_with_user_id, status)
        '''))
        logger.info("Created index idx_bill_shares_user_status")

    db.session.commit()
    logger.info("Performance indexes migration completed")


def migrate_20260109_02_create_share_audit_log(db):
    """Create share_audit_log table for tracking all share operations"""
    logger.info("Running migration: 20260109_02_create_share_audit_log")

    # Check if table already exists
    inspector = inspect(db.engine)
    if 'share_audit_log' in inspector.get_table_names():
        logger.info("share_audit_log table already exists")
        return

    db.session.execute(text('''
        CREATE TABLE share_audit_log (
            id SERIAL PRIMARY KEY,
            share_id INTEGER REFERENCES bill_shares(id) ON DELETE SET NULL,
            bill_id INTEGER NOT NULL REFERENCES bills(id),
            action VARCHAR(50) NOT NULL,
            actor_user_id INTEGER NOT NULL REFERENCES users(id),
            affected_user_id INTEGER REFERENCES users(id),
            extra_data TEXT,
            ip_address VARCHAR(50),
            user_agent VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    '''))

    # Add indexes for common queries
    db.session.execute(text('''
        CREATE INDEX idx_share_audit_log_share_id ON share_audit_log(share_id)
    '''))
    db.session.execute(text('''
        CREATE INDEX idx_share_audit_log_bill_id ON share_audit_log(bill_id)
    '''))
    db.session.execute(text('''
        CREATE INDEX idx_share_audit_log_actor ON share_audit_log(actor_user_id)
    '''))
    db.session.execute(text('''
        CREATE INDEX idx_share_audit_log_created_at ON share_audit_log(created_at DESC)
    '''))

    db.session.commit()
    logger.info("Created share_audit_log table with indexes")


def migrate_20260210_01_drop_invalid_payments_db_index(db):
    """Drop the invalid idx_payments_db_date index if it exists.

    The 20260114_01 migration previously attempted to create an index on
    payments.database_id, but that column doesn't exist (payments link to
    databases through bills.database_id). If an existing deployment ran
    the old migration code, the index creation would have failed, but the
    migration may have been recorded as applied. This cleanup drops the
    index if it somehow exists.
    """
    logger.info("Running migration: 20260210_01_drop_invalid_payments_db_index")

    result = db.session.execute(text("""
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'payments' AND indexname = 'idx_payments_db_date'
    """))
    if result.fetchone():
        db.session.execute(text('DROP INDEX idx_payments_db_date'))
        db.session.commit()
        logger.info("Dropped invalid index idx_payments_db_date")
    else:
        logger.info("Index idx_payments_db_date does not exist, no cleanup needed")


def migrate_20260210_02_create_oauth_accounts(db):
    """Create oauth_accounts table for OIDC provider account linking."""
    logger.info("Running migration: 20260210_02_create_oauth_accounts")

    inspector = inspect(db.engine)
    if 'oauth_accounts' in inspector.get_table_names():
        logger.info("oauth_accounts table already exists")
        return

    db.session.execute(text('''
        CREATE TABLE oauth_accounts (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider VARCHAR(20) NOT NULL,
            provider_user_id VARCHAR(255) NOT NULL,
            provider_email VARCHAR(255),
            profile_data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(provider, provider_user_id)
        )
    '''))

    db.session.execute(text('''
        CREATE INDEX idx_oauth_accounts_user_id ON oauth_accounts(user_id)
    '''))
    db.session.execute(text('''
        CREATE INDEX idx_oauth_accounts_provider ON oauth_accounts(provider, provider_user_id)
    '''))

    db.session.commit()
    logger.info("Created oauth_accounts table")


def migrate_20260210_03_create_twofa_tables(db):
    """Create 2FA tables: twofa_config, twofa_challenges, webauthn_credentials."""
    logger.info("Running migration: 20260210_03_create_twofa_tables")

    inspector = inspect(db.engine)
    existing_tables = inspector.get_table_names()

    if 'twofa_config' not in existing_tables:
        db.session.execute(text('''
            CREATE TABLE twofa_config (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                email_otp_enabled BOOLEAN DEFAULT FALSE,
                passkey_enabled BOOLEAN DEFAULT FALSE,
                recovery_codes_hash TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        '''))
        logger.info("Created twofa_config table")

    if 'twofa_challenges' not in existing_tables:
        db.session.execute(text('''
            CREATE TABLE twofa_challenges (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                challenge_type VARCHAR(20) NOT NULL,
                otp_code_hash VARCHAR(256),
                attempts INTEGER DEFAULT 0,
                max_attempts INTEGER DEFAULT 5,
                expires_at TIMESTAMP NOT NULL,
                used BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        '''))
        db.session.execute(text('''
            CREATE INDEX idx_twofa_challenges_user_id ON twofa_challenges(user_id)
        '''))
        db.session.execute(text('''
            CREATE INDEX idx_twofa_challenges_token ON twofa_challenges(token_hash)
        '''))
        logger.info("Created twofa_challenges table")

    if 'webauthn_credentials' not in existing_tables:
        db.session.execute(text('''
            CREATE TABLE webauthn_credentials (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                credential_id TEXT NOT NULL UNIQUE,
                public_key TEXT NOT NULL,
                sign_count INTEGER DEFAULT 0,
                device_name VARCHAR(100),
                transports TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_used_at TIMESTAMP
            )
        '''))
        db.session.execute(text('''
            CREATE INDEX idx_webauthn_creds_user_id ON webauthn_credentials(user_id)
        '''))
        logger.info("Created webauthn_credentials table")

    db.session.commit()


def migrate_20260210_04_nullable_password_hash(db):
    """Make password_hash nullable for OIDC-only users."""
    logger.info("Running migration: 20260210_04_nullable_password_hash")

    db.session.execute(text('''
        ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL
    '''))

    db.session.commit()
    logger.info("Made users.password_hash nullable")


def migrate_20260210_05_add_auth_provider(db):
    """Add auth_provider column to users table."""
    logger.info("Running migration: 20260210_05_add_auth_provider")

    result = db.session.execute(text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='users'
        AND column_name='auth_provider'
    """))

    if result.fetchone():
        logger.info("auth_provider column already exists")
        return

    db.session.execute(text('''
        ALTER TABLE users ADD COLUMN auth_provider VARCHAR(20) DEFAULT 'local'
    '''))

    db.session.commit()
    logger.info("Added users.auth_provider column")


def migrate_20260219_01_add_change_token_expiry(db):
    """Add change_token_expires column to users for expiring first-login tokens."""
    logger.info("Running migration: 20260219_01_add_change_token_expiry")

    result = db.session.execute(text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='users'
        AND column_name='change_token_expires'
    """))

    if result.fetchone():
        logger.info("change_token_expires column already exists")
        return

    db.session.execute(text('''
        ALTER TABLE users ADD COLUMN change_token_expires TIMESTAMP
    '''))
    db.session.commit()
    logger.info("Added users.change_token_expires column")




def migrate_20260226_01_ensure_share_audit_log_indexes(db):
    """Ensure share_audit_log has performance indexes.

    Some deployments may already have the share_audit_log table (e.g. created
    by SQLAlchemy metadata or an earlier partial migration) but be missing the
    indexes used by audit log queries.
    """
    logger.info("Running migration: 20260226_01_ensure_share_audit_log_indexes")

    inspector = inspect(db.engine)
    if 'share_audit_log' not in inspector.get_table_names():
        logger.info("share_audit_log table does not exist; nothing to index")
        return

    result = db.session.execute(text("""
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'share_audit_log'
    """))
    existing_indexes = {row[0] for row in result.fetchall()}

    index_statements = {
        'idx_share_audit_log_share_id': 'CREATE INDEX idx_share_audit_log_share_id ON share_audit_log(share_id)',
        'idx_share_audit_log_bill_id': 'CREATE INDEX idx_share_audit_log_bill_id ON share_audit_log(bill_id)',
        'idx_share_audit_log_actor': 'CREATE INDEX idx_share_audit_log_actor ON share_audit_log(actor_user_id)',
        'idx_share_audit_log_created_at': 'CREATE INDEX idx_share_audit_log_created_at ON share_audit_log(created_at DESC)',
    }

    created_any = False
    for name, stmt in index_statements.items():
        if name in existing_indexes:
            continue
        db.session.execute(text(stmt))
        logger.info(f"Created index {name}")
        created_any = True

    if created_any:
        db.session.commit()
        logger.info("Ensured share_audit_log indexes")
    else:
        logger.info("All share_audit_log indexes already exist")


def migrate_20260608_01_create_category_budgets(db):
    """Create category budgets and ensure bill category/notes columns exist."""
    logger.info("Running migration: 20260608_01_create_category_budgets")

    inspector = inspect(db.engine)

    bill_columns = [col['name'] for col in inspector.get_columns('bills')]
    if 'category' not in bill_columns:
        db.session.execute(text('''
            ALTER TABLE bills ADD COLUMN category VARCHAR(50)
        '''))
        logger.info("Added bills.category column")

    if 'notes' not in bill_columns:
        db.session.execute(text('''
            ALTER TABLE bills ADD COLUMN notes TEXT
        '''))
        logger.info("Added bills.notes column")

    if 'category_budgets' not in inspector.get_table_names():
        db.session.execute(text('''
            CREATE TABLE category_budgets (
                id SERIAL PRIMARY KEY,
                database_id INTEGER NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
                category VARCHAR(50) NOT NULL,
                monthly_limit DOUBLE PRECISION NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_category_budget_database_category UNIQUE(database_id, category)
            )
        '''))
        db.session.execute(text('''
            CREATE INDEX idx_category_budgets_database_id ON category_budgets(database_id)
        '''))
        logger.info("Created category_budgets table")

    db.session.commit()


def migrate_20260608_02_add_bill_reminder_preferences(db):
    """Add per-bill reminder preferences."""
    logger.info("Running migration: 20260608_02_add_bill_reminder_preferences")

    inspector = inspect(db.engine)
    bill_columns = [col['name'] for col in inspector.get_columns('bills')]

    if 'reminder_enabled' not in bill_columns:
        db.session.execute(text('''
            ALTER TABLE bills ADD COLUMN reminder_enabled BOOLEAN DEFAULT TRUE
        '''))
        logger.info("Added bills.reminder_enabled column")

    if 'reminder_days' not in bill_columns:
        db.session.execute(text('''
            ALTER TABLE bills ADD COLUMN reminder_days VARCHAR(100) DEFAULT '0,1,3,7'
        '''))
        logger.info("Added bills.reminder_days column")

    db.session.commit()


def migrate_20260715_01_create_client_mutations(db):
    """Create the idempotent mobile mutation replay ledger."""
    logger.info("Running migration: 20260715_01_create_client_mutations")

    inspector = inspect(db.engine)
    if 'client_mutations' not in inspector.get_table_names():
        db.session.execute(text('''
            CREATE TABLE client_mutations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                database_id INTEGER NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
                client_mutation_id VARCHAR(36) NOT NULL,
                operation VARCHAR(100) NOT NULL,
                request_hash VARCHAR(64) NOT NULL,
                response_status INTEGER NOT NULL,
                response_body TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                CONSTRAINT uq_client_mutation_scope
                    UNIQUE(user_id, database_id, client_mutation_id)
            )
        '''))
        db.session.execute(text('''
            CREATE INDEX idx_client_mutations_created_at
            ON client_mutations(created_at)
        '''))
        logger.info("Created client_mutations table")

    db.session.commit()


def migrate_20260715_02_add_bill_share_updated_at(db):
    """Add an optimistic concurrency timestamp to shared-bill records."""
    logger.info("Running migration: 20260715_02_add_bill_share_updated_at")

    inspector = inspect(db.engine)
    columns = [col['name'] for col in inspector.get_columns('bill_shares')]
    if 'updated_at' not in columns:
        db.session.execute(text('''
            ALTER TABLE bill_shares
            ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        '''))
        logger.info("Added bill_shares.updated_at column")

    db.session.commit()


def migrate_20260715_03_create_telemetry_settings(db):
    """Create and conservatively backfill instance-wide telemetry consent."""
    logger.info("Running migration: 20260715_03_create_telemetry_settings")

    inspector = inspect(db.engine)
    if 'telemetry_settings' not in inspector.get_table_names():
        db.session.execute(text('''
            CREATE TABLE telemetry_settings (
                id INTEGER PRIMARY KEY,
                state VARCHAR(20) NOT NULL DEFAULT 'pending',
                decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                decided_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT ck_telemetry_settings_singleton CHECK (id = 1),
                CONSTRAINT ck_telemetry_settings_state
                    CHECK (state IN ('pending', 'enabled', 'disabled'))
            )
        '''))
        logger.info("Created telemetry_settings table")

    existing = db.session.execute(
        text('SELECT id FROM telemetry_settings WHERE id = 1')
    ).fetchone()
    if not existing:
        decision = db.session.execute(text('''
            SELECT id, telemetry_notice_shown_at, telemetry_opt_out
            FROM users
            WHERE role = 'admin' AND created_by_id IS NULL
            ORDER BY
                CASE WHEN telemetry_opt_out IS TRUE THEN 0 ELSE 1 END,
                telemetry_notice_shown_at DESC NULLS LAST,
                id
        ''')).fetchall()

        disabled = next((row for row in decision if row[2] is True), None)
        accepted = next(
            (
                row for row in decision
                if row[1] is not None and row[2] is not True
            ),
            None,
        )

        if disabled:
            state = 'disabled'
            decided_by_user_id = disabled[0]
            decided_at = disabled[1] or datetime.now(timezone.utc)
        elif accepted:
            state = 'enabled'
            decided_by_user_id = accepted[0]
            decided_at = accepted[1]
        else:
            state = 'pending'
            decided_by_user_id = None
            decided_at = None

        db.session.execute(text('''
            INSERT INTO telemetry_settings (
                id, state, decided_by_user_id, decided_at, created_at, updated_at
            ) VALUES (
                1, :state, :decided_by_user_id, :decided_at,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
        '''), {
            'state': state,
            'decided_by_user_id': decided_by_user_id,
            'decided_at': decided_at,
        })
        logger.info("Initialized instance telemetry consent as %s", state)

    db.session.commit()


def migrate_20260715_04_add_user_last_login_at(db):
    """Add coarse successful-login tracking for aggregate telemetry."""
    logger.info("Running migration: 20260715_04_add_user_last_login_at")

    inspector = inspect(db.engine)
    columns = [col['name'] for col in inspector.get_columns('users')]
    if 'last_login_at' not in columns:
        db.session.execute(text('''
            ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP
        '''))
        db.session.execute(text('''
            CREATE INDEX idx_users_last_login_at ON users(last_login_at)
        '''))
        logger.info("Added users.last_login_at column and index")

    db.session.commit()


def _replace_fk_delete_action(
    db,
    *,
    table_name,
    column_name,
    referred_table,
    referred_column,
    ondelete,
):
    """Replace one existing FK while preserving its database-assigned name."""
    matching_foreign_keys = [
        foreign_key
        for foreign_key in inspect(db.engine).get_foreign_keys(table_name)
        if foreign_key['constrained_columns'] == [column_name]
        and foreign_key['referred_table'] == referred_table
        and foreign_key['referred_columns'] == [referred_column]
    ]
    if len(matching_foreign_keys) != 1:
        raise RuntimeError(
            f"Expected one foreign key for {table_name}.{column_name}, "
            f"found {len(matching_foreign_keys)}"
        )

    foreign_key = matching_foreign_keys[0]
    current_action = (
        foreign_key.get('options', {}).get('ondelete') or 'NO ACTION'
    )
    if current_action.upper() == ondelete:
        logger.info(
            "%s.%s already uses ON DELETE %s",
            table_name,
            column_name,
            ondelete,
        )
        return

    if db.engine.dialect.name != 'postgresql':
        raise RuntimeError(
            f"Cannot replace {table_name}.{column_name} foreign key on "
            f"{db.engine.dialect.name}"
        )

    constraint_name = foreign_key.get('name')
    if not constraint_name:
        raise RuntimeError(f"Foreign key for {table_name}.{column_name} has no name")

    quote = db.engine.dialect.identifier_preparer.quote
    db.session.execute(text(f'''
        ALTER TABLE {quote(table_name)}
        DROP CONSTRAINT {quote(constraint_name)},
        ADD CONSTRAINT {quote(constraint_name)}
            FOREIGN KEY ({quote(column_name)})
            REFERENCES {quote(referred_table)} ({quote(referred_column)})
            ON DELETE {ondelete}
    '''))
    logger.info(
        "Changed %s.%s to ON DELETE %s",
        table_name,
        column_name,
        ondelete,
    )


def migrate_20260716_01_normalize_delete_cascades(db):
    """Align upgraded schemas with the cascades declared by create migrations."""
    logger.info("Running migration: 20260716_01_normalize_delete_cascades")

    cascade_contracts = (
        ('bill_shares', 'bill_id', 'bills', 'id'),
        ('category_budgets', 'database_id', 'databases', 'id'),
        ('user_devices', 'user_id', 'users', 'id'),
    )
    for table_name, column_name, referred_table, referred_column in cascade_contracts:
        _replace_fk_delete_action(
            db,
            table_name=table_name,
            column_name=column_name,
            referred_table=referred_table,
            referred_column=referred_column,
            ondelete='CASCADE',
        )

    db.session.commit()


# List of all migrations in order
# Format: (version, description, function)
MIGRATIONS = [
    ('20241221_01', 'Increase password_hash column to 256 chars', migrate_20241221_01_password_hash_length),
    ('20241221_02', 'Add migrations tracking index', migrate_20241221_02_add_migrations_index),
    ('20241222_01', 'Add subscription tier and billing_interval columns', migrate_20241222_01_add_subscription_tier),
    ('20241223_01', 'Add SaaS multi-tenancy columns (owner_id, created_by_id)', migrate_20241223_01_add_saas_tenancy_columns),
    ('20241223_02', 'Backfill owner_id and created_by_id for existing data', migrate_20241223_02_backfill_tenancy_ownership),
    ('20241223_03', 'Create user_invites table for invite-based registration', migrate_20241223_03_create_user_invites_table),
    ('20241224_01', 'Add updated_at column to payments for sync tracking', migrate_20241224_01_add_payment_updated_at),
    ('20241224_02', 'Create user_devices table for push notifications', migrate_20241224_02_create_user_devices_table),
    ('20260106_01', 'Add telemetry tracking columns to users table', migrate_20260106_01_add_telemetry_columns),
    ('20260107_01', 'Create bill_shares table for cross-account bill sharing', migrate_20260107_01_create_bill_shares_table),
    ('20260108_01', 'Add recipient_paid_date column to bill_shares', migrate_20260108_01_add_recipient_paid_date),
    ('20260109_01', 'Fix email case sensitivity in bill_shares unique constraint', migrate_20260109_01_fix_email_case_sensitivity),
    ('20260109_02', 'Create share_audit_log table for audit trail', migrate_20260109_02_create_share_audit_log),
    ('20260112_01', 'Add share_id to payments for shared bill payment tracking', migrate_20260112_01_add_share_id_to_payments),
    ('20260114_01', 'Add composite indexes for query performance', migrate_20260114_01_add_performance_indexes),
    ('20260210_01', 'Drop invalid idx_payments_db_date index if exists', migrate_20260210_01_drop_invalid_payments_db_index),
    ('20260210_02', 'Create oauth_accounts table', migrate_20260210_02_create_oauth_accounts),
    ('20260210_03', 'Create 2FA tables (twofa_config, twofa_challenges, webauthn_credentials)', migrate_20260210_03_create_twofa_tables),
    ('20260210_04', 'Make password_hash nullable for OIDC-only users', migrate_20260210_04_nullable_password_hash),
    ('20260210_05', 'Add auth_provider column to users', migrate_20260210_05_add_auth_provider),
    ('20260219_01', 'Add change_token_expires to users for password change tokens', migrate_20260219_01_add_change_token_expiry),
    ('20260226_01', 'Ensure share_audit_log performance indexes exist', migrate_20260226_01_ensure_share_audit_log_indexes),
    ('20260608_01', 'Create category budgets and ensure bill category fields', migrate_20260608_01_create_category_budgets),
    ('20260608_02', 'Add per-bill reminder preferences', migrate_20260608_02_add_bill_reminder_preferences),
    ('20260715_01', 'Create idempotent client mutation replay ledger', migrate_20260715_01_create_client_mutations),
    ('20260715_02', 'Add optimistic concurrency timestamp to bill shares', migrate_20260715_02_add_bill_share_updated_at),
    ('20260715_03', 'Create instance-wide telemetry consent settings', migrate_20260715_03_create_telemetry_settings),
    ('20260715_04', 'Add coarse user last-login tracking', migrate_20260715_04_add_user_last_login_at),
    ('20260716_01', 'Normalize destructive foreign-key cascades', migrate_20260716_01_normalize_delete_cascades),
]


def run_pending_migrations(db):
    """
    Run all pending database migrations.

    This function:
    1. Ensures the schema_migrations table exists
    2. Checks which migrations have been applied
    3. Runs any pending migrations in order
    4. Records each successful migration

    Returns:
        int: Number of migrations applied
    """
    ensure_migrations_table(db)
    applied = get_applied_migrations(db)

    migrations_run = 0

    for version, description, migrate_func in MIGRATIONS:
        if version in applied:
            continue

        logger.info(f"Running migration {version}: {description}")
        try:
            migrate_func(db)
            record_migration(db, version, description)
            migrations_run += 1
            logger.info(f"Migration {version} completed successfully")
        except Exception as e:
            logger.error(f"Migration {version} failed: {e}")
            # Don't continue with other migrations if one fails
            raise RuntimeError(f"Migration {version} failed: {e}") from e

    if migrations_run == 0:
        logger.info("No pending migrations")
    else:
        logger.info(f"Applied {migrations_run} migration(s)")

    return migrations_run


def get_migration_status(db):
    """
    Get status of all migrations.

    Returns:
        list: List of dicts with migration info and status
    """
    ensure_migrations_table(db)
    applied = get_applied_migrations(db)

    # Get applied timestamps
    result = db.session.execute(text('SELECT version, applied_at FROM schema_migrations'))
    applied_times = {row[0]: row[1] for row in result.fetchall()}

    status = []
    for version, description, _ in MIGRATIONS:
        status.append({
            'version': version,
            'description': description,
            'applied': version in applied,
            'applied_at': applied_times.get(version)
        })

    return status
