EXPECTED_FILES = [
    "1_sfdc_pipeline_current.csv",
    "2_sfdc_pipeline_prior_week.csv",
    "3_vp_deal_scorecard.xlsx",
    "4_carebridge_hubspot_export.csv",
]


def test_fixture_files_present(data_dir):
    for name in EXPECTED_FILES:
        assert (data_dir / name).is_file(), name
