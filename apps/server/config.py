"""
Deployment mode configuration for BillManager.

Supports two modes:
- self-hosted: For users running their own instance (default)
- saas: For the hosted app.billmanager.app service
"""

import os
import logging

logger = logging.getLogger(__name__)

# Deployment mode: 'self-hosted' or 'saas'
DEPLOYMENT_MODE = os.environ.get('DEPLOYMENT_MODE', 'self-hosted')

# Stripe pricing configuration for tiered plans
# Each tier has monthly and annual price IDs from Stripe
STRIPE_PRICES = {
    'basic': {
        'monthly': os.environ.get('STRIPE_PRICE_BASIC_MONTHLY'),
        'annual': os.environ.get('STRIPE_PRICE_BASIC_ANNUAL'),
        'name': 'Basic',
        'monthly_amount': 500,  # $5.00 in cents
        'annual_amount': 5000,  # $50.00 in cents
    },
    'plus': {
        'monthly': os.environ.get('STRIPE_PRICE_PLUS_MONTHLY'),
        'annual': os.environ.get('STRIPE_PRICE_PLUS_ANNUAL'),
        'name': 'Plus',
        'monthly_amount': 750,  # $7.50 in cents
        'annual_amount': 7500,  # $75.00 in cents
    },
}

# Tier limits for feature gating (SaaS mode only)
TIER_LIMITS = {
    'free': {
        'bills': 10,
        'users': 1,
        'bill_groups': 1,
        'export': False,
        'full_analytics': False,
        'priority_support': False,
    },
    'basic': {
        'bills': -1,  # -1 = unlimited
        'users': 2,
        'bill_groups': 1,
        'export': True,
        'full_analytics': True,
        'priority_support': False,
    },
    'plus': {
        'bills': -1,
        'users': 5,
        'bill_groups': 3,
        'export': True,
        'full_analytics': True,
        'priority_support': True,
    },
}


def get_tier_limits(tier: str) -> dict:
    """Get feature limits for a subscription tier."""
    return TIER_LIMITS.get(tier, TIER_LIMITS['free'])


def get_stripe_price_id(tier: str, interval: str) -> str | None:
    """Get Stripe price ID for a tier and billing interval."""
    if tier not in STRIPE_PRICES:
        return None
    return STRIPE_PRICES[tier].get(interval)


def is_saas():
    """Check if running in SaaS mode."""
    return DEPLOYMENT_MODE == 'saas'


def is_self_hosted():
    """Check if running in self-hosted mode."""
    return DEPLOYMENT_MODE == 'self-hosted'


# Feature flags based on deployment mode
# Email verification: required for SaaS, optional for self-hosted
REQUIRE_EMAIL_VERIFICATION = (
    is_saas() or
    os.environ.get('REQUIRE_EMAIL_VERIFICATION', 'false').lower() == 'true'
)

# Billing: only enabled for SaaS when Stripe is configured
ENABLE_BILLING = (
    is_saas() and
    bool(os.environ.get('STRIPE_SECRET_KEY'))
)

# Registration: enabled for SaaS, disabled by default for self-hosted
ENABLE_REGISTRATION = os.environ.get(
    'ENABLE_REGISTRATION',
    'true' if is_saas() else 'false'
).lower() == 'true'

# Email: enabled when RESEND_API_KEY is configured
EMAIL_ENABLED = bool(os.environ.get('RESEND_API_KEY'))


# =============================================================================
# OIDC / OAuth Provider Configuration
# =============================================================================
# Each provider is individually toggled via env vars. All off by default.

