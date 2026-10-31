from pathlib import Path

import pytest

# Frozen copy of the 2026-10-15 week's files. SPEC 7.2 expected results are
# tied to these, so tests never read data/raw/ (which changes every week).
FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def data_dir():
    return FIXTURES_DIR
