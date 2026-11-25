# PropSpect

Baseball prospect rankings where you shop for cards.

- [`extension/`](extension/) — a Chrome extension that badges eBay card
  listings with a player's MLB Pipeline and FanGraphs rankings. Install and
  usage notes are in its README.
- [`Rankings/`](Rankings/) — ranking files by source and year. Upload past and
  current lists here.
- [`Rankings/players.csv`](Rankings/players.csv) — one row per player,
  summarizing every yearly FanGraphs list. Rebuild it with
  `node tools/build-summary.js` after adding files.
- [`dashboard/`](dashboard/) — the page behind the sortable Prospect Board
  dashboard, which reads that summary.
