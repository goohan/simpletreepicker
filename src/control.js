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
import { parsePaths, buildTree, ancestorsOf, findFirstMatch, normalizePath } from "./tree.js";
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
  /** Whether a host dialog is already up, so a second call cannot stack one. */
  dialogOpen: false,
  /** The highlighted row. The caret never leaves the field, so "where the
   *  arrows are" is state, not focus — the native combo pattern. */
  activePath: "",
};

let formService = null;
const dom = {};

// ---------------------------------------------------------------- rendering

/**
 * The tree itself is drawn by the shared view, so the inline panel and the
 * dialog cannot drift apart in look or behavior.
 */
function renderTree() {
  renderTreeInto(dom.tree, {
    tree: state.tree,
    value: state.value,
    filter: state.filter,
    expanded: state.expanded,
    orphan: state.orphan,
    active: state.activePath,
    onSelect: select,
    onToggle: toggleExpanded,
    emptyMessage:
      "This field has no values to pick from. Add them to the field's picklist, or to the control's Paths input.",
  });
  revealActive();
  requestHeight();
}

/** The rendered row for a path, if it is currently on screen. */
function rowFor(path) {
  if (!path) return null;
  return dom.tree.querySelector(`.stp-row[data-path="${CSS.escape(path)}"]`);
}

/** Every row on screen, in reading order — what the arrows walk. */
function visibleRows() {
  return [...dom.tree.querySelectorAll(".stp-row")];
}

/**
 * Scrolls the active row into view and tells assistive technology which row the
 * field is pointing at. The caret stays in the input throughout, which is the
 * odd-looking trick native comboboxes use: you keep typing while the arrows
 * walk the list, because the list never takes the focus.
 */
function revealActive() {
  const row = rowFor(state.activePath);
  if (row) {
    row.scrollIntoView({ block: "nearest" });
    dom.input.setAttribute("aria-activedescendant", row.id);
  } else {
    dom.input.removeAttribute("aria-activedescendant");
  }
}

/** Moves the highlight without a full re-render, so arrowing stays smooth. */
function moveActive(delta) {
  const rows = visibleRows();
  if (rows.length === 0) return;
  const index = rows.findIndex((row) => row.dataset.path === state.activePath);
  const next =
    index < 0
      ? delta > 0
        ? 0
        : rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, index + delta));

  state.activePath = rows[next].dataset.path;
  for (const row of rows) row.classList.toggle("is-active", row === rows[next]);
  revealActive();
}

function renderHeader() {
  // The input mirrors the value, EXCEPT while the panel is open, when it
  // belongs to whatever the user is typing.
  if (!state.open) dom.input.value = state.value;
  dom.input.title = state.value || "Pick a value";
  dom.input.setAttribute("aria-expanded", String(state.open));
  // Typing filters the inline tree; with the dialog style there is no inline
  // tree to filter, so the field stays a button in all but name.
  dom.input.readOnly = state.pickerStyle === "dialog";
  dom.field.classList.toggle("is-open", state.open);
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
  // The arrows start where the selection is, not at the top of the list: with
  // a value already set, walking from the first root would be a chore.
  state.activePath = state.value;
  // Each opening starts from the same place: only the path to the current
  // value, never whatever was left expanded last time.
  resetExpansion();
  render();
  dom.input.focus();
  // Selected, so the first keystroke replaces the value — a native combo does
  // the same, and it is what makes typing feel like searching rather than editing.
  dom.input.select();
}

/**
 * What leaving the control does with whatever was typed. Johan's rules
 * (2026-08-27), and the invariant behind them is that the field always ends up
 * holding a real node or nothing at all — typed text that means nothing never
 * survives the control losing focus:
 *
 *   emptied      -> the value is cleared, exactly as pressing the clear button
 *   has a match  -> the first matching node becomes the value
 *   no match     -> whatever was there before stands, untouched
 */
