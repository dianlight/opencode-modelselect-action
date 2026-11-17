# Deprecated

Not implemented. Superseded on 2026-11-17 by `status-section-polish`.

OpenChamber 2.7.2 already ships the piece the frame conversion was meant to add:
the Work Status answer contract accepts `controls` in the section answer
(`status-view.ts` — "Header controls, the same declarations `setStatusControls`
takes") and a switch posts `{ id, value }` to the same source path. `status-section-polish`
(D1) already moved the `Auto-update router` switch out of the 16-row budget into
the header controls. The frame-based conversion in this change is therefore a
convenient but unnecessary second implementation of a goal the shipped contract
already delivers, and it has no canary-only prerequisite.
