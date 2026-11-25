# Rankings

Ranking files, one folder per source, one or more files per year.

| Folder | What goes in it |
| --- | --- |
| [`fangraphs/`](fangraphs/) | Exports from FanGraphs' The Board |
| [`mlb-pipeline/`](mlb-pipeline/) | MLB Pipeline Top 100 and club Top 30 lists |
| [`other/`](other/) | Any other source (Baseball America, your own list, ...) |

## The summary: `players.csv`

`players.csv` has one row per player across every FanGraphs file here. It is
generated; do not edit it by hand. After adding or replacing yearly files, run
this from the repository root:

    node tools/build-summary.js

| Columns | Meaning |
| --- | --- |
| `name`, `org`, `pos`, `level`, `eta`, `risk`, `bats`, `throws`, `height`, `weight` | As on his most recent list |
| `status` | `Current` if he is on the newest list his club appears in, else `Off lists` |
| `fv`, `top100`, `org_rank` | Future Value, Top 100 rank and club rank on his most recent list (`fv_value` is the FV as a number, with `+` counted as 2.5) |
| `age`, `age_as_of` | His age on a list, and which list |
| `sign_year`, `sign_type`, `draft_year`, `draft_round`, `bonus`, `signed_from` | How and when he signed. `draft_year` is filled for drafted players only; `draft_round` only where a file gave it |
| `first_list`, `last_list`, `lists` | The first and last lists he was on, and how many |
| `fv_first`, `fv_peak`, `fv_change` | First and highest FV, and latest minus first |
| `best_top100`, `best_org_rank` | His best rank on any list |
| `history` | Every list he was on, as `list:FV:club rank:Top 100 rank`, `-` when unranked |
| `player_id`, `key` | FanGraphs id on his latest list, and a unique key for the row |

A player is followed from file to file by FanGraphs player id. When the id is
missing or changed, he is matched by name and signing year, then club.

## Uploading

On GitHub, open the folder for the source, choose **Add file > Upload files**,
drag the files in, and commit.

## File names

**FanGraphs (`fangraphs/`)** — up to two files a year, named with the year and
ending in `r` or `u`:

| File | Meaning |
| --- | --- |
| `fangraphs/2025r.csv` | 2025 **Report**: the baseline list for that cycle |
| `fangraphs/2025u.csv` | 2025 **Updated**: the later revision (new performance, draft and trade movement, graduations) |

The extension reads every such file, puts them in order (a year's Report
before its Updated), and charts each player's Future Value, club rank and
Top 100 rank across them. The newest file is also used as the current
FanGraphs list. Anything before the year and the final letter is ignored, so
`fg-2025-board-u.csv` works too. A file whose name has no year, or does not
end in `r` or `u`, is skipped.

Put hitters and pitchers in the same file if you can. Two files with the same
year and letter (in different folders, or `2025r.csv` and `board-2025r.csv`)
are merged into one list.

**Other folders** — start the name with the year: `mlb-pipeline/2026-top100.csv`,
`other/2026-baseball-america-top100.csv`. These are kept for reference and are
not read by the extension.

## File format

CSV with a header row. Leave an export's columns as they are; the extension
reads these and ignores the rest:

| Column | Accepted headers |
| --- | --- |
| Player name (required) | `Name`, `Player` |
| Overall rank | `Top 100`, `Rank`, `Rk`, `Ovr`, `Overall` |
| Club rank | `Org Rk`, `Org Rank` |
| Club | `Org`, `Team` |
| Position | `Pos`, `Position` |
| Future Value | `FV` |
| Year signed | `Sign Yr`, `SignYr`, `Sign Year`, `Signed` |
| FanGraphs player id | `playerId` |

A player with no overall rank but a club rank or an FV is kept. A file with
no rank column is read in row order.

The history chart starts at the year the player signed, so export a view of
The Board that includes the signing year. Without that column the chart
starts at the first list he appears on. The player id is used to follow a
player from file to file; when it is missing or changes, his name is used.

## Before you upload

This repository is public. FanGraphs exports and other publishers' lists are
their work; check that you are allowed to republish a file before adding it
here, or make the repository private.
