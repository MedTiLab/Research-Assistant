import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOutputFile, positiveLimit } from './output-budget.js';

export const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx', '.pptx']);

export async function extractPiDocument(file, { projectRoot, sessionId, signal }) {
  const output = await createOutputFile(projectRoot, sessionId);
  const extension = path.extname(file).toLowerCase();
  try {
    if (!DOCUMENT_EXTENSIONS.has(extension)) throw new Error('Unsupported document type');
    const node = process.env.MEDHELP_RUNTIME_ROOT ? path.join(process.env.MEDHELP_RUNTIME_ROOT, 'bin', process.platform === 'win32' ? 'node.exe' : 'node') : process.execPath;
    const worker = process.env.MEDHELP_RUNTIME_ROOT ? path.join(process.env.MEDHELP_RUNTIME_ROOT, 'pi-runtime', 'document-worker.cjs') : fileURLToPath(new URL('./document-worker.js', import.meta.url));
    const args = ['--max-old-space-size=512', worker, file];
    await new Promise((resolve, reject) => {
      const child = spawn(node, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal, timeout: 60_000, killSignal: 'SIGKILL' });
      let errorText = '', bytes = 0, hasText = false, writes = Promise.resolve();
      child.stdout.on('data', (data) => {
        child.stdout.pause();
        bytes += data.length;
        if (data.toString('utf8').trim()) hasText = true;
        if (bytes > 128 * 1024 * 1024) { errorText = 'Extracted document exceeds the 128 MB safety limit'; child.kill('SIGKILL'); return; }
        writes = writes.then(() => output.handle.write(data)).then(() => child.stdout.resume()).catch((error) => { errorText = error.message; child.kill('SIGKILL'); });
      });
      child.stderr.on('data', (data) => { errorText = (errorText + data.toString()).slice(0, 2000); });
      child.once('error', (error) => reject(new Error(`Document worker failed: ${error.message}`)));
      child.once('close', async (code) => { await writes; if (code !== 0 || !hasText) reject(new Error(`Document extraction failed: ${errorText || 'no extractable text (scanned/encrypted PDF may require OCR)'}`)); else resolve(); });
    });
    return { path: output.path };
  } catch (error) {
    await output.handle.close();
    await fs.unlink(output.path).catch(() => {});
    throw error;
  } finally { await output.handle.close(); }
}

export async function preparePiImage(file, { projectRoot, sessionId, maxBytes, env = process.env }) {
  const { default: sharp } = await import('sharp');
  // Portable default: Anthropic standard vision tier's native long edge is 1568 px.
  // https://platform.claude.com/docs/en/build-with-claude/vision
  const edge = positiveLimit(env.MEDHELP_PI_IMAGE_MAX_EDGE, 1568, 8192);
  const image = sharp(file, { limitInputPixels: 100_000_000 }).rotate();
  const metadata = await image.metadata();
  const originalBytes = (await fs.stat(file)).size;
  const budget = Math.max(1024, Math.min(Number(maxBytes) || 8 * 1024 * 1024, 8 * 1024 * 1024));
  if (Math.max(metadata.width || 0, metadata.height || 0) <= edge && originalBytes <= budget && ['png', 'jpeg', 'webp', 'gif'].includes(metadata.format)) return { path: file, mimeType: `image/${metadata.format}`, resized: false };
  for (const scale of [1, 0.75, 0.5, 0.25]) {
    const buffer = await image.clone().resize({ width: Math.round(edge * scale), height: Math.round(edge * scale), fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    if (buffer.length > budget) continue;
    const output = await createOutputFile(projectRoot, sessionId, 'jpg');
    try { await output.handle.writeFile(buffer); } finally { await output.handle.close(); }
    return { path: output.path, mimeType: 'image/jpeg', resized: true };
  }
  throw new Error('Image could not be resized within the remaining image budget');
}
