#!/usr/bin/env node
// Builds Rankings/players.csv: one row per player, summarizing every yearly
// FanGraphs file in Rankings/fangraphs/ (<year>r.csv = Report, <year>u.csv = Updated).
// Run from the repository root:  node tools/build-summary.js
const fs = require('fs');
const path = require('path');
const History = require('../extension/src/history.js');
const { parseList } = require('../extension/src/parse.js');

const SRC = path.join(__dirname, '..', 'Rankings', 'fangraphs');
const OUT = path.join(__dirname, '..', 'Rankings', 'players.csv');

const files = fs.readdirSync(SRC).filter((f) => /\.csv$/i.test(f)).sort()
  .map((f) => ({ name: f, text: fs.readFileSync(path.join(SRC, f), 'utf8') }));

// Keep each player's latest non-empty value of every descriptive column, and the age on each list.
const info = new Map();
const history = History.buildHistory(files, parseList, (player, row, idx) => {
  if (!info.has(player)) info.set(player, { ids: [] });
  const rec = info.get(player);
  for (const [k, v] of Object.entries(row.extra || {})) rec[k] = v;
  rec.ageIdx = row.extra && row.extra.age ? idx : rec.ageIdx;
  if (row.id && !rec.ids.includes(row.id)) rec.ids.push(row.id);
});

const fvNum = (fv) => { const n = parseInt(fv, 10); return n ? n + (/\+/.test(fv) ? 2.5 : 0) : null; };
const best = (vals) => { const v = vals.filter((x) => x != null); return v.length ? Math.min(...v) : ''; };

// "Draft", "International" or "Undrafted FA", from the newer Sign Mkt column or the older Signed text.
function signType(rec) {
  const s = `${rec.signMkt || ''} ${rec.signed || ''}`.toLowerCase();
  if (/udfa|ndfa|undrafted|\bu?fa\b|free agent/.test(s)) return 'Undrafted FA';
  if (/draft|\brd\b|rnd/.test(s)) return 'Draft';
  if (/j2|intl|ifa|july|\bj\b/.test(s)) return 'International';
  return '';
}
function draftRound(rec) {
  const m = /rnd\s*(\d+)|(\d+)\s*(?:st|nd|rd|th)s?\s*(?:rd|rnd|r d)/i.exec(rec.signed || '');
  return m ? Number(m[1] || m[2]) : '';
}

const current = History.currentIndexByTeam(history);
const key = (i) => history.snapshots[i].key;
const rows = history.players.map((p) => {
  const rec = info.get(p) || { ids: [] };
  const first = p.pts[0], last = p.pts[p.pts.length - 1];
  const fvs = p.pts.map((pt) => fvNum(pt[1])).filter((v) => v != null);
  const peak = p.pts.reduce((a, pt) => (fvNum(pt[1]) != null && (a == null || fvNum(pt[1]) > fvNum(a)) ? pt[1] : a), null);
  const type = signType(rec);
  const age = parseFloat(rec.age);
  return {
    name: p.name,
    org: p.team,
    pos: p.pos,
    status: last[0] === current.get(p.team) ? 'Current' : 'Off lists',
    fv: last[1],
    fv_value: fvNum(last[1]) ?? '',
    top100: last[3] ?? '',
    org_rank: last[2] ?? '',
    age: Number.isFinite(age) ? age.toFixed(1) : '',
    age_as_of: rec.ageIdx != null ? key(rec.ageIdx) : '',
    level: rec.level || '',
    eta: rec.eta || '',
    risk: rec.risk ? { h: 'High', m: 'Med', l: 'Low' }[rec.risk[0].toLowerCase()] || rec.risk : '',
    sign_year: p.signYr ?? '',
    sign_type: type,
    draft_year: type === 'Draft' ? p.signYr ?? '' : '',
    draft_round: type === 'Draft' ? draftRound(rec) : '',
    bonus: rec.bonus ? rec.bonus.replace(/[^0-9.]/g, '') : '',
    signed_from: rec.signedFrom || '',
    bats: rec.bats || '',
    throws: rec.throws || '',
    height: rec.ht || '',
    weight: rec.wt || '',
    first_list: key(first[0]),
    last_list: key(last[0]),
    lists: p.pts.length,
    fv_first: first[1],
    fv_peak: peak || '',
    fv_change: fvs.length ? fvs[fvs.length - 1] - fvs[0] : '',
    best_top100: best(p.pts.map((pt) => pt[3])),
    best_org_rank: best(p.pts.map((pt) => pt[2])),
    // One entry per list he was on: list:FV:club rank:Top 100 rank ("-" when unranked).
    history: p.pts.map((pt) => [key(pt[0]), pt[1] || '-', pt[2] ?? '-', pt[3] ?? '-'].join(':')).join(' '),
    player_id: rec.ids[rec.ids.length - 1] || '',
  };
});

// A unique key per row: the FanGraphs id, or name-club-year when a player never had one.
const used = new Set();
for (const r of rows) {
  let k = r.player_id || `${r.name}-${r.org}-${r.sign_year}`.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-');
  while (used.has(k)) k += '-2';
  used.add(k);
  r.key = k;
}

// Current prospects first, best FV first, then Top 100 rank, club rank and name.
rows.sort((a, b) => (a.status === 'Current' ? 0 : 1) - (b.status === 'Current' ? 0 : 1) ||
  (b.fv_value || 0) - (a.fv_value || 0) || (a.top100 || 999) - (b.top100 || 999) ||
  (a.org_rank || 999) - (b.org_rank || 999) || a.name.localeCompare(b.name));

const cols = Object.keys(rows[0]);
const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
fs.writeFileSync(OUT, [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');

console.log(`${rows.length} players from ${history.snapshots.length} lists (${key(0)} to ${key(history.snapshots.length - 1)}) -> ${path.relative(process.cwd(), OUT)}`);
console.log(`${rows.filter((r) => r.status === 'Current').length} on a current list; ${rows.filter((r) => !r.sign_year).length} without a signing year`);
if (history.skipped.length) console.log('Skipped (no year plus r/u in the name):', history.skipped.join(', '));
