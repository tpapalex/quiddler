'use strict';

// dictionary_api.js
// Helpers to look up definitions for a word:
// - getWordDefinitionLocal(word): case-insensitive lookup from collins_dictionary.js (validWordsMap)
// - getWordDefinitionAPI(word): fetch from Free Dictionary API and RETURN { found, error, data }
// - renderOnlineDict(word, apiJson): build pretty grouped HTML for parts of speech/senses
//
// Notes:
// - Rendering is handled by renderOnlineDict; do not assign the API JSON directly to innerHTML.
// - A simple AbortController timeout prevents long-hanging network requests.
// - Callers should pass raw chit text; helper strips parentheses and whitespace.

// Local lookup (case-insensitive via UPPER)
function getWordDefinitionLocal(word) {
  return validWordsMap[String(word || '').toUpperCase()] ?? null;
}

// Unified: getWordDefinitionAPI returns { found, error, data } 
// Also seeds FD_STATUS_CACHE (boolean) so optimizer/game benefit from drawer lookups.
async function getWordDefinitionAPI(word) {
  const wRaw = String(word || '').trim();
  if (!wRaw) return { found:false, error:false, data:null };
  const w = wRaw.toLowerCase();
  const upper = w.toUpperCase();
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      if (response.status === 404) {
        FD_STATUS_CACHE[upper] = false; // definitive miss
        return { found:false, error:false, data:null };
      }
      return { found:false, error:true, data:null }; // transient
    }
    const json = await response.json();
    const ok = Array.isArray(json) && json.length > 0;
    FD_STATUS_CACHE[upper] = ok; // seed boolean cache
    return { found: ok, error:false, data: ok ? json : null };
  } catch {
    return { found:false, error:true, data:null }; // do not seed cache on error
  } finally {
    clearTimeout(timeoutId);
  }
}

// Batch API validation (moved back from game.js)
// Accepts display word forms, returns { validPlain:Set<string>, invalidPlain:Set<string> }
async function validateWordAPIBatch(displayWords) {
  const toFetch = [];
  const inFlight = [];
  const plainList = [];

  function displayToPlain(dw) {
    return String(dw || '')
      .replace(/\([^)]*\)/g, (m) => m.replace(/[()]/g,''))
      .replace(/[()]/g,'')
      .replace(/[^a-z]/gi,'')
      .toLowerCase();
  }

  const sharedCache = (typeof window !== 'undefined' && window.__FDStatusCache) ? window.__FDStatusCache : (globalThis.__FDStatusCache ||= Object.create(null));

  for (const dw of (displayWords || [])) {
    const pw = displayToPlain(dw);
    if (!pw) continue;
    const key = pw.toUpperCase();
    plainList.push(pw);
    const val = sharedCache[key];
    if (val == null) {
      toFetch.push(pw);
    } else if (val && typeof val.then === 'function') {
      inFlight.push(val.then(v => { sharedCache[key] = v; }));
    }
  }

  if (toFetch.length) {
    const fetchPromises = toFetch.map(async pw => {
      const key = pw.toUpperCase();
      const prom = (async () => {
        try {
          const { error, found } = await getWordDefinitionAPI(pw);
          if (error) return true;
          return !!found;
        } catch { return true; }
      })();
      sharedCache[key] = prom;
      const resolved = await prom;
      sharedCache[key] = resolved;
    });
    await Promise.all(fetchPromises);
  }
  if (inFlight.length) await Promise.all(inFlight);

  const validPlain = new Set();
  const invalidPlain = new Set();
  for (const pw of plainList) {
    const key = pw.toUpperCase();
    const v = sharedCache[key];
    if (typeof v === 'boolean' ? v : true) validPlain.add(pw); else invalidPlain.add(pw);
  }
  return { validPlain, invalidPlain };
}

// Shared Free Dictionary API status cache (boolean values). Populated by both game & solver.
const FD_STATUS_CACHE = (typeof window !== 'undefined' && window.__FDStatusCache)
  ? window.__FDStatusCache
  : Object.create(null);
if (typeof window !== 'undefined') window.__FDStatusCache = FD_STATUS_CACHE;

// Removed batch validator (moved to game.js as validateWordAPIBatch)

