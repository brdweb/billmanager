"""Input validation helpers for API endpoints."""

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Tuple, Optional

import config


def validate_email(email: str) -> Tuple[bool, Optional[str]]:
    """
    Validate email format using RFC 5322 simplified regex.

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not email or not email.strip():
        return False, "Email is required"

    email = email.strip().lower()

    # RFC 5322 simplified email regex
    pattern = r'^[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'

    if not re.match(pattern, email):
        return False, "Invalid email format"

    if len(email) > 254:  # RFC 5321
        return False, "Email address too long"

    return True, None


def validate_username(username: str) -> Tuple[bool, Optional[str]]:
    """
    Validate username constraints.

    Rules:
    - Must be at least 3 characters
    - Maximum 32 characters
    - Can only contain letters, numbers, underscores, and hyphens
    - Cannot start or end with special characters

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not username or not username.strip():
        return False, "Username is required"

    username = username.strip()

    if len(username) < 3:
        return False, "Username must be at least 3 characters"

    if len(username) > 32:
        return False, "Username must be 32 characters or less"

    # Only letters, numbers, underscores, and hyphens
    if not re.match(r'^[a-zA-Z0-9_-]+$', username):
        return False, "Username can only contain letters, numbers, underscores, and hyphens"

    # Cannot start or end with special characters
    if username[0] in ('_', '-') or username[-1] in ('_', '-'):
        return False, "Username cannot start or end with special characters"

    return True, None


def validate_password(password: str) -> Tuple[bool, Optional[str]]:
    """
    Validate password strength.

    Rules:
    - Minimum 8 characters
    - Must contain at least one uppercase letter
    - Must contain at least one lowercase letter
    - Must contain at least one number

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not password:
        return False, "Password is required"

    if len(password) < 8:
        return False, "Password must be at least 8 characters"

    if len(password) > 128:
        return False, "Password must be 128 characters or less"

    if not any(c.isupper() for c in password):
        return False, "Password must contain at least one uppercase letter"

    if not any(c.islower() for c in password):
        return False, "Password must contain at least one lowercase letter"

    if not any(c.isdigit() for c in password):
        return False, "Password must contain at least one number"

    return True, None


def validate_amount(
    amount: Decimal | int | float | str | bool | None,
    *,
    allow_none: bool = False,
    allow_zero: bool = False,
    currency: str = config.DEFAULT_USER_CURRENCY,
) -> Tuple[bool, Optional[str]]:
    """
    Validate monetary amount.

    Rules:
    - Must be a number
    - Must be positive (> 0)
    - Must respect the selected user's currency minor units
    - Cannot exceed 1 billion

    Returns:
        Tuple of (is_valid, error_message)
    """
    if amount is None:
        if allow_none:
            return True, None
        return False, "Amount must be a valid number"

    if type(amount) is bool:
        return False, "Amount must be a valid number"

    try:
        amount_decimal = Decimal(str(amount))
    except (InvalidOperation, TypeError, ValueError):
        return False, "Amount must be a valid number"

    if not amount_decimal.is_finite():
        return False, "Amount must be a valid number"

    if amount_decimal < 0 or (amount_decimal == 0 and not allow_zero):
        return False, "Amount must be greater than 0"

    if amount_decimal > Decimal("1000000000"):
        return False, "Amount cannot exceed 1 billion"

    minor_units = config.CURRENCY_MINOR_UNITS[currency]
    quantum = Decimal(1).scaleb(-minor_units)
    if amount_decimal != amount_decimal.quantize(quantum):
        if minor_units == 0:
            return (
                False,
                f"Amount cannot have fractional units for {currency}",
            )
        return False, "Amount cannot have more than 2 decimal places"

    return True, None


def validate_date(date_str: str, field_name: str = "Date") -> Tuple[bool, Optional[str]]:
    """
    Validate date string format (YYYY-MM-DD).

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not date_str or not date_str.strip():
        return False, f"{field_name} is required"

    date_str = date_str.strip()

    # Check format with regex first
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        return False, f"{field_name} must be in YYYY-MM-DD format"

    # Try to parse the date
    try:
        parsed_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return False, f"Invalid {field_name.lower()}: {date_str}"

    # Check reasonable bounds (1900 - 2100)
    if parsed_date.year < 1900 or parsed_date.year > 2100:
        return False, f"{field_name} must be between 1900 and 2100"

    return True, None


def validate_frequency(frequency: str) -> Tuple[bool, Optional[str]]:
    """
    Validate bill frequency value.

    Returns:
        Tuple of (is_valid, error_message)
    """
    valid_frequencies = ['once', 'weekly', 'bi-weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom']

    if not frequency or frequency not in valid_frequencies:
        return False, f"Frequency must be one of: {', '.join(valid_frequencies)}"

    return True, None


def validate_bill_name(name: str) -> Tuple[bool, Optional[str]]:
    """
    Validate bill name.

    Rules:
    - Cannot be empty
    - Maximum 100 characters

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not name or not name.strip():
        return False, "Bill name is required"

    name = name.strip()

    if len(name) > 100:
        return False, "Bill name must be 100 characters or less"

    return True, None


def validate_category(category: Optional[str]) -> Tuple[bool, Optional[str]]:
    """
    Validate an optional bill/budget category.

    Rules:
    - Empty values are allowed for bills
    - Maximum 50 characters
    - Cannot contain control characters
    """
    if category is None:
        return True, None

    category = str(category).strip()
    if not category:
        return True, None

    if len(category) > 50:
        return False, "Category must be 50 characters or less"

    if any(ord(ch) < 32 for ch in category):
        return False, "Category contains invalid characters"

    return True, None


def validate_notes(notes: Optional[str]) -> Tuple[bool, Optional[str]]:
    """Validate optional free-text notes."""
    if notes is None:
        return True, None

    notes = str(notes)
    if len(notes) > 2000:
        return False, "Notes must be 2000 characters or less"

    return True, None


def validate_database_name(name: str) -> Tuple[bool, Optional[str]]:
    """
    Validate database/bill group name.

    Rules:
    - Must be at least 2 characters
    - Maximum 50 characters
    - Can only contain letters, numbers, underscores, and hyphens

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not name or not name.strip():
        return False, "Database name is required"

    name = name.strip()

    if len(name) < 2:
        return False, "Database name must be at least 2 characters"

    if len(name) > 50:
        return False, "Database name must be 50 characters or less"

    # Only letters, numbers, underscores, and hyphens
    if not re.match(r'^[a-zA-Z0-9_-]+$', name):
        return False, "Database name can only contain letters, numbers, underscores, and hyphens"

    return True, None
