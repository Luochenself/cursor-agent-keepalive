import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, '../config.json');

export function loadConfig() {
  const raw = fs.readFileSync(configPath, 'utf8');
  const cfg = JSON.parse(raw);
  cfg.cursorExeCandidates = (cfg.cursorExeCandidates || []).map((p) =>
    p.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`),
  );
  return cfg;
}

export function configFilePath() {
  return configPath;
}
