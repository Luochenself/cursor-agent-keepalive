/**
 * 纯逻辑自测：不连 Cursor，验证 usage limit 文案会命中 type_continue 场景。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isUsageLimitText, matchScenario } from './scenario-lib.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(path.join(root, 'config.json'), 'utf8'));

const sample = `
⚠️ You've hit your usage limit. Get Cursor Pro for more Agent usage, unlimited Tab, and more.
Upgrade to Pro
Plan, search, build anything
`;

const hit = matchScenario(sample, cfg.scenarios);
assert.equal(hit?.id, 'usage_limit');
assert.equal(hit?.action, 'type_continue');
assert.ok(hit.matched.includes("You've hit your usage limit"));

const quiet = matchScenario('Agent is working on your request…', cfg.scenarios);
assert.equal(quiet, null);
assert.equal(isUsageLimitText(sample), true);
assert.equal(isUsageLimitText('hello'), false);

const injectSrc = readFileSync(path.join(root, 'inject-keepalive.js'), 'utf8');
assert.match(injectSrc, /You've hit your usage limit/);
assert.match(injectSrc, /continueText:\s*'继续'/);
assert.match(injectSrc, /__cursor_keepalive_hud/);
assert.match(injectSrc, /\.aislash-editor-input/);
assert.match(injectSrc, /ui-prompt-input-submit-button/);

console.log('selftest-detector OK', hit);
