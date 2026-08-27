// The work item form control: binds the tree to a field of the form.
//
// Everything here is glue — the domain lives in tree.js. The control reads the
// field's allowed values (a picklist, normally), renders them as a tree, and
// writes back the full path of the node the user picks.
//
// Shape: closed, the control is a single line that reads like a form field;
// clicking it opens the panel with the filter and the tree, and picking a node
// closes it again. It is NOT a floating dropdown — the iframe the work item
// form gives the control clips its contents, so nothing can overlay the rest of
// the form. Opening asks the host for more height (SDK.resize) and pushes the
// form's content down; closing gives the space back. Confirmed working against
// a real form on 2026-08-27, which is what made this shape worth building.

import * as SDK from "azure-devops-extension-sdk";
import { parsePaths, buildTree, ancestorsOf, normalizePath } from "./tree.js";
import { renderTreeInto } from "./treeview.js";

// Contribution ids of the two host services this control uses. Declared here
// rather than imported from `azure-devops-extension-api`: that package ships
// the whole REST surface for the sake of two strings, and the control never
// leaves the client — every read and write goes through the form, not the API.
const WORK_ITEM_FORM_SERVICE_ID = "ms.vss-work-web.work-item-form";
const HOST_PAGE_LAYOUT_SERVICE_ID = "ms.vss-features.host-page-layout-service";

/** Contribution id of the dialog content, as declared in vss-extension.json. */
const DIALOG_CONTRIBUTION = "simple-tree-picker-dialog";

const MIN_HEIGHT = 32;
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
  /** Whether the picker panel is showing. Closed, the control is one line. */
  open: false,
  /** "inline" (panel that pushes) or "dialog" (host dialog that floats). */
  pickerStyle: "inline",
};

let formService = null;
const dom = {};

// ---------------------------------------------------------------- rendering

/**
 * The tree itself is drawn by the shared view, so the inline panel and the
 * dialog cannot drift apart in look or behaviour.
 */
function renderTree() {
  renderTreeInto(dom.tree, {
    tree: state.tree,
    value: state.value,
    filter: state.filter,
    expanded: state.expanded,
    orphan: state.orphan,
    onSelect: select,
    onToggle: toggleExpanded,
    emptyMessage:
      "This field has no values to pick from. Add them to the field's picklist, or to the control's Paths input.",
  });
  requestHeight();
}

function renderHeader() {
  dom.value.textContent = state.value || "(none)";
  dom.value.classList.toggle("is-empty", !state.value);
  dom.toggle.title = state.value || "Pick a value";
  dom.toggle.setAttribute("aria-expanded", String(state.open));
  dom.chevron.textContent = state.open ? "▴" : "▾";
  dom.clear.hidden = !state.value;
  dom.message.textContent = state.message;
  dom.message.hidden = !state.message;
}

function render() {
  renderHeader();
  dom.panel.hidden = !state.open;
  if (state.open) renderTree();
  else requestHeight();
}

/**
 * Asks the host for the height the content needs, between the two caps.
 *
 * Measure the CONTROL, never the document. `document.documentElement.scrollHeight`
 * returns max(content, viewport), and inside an iframe the viewport IS the
 * frame we are trying to size — so once the frame had grown to fit an open
 * tree, the measurement kept reporting that grown size no matter how little
 * content was left. The height could only ever ratchet upward, which in 0.1.2
 * looked like the host refusing to shrink the control. It was not: it was being
 * asked for the wrong number. The root element's box depends on its content
 * alone, so it stays honest in both directions.
 */
function requestHeight() {
  const needed = Math.ceil(dom.root.getBoundingClientRect().height) + 2;
  SDK.resize(undefined, Math.max(MIN_HEIGHT, Math.min(needed, MAX_HEIGHT)));
}

// ------------------------------------------------------------------ actions

function toggleExpanded(path) {
  if (state.expanded.has(path)) state.expanded.delete(path);
  else state.expanded.add(path);
  render();
}

/**
 * The expansion a freshly opened panel deserves: just the path down to the
 * current value, nothing else — the selection stays visible, which is the point
 * of revealing it at all.
 *
 * Expansion used to only ever GROW: every selection opened its ancestors and
 * nothing ever closed them, so the tree drifted towards fully open and stayed
 * there for the life of the form.
 */
function resetExpansion() {
  state.expanded = new Set(ancestorsOf(state.value));
}

