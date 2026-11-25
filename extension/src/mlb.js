// Reads MLB Pipeline's prospect rankings (Top 100 plus each club's Top 30)
// from the ranking pages on www.mlb.com. Each page carries its list as JSON
// in a data-init-state attribute. Used by the background worker and the tests.
(function (root) {
  const BASE = 'https://www.mlb.com/milb/prospects/';
  const TEAMS = {
    dbacks: 'AZ', athletics: 'ATH', braves: 'ATL', orioles: 'BAL', redsox: 'BOS', cubs: 'CHC',
    whitesox: 'CWS', reds: 'CIN', guardians: 'CLE', rockies: 'COL', tigers: 'DET', astros: 'HOU',
    royals: 'KC', angels: 'LAA', dodgers: 'LAD', marlins: 'MIA', brewers: 'MIL', twins: 'MIN',
    mets: 'NYM', yankees: 'NYY', phillies: 'PHI', pirates: 'PIT', padres: 'SD', mariners: 'SEA',
    giants: 'SF', cardinals: 'STL', rays: 'TB', rangers: 'TEX', bluejays: 'TOR', nationals: 'WSH',
  };

  function unescapeHtml(s) {
    return s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  // One ranking page -> [{ id, rank, name, pos }]
  function parsePage(html) {
    const m = /data-init-state="([^"]*)"/.exec(html);
    if (!m) throw new Error('ranking data not found in page');
    const payload = JSON.parse(unescapeHtml(m[1])).payload || {};
    const query = payload.ROOT_QUERY || {};
    const key = Object.keys(query).find((k) => k.startsWith('getPlayerRankingsFromSelection'));
    if (!key || !Array.isArray(query[key])) throw new Error('ranking list not found in page');
    const out = [];
    for (const row of query[key]) {
      const entity = row.playerEntity || {};
      const person = payload[(entity.player || {}).__ref] || {};
      const name = [person.useName, person.useLastName].filter(Boolean).join(' ').trim();
      if (!name || !row.rank) continue;
      out.push({
        id: person.id,
        rank: row.rank,
        name,
        pos: entity.position || (person.primaryPosition || {}).abbreviation || '',
      });
    }
    return out;
  }

  // fetchText(url) -> Promise<string>. Returns { players, errors }.
  async function fetchRankings(fetchText, onProgress) {
    const byId = new Map();
    const errors = [];
    const jobs = [['top100', null], ...Object.entries(TEAMS)];
    let done = 0;
    const worker = async () => {
      while (jobs.length) {
        const [slug, team] = jobs.shift();
        try {
          const rows = parsePage(await fetchText(BASE + slug + '/'));
          for (const r of rows) {
            const key = r.id != null ? r.id : r.name;
            const p = byId.get(key) || { rank: null, orgRank: null, name: r.name, team: '', pos: r.pos };
            if (team) { p.orgRank = r.rank; p.team = team; } else { p.rank = r.rank; }
            byId.set(key, p);
          }
        } catch (err) {
          errors.push(`${slug}: ${err.message}`);
        }
        if (onProgress) onProgress(++done, Object.keys(TEAMS).length + 1);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const players = [...byId.values()].sort((a, b) => sortKey(a) - sortKey(b));
    if (!players.length) throw new Error('no rankings could be read: ' + errors.slice(0, 3).join('; '));
    return { players, errors };
  }

  // Top-100 players first by rank, then everyone else by their club rank.
  function sortKey(p) {
    return p.rank != null ? p.rank : 1000 + (p.orgRank || 999);
  }

  const api = { TEAMS, parsePage, fetchRankings, sortKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProspectMLB = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
