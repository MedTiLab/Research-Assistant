import { createRequire } from 'module';
import path from 'path';

import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
const FONT_PACKAGE_ENTRY = require.resolve('@embedpdf/fonts-sc');
const FONT_DIRECTORY = path.resolve(path.dirname(FONT_PACKAGE_ENTRY), '../fonts');
// Keep full static OTF files here. Split/variable WOFF2 fonts produced corrupted
// CJK outlines (large black shapes) in otherwise valid PDFs in some renderers.
const REGULAR_FONT_PATH = path.join(FONT_DIRECTORY, 'NotoSansHans-Regular.otf');
const BOLD_FONT_PATH = path.join(FONT_DIRECTORY, 'NotoSansHans-Bold.otf');

const A4 = [595.28, 841.89];
const PAGE_MARGIN = 54;
const FOOTER_SPACE = 34;
const BODY_SIZE = 10.5;
const BODY_LINE_HEIGHT = 16;
const CONTENT_WIDTH = A4[0] - PAGE_MARGIN * 2;

function stripFrontmatter(markdown) {
  const normalized = String(markdown || '').replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---\n') && !normalized.startsWith('---\r\n')) return normalized;
  const lines = normalized.split(/\r?\n/);
  const closingIndex = lines.slice(1).findIndex((line) => /^---\s*$/.test(line));
  return closingIndex >= 0 ? lines.slice(closingIndex + 2).join('\n') : normalized;
}

function plainMarkdownText(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, alt, target) => `[Image: ${alt || 'Image'}] (${target})`)
    .replace(/\[([^\]]+)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, label, target) => `${label} (${target})`)
    .replace(/\*\*\*([^*]+)\*\*\*|___([^_]+)___/g, '$1$2')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*\n]+)\*|_([^_\n]+)_/g, '$1$2')
    .replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, '$1');
}

function splitTableRow(line) {
  const normalized = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  return normalized.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function isTableDelimiter(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
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

function builtinFont({ bold = false, code = false } = {}) {
  if (code) return bold ? 'Courier-Bold' : 'Courier';
  return bold ? 'Helvetica-Bold' : 'Helvetica';
}

function fontForCharacter(doc, character, style, registeredFonts) {
  const codePoint = character.codePointAt(0) || 0;
  if (style.code && codePoint <= 0x024f) return builtinFont(style);

  const name = style.bold ? 'NotoSansHans-Bold' : 'NotoSansHans-Regular';
  if (!registeredFonts.has(name)) {
    doc.registerFont(name, style.bold ? BOLD_FONT_PATH : REGULAR_FONT_PATH);
    registeredFonts.add(name);
  }
  return name;
}

function rawTokens(text) {
  const tokens = [];
  let ascii = '';
  const flush = () => {
    if (ascii) tokens.push(ascii);
    ascii = '';
  };

  for (const character of Array.from(String(text || ''))) {
    const codePoint = character.codePointAt(0) || 0;
    if (character === '\n') {
      flush();
      tokens.push('\n');
    } else if (codePoint <= 0x024f) {
      const whitespaceChanged = ascii && /\s/.test(ascii[0]) !== /\s/.test(character);
      if (whitespaceChanged) flush();
      ascii += character;
    } else {
      flush();
      tokens.push(character);
    }
  }
  flush();
  return tokens;
}

function createToken(doc, text, style, registeredFonts) {
  const font = fontForCharacter(doc, Array.from(text)[0] || ' ', style, registeredFonts);
  doc.font(font).fontSize(style.size);
  return { text, font, width: doc.widthOfString(text) };
}

function wrapText(doc, input, maxWidth, style, registeredFonts) {
  const lines = [[]];
  let lineWidth = 0;

  const append = (raw) => {
    if (raw === '\n') {
      lines.push([]);
      lineWidth = 0;
      return;
    }

    let token = createToken(doc, raw, style, registeredFonts);
    if (/^\s+$/.test(raw) && lineWidth === 0) return;

    if (token.width > maxWidth && raw.length > 1) {
      for (const character of Array.from(raw)) append(character);
      return;
    }

    if (lineWidth > 0 && lineWidth + token.width > maxWidth) {
      lines.push([]);
      lineWidth = 0;
      if (/^\s+$/.test(raw)) return;
      token = createToken(doc, raw, style, registeredFonts);
    }
    lines[lines.length - 1].push(token);
    lineWidth += token.width;
  };

  rawTokens(plainMarkdownText(input)).forEach(append);
  return lines;
}

function drawLine(doc, line, x, y, style) {
  let cursor = x;
  for (const token of line) {
    doc.font(token.font).fontSize(style.size).fillColor(style.color);
    doc.text(token.text, cursor, y, { lineBreak: false });
    cursor += token.width;
  }
}

function createRenderer(doc) {
  const registeredFonts = new Set();
  const state = { y: PAGE_MARGIN };
  const pageBottom = A4[1] - PAGE_MARGIN - FOOTER_SPACE;

  const addPage = () => {
    doc.addPage({ size: A4, margins: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN } });
    state.y = PAGE_MARGIN;
  };

  const ensureSpace = (height) => {
    if (state.y + height > pageBottom) addPage();
  };

  const drawWrapped = (text, options = {}) => {
    const style = {
      size: options.size || BODY_SIZE,
      color: options.color || '#1f2937',
      bold: Boolean(options.bold),
      code: Boolean(options.code),
    };
    const x = options.x ?? PAGE_MARGIN;
    const width = options.width ?? CONTENT_WIDTH;
    const lineHeight = options.lineHeight || Math.max(style.size * 1.4, BODY_LINE_HEIGHT);
    const lines = wrapText(doc, text, width, style, registeredFonts);

    for (const line of lines) {
      ensureSpace(lineHeight);
      if (options.background) {
        doc.save().fillColor(options.background).rect(x - 5, state.y - 2, width + 10, lineHeight + 1).fill().restore();
      }
      if (options.leftRule) {
        doc.save().strokeColor(options.leftRule).lineWidth(2).moveTo(x - 10, state.y - 2).lineTo(x - 10, state.y + lineHeight - 2).stroke().restore();
      }
      drawLine(doc, line, x, state.y, style);
      state.y += lineHeight;
    }
    state.y += options.after || 0;
  };

  const drawRule = () => {
    ensureSpace(18);
    doc.save().strokeColor('#cbd5e1').lineWidth(0.8).moveTo(PAGE_MARGIN, state.y + 7).lineTo(A4[0] - PAGE_MARGIN, state.y + 7).stroke().restore();
    state.y += 18;
  };

  const drawTable = (rows) => {
    const columnCount = Math.max(1, ...rows.map((row) => row.length));
    const columnWidth = CONTENT_WIDTH / columnCount;
    const padding = 5;
    const style = { size: 8.5, color: '#1f2937', bold: false, code: false };
    const lineHeight = 12.5;

    rows.forEach((row, rowIndex) => {
      const cellLines = new Array(columnCount).fill(null).map((_, columnIndex) => {
        const cellStyle = { ...style, bold: rowIndex === 0 };
        return wrapText(doc, row[columnIndex] || '', columnWidth - padding * 2, cellStyle, registeredFonts);
      });
      const rowHeight = Math.max(1, ...cellLines.map((lines) => lines.length)) * lineHeight + padding * 2;
      ensureSpace(rowHeight);
      const rowY = state.y;

      cellLines.forEach((lines, columnIndex) => {
        const cellX = PAGE_MARGIN + columnIndex * columnWidth;
        doc.save();
        if (rowIndex === 0) doc.fillColor('#eaf0f7').rect(cellX, rowY, columnWidth, rowHeight).fill();
        doc.strokeColor('#cbd5e1').lineWidth(0.6).rect(cellX, rowY, columnWidth, rowHeight).stroke().restore();
        lines.forEach((line, lineIndex) => {
          drawLine(doc, line, cellX + padding, rowY + padding + lineIndex * lineHeight, {
            ...style,
            bold: rowIndex === 0,
          });
        });
      });
      state.y += rowHeight;
    });
    state.y += 12;
  };

  return { addPage, drawRule, drawTable, drawWrapped, state };
}

function appendPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    doc.font('Helvetica').fontSize(8.5).fillColor('#6b7280');
    doc.text(
      `Page ${pageIndex - range.start + 1}`,
      PAGE_MARGIN,
      A4[1] - PAGE_MARGIN - 12,
      { width: CONTENT_WIDTH, align: 'center', lineBreak: false },
    );
  }
}

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