OAUTH_PROVIDERS = {
    'google': {
        'enabled': os.environ.get('OAUTH_GOOGLE_ENABLED', 'false').lower() == 'true',
        'client_id': os.environ.get('OAUTH_GOOGLE_CLIENT_ID'),
        'client_secret': os.environ.get('OAUTH_GOOGLE_CLIENT_SECRET'),
        'discovery_url': 'https://accounts.google.com/.well-known/openid-configuration',
        'scopes': 'openid email profile',
        'display_name': 'Google',
        'icon': 'google',
    },
    'apple': {
        'enabled': os.environ.get('OAUTH_APPLE_ENABLED', 'false').lower() == 'true',
        'client_id': os.environ.get('OAUTH_APPLE_CLIENT_ID'),
        'client_secret': None,  # nosec B105 - Apple uses JWT-based client_secret
        'team_id': os.environ.get('OAUTH_APPLE_TEAM_ID'),
        'key_id': os.environ.get('OAUTH_APPLE_KEY_ID'),
        'private_key': os.environ.get('OAUTH_APPLE_PRIVATE_KEY'),
        'discovery_url': 'https://appleid.apple.com/.well-known/openid-configuration',
        'scopes': 'openid email name',
        'display_name': 'Apple',
        'icon': 'apple',
    },
    'microsoft': {
        'enabled': os.environ.get('OAUTH_MICROSOFT_ENABLED', 'false').lower() == 'true',
        'client_id': os.environ.get('OAUTH_MICROSOFT_CLIENT_ID'),
        'client_secret': os.environ.get('OAUTH_MICROSOFT_CLIENT_SECRET'),
        'tenant_id': os.environ.get('OAUTH_MICROSOFT_TENANT_ID', 'common'),
        'discovery_url': None,  # Built dynamically from tenant_id
        'scopes': 'openid email profile',
        'display_name': 'Microsoft',
        'icon': 'microsoft',
    },
    'oidc': {
        'enabled': os.environ.get('OAUTH_OIDC_ENABLED', 'false').lower() == 'true',
        'client_id': os.environ.get('OAUTH_OIDC_CLIENT_ID'),
        'client_secret': os.environ.get('OAUTH_OIDC_CLIENT_SECRET'),
        'discovery_url': os.environ.get('OAUTH_OIDC_DISCOVERY_URL'),
        'scopes': os.environ.get('OAUTH_OIDC_SCOPES', 'openid email profile'),
        'display_name': os.environ.get('OAUTH_OIDC_DISPLAY_NAME', 'SSO'),
        'icon': os.environ.get('OAUTH_OIDC_ICON', 'lock'),
    },
}

# Build Microsoft discovery URL dynamically
_ms_tenant = OAUTH_PROVIDERS['microsoft']['tenant_id']
OAUTH_PROVIDERS['microsoft']['discovery_url'] = f'https://login.microsoftonline.com/{_ms_tenant}/v2.0/.well-known/openid-configuration'


def get_enabled_oauth_providers():
    """Return list of provider keys that are enabled AND have required credentials."""
    enabled = []
    required_fields = {
        'google': ['client_id', 'client_secret'],
        'apple': ['client_id', 'team_id', 'key_id', 'private_key'],
        'microsoft': ['client_id', 'client_secret'],
        'oidc': ['client_id', 'client_secret', 'discovery_url'],
    }
    for provider, cfg in OAUTH_PROVIDERS.items():
        if not cfg.get('enabled'):
            continue
        missing = [f for f in required_fields.get(provider, []) if not cfg.get(f)]
        if missing:
            logger.warning(f"OAuth provider '{provider}' enabled but missing: {', '.join(missing)}")
            continue
        enabled.append(provider)
    return enabled


# =============================================================================
# Two-Factor Authentication Configuration
# =============================================================================

# OAuth auto-registration: allow new users to register via OIDC
# Default true for self-hosted (convenience), false for SaaS (security)
OAUTH_AUTO_REGISTER = os.environ.get(
    'OAUTH_AUTO_REGISTER',
    'true' if is_self_hosted() else 'false'
).lower() == 'true'

ENABLE_2FA = os.environ.get('ENABLE_2FA', 'false').lower() == 'true'
ENABLE_PASSKEYS = os.environ.get('ENABLE_PASSKEYS', 'false').lower() == 'true'

# WebAuthn Relying Party configuration
WEBAUTHN_RP_ID = os.environ.get('WEBAUTHN_RP_ID', 'localhost')
WEBAUTHN_RP_NAME = os.environ.get('WEBAUTHN_RP_NAME', 'BillManager')
WEBAUTHN_ORIGIN = os.environ.get('WEBAUTHN_ORIGIN', 'http://localhost:5173')


def get_public_config():
    """Return configuration safe to expose to the frontend."""
    enabled_providers = get_enabled_oauth_providers()
    return {
        'deployment_mode': DEPLOYMENT_MODE,
        'billing_enabled': ENABLE_BILLING,
        'registration_enabled': ENABLE_REGISTRATION,
        'email_enabled': EMAIL_ENABLED,
        'email_verification_required': REQUIRE_EMAIL_VERIFICATION,
        'oauth_providers': [
            {
                'id': p,
                'display_name': OAUTH_PROVIDERS[p]['display_name'],
                'icon': OAUTH_PROVIDERS[p]['icon'],
            }
            for p in enabled_providers
        ],
        'twofa_enabled': ENABLE_2FA,
        'passkeys_enabled': ENABLE_PASSKEYS,
        'tier_limits': TIER_LIMITS if is_saas() else None,
        'pricing': {
            'basic': {
                'name': STRIPE_PRICES['basic']['name'],
                'monthly': STRIPE_PRICES['basic']['monthly_amount'],
                'annual': STRIPE_PRICES['basic']['annual_amount'],
            },
            'plus': {
                'name': STRIPE_PRICES['plus']['name'],
                'monthly': STRIPE_PRICES['plus']['monthly_amount'],
                'annual': STRIPE_PRICES['plus']['annual_amount'],
            },
        } if is_saas() else None,
    }
