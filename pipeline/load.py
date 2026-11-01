"""Read the raw input files by column name and check required columns.

Every value is kept as text (stripped of surrounding spaces); standardize.py
converts types. Each row gets source_file and source_row (the line or Excel
row number) so audit entries can point to the exact record.
"""

from pathlib import Path
from zipfile import BadZipFile

import pandas as pd
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException

SALESFORCE_COLUMNS = [
    "Opportunity_ID", "Fiscal_Period", "Health_System", "Product", "Stage",
    "Stage_Probability", "Amount", "Billing_Frequency", "Close_Date",
    "Created_Date", "Days_In_Stage", "Sales_Rep", "Region",
]
HUBSPOT_COLUMNS = [
    "HubSpot_Deal_ID", "Fiscal_Period", "Company_Name", "Product", "Deal_Stage",
    "Stage_Probability", "Amount", "Billing_Frequency", "Expected_Close_Date", "AE_Owner",
]
VP_COLUMNS = [
    "Rank", "Opportunity_ID_15", "Hospital_Shorthand_Name", "Product", "Sales_Rep",
    "Leadership_Score", "Commercial_Score", "Contractual_Score",
    "Composite_GPA", "Win_Probability", "VP_Notes",
]


class InputError(Exception):
    """A file-level problem (missing or unreadable file, missing column). Stops the run."""


def load_salesforce(path):
    return _load_csv(Path(path), SALESFORCE_COLUMNS)


def load_hubspot(path):
    return _load_csv(Path(path), HUBSPOT_COLUMNS)


def load_vp_scorecard(path):
    """Read the first sheet. The header row is found by column name, not position."""
    path = Path(path)
    try:
        workbook = load_workbook(path, read_only=True, data_only=True)
    except FileNotFoundError:
        raise InputError(f"{path.name}: file not found") from None
    except (BadZipFile, InvalidFileException, KeyError, OSError) as e:
        raise InputError(f"{path.name}: could not read file ({e})") from e
    rows = list(workbook.worksheets[0].iter_rows(values_only=True))
    workbook.close()

    header_index = _find_header_row(path.name, rows, VP_COLUMNS)
    header = [_clean(cell) for cell in rows[header_index]]
    positions = {name: header.index(name) for name in VP_COLUMNS}

    records = []
    for excel_row, row in enumerate(rows[header_index + 1:], start=header_index + 2):
        values = {name: _clean(row[i]) if i < len(row) else None for name, i in positions.items()}
        if all(v is None for v in values.values()):
            continue
        records.append({"source_file": path.name, "source_row": excel_row, **values})
    return pd.DataFrame(records, columns=["source_file", "source_row", *VP_COLUMNS], dtype=object)


def _load_csv(path, required_columns):
    try:
        df = pd.read_csv(path, dtype=str, keep_default_na=False)
    except FileNotFoundError:
        raise InputError(f"{path.name}: file not found") from None
    except (pd.errors.ParserError, pd.errors.EmptyDataError, UnicodeDecodeError) as e:
        raise InputError(f"{path.name}: could not read file ({e})") from e

    df.columns = [str(c).strip() for c in df.columns]
    _require_columns(path.name, df.columns, required_columns)

    df = df[required_columns].astype(object).map(str.strip)
    df.insert(0, "source_row", range(2, len(df) + 2))  # line 1 is the header
    df.insert(0, "source_file", path.name)
    return df


def _require_columns(file_name, columns, required_columns):
    missing = [c for c in required_columns if c not in columns]
    if missing:
        raise InputError(f"{file_name}: missing required column(s): {', '.join(missing)}")


def _find_header_row(file_name, rows, required_columns):
    best_index, best_found = None, set()
    for i, row in enumerate(rows):
        found = {_clean(cell) for cell in row} & set(required_columns)
        if found == set(required_columns):
            return i
        if len(found) > len(best_found):
            best_index, best_found = i, found
    if best_index is None:
        raise InputError(f"{file_name}: header row not found (expected columns {', '.join(required_columns)})")
    _require_columns(file_name, best_found, required_columns)


def _clean(cell):
    if isinstance(cell, str):
        cell = cell.strip()
        return cell or None
    return cell
