// Lightweight .env loading for startup utilities that do not need shell or DB setup.
import fs from 'fs';
import { fileURLToPath } from 'url';

export function loadEnvFile(envPath = fileURLToPath(new URL('../.env', import.meta.url))) {
  try {
    const envFile = fs.readFileSync(envPath, 'utf8');
    for (const line of envFile.split('\n')) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) continue;
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0 && !process.env[key]) {
        process.env[key] = valueParts.join('=').trim();
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[load-env] Failed to read .env:', error.message);
    }
  }
}