async function commitTyped() {
  const typed = dom.input.value.trim();
  if (typed === state.value) return;
  if (typed === "") {
    await setValue("");
    return;
  }
  const match = findFirstMatch(state.tree, typed);
  if (match) await setValue(match);
}

/**
 * What Enter and Tab do: take the highlighted node. A group only opens and
 * closes, so landing on one toggles it instead of pretending to pick it; with
 * nothing highlighted this falls back to resolving whatever was typed.
 */
async function commitActive() {
  const path = state.activePath;
  if (path && state.paths.includes(path)) {
    await select(path);
    return;
  }
  if (path && rowFor(path)) {
    toggleExpanded(path);
    return;
  }
  await closePanel({ commit: true });
}

/**
 * @param {boolean} commit  false cancels — Escape restores the previous value
 *   rather than committing the typing, because losing a value by pressing
 *   Escape would be a surprise. Every other way of leaving commits.
 */
async function closePanel({ commit = true } = {}) {
  if (!state.open) return;
  if (commit) await commitTyped();
  state.open = false;
  state.filter = "";
  state.activePath = "";
  render();
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
  // Belt and braces against opening two at once. It happened for a dull reason
  // — a listener registered twice, so every click ran the handler twice — and
  // two stacked dialogs each need their own dismissal, which reads as the first
  // Escape doing nothing. The duplicate is gone; this makes the symptom
  // unreachable whatever causes a second call.
  if (state.dialogOpen) return;
  try {
    const layout = await SDK.getService(HOST_PAGE_LAYOUT_SERVICE_ID);
    state.dialogOpen = true;
    layout.openCustomDialog(`${SDK.getExtensionContext().id}.${DIALOG_CONTRIBUTION}`, {
      title: state.fieldName ? `Select a value` : "Simple Tree Picker",
      lightDismiss: true,
      onClose: () => {
        state.dialogOpen = false;
      },
      configuration: {
        paths: state.paths,
        value: state.value,
        onPick: (path) => select(path),
      },
    });
  } catch (error) {
    state.dialogOpen = false;
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

/**
 * The single place the field is written, so every route into it — a click on a
 * node, typed text, the clear button, the dialog — shares one error path.
 */
async function setValue(path) {
  if (path === state.value) return;
  try {
    await formService.setFieldValue(state.fieldName, path);
    state.value = path;
    rebuildTree();
    state.message = "";
  } catch (error) {
    // The usual cause is a read-only work item or field: report it in place
    // instead of leaving the interaction silently doing nothing.
    state.message = `Could not set the value: ${error?.message ?? error}`;
  }
}

async function select(path) {
  await setValue(path);
  // Picking is the whole point of having the panel open, so it closes — the
  // form gets its space back without the user asking twice.
  state.open = false;
  state.filter = "";
  state.activePath = "";
  render();
}

async function clearValue() {
  await setValue("");
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
  dom.field = document.getElementById("stp-field");
  dom.input = document.getElementById("stp-input");
  dom.chevron = document.getElementById("stp-chevron");
  dom.clear = document.getElementById("stp-clear");
  dom.panel = document.getElementById("stp-panel");
  dom.tree = document.getElementById("stp-tree");
  dom.message = document.getElementById("stp-message");

  // Focus alone NEVER opens the picker. Landing here while tabbing through the
  // form must not throw a tree or a dialog in the user's way; opening is always
  // deliberate — a click, a key that means "open", or typing.
  //
  // The text is selected all the same, so the first character a keyboard user
  // types REPLACES the value rather than appending to it. Without that, tabbing
  // in and typing would search for "Development\SalesforceX" and find nothing.
  dom.input.addEventListener("focus", () => dom.input.select());

  // One handler for the WHOLE field, chevron and padding included. Hanging it
  // on the input alone left dead zones — the field's padding and the gap beside
  // the chevron swallowed clicks and the control just sat there, which is what
  // made opening feel sticky.
  //
  // Opening by mouse routes through focus() rather than the browser's own caret
  // placement: otherwise the mouseup that follows collapses the selection
  // openPanel just made, and the first keystroke APPENDS to the current value
  // instead of replacing it. Once open, clicks in the text are left alone so
  // the caret can be placed normally.
  dom.field.addEventListener("mousedown", (event) => {
    if (state.pickerStyle === "dialog") {
      event.preventDefault();
      openDialog();
      return;
    }
    if (event.target === dom.chevron) {
      event.preventDefault();
      if (state.open) closePanel();
      else openPanel();
      return;
    }
    if (!state.open) {
      event.preventDefault();
      openPanel();
    }
  });

  dom.input.addEventListener("input", () => {
    state.filter = dom.input.value;
    state.open = true;
    // The highlight follows the search, so Enter and Tab always have something
    // to take and you can see what it is before you take it.
    state.activePath = findFirstMatch(state.tree, state.filter) || state.value;
    render();
  });

  // All of it read in the field, which never gives up the caret. Rows are not
  // focusable, so there is nothing else for these keys to reach.
  dom.input.addEventListener("keydown", (event) => {
    // The keys that mean "open" — the keyboard's way in, since focus no longer
    // opens. Space only where the field is not typable: inline it is a character.
    const asksToOpen =
      event.key === "ArrowDown" ||
      event.key === "Enter" ||
      (event.key === " " && dom.input.readOnly);

    if (!state.open) {
      if (asksToOpen) {
        event.preventDefault();
        if (state.pickerStyle === "dialog") openDialog();
        else openPanel();
      }
      // Everything else — Tab above all — is left to the form. A closed picker
      // has no business swallowing the key that walks to the next field.
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closePanel({ commit: false });
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const wantOpen = event.key === "ArrowRight";
      const path = state.activePath;
      if (path && rowFor(path)?.querySelector(".stp-twisty.is-clickable") && state.expanded.has(path) !== wantOpen) {
        event.preventDefault();
        toggleExpanded(path);
      }
      return;
    }
    // Open, Enter and Tab agree: take the highlighted node, the way an editor's
    // completion list behaves. Tab's preventDefault is the point — it confirms
    // here instead of walking away and leaving the highlight unclaimed.
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      commitActive();
    }
  });

  // Clicking INSIDE the panel must never blur the field. Without this, clicking
  // a row's chevron — which is not focusable — dropped focus to nowhere, the
  // focusout below read that as leaving the control, and the panel shut before
  // the click could expand anything. It is why expanding a node appeared to
  // pick it and close.
  dom.panel.addEventListener("mousedown", (event) => event.preventDefault());

  dom.clear.addEventListener("click", clearValue);

  // Leaving the control entirely — not merely moving between its own parts —
  // is what commits the typing.
  //
  // The check is deferred one tick on purpose. Re-rendering the tree replaces
  // its rows, so the focused row is destroyed and focus falls to the body,
  // firing focusout with a null relatedTarget: indistinguishable, in the moment,
  // from the user clicking away. That is why expanding a branch with the arrow
  // keys used to shut the whole panel. By the next tick the render has finished
  // and focus is back on the restored row, so asking where focus actually
  // ENDED UP answers the real question.
  dom.root.addEventListener("focusout", (event) => {
    if (dom.root.contains(event.relatedTarget)) return;
    setTimeout(() => {
      if (!dom.root.contains(document.activeElement)) closePanel({ commit: true });
    }, 0);
  });

  // Clicking elsewhere in the FORM, outside this iframe: the frame cannot see
  // that click, but it does lose focus. The timeout lets focus land inside the
  // control first, since clicking a row blurs the window momentarily in some
  // browsers.
  window.addEventListener("blur", () => {
    setTimeout(() => {
      if (state.open && !document.hasFocus()) closePanel({ commit: true });
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
