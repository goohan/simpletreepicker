// The dialog surface: the same tree, drawn inside a dialog the HOST renders at
// page level, so it floats over the work item form instead of pushing it down.
//
// This page is a separate contribution with its own bundle. It shares tree.js
// and treeview.js with the control, so the two surfaces cannot drift apart.
//
// How it talks to the control: the control passes `paths`, `value` and an
// `onPick` callback through the dialog's `configuration`, and XDM proxies that
// function across the frame boundary. So the field is written by the CONTROL
// the moment a node is picked here — this page never touches the work item.
// That matters because it keeps the one uncertain part (closing the dialog,
// whose host handle is typed `any` in the SDK) off the path that saves data.

import * as SDK from "azure-devops-extension-sdk";
import { parsePaths, buildTree, ancestorsOf, findFirstMatch, normalizePath } from "./tree.js";
import { renderTreeInto } from "./treeview.js";

const state = {
  paths: [],
  tree: [],
  value: "",
  orphan: false,
  expanded: new Set(),
  filter: "",
};

const dom = {};
let config = {};

/**
 * The host hands the dialog content a handle for closing itself, but the SDK
 * types that configuration as `any`, so the name is not something to bet on.
 * Rather than guess once and fail silently, look for it where it plausibly
 * lives and report honestly when it is nowhere to be found.
 */
function closeDialog(result) {
  const candidates = [config?.dialog?.close, config?.panel?.close, config?.close];
  for (const close of candidates) {
    if (typeof close === "function") {
      close(result);
      return true;
    }
  }
  return false;
}

/**
 * Asks the host to size the dialog to the tree. Measures the root element, not
 * the document: inside a frame, `documentElement.scrollHeight` reports
 * max(content, viewport), which means the frame being sized — the same trap
 * that made the inline control able to grow but never shrink.
 */
function requestHeight() {
  const root = document.getElementById("stp-root");
  SDK.resize(undefined, Math.ceil(root.getBoundingClientRect().height) + 24);
}

function render() {
  renderTreeInto(dom.tree, {
    tree: state.tree,
    value: state.value,
    filter: state.filter,
    expanded: state.expanded,
    orphan: state.orphan,
    active: findFirstMatch(state.tree, state.filter),
    onSelect: pick,
    onToggle: (path) => {
      if (state.expanded.has(path)) state.expanded.delete(path);
      else state.expanded.add(path);
      render();
    },
    emptyMessage: "This field has no values to pick from.",
  });
}

function pick(path) {
  // The control owns the field; this page only reports the choice.
  if (typeof config.onPick === "function") config.onPick(path);

  if (!closeDialog(path)) {
    // Value saved, dialog stuck open: say so rather than look broken.
    state.value = path;
    render();
    dom.message.textContent = "Value saved. Close this dialog to return to the form.";
    dom.message.hidden = false;
  }
}

async function main() {
  await SDK.init({ loaded: false, applyTheme: true });

  dom.filter = document.getElementById("stp-filter");
  dom.tree = document.getElementById("stp-tree");
  dom.message = document.getElementById("stp-message");

  config = SDK.getConfiguration() ?? {};
  state.paths = parsePaths(config.paths ?? []);
  state.value = normalizePath(String(config.value ?? ""));
  state.orphan = Boolean(state.value) && !state.paths.includes(state.value);
  state.tree = buildTree(state.orphan ? [...state.paths, state.value] : state.paths);
  state.expanded = new Set(ancestorsOf(state.value));

  dom.filter.addEventListener("input", () => {
    state.filter = dom.filter.value;
    render();
  });

  // Escape leaves exactly as clicking outside does — closing with no result, so
  // the control keeps the value it already had. A dialog that traps you until
  // you pick something would be worse than the panel it replaced.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeDialog(undefined);
  });

  render();
  requestHeight();
  await SDK.notifyLoadSucceeded();
  dom.filter.focus();
}

main().catch(async (error) => {
  await SDK.notifyLoadFailed(error instanceof Error ? error : String(error));
});
