from decimal import Decimal

import pytest

from pipeline.forecast import (
    UnknownBillingFrequency,
    annual_acv,
    gpa,
    gpa_x100,
    normalize_billing_frequency,
    product_line,
    round_gpa,
    win_probability,
)


def test_gpa_is_exact_integer_math():
    assert gpa_x100(4, 4, 3) == 340
    assert isinstance(gpa_x100(4, 4, 3), int)
    assert gpa(340) == Decimal("3.40")


@pytest.mark.parametrize("x100, expected", [
    (400, "0.75"), (320, "0.75"),  # GPA >= 3.20
    (300, "0.50"), (240, "0.50"),  # 2.40 <= GPA < 3.20
    (220, "0.30"), (160, "0.30"),  # 1.60 <= GPA < 2.40
    (140, "0.10"), (100, "0.10"),  # GPA < 1.60
])
def test_win_probability_cutoffs(x100, expected):
    assert win_probability(x100) == Decimal(expected)


def test_round_gpa_half_up():
    assert round_gpa(Decimal("3.395")) == Decimal("3.40")
    assert round_gpa(Decimal("3.2")) == Decimal("3.20")


def test_product_lines():
    assert {product_line(p) for p in ["PulseOR", "BedFlow", "InfusionIQ"]} == {"Core Salesforce"}
    assert product_line("CareBridge") == "Acquired CareBridge"
    assert product_line("SurgiSync") == "Other"


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
