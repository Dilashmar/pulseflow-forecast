from decimal import Decimal

import pytest

from pipeline.forecast import UnknownBillingFrequency, annual_acv, normalize_billing_frequency


def test_monthly_amount_times_12():
    assert annual_acv(Decimal("15000"), "Monthly") == Decimal("180000")


def test_annual_amount_unchanged():
    assert annual_acv(Decimal("210000"), "Annual") == Decimal("210000")


def test_annual_acv_stays_decimal():
    assert isinstance(annual_acv(Decimal("8000"), "Monthly"), Decimal)


@pytest.mark.parametrize("value, expected", [(" monthly ", "Monthly"), ("ANNUAL", "Annual")])
def test_billing_frequency_trimmed_and_case_insensitive(value, expected):
    assert normalize_billing_frequency(value) == expected


@pytest.mark.parametrize("value", ["Quarterly", "", None])
def test_unknown_billing_frequency_raises(value):
    with pytest.raises(UnknownBillingFrequency):
        normalize_billing_frequency(value)
