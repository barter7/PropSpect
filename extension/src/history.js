// Builds a per-player timeline from yearly FanGraphs ranking files.
// A file name carries its year and ends in "r" (Report, the baseline list for
// that cycle) or "u" (Updated, the later revision): 2025r.csv, 2025u.csv.
(function (root) {
  const Match = root.ProspectMatch || require('./match.js');

  // "Rankings/fangraphs/2025u.csv" -> { year: 2025, type: 'u', key: '2025u', order }
  function parseFileName(name) {
    const base = String(name).split('/').pop().replace(/\.[^.]+$/, '');
    const year = /(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/.exec(base);
    const type = /(?:[0-9]|[-_ .])([ru])$/i.exec(base); // not the r of "pitcher"
    if (!year || !type) return null;
    const t = type[1].toLowerCase();
    return { year: +year[1], type: t, key: year[1] + t, order: +year[1] * 2 + (t === 'u' ? 1 : 0) };
  }

  const snapshotLabel = (s) => `${s.year} ${s.type === 'u' ? 'Updated' : 'Report'}`;

  // files: [{ name, text }]. Returns
  // { snapshots: [{ key, year, type }], players: [{ name, team, pos, signYr, pts }], skipped: [names] }
  // where pts is [[snapshotIndex, fv, orgRank, top100Rank], ...] in time order.
  // onPoint(player, row, snapshotIndex), if given, sees every row as it is placed.
  function buildHistory(files, parseList, onPoint) {
    const byKey = new Map();
    const skipped = [];
    for (const f of files) {
      const info = parseFileName(f.name);
      if (!info) { skipped.push(f.name); continue; }
      if (!byKey.has(info.key)) byKey.set(info.key, { ...info, rows: [] });
      byKey.get(info.key).rows.push(...parseList(f.text));
    }
    const snaps = [...byKey.values()].sort((a, b) => a.order - b.order);
    const players = [];
    const byId = new Map();
    const byName = new Map();
    snaps.forEach((snap, idx) => {
      for (const row of snap.rows) {
        const nameKey = Match.nameTokens(row.name).join(' ');
        const team = Match.normTeam(row.team);
        const seen = (p) => p.pts.length && p.pts[p.pts.length - 1][0] === idx;
        let p = row.id ? byId.get(row.id) : null;
        if (!p) {
          // FanGraphs ids change when a player reaches the majors, so fall back to the name.
          // Namesakes are kept apart by signing year, then by club.
          const open = (byName.get(nameKey) || [])
            .filter((c) => !seen(c) && !(c.signYr && row.signYr && c.signYr !== row.signYr));
          p = open.find((c) => c.team === team) || (open.length === 1 ? open[0] : null);
        }
        if (p && seen(p)) continue; // the same player twice in one snapshot
        if (!p) {
          p = { name: row.name, team, pos: row.pos, signYr: null, pts: [] };
          players.push(p);
          if (!byName.has(nameKey)) byName.set(nameKey, []);
          byName.get(nameKey).push(p);
        }
        if (row.id) byId.set(row.id, p);
        p.name = row.name; p.team = team; p.pos = row.pos || p.pos;
        if (row.signYr) p.signYr = row.signYr;
        p.pts.push([idx, row.fv || '', row.orgRank, row.rank]);
        if (onPoint) onPoint(p, row, idx);
      }
    });
    return { snapshots: snaps.map(({ key, year, type }) => ({ key, year, type })), players, skipped };
  }

  // FanGraphs revises one club at a time, so the newest file can hold only a few
  // clubs. A club's current list is the newest file that club appears in.
  function currentIndexByTeam(history) {
    const latest = new Map();
    for (const p of history.players) {
      const idx = p.pts[p.pts.length - 1][0];
      if (!(latest.get(p.team) >= idx)) latest.set(p.team, idx);
    }
    return latest;
  }

  // Every player on his club's current list, as a plain ranking list for the badge's FanGraphs part.
  function latestList(history) {
    const latest = currentIndexByTeam(history);
    const out = [];
    for (const p of history.players) {
      const pt = p.pts[p.pts.length - 1];
      if (pt[0] !== latest.get(p.team)) continue;
      out.push({ name: p.name, team: p.team, pos: p.pos, fv: pt[1], orgRank: pt[2], rank: pt[3] });
    }
    return out;
  }

  function indexHistory(history) {
    const map = new Map();
    for (const p of (history && history.players) || []) {
      const key = Match.nameTokens(p.name).join(' ');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    return map;
  }

  // The timeline for a combined player (see match.js), or null.
  function lookup(index, player) {
    const list = index.get(Match.nameTokens(player.name).join(' ')) || [];
    return list.find((p) => p.team === player.team) || list[0] || null;
  }

  const api = { parseFileName, snapshotLabel, buildHistory, currentIndexByTeam, latestList, indexHistory, lookup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProspectHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
