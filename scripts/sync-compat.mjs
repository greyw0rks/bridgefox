import bcd from "@mdn/browser-compat-data" with { type: "json" };
import { writeFileSync } from "node:fs";
const api = {};
for (const [namespace, members] of Object.entries(bcd.webextensions.api)) {
  api[namespace] = {};
  for (const [member, entry] of Object.entries(members)) {
    const raw = entry.__compat?.support?.firefox;
    if (!raw) continue;
    const statements = Array.isArray(raw) ? raw : [raw];
    api[namespace][member] = statements.some(s => s.version_added && !s.version_removed && !s.flags && !s.partial_implementation) ? "supported" : statements.every(s => s.version_added === false || s.version_removed) ? "unsupported" : "review";
  }
}
writeFileSync("src/lib/compat-data.json", JSON.stringify({ source: "@mdn/browser-compat-data", version: bcd.__meta.version, license: "CC0-1.0", api }, null, 2) + "\n");
console.log(`Generated Firefox API-member snapshot from Mozilla BCD ${bcd.__meta.version}.`);
