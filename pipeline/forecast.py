"""All forecast math: ACV, GPA, buckets, totals (SPEC section 3).

Mirrored in dashboard/src/forecast.ts for the what-if changes.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

import pandas as pd

from pipeline import config

# Billing frequency -> months billed per year (D7).
ACV_MULTIPLIERS = {"Monthly": 12, "Annual": 1}

CLOSED_LOST = "Closed Lost"

TOP = "Top"
LONGTAIL = "Longtail"
CORE = "Core Salesforce"
CAREBRIDGE = "Acquired CareBridge"
OTHER = "Other"

# GPA x100 cutoff -> win probability (SPEC 3.3), highest first. GPA x100 is an
# exact integer (20L + 20C + 60K), so 3.20 / 2.40 / 1.60 compare exactly.
WIN_PROBABILITY_CUTOFFS = [
    (320, Decimal("0.75")),
    (240, Decimal("0.50")),
    (160, Decimal("0.30")),
    (0, Decimal("0.10")),
]

ZERO = Decimal("0")

FORECAST_FIELDS = [
    "bucket", "product_line", "win_probability", "expected_value",
    "leadership_score", "commercial_score", "contractual_score", "gpa",
    "vp_win_probability", "vp_expected_value", "vp_rank", "vp_notes",
]


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


def expected_value(acv: Decimal, probability: Decimal) -> Decimal:
    return acv * probability


def stage_expected_value(deal) -> Decimal:
    """Longtail expected value (SPEC 3.4): annual ACV x stage probability."""
    return expected_value(deal["annual_acv"], deal["stage_probability"])


# --- GPA (SPEC 3.3) ---------------------------------------------------------------

def gpa_x100(leadership: int, commercial: int, contractual: int) -> int:
    weights = config.GPA_WEIGHTS
    return (weights["leadership"] * leadership
            + weights["commercial"] * commercial
            + weights["contractual"] * contractual)


def gpa(x100: int) -> Decimal:
    """GPA for display, e.g. 340 -> 3.40."""
    return (Decimal(x100) / 100).quantize(Decimal("0.01"))


def round_gpa(value: Decimal) -> Decimal:
    """Round a GPA from elsewhere (the VP sheet) half up to 2 decimals before comparing."""
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def win_probability(x100: int) -> Decimal:
    for cutoff, probability in WIN_PROBABILITY_CUTOFFS:
        if x100 >= cutoff:
            return probability
    return WIN_PROBABILITY_CUTOFFS[-1][1]


def vp_row_gpa_x100(vp_row) -> int:
    return gpa_x100(vp_row["leadership_score"], vp_row["commercial_score"], vp_row["contractual_score"])


def product_line(product) -> str:
    return config.PRODUCT_LINES.get(product, OTHER)


# --- Buckets and totals (SPEC 3.3-3.5) ---------------------------------------------

@dataclass
class Totals:
    top: Decimal
    core_longtail: Decimal
    carebridge_longtail: Decimal
    other_longtail: Decimal
    longtail: Decimal
    total: Decimal
    target: Decimal
    variance: Decimal            # total - target; negative = short of target
    percent_of_target: Decimal   # 1 decimal, half up
    top_count: int
    core_count: int
    carebridge_count: int
    other_count: int
    past_due_exposure: Decimal   # expected value on past-due deals (D9)


@dataclass
class Forecast:
    deals: pd.DataFrame          # every deal with FORECAST_FIELDS; excluded deals at $0, no bucket
    totals: Totals               # formula (default)
    totals_vp: Totals            # VP override applied


def build_forecast(deals, top_matches):
    """deals: cleaned deals from checks. top_matches: deal_id -> VP row, for
    matched, active Q4 deals (D4). Those are Top; every other deal in the
    forecast is Longtail."""
    rows = []
    for deal in deals.to_dict("records"):
        row = {**deal, **dict.fromkeys(FORECAST_FIELDS)}
        row["product_line"] = product_line(deal["product"])
        vp = top_matches.get(deal["deal_id"])
        if not deal["in_forecast"]:
            row["expected_value"] = ZERO
        elif vp is not None:
            x100 = vp_row_gpa_x100(vp)
            probability = win_probability(x100)
            # VP override (SPEC 3.3): the sheet's own number, or the formula's if the sheet's is unusable.
            vp_probability = vp["sheet_win_probability"]
            if vp_probability is None:
                vp_probability = probability
            row.update(
                bucket=TOP,
                win_probability=probability,
                expected_value=expected_value(deal["annual_acv"], probability),
                leadership_score=vp["leadership_score"],
                commercial_score=vp["commercial_score"],
                contractual_score=vp["contractual_score"],
                gpa=gpa(x100),
                vp_win_probability=vp_probability,
                vp_expected_value=expected_value(deal["annual_acv"], vp_probability),
                vp_rank=vp["rank"],
                vp_notes=vp["vp_notes"],
            )
        else:
            row.update(
                bucket=LONGTAIL,
                win_probability=deal["stage_probability"],
                expected_value=stage_expected_value(deal),
            )
        rows.append(row)

    _check_buckets(rows, top_matches)
    return Forecast(
        deals=pd.DataFrame(rows, columns=list(deals.columns) + FORECAST_FIELDS, dtype=object),
        totals=compute_totals(rows),
        totals_vp=compute_totals(rows, use_vp=True),
    )


def compute_totals(rows, use_vp=False):
    def value(row):
        if use_vp and row["bucket"] == TOP:
            return row["vp_expected_value"]
        return row["expected_value"]

    def total(rows_):
        return sum((value(r) for r in rows_), ZERO)

    top = [r for r in rows if r["bucket"] == TOP]
    longtail = {line: [r for r in rows if r["bucket"] == LONGTAIL and r["product_line"] == line]
                for line in (CORE, CAREBRIDGE, OTHER)}
    grand_total = total(top) + sum((total(v) for v in longtail.values()), ZERO)
    target = config.BOARD_TARGET
    return Totals(
        top=total(top),
        core_longtail=total(longtail[CORE]),
        carebridge_longtail=total(longtail[CAREBRIDGE]),
        other_longtail=total(longtail[OTHER]),
        longtail=grand_total - total(top),
        total=grand_total,
        target=target,
        variance=grand_total - target,
        percent_of_target=(grand_total / target * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP),
        top_count=len(top),
        core_count=len(longtail[CORE]),
        carebridge_count=len(longtail[CAREBRIDGE]),
        other_count=len(longtail[OTHER]),
        past_due_exposure=total(r for r in rows if r["bucket"] and "past_due" in r["flags"]),
    )


def _check_buckets(rows, top_matches):
    """SPEC 3.5: no deal in both buckets, no deal counted twice."""
    counted = [r["deal_id"] for r in rows if r["bucket"]]
    if len(counted) != len(set(counted)):
        raise ValueError("A deal is counted more than once in the forecast")
    top = {r["deal_id"] for r in rows if r["bucket"] == TOP}
    if top != set(top_matches):
        raise ValueError("Top matches don't line up with active Q4 deals")
