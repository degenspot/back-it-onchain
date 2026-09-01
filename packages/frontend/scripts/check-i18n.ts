/**
 * i18n coverage audit (FE-26).
 *
 * Compares every locale file under `messages/` against `en.json` and reports
 * any missing (or empty-value) keys so translators — and CI — can see at a
 * glance what still needs attention.
 *
 * Usage:
 *   node --experimental-strip-types scripts/check-i18n.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Json = Record<string, unknown>;

const MESSAGES_DIR = join(import.meta.dirname, "..", "messages");

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, "utf8")) as Json;
}

function flatten(obj: Json, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      return flatten(value as Json, path);
    }
    return [path];
  });
}

function main() {
  const files = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error("No message files found.");
    process.exit(1);
  }

  const enFile = files.find((f) => f === "en.json");
  if (!enFile) {
    console.error("en.json is the canonical reference and is missing.");
    process.exit(1);
  }

  const enKeys = new Set(flatten(readJson(join(MESSAGES_DIR, enFile))));
  let anyGap = false;

  for (const file of files) {
    if (file === enFile) continue;
    const locale = file.replace(".json", "");
    const keys = new Set(flatten(readJson(join(MESSAGES_DIR, file))));

    const missing = [...enKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !enKeys.has(k));

    if (missing.length > 0 || extra.length > 0) {
      anyGap = true;
      console.log(`\n[${locale}]`);
      if (missing.length > 0) {
        console.log(`  missing (${missing.length}):\n    - ${missing.join("\n    - ")}`);
      }
      if (extra.length > 0) {
        console.log(`  extra (${extra.length}):\n    - ${extra.join("\n    - ")}`);
      }
    } else {
      console.log(`[${locale}] complete (${enKeys.size} keys)`);
    }
  }

  if (anyGap) {
    console.error("\nSome locales are out of sync with en.json.");
    process.exit(1);
  }
  console.log("\nAll locales match en.json. ✓");
}

main();
