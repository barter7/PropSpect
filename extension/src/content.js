// Adds a rank badge in front of eBay listing titles that name a ranked player.
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

  function scan() {
    for (const el of titleElements()) {
      const text = titleText(el);
      const stamp = enabled ? text : '';
      if (el.dataset.prkText === stamp) continue;
      el.querySelectorAll(`:scope > .${BADGE}`).forEach((b) => b.remove());
      el.dataset.prkText = stamp;
      if (!enabled || !list) continue;
      const players = ProspectMatch.findPlayers(text, index);
      for (const p of players.reverse()) el.prepend(makeBadge(p));
    }
  }

  function reset() {
    document.querySelectorAll(`.${BADGE}`).forEach((b) => b.remove());
    document.querySelectorAll('[data-prk-text]').forEach((el) => delete el.dataset.prkText);
    scan();
  }

  function load() {
    chrome.storage.local.get(['mlb', 'fg', 'history', 'enabled'], (data) => {
      history = data.history || null;
      historyIndex = ProspectHistory.indexHistory(history);
      const players = ProspectMatch.combine(data.mlb, data.fg);
      list = players.length ? players : null;
      enabled = data.enabled !== false;
      index = ProspectMatch.buildIndex(players);
      const day = (l) => new Date(l.updatedAt).toLocaleDateString();
      updatedNote = [data.mlb && `MLB updated ${day(data.mlb)}`, data.fg && `FanGraphs ${data.fg.label || 'list'} loaded ${day(data.fg)}`]
        .filter(Boolean).join(', ');
      reset();
    });
  }

  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener(load);
  load();
})();
