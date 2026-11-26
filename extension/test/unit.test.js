// Run: node --test extension/test/unit.test.js
// Player names here are invented test data, not a real ranking.
const test = require('node:test');
const assert = require('node:assert');
const { buildIndex, findPlayers, combine, tier, badgeText, describe } = require('../src/match.js');
const { parseList } = require('../src/parse.js');

const players = [
  { rank: 1, name: 'Dario Vance', team: 'PIT', pos: 'SS' },
  { rank: 2, name: 'J.J. Okafor', team: 'STL', pos: '2B' },
  { rank: 3, name: 'Jesús Marté Jr.', team: 'MIL', pos: 'SS' },
  { rank: 4, name: "Tre' O'Malley", team: 'SEA', pos: 'OF' },
  { rank: 5, name: 'Kai Sato-Reyes', team: 'LAD', pos: 'RHP' },
  { rank: 60, name: 'Dario Vance Lopez', team: 'NYM', pos: 'C' },
];
const index = buildIndex(combine({ players }, null));
const ranks = (title) => findPlayers(title, index).map((p) => p.mlb.rank);

test('finds a name inside a noisy title', () => {
  assert.deepStrictEqual(ranks('2025 Bowman Chrome 1st DARIO VANCE Auto Refractor /499 PSA 10 Pirates'), [1]);
});
test('initials match with or without dots and spaces', () => {
  assert.deepStrictEqual(ranks('2025 Bowman JJ Okafor 1st'), [2]);
  assert.deepStrictEqual(ranks('2025 Bowman J.J. Okafor 1st'), [2]);
  assert.deepStrictEqual(ranks('2025 Bowman J J Okafor 1st'), [2]);
});
test('accents, suffixes, apostrophes and hyphens', () => {
  assert.deepStrictEqual(ranks('Jesus Marte 2025 Bowman Draft'), [3]);
  assert.deepStrictEqual(ranks('Jesús Marté Jr Bowman Draft'), [3]);
  assert.deepStrictEqual(ranks('Tre OMalley sapphire'), [4]);
  assert.deepStrictEqual(ranks('Kai Sato Reyes / Kai Sato-Reyes auto'), [5]);
});
test('longest name wins, and dual-player cards list both', () => {
  assert.deepStrictEqual(ranks('Dario Vance Lopez 1st Bowman'), [60]);
  assert.deepStrictEqual(ranks('Dual Auto JJ Okafor / Dario Vance'), [2, 1]);
});
test('no match on a last name alone or on unranked players', () => {
  assert.deepStrictEqual(ranks('2025 Topps Vance Rookie'), []);
  assert.deepStrictEqual(ranks('2024 Topps Chrome Some Veteran'), []);
});

