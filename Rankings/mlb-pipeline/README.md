# MLB Pipeline

Top 100 and club Top 30 lists: `<year>-top100.csv`, `<year>-<club>.csv`.
See [the naming rules](../README.md). The extension syncs the current lists
from MLB.com on its own; this folder is for keeping past years.

## Files here

- `<year>-preseason.csv` (2017-2025): MLB Pipeline's Top 100 and every club's
  Top 30 as MLB.com shows them for that year, which is the preseason version.
  The 2019 Cardinals list is missing (MLB.com's page for it has no list).
- `<YYYY-MM-DD>.csv`: the live lists as read on that day.

Columns: `rank` (Top 100, blank if outside it), `org_rank`, `name`, `team`,
`pos`. Built with `tools/mlb-archive.js` from saved pages of
`https://www.mlb.com/milb/prospects/<year>/<top100 or club>/`. The extension
uses them to give each saved sale the player's MLB ranks on its sale date.