// ---------- utils ----------
function esc(s='') {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function uniq(xs) { return [...new Set(xs.filter(Boolean))]; }

// Normalize a Free Dictionary API payload into a stable shape we can render
function normalizeFD(raw) {
  // Free Dictionary returns an array of entries
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return arr.map(entry => {
    const word     = entry.word || '';
    const phonetic = entry.phonetic || (entry.phonetics?.find(p => p.text)?.text) || '';
    const audioUrl = entry.phonetics?.find(p => p.audio)?.audio || '';
    // Map raw meanings -> interim structure
    const rawMeanings = (entry.meanings || []).map(m => ({
      pos: m.partOfSpeech || '',
      senses: (m.definitions || []).map(d => ({
        def: d.definition || '',
        example: d.example || '',
        synonyms: uniq(d.synonyms || m.synonyms || []),
        antonyms: uniq(d.antonyms || m.antonyms || []),
      })),
      // capture meaning-level synonyms/antonyms (may not appear per-definition)
      mSyn: uniq(m.synonyms || []),
      mAnt: uniq(m.antonyms || [])
    })).filter(m => m.senses.length);

    // Consolidate by part of speech (preserve first-seen order)
    const seenOrder = [];
    const byPOS = Object.create(null);
    for (const m of rawMeanings) {
      const key = m.pos || '_';
      if (!byPOS[key]) {
        byPOS[key] = { pos: m.pos, senses: [], mSyn: new Set(), mAnt: new Set() };
        seenOrder.push(key);
      }
      const tgt = byPOS[key];
      // Append senses in order
      for (const s of m.senses) tgt.senses.push(s);
      // Union meaning-level synonyms/antonyms
      for (const s of m.mSyn) tgt.mSyn.add(s);
      for (const a of m.mAnt) tgt.mAnt.add(a);
    }

    // Build final meanings array
    const meanings = seenOrder.map(k => {
      const v = byPOS[k];
      return {
        pos: v.pos,
        senses: v.senses,
        // Provide aggregated synonyms/antonyms if needed later
        aggSynonyms: Array.from(v.mSyn),
        aggAntonyms: Array.from(v.mAnt)
      };
    }).filter(m => m.senses.length);

    const sourceUrls = entry.sourceUrls || [];
    return { word, phonetic, audioUrl, meanings, sourceUrls };
  }).filter(e => e.word || e.meanings.length);
}

// Build HTML for one entry (headword + meanings)
function htmlForEntry(entry, {senseLimit=3, entryIdx=0}={}) {
  const { word, phonetic, audioUrl, meanings, sourceUrls } = entry;
  const header = `
    <div class="flex items-center gap-2">
      <span class="text-base font-semibold">${esc(word)}</span>
      ${phonetic ? `<span class="text-sm text-gray-500">${esc(phonetic)}</span>` : ''}
      ${audioUrl ? `
        <button type="button" class="ml-1 w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center"
                aria-label="Play audio" data-audio="${esc(audioUrl)}"
                onclick="(function(btn){ try{ const a=new Audio(btn.getAttribute('data-audio')); a.play(); }catch(_){} })(this)">
          <!-- tiny speaker icon -->
          <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15 9a3 3 0 010 6M17 7a6 6 0 010 10"/>
          </svg>
        </button>` : ''}
    </div>
  `;

  const blocks = meanings.map((m, mi) => {
    const senses = m.senses;
    const show = senses.slice(0, senseLimit);
    const hide = senses.slice(senseLimit);

    const sensesHtml = show.map((s, i) => senseLine(s, i)).join('') +
      (hide.length ? `
        <div id="more-${entryIdx}-${mi}" class="hidden">
          ${hide.map((s, i) => senseLine(s, i + show.length)).join('')}
        </div>
        <button type="button" class="mt-1 text-xs text-blue-700 hover:underline"
                onclick="(function(btn){ const id=btn.getAttribute('data-target'); const el=document.getElementById(id); const nowHidden=el.classList.toggle('hidden'); btn.textContent=nowHidden?'Show more…':'Show less'; })(this)"
                data-target="more-${entryIdx}-${mi}">Show more…</button>
      ` : '');

    return `
      <div class="mt-2">
        <span class="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs uppercase tracking-wide">${esc(m.pos)}</span>
        <ol class="mt-1 space-y-1 pl-5 list-decimal text-sm">
          ${sensesHtml}
        </ol>
      </div>
    `;
  }).join('');

  const sources = sourceUrls?.length
    ? `<div class="mt-2 text-[11px] text-gray-400">Source: ${sourceUrls.map(u => `<a href="${esc(u)}" target="_blank" class="hover:underline">${esc(u)}</a>`).join(', ')}</div>`
    : '';

  return `
    <div class="border border-gray-100 rounded-md p-3">
      ${header}
      ${blocks}
      ${sources}
    </div>
  `;
}

// One numbered sense line with example + synonym chips
function senseLine(sense, idx) {
  const ex = sense.example ? `<div class="text-[12px] text-gray-500 mt-0.5">“${esc(sense.example)}”</div>` : '';
  const synChips = (sense.synonyms||[]).slice(0,8).map(w => chip(w,false));
  const antChips = (sense.antonyms||[]).slice(0,8).map(w => chip(w,true));
  const rel = [...synChips, ...antChips];
  const relHtml = rel.length ? `<div class="flex flex-wrap items-center gap-1 mt-1"><span class="text-[10px] text-gray-500 mr-1">Synonyms/Antonyms:</span>${rel.join('')}</div>` : '';
  return `
    <li>
      <div>${esc(sense.def)}</div>
      ${ex}
      ${relHtml}
    </li>
  `;
}

// Little synonym/antonym chip (clickable to look up)
function chip(word, isAnt=false) {
  const multi = /\s/.test(String(word||'').trim());
  const cls = isAnt ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-green-50 text-green-700 ring-green-200';
  const baseClasses = `px-1 py-0.5 rounded-md text-[10px] ring-1 ${cls}`;
  const wEsc = esc(word);
  if (multi) {
    return `<span class="${baseClasses} opacity-80 cursor-default">${wEsc}</span>`;
  }
  return `
    <button type="button"
            class="${baseClasses} hover:brightness-95"
            onclick="window.QuiddlerTools?.showDict?.('${wEsc}')">${wEsc}</button>
  `;
}

// ---------- main renderer for Online Dictionary area ----------
function renderOnlineDict(word, apiJson, {senseLimit=3} = {}) {
  const wrap = document.getElementById('dictOnlineWrap');
  const box  = document.getElementById('dictOnline');

  // Empty lookup → hide
  if (!word || !String(word).trim()) {
    wrap?.classList.add('hidden');
    if (box) box.innerHTML = '';
    return;
  }

  const entries = normalizeFD(apiJson);
  if (!entries.length) {
    // Nothing returned → keep Online section hidden
    wrap?.classList.add('hidden');
    if (box) box.innerHTML = '';
    return;
  }

  const html = entries.map((e, i) => htmlForEntry(e, {senseLimit, entryIdx: i})).join('<div class="h-2"></div>');
  if (box) box.innerHTML = html;
  wrap?.classList.remove('hidden');
}

