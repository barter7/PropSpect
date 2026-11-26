#!/usr/bin/env node
// Turns saved MLB Pipeline ranking pages into one CSV per list in Rankings/mlb-pipeline/.
//
//   node tools/mlb-archive.js <folder of pages> <year> [<label>]
//
// The folder holds <year>-top100.html and <year>-<club>.html for each club slug in
// extension/src/mlb.js (or top100.html and <club>.html for a live snapshot). The
// output is <label>.csv, where <label> defaults to "<year>-preseason": MLB.com's
// page for a past year shows that year's preseason lists. For a snapshot of the
// live lists use the date they were read as the label, e.g. 2026-11-25.
const fs = require('fs');
const path = require('path');
const { fetchRankings } = require('../extension/src/mlb.js');

const [dir, year, label = `${year}-preseason`] = process.argv.slice(2);
if (!dir || !year) { console.error('usage: node tools/mlb-archive.js <folder> <year> [label]'); process.exit(1); }

const read = async (url) => {
  const slug = url.split('/').filter(Boolean).pop();
  for (const f of [`${year}-${slug}.html`, `${slug}.html`]) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  throw new Error('no saved page');
};

fetchRankings(read).then(({ players, errors }) => {
  const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const cols = ['rank', 'org_rank', 'name', 'team', 'pos'];
  const out = path.join(__dirname, '..', 'Rankings', 'mlb-pipeline', `${label}.csv`);
  const rows = players.map((p) => [p.rank, p.orgRank, p.name, p.team, p.pos].map(cell).join(','));
  fs.writeFileSync(out, [cols.join(','), ...rows].join('\n') + '\n');
  console.log(`${label}: ${players.length} players (${players.filter((p) => p.rank != null).length} in the Top 100)` +
    (errors.length ? `; could not read ${errors.join('; ')}` : ''));
});
