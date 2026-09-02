import { describe, expect, it } from 'vitest';

import {
  formatSpreadsheetCell,
  getSpreadsheetColumnCount,
  getSpreadsheetColumnLabel,
} from './spreadsheetPreview';

describe('spreadsheet preview utilities', () => {
  it('creates Excel-style column labels', () => {
    expect(getSpreadsheetColumnLabel(0)).toBe('A');
    expect(getSpreadsheetColumnLabel(25)).toBe('Z');
    expect(getSpreadsheetColumnLabel(26)).toBe('AA');
    expect(getSpreadsheetColumnLabel(701)).toBe('ZZ');
  });

  it('finds the widest spreadsheet row', () => {
    expect(getSpreadsheetColumnCount([['A'], ['B', 2, true], []])).toBe(3);
    expect(getSpreadsheetColumnCount([])).toBe(0);
  });

  it('formats spreadsheet values without losing their visible value', () => {
    expect(formatSpreadsheetCell(null)).toBe('');
    expect(formatSpreadsheetCell(false)).toBe('false');
    expect(formatSpreadsheetCell(0)).toBe('0');
    expect(formatSpreadsheetCell(new Date('2026-08-21T00:00:00.000Z'))).toBe('2026-08-21');
  });
});
