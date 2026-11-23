// Style audit for the design-system migration (UI overhaul phase 6).
//
// Counts, per component file, inline `style={{…}}` objects and hard-coded hex colours.
// The committed baseline (styleBaseline.json) is a ratchet: counts may go down as panels
// are migrated to src/ui + CSS tokens, but never up. Colours that are user data (a light's
// colour, a clip colour) legitimately stay in code; they are already inside the baseline.
import fs from "node:fs";
import path from "node:path";

const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const INLINE = /style=\{\{/g;

export function countStyleDebt(source) {
  return {
    inline: (source.match(INLINE) || []).length,
    hex: (source.match(HEX) || []).length,
  };
}

export function auditComponents(rootDir) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "__snapshots__") walk(full);
      } else if (entry.name.endsWith(".jsx") && !entry.name.includes(".test.")) {
        const debt = countStyleDebt(fs.readFileSync(full, "utf8"));
        if (debt.inline || debt.hex) out[path.relative(rootDir, full).replaceAll("\\", "/")] = debt;
      }
    }
  };
  walk(rootDir);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Files whose counts went up (or new files with any debt) compared with the baseline. */
export function regressions(current, baseline) {
  const worse = [];
  for (const [file, debt] of Object.entries(current)) {
    const base = baseline[file] || { inline: 0, hex: 0 };
    if (debt.inline > base.inline || debt.hex > base.hex) worse.push({ file, debt, base });
  }
  return worse;
}

export function totals(report) {
  return Object.values(report).reduce((t, d) => ({ inline: t.inline + d.inline, hex: t.hex + d.hex }), { inline: 0, hex: 0 });
}
