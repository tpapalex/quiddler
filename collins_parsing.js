'use strict';
// collins_parsing.js
// Lightweight parser for entries in validWordsMap (Collins '19 data)
// Goals (first pass, no enhancement extras):
// 1. Extract qualifiers in leading parenthesis groups: (Hawaiian) (obsolete) etc.
// 2. Extract bracket groups like [n -S] [v -ED, -ING, -S] capturing part of speech + inflection patterns.
// 3. Split multiple sense glosses separated by ' / ' or ' ; ' (only if that yields >1 reasonable segments).
// 4. Detect simple variant / also / aka patterns inside the residual text.
// 5. Provide structured object + HTML renderer with small badges (qualifiers, POS, variants, inflections).
// 6. Non-destructive: if parsing seems weak, fall back to original raw text when rendering.
//
// Exposed API (CollinsParsing global):
//   parseCollinsEntry(word) -> { word, raw, qualifiers[], pos, inflections[], senses[], variants[], aka[], errors[] }
//   parseCollinsRaw(raw)    -> same minus word
//   renderParsedCollins(parsed) -> HTML string
//
// NOTE: This is heuristic; Collins concise entries use varied shorthand. We intentionally keep it tolerant.

const POS_PATTERN = /(\b|^)(n|v|adj|adv|interj|prep|pron|conj|abbr|abbrev|prefix|suffix|pref|suf)\b/i;

function esc(s=''){ return String(s)
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;'); }

function extractVariants(text){
  const variants = new Set();
  text.replace(/\balso ([A-Z]{2,})\b/g, (_,v)=>{ variants.add(v); return _; });
  text.replace(/\balso ([A-Z]{2,}(?:,\s*[A-Z]{2,})+)\b/g, (_,list)=>{ list.split(/,\s*/).forEach(v=>variants.add(v)); return _; });
  return Array.from(variants);
}

function extractAka(text){
  const aka = new Set();
  text.replace(/\baka ([a-z][a-z-]{2,})\b/gi,(_,w)=>{ aka.add(w.toLowerCase()); return _; });
  return Array.from(aka);
}

function parseInflections(tokens){
  const inflections = [];
  for (const t of tokens){
    if (/^-[A-Z]+$/.test(t)) inflections.push(t);
  }
  return inflections;
}

function parsePOS(tokens){
  for (const t of tokens){
    if (POS_PATTERN.test(t)) return t.toLowerCase();
  }
  return null;
}

function parseSegment(rawSeg){
  const seg = rawSeg.trim();
  if (!seg) return null;
  const local = { raw: seg, pos: null, inflections: [], variants: [], aka: [], gloss: '', qualifiers: [], errors: [] };

  // Extract leading qualifiers specific to this segment: (Hawaiian) (slang) etc.
  let bodyForQual = seg;
  while (true) {
    const qm = bodyForQual.match(/^\(([^)]+)\)\s*/);
    if (!qm) break;
    local.qualifiers.push(qm[1]);
    bodyForQual = bodyForQual.slice(qm[0].length);
  }

  const bracketGroups = [];
  let body = bodyForQual.replace(/\s*\{[^}]*\}/g,' ')
                        .replace(/\s*\[([^\]]+)\]/g, (m, inner) => { bracketGroups.push(inner.trim()); return ' '; })
                        .replace(/\s{2,}/g,' ').trim();

  const bgTokens = bracketGroups.flatMap(g => g.split(/[ ,]+/).filter(Boolean));
  local.pos = parsePOS(bgTokens);
  const infl = [];
  for (const t of bgTokens){
    if (/^-[A-Z]+$/.test(t)) infl.push(t);
    else if (/^[A-Z]{3,}$/.test(t) && !POS_PATTERN.test(t)) infl.push(t);
  }
  local.inflections = infl;

  local.variants = extractVariants(body);
  local.aka = extractAka(body);

  if (local.variants.length){
    body = body.replace(/(?:,\s*)?also [A-Z]{2,}(?:,\s*[A-Z]{2,})*(?=$|\s|[,.;])/g, '')
               .replace(/\s{2,}/g,' ').replace(/,\s*$/,'').trim();
  }
  if (local.aka.length){
    body = body.replace(/(?:,\s*)?aka [^,.;]+(?=($|[,.;]))/gi, '')
               .replace(/\s{2,}/g,' ').replace(/,\s*$/,'').trim();
  }

  local.gloss = body;
  return local;
}

function shouldMultiSplit(segments){
  return segments.length > 1;
}

