"""Focused tests for deployment currency and monetary precision contracts."""

import os
import subprocess
import sys
from decimal import Decimal
from pathlib import Path

import pytest

import config
import percentage as percentage_validation
from validation import validate_amount


SERVER_ROOT = Path(__file__).resolve().parents[1]
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


def _import_config(default_currency: str) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["DEFAULT_CURRENCY"] = default_currency
    return subprocess.run(
        [sys.executable, "-c", "import config; print(config.DEFAULT_CURRENCY)"],
        cwd=SERVER_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
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


def test_default_currency_is_normalized_during_startup():
    result = _import_config("  krw  ")

    assert result.returncode == 0
    assert result.stdout.strip() == "KRW"


@pytest.mark.parametrize(
    ("configured_value", "expected_error"),
    [
        ("   ", "DEFAULT_CURRENCY cannot be empty"),
        ("BTC", "DEFAULT_CURRENCY must be one of"),
    ],
)
def test_invalid_default_currency_fails_startup_clearly(
    configured_value, expected_error
):
    result = _import_config(configured_value)

    assert result.returncode != 0
    assert expected_error in result.stderr


@pytest.mark.parametrize("currency", ["JPY", "KRW"])
def test_zero_minor_unit_currencies_reject_meaningful_fractions(
    monkeypatch, currency
):
    monkeypatch.setattr(config, "DEFAULT_CURRENCY", currency)

    is_valid, error = validate_amount("12.01")

    assert is_valid is False
    assert currency in error


@pytest.mark.parametrize(
    "currency", [currency for currency in EXPECTED_CURRENCIES if currency not in {"JPY", "KRW"}]
)
def test_two_minor_unit_currencies_accept_two_meaningful_decimals(
    monkeypatch, currency
):
    monkeypatch.setattr(config, "DEFAULT_CURRENCY", currency)

    assert validate_amount("12.34") == (True, None)


@pytest.mark.parametrize(
    "currency", [currency for currency in EXPECTED_CURRENCIES if currency not in {"JPY", "KRW"}]
)
def test_two_minor_unit_currencies_reject_more_than_two_meaningful_decimals(
    monkeypatch, currency
):
    monkeypatch.setattr(config, "DEFAULT_CURRENCY", currency)

    assert validate_amount("12.345") == (
        False,
        "Amount cannot have more than 2 decimal places",
    )


@pytest.mark.parametrize(
    ("currency", "amount"),
    [("USD", "12.3400"), ("JPY", "12.000")],
)
def test_insignificant_trailing_zeroes_are_valid(monkeypatch, currency, amount):
    monkeypatch.setattr(config, "DEFAULT_CURRENCY", currency)

    assert validate_amount(amount) == (True, None)


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
