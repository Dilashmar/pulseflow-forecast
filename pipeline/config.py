"""Forecast settings. Change these here, never in pipeline logic."""

from datetime import date
from decimal import Decimal

AS_OF_DATE = date(2026, 10, 15)
BOARD_TARGET = Decimal("12000000")
FORECAST_QUARTER = "Q4-2026"

# GPA weights in hundredths (0.20 / 0.20 / 0.60), so GPA x100 stays an exact integer.
GPA_WEIGHTS = {"leadership": 20, "commercial": 20, "contractual": 60}

# Standard probability for each Salesforce stage (D11).
STAGE_PROBABILITIES = {
    "Introduction": Decimal("0.20"),
    "Technical Validation": Decimal("0.40"),
    "Business Approval": Decimal("0.60"),
    "Contract Negotiations": Decimal("0.80"),
    "Closed Won": Decimal("1.00"),
    "Closed Lost": Decimal("0.00"),
}

# Input file names inside the --data folder. Each week's files keep these names.
FILES = {
    "sf_current": "1_sfdc_pipeline_current.csv",
    "sf_prior": "2_sfdc_pipeline_prior_week.csv",
    "vp_scorecard": "3_vp_deal_scorecard.xlsx",
    "hubspot": "4_carebridge_hubspot_export.csv",
}
