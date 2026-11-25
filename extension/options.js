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
  chrome.storage.local.get(['mlb', 'fg'], ({ mlb, fg }) => {
    $('mlb-current').textContent = mlb
      ? `${mlb.players.length} players (${mlb.players.filter((p) => p.rank != null).length} in the Top 100), updated ${when(mlb)}.` +
        (mlb.errors && mlb.errors.length ? ` Could not read: ${mlb.errors.join('; ')}.` : '')
      : 'Not synced yet.';
    const pitchers = fg ? fg.players.filter((p) => /P$/i.test(p.pos)).length : 0;
    $('fg-current').textContent = fg
      ? `${fg.players.length} players (${fg.players.filter((p) => p.rank != null).length} with a Top 100 rank, ` +
        `${pitchers} pitchers), imported ${when(fg)}.` + (pitchers ? '' : ' No pitchers yet: add the pitchers export.')
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
  chrome.storage.local.set({ fg: { updatedAt: Date.now(), players } }, () => {
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

render();
