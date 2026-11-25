// Draws a player's timeline: three stacked rows (Future Value, club rank,
// Top 100 rank) on one shared time axis that starts at the year he signed.
// Colours come from CSS variables on the container (--prk-series, --prk-grid,
// --prk-text, --prk-muted, --prk-surface).
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 344, LEFT = 62, RIGHT = 24, ROW_H = 44, ROW_GAP = 10, TOP = 6, AXIS_H = 30;

  function el(doc, tag, attrs, text) {
    const node = doc.createElementNS(NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (text != null) node.textContent = text;
    return node;
  }

  // "45+" sits half a grade above 45.
  const fvValue = (fv) => { const n = parseInt(fv, 10); return n ? n + (/\+/.test(fv) ? 2.5 : 0) : null; };

  // history: { snapshots }, player: { signYr, pts }. Returns a <div> holding the chart and a readout line.
  function render(doc, history, player) {
    const wrap = doc.createElement('div');
    wrap.className = 'prk-chart';
    const first = player.pts[0][0], last = player.pts[player.pts.length - 1][0];
    const snaps = history.snapshots.slice(first, last + 1);
    const byIdx = new Map(player.pts.map((pt) => [pt[0], pt]));
    const signed = player.signYr && player.signYr <= snaps[0].year ? player.signYr : null;
    const slots = (signed ? 1 : 0) + snaps.length;
    const step = slots > 1 ? (W - LEFT - RIGHT) / (slots - 1) : 0;
    const x = (i) => (slots > 1 ? LEFT + (i + (signed ? 1 : 0)) * step : (LEFT + W - RIGHT) / 2);

    const rows = [
      { title: 'Future Value', get: (pt) => fvValue(pt[1]), show: (pt) => pt[1], better: 'high', none: 'No FV listed' },
      { title: 'Club rank', get: (pt) => pt[2], show: (pt) => '#' + pt[2], better: 'low', none: 'No club rank listed' },
      { title: 'Top 100', get: (pt) => pt[3], show: (pt) => '#' + pt[3], better: 'low', none: 'Never in the Top 100' },
    ];
    const H = TOP + rows.length * (ROW_H + ROW_GAP) + AXIS_H;
    const svg = el(doc, 'svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    const readout = doc.createElement('div');
    readout.className = 'prk-readout';

    rows.forEach((row, r) => {
      const top = TOP + r * (ROW_H + ROW_GAP);
      const lines = row.title.split(' ');
      lines.forEach((word, i) => svg.appendChild(
        el(doc, 'text', { x: 0, y: top + ROW_H / 2 + 4 + (i - (lines.length - 1) / 2) * 12, class: 'prk-rowlabel' }, word)));
      svg.appendChild(el(doc, 'line', { x1: LEFT - 8, x2: W - 4, y1: top + ROW_H + ROW_GAP / 2, y2: top + ROW_H + ROW_GAP / 2, class: 'prk-grid' }));
      const vals = snaps.map((s, i) => { const pt = byIdx.get(first + i); const v = pt ? row.get(pt) : null; return v == null ? null : { i, v, pt }; });
      const present = vals.filter(Boolean);
      if (!present.length) {
        svg.appendChild(el(doc, 'text', { x: LEFT, y: top + ROW_H / 2 + 4, class: 'prk-none' }, row.none));
        return;
      }
      let lo = Math.min(...present.map((p) => p.v)), hi = Math.max(...present.map((p) => p.v));
      if (lo === hi) { lo -= 1; hi += 1; }
      const y = (v) => {
        const t = (v - lo) / (hi - lo); // 0 = lowest number
        const up = row.better === 'high' ? t : 1 - t; // better is always drawn higher
        return top + ROW_H - 9 - up * (ROW_H - 26);
      };
      // Line segments only between consecutive snapshots that both have a value.
      let d = '';
      vals.forEach((p, i) => { if (p) d += (i && vals[i - 1] ? 'L' : 'M') + x(p.i).toFixed(1) + ' ' + y(p.v).toFixed(1); });
      svg.appendChild(el(doc, 'path', { d, class: 'prk-line' }));
      present.forEach((p, n) => {
        svg.appendChild(el(doc, 'circle', { cx: x(p.i), cy: y(p.v), r: 4, class: 'prk-dot' }));
        // Label the first and last points and every change, not every point.
        const prev = present[n - 1];
        if (n === 0 || n === present.length - 1 || row.show(prev.pt) !== row.show(p.pt)) {
          const anchor = slots > 1 && p.i === snaps.length - 1 ? 'end' : slots > 1 && p.i === 0 && !signed ? 'start' : 'middle';
          const dx = anchor === 'end' ? 6 : anchor === 'start' ? -6 : 0;
          svg.appendChild(el(doc, 'text', { x: x(p.i) + dx, y: y(p.v) - 8, 'text-anchor': anchor, class: 'prk-value' }, row.show(p.pt)));
        }
      });
    });

    // Time axis: the signing year first, then each snapshot from his first appearance.
    const axisY = H - AXIS_H + 4;
    if (signed) {
      svg.appendChild(el(doc, 'line', { x1: LEFT, x2: x(0), y1: axisY, y2: axisY, class: 'prk-gap' }));
      svg.appendChild(el(doc, 'circle', { cx: LEFT, cy: axisY, r: 3.5, class: 'prk-signed' }));
      svg.appendChild(el(doc, 'text', { x: LEFT, y: axisY + 14, 'text-anchor': 'middle', class: 'prk-tick' }, String(signed)));
      svg.appendChild(el(doc, 'text', { x: LEFT, y: axisY + 25, 'text-anchor': 'middle', class: 'prk-tick prk-ticknote' }, 'Signed'));
    }
    if (snaps.length > 1) svg.appendChild(el(doc, 'line', { x1: x(0), x2: x(snaps.length - 1), y1: axisY, y2: axisY, class: 'prk-axis' }));
    const dense = snaps.length > 7;
    snaps.forEach((s, i) => {
      svg.appendChild(el(doc, 'line', { x1: x(i), x2: x(i), y1: axisY - 3, y2: axisY + 3, class: 'prk-axis' }));
      const firstOfYear = i === 0 || snaps[i - 1].year !== s.year;
      if (dense && !firstOfYear) return;
      const short = String(s.year) + (!dense && s.type === 'u' ? 'U' : '');
      svg.appendChild(el(doc, 'text', { x: x(i), y: axisY + 14, 'text-anchor': 'middle', class: 'prk-tick' }, short));
      if (i === 0) svg.appendChild(el(doc, 'text', { x: x(i), y: axisY + 25, 'text-anchor': 'middle', class: 'prk-tick prk-ticknote' }, 'First listed'));
    });

    // Hover: a guide line and a one-line readout for the snapshot under the pointer.
    const guide = el(doc, 'line', { y1: TOP, y2: axisY, class: 'prk-guide', visibility: 'hidden' });
    svg.appendChild(guide);
    const describe = (i) => {
      const pt = byIdx.get(first + i);
      const label = root.ProspectHistory.snapshotLabel(snaps[i]);
      if (!pt) return `${label}: not listed`;
      return `${label}: ${pt[1] ? pt[1] + ' FV' : 'no FV'} · club ${pt[2] != null ? '#' + pt[2] : 'unranked'} · ` +
        (pt[3] != null ? `Top 100 #${pt[3]}` : 'not in Top 100');
    };
    const resting = describe(snaps.length - 1);
    readout.textContent = resting;
    snaps.forEach((s, i) => {
      const hit = el(doc, 'rect', { x: x(i) - Math.max(step, 24) / 2, y: 0, width: Math.max(step, 24), height: H, class: 'prk-hit' });
      hit.addEventListener('mouseenter', () => {
        guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.setAttribute('visibility', 'visible');
        readout.textContent = describe(i);
      });
      svg.appendChild(hit);
    });
    svg.addEventListener('mouseleave', () => { guide.setAttribute('visibility', 'hidden'); readout.textContent = resting; });
    svg.setAttribute('aria-label', `Ranking history${signed ? `, signed ${signed}` : ''}. ` + snaps.map((s, i) => describe(i)).join('. '));

    wrap.append(svg, readout);
    if (last < history.snapshots.length - 1) {
      const gone = doc.createElement('div');
      gone.className = 'prk-note';
      gone.textContent = `Not on the lists after ${root.ProspectHistory.snapshotLabel(history.snapshots[last])}.`;
      wrap.appendChild(gone);
    }
    return wrap;
  }

  root.ProspectChart = { render, fvValue };
})(typeof globalThis !== 'undefined' ? globalThis : this);