async function renderMarkdownPdf(markdown, { title = 'Document' } = {}) {
  const doc = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    compress: true,
    info: {
      Title: title,
      Author: 'MedHelp',
      Creator: 'MedHelp',
      Subject: 'Exported from Markdown by MedHelp',
    },
  });
  const renderer = createRenderer(doc);
  renderer.addPage();

  const lines = stripFrontmatter(markdown).split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      renderer.state.y += 5;
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
      if (index < lines.length) index += 1;
      renderer.drawWrapped(codeLines.join('\n') || ' ', {
        code: true,
        size: 8.5,
        lineHeight: 12.5,
        background: '#f1f5f9',
        after: 10,
      });
      continue;
    }

    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      const sizes = [20, 17, 14.5, 12.5, 11.5, 10.5];
      renderer.state.y += depth <= 2 ? 10 : 6;
      renderer.drawWrapped(headingMatch[2], {
        size: sizes[depth - 1],
        lineHeight: sizes[depth - 1] * 1.35,
        bold: true,
        color: depth <= 2 ? '#111827' : '#374151',
        after: depth <= 2 ? 8 : 5,
      });
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
      renderer.drawTable(rows);
      continue;
    }

    const unorderedMatch = line.match(/^(\s*)[-+*]\s+(.+)$/);
    const orderedMatch = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      const match = unorderedMatch || orderedMatch;
      const indentLevel = Math.min(3, Math.floor((match[1].replace(/\t/g, '    ').length || 0) / 2));
      const indent = indentLevel * 18;
      const prefix = unorderedMatch ? '•' : `${Number((line.match(/^\s*(\d+)/) || [])[1] || 1)}.`;
      renderer.drawWrapped(`${prefix} ${match[2]}`, {
        x: PAGE_MARGIN + 12 + indent,
        width: CONTENT_WIDTH - 12 - indent,
        after: 3,
      });
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*>\s?(.*)$/);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      renderer.drawWrapped(quoteLines.join(' '), {
        x: PAGE_MARGIN + 16,
        width: CONTENT_WIDTH - 24,
        color: '#4b5563',
        leftRule: '#8fa3bf',
        after: 9,
      });
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      renderer.drawRule();
      index += 1;
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    renderer.drawWrapped(paragraphLines.join(' '), { after: 8 });
  }

  appendPageNumbers(doc);
  return collectPdf(doc);
}

export { renderMarkdownPdf };
