"""
Deployment mode configuration for BillManager.

Supports two modes:
- self-hosted: For users running their own instance (default)
- saas: For the hosted app.billmanager.app service
"""

import os
import logging
import re
from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

from services.email_config import get_email_config

logger = logging.getLogger(__name__)


def _oauth_token_auth_method(env_var, default="client_secret_post"):
    """Read and validate an OAuth token endpoint client auth method."""
    value = os.environ.get(env_var, default).strip().lower()
    allowed = {"client_secret_post", "client_secret_basic", "none", "auto"}
    if value not in allowed:
        logger.warning(
            "Invalid %s=%s; falling back to %s",
            env_var,
            value,
            default,
        )
        return default
    return value

# Deployment mode: 'self-hosted' or 'saas'
DEPLOYMENT_MODE = os.environ.get("DEPLOYMENT_MODE", "self-hosted")

# Stripe pricing configuration for tiered plans
# Each tier has monthly and annual price IDs from Stripe
STRIPE_PRICES = {
    "basic": {
        "monthly": os.environ.get("STRIPE_PRICE_BASIC_MONTHLY"),
        "annual": os.environ.get("STRIPE_PRICE_BASIC_ANNUAL"),
        "name": "Basic",
        "monthly_amount": 500,  # $5.00 in cents
        "annual_amount": 5000,  # $50.00 in cents
    },
    "plus": {
        "monthly": os.environ.get("STRIPE_PRICE_PLUS_MONTHLY"),
        "annual": os.environ.get("STRIPE_PRICE_PLUS_ANNUAL"),
        "name": "Plus",
        "monthly_amount": 750,  # $7.50 in cents
        "annual_amount": 7500,  # $75.00 in cents
    },
}

# Tier limits for feature gating (SaaS mode only)
TIER_LIMITS = {
    "free": {
        "bills": 10,
        "users": 1,
        "bill_groups": 1,
        "export": False,
        "full_analytics": False,
        "priority_support": False,
    },
    "basic": {
        "bills": -1,  # -1 = unlimited
        "users": 2,
        "bill_groups": 1,
        "export": True,
        "full_analytics": True,
        "priority_support": False,
    },
    "plus": {
        "bills": -1,
        "users": 5,
        "bill_groups": 3,
        "export": True,
        "full_analytics": True,
        "priority_support": True,
    },
}


def get_tier_limits(tier: str) -> dict:
    """Get feature limits for a subscription tier."""
    return TIER_LIMITS.get(tier, TIER_LIMITS["free"])


def get_stripe_price_id(tier: str, interval: str) -> str | None:
    """Get Stripe price ID for a tier and billing interval."""
    if tier not in STRIPE_PRICES:
        return None
    return STRIPE_PRICES[tier].get(interval)


def is_saas():
    """Check if running in SaaS mode."""
    return DEPLOYMENT_MODE == "saas"


def is_self_hosted():
    """Check if running in self-hosted mode."""
    return DEPLOYMENT_MODE == "self-hosted"


# Feature flags based on deployment mode
# Email verification: required for SaaS, optional for self-hosted
REQUIRE_EMAIL_VERIFICATION = (
    is_saas() or os.environ.get("REQUIRE_EMAIL_VERIFICATION", "false").lower() == "true"
)

# Billing: only enabled for SaaS when Stripe is configured
ENABLE_BILLING = is_saas() and bool(os.environ.get("STRIPE_SECRET_KEY"))

# Registration: enabled for SaaS, disabled by default for self-hosted
ENABLE_REGISTRATION = (
    os.environ.get("ENABLE_REGISTRATION", "true" if is_saas() else "false").lower()
    == "true"
)

# Email: enabled when any supported outbound provider is fully configured
EMAIL_CONFIG = get_email_config(os.environ)
EMAIL_PROVIDER = EMAIL_CONFIG.provider
EMAIL_ENABLED = EMAIL_CONFIG.is_configured


# =============================================================================
# OIDC / OAuth Provider Configuration
# =============================================================================
# Each provider is individually toggled via env vars. All off by default.

