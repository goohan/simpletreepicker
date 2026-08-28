// Rendering the tree into a container. Shared by the two surfaces the control
// can take — the inline panel and the host dialog — which differ only in where
// they live and how they close, never in how the tree looks or behaves.
//
// No SDK here, and no module state: everything comes in through the options, so
// this is as testable as tree.js and reusable by both entry points.

import { filterTree } from "./tree.js";

const INDENT_PX = 16;

/**
 * @param {HTMLElement} container  emptied and re-filled on every call
 * @param {object} options
 * @param {Array}  options.tree      the full tree; filtering happens here
 * @param {string} options.value     the selected path, if any
 * @param {string} options.filter    the filter term
 * @param {Set}    options.expanded  paths whose children are showing
 * @param {boolean} options.orphan   the value is not among the declared paths
 * @param {string} options.preselected  the node a bare Enter would settle on
 * @param {(path: string) => void} options.onSelect
 * @param {(path: string) => void} options.onToggle
 * @param {string} options.emptyMessage  shown when there is nothing to pick from
 */
export function renderTreeInto(container, options) {
  const { tree, filter, emptyMessage } = options;
  const filtering = String(filter ?? "").trim().length > 0;
  const nodes = filterTree(tree, filter ?? "");

  container.replaceChildren();

  if (nodes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "stp-empty";
    empty.textContent = filtering ? "No node matches the filter." : emptyMessage;
    container.append(empty);
    return;
  }
  container.append(renderList(nodes, 0, filtering, options));
}

function renderList(nodes, depth, filtering, options) {
  const { value, expanded: expandedPaths, orphan, preselected, onSelect, onToggle } = options;

  const list = document.createElement("ul");
  list.className = "stp-list";
  list.setAttribute("role", depth === 0 ? "tree" : "group");

  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    const expanded = filtering || expandedPaths.has(node.path);
    const selected = node.path === value;

    const item = document.createElement("li");
    item.className = "stp-item";
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-selected", String(selected));
    if (hasChildren) item.setAttribute("aria-expanded", String(expanded));

    const row = document.createElement("div");
    row.className = "stp-row";
    if (selected) row.classList.add("is-selected");
    else if (node.path === preselected) row.classList.add("is-preselected");
    if (!node.selectable) row.classList.add("is-group");
    row.dataset.path = node.path;
    row.style.paddingLeft = `${depth * INDENT_PX + 4}px`;
    row.title = node.selectable ? node.path : `${node.path} — grouping only, not a valid value`;

    // The twisty keeps its footprint even with no chevron, so labels line up at
    // a given depth whether or not the node has children. The chevron itself is
    // drawn in CSS, the same shape and weight as the field's own — a font glyph
    // gave a tiny filled triangle that read as a different language entirely.
    const twisty = document.createElement("span");
    twisty.className = "stp-twisty";
    if (hasChildren) {
      twisty.classList.add("is-clickable");
      if (expanded) twisty.classList.add("is-expanded");
      twisty.setAttribute("role", "button");
      twisty.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
      twisty.addEventListener("click", (event) => {
        event.stopPropagation();
        onToggle(node.path);
      });
    }
    row.append(twisty);

    const label = document.createElement("span");
    label.className = "stp-label";
    label.textContent = node.name;
    row.append(label);

    if (selected && orphan) {
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

    // A selectable node picks; a grouping node with children can only open and
    // close, which is also what its whole row does since it has nothing else to do.
    const activate = node.selectable
      ? () => onSelect(node.path)
      : hasChildren
        ? () => onToggle(node.path)
        : null;

    if (activate) {
      row.tabIndex = 0;
      row.addEventListener("click", activate);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      });
    }

    item.append(row);
    if (hasChildren && expanded) item.append(renderList(node.children, depth + 1, filtering, options));
    list.append(item);
  }
  return list;
}
