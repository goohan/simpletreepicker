# Change Log

## 0.2.0

- **New `PickerStyle` input: `inline` or `dialog`.** `inline` (the default, and what 0.1.x did) expands the tree under the field and pushes the form's content down. `dialog` opens the tree in a dialog the host draws **over** the form, so nothing on the form moves — better for large taxonomies. Chosen per field in the work item layout.
- Both surfaces share one tree renderer, so they cannot drift apart in look or behavior. The dialog never touches the work item: it reports the pick back to the control through a callback, and the control writes the field.
- There is deliberately no third, anchored-and-floating style like the Area Path picker's. That picker is part of Azure DevOps itself and is drawn in the page; a custom control lives in an iframe that clips, and the only escapes the platform offers an extension are a dialog and a side panel — nothing anchored to a field.
- The local preview harness now runs the control in a **real iframe**, negotiating height by message-passing exactly as the host does, so clipping and measurement behave as they will in production. Its page is derived from the real control page at build time rather than duplicated. The `dialog` style is deliberately not simulated there — its risk is whether the host behaves as assumed, and a stub built on the same assumptions could only agree with itself.

## 0.1.3

- **Fixed: the control grew but never shrank.** Closing the panel left the space it had taken, and every further expansion claimed more, so a form only ever got taller. The height was measured with `document.documentElement.scrollHeight`, which returns max(content, viewport) — and inside an iframe the viewport is the very frame being sized, so the measurement reported whatever the frame had already grown to. The host was honoring every request; the requests were wrong. The control now measures its own root element, whose box depends on content alone.
- The local preview harness became faithful as a side effect: it was measuring the whole preview page before, which is why this never reproduced outside a real work item form.

## 0.1.2

- **The control is a dropdown now, not a permanent panel.** Closed it is a single line reading like a form field; clicking opens the filter and the tree, and picking a node closes it again. 0.1.1 kept the tree open forever and cost around 320px of every form that used it. It still cannot float over the form — the iframe clips — so opening pushes the form's content down and closing gives the space back.
- **Fixed: the control followed the browser's theme instead of Azure DevOps'.** Reading a light work item form in a dark browser produced a dark, unreadable control. The stylesheet had declared `color-scheme` and fallen back to CSS system colors (`CanvasText`, `GrayText`, `Field`), all of which resolve against the OS. Every color is now mixed from the host's own text color, and the fallbacks are literals.
- Expansion no longer accumulates: each opening starts from the path to the current value rather than from whatever was left open before.
- Bigger, clearer expand/collapse target on branch nodes — 18px with a hover state, up from an effectively unclickable 12px.

## 0.1.1

- New icon. No functional change: 0.1.0 had already been uploaded for private testing, and the marketplace will not take the same version twice.

## 0.1.0

- First version. A work item form control that reads a flat list of backslash-separated paths, renders it as a tree, and writes the full path of the picked node back to the field.
- The tree is read from the field's **allowed values** (a picklist) so the server validates the same list the control offers; the `Paths` input is a fallback for fields without one.
- A node is selectable only when its full path was declared: an intermediate segment that exists solely to hold children — `A3\B` when only `A3\B\C` is a value — groups without being pickable, so the control cannot write a value the field would reject.
- Filter box matching on node name and on full path, keeping the branches that lead to a hit.
- A stored value that is not in the list is grafted onto the tree, selected and flagged `not in list`, instead of showing an empty control over a non-empty field.
- Adaptive height via `SDK.resize`, bounded, with scrolling as the fallback when the host ignores the request.