function parseCollinsRaw(raw){
  const errors = [];
  if (!raw || typeof raw !== 'string') return { raw:String(raw||''), qualifiers:[], entries:[], errors:['non-string'] };
  let working = raw.trim();

  let head = null;
  const headMatch = working.match(/^([A-Z][A-Z'-]{2,}),(?:\s|$)/);
  if (headMatch) {
    head = headMatch[1];
    working = working.slice(headMatch[0].length).trim();
  }

  // Global qualifiers removed; qualifiers now captured per segment.
  const qualifiers = []; // kept for backward compatibility (always empty now)

  const segCandidates = working.split(/\s+\/\s+/);
  const isMulti = shouldMultiSplit(segCandidates);

  const entries = [];
  if (isMulti){
    for (const seg of segCandidates){
      const parsedSeg = parseSegment(seg);
      if (parsedSeg) entries.push(parsedSeg);
    }
  } else {
    const single = parseSegment(working);
    if (single) entries.push(single);
  }

  if (head) {
    entries.forEach(ent => {
      if (!ent.variants) ent.variants = [];
      if (!ent.variants.includes(head)) ent.variants.unshift(head);
    });
  }

  return { raw, qualifiers, head, entries, errors };
}

function parseCollinsEntry(word){
  const w = String(word||'');
  const val = (typeof validWordsMap !== 'undefined' && validWordsMap[w.toUpperCase()]) || null;
  const parsed = parseCollinsRaw(val || '');
  parsed.word = w;
  return parsed;
}

function badge(txt, cls){ return `<span class="inline-block px-1.5 py-0.5 rounded-md text-[10px] font-medium ${cls || 'bg-gray-100 text-gray-700'}">${esc(txt)}</span>`; }

function posFull(abbrev){
  if(!abbrev) return '';
  const a = abbrev.toLowerCase();
  const map = {
    n:'NOUN', v:'VERB', adj:'ADJECTIVE', adv:'ADVERB', interj:'INTERJECTION',
    prep:'PREPOSITION', pron:'PRONOUN', conj:'CONJUNCTION', abbr:'ABBREVIATION', abbrev:'ABBREVIATION',
    prefix:'PREFIX', pref:'PREFIX', suffix:'SUFFIX', suf:'SUFFIX'
  };
  return map[a] || a.toUpperCase();
}

function renderParsedCollins(parsed){
  if (!parsed || !parsed.raw) return '';
  const { entries = [], word, head } = parsed; // include head
  if (!entries.length) return `<div>${esc(parsed.raw)}</div>`;
  const showHead = head && head.toLowerCase() !== String(word||'').toLowerCase();
  const headChip = showHead ? `<button type="button" class="text-sm text-gray-500 hover:underline focus:outline-none" onclick="window.QuiddlerTools?.showDict?.('${esc(head.toLowerCase())}')">${esc(head.toLowerCase())}</button>` : '';
  const headHtml = word ? `<div class="flex items-center gap-2"><span class="text-base font-semibold">${esc(word)}</span>${headChip}</div>` : '';
  function chipVariant(w){
    const display = esc(String(w).toLowerCase());
    return `<button type="button" class="px-1 py-0.5 rounded-md text-[10px] ring-1 bg-blue-50 text-blue-700 ring-blue-200 hover:brightness-95" onclick="window.QuiddlerTools?.showDict?.('${display}')">${display}</button>`;
  }
  function chipAka(w){
    const display = esc(String(w).toLowerCase());
    return `<button type="button" class="px-1 py-0.5 rounded-md text-[10px] ring-1 bg-green-50 text-green-700 ring-green-200 hover:brightness-95" onclick="window.QuiddlerTools?.showDict?.('${display}')">${display}</button>`;
  }
  function chipInflect(w){
    const display = esc(String(w).toLowerCase());
    return `<button type="button" class="px-1 py-0.5 rounded-md text-[10px] ring-1 bg-amber-50 text-amber-700 ring-amber-200 hover:brightness-95" onclick="window.QuiddlerTools?.showDict?.('${display}')">${display}</button>`;
  }
  const blocks = entries.map((ent, i) => {
    const posStr = posFull(ent.pos);
    const qualBadges = (ent.qualifiers && ent.qualifiers.length)
      ? ent.qualifiers.map(q => `<span class=\"inline-flex items-center px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 text-[11px] tracking-wide\">${esc(q)}<\/span>`).join('')
      : '';
    const header = `<div class=\"flex items-baseline gap-1\">${posStr?`<span class=\"inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs uppercase tracking-wide\">${esc(posStr)}<\/span>`:''}${qualBadges}</div>`;
    const glossHtml = `<div class=\"text-sm text-gray-800 mt-1\">${esc(ent.gloss || ent.raw)}</div>`;
    const base = (head || word || '').toLowerCase();
    const inflForms = Array.from(new Set((ent.inflections||[]).map(f => /^-[A-Z]+$/.test(f) ? (base ? base + f.slice(1).toLowerCase() : f.slice(1).toLowerCase()) : f.toLowerCase()))).filter(f => f && f !== base);
    const inflHtml = inflForms.length ? `<div class=\"flex flex-wrap items-center gap-1 mt-1\"><span class=\"text-[10px] text-gray-500 mr-1\">Inflections:</span>${inflForms.slice(0,16).map(chipInflect).join('')}</div>` : '';
    const headLc = (word || '').toLowerCase();
    const headLemmaLc = (head || '').toLowerCase();
    const variantWords = Array.from(new Set(ent.variants||[])).filter(w => { const wl = String(w).toLowerCase(); return wl !== headLc && wl !== headLemmaLc; });
    const akaWords = Array.from(new Set(ent.aka||[])).filter(w => { const wl = String(w).toLowerCase(); return wl !== headLc && wl !== headLemmaLc; });
    const relChips = [...variantWords.map(chipVariant), ...akaWords.map(chipAka)];
    const relHtml = relChips.length ? `<div class=\"flex flex-wrap items-center gap-1 mt-1\"><span class=\"text-[10px] text-gray-500 mr-1\">Variants/Synonyms:</span>${relChips.slice(0,16).join('')}</div>` : '';
    return `<div class=\"${i===0?'mt-2 ':''}mb-3 last:mb-0\">${header}${glossHtml}${inflHtml}${relHtml}</div>`;
  }).join('');
  return `<div class="border border-gray-100 rounded-md p-3">${headHtml}${blocks}</div>`;
}

// Expose API globally (no IIFE wrapper needed)
const CollinsParsing = { parseCollinsRaw, parseCollinsEntry, renderParsedCollins };
if (typeof window !== 'undefined') {
  window.CollinsParsing = CollinsParsing;
  window.parseCollins = parseCollinsEntry;
} else {
  globalThis.CollinsParsing = CollinsParsing;
}
