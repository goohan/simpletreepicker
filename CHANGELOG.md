# Change Log

## 0.1.0

- First version. A work item form control that reads a flat list of backslash-separated paths, renders it as a tree, and writes the full path of the picked node back to the field.
- The tree is read from the field's **allowed values** (a picklist) so the server validates the same list the control offers; the `Paths` input is a fallback for fields without one.
- A node is selectable only when its full path was declared: an intermediate segment that exists solely to hold children — `A3\B` when only `A3\B\C` is a value — groups without being pickable, so the control cannot write a value the field would reject.
- Filter box matching on node name and on full path, keeping the branches that lead to a hit.
- A stored value that is not in the list is grafted onto the tree, selected and flagged `not in list`, instead of showing an empty control over a non-empty field.
- Adaptive height via `SDK.resize`, bounded, with scrolling as the fallback when the host ignores the request.
