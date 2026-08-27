// The work item form control: binds the tree to a field of the form.
//
// Everything here is glue — the domain lives in tree.js. The control reads the
// field's allowed values (a picklist, normally), renders them as a tree, and
// writes back the full path of the node the user picks.
//
// Height: the control asks the host for exactly the height it needs on every
// render (SDK.resize), capped, so a shallow tree does not waste form space.
// Nothing depends on the host honoring it: the body scrolls if it does not,
// and the tree has its own cap, so the control is usable either way.

import * as SDK from "azure-devops-extension-sdk";
import { parsePaths, buildTree, ancestorsOf, filterTree, normalizePath } from "./tree.js";

// Contribution id of the work item form service. Declared here rather than
// imported from `azure-devops-extension-api`: that package ships the whole REST
// surface for the sake of this one string, and the control never leaves the
// client — every read and write goes through the form, not the API.
const WORK_ITEM_FORM_SERVICE_ID = "ms.vss-work-web.work-item-form";

const MIN_HEIGHT = 90;
const MAX_HEIGHT = 460;

const state = {
  fieldName: "",
  configuredPaths: "",
  paths: [],
  tree: [],
  value: "",
  /** The stored value is not in the list — a renamed or hand-written path. */
  orphan: false,
  expanded: new Set(),
  filter: "",
  message: "",
};

let formService = null;
const dom = {};

// ---------------------------------------------------------------- rendering

/** Every node is rendered from data with textContent: field values are never markup. */
function renderTree() {
  const filtering = state.filter.trim().length > 0;
  const nodes = filterTree(state.tree, state.filter);
  dom.tree.replaceChildren();

  if (nodes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "stp-empty";
    empty.textContent = state.paths.length
      ? "No node matches the filter."
      : "This field has no values to pick from. Add them to the field's picklist, or to the control's Paths input.";
    dom.tree.append(empty);
  } else {
    dom.tree.append(renderList(nodes, 0, filtering));
  }
  requestHeight();
}

function renderList(nodes, depth, filtering) {
  const list = document.createElement("ul");
  list.className = "stp-list";
  list.setAttribute("role", depth === 0 ? "tree" : "group");

  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    const expanded = filtering || state.expanded.has(node.path);
    const selected = node.path === state.value;

    const item = document.createElement("li");
    item.className = "stp-item";
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-selected", String(selected));
    if (hasChildren) item.setAttribute("aria-expanded", String(expanded));

    const row = document.createElement("div");
    row.className = "stp-row";
    if (selected) row.classList.add("is-selected");
    if (!node.selectable) row.classList.add("is-group");
    row.style.paddingLeft = `${depth * 16 + 4}px`;
    row.title = node.selectable ? node.path : `${node.path} — grouping only, not a valid value`;

    const twisty = document.createElement("span");
    twisty.className = "stp-twisty";
    if (hasChildren) {
      twisty.textContent = expanded ? "▾" : "▸";
      twisty.setAttribute("role", "button");
      twisty.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
      twisty.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleExpanded(node.path);
      });
    }
    row.append(twisty);

    const label = document.createElement("span");
    label.className = "stp-label";
    label.textContent = node.name;
    row.append(label);

    if (selected && state.orphan) {
      const badge = document.createElement("span");
      badge.className = "stp-badge";
      badge.textContent = "not in list";
      row.append(badge);
    }
    if (selected) {
      const check = document.createElement("span");
      check.className = "stp-check";
      check.textContent = "✓";
      row.append(check);
    }

    if (node.selectable) {
      row.tabIndex = 0;
      row.addEventListener("click", () => select(node.path));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(node.path);
        }
      });
    } else if (hasChildren) {
      row.tabIndex = 0;
      row.addEventListener("click", () => toggleExpanded(node.path));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleExpanded(node.path);
        }
      });
    }

    item.append(row);
    if (hasChildren && expanded) item.append(renderList(node.children, depth + 1, filtering));
    list.append(item);
  }
  return list;
}

function renderHeader() {
  dom.value.textContent = state.value || "(none)";
  dom.value.classList.toggle("is-empty", !state.value);
  dom.value.title = state.value;
  dom.clear.hidden = !state.value;
  dom.message.textContent = state.message;
  dom.message.hidden = !state.message;
}

function render() {
  renderHeader();
  renderTree();
}

/** Asks the host for the height the content needs, between the two caps. */
function requestHeight() {
  const needed = Math.ceil(document.documentElement.scrollHeight);
  SDK.resize(undefined, Math.max(MIN_HEIGHT, Math.min(needed, MAX_HEIGHT)));
}

// ------------------------------------------------------------------ actions

