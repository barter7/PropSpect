# Prospect Rank for eBay

A Chrome extension that puts a prospect's rankings in front of eBay card
listing titles, from two sources side by side: **MLB Pipeline** and
**FanGraphs' The Board**.

    NYM 3B/SS · MLB #68 · FG 50 #44   2023 Bowman Chrome 1st Jefferson Rojas Auto ...

It works on search results and on a listing's own page, and badges every
ranked player named in a title (dual autos get two badges).

It has no build step. Historical ranking files live in `../Rankings/`.

## Install

1. Download this repository (**Code > Download ZIP** on GitHub), unzip it, and find the `extension/` folder.
2. Open `chrome://extensions`, switch on **Developer mode**, choose
   **Load unpacked**, and pick the folder.
3. Click the extension's icon, then **Sync or import rankings**.

## The two sources

**MLB Pipeline** — press **Sync from MLB Pipeline**. It loads the Top 100 and
every club's Top 30 (about 900 players) from the ranking pages on www.mlb.com,
in your own browser, and refreshes them weekly. The data is read from JSON
embedded in those pages (`src/mlb.js`); if MLB changes its pages the sync
reports a failure and keeps the list you had.

**FanGraphs: The Board** — on The Board, use **Export Data** and load the CSV.
Hitters and pitchers export separately: select both files at once, or load one
and **Add** the other. The columns used are `Name`, `Org`, `Pos`, `Top 100`,
`Org Rk` and `FV`. Nothing is fetched from FanGraphs, so re-export and load
again when The Board is updated. Any other CSV with those headers, or a pasted
list (`1. First Last, SS, PIT`), is accepted in the same slot.

The two lists are joined per player by name and club (club codes such as
`TBR`/`TB` are reconciled). Everything stays in your browser's local storage;
the only site the extension contacts is www.mlb.com.

## Reading a badge

`CLUB POS · MLB <rank> · FG <FV> <rank>`

- `#44` is an overall (Top 100) rank; `org 3` is a rank within the club, shown
  when the player is outside that source's Top 100.
- `FG 50` is FanGraphs' Future Value on the 20-80 scale. FanGraphs treats the
  FV tier as more telling than the ordinal rank, and a `+` (`45+`) marks a
  player thought to have a chance to break out.
- A source that does not rank the player is left out.
- Colour is the better of the two views: gold for a top-10 rank or 60+ FV,
  green for top 50 or 50+ FV, blue for top 100 or 45/45+ FV, grey otherwise.
- Hover for both sources' overall and club ranks and the dates of the data.

## Matching

A badge appears only when a player's full name is in the title. Case,
accents, punctuation, `Jr.`-style suffixes and `J.J.`/`JJ`/`J J` are all
treated alike. A last name alone never matches. Two different players with
the same name cannot be told apart, so check the team in the badge.

## Tests

```bash
node --test extension/test/unit.test.js   # matcher and list parser
node extension/test/e2e.js                # real Chromium + the extension (needs Playwright)
```

The end-to-end test serves stand-in pages for eBay and MLB.com, so it checks
the extension itself, not either site's current markup. Set `PRK_MLB_DIR` (a
folder of saved ranking pages: `top100.html`, `mets.html`, ...) and
`PRK_FG_CSV` (a Board export) to run against real data.
