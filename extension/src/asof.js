// Which ranking was current on a given date: FanGraphs (FV, Top 100 rank, club
// rank) from the yearly Report/Updated lists, and MLB Pipeline (Top 100 rank,
// club rank) from dated snapshots. Used when sold prices are exported.
(function (root) {
  const Match = root.ProspectMatch || (typeof require !== 'undefined' ? require('./match.js') : null);
  const History = root.ProspectHistory || (typeof require !== 'undefined' ? require('./history.js') : null);

  // When a list took effect, as YYYY-MM-DD. FanGraphs publishes a year's Report club by
  // club over the off-season and the Updated list in mid-season; MLB publishes its
  // preseason Top 100 in January. These defaults can be changed (overrides: {key: date}).
  function listDate(key, overrides) {
    if (overrides && overrides[key]) return overrides[key];
    let m = /^(\d{4})([ru])$/.exec(key);
    if (m) return m[2] === 'r' ? `${m[1]}-01-01` : `${m[1]}-08-01`;
    m = /^(\d{4})-preseason$/.exec(key);
    if (m) return `${m[1]}-01-20`;
    m = /^(\d{4}-\d{2}-\d{2})$/.exec(key);
    return m ? m[1] : '';
  }

  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
  const key = (name) => Match.nameTokens(name).join(' ');

  // Clubs on each FanGraphs list, so a list still being rolled out (a few clubs so far)
  // only counts for the clubs it already has.
  const clubCache = new WeakMap();
  function clubsByList(history) {
    if (!clubCache.has(history)) {
      const sets = history.snapshots.map(() => new Set());
      for (const p of history.players) for (const pt of p.pts) sets[pt[0]].add(p.team);
      clubCache.set(history, sets);
    }
    return clubCache.get(history);
  }
  const indexCache = new WeakMap();
  const historyIndex = (h) => { if (!indexCache.has(h)) indexCache.set(h, History.indexHistory(h)); return indexCache.get(h); };

  // FanGraphs as of a date: { list, fv, rank, orgRank } with empty values if he was not on
  // that list, or null when no list had taken effect yet.
  function fgAt(history, name, team, date, overrides) {
    if (!history || !history.snapshots || !date) return null;
    const clubs = clubsByList(history);
    let at = -1;
    history.snapshots.forEach((s, i) => {
      const d = listDate(s.key || `${s.year}${s.type}`, overrides);
      if (d && d <= date && (!team || clubs[i].has(team) || clubs[i].size >= 30)) at = i;
    });
    if (at < 0) return null;
    const snap = history.snapshots[at];
    const list = snap.key || `${snap.year}${snap.type}`;
    const p = History.lookup(historyIndex(history), { name, team });
    const pt = p && p.pts.find((x) => x[0] === at);
    return pt ? { list, fv: pt[1] || '', rank: pt[3] ?? null, orgRank: pt[2] ?? null } : { list, fv: '', rank: null, orgRank: null };
  }

  // MLB Pipeline as of a date, from snapshots { label: { label, date, players: [[name, team, rank, orgRank]] } }.
  // The latest snapshot on or before the date, if under MAX_AGE days old. Failing that, the first
  // one read within LOOKAHEAD days after it (MLB changes its lists a few times a year), marked as read after.
  const MAX_AGE = 400, LOOKAHEAD = 90;
  const snapCache = new WeakMap();
  function mlbAt(snaps, name, team, date, overrides) {
    if (!snaps || !date) return null;
    const all = Object.values(snaps).map((s) => ({ s, d: listDate(s.label, overrides) || s.date })).filter((x) => x.d)
      .sort((a, b) => a.d.localeCompare(b.d));
    const before = all.filter((x) => x.d <= date && days(x.d, date) <= MAX_AGE);
    const after = all.filter((x) => x.d > date && days(date, x.d) <= LOOKAHEAD && /^\d{4}-\d{2}-\d{2}$/.test(x.s.label));
    const hit = before[before.length - 1] || after[0];
    if (!hit) return null;
    const late = hit.d > date;
    if (!snapCache.has(hit.s)) {
      const m = new Map();
      for (const [n, t, rank, orgRank] of hit.s.players) {
        const k = key(n);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push({ team: t, rank, orgRank });
      }
      snapCache.set(hit.s, m);
    }
    const cands = snapCache.get(hit.s).get(key(name)) || [];
    const p = cands.find((c) => c.team === team) || (cands.length === 1 ? cands[0] : null);
    return { list: hit.s.label + (late ? ' (read after the sale)' : ''), rank: p ? p.rank ?? null : null, orgRank: p ? p.orgRank ?? null : null };
  }

  // The ranking columns for one sale, as of its sale date (or the day it was saved).
  function atSale(r, ctx) {
    const date = r.sold_date || String(r.saved_at || '').slice(0, 10);
    const fg = fgAt(ctx.history, r.player, r.team, date, ctx.overrides);
    const mlb = mlbAt(ctx.mlbSnaps, r.player, r.team, date, ctx.overrides);
    return {
      fg_list_at_sale: fg ? fg.list : '',
      fg_fv_at_sale: fg ? fg.fv : '',
      fg_rank_at_sale: fg ? fg.rank : null,
      fg_org_rank_at_sale: fg ? fg.orgRank : null,
      mlb_list_at_sale: mlb ? mlb.list : '',
      mlb_rank_at_sale: mlb ? mlb.rank : null,
      mlb_org_rank_at_sale: mlb ? mlb.orgRank : null,
    };
  }

  // A CSV of MLB rankings (rank, org_rank, name, team, pos) as a snapshot.
  function mlbSnapshotFromCsv(label, rows) {
    return { label, date: listDate(label), players: rows.map((r) => [r.name, Match.normTeam(r.team), r.rank ?? null, r.orgRank ?? null]) };
  }
  const mlbLabel = (fileName) => (/(\d{4}-preseason|\d{4}-\d{2}-\d{2})\.csv$/i.exec(String(fileName)) || [])[1] || '';

  const api = { listDate, fgAt, mlbAt, atSale, mlbSnapshotFromCsv, mlbLabel, MAX_AGE, LOOKAHEAD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProspectAsOf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
