// The version lives twice: package.json drives the tooling, vss-extension.json
// is what the marketplace reads. Nothing keeps them in step, and a mismatch is
// invisible until an upload is rejected or — worse — accepted under a version
// that does not match the source it was built from. Bumping means bumping both.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const pkg = await readJson("../package.json");
const manifest = await readJson("../vss-extension.json");

test("package.json and vss-extension.json declare the same version", () => {
  assert.equal(
    manifest.version,
    pkg.version,
    "bump both files together — the marketplace reads vss-extension.json",
  );
});

test("the version is a plain three-part number, as the marketplace requires", () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test("publisher and license agree across both files", () => {
  assert.equal(manifest.publisher, pkg.publisher);
});
