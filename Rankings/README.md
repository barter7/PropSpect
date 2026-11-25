# Rankings

Ranking files, one folder per source, one or more files per year.

| Folder | What goes in it |
| --- | --- |
| [`fangraphs/`](fangraphs/) | Exports from FanGraphs' The Board |
| [`mlb-pipeline/`](mlb-pipeline/) | MLB Pipeline Top 100 and club Top 30 lists |
| [`other/`](other/) | Any other source (Baseball America, your own list, ...) |

## Uploading

On GitHub, open the folder for the source, choose **Add file > Upload files**,
drag the files in, and commit.

## File names

Start every file name with the four-digit year so the lists sort in order and
the year can be read from the name:

    <year>-<what>.csv

| Example | Meaning |
| --- | --- |
| `fangraphs/2026-hitters.csv` | The Board, 2026 prospect list, hitters export |
| `fangraphs/2026-pitchers.csv` | The Board, 2026 prospect list, pitchers export |
| `fangraphs/2026-11-hitters.csv` | A dated snapshot within a year (year-month) |
| `mlb-pipeline/2026-top100.csv` | MLB Pipeline Top 100 for 2026 |
| `mlb-pipeline/2026-mets.csv` | One club's Top 30 |
| `other/2026-baseball-america-top100.csv` | Another source: name it in the file name |

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

A player with no overall rank but a club rank is kept. A file with no rank
column is read in row order.

## Before you upload

This repository is public. FanGraphs exports and other publishers' lists are
their work; check that you are allowed to republish a file before adding it
here, or make the repository private.
