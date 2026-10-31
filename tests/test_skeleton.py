import importlib

import pytest

MODULES = ["config", "load", "standardize", "checks", "forecast", "week_over_week", "run"]


@pytest.mark.parametrize("name", MODULES)
def test_pipeline_module_imports(name):
    importlib.import_module(f"pipeline.{name}")
