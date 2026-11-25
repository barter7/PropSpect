// Run: node extension/test/e2e.js [screenshot.png]
// Real data: PRK_MLB_DIR=<saved ranking pages> PRK_FG_CSV=<Board export> PRK_FIXTURE=<listing page>
// Loads the unpacked extension in Chromium, syncs MLB and imports FanGraphs
// files through the options page, and opens a stand-in eBay page (eBay itself is never contacted).
// Player names are invented test data, not a real ranking.
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('node:assert');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '..');
const FIXTURE = process.env.PRK_FIXTURE || path.join(__dirname, 'fixture-search.html');
const MLB_DIR = process.env.PRK_MLB_DIR; // optional: a folder of real saved ranking pages (<slug>.html)

// A stand-in MLB ranking page carrying its list the way the real ones do.
function mlbPage(rows) {
  const payload = { ROOT_QUERY: { 'getPlayerRankingsFromSelection({"limit":30,"slug":"x"})': [] } };
  for (const [rank, id, first, last, pos] of rows) {
    payload[`Person:${id}`] = { id, useName: first, useLastName: last };
    payload.ROOT_QUERY['getPlayerRankingsFromSelection({"limit":30,"slug":"x"})'].push(
      { rank, playerEntity: { position: pos, player: { __ref: `Person:${id}` } } });
  }
  const json = JSON.stringify({ payload }).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<!doctype html><span data-init-state="${json}"></span>`;
}
const MLB_PAGES = {
  top100: mlbPage([[1, 11, 'Dario', 'Vance', 'SS'], [77, 12, 'Kai', 'Sato-Reyes', 'RHP']]),
  pirates: mlbPage([[1, 11, 'Dario', 'Vance', 'SS'], [5, 13, 'Pell', 'Grantham', 'C']]),
  dodgers: mlbPage([[2, 12, 'Kai', 'Sato-Reyes', 'RHP']]),
};
// A FanGraphs-style export: hitters in one file, pitchers in another.
const FG_HITTERS = 'Name,Org,Pos,Top 100,Org Rk,FV,playerId\n"Dario Vance","PIT","SS",2,1,"60","sa1"\n' +
  '"J.J. Okafor","STL","2B",,4,"45+","sa2"\n"Jesus Marte Jr.","MIL","SS",,12,"40","sa3"\n' +
  '"Tre\' O\'Malley","SEA","CF",,9,"40+","sa4"\n';
const FG_PITCHERS = 'Name,Org,Pos,Top 100,Org Rk,FV,playerId\n"Kai Sato-Reyes","LAD","SP",30,2,"50","sa5"\n';

// Yearly history files as they would sit in the repository's Rankings/ folder.
const HEAD = 'Name,Org,Pos,Top 100,Org Rk,FV,Sign Yr,playerId\n';
const HISTORY = {
  'Rankings/fangraphs/2023r.csv': HEAD + 'Dario Vance,PIT,SS,,14,40+,2021,sa1\nKai Sato-Reyes,LAD,SP,95,6,50,2020,sa5\n',
  'Rankings/fangraphs/2023u.csv': HEAD + 'Dario Vance,PIT,SS,,8,45,2021,sa1\nKai Sato-Reyes,LAD,SP,70,4,50,2020,sa5\n',
  'Rankings/fangraphs/2024r.csv': HEAD + 'Dario Vance,PIT,SS,88,4,50,2021,sa1\nKai Sato-Reyes,LAD,SP,64,3,50,2020,sa5\n',
  'Rankings/fangraphs/2024u.csv': HEAD + 'Dario Vance,PIT,SS,41,2,55,2021,sa1\nJ.J. Okafor,STL,2B,,9,40,2024,sa2\n',
  'Rankings/fangraphs/2025r.csv': HEAD + 'Dario Vance,PIT,SS,12,1,60,2021,sa1\nJ.J. Okafor,STL,2B,,6,45,2024,sa2\n',
  'Rankings/fangraphs/2025u.csv': HEAD + 'Dario Vance,PIT,SS,2,1,60,2021,9001\nJ.J. Okafor,STL,2B,,4,45+,2024,sa2\n',
  'Rankings/README.md': 'not a ranking file',
  'Rankings/other/2025r.csv': HEAD + 'Wrong Source,BOS,C,1,1,80,2020,x\n',
};

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prk-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 820, height: 560 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    await ctx.route(/ebay\.com/, (route) => route.fulfill({
      contentType: 'text/html', body: fs.readFileSync(FIXTURE, 'utf8'),
    }));
    await ctx.route(/www\.mlb\.com/, (route) => {
      const slug = new URL(route.request().url()).pathname.split('/').filter(Boolean).pop();
      const file = MLB_DIR && path.join(MLB_DIR, slug + '.html');
      const body = file ? (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null) : MLB_PAGES[slug];
      return body ? route.fulfill({ contentType: 'text/html', body }) : route.fulfill({ status: 404, body: 'no' });
    });
    await ctx.route(/api\.github\.com/, (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tree: Object.keys(HISTORY).map((p) => ({ path: p, type: 'blob' })) }),
    }));
    await ctx.route(/raw\.githubusercontent\.com/, (route) => {
      const p = decodeURIComponent(new URL(route.request().url()).pathname).split('/').slice(4).join('/');
      return HISTORY[p] ? route.fulfill({ contentType: 'text/plain', body: HISTORY[p] }) : route.fulfill({ status: 404, body: '' });
    });
    const page = await ctx.newPage();
    await page.goto('https://www.ebay.com/sch/i.html?_nkw=bowman+chrome+auto');
    await page.waitForTimeout(1200);
    assert.strictEqual(await page.locator('.prk-badge').count(), 0, 'no badges before a list is saved');

    const mgr = await ctx.newPage();
    await mgr.goto('chrome://extensions');
    const id = await mgr.evaluate(async () => (await chrome.management.getAll()).find((e) => e.name === 'Prospect Rank for eBay').id)
      .catch(() => null);
    assert.ok(id, 'extension loaded');
    await mgr.goto(`chrome-extension://${id}/options.html`);

    // Sync from the (stand-in) MLB pages; the open eBay tab updates without a reload.
    await mgr.click('#sync');
    await mgr.waitForFunction(() => /^(Synced|Sync failed)/.test(document.getElementById('sync-status').textContent));
    const syncStatus = await mgr.locator('#sync-status').innerText();
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelectorAll('.prk-badge').length >= 1);
    await page.waitForTimeout(500);
    const synced = await page.$$eval('.prk-badge', (els) => els.map((e) => e.textContent));
    if (MLB_DIR) {
      // Real-data run: also import a real Board export if given, then report and stop.
      if (process.env.PRK_FG_CSV) {
        await mgr.bringToFront();
        await mgr.setInputFiles('#file', process.env.PRK_FG_CSV);
        await mgr.waitForFunction(() => document.getElementById('status').textContent.startsWith('Read '));
        await mgr.click('#save');
        await mgr.waitForFunction(() => document.getElementById('status').textContent.startsWith('Saved '));
        console.log(await mgr.locator('#fg-current').innerText());
        if (process.argv[3]) await mgr.screenshot({ path: process.argv[3] });
        await page.bringToFront();
        await page.waitForTimeout(800);
      }
      if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
      console.log(syncStatus, '\n' + (await page.$$eval('.prk-badge', (els) => els.map((x) => x.textContent))).join(' | '));
      return;
    }
    assert.strictEqual(syncStatus, 'Synced 3 players (2 in the Top 100). 28 page(s) could not be read.');
    assert.deepStrictEqual(synced, ['PIT SS · MLB #1', 'LAD RHP · MLB #77', 'PIT SS · MLB #1', 'PIT C · MLB org 5']);

    // Import the FanGraphs hitters file, then add the pitchers file.
    await mgr.bringToFront();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prk-fg-'));
    fs.writeFileSync(path.join(tmp, 'hitters.csv'), FG_HITTERS);
    fs.writeFileSync(path.join(tmp, 'pitchers.csv'), FG_PITCHERS);
    await mgr.setInputFiles('#file', path.join(tmp, 'hitters.csv'));
    await mgr.waitForFunction(() => document.getElementById('status').textContent.startsWith('Read 4 players'));
    await mgr.click('#save');
    await mgr.waitForFunction(() => /No pitchers yet/.test(document.getElementById('fg-current').textContent));
    await mgr.setInputFiles('#file', path.join(tmp, 'pitchers.csv'));
    await mgr.waitForFunction(() => document.getElementById('status').textContent.startsWith('Read 1 players'));
    await mgr.click('#add');
    await mgr.waitForFunction(() => /^5 players \(2 with a Top 100 rank, 1 pitchers\)/.test(document.getElementById('fg-current').textContent));
    fs.rmSync(tmp, { recursive: true, force: true });

    await page.bringToFront();
    await page.waitForFunction(() => document.querySelectorAll('.prk-badge').length === 7);
    const badges = await page.$$eval('.prk-badge', (els) => els.map((e) => e.textContent));
    assert.deepStrictEqual(badges, [
      'PIT SS · MLB #1 · FG 60 #2', 'STL 2B · FG 45+ org 4', 'MIL SS · FG 40 org 12',
      'LAD RHP · MLB #77 · FG 50 #30', 'PIT SS · MLB #1 · FG 60 #2', 'PIT C · MLB org 5', 'SEA CF · FG 40+ org 9',
    ]);
    const tip = await page.locator('.prk-badge').first().getAttribute('title');
    // Hovering a badge opens a card with both sources' ranks.
    await page.locator('.prk-badge').first().hover();
    assert.match(await page.locator('.prk-card').innerText(),
      /^Dario Vance \(PIT SS\)\nMLB Pipeline: #1 overall, #1 in club\nFanGraphs: 60 FV, #2 overall, #1 in club\nMLB updated/);
    assert.strictEqual(await page.locator('.prk-card svg').count(), 0, 'no chart before history is loaded');
    await page.mouse.move(700, 500);

    // Popup lookup and the on/off switch.
    await mgr.goto(`chrome-extension://${id}/popup.html`);
    await mgr.fill('#q', 'okaf');
    assert.match(await mgr.locator('#results').innerText(), /J\.J\. Okafor\s*STL 2B · FG 45\+ org 4/);
    await mgr.uncheck('#enabled');
    await page.waitForFunction(() => document.querySelectorAll('.prk-badge').length === 0);
    await mgr.check('#enabled');
    await page.waitForFunction(() => document.querySelectorAll('.prk-badge').length === 7);

    // Ranking history from the repository's yearly files, charted in the hover card.
    await mgr.goto(`chrome-extension://${id}/options.html`);
    await mgr.click('#hist-sync');
    await mgr.waitForFunction(() => /^(Loaded|History not loaded)/.test(document.getElementById('hist-status').textContent));
    assert.strictEqual(await mgr.locator('#hist-status').innerText(),
      'Loaded 6 lists (2023r, 2023u, 2024r, 2024u, 2025r, 2025u), 3 players.');
    assert.match(await mgr.locator('#fg-current').innerText(), /^3 players .* from the history files, through 2025 Updated,/);
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('.prk-badge').textContent === 'PIT SS · MLB #1 · FG 60 #2');
    await page.locator('.prk-badge').first().hover();
    await page.waitForSelector('.prk-card svg');
    assert.strictEqual(await page.locator('.prk-card .prk-readout').innerText(), '2025 Updated: 60 FV · club #1 · Top 100 #2');
    const ticks = await page.$$eval('.prk-card .prk-tick', (els) => els.map((x) => x.textContent));
    assert.deepStrictEqual(ticks, ['2021', 'Signed', '2023', 'First listed', '2023U', '2024', '2024U', '2025', '2025U']);
    assert.strictEqual(await page.locator('.prk-card .prk-dot').count(), 6 + 6 + 4, 'FV and club rank every list, Top 100 from 2024');
    // Moving onto the card keeps it open; pointing at a list shows that list's values.
    await page.locator('.prk-card .prk-hit').nth(1).hover();
    assert.strictEqual(await page.locator('.prk-card .prk-readout').innerText(), '2023 Updated: 45 FV · club #8 · not in Top 100');
    if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
    await page.mouse.move(780, 540);
    await page.waitForFunction(() => !document.querySelector('.prk-card'));
    console.log('e2e passed:', badges.join(' | '));
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((err) => { console.error(err); process.exit(1); });
