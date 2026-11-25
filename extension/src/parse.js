// Turns a CSV export (such as FanGraphs' The Board) or a pasted list into
// [{ rank, name, team, pos, orgRank, fv, id, signYr }]. rank is the overall rank, or null
// for a player ranked only within his club.
(function (root) {
  const TEAMS = new Set(('ARI AZ ATL BAL BOS CHC CHW CWS CIN CLE COL DET HOU KC KCR LAA LAD MIA MIL MIN NYM NYY ' +
    'ATH OAK PHI PIT SD SDP SEA SF SFG STL TB TBR TEX TOR WSH WSN WAS').split(' '));
  const POSITIONS = new Set('C 1B 2B 3B SS OF LF CF RF DH P RHP LHP SP RP INF IF UT UTIL TWP'.split(' '));
  const isPos = (t) => t.split('/').every((p) => POSITIONS.has(p.toUpperCase())) && t === t.toUpperCase();
  const isTeam = (t) => TEAMS.has(t);

  const COLS = {
    name: /^(name|player|player ?name)$/,
    rank: /^(rank|rk|#|no|top ?100|ovr|overall|ovr[ _]?(rank|rk)|overall rank)$/,
    orgRank: /^(org[ _]?(rank|rk)|team rank)$/,
    team: /^(org|team|tm|organization)$/,
    pos: /^(pos|position)$/,
    fv: /^(fv|future value)$/,
    id: /^(playerid|player id|id)$/,
    signYr: /^(sign ?yr|sign ?year|signed|signing year)$/,
  };

  // Splits delimited text into rows of cells. Quoted cells may hold the
  // delimiter, doubled quotes and line breaks (scouting reports do).
  function readTable(text, delim) {
    const rows = [];
    let row = [], cur = '', quoted = false;
    const endCell = () => { row.push(cur.trim()); cur = ''; };
    const endRow = () => { endCell(); if (row.some((c) => c !== '')) rows.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) endCell();
      else if (ch === '\n') endRow();
      else if (ch !== '\r') cur += ch;
    }
    if (cur !== '' || row.length) endRow();
    return rows;
  }

  function cleanName(name) {
    let n = String(name || '').replace(/\s+/g, ' ').trim();
    const flipped = n.match(/^([^,]+),\s*([^,]+)$/); // "Griffin, Konnor" -> "Konnor Griffin"
    if (flipped) n = flipped[2] + ' ' + flipped[1];
    return n;
  }

  const toRank = (v) => {
    const n = parseInt(String(v || '').replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const toYear = (v) => { const m = /(19|20)\d{2}/.exec(String(v || '')); return m ? +m[0] : null; };

  // Columns kept as plain text when present (used by the summary builder).
  const EXTRA = {
    age: /^age$/, level: /^(current level|level|lvl)$/, eta: /^eta$/, risk: /^risk$/, trend: /^trend$/,
    signMkt: /^sign mkt$/, signOrg: /^sign org$/, bonus: /^bonus$/, signedFrom: /^signed from$/,
    signed: /^signed$/, bats: /^b$/, throws: /^t$/, ht: /^ht$/, wt: /^wt$/,
  };

  function parseTable(text, delim) {
    const table = readTable(text, delim);
    if (!table.length) return null;
    const header = table[0].map((h) => h.replace(/^\uFEFF/, '').toLowerCase().trim());
    const col = {};
    for (const key of Object.keys(COLS)) col[key] = header.findIndex((h) => COLS[key].test(h));
    if (col.name < 0) return null;
    const extra = Object.keys(EXTRA).map((key) => [key, header.findIndex((h) => EXTRA[key].test(h))]).filter((e) => e[1] >= 0);
    const players = [];
    for (const cells of table.slice(1)) {
      const name = cleanName(cells[col.name]);
      if (!name) continue;
      const rank = col.rank >= 0 ? toRank(cells[col.rank]) : players.length + 1;
      const orgRank = col.orgRank >= 0 ? toRank(cells[col.orgRank]) : null;
      const fv = col.fv >= 0 ? cells[col.fv] || '' : '';
      if (rank == null && orgRank == null && !fv) continue; // listed but ungraded and unranked
      const player = {
        rank,
        name,
        team: col.team >= 0 ? cells[col.team] || '' : '',
        pos: col.pos >= 0 ? cells[col.pos] || '' : '',
        orgRank,
        fv,
        id: col.id >= 0 ? cells[col.id] || '' : '',
        signYr: col.signYr >= 0 ? toYear(cells[col.signYr]) : null,
      };
      if (extra.length) {
        player.extra = {};
        for (const [key, i] of extra) if (cells[i]) player.extra[key] = cells[i];
      }
      players.push(player);
    }
    return players;
  }

  function parseLine(line, fallbackRank) {
    let rest = line.trim();
    let rank = null;
    const m = rest.match(/^#?(\d{1,4})\s*[.):\-–]?\s+(.*)$/);
    if (m) { rank = parseInt(m[1], 10); rest = m[2]; }
    const parts = rest.split(/\t|\s*[,|]\s*|\s+[-–—]\s+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const words = parts[0].split(' ');
    const extras = parts.slice(1);
    // "Konnor Griffin SS PIT": peel position / team codes off the end of the name.
    while (words.length > 2 && (isPos(words[words.length - 1]) || isTeam(words[words.length - 1]))) {
      extras.unshift(words.pop());
    }
    const name = cleanName(words.join(' '));
    if (!/[a-z]/i.test(name) || name.split(' ').length < 2) return null;
    let team = '', pos = '';
    for (const e of extras) {
      if (!pos && isPos(e)) pos = e;
      else if (!team && /[a-z]/i.test(e) && e.length <= 30) team = e;
    }
    return { rank: rank != null ? rank : fallbackRank, name, team, pos, orgRank: null, fv: '', id: '', signYr: null };
  }

  function parseList(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
    if (!lines.length) return [];
    for (const delim of ['\t', ',']) {
      if (!lines[0].includes(delim)) continue;
      const players = parseTable(String(text), delim);
      if (players) return finish(players);
    }
    const players = [];
    for (const line of lines) {
      const p = parseLine(line, players.length + 1);
      if (p) players.push(p);
    }
    return finish(players);
  }

  function finish(players) {
    const key = (x) => (x.rank != null ? x.rank : 1000 + (x.orgRank || 999));
    return players.sort((a, b) => key(a) - key(b));
  }

  const api = { parseList };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProspectParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
