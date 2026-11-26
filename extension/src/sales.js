// Reads sold eBay listings off the page and turns them into sale records.
// Pure functions here (used by the content script, the extension pages and the tests);
// the content script does the DOM and storage work.
(function (root) {
  const Cards = root.ProspectCards || (typeof require !== 'undefined' ? require('./cards.js') : null);
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // "Nov 20, 2026", "20 Nov 2026", or "Wed, Nov 19" (no year: the latest such date not after today).
  function parseDate(text, today) {
    const t = String(text || '');
    let m = /\b([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(t);
    if (m && MONTHS[m[1].toLowerCase()] != null) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    m = /\b(\d{1,2})\s+([A-Z][a-z]{2})[a-z]*\.?,?\s+(\d{4})\b/.exec(t);
    if (m && MONTHS[m[2].toLowerCase()] != null) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    m = /\b([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2})\b/.exec(t);
    if (m && MONTHS[m[1].toLowerCase()] != null) {
      const now = today || new Date();
      let y = now.getFullYear();
      if (new Date(y, MONTHS[m[1].toLowerCase()], +m[2]) > now) y -= 1;
      return iso(y, MONTHS[m[1].toLowerCase()], +m[2]);
    }
    return '';
  }

  // "$1,234.56" -> { currency: '$', amount: 1234.56 }; a range ("$5.00 to $20.00") is not one sale.
  function parsePrice(text) {
    const t = String(text || '').replace(/\s+/g, ' ');
    if (/\d\s*to\s*\D{0,4}\d/i.test(t)) return null;
    const m = /((?:US|C|AU|GBP|EUR)?\s?[$£€]|GBP|EUR)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/.exec(t);
    if (!m) return null;
    const cur = m[1].replace(/\s/g, '');
    return { currency: cur === 'US$' ? '$' : cur, amount: Number(m[2].replace(/,/g, '')) };
  }

  // The text of one search-result card. Returns null unless the card says it sold.
  function parseCard(text, today) {
    const t = String(text || '').replace(/\s+/g, ' ');
    const sold = /\bSold\s+((?:[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4})|(?:\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}))/.exec(t);
    if (!sold) return null;
    // The sale price is the first price after the title area; skip a struck "was" price on Best Offer sales.
    const rest = t.slice(sold.index + sold[0].length);
    const priceText = (/((?:US|C|AU)?\s?[$£€]\s?[\d,]+(?:\.\d{2})?(?:\s*to\s*(?:US|C|AU)?\s?[$£€]\s?[\d,]+(?:\.\d{2})?)?)/.exec(rest) || [])[1] || '';
    const price = parsePrice(priceText);
    if (!price) return null;
    const ship = /\+\s?((?:US|C|AU)?\s?[$£€]\s?[\d,]+(?:\.\d{2})?)\s*(?:shipping|delivery|postage)/i.exec(rest);
    const bids = /\b(\d+)\s+bids?\b/i.exec(rest);
    const format = /best offer accepted/i.test(t) ? 'Best Offer' : bids ? 'Auction' : /buy it now/i.test(t) ? 'Buy It Now' : '';
    return {
      soldDate: parseDate(sold[1], today),
      price: price.amount,
      currency: price.currency,
      shipping: ship ? parsePrice(ship[1]).amount : /free (?:shipping|delivery|postage)/i.test(rest) ? 0 : null,
      bids: bids ? +bids[1] : null,
      format,
    };
  }

  // The text of an item page. Returns null unless the page says the item sold.
  function parseItemPage(text, priceText, today) {
    const t = String(text || '').replace(/\s+/g, ' ');
    const when = /This (?:listing|item) sold on ([^.]+?)(?:\.|$| at )/i.exec(t);
    if (!when) return null;
    const price = parsePrice(priceText) || parsePrice((/(?:Sold for|Winning bid|Price)\s*:?\s*([^A-Za-z]{0,6}[\d,]+(?:\.\d{2})?)/i.exec(t) || [])[1]);
    if (!price) return null;
    const bids = /\b(\d+)\s+bids?\b/i.exec(t);
    return {
      soldDate: parseDate(when[1], today),
      price: price.amount,
      currency: price.currency,
      shipping: null,
      bids: bids ? +bids[1] : null,
      format: /best offer accepted/i.test(t) ? 'Best Offer' : bids ? 'Auction' : '',
    };
  }

  // "https://www.ebay.com/itm/1234567890?..." -> "1234567890"
  function itemId(url) {
    const m = /\/itm\/(?:[^/?#]*\/)?(\d{9,})/.exec(String(url || ''));
    return m ? m[1] : '';
  }

  // A sale record for one ranked player named in a sold listing. A dual-player card gives one per player.
  function record(sale, { id, url, title, page, image }, player, now) {
    const m = player.mlb || {}, f = player.fg || {};
    return {
      key: `${id}|${player.name}`,
      item_id: id,
      sold_date: sale.soldDate,
      price: sale.price,
      currency: sale.currency,
      shipping: sale.shipping,
      format: sale.format,
      // eBay hides the accepted amount on a Best Offer sale and shows the asking price.
      note: sale.format === 'Best Offer' ? 'asking price; accepted offer not shown' : '',
      bids: sale.bids,
      player: player.name,
      team: player.team || '',
      pos: player.pos || '',
      mlb_rank: m.rank ?? null,
      mlb_org_rank: m.orgRank ?? null,
      fg_fv: f.fv || '',
      fg_rank: f.rank ?? null,
      fg_org_rank: f.orgRank ?? null,
      title,
      url: `https://www.ebay.com/itm/${id}`,
      source_url: url,
      image_url: image || '',
      page,
      saved_at: new Date(now || Date.now()).toISOString(),
    };
  }

  // The player's rankings on the sale date (src/asof.js), filled in when exporting.
  const AT_SALE_COLUMNS = ['fg_list_at_sale', 'fg_fv_at_sale', 'fg_rank_at_sale', 'fg_org_rank_at_sale',
    'mlb_list_at_sale', 'mlb_rank_at_sale', 'mlb_org_rank_at_sale'];
  const CARD_COLUMNS = ['year', 'product', 'first_bowman', 'auto', 'variant', 'numbered_to', 'serial', 'graded', 'grader', 'grade', 'auto_grade', 'noise'];
  const Photos = () => root.ProspectPhotos || (typeof require !== 'undefined' ? require('./photos.js') : null);
  const PHOTO_COLUMNS = ['photo_read', 'photo_picture', 'photo_slabbed', 'photo_grader', 'photo_grade', 'photo_auto_grade', 'photo_cert',
    'photo_label', 'photo_parallel', 'photo_serial', 'photo_autograph', 'photo_confidence', 'photo_notes'];
  const COLUMNS = ['sold_date', 'player', 'team', 'pos', 'price', 'currency', 'shipping', 'format', 'note', 'bids',
    ...CARD_COLUMNS, 'card_source', 'photo_mismatch', ...AT_SALE_COLUMNS, 'fg_fv_when_saved', 'fg_rank_when_saved', 'fg_org_rank_when_saved', 'mlb_rank_when_saved',
    'mlb_org_rank_when_saved', ...PHOTO_COLUMNS, 'title', 'url', 'image_url', 'item_id', 'saved_at'];

  // The card fields, read from the title now rather than when saved, so a better reading reaches old rows too.
  // photo (optional): a photo reading for this listing (photos.js), combined with the title's reading.
  function withCard(r, photo) {
    const P = Photos();
    const fromTitle = Cards.parseTitle(r.title, r.player);
    const c = P ? P.combine(fromTitle, photo) : Object.assign({}, fromTitle, { card_source: 'title', photo_mismatch: '' });
    if (P) Object.assign(c, P.columns(photo));
    return Object.assign({}, r, c, { first_bowman: c.first_bowman ? 'yes' : 'no', auto: c.auto ? 'yes' : 'no', graded: c.graded ? 'yes' : 'no',
      // The ranks shown when the listing was saved, which may be after the sale.
      fg_fv_when_saved: r.fg_fv, fg_rank_when_saved: r.fg_rank, fg_org_rank_when_saved: r.fg_org_rank,
      mlb_rank_when_saved: r.mlb_rank, mlb_org_rank_when_saved: r.mlb_org_rank });
  }

  // ctx (optional): { history, mlbSnaps, overrides } for the rankings on each sale date.
  function toCsv(records, ctx) {
    const AsOf = root.ProspectAsOf || (typeof require !== 'undefined' ? require('./asof.js') : null);
    const cell = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const photos = (ctx && ctx.photoReads) || {};
    const rows = records.map((r) => Object.assign(withCard(r, photos[r.item_id]), ctx ? AsOf.atSale(r, ctx) : {})).sort((a, b) => (b.sold_date || '').localeCompare(a.sold_date || '') || a.player.localeCompare(b.player));
    return [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
  }

  // Count, median and latest sale for one player's records. Best Offer sales show only
  // the asking price, so they are counted but left out of the prices.
  function summarize(records) {
    if (!records.length) return null;
    const priced = records.filter((r) => r.format !== 'Best Offer');
    const prices = priced.map((r) => r.price).sort((a, b) => a - b);
    if (!prices.length) return { count: records.length, priced: 0, median: null, low: null, high: null, last: null };
    const mid = (prices[Math.floor((prices.length - 1) / 2)] + prices[Math.ceil((prices.length - 1) / 2)]) / 2;
    const last = [...priced].sort((a, b) => (b.sold_date || '').localeCompare(a.sold_date || ''))[0];
    return { count: records.length, priced: prices.length, median: mid, low: prices[0], high: prices[prices.length - 1], last };
  }

  const api = { parseDate, parsePrice, parseCard, parseItemPage, itemId, record, toCsv, summarize, withCard, COLUMNS, AT_SALE_COLUMNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProspectSales = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
