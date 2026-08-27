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
  // `var(--x, <fallback>)` — the fallback must be a value the browser can use
  // on its own. Two legal shapes, because Azure DevOps has two kinds of token:
  // a complete color (`rgba(...)`, `#hex`) and a bare RGB component list
  // ("200, 200, 200"), which is what every --palette-* variable holds.
  const fallbacks = [...css.matchAll(/var\(\s*(--[\w-]+)\s*,([^()]*|[^()]*\([^()]*\)[^()]*)\)/g)];
  assert.ok(fallbacks.length >= 3, "expected the host variables to be used with fallbacks");
  for (const [, name, fallback] of fallbacks) {
    assert.match(
      fallback.trim(),
      /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|\d)/,
      `${name} has no usable literal fallback`,
    );
  }
});

test("every Azure DevOps variable referenced here exists in the captured theme", async () => {
  // The names are not guessable, and guessing them is exactly how 0.1.1 shipped
  // a --palette-error-text that Azure DevOps has never defined: the rule fell
  // back silently and nobody could see it. dev/ado-theme-light.json is a real
  // capture from a live work item form, so it settles the question by evidence.
  const theme = JSON.parse(await readFile(new URL("../dev/ado-theme-light.json", import.meta.url), "utf8"));
  const referenced = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));

  // The control's own tokens are defined in this very file, not by the host.
  const ours = new Set([...css.matchAll(/^\s*(--stp-[\w-]+)\s*:/gm)].map((m) => m[1]));

  const invented = [...referenced].filter((name) => !ours.has(name) && !(name in theme));
  assert.deepEqual(invented, [], `not defined by Azure DevOps: ${invented.join(", ")}`);
});

test("palette tokens are used as RGB components and the rest as whole colors", () => {
  // --palette-* holds "200, 200, 200", so it only works wrapped in rgb()/rgba().
  // Used bare it silently produces an invalid declaration and no color at all.
  const bare = [...css.matchAll(/(^|[^(])\bvar\(\s*(--palette-[\w-]+)/g)].map((m) => m[2]);
  assert.deepEqual(bare, [], `--palette-* used outside rgb()/rgba(): ${bare.join(", ")}`);
});

test("the text color derives from the one host variable the SDK guarantees", () => {
  // The SDK pins `body { color: var(--text-primary-color) }` itself, so that
  // token is the safest of the lot; the control's own --stp-text is built on it
  // and everything readable follows from there.
  assert.match(
    css,
    /--stp-text:\s*var\(--text-primary-color,/,
    "--stp-text must derive from --text-primary-color, the token the SDK sets itself",
  );
  assert.match(css, /body\s*\{[^}]*color:\s*var\(--stp-text\)/, "the body must use --stp-text");
});
