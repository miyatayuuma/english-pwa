# english-pwa
A personal app for tracking English learning progress

## Recent updates

- Added staged hinting for reading cards (no hint → English → Japanese) controlled by upward swipes.
- Introduced proficiency tracking (Lv1–Lv5) based on match accuracy and hint usage, with a per-item dashboard.

## Level data persistence

The last recorded level and best level for each item are stored locally in the browser via `localStorage`. The front-end keeps this copy so that level filters and level displays can resume where the learner left off on the same browser profile.

In addition, each practice attempt that is sent to Apps Script includes the current `level_last` and `level_best` values. The GAS backend appends those fields to the Google Spreadsheet (see `GAS/WebApp.gs`), so the spreadsheet retains a history of the level information alongside the other speech log metrics.
