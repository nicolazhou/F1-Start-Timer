import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SITE_FILES } from "./site-files.mjs";

await rm("dist", { force: true, recursive: true });
for (const path of SITE_FILES.keys()) {
  const target = join("dist", path);
  await mkdir(dirname(target), { recursive: true });
  await cp(path, target);
}
await writeFile("dist/.nojekyll", "");
console.log("Standalone static site built into dist/ (no bundler required).");
