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
    assert.match(tip, /^Dario Vance \(PIT SS\)\nMLB Pipeline: #1 overall, #1 in club\nFanGraphs: 60 FV, #2 overall, #1 in club\nMLB updated/);

    // Popup lookup and the on/off switch.
    await mgr.goto(`chrome-extension://${id}/popup.html`);
    await mgr.fill('#q', 'okaf');
    assert.match(await mgr.locator('#results').innerText(), /J\.J\. Okafor\s*STL 2B · FG 45\+ org 4/);
    await mgr.uncheck('#enabled');
    await page.waitForFunction(() => document.querySelectorAll('.prk-badge').length === 0);
    await mgr.check('#enabled');
    await page.waitForFunction(() => document.querySelectorAll('.prk-badge').length === 7);
    if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
    console.log('e2e passed:', badges.join(' | '));
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((err) => { console.error(err); process.exit(1); });
