// Regression guard for the 0.1.1 theme bug.
//
// The control renders inside an iframe whose theme comes from Azure DevOps, not
// from the browser. `SDK.init({applyTheme: true})` injects the host's theme
// variables and pins `body { color: var(--text-primary-color) }`.
//
// The bug: the stylesheet declared `color-scheme: light dark` and fell back to
// CSS system colors (`CanvasText`, `GrayText`, `Field`). Those resolve against
// the BROWSER/OS theme. A user on a light ADO form in a dark browser got a dark
// control with unreadable text — and, because most of the ADO variable names
// were guessed and did not exist, nearly every color reached that fallback.
//
// The rule these tests hold: fall back to literals, never to anything the
// browser gets to reinterpret.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/control.css", import.meta.url), "utf8");

// Comments are stripped before scanning: the file documents this very bug by
// naming the offending keywords, and that prose must not trip its own guard.
const css = source.replace(/\/\*[\s\S]*?\*\//g, "");

// CSS-wide keywords whose value the browser derives from the OS/browser theme.
const SYSTEM_COLORS = [
  "CanvasText",
  "Canvas",
  "GrayText",
  "Field",
  "FieldText",
  "ButtonText",
  "ButtonFace",
  "Highlight",
  "HighlightText",
  "LinkText",
  "AccentColor",
  "AccentColorText",
];

test("the stylesheet never falls back to a browser-driven system color", () => {
  const found = SYSTEM_COLORS.filter((name) => new RegExp(`\\b${name}\\b`).test(css));
  assert.deepEqual(found, [], `system colors follow the browser theme, not ADO's: ${found.join(", ")}`);
});

test("the stylesheet never declares color-scheme", () => {
  assert.doesNotMatch(
    css,
    /color-scheme\s*:/,
    "color-scheme hands the palette to the browser's theme, which is not the host's",
  );
});

test("no @media (prefers-color-scheme) branch decides any color", () => {
  assert.doesNotMatch(
    css,
    /prefers-color-scheme/,
    "that media query reads the browser theme; the host theme arrives as CSS variables instead",
  );
});

test("every var() fallback is a literal, so a missing host variable still renders", () => {
  // `var(--x, <fallback>)` — the fallback must not itself be another guess with
  // no fallback of its own, and must not be a system color (covered above).
  const fallbacks = [...css.matchAll(/var\(\s*(--[\w-]+)\s*,([^()]*)\)/g)];
  assert.ok(fallbacks.length >= 3, "expected the host variables to be used with fallbacks");
  for (const [, name, fallback] of fallbacks) {
    assert.match(
      fallback.trim(),
      /^(#[0-9a-fA-F]{3,8}|rgb|rgba|hsl|[a-z]+)/,
      `${name} has no usable literal fallback`,
    );
  }
});

test("the one host variable the SDK guarantees is the one the body relies on", () => {
  assert.match(
    css,
    /color:\s*var\(--text-primary-color,/,
    "the SDK itself sets body colour from --text-primary-color; everything else is mixed from it",
  );
});
