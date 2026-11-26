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
  'Rankings/mlb-pipeline/2025-preseason.csv': 'rank,org_rank,name,team,pos\n4,1,Dario Vance,PIT,SS\n,6,J.J. Okafor,STL,2B\n',
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
      contentType: 'text/html',
      body: fs.readFileSync(/LH_Sold=1/.test(route.request().url()) ? path.join(__dirname, 'fixture-sold.html') : FIXTURE, 'utf8'),
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
      'Loaded 6 lists (2023r, 2023u, 2024r, 2024u, 2025r, 2025u), 3 players. Also 1 past MLB Pipeline list.');
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

    // Sold prices: browsing eBay's Sold results saves each sold listing of a ranked player.
    const sold = await ctx.newPage();
    await sold.goto('https://www.ebay.com/sch/i.html?_nkw=bowman+auto&LH_Sold=1&LH_Complete=1');
    await mgr.goto(`chrome-extension://${id}/options.html`);
    // The page says when it is done.
    await sold.waitForFunction(() => /✓ saved/.test((document.querySelector('.prk-toast') || {}).textContent || ''));
    assert.strictEqual(await sold.locator('.prk-toast').innerText(), 'Prospect Rank: ✓ saved 3 sold listings from this page (4 new). Safe to move on.');
    await sold.reload();
    await sold.waitForFunction(() => /✓ saved/.test((document.querySelector('.prk-toast') || {}).textContent || ''));
    assert.strictEqual(await sold.locator('.prk-toast').innerText(), 'Prospect Rank: ✓ saved 3 sold listings from this page (0 new). Safe to move on.');
    if (process.argv[4]) await sold.screenshot({ path: process.argv[4] });
    await mgr.waitForFunction(() => /^4 sold listings saved for 3 players/.test(document.getElementById('sales-current').textContent));
    const saved = await mgr.evaluate(() => new Promise((ok) => chrome.storage.local.get('sales', (d) => ok(d.sales))));
    const brief = Object.values(saved).map((r) => [r.player, r.team, r.sold_date, r.price, r.format, r.bids, r.shipping, r.item_id, r.fg_fv, r.mlb_rank])
      .sort((a, b) => (a[7] + a[0]).localeCompare(b[7] + b[0]));
    assert.deepStrictEqual(brief, [
      ['Dario Vance', 'PIT', '2026-11-20', 1234.56, 'Auction', 12, 4.99, '356000000001', '60', 1],
      ['Dario Vance', 'PIT', '2026-11-03', 310, 'Buy It Now', null, 0, '356000000002', '60', 1],
      ['Kai Sato-Reyes', 'LAD', '2026-11-03', 310, 'Buy It Now', null, 0, '356000000002', '50', 77],
      ['J.J. Okafor', 'STL', '2026-10-30', 45, 'Best Offer', null, 1.25, '356000000003', '45+', null],
    ]);
    // The hover card on eBay shows what has been saved for that player.
    await sold.bringToFront();
    await sold.locator('.prk-badge').first().hover();
    assert.match(await sold.locator('.prk-card .prk-card-sales').innerText(), /^Sold prices saved: 2 · median \$772\.28 · last \$1,234\.56 on 2026-11-20$/);
    await sold.mouse.move(780, 540);
    // Download the CSV.
    await mgr.bringToFront();
    const [dl] = await Promise.all([mgr.waitForEvent('download'), mgr.click('#sales-download')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8').split('\n');
    assert.strictEqual(csv[0], 'sold_date,player,team,pos,price,currency,shipping,format,note,bids,year,product,first_bowman,auto,variant,numbered_to,serial,grader,grade,noise,fg_list_at_sale,fg_fv_at_sale,fg_rank_at_sale,fg_org_rank_at_sale,mlb_list_at_sale,mlb_rank_at_sale,mlb_org_rank_at_sale,fg_fv_when_saved,fg_rank_when_saved,fg_org_rank_when_saved,mlb_rank_when_saved,mlb_org_rank_when_saved,title,url,item_id,saved_at');
    // Ranks on the sale date: FanGraphs 2025 Updated (counts from Aug 1, 2025); MLB from the list synced in this test,
    // read after the sale (the 2025 preseason list is too old to stand for a November 2026 sale).
    assert.match(csv[1], /^2026-11-20,Dario Vance,PIT,SS,1234.56,\$,4.99,Auction,,12,2025,Bowman Chrome,yes,yes,Numbered,99,,PSA,10,,2025u,60,2,1,(\d{4}-\d{2}-\d{2} \(read after the sale\),1,1|,,),60,2,1,1,1,2025 Bowman Chrome 1st Dario Vance Auto \/99 PSA 10,https:\/\/www.ebay.com\/itm\/356000000001,356000000001,/);
    assert.ok(csv.some((l) => /J\.J\. Okafor.*Best Offer,asking price; accepted offer not shown/.test(l)));
    assert.match(await mgr.locator('#dates-current').innerText(), /^FanGraphs: 6 lists\. MLB Pipeline: 2 lists \(2025-preseason to \d{4}-\d{2}-\d{2}\)\.$/);
    // Moving the 2025 Updated list's date past the sale puts the sale back on 2025 Report.
    await mgr.locator('#dates-rows input[aria-label="FanGraphs 2025 Updated counts from"]').fill('2026-12-01');
    await mgr.locator('#dates-rows input[aria-label="FanGraphs 2025 Updated counts from"]').dispatchEvent('change');
    await mgr.waitForFunction(() => /changed/.test(document.getElementById('dates-rows').innerText));
    const [dl2] = await Promise.all([mgr.waitForEvent('download'), mgr.click('#sales-download')]);
    const row2 = fs.readFileSync(await dl2.path(), 'utf8').split('\n')[1];
    assert.match(row2, /,2025r,60,12,1,/, 'Dario Vance on 2025 Report: 60 FV, #12, club #1');
    assert.strictEqual(csv.filter(Boolean).length, 5);
    // Saving can be switched off in the popup; nothing new is saved then.
    await mgr.goto(`chrome-extension://${id}/popup.html`);
    assert.strictEqual(await mgr.locator('#sales-count').innerText(), '(4 saved)');
    await mgr.uncheck('#saveSales');
    await sold.evaluate(() => {
      const li = document.createElement('li'); li.className = 's-item';
      li.innerHTML = '<div class="s-item__caption"><span>Sold  Nov 21, 2026</span></div><a href="https://www.ebay.com/itm/356000000009"><div class="s-item__title"><span>Dario Vance 2025 Bowman Sapphire</span></div></a><span class="s-item__price">$80.00</span>';
      document.querySelector('ul').appendChild(li);
    });
    await sold.waitForTimeout(1800);
    const after = await mgr.evaluate(() => new Promise((ok) => chrome.storage.local.get('sales', (d) => ok(Object.keys(d.sales).length))));
    assert.strictEqual(after, 4, 'nothing saved while switched off');
    if (process.argv[3]) {
      await mgr.goto(`chrome-extension://${id}/options.html`);
      await mgr.setViewportSize({ width: 820, height: 1400 });
      await mgr.locator('#sales-wrap').scrollIntoViewIfNeeded();
      await mgr.screenshot({ path: process.argv[3], fullPage: false });
    }
    console.log('e2e passed:', badges.join(' | '));
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((err) => { console.error(err); process.exit(1); });
