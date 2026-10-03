// Serves the importer's look-alike sample POs to the browser without copying them into the
// repo's source: copies node_modules/po-importer/fixtures/egc/*.pdf into public/samples/
// (git-ignored) with an index.json the app reads. Runs before dev and build.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FROM = "node_modules/po-importer/fixtures/egc";
const TO = "public/samples";

rmSync(TO, { recursive: true, force: true });
mkdirSync(TO, { recursive: true });
const names = existsSync(FROM) ? readdirSync(FROM).filter((n) => n.toLowerCase().endsWith(".pdf")).sort() : [];
for (const n of names) copyFileSync(join(FROM, n), join(TO, n));
writeFileSync(join(TO, "index.json"), JSON.stringify(names.map((name) => ({ name, size: statSync(join(TO, name)).size })), null, 2) + "\n");
console.log(`samples: ${names.length} PDF${names.length === 1 ? "" : "s"} from ${FROM}`);
