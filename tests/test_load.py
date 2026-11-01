import pandas as pd
import pytest
from openpyxl import load_workbook

from pipeline import config
from pipeline.load import InputError, load_hubspot, load_salesforce, load_vp_scorecard
from tests.helpers import read_rows, write_rows

SF_CURRENT = config.FILES["sf_current"]
SF_PRIOR = config.FILES["sf_prior"]
VP = config.FILES["vp_scorecard"]
HUBSPOT = config.FILES["hubspot"]


def test_row_counts_include_duplicates(data_dir):
    # Nothing is removed at load time; duplicates are handled by the checks.
    assert len(load_salesforce(data_dir / SF_CURRENT)) == 36
    assert len(load_salesforce(data_dir / SF_PRIOR)) == 29
    assert len(load_hubspot(data_dir / HUBSPOT)) == 14
    assert len(load_vp_scorecard(data_dir / VP)) == 8


def test_source_row_is_the_line_number_in_the_file(data_dir):
    sf = load_salesforce(data_dir / SF_CURRENT)
    assert sf.iloc[0]["source_file"] == SF_CURRENT
    assert sf.iloc[0]["source_row"] == 2  # line 1 is the header
    assert sf.iloc[0]["Opportunity_ID"] == "006PF000001L020YAC"

    vp = load_vp_scorecard(data_dir / VP)
    assert vp.iloc[0]["source_row"] == 5  # Excel row; header is row 4
    assert vp.iloc[0]["Hospital_Shorthand_Name"] == "Aethelgard Health"


def test_reordered_columns_load_the_same(data_dir, tmp_path):
    src = data_dir / SF_CURRENT
    dst = tmp_path / SF_CURRENT
    write_rows(dst, [list(reversed(row)) for row in read_rows(src)])
    pd.testing.assert_frame_equal(load_salesforce(dst), load_salesforce(src))


def test_extra_columns_are_ignored(data_dir, tmp_path):
    src = data_dir / HUBSPOT
    dst = tmp_path / HUBSPOT
    rows = read_rows(src)
    write_rows(dst, [row + (["Notes"] if i == 0 else ["x"]) for i, row in enumerate(rows)])
    pd.testing.assert_frame_equal(load_hubspot(dst), load_hubspot(src))


def test_missing_column_stops_naming_file_and_column(data_dir, tmp_path):
    rows = read_rows(data_dir / SF_CURRENT)
    i = rows[0].index("Amount")
    dst = tmp_path / SF_CURRENT
    write_rows(dst, [row[:i] + row[i + 1:] for row in rows])
    with pytest.raises(InputError, match=r"1_sfdc_pipeline_current\.csv.*Amount"):
        load_salesforce(dst)


def test_missing_file_stops(tmp_path):
    with pytest.raises(InputError, match=r"4_carebridge_hubspot_export\.csv"):
        load_hubspot(tmp_path / HUBSPOT)


def test_unreadable_workbook_stops(tmp_path):
    dst = tmp_path / VP
    dst.write_text("not a workbook")
    with pytest.raises(InputError, match=r"3_vp_deal_scorecard\.xlsx"):
        load_vp_scorecard(dst)


def test_vp_header_found_by_name_not_position(data_dir, tmp_path):
    workbook = load_workbook(data_dir / VP)
    sheet = workbook.worksheets[0]
    sheet.insert_rows(1)
    sheet["A1"] = "An extra title row"
    dst = tmp_path / VP
    workbook.save(dst)

    vp = load_vp_scorecard(dst)
    assert len(vp) == 8
    assert vp.iloc[0]["Hospital_Shorthand_Name"] == "Aethelgard Health"
    assert vp.iloc[0]["source_row"] == 6


def test_vp_missing_column_stops_naming_file_and_column(data_dir, tmp_path):
    workbook = load_workbook(data_dir / VP)
    sheet = workbook.worksheets[0]
    header = [cell.value for cell in sheet[4]]
    sheet.delete_cols(header.index("Contractual_Score") + 1)
    dst = tmp_path / VP
    workbook.save(dst)
    with pytest.raises(InputError, match=r"3_vp_deal_scorecard\.xlsx.*Contractual_Score"):
        load_vp_scorecard(dst)