/**
 * Opening and closing the panel.
 *
 * This is as close to a dropdown as a work item form control gets. The control
 * lives in an iframe that CLIPS, so nothing can float over the rest of the
 * form; what the panel does instead is grow the iframe through SDK.resize and
 * push the form's content down, then give the space back on close. v0.1.1 kept
 * the tree open permanently and cost ~320px of every form that used it.
 */
function openPanel() {
  state.open = true;
  state.filter = "";
  dom.filter.value = "";
  // Each opening starts from the same place: only the path to the current
  // value, never whatever was left expanded last time.
  resetExpansion();
  render();
  dom.filter.focus();
}

function closePanel() {
  if (!state.open) return;
  state.open = false;
  render();
}

function togglePanel() {
  if (state.pickerStyle === "dialog") {
    openDialog();
    return;
  }
  if (state.open) closePanel();
  else openPanel();
}

/**
 * The dialog surface, chosen per field through the PickerStyle input.
 *
 * The host draws it at page level, so it genuinely FLOATS over the form — the
 * one thing the inline panel cannot do, because the control's iframe clips. It
 * is a centred modal rather than a dropdown anchored to the field: the platform
 * offers extensions a dialog and a side panel and nothing anchored, so an
 * Area-Path-style popup is not reachable from an extension at all.
 *
 * The picked value travels through a CALLBACK in `configuration`, not through
 * the dialog's return value — XDM proxies functions across the frame boundary,
 * which is how `onClose` itself works. That means the field is written the
 * moment the user picks: if the host's own close handle turns out not to be
 * where the dialog expects it, the value is already saved and the worst case is
 * that the user closes the dialog by hand.
 */
async function openDialog() {
  try {
    const layout = await SDK.getService(HOST_PAGE_LAYOUT_SERVICE_ID);
    layout.openCustomDialog(`${SDK.getExtensionContext().id}.${DIALOG_CONTRIBUTION}`, {
      title: state.fieldName ? `Select a value` : "Simple Tree Picker",
      lightDismiss: true,
      configuration: {
        paths: state.paths,
        value: state.value,
        onPick: (path) => select(path),
      },
    });
  } catch (error) {
    state.message = `Could not open the picker: ${error?.message ?? error}`;
    render();
  }
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
    // Picking is the whole point of having the panel open, so it closes —
    // the form gets its space back without the user asking twice.
    state.open = false;
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
  // A load, a refresh or a reset is a fresh start for the form, so the tree
  // starts closed too. onFieldChanged deliberately does NOT come through here:
  // collapsing the tree under someone mid-edit would be hostile.
  resetExpansion();
  render();
}

// -------------------------------------------------------------------- setup

/** Idempotent: fail() may run after main() already captured, and re-binding the
 *  listeners there would fire clear and filter twice per interaction. */
function captureDom() {
  if (dom.root) return;
  dom.root = document.getElementById("stp-root");
  dom.toggle = document.getElementById("stp-toggle");
  dom.value = document.getElementById("stp-value");
  dom.chevron = document.getElementById("stp-chevron");
  dom.clear = document.getElementById("stp-clear");
  dom.panel = document.getElementById("stp-panel");
  dom.filter = document.getElementById("stp-filter");
  dom.tree = document.getElementById("stp-tree");
  dom.message = document.getElementById("stp-message");

  dom.toggle.addEventListener("click", togglePanel);
  dom.clear.addEventListener("click", clearValue);
  dom.filter.addEventListener("input", () => {
    state.filter = dom.filter.value;
    renderTree();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) {
      event.preventDefault();
      closePanel();
      dom.toggle.focus();
    }
  });

  // Clicking elsewhere in the form closes the panel, the way a dropdown would.
  // The iframe cannot see clicks outside itself, but it does lose focus — and
  // the timeout lets focus land inside the control first, since clicking a row
  // blurs the window momentarily in some browsers.
  window.addEventListener("blur", () => {
    setTimeout(() => {
      if (state.open && !document.hasFocus()) closePanel();
    }, 0);
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
  // Anything that is not exactly "dialog" means inline, so a typo in the layout
  // config degrades to the surface that works without any host service.
  state.pickerStyle =
    String(inputs.PickerStyle ?? "").trim().toLowerCase() === "dialog" ? "dialog" : "inline";

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
