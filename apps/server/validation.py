"""Input validation helpers for API endpoints."""

import re
from datetime import datetime
from typing import Tuple, Optional


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


def validate_amount(amount: any) -> Tuple[bool, Optional[str]]:
    """
    Validate monetary amount.

    Rules:
    - Must be a number
    - Must be positive (> 0)
    - Maximum 2 decimal places
    - Cannot exceed 1 billion

    Returns:
        Tuple of (is_valid, error_message)
    """
    if amount is None:
        return True, None  # Amount can be None for variable bills

    try:
        amount_float = float(amount)
    except (TypeError, ValueError):
        return False, "Amount must be a valid number"

    if amount_float <= 0:
        return False, "Amount must be greater than 0"

    if amount_float > 1_000_000_000:
        return False, "Amount cannot exceed 1 billion"

    # Check decimal places
    amount_str = str(amount_float)
    if '.' in amount_str:
        decimal_places = len(amount_str.split('.')[1])
        if decimal_places > 2:
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
    valid_frequencies = ['weekly', 'bi-weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom']

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
