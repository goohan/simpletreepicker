// Builds dist/ — the only folder the extension package addresses.
// The bundle is an IIFE on purpose: the control page is loaded straight into a
// sandboxed iframe by the work item form, where a module script would need
// CORS-clean origins that the extension host does not guarantee.

import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const OUT_DIR = "dist";
const STATIC_FILES = ["control.html", "control.css", "dialog.html"];
const ENTRY_POINTS = ["control", "dialog"];

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

await build({
  entryPoints: ENTRY_POINTS.map((name) => `src/${name}.js`),
  outdir: OUT_DIR,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  legalComments: "none",
});

await Promise.all(STATIC_FILES.map((file) => copyFile(`src/${file}`, `${OUT_DIR}/${file}`)));

console.log(`Built ${OUT_DIR}/: ${ENTRY_POINTS.map((n) => `${n}.js`).join(", ")}, ${STATIC_FILES.join(", ")}`);

// The preview bundle swaps the SDK for a fake host so the control can be driven
// in a plain browser (dev/preview.html). It never reaches the package: the
// manifest addresses dist/ and assets/ only.
if (process.argv.includes("--preview")) {
  // The page inside the harness iframe is DERIVED from the real control page,
  // never copied: a hand-kept duplicate is exactly the thing that drifts out of
  // sync and makes the harness quietly stop matching production.
  const page = await readFile("src/control.html", "utf8");
  await writeFile("dev/frame.html", page.replace('src="control.js"', 'src="preview.js"'));

  await build({
    entryPoints: ["src/control.js"],
    outfile: "dev/preview.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    alias: { "azure-devops-extension-sdk": "./dev/sdk-stub.js" },
  });
  console.log("Built dev/preview.js and dev/frame.html — open dev/preview.html in a browser.");
}
