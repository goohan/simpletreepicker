// Path parsing and tree building — the whole domain of this extension.
// No SDK, no DOM: pure functions, unit-tested in test/tree.test.mjs.
//
// The model: the field's value set is a FLAT list of paths whose segments are
// separated by a backslash, exactly like the Area Path of Azure DevOps:
//
//   A
//   A\B
//   A\B\C
//   A2
//   A3\B\C
//
// Rules:
// - A node is SELECTABLE only if its full path is present in the list. `A3\B`
//   above exists as a branch (it has to, for `A3\B\C` to hang somewhere) but
//   was never declared, so it groups without being a valid value. This keeps
//   the control incapable of writing a value the field would reject.
// - Source order is preserved. Whoever curates the list — the picklist of the
//   field, normally — decides how siblings are ordered; this file never sorts.
// - Segments are trimmed and empty ones dropped, so `A \ B` and `A\B` are the
//   same path and a trailing separator is harmless.

export const SEPARATOR = "\\";

/** Trims every segment and drops the empty ones: `A \ B\ ` -> `A\B`. */
export function normalizePath(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .split(SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join(SEPARATOR);
}

/**
 * Normalizes whatever the value source hands over — an array (the allowed
 * values of a picklist field) or loose text (the control's `Paths` input,
 * split on newlines and semicolons) — into a deduplicated list of paths.
 */
export function parsePaths(source) {
  const entries = Array.isArray(source)
    ? source
    : String(source ?? "").split(/[\r\n;]+/);
  const seen = new Set();
  const paths = [];
  for (const entry of entries) {
    const path = normalizePath(typeof entry === "string" ? entry : String(entry ?? ""));
    if (path && !seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Builds the tree. Every node is `{ name, path, selectable, children }`, where
 * `path` is the full path — the value the field stores — and `selectable` says
 * whether that path was actually declared in the list.
 */
export function buildTree(paths) {
  const roots = [];
  const byPath = new Map();

  for (const path of paths) {
    let prefix = "";
    let siblings = roots;
    for (const segment of path.split(SEPARATOR)) {
      prefix = prefix ? prefix + SEPARATOR + segment : segment;
      let node = byPath.get(prefix);
      if (!node) {
        node = { name: segment, path: prefix, selectable: false, children: [] };
        byPath.set(prefix, node);
        siblings.push(node);
      }
      siblings = node.children;
    }
    byPath.get(path).selectable = true;
  }
  return roots;
}

/** The paths of every ancestor of a path: `A\B\C` -> [`A`, `A\B`]. */
export function ancestorsOf(path) {
  const segments = normalizePath(path).split(SEPARATOR).filter(Boolean);
  const ancestors = [];
  let prefix = "";
  for (let i = 0; i < segments.length - 1; i++) {
    prefix = prefix ? prefix + SEPARATOR + segments[i] : segments[i];
    ancestors.push(prefix);
  }
  return ancestors;
}

/** Whether a node answers to a search term, by its own name or its full path. */
function hits(node, needle) {
  return node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle);
}

/**
 * The path of the first SELECTABLE node that matches the term, in the order the
 * tree reads top to bottom. Empty string when nothing matches.
 *
 * Not the same as "the first node in the filtered tree": filtering keeps
 * ancestors so the matches can be reached, and those ancestors are usually
 * selectable themselves. Searching `Erp` under `A\Erp` would otherwise land on
 * `A`, which never matched anything — so this walks for a real hit.
 */
export function findFirstMatch(nodes, term) {
  const needle = String(term ?? "").trim().toLowerCase();
  if (!needle) return "";

  const walk = (list) => {
    for (const node of list) {
      if (node.selectable && hits(node, needle)) return node.path;
      const found = walk(node.children);
      if (found) return found;
    }
    return "";
  };
  return walk(nodes);
}

/**
 * Prunes the tree down to the branches that contain a match, keeping the
 * ancestors needed to reach them. A node matches on its own name or on its
 * full path, so typing `A\B` narrows to that branch; a matching node keeps its
 * whole subtree, so you can still walk down from a hit.
 */
export function filterTree(nodes, term) {
  const needle = String(term ?? "").trim().toLowerCase();
  if (!needle) return nodes;

  const prune = (list) => {
    const kept = [];
    for (const node of list) {
      const hit = hits(node, needle);
      const children = hit ? node.children : prune(node.children);
      if (hit || children.length > 0) kept.push({ ...node, children });
    }
    return kept;
  };
  return prune(nodes);
}
