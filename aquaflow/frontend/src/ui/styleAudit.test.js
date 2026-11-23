// Ratchet: no component may gain inline styles or hard-coded colours.
// After migrating a panel, lower the baseline with:  node scripts/update-style-baseline.mjs
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditComponents, countStyleDebt, regressions } from "./styleAudit";

const here = path.dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(fs.readFileSync(path.join(here, "styleBaseline.json"), "utf8"));

describe("style debt ratchet", () => {
  it("counts inline style objects and hex colours, ignoring HTML entities", () => {
    expect(countStyleDebt('<a style={{color:"#fff"}} title="&#123;" data-x="#12345678"/>')).toEqual({ inline: 1, hex: 2 });
  });

  it("no component file has more inline styles or hard-coded colours than the baseline", () => {
    const worse = regressions(auditComponents(path.join(here, "../components")), baseline.files);
    const message = worse.map((w) => `${w.file}: inline ${w.base.inline}→${w.debt.inline}, hex ${w.base.hex}→${w.debt.hex}`).join("\n");
    expect(worse, `Use src/ui components and CSS tokens instead:\n${message}`).toEqual([]);
  });
});
