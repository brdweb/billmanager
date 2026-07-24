"""Percentage parsing independent of deployment currency."""

from decimal import Decimal, InvalidOperation
from typing import Final, NewType


Percentage = NewType("Percentage", Decimal)
PERCENTAGE_QUANTUM: Final = Decimal("0.01")


def validate_percentage(
    percentage: Decimal | int | float | str | bool | None,
) -> tuple[Percentage | None, str | None]:
    """Parse a percentage with storage-compatible bounds and precision."""
    if percentage is None or type(percentage) is bool:
        return None, "Percentage must be a valid number"

    try:
        percentage_decimal = Decimal(str(percentage))
    except (InvalidOperation, TypeError, ValueError):
        return None, "Percentage must be a valid number"

    if not percentage_decimal.is_finite():
        return None, "Percentage must be a valid number"
    if percentage_decimal < 0 or percentage_decimal > 100:
        return None, "Percentage must be between 0 and 100"
    if percentage_decimal != percentage_decimal.quantize(PERCENTAGE_QUANTUM):
        return None, "Percentage cannot have more than 2 decimal places"

    return Percentage(percentage_decimal), None
