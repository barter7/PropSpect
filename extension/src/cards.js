// Reads a trading-card listing title into fields: year, product, 1st Bowman,
// autograph, variant (parallel), serial numbering, grade, and whether the
// listing is a lot, break or sealed product rather than one card.
// Pure functions, used by the extension pages, the content script and the tests.
(function (root) {
  // Longest names first, so "Bowman Chrome Sapphire" wins over "Bowman Chrome" and "Bowman".
  const PRODUCTS = [
    ['bowman chrome sapphire', 'Bowman Chrome Sapphire'], ['bowman draft sapphire', 'Bowman Draft Sapphire'],
    ['bowman chrome draft', 'Bowman Draft Chrome'], ['bowman draft chrome', 'Bowman Draft Chrome'],
    ['bowman chrome mega', 'Bowman Chrome Mega Box'], ['bowman mega', 'Bowman Mega Box'],
    ["bowman s best", "Bowman's Best"], ['bowmans best', "Bowman's Best"], ['bowman best', "Bowman's Best"],
    ['bowman sterling', 'Bowman Sterling'], ['bowman platinum', 'Bowman Platinum'], ['bowman inception', 'Bowman Inception'],
    ['bowman draft', 'Bowman Draft'], ['bowman chrome', 'Bowman Chrome'], ['bowman', 'Bowman'],
    ['topps chrome update', 'Topps Chrome Update'], ['topps chrome', 'Topps Chrome'], ['topps update', 'Topps Update'],
    ['topps heritage', 'Topps Heritage'], ['topps finest', 'Topps Finest'], ['topps', 'Topps'],
    ['panini prizm', 'Panini Prizm'], ['panini', 'Panini'], ['leaf', 'Leaf'],
  ];
  // Words that name a parallel. Colours first, then finishes; a variant is the
  // colours and finishes found, in that order ("Gold Shimmer", "Blue Wave").
  const COLOURS = ['rose gold', 'sky blue', 'gold', 'orange', 'red', 'blue', 'green', 'purple', 'yellow', 'black', 'aqua',
    'pink', 'fuchsia', 'teal', 'silver', 'bronze', 'white', 'magenta', 'lime'];
  const FINISHES = ['superfractor', 'printing plate', 'x-fractor', 'xfractor', 'raywave', 'wave', 'shimmer', 'mojo', 'speckle',
    'atomic', 'lava', 'lunar', 'sapphire', 'mini diamond', 'reptilian', 'geometric', 'cracked ice', 'sparkle', 'prism',
    'logofractor', 'image variation', 'refractor'];
  // Team names hold colour words ("Red Sox"), so they are blanked out first.
  const TEAMS = /\b(red sox|white sox|blue jays|reds|athletics)\b/g;

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’']/g, ' ').replace(/[^a-z0-9#/.\-+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const has = (t, word) => new RegExp(`(^|[^a-z])${word.replace(/[-/]/g, '[-/ ]?')}([^a-z]|$)`).test(t);
  const title = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/X-?fractor/i, 'X-Fractor');

  // The grading company and grade: "PSA 10", "PSA GEM MT 10", "BGS 9.5/10" (card 9.5, autograph 10),
  // "BGS Black Label 10", "SGC 9.5", "CGC Pristine 10", "TAG 9". Beckett is BGS (BVG is Beckett's vintage line).
  const GRADERS = { psa: 'PSA', bgs: 'BGS', beckett: 'BGS', bvg: 'BGS', sgc: 'SGC', cgc: 'CGC', csg: 'CGC', tag: 'TAG', hga: 'HGA', isa: 'ISA', gma: 'GMA' };
  function readGrade(t) {
    const m = new RegExp('\\b(' + Object.keys(GRADERS).join('|') + ')\\s*(?:(?:gem\\s*(?:mint|mt)|gem|mint|mt|pristine|perfect|black\\s*label|pristine\\s*black\\s*label)\\s*)*' +
      '(10|[1-9](?:\\.5)?)(?:\\s*\\/\\s*(10|[1-9](?:\\.5)?)|\\s*(?:auto|au|autograph)\\s*(10|[1-9](?:\\.5)?))?(?![0-9])').exec(t);
    if (!m) return null;
    const label = /black\s*label/.test(m[0]) ? ' Black Label' : /pristine/.test(m[0]) && m[1] !== 'psa' ? ' Pristine' : '';
    return { text: m[0], grader: GRADERS[m[1]], grade: m[2] + label, autoGrade: m[3] || m[4] || '' };
  }

  // Why a listing is not one card, or '' when it is.
  function noise(t) {
    if (/\b(lot|lots|bundle)\b|\bx\s?\d+\b|\b\d+\s?x\b|\(\d+\)\s*card|\b\d+\s*cards?\b/.test(t)) return 'lot';
    if (/\b(break|breaks|random|pick your|you pick|pyt|spot|slot)\b/.test(t)) return 'break';
    if (/\b(hobby box|jumbo box|blaster|hanger|mega box sealed|sealed|factory set|pack|packs|case)\b/.test(t) && !/\bnot? sealed\b/.test(t)) return 'sealed';
    if (/\b(reprint|custom|novelty|facsimile|digital|replica|rp)\b/.test(t)) return 'not genuine';
    return '';
  }

  // parseTitle("2024 Bowman Chrome 1st Jesus Made Gold Refractor Auto /50 PSA 10", "Jesús Made")
  function parseTitle(raw, playerName) {
    let t = norm(raw);
    // Take the player's name out so a surname such as "Green" or "Gold" is not read as a colour.
    for (const part of norm(playerName).split(' ').filter((w) => w.length > 2)) t = t.replace(new RegExp(`\\b${part}\\b`, 'g'), ' ');
    const graded = readGrade(t);
    if (graded) t = t.replace(graded.text, ' ');
    const year = (/\b(19[5-9]\d|20[0-4]\d)\b/.exec(t) || [])[1] || '';
    const words = t.replace(TEAMS, ' ');
    let product = '';
    for (const [k, name] of PRODUCTS) if (has(words, k)) { product = name; break; }

    // Serial numbering: "/50", "#/50", "12/50", "#12/50", "1/1". Grades ("9.5/10") and full dates ("11/20/25") are skipped.
    let numberedTo = null, serial = null;
    const serialRe = /(^|[^0-9./])(?:#\s*)?(\d{1,4})?\s*\/\s*(\d{1,4})(?![0-9.]|\s*\/)/g;
    for (let m; (m = serialRe.exec(t));) {
      const of = +m[3], n = m[2] ? +m[2] : null;
      if (!of || of > 5000 || (of >= 1900 && of <= 2099) || (n != null && n > of)) continue; // a year is not a serial
      if (n == null && /\s\/\s/.test(m[0])) continue; // a slash between two names, not numbering
      numberedTo = of; serial = n; break;
    }
    if (numberedTo == null && /\bone of one\b|\b1 of 1\b/.test(t)) { numberedTo = 1; serial = 1; }

    const notAuto = /\b(non|no|not)[- ]?auto/.test(t);
    const auto = !notAuto && /\b(auto|autos|autograph|autographs|autographed|signed|signature|cpa|bcpa|bpa|bdpa|on card ink)\b/.test(t);
    const firstBowman = /\b1st\b(?!\s*(round|rd|overall|pick|year|team|edition))|\bfirst bowman\b/.test(t) && /\bbowman\b|\bbcp\b|\bbdc\b|\bcpa\b/.test(t);

    const found = [];
    for (const c of COLOURS) if (has(words, c) && !found.some((f) => f.includes(c))) found.push(c);
    const finishes = [];
    for (const f of FINISHES) if (has(words, f) && !finishes.some((x) => x.includes(f)) && !(f === 'sapphire' && /sapphire/.test(product.toLowerCase()))) finishes.push(f);
    // "Refractor" adds nothing once a colour or another finish is named ("Gold Refractor" is the Gold parallel).
    const fin = finishes.filter((f) => !(f === 'refractor' && (found.length || finishes.length > 1)));
    let variant = title([...found, ...fin].join(' '));
    if (/superfractor/i.test(variant)) variant = 'Superfractor';
    if (!variant) variant = numberedTo != null ? 'Numbered' : 'Base';

    return {
      year,
      product,
      first_bowman: firstBowman,
      auto,
      variant,
      numbered_to: numberedTo,
      serial,
      graded: !!graded,
      grader: graded ? graded.grader : '',
      grade: graded ? graded.grade : '',
      auto_grade: graded ? graded.autoGrade : '',
      noise: noise(t),
    };
  }

  // "1st Bowman Auto · Gold /50 · PSA 10"
  function describeCard(c) {
    const kind = [c.first_bowman ? '1st Bowman' : '', c.auto ? 'Auto' : ''].filter(Boolean).join(' ') || 'Non-auto';
    return [kind, c.variant + (c.numbered_to ? ` /${c.numbered_to}` : ''), c.grader ? `${c.grader} ${c.grade}${c.auto_grade ? ` (auto ${c.auto_grade})` : ''}` : 'Raw',
      c.noise ? `(${c.noise})` : ''].filter(Boolean).join(' · ');
  }

  const api = { parseTitle, describeCard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProspectCards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
