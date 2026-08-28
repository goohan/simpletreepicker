// The pages reach into themselves by id, and the shared tree view assigns CSS
// classes from JavaScript. Nothing at build time checks that those ids and
// classes exist, and a typo would only surface as a blank control inside a work
// item form — the most expensive place to debug. These tests keep the scripts
// and every copy of the markup honest about each other.
//
// Both entry points are covered: the inline control and the dialog. When the
// rendering moved into treeview.js, a version of this file that only read
// control.js would have kept passing while checking nothing at all.
//
// The preview harness is NOT checked here: it derives its page from
// src/control.html at build time instead of duplicating it, so there is no
// second copy left to drift.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [control, dialog, treeview, controlPage, dialogPage, css] = await Promise.all([
  read("../src/control.js"),
  read("../src/dialog.js"),
  read("../src/treeview.js"),
  read("../src/control.html"),
  read("../src/dialog.html"),
  read("../src/control.css"),
]);

const idsUsedBy = (source) => [...source.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
const idsDeclaredIn = (markup) => new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

test("every id the control looks up exists in control.html", () => {
  const declared = idsDeclaredIn(controlPage);
  const used = idsUsedBy(control);
  assert.ok(used.length >= 6, "expected the control to look up its elements by id");
  for (const id of used) {
    assert.ok(declared.has(id), `control.js reads #${id}, which control.html does not declare`);
  }
});

test("every id the dialog looks up exists in dialog.html", () => {
  const declared = idsDeclaredIn(dialogPage);
  const used = idsUsedBy(dialog);
  assert.ok(used.length >= 3, "expected the dialog to look up its elements by id");
  for (const id of used) {
    assert.ok(declared.has(id), `dialog.js reads #${id}, which dialog.html does not declare`);
  }
});

test("each page loads its own bundle and the shared stylesheet", () => {
  assert.match(controlPage, /<script src="control\.js">/);
  assert.match(dialogPage, /<script src="dialog\.js">/);
  for (const page of [controlPage, dialogPage]) {
    assert.match(page, /<link rel="stylesheet" href="control\.css"/);
  }
});

test("every CSS class the scripts assign is styled", () => {
  const assigned = new Set(
    [control, dialog, treeview].flatMap((source) => [
      ...[...source.matchAll(/className = "([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)),
      ...[...source.matchAll(/classList\.(?:add|toggle)\("([^"]+)"/g)].map((m) => m[1]),
    ]),
  );
  assert.ok(assigned.size >= 8, "expected the tree view to assign its classes from script");
  const unstyled = [...assigned].filter((name) => !new RegExp(`\\.${name}\\b`).test(css));
  assert.deepEqual(unstyled, [], `assigned but never styled: ${unstyled.join(", ")}`);
});

test("no listener is registered twice for the same element and event", () => {
  // A duplicated registration is invisible in review and vicious in use: every
  // handler simply runs twice. It shipped once, and produced two stacked host
  // dialogs, and a chevron whose first handler opened the panel while the
  // second saw it already open and closed it again — the click looked like it
  // did nothing at all.
  for (const [label, source] of [["control.js", control], ["dialog.js", dialog]]) {
    const pairs = [...source.matchAll(/(dom\.\w+|window|document)\.addEventListener\(\s*"(\w+)"/g)].map(
      (match) => `${match[1]} ${match[2]}`,
    );
    const duplicated = [...new Set(pairs.filter((pair, i) => pairs.indexOf(pair) !== i))];
    assert.deepEqual(duplicated, [], `${label} binds these twice: ${duplicated.join(", ")}`);
  }
});

test("the dialog never writes to the work item itself", () => {
  // The control owns the field; the dialog reports the pick through a callback.
  // Keeping it that way is what stops a dialog-only bug from corrupting data.
  assert.doesNotMatch(dialog, /setFieldValue|getFieldValue|getAllowedFieldValues/);
});
