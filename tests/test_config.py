from datetime import date
from decimal import Decimal

from pipeline import config


def test_as_of_date():
    assert config.AS_OF_DATE == date(2026, 10, 15)


def test_board_target_is_exact_decimal():
    assert config.BOARD_TARGET == Decimal("12000000")
    assert isinstance(config.BOARD_TARGET, Decimal)


def test_forecast_quarter():
    assert config.FORECAST_QUARTER == "Q4-2026"


def test_gpa_weights_are_integer_hundredths():
    # GPA x100 = 20*L + 20*C + 60*K, compared against integer cutoffs (320/240/160).
    assert config.GPA_WEIGHTS == {"leadership": 20, "commercial": 20, "contractual": 60}
    assert all(isinstance(w, int) for w in config.GPA_WEIGHTS.values())
    assert sum(config.GPA_WEIGHTS.values()) == 100