test('parses free-form lines', () => {
  const out = parseList('1. Dario Vance, SS, PIT\n#2 J.J. Okafor - 2B - STL\n3 Kai Sato-Reyes RHP LAD\nTre\' O\'Malley');
  assert.deepStrictEqual(out.map((p) => [p.rank, p.name, p.team, p.pos]), [
    [1, 'Dario Vance', 'PIT', 'SS'],
    [2, 'J.J. Okafor', 'STL', '2B'],
    [3, 'Kai Sato-Reyes', 'LAD', 'RHP'],
    [4, "Tre' O'Malley", '', ''],
  ]);
});
test('parses a Board-style CSV: quotes, BOM, FV, and players ranked only within their club', () => {
  const csv = '\uFEFFName,Org,Pos,Top 100,Org Rk,FV,playerId\n"Vance, Dario","PIT","SS",1,1,"60","sa1"\n' +
    '"J.J. Okafor","STL","2B",,4,"40+","sa2"\n"Nobody Here","BOS","C",,,"35+","sa3"\n';
  assert.deepStrictEqual(parseList(csv), [
    { rank: 1, name: 'Dario Vance', team: 'PIT', pos: 'SS', orgRank: 1, fv: '60', id: 'sa1', signYr: null },
    { rank: null, name: 'J.J. Okafor', team: 'STL', pos: '2B', orgRank: 4, fv: '40+', id: 'sa2', signYr: null },
    { rank: null, name: 'Nobody Here', team: 'BOS', pos: 'C', orgRank: null, fv: '35+', id: 'sa3', signYr: null },
  ]);
});
test('combines the two sources per player', () => {
  const mlb = { players: [
    { rank: 68, orgRank: 1, name: 'Jesús Marté', team: 'TB', pos: 'SS' },
    { rank: null, orgRank: 3, name: 'Dario Vance', team: 'PIT', pos: 'OF' },
    { rank: null, orgRank: 9, name: 'Kai Sato', team: 'SD', pos: 'RHP' },
    { rank: null, orgRank: 12, name: 'Kai Sato', team: 'NYM', pos: 'C' },
  ] };
  const fg = { players: [
    { rank: 44, orgRank: 2, name: 'Jesus Marte', team: 'TBR', pos: 'SS', fv: '50' },
    { rank: null, orgRank: 7, name: 'Dario Vance', team: 'CHC', pos: 'CF', fv: '45+' }, // traded: clubs disagree
    { rank: null, orgRank: 20, name: 'Kai Sato', team: 'NYM', pos: 'C', fv: '40' },
    { rank: null, orgRank: 30, name: 'Pell Grantham', team: 'KCR', pos: '1B', fv: '35+' },
  ] };
  const all = combine(mlb, fg);
  assert.deepStrictEqual(all.map((p) => [tier(p), badgeText(p)]), [
    [2, 'TB SS · MLB #68 · FG 50 #44'],
    [3, 'PIT OF · MLB org 3 · FG 45+ org 7'],
    [4, 'SD RHP · MLB org 9'],
    [4, 'NYM C · MLB org 12 · FG 40 org 20'],
    [4, 'KC 1B · FG 35+ org 30'],
  ]);
  assert.strictEqual(describe(all[0]),
    'Jesús Marté (TB SS)\nMLB Pipeline: #68 overall, #1 in club\nFanGraphs: 50 FV, #44 overall, #2 in club');
  assert.deepStrictEqual(combine(null, null), []);
  assert.strictEqual(tier(combine(null, { players: [{ rank: null, orgRank: 1, name: 'A B', team: 'X', fv: '60' }] })[0]), 1);
});
test('table without a rank column uses row order', () => {
  const out = parseList('Player\tTeam\nDario Vance\tPIT\nJ.J. Okafor\tSTL');
  assert.deepStrictEqual(out.map((p) => [p.rank, p.name, p.team]), [[1, 'Dario Vance', 'PIT'], [2, 'J.J. Okafor', 'STL']]);
});

const { parsePage, fetchRankings } = require('../src/mlb.js');
function mlbPage(rows) {
  const key = 'getPlayerRankingsFromSelection({"limit":30,"slug":"x"})';
  const payload = { ROOT_QUERY: { [key]: [] } };
  for (const [rank, id, first, last, pos] of rows) {
    payload[`Person:${id}`] = { id, useName: first, useLastName: last, primaryPosition: { abbreviation: 'P' } };
    payload.ROOT_QUERY[key].push({ rank, playerEntity: { position: pos, player: { __ref: `Person:${id}` } } });
  }
  return `<span data-init-state="${JSON.stringify({ payload }).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></span>`;
}
test('reads a ranking page and merges overall and club ranks', async () => {
  assert.deepStrictEqual(parsePage(mlbPage([[1, 11, "Tre'", "O'Malley", 'OF'], [2, 12, 'Kai', 'Sato', null]])), [
    { id: 11, rank: 1, name: "Tre' O'Malley", pos: 'OF' },
    { id: 12, rank: 2, name: 'Kai Sato', pos: 'P' },
  ]);
  const pages = {
    top100: mlbPage([[40, 11, 'Dario', 'Vance', 'SS']]),
    mets: mlbPage([[1, 11, 'Dario', 'Vance', 'SS'], [2, 13, 'Pell', 'Grantham', 'C']]),
  };
  const { players, errors } = await fetchRankings(async (url) => {
    const slug = url.split('/').filter(Boolean).pop();
    if (!pages[slug]) throw new Error('HTTP 404');
    return pages[slug];
  });
  assert.deepStrictEqual(players, [
    { rank: 40, orgRank: 1, name: 'Dario Vance', team: 'NYM', pos: 'SS' },
    { rank: null, orgRank: 2, name: 'Pell Grantham', team: 'NYM', pos: 'C' },
  ]);
  assert.strictEqual(errors.length, 29);
  await assert.rejects(fetchRankings(async () => { throw new Error('HTTP 500'); }), /no rankings could be read/);
});

