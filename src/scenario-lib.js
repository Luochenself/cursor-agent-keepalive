/** Shared scenario matching for Node selftest / future CDP reuse. */

export function matchScenario(bodyText, scenarios) {
  const hits = [];
  for (const s of scenarios || []) {
    const keys = s.textIncludesAny || [];
    const matched = keys.filter((k) => bodyText.includes(k));
    if (matched.length) {
      hits.push({
        id: s.id,
        action: s.action,
        matched,
        priority: s.id === 'usage_limit' ? 100 : 10,
      });
    }
  }
  hits.sort((a, b) => b.priority - a.priority);
  return hits[0] || null;
}

export function isUsageLimitText(text) {
  return /You've hit your usage limit|hit your usage limit|Upgrade to Pro|Get Cursor Pro for more Agent usage|usage limit|已达到使用限额|达到用量限制/i.test(
    String(text || ''),
  );
}
