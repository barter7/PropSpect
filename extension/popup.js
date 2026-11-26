const $ = (id) => document.getElementById(id);
let players = [];
let history = null;
let historyIndex = new Map();

function search() {
  const q = ProspectMatch.tokenize($('q').value).join(' ');
  const ul = $('results');
  ul.textContent = '';
  if (!q) return;
  const hits = players.filter((p) => ProspectMatch.tokenize(p.name).join(' ').includes(q)).slice(0, 8);
  if (!hits.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = players.length ? 'Not ranked by either source.' : 'No rankings saved yet.';
    ul.appendChild(li);
    return;
  }
  for (const p of hits) {
    const li = document.createElement('li');
    li.title = ProspectMatch.describe(p);
    const name = document.createElement('strong');
    name.textContent = p.name;
    const info = document.createElement('span');
    info.textContent = ProspectMatch.badgeText(p);
    li.append(name, info);
    const hist = ProspectHistory.lookup(historyIndex, p);
    if (hist) {
      li.classList.add('has-history');
      li.addEventListener('click', () => {
        const open = li.querySelector('.prk-chart');
        if (open) open.remove(); else li.appendChild(ProspectChart.render(document, history, hist));
      });
      if (hits.length === 1) li.appendChild(ProspectChart.render(document, history, hist));
    }
    ul.appendChild(li);
  }
}

chrome.storage.local.get(['mlb', 'fg', 'history', 'enabled', 'saveSales', 'sales'], ({ mlb, fg, history: h, enabled, saveSales, sales }) => {
  $('saveSales').checked = saveSales !== false;
  const n = Object.keys(sales || {}).length;
  $('sales-count').textContent = n ? `(${n} saved)` : '';
  history = h || null;
  historyIndex = ProspectHistory.indexHistory(history);
  players = ProspectMatch.combine(mlb, fg);
  $('enabled').checked = enabled !== false;
  const day = (l) => new Date(l.updatedAt).toLocaleDateString();
  $('current').textContent = players.length
    ? [mlb && `MLB Pipeline: ${mlb.players.length} players, ${day(mlb)}`, fg && `FanGraphs: ${fg.players.length} players, ${day(fg)}`]
      .filter(Boolean).join(' · ')
    : 'No rankings yet. Sync MLB Pipeline or import The Board.';
});

$('q').addEventListener('input', search);
$('enabled').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));
$('saveSales').addEventListener('change', (e) => chrome.storage.local.set({ saveSales: e.target.checked }));
$('open').textContent = 'Sync or import rankings';
$('open').addEventListener('click', () => chrome.runtime.openOptionsPage());
