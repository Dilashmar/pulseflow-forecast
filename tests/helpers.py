"""Helpers for building modified copies of the fixture files."""

import csv
import shutil

from openpyxl import load_workbook


def copy_fixtures(data_dir, dst_dir):
    """Copy all fixture files so a test can modify one without touching the originals."""
    dst_dir.mkdir(parents=True, exist_ok=True)
    for path in data_dir.iterdir():
        if path.is_file():
            shutil.copy(path, dst_dir / path.name)
    return dst_dir


def read_rows(path):
    with open(path, newline="") as f:
        return list(csv.reader(f))


def write_rows(path, rows):
    with open(path, "w", newline="") as f:
        csv.writer(f).writerows(rows)


def edit_csv_cell(src, dst, data_row, column, value):
    """Copy src to dst with one cell changed. data_row 0 = first row after the header."""
    rows = read_rows(src)
    rows[data_row + 1][rows[0].index(column)] = value
    write_rows(dst, rows)


def edit_vp_cell(src, dst, data_row, column, value, header_row=4):
    """Copy the VP workbook with one cell changed. data_row 0 = first row after the header."""
    workbook = load_workbook(src)
    sheet = workbook.worksheets[0]
    header = [cell.value for cell in sheet[header_row]]
    # Assign .value directly: sheet.cell(..., value=None) would leave the cell unchanged.
    sheet.cell(row=header_row + 1 + data_row, column=header.index(column) + 1).value = value
    workbook.save(dst)
