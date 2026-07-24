"""Deployment currency amount operations."""

from decimal import ROUND_HALF_UP, Decimal

import config


def quantize_currency_amount(amount: Decimal | int | float | str) -> Decimal:
    """Round an amount to the deployment currency's minor units."""
    minor_units = config.CURRENCY_MINOR_UNITS[config.DEFAULT_CURRENCY]
    quantum = Decimal(1).scaleb(-minor_units)
    return Decimal(str(amount)).quantize(quantum, rounding=ROUND_HALF_UP)


def format_currency_amount(amount: Decimal | int | float | str) -> str:
    """Format an amount with its deployment currency code and precision."""
    minor_units = config.CURRENCY_MINOR_UNITS[config.DEFAULT_CURRENCY]
    quantized = quantize_currency_amount(amount)
    return f"{config.DEFAULT_CURRENCY} {quantized:.{minor_units}f}"


def currency_amount_value(amount: Decimal | int | float | str) -> float:
    """Return a JSON-safe number rounded to the deployment currency precision."""
    return float(quantize_currency_amount(amount))
