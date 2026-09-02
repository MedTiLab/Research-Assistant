import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import {
  MAX_MARKDOWN_EXPORT_BYTES,
  markdownToDocxBuffer,
  markdownToPdfBuffer,
} from '../utils/markdownDocumentExport.js';

describe('Markdown document export', () => {
  it('creates a valid DOCX package with structured Markdown content', async () => {
    const buffer = await markdownToDocxBuffer(`---
title: Hidden metadata
---
# 中文报告

This has **bold text** and a [source](https://example.com).

- First item
- Second item

| Measure | Value |
| --- | --- |
| Age | 65 |

\`\`\`js
console.log('ok')
\`\`\`
`, { title: '中文报告' });

    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    const zip = new AdmZip(buffer);
    const documentXml = zip.readAsText('word/document.xml');
    const relationshipsXml = zip.readAsText('word/_rels/document.xml.rels');

    expect(documentXml).toContain('中文报告');
    expect(documentXml).toContain('bold text');
    expect(documentXml).toContain('<w:tbl>');
    expect(documentXml).toContain('console.log');
    expect(documentXml).not.toContain('Hidden metadata');
    expect(relationshipsXml).toContain('https://example.com');
  });

  it('creates a self-contained PDF with Chinese Markdown content', async () => {
    const buffer = await markdownToPdfBuffer(`# 中文报告

This has **bold text**.

- 第一项
- 第二项

| 平台 | 支持 |
| --- | --- |
| Linux | 是 |
`, { title: '中文报告' });

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.subarray(-16).toString()).toContain('%%EOF');
    expect(buffer.length).toBeGreaterThan(5_000);
  });

  it('rejects oversized Markdown exports', async () => {
    const oversized = 'x'.repeat(MAX_MARKDOWN_EXPORT_BYTES + 1);
    await expect(markdownToDocxBuffer(oversized)).rejects.toMatchObject({ statusCode: 413 });
    await expect(markdownToPdfBuffer(oversized)).rejects.toMatchObject({ statusCode: 413 });
  });
});
