"""Deployment currency amount operations."""

from decimal import ROUND_HALF_UP, Decimal

import config


def quantize_currency_amount(
    amount: Decimal | int | float | str,
    currency: str = config.DEFAULT_USER_CURRENCY,
) -> Decimal:
    """Round an amount to the selected user's currency minor units."""
    minor_units = config.CURRENCY_MINOR_UNITS[currency]
    quantum = Decimal(1).scaleb(-minor_units)
    return Decimal(str(amount)).quantize(quantum, rounding=ROUND_HALF_UP)


def format_currency_amount(
    amount: Decimal | int | float | str,
    currency: str = config.DEFAULT_USER_CURRENCY,
) -> str:
    """Format an amount with the selected user's currency code and precision."""
    minor_units = config.CURRENCY_MINOR_UNITS[currency]
    quantized = quantize_currency_amount(amount, currency)
    return f"{currency} {quantized:.{minor_units}f}"


def currency_amount_value(
    amount: Decimal | int | float | str,
    currency: str = config.DEFAULT_USER_CURRENCY,
) -> float:
    """Return a JSON-safe number rounded to the selected currency precision."""
    return float(quantize_currency_amount(amount, currency))
