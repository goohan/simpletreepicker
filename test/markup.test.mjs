// The control reaches into the page by id. Nothing at build time checks that
// those ids exist, and a typo would only surface as a blank control inside a
// work item form — the most expensive place to debug. These tests keep the
// script and both copies of the markup (the real page and the preview harness)
// honest about each other.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const control = await read("../src/control.js");
const page = await read("../src/control.html");
const preview = await read("../dev/preview.html");

const idsUsedBy = (source) => [...source.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
const idsDeclaredIn = (markup) => new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

test("every id the control looks up exists in control.html", () => {
  const declared = idsDeclaredIn(page);
  const used = idsUsedBy(control);
  assert.ok(used.length >= 6, "expected the control to look up its elements by id");
  for (const id of used) {
    assert.ok(declared.has(id), `control.js reads #${id}, which control.html does not declare`);
  }
});

test("the preview harness declares the same ids as the real page", () => {
  const declared = idsDeclaredIn(preview);
  for (const id of idsUsedBy(control)) {
    assert.ok(declared.has(id), `dev/preview.html is missing #${id}, so the preview would not match the real page`);
  }
});

test("control.html loads the bundle and the stylesheet by their built names", () => {
  assert.match(page, /<script src="control\.js">/);
  assert.match(page, /<link rel="stylesheet" href="control\.css"/);
});

test("every CSS class the control assigns is styled", async () => {
  const css = await read("../src/control.css");
  const assigned = new Set([
    ...[...control.matchAll(/className = "([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)),
    ...[...control.matchAll(/classList\.(?:add|toggle)\("([^"]+)"/g)].map((m) => m[1]),
  ]);
  const unstyled = [...assigned].filter((name) => !new RegExp(`\\.${name}\\b`).test(css));
  assert.deepEqual(unstyled, [], `assigned but never styled: ${unstyled.join(", ")}`);
});
