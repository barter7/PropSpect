# Prospect Board dashboard

`index.html` is the page behind the PropSpect Prospect Board dashboard on
claude.ai. It reads `Rankings/players.csv` and runs inside that dashboard (it
uses the dashboard's `dash` helper and bundled `d3`), so it will not render if
opened as a plain file. It is kept here as the source of record.

To refresh the dashboard after adding yearly files: run
`node tools/build-summary.js`, then upload the new `Rankings/players.csv` to
the dashboard's Sources panel in place of the old file.

The page's player box is a pick-or-type dropdown of every player the other
filters keep. The **List** chooser above the table shows each player as one
list had him (FV, ranks, age, level, ETA, risk and team from that list); the
"Who" filter does not apply while a list is chosen.

Sold prices come from a second file, *Sold prices*, which starts empty. Replace
it in the dashboard's Sources panel with the CSV downloaded from the extension
(rankings page, Sold prices, Download CSV). The table then gains Sold and
Median sold columns, and the player history card lists his saved sales.

The **Sold prices by parallel** panel filters sales by card (1st Bowman autos,
autos, non-autos), parallel, numbering, grading, and leaves lots and breaks
out unless asked. It charts the median price of each parallel for the players
the top filters keep. The table's Sold columns and each player's sales list
follow the same choices.
