#!/usr/bin/env python3
"""Export one sheet of an .xlsx file to CSV (all cells as text).
   python tools/xlsx_to_csv.py IDL_slot_plan.xlsx Master_Schedule sample/data/Roster.csv"""
import csv, sys, openpyxl
src, sheet, dst = sys.argv[1:4]
ws = openpyxl.load_workbook(src, data_only=True)[sheet]
with open(dst, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    for row in ws.iter_rows(values_only=True):
        if any(c is not None and str(c).strip() != "" for c in row):
            w.writerow(["" if c is None else (str(c).lower().capitalize() if isinstance(c, bool) else str(c)) for c in row])
print("wrote", dst)
