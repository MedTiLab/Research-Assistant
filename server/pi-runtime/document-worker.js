// Runs in a disposable child process so malformed/slow document parsing is cancellable.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const xmlText = (xml) => [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => match[1].replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (_, num, name) => num ? String.fromCodePoint(num[0] === 'x' ? parseInt(num.slice(1), 16) : Number(num)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name])).join('\n');
async function main() {
  const file = process.argv[2];
  const extension = path.extname(file).toLowerCase();
  if ((await fs.stat(file)).size > 64 * 1024 * 1024) throw new Error('Document exceeds the 64 MB parser input limit');
  let text;
  if (extension === '.pdf') {
    // The serverless PDF.js bundle includes its worker and needs no Poppler/native canvas.
    const { getDocument } = await import('unpdf/pdfjs');
    const loading = getDocument({ data: new Uint8Array(await fs.readFile(file)), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, verbosity: 0 });
    try {
      const pdf = await loading.promise;
      const pages = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        pages.push(content.items.filter((item) => typeof item.str === 'string').map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join(''));
        page.cleanup();
      }
      text = pages.join('\n\n');
    } finally { await loading.destroy(); }
  } else {
    const zip = new AdmZip(file);
    const entries = zip.getEntries();
    if (entries.reduce((sum, entry) => sum + entry.header.size, 0) > 128 * 1024 * 1024) throw new Error('Document expands beyond the parser safety limit');
    if (extension === '.docx') {
      const mammoth = await import('mammoth');
      text = (await mammoth.extractRawText({ path: file })).value;
    } else if (extension === '.xlsx') {
      const { default: readExcel } = await import('read-excel-file/node');
      const sheets = await readExcel(file);
      text = sheets.map((sheet) => `# ${sheet.sheet}\n${sheet.data.map((row) => row.map((cell) => cell instanceof Date ? cell.toISOString() : String(cell ?? '')).join('\t')).join('\n')}`).join('\n\n');
    } else if (extension === '.pptx') {
      text = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName)).sort((a, b) => Number(a.entryName.match(/slide(\d+)/)[1]) - Number(b.entryName.match(/slide(\d+)/)[1])).map((entry, index) => `# Slide ${index + 1}\n${xmlText(entry.getData().toString('utf8'))}`).join('\n\n');
    } else throw new Error('Unsupported document type');
  }
  if (!text?.trim()) throw new Error('no extractable text found in document (scanned PDF may require OCR)');
  process.stdout.write(text);
}
main().catch((error) => { process.stderr.write(error.message); process.exitCode = 1; });