function toggleExpanded(path) {
  if (state.expanded.has(path)) state.expanded.delete(path);
  else state.expanded.add(path);
  renderTree();
}

/**
 * The tree the control shows: the configured paths, plus the current value
 * grafted on when it is not among them (a renamed or hand-written path). Called
 * on every change of either, so a stale graft never outlives the value that
 * caused it.
 */
function rebuildTree() {
  state.orphan = Boolean(state.value) && !state.paths.includes(state.value);
  state.tree = buildTree(state.orphan ? [...state.paths, state.value] : state.paths);
}

async function select(path) {
  if (path === state.value) return;
  try {
    await formService.setFieldValue(state.fieldName, path);
    state.value = path;
    rebuildTree();
    state.message = "";
  } catch (error) {
    // The usual cause is a read-only work item or field: report it in place
    // instead of leaving the click silently doing nothing.
    state.message = `Could not set the value: ${error?.message ?? error}`;
  }
  render();
}

async function clearValue() {
  try {
    await formService.setFieldValue(state.fieldName, "");
    state.value = "";
    rebuildTree();
    state.message = "";
  } catch (error) {
    state.message = `Could not clear the value: ${error?.message ?? error}`;
  }
  render();
}

// ------------------------------------------------------------------ loading

/**
 * The value source, in order: the field's allowed values (the picklist — the
 * server validates against exactly this list, which is why it comes first) and,
 * when the field has none, the `Paths` input of the control's configuration.
 */
async function loadPaths() {
  let allowed = null;
  try {
    allowed = await formService.getAllowedFieldValues(state.fieldName);
  } catch {
    // A field without a picklist throws or returns nothing; the fallback covers it.
  }
  const fromField = Array.isArray(allowed) ? allowed.filter((value) => value != null).map(String) : [];
  state.paths = fromField.length ? parsePaths(fromField) : parsePaths(state.configuredPaths);
}

async function syncValue() {
  let raw = "";
  try {
    raw = await formService.getFieldValue(state.fieldName);
  } catch (error) {
    state.message = `Could not read the field: ${error?.message ?? error}`;
  }
  state.value = normalizePath(raw == null ? "" : String(raw));
  rebuildTree();

  // The path to the current value is opened, so a deep selection is visible
  // without the user hunting for it.
  for (const ancestor of ancestorsOf(state.value)) state.expanded.add(ancestor);
}

async function refresh() {
  await loadPaths();
  await syncValue();
  render();
}

// -------------------------------------------------------------------- setup

/** Idempotent: fail() may run after main() already captured, and re-binding the
 *  listeners there would fire clear and filter twice per interaction. */
function captureDom() {
  if (dom.root) return;
  dom.root = document.getElementById("stp-root");
  dom.value = document.getElementById("stp-value");
  dom.clear = document.getElementById("stp-clear");
  dom.filter = document.getElementById("stp-filter");
  dom.tree = document.getElementById("stp-tree");
  dom.message = document.getElementById("stp-message");

  dom.clear.addEventListener("click", clearValue);
  dom.filter.addEventListener("input", () => {
    state.filter = dom.filter.value;
    renderTree();
  });
}

function fail(message) {
  captureDom();
  state.message = message;
  dom.tree.replaceChildren();
  renderHeader();
  requestHeight();
}

async function main() {
  await SDK.init({ loaded: false, applyTheme: true });
  captureDom();

  const inputs = SDK.getConfiguration().witInputs ?? {};
  state.fieldName = String(inputs.FieldName ?? "").trim();
  state.configuredPaths = String(inputs.Paths ?? "");

  if (!state.fieldName) {
    fail("No field is bound to this control. Set its Field input in the work item layout.");
    await SDK.notifyLoadSucceeded();
    return;
  }

  formService = await SDK.getService(WORK_ITEM_FORM_SERVICE_ID);

  SDK.register(SDK.getContributionId(), () => ({
    onLoaded: refresh,
    onRefreshed: refresh,
    onReset: refresh,
    onSaved: syncAndRender,
    onFieldChanged: (args) => {
      const changed = Object.keys(args?.changedFields ?? {});
      if (changed.some((name) => name.toLowerCase() === state.fieldName.toLowerCase())) {
        syncAndRender();
      }
    },
  }));

  await refresh();
  await SDK.notifyLoadSucceeded();
}

async function syncAndRender() {
  await syncValue();
  render();
}

main().catch(async (error) => {
  try {
    fail(`Simple Tree Picker failed to load: ${error?.message ?? error}`);
  } catch {
    // The DOM may not be there yet; the host notification below still reports it.
  }
  await SDK.notifyLoadFailed(error instanceof Error ? error : String(error));
});
