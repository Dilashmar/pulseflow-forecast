"""Forecast settings. Change these here, never in pipeline logic."""

from datetime import date
from decimal import Decimal

AS_OF_DATE = date(2026, 10, 15)
BOARD_TARGET = Decimal("12000000")
FORECAST_QUARTER = "Q4-2026"

# GPA weights in hundredths (0.20 / 0.20 / 0.60), so GPA x100 stays an exact integer.
GPA_WEIGHTS = {"leadership": 20, "commercial": 20, "contractual": 60}
