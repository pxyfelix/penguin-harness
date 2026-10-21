#!/usr/bin/env python3
"""Generate the colleague-facing six-column feedback workbook."""

from __future__ import annotations

import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation


HEADERS = ["编号", "能力", "实际问题", "期望结果", "严重度", "证据"]
WIDTHS = [14, 18, 48, 48, 12, 28]


def style_header(ws) -> None:
    fill = PatternFill("solid", fgColor="1D4ED8")
    for cell in ws[1]:
        cell.fill = fill
        cell.font = Font(color="FFFFFF", bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:F{max(ws.max_row, 2)}"
    ws.row_dimensions[1].height = 26


def build(output: Path) -> None:
    wb = Workbook()
    feedback = wb.active
    feedback.title = "反馈"
    feedback.append(HEADERS)
    for index, width in enumerate(WIDTHS, start=1):
        feedback.column_dimensions[chr(64 + index)].width = width
    style_header(feedback)

    capability = DataValidation(
        type="list",
        formula1='"CRF Review,SAP,Table Shell,Workflow,Other"',
        allow_blank=False,
    )
    severity = DataValidation(
        type="list",
        formula1='"Blocker,High,Normal,Low"',
        allow_blank=False,
    )
    feedback.add_data_validation(capability)
    feedback.add_data_validation(severity)
    capability.add("B2:B500")
    severity.add("E2:E500")
    for row in feedback.iter_rows(min_row=2, max_row=500, min_col=1, max_col=6):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    feedback.sheet_view.showGridLines = False

    guide = wb.create_sheet("填写说明")
    guide_rows = [
        ["字段", "填写方式"],
        ["编号", "可留空；留空时导入工具会生成稳定 ID。"],
        ["能力", "从下拉框中选择 CRF Review、SAP、Table Shell、Workflow 或 Other。"],
        ["实际问题", "必填。写清在哪个能力、什么场景下发生了什么问题。"],
        ["期望结果", "写清你希望 Agent 如何修改；不知道时可写“未确定”。"],
        ["严重度", "从下拉框中选择 Blocker、High、Normal 或 Low。"],
        ["证据", "可选。填写 Session 编号、文件名、截图名或链接。"],
        ["自动信息", "填表人、测试轮次、导入时间由管理员导入时补充，不需要手填。"],
    ]
    for row in guide_rows:
        guide.append(row)
    guide.column_dimensions["A"].width = 16
    guide.column_dimensions["B"].width = 88
    style_header(guide)
    for row in guide.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)

    example = wb.create_sheet("示例")
    example.append(HEADERS)
    example.append(
        [
            "P02-004",
            "Table Shell",
            "主要终点表没有写分析人群和时点",
            "表头或脚注明确 ITT、Week 12",
            "High",
            "P02-SHELL-R1",
        ]
    )
    for index, width in enumerate(WIDTHS, start=1):
        example.column_dimensions[chr(64 + index)].width = width
    style_header(example)
    for row in example.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)

    output.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: make-feedback-template.py <output.xlsx>")
    build(Path(sys.argv[1]))
