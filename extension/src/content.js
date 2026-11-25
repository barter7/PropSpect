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
    badge.title = ProspectMatch.describe(p) + updatedNote;
    return badge;
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
    chrome.storage.local.get(['mlb', 'fg', 'enabled'], (data) => {
      const players = ProspectMatch.combine(data.mlb, data.fg);
      list = players.length ? players : null;
      enabled = data.enabled !== false;
      index = ProspectMatch.buildIndex(players);
      const day = (l) => new Date(l.updatedAt).toLocaleDateString();
      updatedNote = '\n' + [data.mlb && `MLB updated ${day(data.mlb)}`, data.fg && `FanGraphs imported ${day(data.fg)}`]
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