const History = require('../src/history.js');
test('reads the year and Report/Updated from a file name', () => {
  const key = (n) => (History.parseFileName(n) || {}).key;
  assert.deepStrictEqual(['2026r.csv', 'Rankings/fangraphs/2025u.csv', '2024U.CSV', 'fg-2023-board-r.csv', '2022 u.csv'].map(key),
    ['2026r', '2025u', '2024u', '2023r', '2022u']);
  assert.deepStrictEqual(['2026-pitcher.csv', '2026-hitters.csv', 'notes-r.csv', '20261r.csv'].map(key), [undefined, undefined, undefined, undefined]);
});
test('builds a timeline per player across files', () => {
  const file = (name, rows) => ({ name, text: 'Name,Org,Pos,Top 100,Org Rk,FV,Sign Yr,playerId\n' + rows.join('\n') });
  const h = History.buildHistory([
    file('2025u.csv', ['Dario Vance,TBR,SS,40,2,50,2022,sa1', 'Kai Sato,NYM,C,,9,40,7/2/2023,sa9']),
    file('2024r.csv', ['Dario Vance,PIT,SS,,12,40+,2022,sa1']),
    file('2026r.csv', ['Dario Vance,TB,SS,8,1,55,2022,777']), // id changed on reaching the majors
    file('readme.csv', []),
  ], parseList);
  assert.deepStrictEqual(h.snapshots.map((s) => s.key), ['2024r', '2025u', '2026r']);
  assert.deepStrictEqual(h.skipped, ['readme.csv']);
  assert.deepStrictEqual(h.players, [
    { name: 'Dario Vance', team: 'TB', pos: 'SS', signYr: 2022, pts: [[0, '40+', 12, null], [1, '50', 2, 40], [2, '55', 1, 8]] },
    { name: 'Kai Sato', team: 'NYM', pos: 'C', signYr: 2023, pts: [[1, '40', 9, null]] },
  ]);
  // Each club's current list is the newest file that club appears in.
  assert.deepStrictEqual(History.latestList(h), [
    { name: 'Dario Vance', team: 'TB', pos: 'SS', fv: '55', orgRank: 1, rank: 8 },
    { name: 'Kai Sato', team: 'NYM', pos: 'C', fv: '40', orgRank: 9, rank: null },
  ]);
  // Namesakes with different signing years stay separate; a quoted cell may span lines.
  const two = History.buildHistory([
    file('2020r.csv', ['Luis Rey,LAD,SS,,5,45,2016,', '"Other, Guy",LAD,C,,9,"40",2015,"x"']),
    file('2021r.csv', ['Luis Rey,DET,SS,,20,35+,2021,']),
    { name: '2022r.csv', text: 'Name,Org,FV,Report,Sign Yr\nLuis Rey,DET,40,"Line one,\nline ""two""",2021\n' },
  ], parseList);
  assert.deepStrictEqual(two.players.map((p) => [p.name, p.team, p.signYr, p.pts.length]),
    [['Luis Rey', 'LAD', 2016, 1], ['Guy Other', 'LAD', 2015, 1], ['Luis Rey', 'DET', 2021, 2]]);
  const index = History.indexHistory(h);
  assert.strictEqual(History.lookup(index, { name: 'DARIO VANCE', team: 'TB' }).signYr, 2022);
  assert.strictEqual(History.lookup(index, { name: 'Nobody', team: 'TB' }), null);
});

