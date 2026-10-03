// Serves the importer's look-alike sample POs to the browser without copying them into the
// repo's source: copies the files listed in src/sample/sample-pos.json (folder and file names,
// one place) from the installed importer package into public/samples/ (git-ignored), with an
// index.json of names and sizes in the listed order. Runs before dev and build.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { folder, files } = JSON.parse(readFileSync("src/sample/sample-pos.json", "utf8"));
const TO = "public/samples";

rmSync(TO, { recursive: true, force: true });
mkdirSync(TO, { recursive: true });
const copied = [];
for (const name of files) {
  const from = join(folder, name);
  if (!existsSync(from)) {
    console.warn(`samples: ${from} is missing`);
    continue;
  }
  copyFileSync(from, join(TO, name));
  copied.push({ name, size: statSync(from).size });
}
writeFileSync(join(TO, "index.json"), JSON.stringify(copied, null, 2) + "\n");
console.log(`samples: ${copied.length} of ${files.length} files from ${folder}`);
