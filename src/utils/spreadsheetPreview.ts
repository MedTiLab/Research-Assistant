export type SpreadsheetCellValue = string | number | boolean | Date | null;
export type SpreadsheetRow = SpreadsheetCellValue[];

export function getSpreadsheetColumnLabel(columnIndex: number): string {
  if (!Number.isInteger(columnIndex) || columnIndex < 0) {
    return '';
  }

  let index = columnIndex + 1;
  let label = '';
  while (index > 0) {
    const remainder = (index - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    index = Math.floor((index - 1) / 26);
  }
  return label;
}

export function getSpreadsheetColumnCount(rows: SpreadsheetRow[]): number {
  return rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
}

export function formatSpreadsheetCell(value: SpreadsheetCellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const isoValue = value.toISOString();
    return isoValue.endsWith('T00:00:00.000Z') ? isoValue.slice(0, 10) : isoValue.replace('.000Z', 'Z');
  }
  return String(value);
}
