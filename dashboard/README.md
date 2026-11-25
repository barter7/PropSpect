# Prospect Board dashboard

`index.html` is the page behind the PropSpect Prospect Board dashboard on
claude.ai. It reads `Rankings/players.csv` and runs inside that dashboard (it
uses the dashboard's `dash` helper and bundled `d3`), so it will not render if
opened as a plain file. It is kept here as the source of record.

To refresh the dashboard after adding yearly files: run
`node tools/build-summary.js`, then upload the new `Rankings/players.csv` to
the dashboard's Sources panel in place of the old file.
