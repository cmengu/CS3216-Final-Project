// The buyers, items and prices on EGC's sample POs are real, so git ignores the file that holds
// them (src/sample/egc-samples.private.json). The app imports that file, so on a machine without
// it this writes an empty one: the app then runs on the invented lists alone. A file that is
// already there is never touched. Runs after install and before dev, build, test and typecheck.
import { existsSync, writeFileSync } from "node:fs";

const FILE = "src/sample/egc-samples.private.json";

if (existsSync(FILE)) {
  console.log(`private lists: using ${FILE}`);
} else {
  writeFileSync(FILE, JSON.stringify({ buyers: [], products: [], items: [] }, null, 2) + "\n");
  console.log(`private lists: ${FILE} is missing, wrote an empty one`);
}
