'use strict';

// dictionary_api.js
// Helpers to look up definitions for a word:
// - getWordDefinitionLocal(word): case-insensitive lookup from collins_dictionary.js (validWordsMap)
// - getWordDefinitionAPI(word): fetch from Free Dictionary API and RETURN RAW JSON (array of entries)
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

// API helper: returns the Free Dictionary API JSON (array of entries) or null on failure/no match.
async function getWordDefinitionAPI(word) {
  const w = String(word || '').trim();
  if (!w) return null;

  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w.toLowerCase())}`;
  // Optional: simple timeout so we don't hang forever
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.warn(`Free Dictionary API error for "${w}": ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    return data;
  } catch (error) {
    console.error('Free Dictionary API request/parsing failed:', error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// NEW: status-returning variant for validation so we can distinguish not-found from network failure.
// Returns { found:boolean, error:boolean }.
async function getWordDefinitionAPIStatus(word) {
  const w = String(word || '').trim();
  if (!w) return { found:false, error:false };
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w.toLowerCase())}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      if (response.status === 404) return { found:false, error:false }; // definitive not found
      return { found:false, error:true }; // other HTTP errors count as error (fallback allowed)
    }
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return { found:false, error:false };
    return { found:true, error:false };
  } catch (e) {
    return { found:false, error:true }; // network/abort -> treat as error (allow fallback)
  } finally {
    clearTimeout(timeoutId);
  }
}

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
    const meanings = (entry.meanings || []).map(m => ({
      pos: m.partOfSpeech || '',
      senses: (m.definitions || []).map(d => ({
        def: d.definition || '',
        example: d.example || '',
        synonyms: uniq(d.synonyms || m.synonyms || []),
        antonyms: uniq(d.antonyms || m.antonyms || []),
      }))
    })).filter(m => m.senses.length);
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
  const syn = (sense.synonyms?.length)
    ? `<div class="flex flex-wrap gap-1 mt-1">${sense.synonyms.slice(0,8).map(w => chip(w)).join('')}</div>` : '';
  const ant = (sense.antonyms?.length)
    ? `<div class="flex flex-wrap gap-1 mt-1">${sense.antonyms.slice(0,8).map(w => chip(w, true)).join('')}</div>` : '';
  return `
    <li>
      <div>${esc(sense.def)}</div>
      ${ex}
      ${syn ? `<div class="text-[11px] text-gray-600 mt-1"><span class="mr-1">Syn:</span>${syn}</div>` : ''}
      ${ant ? `<div class="text-[11px] text-gray-600 mt-1"><span class="mr-1">Ant:</span>${ant}</div>` : ''}
    </li>
  `;
}

// Little synonym/antonym chip (clickable to look up)
function chip(word, isAnt=false) {
  const cls = isAnt ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-blue-50 text-blue-700 ring-blue-200';
  const w = esc(word);
  return `
    <button type="button"
            class="px-1.5 py-0.5 rounded-md text-[11px] ring-1 ${cls} hover:brightness-95"
            onclick="window.QuiddlerTools?.showDict?.('${w}')">${w}</button>
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

