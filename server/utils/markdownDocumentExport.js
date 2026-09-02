import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { renderMarkdownPdf } from './markdownPdfExport.js';

const A4_WIDTH_DXA = 11906;
const A4_HEIGHT_DXA = 16838;
const PAGE_MARGIN_DXA = 1440;
const CONTENT_WIDTH_DXA = A4_WIDTH_DXA - PAGE_MARGIN_DXA * 2;
const MAX_MARKDOWN_EXPORT_BYTES = 5 * 1024 * 1024;

const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'D6DCE5' };
const TABLE_BORDERS = {
  top: TABLE_BORDER,
  bottom: TABLE_BORDER,
  left: TABLE_BORDER,
  right: TABLE_BORDER,
  insideHorizontal: TABLE_BORDER,
  insideVertical: TABLE_BORDER,
};

function stripFrontmatter(markdown) {
  const normalized = String(markdown || '').replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---\n') && !normalized.startsWith('---\r\n')) {
    return normalized;
  }

  const lines = normalized.split(/\r?\n/);
  const closingIndex = lines.slice(1).findIndex((line) => /^---\s*$/.test(line));
  return closingIndex >= 0 ? lines.slice(closingIndex + 2).join('\n') : normalized;
}

function normalizeMarkdownText(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, '$1');
}

function isExternalLink(value) {
  return /^(?:https?:\/\/|mailto:)/i.test(String(value || '').trim());
}

