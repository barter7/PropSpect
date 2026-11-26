// Fetches MLB Pipeline rankings and the FanGraphs history files on request, and refreshes both weekly.
importScripts('match.js', 'parse.js', 'history.js', 'asof.js', 'mlb.js');

// Where the yearly FanGraphs files live: Rankings/ in this repository's default branch.
const REPO = 'barter7/PropSpect';
const REF = 'main';

const WEEK = 7 * 24 * 60 * 60 * 1000;
let running = null;

async function sync() {
  const fetchText = async (url) => {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  };
  const { players, errors } = await ProspectMLB.fetchRankings(fetchText);
  // Keep a dated copy of every sync, so a sale can be matched to the ranks of its own day.
  const day = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
  const { mlbSnaps } = await chrome.storage.local.get('mlbSnaps');
  const snaps = mlbSnaps || {};
  snaps[day] = { label: day, date: day, source: 'sync', players: players.map((p) => [p.name, p.team, p.rank ?? null, p.orgRank ?? null]) };
  await chrome.storage.local.set({ mlb: { updatedAt: Date.now(), players, errors }, mlbSnaps: snaps });
  return { count: players.length, top100: players.filter((p) => p.rank != null).length, errors };
}

// Reads every <year>r / <year>u CSV under Rankings/ (except the other sources' folders)
// and builds the per-player history. The newest snapshot also becomes the FanGraphs list.
async function syncHistory(auto) {
  const get = async (url) => {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('/').pop().split('?')[0]}`);
    return res;
  };
  const tree = await (await get(`https://api.github.com/repos/${REPO}/git/trees/${REF}?recursive=1`)).json();
  const paths = (tree.tree || []).map((t) => (t.type === 'blob' ? t.path : ''))
    .filter((p) => /^Rankings\/.+\.csv$/i.test(p) && !/^Rankings\/(mlb-pipeline|other)\//i.test(p) && ProspectHistory.parseFileName(p));
  if (!paths.length) throw new Error(`no <year>r.csv or <year>u.csv files found under Rankings/ on ${REPO}@${REF}`);
  const files = [];
  // Past MLB Pipeline lists: Rankings/mlb-pipeline/<year>-preseason.csv and <YYYY-MM-DD>.csv.
  for (const t of tree.tree || []) {
    if (t.type !== 'blob' || !/^Rankings\/mlb-pipeline\/.+\.csv$/i.test(t.path) || !ProspectAsOf.mlbLabel(t.path)) continue;
    const url = `https://raw.githubusercontent.com/${REPO}/${REF}/${t.path.split('/').map(encodeURIComponent).join('/')}`;
    files.push({ name: t.path, text: await (await get(url)).text() });
  }
  for (const path of paths) {
    const url = `https://raw.githubusercontent.com/${REPO}/${REF}/${path.split('/').map(encodeURIComponent).join('/')}`;
    files.push({ name: path, text: await (await get(url)).text() });
  }
  return saveHistory(files, 'GitHub', auto);
}

async function saveHistory(files, source, auto) {
  // MLB list files become dated snapshots; the rest are FanGraphs lists.
  const mlbFiles = files.filter((f) => ProspectAsOf.mlbLabel(f.name));
  files = files.filter((f) => !ProspectAsOf.mlbLabel(f.name));
  let mlbLoaded = 0;
  if (mlbFiles.length) {
    const { mlbSnaps } = await chrome.storage.local.get('mlbSnaps');
    const snaps = mlbSnaps || {};
    for (const f of mlbFiles) {
      const label = ProspectAsOf.mlbLabel(f.name);
      if (snaps[label] && snaps[label].source === 'sync') continue; // a sync of that day is kept as read
      snaps[label] = Object.assign(ProspectAsOf.mlbSnapshotFromCsv(label, ProspectParse.parseList(f.text)), { source: 'file' });
      mlbLoaded++;
    }
    await chrome.storage.local.set({ mlbSnaps: snaps });
    if (!files.length) return { snapshots: [], players: 0, skipped: [], mlbLists: mlbLoaded };
  }
  const history = ProspectHistory.buildHistory(files, ProspectParse.parseList);
  if (!history.snapshots.length) throw new Error('no files named <year>r or <year>u');
  history.updatedAt = Date.now();
  history.source = source;
  const update = { history };
  const { fg } = await chrome.storage.local.get('fg');
  // A list the user imported by hand is only replaced when they ask for a history load themselves.
  if (!auto || !fg || fg.source === 'history') {
    const latest = history.snapshots[history.snapshots.length - 1];
    update.fg = { updatedAt: Date.now(), source: 'history', label: 'through ' + ProspectHistory.snapshotLabel(latest), players: ProspectHistory.latestList(history) };
  }
  await chrome.storage.local.set(update);
  return { snapshots: history.snapshots.map((s) => s.key), players: history.players.length, skipped: history.skipped, mlbLists: mlbLoaded };
}

function syncOnce() {
  if (!running) running = sync().finally(() => { running = null; });
  return running;
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg) return;
  if (msg.type === 'prk-history-sync' || msg.type === 'prk-history-files') {
    const job = msg.type === 'prk-history-sync' ? syncHistory(false) : saveHistory(msg.files, 'files', false);
    job.then((r) => respond({ ok: true, ...r }), (err) => respond({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type !== 'prk-sync') return;
  syncOnce().then((r) => respond({ ok: true, ...r }), (err) => respond({ ok: false, error: err.message }));
  return true; // answer asynchronously
});

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('prk-refresh', { periodInMinutes: 720 }));
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'prk-refresh') return;
  const { mlb, history } = await chrome.storage.local.get(['mlb', 'history']);
  if (mlb && Date.now() - mlb.updatedAt > WEEK) syncOnce().catch(() => {});
  if (history && history.source === 'GitHub' && Date.now() - history.updatedAt > WEEK) syncHistory(true).catch(() => {});
});
