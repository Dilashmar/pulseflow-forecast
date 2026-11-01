"""All forecast math: ACV, GPA, buckets, totals."""

from decimal import Decimal

from pipeline import config

# Billing frequency -> months billed per year (D7).
ACV_MULTIPLIERS = {"Monthly": 12, "Annual": 1}

CLOSED_LOST = "Closed Lost"


class UnknownBillingFrequency(ValueError):
    """Billing frequency is not Monthly or Annual. The row is set aside for review."""


def normalize_billing_frequency(value):
    """Return "Monthly" or "Annual", ignoring surrounding spaces and case."""
    text = (value or "").strip().lower()
    for name in ACV_MULTIPLIERS:
        if name.lower() == text:
            return name
    raise UnknownBillingFrequency(f"unknown billing frequency {value!r} (expected Monthly or Annual)")


def annual_acv(amount: Decimal, billing_frequency: str) -> Decimal:
    return amount * ACV_MULTIPLIERS[normalize_billing_frequency(billing_frequency)]


def is_active_q4(deal) -> bool:
    """SPEC 3.1: in the forecast quarter and not Closed Lost."""
    return deal["fiscal_period"] == config.FORECAST_QUARTER and deal["stage"] != CLOSED_LOST


def stage_expected_value(deal) -> Decimal:
    """Longtail expected value (SPEC 3.4): annual ACV x stage probability."""
    return deal["annual_acv"] * deal["stage_probability"]