_OAUTH_PROVIDER_CONFIGS = {
    "google": {
        "enabled": os.environ.get("OAUTH_GOOGLE_ENABLED", "false").lower() == "true",
        "client_id": os.environ.get("OAUTH_GOOGLE_CLIENT_ID"),
        "client_secret": os.environ.get("OAUTH_GOOGLE_CLIENT_SECRET"),
        "token_auth_method": "client_secret_post",  # nosec B105 - OAuth auth method identifier, not a password.
        "discovery_url": "https://accounts.google.com/.well-known/openid-configuration",
        "scopes": "openid email profile",
        "display_name": "Google",
        "icon": "google",
    },
    "apple": {
        "enabled": os.environ.get("OAUTH_APPLE_ENABLED", "false").lower() == "true",
        "client_id": os.environ.get("OAUTH_APPLE_CLIENT_ID"),
        "client_secret": None,  # nosec B105 - Apple uses JWT-based client_secret
        "team_id": os.environ.get("OAUTH_APPLE_TEAM_ID"),
        "key_id": os.environ.get("OAUTH_APPLE_KEY_ID"),
        "private_key": os.environ.get("OAUTH_APPLE_PRIVATE_KEY"),
        "token_auth_method": "client_secret_post",  # nosec B105 - OAuth auth method identifier, not a password.
        "discovery_url": "https://appleid.apple.com/.well-known/openid-configuration",
        "scopes": "openid email name",
        "display_name": "Apple",
        "icon": "apple",
    },
    "microsoft": {
        "enabled": os.environ.get("OAUTH_MICROSOFT_ENABLED", "false").lower() == "true",
        "client_id": os.environ.get("OAUTH_MICROSOFT_CLIENT_ID"),
        "client_secret": os.environ.get("OAUTH_MICROSOFT_CLIENT_SECRET"),
        "tenant_id": os.environ.get("OAUTH_MICROSOFT_TENANT_ID", "common"),
        "token_auth_method": "client_secret_post",  # nosec B105 - OAuth auth method identifier, not a password.
        "discovery_url": None,  # Built dynamically from tenant_id
        "scopes": "openid email profile",
        "display_name": "Microsoft",
        "icon": "microsoft",
    },
    "oidc": {
        "enabled": os.environ.get("OAUTH_OIDC_ENABLED", "false").lower() == "true",
        "client_id": os.environ.get("OAUTH_OIDC_CLIENT_ID"),
        "client_secret": os.environ.get("OAUTH_OIDC_CLIENT_SECRET"),
        "token_auth_method": _oauth_token_auth_method("OAUTH_OIDC_TOKEN_AUTH_METHOD"),
        "discovery_url": os.environ.get("OAUTH_OIDC_DISCOVERY_URL"),
        "scopes": os.environ.get("OAUTH_OIDC_SCOPES", "openid email profile"),
        "display_name": os.environ.get("OAUTH_OIDC_DISPLAY_NAME", "SSO"),
        "icon": os.environ.get("OAUTH_OIDC_ICON", "lock"),
    },
}

# Build Microsoft discovery URL dynamically
_ms_tenant = _OAUTH_PROVIDER_CONFIGS["microsoft"]["tenant_id"]
_OAUTH_PROVIDER_CONFIGS["microsoft"]["discovery_url"] = (
    f"https://login.microsoftonline.com/{_ms_tenant}/v2.0/.well-known/openid-configuration"
)


OAUTH_PROVIDER_PUBLIC_INFO = {
    provider: {
        "display_name": cfg["display_name"],
        "icon": cfg["icon"],
    }
    for provider, cfg in _OAUTH_PROVIDER_CONFIGS.items()
}

# Backwards-compatible alias for tests and legacy internal callers.
OAUTH_PROVIDERS = _OAUTH_PROVIDER_CONFIGS


def get_oauth_provider_config(provider):
    """Return a copy of the full provider config for internal server-side use."""
    cfg = _OAUTH_PROVIDER_CONFIGS.get(provider)
    return dict(cfg) if cfg else None


