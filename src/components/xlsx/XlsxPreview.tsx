import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import {
  formatSpreadsheetCell,
  getSpreadsheetColumnCount,
  getSpreadsheetColumnLabel,
  type SpreadsheetRow,
} from '../../utils/spreadsheetPreview';

const MAX_PREVIEW_ROWS = 500;
const MAX_PREVIEW_COLUMNS = 80;

type WorkbookSheet = {
  sheet: string;
  data: SpreadsheetRow[];
};

type XlsxPreviewProps = {
  arrayBuffer: ArrayBuffer;
  compact?: boolean;
};

export default function XlsxPreview({ arrayBuffer, compact = false }: XlsxPreviewProps) {
  const { t } = useTranslation('chat');
  const [sheets, setSheets] = useState<WorkbookSheet[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSheets([]);
    setActiveSheetIndex(0);
    setLoading(true);
    setError(null);

    const parseWorkbook = async () => {
      try {
        const { default: readExcelFile } = await import('read-excel-file/browser');
        const parsedSheets = await readExcelFile(arrayBuffer);
        if (!cancelled) {
          setSheets(parsedSheets as WorkbookSheet[]);
        }
      } catch (parseError) {
        if (!cancelled) {
          setError(parseError instanceof Error ? parseError.message : String(parseError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void parseWorkbook();
    return () => {
      cancelled = true;
    };
  }, [arrayBuffer]);

  const activeSheet = sheets[activeSheetIndex] || null;
  const columnCount = useMemo(
    () => getSpreadsheetColumnCount(activeSheet?.data || []),
    [activeSheet],
  );
  const visibleColumnCount = Math.min(columnCount, MAX_PREVIEW_COLUMNS);
  const visibleRows = (activeSheet?.data || []).slice(0, MAX_PREVIEW_ROWS);
  const isLimited = (activeSheet?.data.length || 0) > MAX_PREVIEW_ROWS || columnCount > MAX_PREVIEW_COLUMNS;

  if (loading) {
    return (
      <div className="flex h-full min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('sessionContext.preview.xlsx.parsing')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center px-5 text-center">
        <FileSpreadsheet className="h-8 w-8 text-muted-foreground/60" />
        <div className="mt-3 text-sm font-medium text-foreground">
          {t('sessionContext.preview.xlsx.errorTitle')}
        </div>
        <div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
          {t('sessionContext.preview.xlsx.errorHint', { error })}
        </div>
      </div>
    );
  }

  if (!activeSheet) {
    return (
      <div className="flex h-full min-h-40 items-center justify-center px-4 text-sm text-muted-foreground">
        {t('sessionContext.preview.xlsx.emptyWorkbook')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className={cn(
        'flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 bg-muted/25',
        compact ? 'px-2 py-1.5' : 'px-3 py-2',
      )}>
        <span className="mr-1 flex-shrink-0 text-[11px] font-medium text-muted-foreground">
          {t('sessionContext.preview.xlsx.worksheets')}
        </span>
        {sheets.map((sheet, index) => (
          <Button
            key={`${sheet.sheet}-${index}`}
            type="button"
            size="sm"
            variant={index === activeSheetIndex ? 'secondary' : 'ghost'}
            className={cn(
              'h-7 flex-shrink-0 rounded-md px-2 text-xs',
              index === activeSheetIndex && 'bg-background font-semibold shadow-sm',
            )}
            title={sheet.sheet}
            onClick={() => setActiveSheetIndex(index)}
          >
            <span className="max-w-48 truncate">{sheet.sheet}</span>
          </Button>
        ))}
      </div>

      {isLimited ? (
        <div className="flex-shrink-0 border-b border-border/60 bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
          {t('sessionContext.preview.xlsx.limitNotice', {
            rows: Math.min(activeSheet.data.length, MAX_PREVIEW_ROWS),
            columns: visibleColumnCount,
          })}
        </div>
      ) : null}

      {columnCount === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
          {t('sessionContext.preview.xlsx.emptySheet')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-background">
          <table className="border-separate border-spacing-0 text-left font-sans text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-12 border-b border-r border-border bg-muted px-2 py-2 text-center font-medium text-muted-foreground">
                  #
                </th>
                {Array.from({ length: visibleColumnCount }, (_, columnIndex) => (
                  <th
                    key={`xlsx-column-${columnIndex}`}
                    className="sticky top-0 z-20 min-w-28 max-w-[18rem] border-b border-r border-border bg-muted px-3 py-2 text-center font-semibold text-foreground"
                  >
                    {getSpreadsheetColumnLabel(columnIndex)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, rowIndex) => (
                <tr key={`xlsx-row-${rowIndex}`} className="odd:bg-background even:bg-muted/20 hover:bg-primary/5">
                  <th className="sticky left-0 z-10 border-b border-r border-border bg-inherit px-2 py-1.5 text-center font-mono text-[11px] font-normal text-muted-foreground">
                    {rowIndex + 1}
                  </th>
                  {Array.from({ length: visibleColumnCount }, (_, columnIndex) => {
                    const value = formatSpreadsheetCell(row[columnIndex] ?? null);
                    return (
                      <td
                        key={`xlsx-cell-${rowIndex}-${columnIndex}`}
                        className="max-w-[18rem] whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-foreground"
                        title={value}
                      >
                        <div className="max-w-[18rem] truncate">{value}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
