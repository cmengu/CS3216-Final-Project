// Serves the importer's look-alike sample POs to the browser without copying them into the
// repo's source: copies every PDF under node_modules/po-importer/fixtures/egc/ (one folder per
// layout reader) flat into public/samples/ (git-ignored) with an index.json the app reads.
// Runs before dev and build.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const FROM = "node_modules/po-importer/fixtures/egc";
const TO = "public/samples";

rmSync(TO, { recursive: true, force: true });
mkdirSync(TO, { recursive: true });
const pdfs = existsSync(FROM)
  ? readdirSync(FROM, { recursive: true })
      .map(String)
      .filter((p) => p.toLowerCase().endsWith(".pdf"))
      .sort((a, b) => basename(a).localeCompare(basename(b)))
  : [];
const names = [];
for (const p of pdfs) {
  const name = basename(p);
  if (names.includes(name)) continue;
  copyFileSync(join(FROM, p), join(TO, name));
  names.push(name);
}
writeFileSync(join(TO, "index.json"), JSON.stringify(names.map((name) => ({ name, size: statSync(join(TO, name)).size })), null, 2) + "\n");
console.log(`samples: ${names.length} PDF${names.length === 1 ? "" : "s"} from ${FROM}`);
