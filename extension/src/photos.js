// Reads a sold listing's main photo with Claude (Anthropic API): the slab label
// (grading company, grade, autograph grade, cert number) and the card itself
// (parallel colour, serial stamp, autograph). Pure functions: the request body,
// the answer's checks, and how a reading combines with the title's reading.
(function (root) {
  const MODEL = 'claude-opus-5-5';
  const API = 'https://api.anthropic.com/v1/messages';
  // Opus 5.5 rates per million tokens, to estimate and report what a run cost.
  const PRICE_IN = 4, PRICE_OUT = 20;

  // The larger copy of an eBay photo: i.ebayimg.com serves sizes by name (s-l225, s-l500, s-l1600).
  function largeImageUrl(url) {
    const u = String(url || '');
    if (!/^https:\/\/i\.ebayimg\.com\//.test(u)) return '';
    return u.replace(/\/s-l\d+(\.\w+)(\?.*)?$/, '/s-l1600$1');
  }

  const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['picture', 'slabbed', 'grader', 'grade', 'auto_grade', 'cert_number', 'label_text', 'parallel_colour',
      'serial_number', 'numbered_to', 'autograph_visible', 'confidence', 'notes'],
    properties: {
      picture: { type: 'string', enum: ['one card', 'one slabbed card', 'several cards', 'stock or generic image', 'not a card', 'unclear'] },
      slabbed: nullable({ type: 'boolean' }),
      grader: nullable({ type: 'string', enum: ['PSA', 'BGS', 'SGC', 'CGC', 'TAG', 'HGA', 'ISA', 'GMA', 'other'] }),
      grade: nullable({ type: 'string' }),
      auto_grade: nullable({ type: 'string' }),
      cert_number: nullable({ type: 'string' }),
      label_text: nullable({ type: 'string' }),
      parallel_colour: nullable({ type: 'string' }),
      serial_number: nullable({ type: 'string' }),
      numbered_to: nullable({ type: 'integer' }),
      autograph_visible: nullable({ type: 'boolean' }),
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      notes: { type: 'string' },
    },
  };

  const INSTRUCTIONS = `You are reading the main photo of a sold eBay listing for a baseball prospect card, to record what the card is.
Report only what you can read or see in the photo. Use null for anything not visible or not legible; never fill a field from the listing title alone.
- picture: what the photo shows.
- slabbed: true if the card is in a grading company's sealed holder (slab).
- grader, grade, auto_grade, cert_number, label_text: from the slab label. grade is the card grade as printed ("10", "9.5", "9"), with "Black Label" or "Pristine" appended when the label says so; auto_grade only when the label gives a separate autograph grade. label_text is the label's description line as printed.
- parallel_colour: the parallel's colour or finish as seen or as printed on the label (for example "Gold", "Blue Wave", "Superfractor"); null for a plain base card or if you cannot tell.
- serial_number: the stamped serial as printed, such as "23/50"; numbered_to: the number after the slash.
- autograph_visible: true if a signature is on the card, false if the card clearly has none, null if you cannot tell.
- confidence: how sure you are of the fields you filled. notes: one short sentence on anything that disagrees with the title, or why fields are null.
The listing title, for context only: `;

  // The Messages API request for one photo (base64 image data and its media type).
  function buildRequest(title, imageBase64, mediaType) {
    return {
      model: MODEL,
      max_tokens: 16000,
      // Opus 5.5 always thinks; effort sets how much (its default is medium).
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      // If a safety classifier declines, let the API re-run the request on its recommended fallback model.
      fallbacks: 'default',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: INSTRUCTIONS + String(title || '').slice(0, 300) },
        ],
      }],
    };
  }
  const HEADERS = (apiKey) => ({
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2026-10-21',
    'anthropic-beta': 'server-side-fallback-2026-07-01',
    // The request comes from the extension, not a server; the key stays in this browser.
    'anthropic-dangerous-direct-browser-access': 'true',
  });

  // The reading from an API answer, or an error explaining why there is none.
  function parseResponse(body) {
    if (!body || body.type === 'error') throw new Error((body && body.error && body.error.message) || 'no answer');
    if (body.stop_reason === 'refusal') throw new Error('declined to read this photo');
    if (body.stop_reason === 'max_tokens') throw new Error('answer was cut off');
    const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    let reading;
    try { reading = JSON.parse(text); } catch (e) { throw new Error('answer was not readable JSON'); }
    const u = body.usage || {};
    const cost = ((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)) / 1e6 * PRICE_IN +
      (u.output_tokens || 0) / 1e6 * PRICE_OUT;
    return { reading, model: body.model || MODEL, cost: Math.round(cost * 10000) / 10000 };
  }

  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const titleCase = (s) => String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

  // Combine a title reading (cards.js fields) with a photo reading. Photo values win when the
  // photo was read with high or medium confidence; disagreements are listed either way.
  function combine(card, photo) {
    const out = Object.assign({}, card, { card_source: 'title', photo_mismatch: '' });
    if (!photo || !photo.reading) return out;
    const p = photo.reading, sure = p.confidence !== 'low' && ['one card', 'one slabbed card'].includes(p.picture);
    const diffs = [];
    const graderT = card.grader || '', gradeT = card.grade || '';
    if (p.slabbed === true && p.grader && p.grader !== 'other') {
      const g = String(p.grade || '').trim();
      if (graderT && (graderT !== p.grader || (g && norm(gradeT) !== norm(g)))) diffs.push(`grade: title ${graderT} ${gradeT}, photo ${p.grader} ${g}`);
      if (!graderT) diffs.push(`grade: title says nothing, photo ${p.grader} ${g}`);
      if (sure) Object.assign(out, { graded: true, grader: p.grader, grade: g || gradeT, auto_grade: p.auto_grade || card.auto_grade || '' });
    } else if (p.slabbed === false && graderT) {
      diffs.push(`grade: title ${graderT} ${gradeT}, photo shows a raw card`);
      if (sure) Object.assign(out, { graded: false, grader: '', grade: '', auto_grade: '' });
    }
    if (p.numbered_to != null) {
      if (card.numbered_to != null && card.numbered_to !== p.numbered_to) diffs.push(`numbered: title /${card.numbered_to}, photo /${p.numbered_to}`);
      if (sure) out.numbered_to = p.numbered_to;
    }
    if (p.serial_number && sure) {
      const m = /^(\d+)\s*\/\s*(\d+)$/.exec(p.serial_number.replace(/#/g, '').trim());
      if (m) out.serial = +m[1];
    }
    if (p.autograph_visible != null && p.autograph_visible !== card.auto) {
      diffs.push(`autograph: title ${card.auto ? 'yes' : 'no'}, photo ${p.autograph_visible ? 'yes' : 'no'}`);
      if (sure) out.auto = p.autograph_visible;
    }
    if (p.parallel_colour && sure && ['Base', 'Numbered'].includes(card.variant)) out.variant = titleCase(p.parallel_colour);
    if (sure) out.card_source = 'title+photo';
    out.photo_mismatch = diffs.join('; ');
    return out;
  }

  // The photo columns for the CSV.
  function columns(photo) {
    const p = (photo && photo.reading) || {};
    return {
      photo_read: photo ? (photo.error ? 'failed' : 'yes') : 'no',
      photo_picture: p.picture || '',
      photo_slabbed: p.slabbed == null ? '' : p.slabbed ? 'yes' : 'no',
      photo_grader: p.grader || '',
      photo_grade: p.grade || '',
      photo_auto_grade: p.auto_grade || '',
      photo_cert: p.cert_number || '',
      photo_label: p.label_text || '',
      photo_parallel: p.parallel_colour || '',
      photo_serial: p.serial_number || '',
      photo_autograph: p.autograph_visible == null ? '' : p.autograph_visible ? 'yes' : 'no',
      photo_confidence: p.confidence || '',
      photo_notes: photo && photo.error ? `not read: ${photo.error}` : p.notes || '',
    };
  }
  const PHOTO_COLUMNS = Object.keys(columns(null));

  const api = { MODEL, API, PRICE_IN, PRICE_OUT, SCHEMA, largeImageUrl, buildRequest, HEADERS, parseResponse, combine, columns, PHOTO_COLUMNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProspectPhotos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