def get_enabled_oauth_providers():
    """Return list of provider keys that are enabled AND have required credentials."""
    enabled = []
    required_fields = {
        "google": ["client_id", "client_secret"],
        "apple": ["client_id", "team_id", "key_id", "private_key"],
        "microsoft": ["client_id", "client_secret"],
        "oidc": ["client_id", "discovery_url"],
    }
    for provider, cfg in _OAUTH_PROVIDER_CONFIGS.items():
        if not cfg.get("enabled"):
            continue
        provider_required_fields = list(required_fields.get(provider, []))
        if provider == "oidc" and cfg.get("token_auth_method") not in ("none", "auto"):
            provider_required_fields.append("client_secret")
        missing = [f for f in provider_required_fields if not cfg.get(f)]
        if missing:
            logger.warning("OAuth provider enabled but missing required credentials")
            continue
        enabled.append(provider)
    return enabled


def get_oauth_redirect_uris():
    """Return exact OAuth callback URIs accepted by authorize and callback.

    The current web callback and the official native app callback remain
    available by default. Deployments can append universal links or alternate
    development-client schemes with ``OAUTH_REDIRECT_URIS``.
    """
    app_url = os.environ.get("APP_URL", "http://localhost:5173").rstrip("/")
    configured = [
        value.strip()
        for value in os.environ.get("OAUTH_REDIRECT_URIS", "").split(",")
        if value.strip()
    ]
    candidates = [
        f"{app_url}/auth/callback",
        "billmanager://auth/callback",
        *configured,
    ]
    return tuple(dict.fromkeys(candidates))


# =============================================================================
# Two-Factor Authentication Configuration
# =============================================================================

# OAuth auto-registration: allow new users to register via OIDC
# Default true for self-hosted (convenience), false for SaaS (security)
OAUTH_AUTO_REGISTER = (
    os.environ.get(
        "OAUTH_AUTO_REGISTER", "true" if is_self_hosted() else "false"
    ).lower()
    == "true"
)

# Generic OIDC claim mapping (only applies to provider="oidc")
OAUTH_OIDC_EMAIL_CLAIM = os.environ.get("OAUTH_OIDC_EMAIL_CLAIM", "email")
OAUTH_OIDC_USERNAME_CLAIM = os.environ.get(
    "OAUTH_OIDC_USERNAME_CLAIM", "preferred_username"
)
OAUTH_OIDC_NAME_CLAIM = os.environ.get("OAUTH_OIDC_NAME_CLAIM", "name")
OAUTH_OIDC_SKIP_EMAIL_VERIFICATION = (
    os.environ.get("OAUTH_OIDC_SKIP_EMAIL_VERIFICATION", "false").lower() == "true"
)

ENABLE_2FA = os.environ.get("ENABLE_2FA", "false").lower() == "true"
ENABLE_PASSKEYS = os.environ.get("ENABLE_PASSKEYS", "false").lower() == "true"

# Supported deployment currencies and their ISO 4217 minor-unit precision.
SUPPORTED_CURRENCIES: Final[tuple[str, ...]] = (
    "USD",
    "EUR",
    "JPY",
    "GBP",
    "CNY",
    "CHF",
    "AUD",
    "CAD",
    "HKD",
    "SGD",
    "INR",
    "KRW",
    "SEK",
    "NZD",
    "MXN",
)
CURRENCY_MINOR_UNITS: Final[Mapping[str, int]] = MappingProxyType(
    {
        currency: 0 if currency in {"JPY", "KRW"} else 2
        for currency in SUPPORTED_CURRENCIES
    }
)


def _parse_default_currency(value: str) -> str:
    normalized = value.strip().upper()
    if not normalized:
        message = "DEFAULT_CURRENCY cannot be empty"
        raise ValueError(message)
    if normalized not in SUPPORTED_CURRENCIES:
        supported = ", ".join(SUPPORTED_CURRENCIES)
        message = f"DEFAULT_CURRENCY must be one of: {supported}; got {normalized!r}"
        raise ValueError(message)
    return normalized


# Default currency for formatting and validating amounts deployment-wide.
DEFAULT_CURRENCY: Final = _parse_default_currency(
    os.environ.get("DEFAULT_CURRENCY", "USD")
)
# Default locale for formatting numbers/dates in the UI (BCP 47 tag)
DEFAULT_LOCALE = os.environ.get("DEFAULT_LOCALE", "en-US")

# Public mobile compatibility contract. Keep this independent from the API
# version: it only changes when a mobile client must handle a breaking contract
# change. An unset minimum version means that any client implementing the
# advertised contract is accepted.
SERVER_VERSION = os.environ.get("APP_VERSION", "4.4.1")
MOBILE_CONTRACT_VERSION = 1
MINIMUM_MOBILE_VERSION = os.environ.get("MINIMUM_MOBILE_VERSION") or None

