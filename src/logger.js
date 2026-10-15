import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.resolve(__dirname, '../logs');

function stamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

export function ensureLogDir() {
  fs.mkdirSync(logDir, { recursive: true });
}

export function log(level, msg, extra) {
  ensureLogDir();
  const line =
    extra === undefined
      ? `[${stamp()}] ${level} ${msg}`
      : `[${stamp()}] ${level} ${msg} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
  console.log(line);
  fs.appendFileSync(path.join(logDir, 'keepalive.log'), `${line}\n`, 'utf8');
}

export const info = (m, e) => log('INFO', m, e);
export const warn = (m, e) => log('WARN', m, e);
export const error = (m, e) => log('ERROR', m, e);
export const event = (m, e) => log('EVENT', m, e);
