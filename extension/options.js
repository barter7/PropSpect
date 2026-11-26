const $ = (id) => document.getElementById(id);
let parsed = []; // FanGraphs rows read from the chosen files or the paste box, not yet saved

const when = (l) => new Date(l.updatedAt).toLocaleString();
const fgKey = (p) => p.id || `${ProspectMatch.nameTokens(p.name).join(' ')}|${p.team}`;

function dedupe(players) {
  const map = new Map();
  for (const p of players) map.set(fgKey(p), p);
  return [...map.values()];
}

function render() {
  chrome.storage.local.get(['mlb', 'fg', 'history'], ({ mlb, fg, history }) => {
    $('hist-current').textContent = history
      ? `${history.players.length} players across ${history.snapshots.length} lists (${history.snapshots.map((s) => s.key).join(', ')}), ` +
        `from ${history.source}, loaded ${when(history)}.`
      : 'No history loaded yet.';
    $('mlb-current').textContent = mlb
      ? `${mlb.players.length} players (${mlb.players.filter((p) => p.rank != null).length} in the Top 100), updated ${when(mlb)}.` +
        (mlb.errors && mlb.errors.length ? ` Could not read: ${mlb.errors.join('; ')}.` : '')
      : 'Not synced yet.';
    const pitchers = fg ? fg.players.filter((p) => /P$/i.test(p.pos)).length : 0;
    $('fg-current').textContent = fg
      ? `${fg.players.length} players (${fg.players.filter((p) => p.rank != null).length} with a Top 100 rank, ` +
        `${pitchers} pitchers), ${fg.source === 'history' ? 'from the history files, ' + fg.label + ',' : 'imported'} ${when(fg)}.` + (pitchers ? '' : ' No pitchers yet: add the pitchers export.')
      : 'Nothing imported yet.';
    $('add').disabled = !parsed.length || !fg;
    const players = ProspectMatch.combine(mlb, fg);
    $('preview-title').textContent = `Combined rankings (${players.length} players)`;
    const body = $('preview');
    body.textContent = '';
    const cell = (v) => (v == null || v === '' ? '' : v);
    for (const p of players) {
      const tr = document.createElement('tr');
      const m = p.mlb || {}, f = p.fg || {};
      for (const v of [p.name, p.team, p.pos, m.rank, m.orgRank, f.fv, f.rank, f.orgRank]) {
        const td = document.createElement('td');
        td.textContent = cell(v);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  });
}

function setParsed(players) {
  parsed = dedupe(players);
  $('save').disabled = !parsed.length;
  $('status').textContent = parsed.length
    ? `Read ${parsed.length} players (${parsed.filter((p) => p.rank != null).length} with a Top 100 rank). Not saved yet.`
    : 'No players could be read from that.';
  render();
}

$('file').addEventListener('change', async (e) => {
  const texts = await Promise.all([...e.target.files].map((f) => f.text()));
  setParsed(texts.flatMap((t) => ProspectParse.parseList(t)));
});
$('text').addEventListener('input', () => setParsed(ProspectParse.parseList($('text').value)));

function saveFg(players, note) {
  chrome.storage.local.set({ fg: { updatedAt: Date.now(), source: 'manual', label: 'import', players } }, () => {
    parsed = [];
    $('save').disabled = true;
    $('file').value = '';
    $('status').textContent = note;
    render();
  });
}
$('save').addEventListener('click', () => saveFg(parsed, `Saved ${parsed.length} players.`));
$('add').addEventListener('click', () => {
  chrome.storage.local.get('fg', ({ fg }) => {
    const merged = dedupe([...((fg && fg.players) || []), ...parsed]);
    saveFg(merged, `Added. The FanGraphs list now has ${merged.length} players.`);
  });
});
$('fg-clear').addEventListener('click', () => chrome.storage.local.remove('fg', () => {
  $('status').textContent = 'FanGraphs list removed.';
  render();
}));
$('mlb-clear').addEventListener('click', () => chrome.storage.local.remove('mlb', () => {
  $('sync-status').textContent = 'MLB Pipeline list removed.';
  render();
}));

$('sync').addEventListener('click', () => {
  $('sync').disabled = true;
  $('sync-status').textContent = 'Fetching the Top 100 and all 30 club lists from MLB.com...';
  chrome.runtime.sendMessage({ type: 'prk-sync' }, (res) => {
    $('sync').disabled = false;
    $('sync-status').textContent = res && res.ok
      ? `Synced ${res.count} players (${res.top100} in the Top 100).` +
        (res.errors.length ? ` ${res.errors.length} page(s) could not be read.` : '')
      : 'Sync failed: ' + ((res && res.error) || 'no response') + '. The saved list is unchanged.';
    render();
  });
});

function historyDone(res) {
  $('hist-sync').disabled = false;
  $('hist-status').textContent = res && res.ok
    ? (res.snapshots.length ? `Loaded ${res.snapshots.length} lists (${res.snapshots.join(', ')}), ${res.players} players.` : 'Loaded.') +
      (res.mlbLists ? ` Also ${res.mlbLists} past MLB Pipeline list${res.mlbLists === 1 ? '' : 's'}.` : '') +
      (res.skipped.length ? ` Skipped (no year plus r/u in the name): ${res.skipped.join(', ')}.` : '')
    : 'History not loaded: ' + ((res && res.error) || 'no response') + '.';
  render();
}
$('hist-sync').addEventListener('click', () => {
  $('hist-sync').disabled = true;
  $('hist-status').textContent = 'Reading the ranking files from GitHub...';
  chrome.runtime.sendMessage({ type: 'prk-history-sync' }, historyDone);
});
$('hist-files').addEventListener('change', async (e) => {
  const files = await Promise.all([...e.target.files].map(async (f) => ({ name: f.name, text: await f.text() })));
  if (files.length) chrome.runtime.sendMessage({ type: 'prk-history-files', files }, historyDone);
  e.target.value = '';
});
$('hist-clear').addEventListener('click', () => chrome.storage.local.remove('history', () => {
  $('hist-status').textContent = 'History removed.';
  render();
}));

// Sold prices saved from eBay.
let salesCtx = {};
function renderSales() {
  chrome.storage.local.get(['sales', 'history', 'mlbSnaps', 'listDates'], ({ sales, history, mlbSnaps, listDates }) => {
    salesCtx = { history: history || null, mlbSnaps: mlbSnaps || null, overrides: listDates || {} };
    renderDates(history, mlbSnaps, listDates || {});
    const all = Object.values(sales || {});
    const players = new Set(all.map((r) => r.player)).size;
    $('sales-current').textContent = all.length
      ? `${all.length} sold listings saved for ${players} players.`
      : 'No sold listings saved yet.';
    $('sales-download').disabled = $('sales-clear').disabled = !all.length;
    $('sales-wrap').hidden = !all.length;
    const body = $('sales-rows');
    body.textContent = '';
    const recent = all.sort((a, b) => (b.sold_date || '').localeCompare(a.sold_date || '')).slice(0, 200);
    for (const r of recent) {
      const tr = document.createElement('tr');
      const price = `${r.currency || '$'}${r.price.toFixed(2)}`;
      const then = ProspectAsOf.atSale(r, salesCtx);
      const thenText = [then.fg_fv_at_sale ? `${then.fg_fv_at_sale} FV (${then.fg_list_at_sale})` : then.fg_list_at_sale ? `not on FG ${then.fg_list_at_sale}` : '',
        then.mlb_rank_at_sale != null ? `MLB #${then.mlb_rank_at_sale}` : then.mlb_org_rank_at_sale != null ? `MLB org #${then.mlb_org_rank_at_sale}` : ''].filter(Boolean).join(' · ');
      for (const v of [r.sold_date, `${r.player} (${r.team})`, price, ProspectCards.describeCard(ProspectCards.parseTitle(r.title, r.player)), r.format + (r.note ? ' *' : ''), thenText]) {
        const td = document.createElement('td');
        td.textContent = v == null ? '' : v;
        tr.appendChild(td);
      }
      const td = document.createElement('td');
      const a = document.createElement('a');
      a.href = r.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = r.title.length > 60 ? r.title.slice(0, 57) + '...' : r.title;
      td.appendChild(a);
      tr.appendChild(td);
      body.appendChild(tr);
    }
  });
}
$('sales-download').addEventListener('click', () => {
  chrome.storage.local.get(['sales', 'history', 'mlbSnaps', 'listDates'], ({ sales, history, mlbSnaps, listDates }) => {
    const ctx = { history: history || null, mlbSnaps: mlbSnaps || null, overrides: listDates || {} };
    const blob = new Blob([ProspectSales.toCsv(Object.values(sales || {}), ctx)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prospect-sold-prices-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $('sales-status').textContent = 'Downloaded.';
  });
});
let clearArmed = false;
$('sales-clear').addEventListener('click', () => {
  // A second press confirms, since this cannot be undone.
  if (!clearArmed) {
    clearArmed = true;
    $('sales-clear').textContent = 'Press again to remove all';
    setTimeout(() => { clearArmed = false; $('sales-clear').textContent = 'Remove all'; }, 4000);
    return;
  }
  clearArmed = false;
  $('sales-clear').textContent = 'Remove all';
  chrome.storage.local.remove('sales', () => { $('sales-status').textContent = 'All saved sales removed.'; });
});
// The date each list counts from, editable.
function renderDates(history, mlbSnaps, overrides) {
  const fgKeys = history ? history.snapshots.map((s) => s.key || `${s.year}${s.type}`) : [];
  const mlbKeys = Object.keys(mlbSnaps || {}).sort();
  $('dates-current').textContent = (fgKeys.length ? `FanGraphs: ${fgKeys.length} lists. ` : 'FanGraphs: no history loaded, so no FV on sale dates. ') +
    (mlbKeys.length ? `MLB Pipeline: ${mlbKeys.length} lists (${mlbKeys[0]} to ${mlbKeys[mlbKeys.length - 1]}).`
      : 'MLB Pipeline: no lists yet. Sync MLB Pipeline, and Sync history from GitHub for past years.');
  $('dates-wrap').hidden = !(fgKeys.length || mlbKeys.length);
  const body = $('dates-rows');
  body.textContent = '';
  const row = (key, label, editable) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = label;
    const cell = document.createElement('td');
    const note = document.createElement('td');
    note.className = 'muted';
    if (editable) {
      const input = document.createElement('input');
      input.type = 'date';
      input.value = ProspectAsOf.listDate(key, overrides);
      input.setAttribute('aria-label', `${label} counts from`);
      input.addEventListener('change', () => {
        if (!input.value) return;
        const next = Object.assign({}, overrides, { [key]: input.value });
        if (input.value === ProspectAsOf.listDate(key)) delete next[key];
        chrome.storage.local.set({ listDates: next });
      });
      cell.appendChild(input);
      note.textContent = overrides[key] ? 'changed' : 'estimate';
    } else {
      cell.textContent = key;
      note.textContent = 'read that day';
    }
    tr.append(name, cell, note);
    body.appendChild(tr);
  };
  for (const k of fgKeys) row(k, `FanGraphs ${k.slice(0, 4)} ${k.endsWith('u') ? 'Updated' : 'Report'}`, true);
  for (const k of mlbKeys) {
    if (/preseason/.test(k)) row(k, `MLB Pipeline ${k.slice(0, 4)} preseason`, true);
    else row(k, 'MLB Pipeline, as synced', false);
  }
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.sales || changes.history || changes.mlbSnaps || changes.listDates) renderSales();
});
renderSales();

render();
