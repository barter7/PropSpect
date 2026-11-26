// Adds a rank badge in front of eBay listing titles that name a ranked player, and saves
// sold listings of ranked players (eBay's Sold results, or a sold item's page) with their ranks.
(function () {
  const TITLE_SELECTOR = [
    'h1.x-item-title__mainTitle',
    '.x-item-title h1',
    '.s-item__title',
    '.s-card__title',
    '[data-testid="item-title"]',
  ].join(',');
  const BADGE = 'prk-badge';

  let index = new Map();
  let list = null; // combined players, or null when no rankings are saved
  let updatedNote = '';
  let history = null;
  let historyIndex = new Map();
  let enabled = true;
  let saveSales = true;
  let salesByPlayer = new Map(); // "name|team" -> saved sale records, for the hover card

  function titleElements() {
    const els = new Set(document.querySelectorAll(TITLE_SELECTOR));
    // Fallback for layouts whose class names changed: any text link to a listing.
    for (const a of document.querySelectorAll('a[href*="/itm/"]')) {
      if (a.querySelector(TITLE_SELECTOR) || a.closest(TITLE_SELECTOR)) continue;
      if (titleText(a).length >= 12) els.add(a);
    }
    // Keep only the innermost candidates so a title is badged once.
    return [...els].filter((el) => ![...els].some((other) => other !== el && el.contains(other)));
  }

  function titleText(el) {
    let text = '';
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue;
        else if (child.nodeType === Node.ELEMENT_NODE && !child.classList.contains(BADGE)) walk(child);
      }
    };
    walk(el);
    return text.replace(/\s+/g, ' ').trim();
  }

  function makeBadge(p) {
    const badge = document.createElement('span');
    badge.className = `${BADGE} prk-t${ProspectMatch.tier(p)}`;
    badge.textContent = ProspectMatch.badgeText(p);
    badge.addEventListener('mouseenter', () => showCard(badge, p));
    badge.addEventListener('mouseleave', hideCardSoon);
    return badge;
  }

  // The hover card: both sources' ranks, then the player's history chart when there is one.
  let card = null;
  let hideTimer = null;
  function hideCardSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (card) { card.remove(); card = null; } }, 180);
  }
  function showCard(badge, p) {
    clearTimeout(hideTimer);
    if (card) card.remove();
    card = document.createElement('div');
    card.className = 'prk-card';
    const [head, ...lines] = ProspectMatch.describe(p).split('\n');
    const h = document.createElement('div');
    h.className = 'prk-card-name';
    h.textContent = head;
    card.appendChild(h);
    for (const line of lines) {
      const d = document.createElement('div');
      d.className = 'prk-card-line';
      d.textContent = line;
      card.appendChild(d);
    }
    const sum = ProspectSales.summarize(salesByPlayer.get(saleKey(p)) || []);
    if (sum) {
      const d = document.createElement('div');
      d.className = 'prk-card-line prk-card-sales';
      const money = (v) => '$' + (Math.round(v * 100) / 100).toLocaleString();
      d.textContent = `Sold prices saved: ${sum.count}` + (sum.median != null
        ? ` · median ${money(sum.median)} · last ${money(sum.last.price)}${sum.last.sold_date ? ' on ' + sum.last.sold_date : ''}`
        : ' (Best Offer only, prices hidden)');
      card.appendChild(d);
    }
    const hist = ProspectHistory.lookup(historyIndex, p);
    if (hist) card.appendChild(ProspectChart.render(document, history, hist));
    const note = document.createElement('div');
    note.className = 'prk-card-foot';
    note.textContent = updatedNote.trim() + (hist ? '' : history ? ' · No history for this player' : '');
    card.appendChild(note);
    card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    card.addEventListener('mouseleave', hideCardSoon);
    card.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    document.body.appendChild(card);
    const r = badge.getBoundingClientRect();
    const w = card.offsetWidth, hgt = card.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const below = r.bottom + 6 + hgt <= window.innerHeight || r.top < hgt + 6;
    card.style.left = left + 'px';
    card.style.top = (below ? r.bottom + 6 : r.top - hgt - 6) + 'px';
  }

  const saleKey = (p) => `${ProspectMatch.nameTokens(p.name).join(' ')}|${p.team || ''}`;

  // Sold listings: the card (search results) or page (item page) around a title, if it says the item sold.
  function soldListing(el) {
    const link = el.closest('a[href*="/itm/"]') || el.querySelector('a[href*="/itm/"]') ||
      (el.closest('li, .s-item, .s-card') || el).querySelector('a[href*="/itm/"]');
    const isItemPage = el.matches('h1, h1 *') || !!el.closest('.x-item-title');
    if (isItemPage) {
      const id = ProspectSales.itemId(location.href);
      const priceEl = document.querySelector('.x-price-primary, [itemprop="price"], .x-bin-price, #prcIsum, #mm-saleDscPrc');
      const sale = id && ProspectSales.parseItemPage(document.body.innerText, priceEl ? priceEl.textContent : '');
      const img = document.querySelector('.ux-image-carousel-item.active img, .ux-image-carousel-item img, #icImg, img[src*="i.ebayimg.com"]');
      return sale ? { sale, id, url: location.href, page: 'item', image: imageUrl(img) } : null;
    }
    const cardEl = el.closest('li.s-item, li.s-card, .s-item, .s-card, li') || el.parentElement;
    const id = link && ProspectSales.itemId(link.href);
    if (!cardEl || !id || /^12345678/.test(id)) return null; // eBay's placeholder card
    const sale = ProspectSales.parseCard(cardEl.innerText || cardEl.textContent);
    return sale ? { sale, id, url: link.href, page: 'search', image: imageUrl(cardEl.querySelector('img')) } : null;
  }

  // The listing photo's address, asked for at eBay's largest size (lazy images keep it in data-src or srcset).
  function imageUrl(img) {
    if (!img) return '';
    const cands = [img.getAttribute('src'), img.getAttribute('data-src'), (img.getAttribute('srcset') || '').split(/\s+/)[0]];
    for (const c of cands) { const u = ProspectPhotos.largeImageUrl(c); if (u) return u; }
    return '';
  }

  // A small note in the corner of a Sold page that says what this tab has saved, so you know when it is done.
  const isSoldPage = /[?&](LH_Sold|LH_Complete)=1/.test(location.search);
  const pageKeys = new Set();
  let pageNew = 0;
  let toast = null;
  let lookTimer = null;
  function setToast(text, state) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'prk-toast';
      toast.setAttribute('role', 'status');
      toast.title = 'Prospect Rank. Click to hide.';
      toast.addEventListener('click', () => { toast.hidden = true; });
      document.body.appendChild(toast);
    }
    toast.dataset.state = state;
    toast.textContent = text;
  }
  function showLooking() {
    if (!isSoldPage || !saveSales || !list || pageKeys.size) return;
    setToast('Prospect Rank: reading sold listings…', 'busy');
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => {
      if (!pageKeys.size && !pending.size) setToast('Prospect Rank: no sold listings of ranked players on this page.', 'none');
    }, 2500);
  }
  function showSaved() {
    const listings = new Set([...pageKeys].map((k) => k.split('|')[0])).size;
    setToast(`Prospect Rank: ✓ saved ${listings} sold listing${listings === 1 ? '' : 's'} from this page` +
      ` (${pageNew} new). Safe to move on.`, 'done');
  }

  const pending = new Map();
  let flushTimer = null;
  function queueSales(el, title, players) {
    if (!saveSales || !players.length) return;
    let found;
    try { found = soldListing(el); } catch (e) { return; }
    if (!found) return;
    for (const p of players) {
      const r = ProspectSales.record(found.sale, { id: found.id, url: found.url, title, page: found.page, image: found.image }, p);
      pending.set(r.key, r);
    }
    if (toast && toast.dataset.state !== 'done') setToast('Prospect Rank: saving sold listings…', 'busy');
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushSales, 800);
  }
  function flushSales() {
    if (!pending.size) return;
    const batch = [...pending.values()];
    pending.clear();
    chrome.storage.local.get('sales', ({ sales }) => {
      const all = sales || {};
      for (const r of batch) {
        const old = all[r.key];
        if (!old && !pageKeys.has(r.key)) pageNew++;
        pageKeys.add(r.key);
        // Keep when it was first saved; take the newer reading of everything else.
        all[r.key] = old ? Object.assign({}, old, r, { saved_at: old.saved_at }) : r;
      }
      chrome.storage.local.set({ sales: all }, () => {
        if (chrome.runtime.lastError) setToast('Prospect Rank: could not save sold listings (' + chrome.runtime.lastError.message + ').', 'none');
        else showSaved();
      });
    });
  }

  function indexSales(sales) {
    salesByPlayer = new Map();
    for (const r of Object.values(sales || {})) {
      const k = `${ProspectMatch.nameTokens(r.player).join(' ')}|${r.team || ''}`;
      if (!salesByPlayer.has(k)) salesByPlayer.set(k, []);
      salesByPlayer.get(k).push(r);
    }
  }

  function scan() {
    for (const el of titleElements()) {
      const text = titleText(el);
      const stamp = enabled ? text : '';
      if (el.dataset.prkText === stamp) continue;
      el.querySelectorAll(`:scope > .${BADGE}`).forEach((b) => b.remove());
      el.dataset.prkText = stamp;
      if (!enabled || !list) continue;
      const players = ProspectMatch.findPlayers(text, index);
      queueSales(el, text, players);
      for (const p of [...players].reverse()) el.prepend(makeBadge(p));
    }
  }

  function reset() {
    document.querySelectorAll(`.${BADGE}`).forEach((b) => b.remove());
    document.querySelectorAll('[data-prk-text]').forEach((el) => delete el.dataset.prkText);
    scan();
  }

  function load() {
    chrome.storage.local.get(['mlb', 'fg', 'history', 'enabled', 'saveSales', 'sales'], (data) => {
      saveSales = data.saveSales !== false;
      indexSales(data.sales);
      history = data.history || null;
      historyIndex = ProspectHistory.indexHistory(history);
      const players = ProspectMatch.combine(data.mlb, data.fg);
      list = players.length ? players : null;
      enabled = data.enabled !== false;
      index = ProspectMatch.buildIndex(players);
      if (!saveSales && toast) toast.hidden = true;
      const day = (l) => new Date(l.updatedAt).toLocaleDateString();
      updatedNote = [data.mlb && `MLB updated ${day(data.mlb)}`, data.fg && `FanGraphs ${data.fg.label || 'list'} loaded ${day(data.fg)}`]
        .filter(Boolean).join(', ');
      reset();
      showLooking();
    });
  }

  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes) => {
    // A new sale only refreshes the hover card's numbers; anything else redraws the badges.
    const keys = Object.keys(changes);
    if (keys.length === 1 && keys[0] === 'sales') indexSales(changes.sales.newValue);
    else load();
  });
  load();
})();