function buildInlineRuns(input, inherited = {}) {
  const text = normalizeMarkdownText(input);
  const tokenPattern = /(\!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*\*([^*]+)\*\*\*|___([^_]+)___|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_)/g;
  const runs = [];
  let cursor = 0;
  let match;

  const pushText = (value, style = {}) => {
    if (!value) return;
    const segments = String(value).split('\n');
    segments.forEach((segment, index) => {
      if (segment) {
        runs.push(new TextRun({ text: segment, ...inherited, ...style }));
      }
      if (index < segments.length - 1) {
        runs.push(new TextRun({ break: 1, ...inherited, ...style }));
      }
    });
  };

  while ((match = tokenPattern.exec(text)) !== null) {
    pushText(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    if (match[2] !== undefined) {
      const alt = match[2].trim() || 'Image';
      const target = match[3];
      if (isExternalLink(target)) {
        runs.push(new ExternalHyperlink({
          link: target,
          children: [new TextRun({ text: `[Image: ${alt}]`, style: 'Hyperlink', ...inherited })],
        }));
      } else {
        pushText(`[Image: ${alt}] (${target})`, { italics: true, color: '666666' });
      }
    } else if (match[4] !== undefined) {
      const label = match[4];
      const target = match[5];
      if (isExternalLink(target)) {
        runs.push(new ExternalHyperlink({
          link: target,
          children: [new TextRun({ text: label, style: 'Hyperlink', ...inherited })],
        }));
      } else {
        pushText(`${label} (${target})`);
      }
    } else if (match[6] !== undefined || match[7] !== undefined) {
      pushText(match[6] ?? match[7], { bold: true, italics: true });
    } else if (match[8] !== undefined || match[9] !== undefined) {
      pushText(match[8] ?? match[9], { bold: true });
    } else if (match[10] !== undefined) {
      pushText(match[10], { strike: true });
    } else if (match[11] !== undefined) {
      pushText(match[11], { font: 'Courier New', size: 20, shading: { fill: 'EEF1F5', type: ShadingType.CLEAR } });
    } else {
      pushText(match[12] ?? match[13], { italics: true });
    }
  }

  pushText(text.slice(cursor));
  return runs.length > 0 ? runs : [new TextRun({ text: '', ...inherited })];
}

function splitTableRow(line) {
  const normalized = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  return normalized.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function isTableDelimiter(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function calculateColumnWidths(columnCount) {
  const count = Math.max(1, columnCount);
  const base = Math.floor(CONTENT_WIDTH_DXA / count);
  const widths = new Array(count).fill(base);
  widths[count - 1] += CONTENT_WIDTH_DXA - base * count;
  return widths;
}

function buildTable(rows) {
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const columnWidths = calculateColumnWidths(columnCount);
  const normalizedRows = rows.map((row, rowIndex) => (
    new TableRow({
      children: columnWidths.map((width, columnIndex) => (
        new TableCell({
          width: { size: width, type: WidthType.DXA },
          borders: TABLE_BORDERS,
          margins: { top: 90, bottom: 90, left: 120, right: 120 },
          ...(rowIndex === 0
            ? { shading: { fill: 'EAF0F7', type: ShadingType.CLEAR } }
            : {}),
          children: [new Paragraph({
            children: buildInlineRuns(row[columnIndex] || '', rowIndex === 0 ? { bold: true } : {}),
            spacing: { after: 0 },
          })],
        })
      )),
    })
  ));

  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths,
    rows: normalizedRows,
  });
}

function getHeadingLevel(depth) {
  return [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ][Math.min(6, Math.max(1, depth)) - 1];
}

function isBlockStart(lines, index) {
  const line = lines[index] || '';
  const next = lines[index + 1] || '';
  return (
    /^\s*```/.test(line)
    || /^\s{0,3}#{1,6}\s+/.test(line)
    || /^\s*>\s?/.test(line)
    || /^\s*[-+*]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || (line.includes('|') && isTableDelimiter(next))
  );
}

function markdownToDocxChildren(markdown) {
  const lines = stripFrontmatter(markdown).split(/\r?\n/);
  const children = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(/^\s*```\s*([^\s`]*)/);
    if (fenceMatch) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += index < lines.length ? 1 : 0;
      children.push(new Paragraph({
        children: [new TextRun({ text: codeLines.join('\n'), font: 'Courier New', size: 19 })],
        shading: { fill: 'F4F6F8', type: ShadingType.CLEAR },
        border: { left: { style: BorderStyle.SINGLE, size: 10, color: 'AAB4C3', space: 8 } },
        spacing: { before: 120, after: 160 },
        indent: { left: 240, right: 240 },
      }));
      continue;
    }

    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      children.push(new Paragraph({
        heading: getHeadingLevel(headingMatch[1].length),
        children: buildInlineRuns(headingMatch[2]),
      }));
      index += 1;
      continue;
    }

    if (line.includes('|') && isTableDelimiter(lines[index + 1] || '')) {
      const rows = [splitTableRow(line)];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      children.push(buildTable(rows));
      children.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }

    const unorderedMatch = line.match(/^(\s*)[-+*]\s+(.+)$/);
    const orderedMatch = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      const match = unorderedMatch || orderedMatch;
      const level = Math.min(3, Math.floor((match?.[1]?.replace(/\t/g, '    ').length || 0) / 2));
      children.push(new Paragraph({
        numbering: {
          reference: unorderedMatch ? 'markdown-bullets' : 'markdown-numbers',
          level,
        },
        children: buildInlineRuns(match?.[2] || ''),
        spacing: { after: 60 },
      }));
      index += 1;
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      const quoteLines = [];
      while (index < lines.length) {
        const currentMatch = lines[index].match(/^\s*>\s?(.*)$/);
        if (!currentMatch) break;
        quoteLines.push(currentMatch[1]);
        index += 1;
      }
      children.push(new Paragraph({
        children: buildInlineRuns(quoteLines.join(' '), { italics: true, color: '4B5563' }),
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: '8FA3BF', space: 10 } },
        indent: { left: 360, right: 180 },
        spacing: { before: 80, after: 120 },
      }));
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      children.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C7CED8', space: 1 } },
        spacing: { before: 100, after: 140 },
      }));
      index += 1;
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    children.push(new Paragraph({
      children: buildInlineRuns(paragraphLines.join(' ')),
      spacing: { after: 140, line: 300 },
    }));
  }

  return children.length > 0 ? children : [new Paragraph('')];
}

function createNumberingLevels(format, text) {
  return new Array(4).fill(null).map((_, level) => ({
    level,
    format,
    text: format === LevelFormat.DECIMAL ? `%${level + 1}.` : text,
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: {
        indent: { left: 720 + level * 360, hanging: 360 },
      },
    },
  }));
}

async function markdownToDocxBuffer(markdown, { title = 'Document' } = {}) {
  const source = String(markdown || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_MARKDOWN_EXPORT_BYTES) {
    const error = new Error('Markdown file is too large to export (maximum 5 MB).');
    error.statusCode = 413;
    throw error;
  }

  const document = new Document({
    creator: 'MedHelp',
    title,
    description: 'Exported from Markdown by MedHelp',
    styles: {
      default: { document: { run: { font: 'Arial', size: 22, color: '111827' } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Arial', size: 34, bold: true, color: '111827' }, paragraph: { spacing: { before: 280, after: 180 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Arial', size: 30, bold: true, color: '1F2937' }, paragraph: { spacing: { before: 240, after: 140 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Arial', size: 26, bold: true, color: '374151' }, paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: 'markdown-bullets', levels: createNumberingLevels(LevelFormat.BULLET, '•') },
        { reference: 'markdown-numbers', levels: createNumberingLevels(LevelFormat.DECIMAL, '%1.') },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: A4_WIDTH_DXA, height: A4_HEIGHT_DXA },
          margin: { top: PAGE_MARGIN_DXA, right: PAGE_MARGIN_DXA, bottom: PAGE_MARGIN_DXA, left: PAGE_MARGIN_DXA },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Page ', color: '6B7280', size: 18 }),
              new TextRun({ children: [PageNumber.CURRENT], color: '6B7280', size: 18 }),
            ],
          })],
        }),
      },
      children: markdownToDocxChildren(source),
    }],
  });

  return Packer.toBuffer(document);
}

async function markdownToPdfBuffer(markdown, { title = 'Document' } = {}) {
  const source = String(markdown || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_MARKDOWN_EXPORT_BYTES) {
    const error = new Error('Markdown file is too large to export (maximum 5 MB).');
    error.statusCode = 413;
    throw error;
  }
  return renderMarkdownPdf(source, { title });
}

export {
  MAX_MARKDOWN_EXPORT_BYTES,
  markdownToDocxBuffer,
  markdownToPdfBuffer,
};
