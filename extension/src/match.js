// Finds ranked players' names inside free text such as an eBay listing title.
// Loaded as a content script, by the extension pages, and by the Node tests.
(function (root) {
  const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

  // "J.J. Wetherholt Jr." -> ["jj", "wetherholt", "jr"]; "Jesús Made" -> ["jesus", "made"]
  function tokenize(text) {
    const raw = String(text || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[.'’`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
    // Join runs of single letters so "J J", "J.J." and "JJ" all read as "jj".
    const out = [];
    for (const t of raw) {
      const prev = out[out.length - 1];
      if (/^[a-z]$/.test(t) && prev && prev.letters) {
        prev.text += t;
      } else {
        out.push({ text: t, letters: /^[a-z]$/.test(t) });
      }
    }
    return out.map((t) => t.text);
  }

  function nameTokens(name) {
    const tokens = tokenize(name);
    while (tokens.length > 2 && SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
    return tokens;
  }

  const TEAM_ALIASES = { ARI: 'AZ', CHW: 'CWS', KCR: 'KC', SDP: 'SD', SFG: 'SF', TBR: 'TB', WSN: 'WSH', WAS: 'WSH', OAK: 'ATH' };
  const normTeam = (t) => { const u = String(t || '').trim().toUpperCase(); return TEAM_ALIASES[u] || u; };

  // Merges the MLB Pipeline list and the FanGraphs list into one entry per player:
  // { name, team, pos, mlb: { rank, orgRank } | null, fg: { rank, orgRank, fv } | null }
  // rank is the overall (Top 100) rank and is null for a player ranked only within his club.
  function combine(mlb, fg) {
    const out = [];
    const byName = new Map();
    for (const p of (mlb && mlb.players) || []) {
      const entry = { name: p.name, team: normTeam(p.team), pos: p.pos || '', mlb: { rank: p.rank, orgRank: p.orgRank }, fg: null };
      out.push(entry);
      const key = nameTokens(p.name).join(' ');
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(entry);
    }
    for (const p of (fg && fg.players) || []) {
      const team = normTeam(p.team);
      const open = (byName.get(nameTokens(p.name).join(' ')) || []).filter((e) => !e.fg);
      // Same name and club is the same player; a lone namesake is too (the lists can disagree on club after a trade).
      const entry = open.find((e) => e.team === team) || (open.length === 1 ? open[0] : null);
      const data = { rank: p.rank, orgRank: p.orgRank, fv: p.fv || '' };
      if (entry) {
        entry.fg = data;
        if (!entry.team) entry.team = team;
        if (!entry.pos) entry.pos = p.pos || '';
      } else {
        out.push({ name: p.name, team, pos: p.pos || '', mlb: null, fg: data });
      }
    }
    return out.sort((x, y) => sortKey(x) - sortKey(y));
  }

  // Best overall rank from either source; club-only players follow, by club rank.
  function sortKey(p) {
    const srcs = [p.mlb, p.fg].filter(Boolean);
    const overall = srcs.map((s) => s.rank).filter((r) => r != null);
    if (overall.length) return Math.min(...overall);
    return 1000 + Math.min(999, ...srcs.map((s) => s.orgRank).filter((r) => r != null));
  }

  const fvNumber = (p) => (p.fg && parseInt(p.fg.fv, 10)) || 0;

  // 1 (best) to 4, from the better of MLB's overall rank and FanGraphs' Future Value tier.
  function tier(p) {
    const ranks = [p.mlb, p.fg].filter(Boolean).map((s) => s.rank).filter((r) => r != null);
    const best = ranks.length ? Math.min(...ranks) : Infinity;
    const fv = fvNumber(p);
    if (best <= 10 || fv >= 60) return 1;
    if (best <= 50 || fv >= 50) return 2;
    if (best <= 100 || fv >= 45) return 3;
    return 4;
  }

  // "NYM 3B/SS · MLB #68 · FG 50 #44"; a club-only rank reads "MLB org 3" / "FG 45+ org 2".
  function badgeText(p) {
    const parts = [[p.team, p.pos].filter(Boolean).join(' ')];
    if (p.mlb) parts.push('MLB ' + (p.mlb.rank != null ? '#' + p.mlb.rank : 'org ' + p.mlb.orgRank));
    if (p.fg) {
      const rk = p.fg.rank != null ? '#' + p.fg.rank : p.fg.orgRank != null ? 'org ' + p.fg.orgRank : '';
      parts.push(['FG', p.fg.fv, rk].filter(Boolean).join(' '));
    }
    return parts.filter(Boolean).join(' \u00b7 ');
  }

  function describe(p) {
    const lines = [p.name + (p.team || p.pos ? ` (${[p.team, p.pos].filter(Boolean).join(' ')})` : '')];
    const ranks = (s) => [s.rank != null ? `#${s.rank} overall` : 'not in Top 100', s.orgRank != null ? `#${s.orgRank} in club` : '']
      .filter(Boolean).join(', ');
    lines.push('MLB Pipeline: ' + (p.mlb ? ranks(p.mlb) : 'not ranked'));
    lines.push('FanGraphs: ' + (p.fg ? (p.fg.fv ? `${p.fg.fv} FV, ` : '') + ranks(p.fg) : 'not on the imported list'));
    return lines.join('\n');
  }

  // players: the output of combine()
  function buildIndex(players) {
    const byFirst = new Map();
    for (const player of players || []) {
      const tokens = nameTokens(player.name);
      if (tokens.length < 2) continue; // a single word is too ambiguous to match in a title
      if (!byFirst.has(tokens[0])) byFirst.set(tokens[0], []);
      byFirst.get(tokens[0]).push({ tokens, player });
    }
    for (const list of byFirst.values()) {
      // Longest name first, then best rank, so the most specific match wins.
      list.sort((a, b) => b.tokens.length - a.tokens.length || sortKey(a.player) - sortKey(b.player));
    }
    return byFirst;
  }

  // Returns the ranked players named in the text, in the order they appear.
  function findPlayers(text, index) {
    const tokens = tokenize(text);
    const found = [];
    const seen = new Set();
    for (let i = 0; i < tokens.length; i++) {
      const candidates = index.get(tokens[i]);
      if (!candidates) continue;
      for (const c of candidates) {
        if (i + c.tokens.length > tokens.length) continue;
        let ok = true;
        for (let j = 1; j < c.tokens.length; j++) {
          if (tokens[i + j] !== c.tokens[j]) { ok = false; break; }
        }
        if (!ok) continue;
        if (!seen.has(c.player)) { seen.add(c.player); found.push(c.player); }
        i += c.tokens.length - 1;
        break;
      }
    }
    return found;
  }

  const api = { tokenize, nameTokens, combine, sortKey, tier, badgeText, describe, buildIndex, findPlayers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProspectMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
