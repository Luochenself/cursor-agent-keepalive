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

const weekly = `
Weekly usage limit reached. It resets in 6 days.
Upgrade your plan for more weekly usage.
Upgrade Plan
`;
const weeklyHit = matchScenario(weekly, cfg.scenarios);
assert.equal(weeklyHit?.id, 'usage_limit');
assert.equal(weeklyHit?.action, 'type_continue');
assert.ok(weeklyHit.matched.includes('Weekly usage limit reached'));
assert.equal(isUsageLimitText(weekly), true);

const quiet = matchScenario('Agent is working on your request…', cfg.scenarios);
assert.equal(quiet, null);
assert.equal(isUsageLimitText(sample), true);
assert.equal(isUsageLimitText('hello'), false);

const injectSrc = readFileSync(path.join(root, 'inject-keepalive.js'), 'utf8');
assert.match(injectSrc, /You've hit your usage limit/);
assert.match(injectSrc, /Weekly usage limit reached/);
assert.match(injectSrc, /Upgrade Plan/);
assert.match(injectSrc, /usage-limit-policy-banner/);
assert.match(injectSrc, /composer-error-title/);
assert.match(injectSrc, /isHardUsageWallText/);
assert.match(injectSrc, /installApiWallHooks/);
assert.match(injectSrc, /detectUsageWall/);
assert.match(injectSrc, /__cursorKeepaliveDebugScan/);
assert.match(injectSrc, /KEEPALIVE_BUILD/);
assert.match(injectSrc, /continueText:\s*CONTINUE/);
assert.match(injectSrc, /\\u7ee7\\u7eed/);
assert.match(injectSrc, /__cursor_keepalive_hud/);
assert.match(injectSrc, /\.aislash-editor-input/);
assert.match(injectSrc, /ui-prompt-input-submit-button/);

console.log('selftest-detector OK', hit, weeklyHit);
