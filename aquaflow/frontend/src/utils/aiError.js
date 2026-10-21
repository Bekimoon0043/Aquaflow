// Error text for the optional AI features: the engine route's own message, or how to make the
// feature available (no engine / older engine without the route).
export function aiErrorMessage(error, feature = 'This AI feature') {
  const m = String(error?.message || error || '');
  if (/HTTP 404|Failed to fetch|NetworkError|fetch/i.test(m)) return `${feature} needs the AquaFlow engine and an Anthropic API key (Your fountain → AI director)`;
  return m.replace(/^HTTP \d+ — /, '');
}
