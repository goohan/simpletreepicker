# Change Log

## 0.3.4

- **The keyboard now works the way a combo box does.** The caret stays in the field while the arrows walk the list — the odd-looking trick every native picker uses, so you can keep typing without ever leaving the text. Rows are no longer focusable at all, which removes a whole family of bugs at the source: a re-render used to destroy the focused row and every listener read that as the user walking away.
- **Arrowing starts at the current selection**, not at the top of the list.
- **`Tab` confirms, like `Enter`.** It takes the highlighted node instead of leaving for the next field, the way an editor's completion list behaves.
- **`Escape` closes the dialog style**, exactly as clicking outside it does — with no result, so the field keeps the value it had.
- Screenshots in the README, and they no longer ride along inside the package: only the icon does, which keeps it at 41 KB instead of 1.2 MB.

## 0.3.3

- **Typing preselects the first match.** The node that `Enter` — or simply leaving the control — would settle on is ringed in the accent as you type, and scrolled into view, so the outcome is visible before you commit to it.
- **Fixed: `←` and `→` closed the panel instead of collapsing and expanding.** Re-rendering the tree destroys the focused row, so focus fell to the body and fired the same event as clicking away. The check now waits a tick and asks where focus actually ended up, by which time it is back on the restored row.
- **Fixed: clicking the field sometimes did nothing.** The handler sat on the input alone, so the field's padding and the gap beside the chevron swallowed clicks. It now covers the whole field, chevron included.

## 0.3.2

Three problems that arrived together with 0.3.0's typing, all of them about focus:

- **Fixed: clicking a node's chevron picked the node and closed the panel** instead of expanding it. A chevron is not focusable, so clicking one dropped focus out of the field with nowhere to land; the handler that closes the panel when you leave the control read that as leaving and shut it before the click could do its work. Clicking inside the panel no longer moves focus at all.
- **Fixed: the first keystroke appended to the value instead of replacing it**, so the filter searched for things like `Development\SalesforceX` and matched nothing. Opening selects the text, but the mouseup that follows a click collapses that selection — opening by mouse now goes through `focus()` rather than the browser's own caret placement.
- **Arrow keys navigate the tree.** Up and Down walk the visible rows, Right and Left open and close a branch, `Enter` picks, `Escape` closes. Focus survives expanding and collapsing, rather than restarting from the top after every re-render.

## 0.3.1

- **The layout configuration shows labels for the inputs.** They carried `description`, which only reaches the ⓘ tooltip, but no `name` — which is what the configuration UI uses as the label — so an admin adding the control met three nameless boxes: `Field`, `Picker style` and `Paths (fallback)`.

## 0.3.0

- **You can type in the field**, as the native picklist lets you. The separate filter box is gone: the field itself is the search, and the tree narrows as you type. What leaving the control does with what you typed — a match becomes the value, no match leaves the previous value untouched, an emptied field clears it — so the field always holds a real node or nothing. `Escape` cancels and restores the previous value.
- Typing can only ever **pick**, never write free text. A picklist field rejects a value outside its list with a form-level error that blocks saving the work item, so free text would be a trap; `findFirstMatch` resolves what you typed to a real, selectable node or to nothing at all.
- Matching now has one definition shared by the filter and by what typing resolves to. Notably, a match is never an ancestor that filtering merely kept in order to reach the real hit.

## 0.2.5

- **An empty field shows an empty field**, not the words `(none)`. A native Azure DevOps field with no value renders nothing at all until you reach for it, and the label the form draws above the control already says which field it is.

## 0.2.4

- **Fixed: a stray wedge stuck to the field's chevron.** 0.2.3 started drawing the chevron in CSS but left the old `▾` character sitting in the markup, so the glyph was rotated 45° along with the box it was inside. The span is empty now.
- **The tree's expanders use the field's chevron.** They were a tiny filled triangle from a font, which read as a different widget next to the CSS-drawn one; both are now the same shape and weight.
- **The dialog is roomy.** It had `height: 100%`, so the content had no height of its own and simply filled whatever the host handed out — a tree three rows tall. The tree now has a real height, and the page asks the host to match it.

## 0.2.3

Matched against screenshots of the native field in all four of its states, rather than from memory:

- **No caret at rest.** Azure DevOps shows none until you reach for the field, and neither does this now. The caret is also drawn with borders instead of a glyph, because the native one is a thin chevron and a font's filled triangle reads visibly heavier.
- **The hover fill is white, not grey.** It was `--palette-neutral-4`; the native field fills with the surface color and rings itself in `--palette-neutral-30`.
- **The open state's blue rule reads about two pixels thick**, matched with an inset shadow so the border stays 1px and nothing inside the field shifts between states.
- **The selected row is ringed in the accent**, not just filled with the selection tint, and rows grew to 30px to sit closer to the native list.

## 0.2.2

- **Fixed: the `dialog` style opened an empty dialog.** The content contribution was declared as `ms.vss-web.control`; the type the host resolves for dialog and panel content is `ms.vss-web.external-content`. The host drew the dialog frame and title and then found nothing to put in it.
- The dialog page now fills its frame: the filter stays at the top and the tree takes the remaining height and scrolls inside it.
- **Nothing at rest, like the native field.** The closed control no longer wears a grey fill and a border — it was reading as a button, which no Azure DevOps form field does. The field affordance now appears on hover and while open, the way ADO's own borderless combos behave. The padding is unchanged between states, so the value never shifts.

## 0.2.1

- **Dressed as the native picklist.** The closed control now wears the same fill, hairline, height and caret as an Azure DevOps combo, and the open panel is a callout — its own surface, border and depth shadow — instead of bare text on the form.
- **Real design tokens instead of approximations.** The colors come from Azure DevOps' own variables (`--palette-neutral-4`, `--component-grid-selected-row-color`, `--focus-border-color` and the rest), captured from a live work item form rather than guessed. The selected row is now ADO's actual selection blue.
- Fixed a variable that Azure DevOps has never defined: `--palette-error-text`, silently falling back on every error message. The real one is `--status-error-text`.
- Two new guards: a test fails on any host variable not present in the capture, and another on a `--palette-*` token used outside `rgb()`/`rgba()` — those hold bare RGB components, so used whole they yield no color at all.
- The preview harness applies the captured theme exactly as the SDK does, so it shows the control in ADO's colors rather than its own.

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
