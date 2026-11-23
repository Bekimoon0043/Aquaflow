// Rewrite src/ui/styleBaseline.json from the current component sources.
// Run after migrating panels so the ratchet locks in the lower counts:
//   cd aquaflow/frontend && node scripts/update-style-baseline.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditComponents, totals } from "../src/ui/styleAudit.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = auditComponents(path.join(root, "src/components"));
const summary = totals(files);
const target = path.join(root, "src/ui/styleBaseline.json");
fs.writeFileSync(target, JSON.stringify({ totals: summary, files }, null, 1) + "\n");
console.log(`style baseline: ${Object.keys(files).length} files, ${summary.inline} inline styles, ${summary.hex} hex colours`);