# WebAuthn Relying Party configuration
WEBAUTHN_RP_ID = os.environ.get("WEBAUTHN_RP_ID", "localhost")
WEBAUTHN_RP_NAME = os.environ.get("WEBAUTHN_RP_NAME", "BillManager")
WEBAUTHN_ORIGIN = os.environ.get("WEBAUTHN_ORIGIN", "http://localhost:5173")


def parse_webauthn_android_origins(value):
    """Parse exact Credential Manager origins for trusted Android signing certs."""
    origins = [origin.strip() for origin in (value or "").split(",") if origin.strip()]
    pattern = re.compile(r"^android:apk-key-hash:[A-Za-z0-9_-]{43}=?$")
    invalid = [origin for origin in origins if not pattern.fullmatch(origin)]
    if invalid:
        raise ValueError(
            "WEBAUTHN_ANDROID_ORIGINS contains an invalid android:apk-key-hash origin"
        )
    return origins


WEBAUTHN_ANDROID_ORIGINS = parse_webauthn_android_origins(
    os.environ.get("WEBAUTHN_ANDROID_ORIGINS")
)
WEBAUTHN_EXPECTED_ORIGINS = [WEBAUTHN_ORIGIN, *WEBAUTHN_ANDROID_ORIGINS]


def get_public_config():
    """Return configuration safe to expose to the frontend."""
    enabled_providers = get_enabled_oauth_providers()
    return {
        "deployment_mode": DEPLOYMENT_MODE,
        "billing_enabled": ENABLE_BILLING,
        "registration_enabled": ENABLE_REGISTRATION,
        "email_enabled": EMAIL_ENABLED,
        "email_verification_required": REQUIRE_EMAIL_VERIFICATION,
        "oauth_providers": [
            {
                "id": p,
                "display_name": OAUTH_PROVIDER_PUBLIC_INFO[p]["display_name"],
                "icon": OAUTH_PROVIDER_PUBLIC_INFO[p]["icon"],
            }
            for p in enabled_providers
        ],
        "twofa_enabled": ENABLE_2FA,
        "passkeys_enabled": ENABLE_PASSKEYS,
        "default_currency": DEFAULT_CURRENCY,
        "default_locale": DEFAULT_LOCALE,
        "mobile": get_mobile_capabilities(enabled_providers),
        "tier_limits": TIER_LIMITS if is_saas() else None,
        "pricing": {
            "basic": {
                "name": STRIPE_PRICES["basic"]["name"],
                "monthly": STRIPE_PRICES["basic"]["monthly_amount"],
                "annual": STRIPE_PRICES["basic"]["annual_amount"],
            },
            "plus": {
                "name": STRIPE_PRICES["plus"]["name"],
                "monthly": STRIPE_PRICES["plus"]["monthly_amount"],
                "annual": STRIPE_PRICES["plus"]["annual_amount"],
            },
        }
        if is_saas()
        else None,
    }


def get_mobile_capabilities(enabled_providers=None):
    """Return the pre-auth compatibility and feature envelope for mobile apps."""
    if enabled_providers is None:
        enabled_providers = get_enabled_oauth_providers()

    return {
        "mobile_contract_version": MOBILE_CONTRACT_VERSION,
        "server_version": SERVER_VERSION,
        "minimum_mobile_version": MINIMUM_MOBILE_VERSION,
        "deployment_mode": DEPLOYMENT_MODE,
        "default_currency": DEFAULT_CURRENCY,
        "default_locale": DEFAULT_LOCALE,
        "oauth_providers": list(enabled_providers),
        "features": {
            "registration": ENABLE_REGISTRATION,
            "email": EMAIL_ENABLED,
            "email_verification": REQUIRE_EMAIL_VERIFICATION,
            "oauth": bool(enabled_providers),
            "email_otp": ENABLE_2FA,
            "passkeys": ENABLE_PASSKEYS,
            "billing": ENABLE_BILLING,
            "administration": True,
            "sharing": True,
            "settlements": True,
            "telemetry": True,
            "delta_sync": True,
            "idempotent_mutations": True,
            "optimistic_concurrency": True,
        },
    }
