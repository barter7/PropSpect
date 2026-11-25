// Fetches MLB Pipeline rankings on request and refreshes them weekly.
importScripts('mlb.js');

const WEEK = 7 * 24 * 60 * 60 * 1000;
let running = null;

async function sync() {
  const fetchText = async (url) => {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  };
  const { players, errors } = await ProspectMLB.fetchRankings(fetchText);
  await chrome.storage.local.set({ mlb: { updatedAt: Date.now(), players, errors } });
  return { count: players.length, top100: players.filter((p) => p.rank != null).length, errors };
}

function syncOnce() {
  if (!running) running = sync().finally(() => { running = null; });
  return running;
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || msg.type !== 'prk-sync') return;
  syncOnce().then((r) => respond({ ok: true, ...r }), (err) => respond({ ok: false, error: err.message }));
  return true; // answer asynchronously
});

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('prk-refresh', { periodInMinutes: 720 }));
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'prk-refresh') return;
  const { mlb } = await chrome.storage.local.get('mlb');
  if (mlb && Date.now() - mlb.updatedAt > WEEK) syncOnce().catch(() => {});
});