const Sales = require('../src/sales.js');
test('reads a sold search-result card', () => {
  const today = new Date(2026, 10, 26);
  const card = (t) => Sales.parseCard(t, today);
  assert.deepStrictEqual(card('2024 Bowman Chrome Auto Sold Nov 20, 2026 $1,234.56 12 bids +$4.99 delivery'),
    { soldDate: '2026-11-20', price: 1234.56, currency: '$', shipping: 4.99, bids: 12, format: 'Auction' });
  assert.deepStrictEqual(card('Sold  Nov 3, 2026 Card $38.00 Buy It Now Free delivery'),
    { soldDate: '2026-11-03', price: 38, currency: '$', shipping: 0, bids: null, format: 'Buy It Now' });
  assert.strictEqual(card('Sold Oct 30, 2026 Card $45.00 Best offer accepted').format, 'Best Offer');
  assert.deepStrictEqual(card('Sold 20 Nov 2026 Card £12.50 3 bids +£2.70 postage'),
    { soldDate: '2026-11-20', price: 12.5, currency: '£', shipping: 2.7, bids: 3, format: 'Auction' });
  assert.strictEqual(card('Ended Nov 2, 2026 Card $5.00 0 bids'), null, 'ended without a sale');
  assert.strictEqual(card('Sold Nov 2, 2026 Lot $5.00 to $20.00'), null, 'a price range is not one sale');
  assert.strictEqual(card('2024 Bowman $10.00 Buy It Now'), null, 'still for sale');
});
test('reads a sold item page, dates without a year, and item ids', () => {
  const today = new Date(2026, 10, 26);
  assert.deepStrictEqual(Sales.parseItemPage('This listing sold on Wed, Nov 19 at 8:12 PM. 7 bids', 'US $45.00', today),
    { soldDate: '2026-11-19', price: 45, currency: '$', shipping: null, bids: 7, format: 'Auction' });
  assert.strictEqual(Sales.parseItemPage('Buy It Now US $45.00', 'US $45.00', today), null);
  assert.strictEqual(Sales.parseDate('Fri, Dec 19', today), '2025-12-19', 'a later month means last year');
  assert.strictEqual(Sales.itemId('https://www.ebay.com/itm/2025-bowman/356000000001?hash=x'), '356000000001');
  assert.strictEqual(Sales.itemId('https://www.ebay.com/sch/i.html'), '');
});
test('summarizes and exports sales, leaving Best Offer asking prices out of the median', () => {
  const p = { name: 'Dario Vance', team: 'PIT', pos: 'SS', mlb: { rank: 1, orgRank: 1 }, fg: { fv: '60', rank: 2, orgRank: 1 } };
  const at = { id: '1', url: 'u', title: 'Dario Vance, "Auto"', page: 'search' };
  const recs = [
    Sales.record({ soldDate: '2026-11-20', price: 100, currency: '$', format: 'Auction', bids: 3, shipping: 0 }, at, p, 0),
    Sales.record({ soldDate: '2026-11-21', price: 40, currency: '$', format: 'Buy It Now' }, { ...at, id: '2' }, p, 0),
    Sales.record({ soldDate: '2026-11-22', price: 900, currency: '$', format: 'Best Offer' }, { ...at, id: '3' }, p, 0),
  ];
  const s = Sales.summarize(recs);
  assert.deepStrictEqual([s.count, s.priced, s.median, s.low, s.high, s.last.item_id], [3, 2, 70, 40, 100, '2']);
  const csv = Sales.toCsv(recs).trim().split('\n');
  assert.strictEqual(csv.length, 4);
  assert.strictEqual(csv[1].split(',').slice(0, 9).join(','), '2026-11-22,Dario Vance,PIT,SS,900,$,,Best Offer,asking price; accepted offer not shown');
  assert.ok(csv[3].includes('"Dario Vance, ""Auto"""'));
  assert.strictEqual(Sales.summarize([]), null);
});
