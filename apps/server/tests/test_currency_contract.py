"""Focused tests for user currency and monetary precision contracts."""

from decimal import Decimal

import pytest

import config
import percentage as percentage_validation
from validation import validate_amount


EXPECTED_CURRENCIES = (
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


def test_supported_currency_catalog_and_minor_units_are_immutable_and_ordered():
    assert config.SUPPORTED_CURRENCIES == EXPECTED_CURRENCIES
    assert tuple(config.CURRENCY_MINOR_UNITS) == EXPECTED_CURRENCIES
    assert config.CURRENCY_MINOR_UNITS["JPY"] == 0
    assert config.CURRENCY_MINOR_UNITS["KRW"] == 0
    assert all(
        config.CURRENCY_MINOR_UNITS[currency] == 2
        for currency in EXPECTED_CURRENCIES
        if currency not in {"JPY", "KRW"}
    )
    with pytest.raises(TypeError):
        config.CURRENCY_MINOR_UNITS["USD"] = 0


def test_new_users_have_a_stable_non_environment_default():
    assert config.DEFAULT_USER_CURRENCY == "USD"
    assert not hasattr(config, "DEFAULT_CURRENCY")


@pytest.mark.parametrize("currency", ["JPY", "KRW"])
def test_zero_minor_unit_currencies_reject_meaningful_fractions(currency):
    is_valid, error = validate_amount("12.01", currency=currency)

    assert is_valid is False
    assert currency in error


@pytest.mark.parametrize(
    "currency", [currency for currency in EXPECTED_CURRENCIES if currency not in {"JPY", "KRW"}]
)
def test_two_minor_unit_currencies_accept_two_meaningful_decimals(currency):
    assert validate_amount("12.34", currency=currency) == (True, None)


@pytest.mark.parametrize(
    "currency", [currency for currency in EXPECTED_CURRENCIES if currency not in {"JPY", "KRW"}]
)
def test_two_minor_unit_currencies_reject_more_than_two_meaningful_decimals(currency):
    assert validate_amount("12.345", currency=currency) == (
        False,
        "Amount cannot have more than 2 decimal places",
    )


@pytest.mark.parametrize(
    ("currency", "amount"),
    [("USD", "12.3400"), ("JPY", "12.000")],
)
def test_insignificant_trailing_zeroes_are_valid(currency, amount):
    assert validate_amount(amount, currency=currency) == (True, None)


@pytest.mark.parametrize(
    "amount",
    [True, False, float("nan"), float("inf"), "NaN", "Infinity", "", "abc", [], {}],
)
def test_malformed_or_non_finite_amounts_are_rejected(amount):
    assert validate_amount(amount) == (False, "Amount must be a valid number")


def test_none_is_only_valid_when_explicitly_allowed_for_variable_bills():
    assert validate_amount(None) == (False, "Amount must be a valid number")
    assert validate_amount(None, allow_none=True) == (True, None)


def test_zero_is_only_valid_when_explicitly_allowed_for_fixed_shares():
    assert validate_amount(0) == (False, "Amount must be greater than 0")
    assert validate_amount(0, allow_zero=True) == (True, None)


@pytest.mark.parametrize(
    ("amount", "expected_error"),
    [
        (-1, "Amount must be greater than 0"),
        (1_000_000_000.01, "Amount cannot exceed 1 billion"),
    ],
)
def test_existing_amount_bounds_remain_enforced(amount, expected_error):
    assert validate_amount(amount) == (False, expected_error)


@pytest.mark.parametrize(
    "percentage",
    [True, False, "33.33%", float("nan"), float("inf"), float("-inf"), "NaN", "Infinity"],
)
def test_percentage_validation_rejects_non_numeric_or_non_finite_values(percentage):
    parsed, error = percentage_validation.validate_percentage(percentage)

    assert parsed is None
    assert error == "Percentage must be a valid number"


@pytest.mark.parametrize(
    ("percentage", "expected"),
    [(0, Decimal("0")), ("33.33", Decimal("33.33")), (100, Decimal("100"))],
)
def test_percentage_validation_accepts_zero_to_one_hundred_with_two_decimals(
    percentage, expected
):
    parsed, error = percentage_validation.validate_percentage(percentage)

    assert parsed == expected
    assert error is None


@pytest.mark.parametrize("percentage", [-0.01, 100.01])
def test_percentage_validation_rejects_values_outside_inclusive_bounds(percentage):
    parsed, error = percentage_validation.validate_percentage(percentage)

    assert parsed is None
    assert error == "Percentage must be between 0 and 100"


def test_percentage_validation_rejects_precision_unsupported_by_storage():
    parsed, error = percentage_validation.validate_percentage("33.333")

    assert parsed is None
    assert error == "Percentage cannot have more than 2 decimal places"
