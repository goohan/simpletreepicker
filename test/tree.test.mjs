import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePath,
  parsePaths,
  buildTree,
  ancestorsOf,
  filterTree,
  findFirstMatch,
} from "../src/tree.js";

// The list from the original sketch: `A3\B` is never declared, only `A3\B\C`.
const SAMPLE = ["A", "A\\B", "A\\B\\C", "A2", "A3", "A3\\B\\C"];

/** Renders the tree as indented text, `*` marking the selectable nodes. */
function outline(nodes, depth = 0) {
  return nodes
    .flatMap((node) => [
      `${"  ".repeat(depth)}${node.selectable ? "*" : "-"} ${node.name}`,
      ...outline(node.children, depth + 1).split("\n").filter(Boolean),
    ])
    .join("\n");
}

test("normalizePath trims segments and drops the empty ones", () => {
  assert.equal(normalizePath("A \\ B\\ "), "A\\B");
  assert.equal(normalizePath("\\\\A\\\\B\\\\"), "A\\B");
  assert.equal(normalizePath("   "), "");
  assert.equal(normalizePath(undefined), "");
});

test("parsePaths accepts an array and deduplicates, preserving order", () => {
  assert.deepEqual(parsePaths(["B", "A", "B", " A "]), ["B", "A"]);
});

test("parsePaths splits loose text on newlines and semicolons", () => {
  assert.deepEqual(parsePaths("A\nA\\B; A2\r\n\r\nA3"), ["A", "A\\B", "A2", "A3"]);
});

test("buildTree nests by segment and stores the full path on every node", () => {
  const [a] = buildTree(SAMPLE);
  assert.equal(a.path, "A");
  assert.equal(a.children[0].path, "A\\B");
  assert.equal(a.children[0].children[0].path, "A\\B\\C");
});

test("an undeclared intermediate node exists as a branch but is not selectable", () => {
  const roots = buildTree(SAMPLE);
  const a3 = roots.find((node) => node.name === "A3");
  const b = a3.children[0];
  assert.equal(b.path, "A3\\B");
  assert.equal(b.selectable, false, "A3\\B was never declared");
  assert.equal(b.children[0].selectable, true, "A3\\B\\C was");
});

test("the whole sample tree comes out in source order", () => {
  assert.equal(
    outline(buildTree(SAMPLE)),
    ["* A", "  * B", "    * C", "* A2", "* A3", "  - B", "    * C"].join("\n"),
  );
});

test("a deep path alone creates all its branches", () => {
  const roots = buildTree(parsePaths(["X\\Y\\Z"]));
  assert.equal(roots[0].selectable, false);
  assert.equal(roots[0].children[0].selectable, false);
  assert.equal(roots[0].children[0].children[0].selectable, true);
});

test("ancestorsOf lists the prefixes, excluding the path itself", () => {
  assert.deepEqual(ancestorsOf("A\\B\\C"), ["A", "A\\B"]);
  assert.deepEqual(ancestorsOf("A"), []);
  assert.deepEqual(ancestorsOf(""), []);
});

test("filterTree keeps the branches that lead to a match", () => {
  const roots = filterTree(buildTree(SAMPLE), "C");
  assert.equal(
    outline(roots),
    ["* A", "  * B", "    * C", "* A3", "  - B", "    * C"].join("\n"),
  );
});

test("filterTree matches on the full path too, and keeps the subtree of a hit", () => {
  const roots = filterTree(buildTree(SAMPLE), "a3\\b");
  assert.equal(outline(roots), ["* A3", "  - B", "    * C"].join("\n"));
});

test("an empty term returns the tree untouched", () => {
  const roots = buildTree(SAMPLE);
  assert.equal(filterTree(roots, "  "), roots);
});

test("findFirstMatch returns the first selectable hit in reading order", () => {
  const tree = buildTree(SAMPLE);
  assert.equal(findFirstMatch(tree, "C"), "A\\B\\C");
  assert.equal(findFirstMatch(tree, "A2"), "A2");
  assert.equal(findFirstMatch(tree, "  "), "");
  assert.equal(findFirstMatch(tree, "nothing here"), "");
});

test("findFirstMatch skips ancestors that only exist to reach the hit", () => {
  // Filtering keeps `A` so `A\Erp` can be reached, and `A` is selectable — but
  // it never matched "Erp", so it must not be what typing "Erp" selects.
  const tree = buildTree(parsePaths(["A", "A\\Erp", "A\\ErpCloud"]));
  assert.equal(findFirstMatch(tree, "Erp"), "A\\Erp");
});

test("findFirstMatch never returns a node that is not selectable", () => {
  // `A3\B` exists as a branch but was never declared, so it cannot be a value.
  const tree = buildTree(SAMPLE);
  assert.equal(findFirstMatch(tree, "A3\\B"), "A3\\B\\C");
});
