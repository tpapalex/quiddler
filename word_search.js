'use strict';
/**
 * word_search.js
 * Infrastructure for Word Search feature (phase 1: core indexes & utilities, no UI wiring yet).
 *
 * Goals of this foundation:
 *  - Build a canonical word list (array) + stable indices from validWordsMap keys.
 *  - Precompute helpful indexes for upcoming search types:
 *      * Length buckets.
 *  - Provide only basic data structures and helpers (no search implementations yet).
 *  - Expose a minimal API namespace (WordSearch) for future expansion: init, stats, getWords.
 *  - Keep everything side-effect free except for a one-time lazy initialization.
 *
 * NOTE: All search functions will (by convention) return a sorted ascending array of integer indices
 * into WORD_LIST. Higher layers can map indices back to words via getWords().
 */

// ------------------ Internal state ------------------
let __initialized = false;
let WORD_LIST = [];                // Array<string> lowercase words
let WORD_TO_INDEX = null;          // Map<string, number>
let WORDS_BY_LENGTH = [];          // Array<Array<number>>; index by length -> sorted arrays of word indices
let ANAGRAM_INDEX = null;          // Map<string, Array<number>> signature -> sorted word indices (anagrams)

function ensureValidWordsMap() {
  if (typeof validWordsMap === 'undefined' || !validWordsMap) {
    throw new Error('validWordsMap is not available globally');
  }
}

// (All signature / inventory logic intentionally omitted for now.)

// ------------------ Builders ------------------
function buildIndices() {
  ensureValidWordsMap();

  const keys = Object.keys(validWordsMap); // UPPERCASE dictionary keys
  WORD_LIST = keys.map(k => k.toLowerCase());
  WORD_TO_INDEX = new Map();
  ANAGRAM_INDEX = new Map();
  // Ensure WORDS_BY_LENGTH has enough buckets; collect dynamically
  WORDS_BY_LENGTH = [];

  for (let i = 0; i < WORD_LIST.length; i++) {
    const w = WORD_LIST[i];
    WORD_TO_INDEX.set(w, i);
    const len = w.length;
    if (!WORDS_BY_LENGTH[len]) WORDS_BY_LENGTH[len] = [];
    WORDS_BY_LENGTH[len].push(i);

  // Anagram signature (sorted letters). Simple O(L log L) once at build time.
  const sig = w.split('').sort().join('');
  const arr = ANAGRAM_INDEX.get(sig);
  if (arr) arr.push(i); else ANAGRAM_INDEX.set(sig, [i]);
  }

  // Sort each length bucket for deterministic order
  for (const bucket of WORDS_BY_LENGTH) { if (Array.isArray(bucket)) bucket.sort((a,b)=>a-b); }
  // Sort each anagram list (indices already ascending insertion by i, but keep safe if order changes later)
  for (const list of ANAGRAM_INDEX.values()) { list.sort((a,b)=>a-b); }
}

function ensureInit() {
  if (!__initialized) {
    buildIndices();
    __initialized = true;
  }
}

// Helper to map indices to words (kept for convenience)
function getWords(indices) { ensureInit(); return (indices || []).map(i => WORD_LIST[i]); }

// Expose diagnostics
function stats() {
  ensureInit();
  return {
    wordCount: WORD_LIST.length,
    maxLength: WORDS_BY_LENGTH.length - 1,
  // Additional stats can be added later.
  };
}

/**
 * Simplified regex search MVP.
 * Pattern syntax:
 *   letters a-z => literal letters (case-insensitive)
 *   . => exactly one letter
 *   * => zero or more letters
 *   + => one or more letters
 * No other metacharacters are recognized (others are escaped literally).
 * Options:
 *   minLen (default 0), maxLen (default Infinity) restrict candidate word lengths pre-filter.
 * Returns: sorted array of word indices matching.
 */
// New compact parser return structure:
// Success: { ok:true, type:<fast|generic>, source, normalized, minLen, maxLen, unbounded, data:{...} }
// Fast types & required data:
//  literal: data { word }
//  any: data { minChar }  (minChar = 0 for '*', 1 for '+')
//  prefix: data { prefix }
//  suffix: data { suffix }
//  contains: data { substring }
//  prefixSuffix: data { prefix, suffix, gapMin, unboundedGap }
//  generic: data { regex, segments }
function parseSimplifiedRegex(pattern) {
  if (pattern == null) return { error: 'null-pattern' };
  const raw = String(pattern).trim();
  if (!raw) return { error: 'empty-pattern' };
  let cleaned = raw.replace(/\s+/g,'').replace(/[^a-zA-Z.*+]/g,'');
  if (!cleaned) return { error: 'empty-after-clean' };
  cleaned = cleaned
    .replace(/\*+/g,'*')
    .replace(/\.\*/g,'+')
    .replace(/\*\+/g,'+').replace(/\+\*/g,'+')
    .replace(/\*+/g,'*');
  if (!cleaned) return { error: 'empty-after-clean' };

  // Single meta-only pattern fast path: '*' or '+'
  if (cleaned === '*' || cleaned === '+') {
    return {
      ok: true,
      type: 'any',
      source: raw,
      normalized: cleaned,
      minLen: cleaned === '*' ? 0 : 1,
      maxLen: Infinity,
      unbounded: true,
      data: { minChar: cleaned === '*' ? 0 : 1 }
    };
  }

  // Tokenize
  const segments = [];
  let buf='';
  const pushLit = ()=>{ if (buf) { segments.push({ type:'lit', value: buf.toLowerCase() }); buf=''; } };
  for (const ch of cleaned) {
    if (/[a-z]/i.test(ch)) { buf += ch; continue; }
    pushLit();
    if (ch === '.') segments.push({ type:'dot' });
    else if (ch === '*') segments.push({ type:'star' });
    else if (ch === '+') segments.push({ type:'plus' });
  }
  pushLit();
  if (!segments.length) return { error:'no-body' };

  const litCount = segments.filter(s=>s.type==='lit').length;

  // Literal only
  if (litCount === segments.length) {
    const word = segments.map(s=>s.value).join('');
    return {
      ok: true,
      type: 'literal',
      source: raw,
      normalized: word,
      minLen: word.length,
      maxLen: word.length,
      unbounded: false,
      data: { word }
    };
  }

  const firstSeg = segments[0];
  const lastSeg = segments[segments.length-1];

  // Helper scan for mandatory length
  const minLenFromSegments = () => {
    let m = 0; for (const s of segments) {
      if (s.type === 'lit') m += s.value.length;
      else if (s.type === 'dot') m += 1;
      else if (s.type === 'plus') m += 1; // plus contributes at least one
    } return m;
  };
  const hasUnbounded = segments.some(s=> s.type==='star' || s.type==='plus');
  const minLenAll = minLenFromSegments();
  const maxLenAll = hasUnbounded ? Infinity : minLenAll;

  // Meta-only unbounded pattern (no literals, at least one star/plus) => treat as 'any'
  if (litCount === 0 && hasUnbounded) {
    return {
      ok: true,
      type: 'any',
      source: raw,
      normalized: cleaned,
      minLen: minLenAll,
      maxLen: Infinity,
      unbounded: true,
      data: { minChar: minLenAll }
    };
  }

  // Fixed-length wildcard-only (all dots, no star/plus) -> treat as 'any' (bounded)
  if (litCount === 0 && !hasUnbounded && segments.every(s=> s.type==='dot')) {
    return {
      ok: true,
      type: 'any',
      source: raw,
      normalized: cleaned,
      minLen: minLenAll,
      maxLen: minLenAll,
      unbounded: false,
      data: { length: minLenAll }
    };
  }

  // prefix fast type
  if (litCount === 1 && firstSeg.type==='lit') {
    const mandatoryTail = segments.slice(1).reduce((a,s)=> a + (s.type==='dot'||s.type==='plus'?1:0), 0);
    return {
      ok: true,
      type: 'prefix',
      source: raw,
      normalized: cleaned,
      minLen: firstSeg.value.length + mandatoryTail,
      maxLen: hasUnbounded ? Infinity : firstSeg.value.length + mandatoryTail,
      unbounded: hasUnbounded,
      data: { prefix: firstSeg.value }
    };
  }
  // suffix fast type
  if (litCount === 1 && lastSeg.type==='lit') {
    const mandatoryHead = segments.slice(0,-1).reduce((a,s)=> a + (s.type==='dot'||s.type==='plus'?1:0), 0);
    return {
      ok: true,
      type: 'suffix',
      source: raw,
      normalized: cleaned,
      minLen: lastSeg.value.length + mandatoryHead,
      maxLen: hasUnbounded ? Infinity : lastSeg.value.length + mandatoryHead,
      unbounded: hasUnbounded,
      data: { suffix: lastSeg.value }
    };
  }
  // contains fast type (single literal + only stars around it)
  if (litCount === 1) {
    const onlyLitStar = segments.every(s=> s.type==='lit' || s.type==='star');
    if (onlyLitStar) {
      const litSeg = segments.find(s=>s.type==='lit');
      return {
        ok: true,
        type: 'contains',
        source: raw,
        normalized: cleaned,
        minLen: litSeg.value.length,
        maxLen: Infinity,
        unbounded: true,
        data: { substring: litSeg.value }
      };
    }
  }
  // prefixSuffix: exactly two literals, metas between
  if (litCount === 2 && firstSeg.type==='lit' && lastSeg.type==='lit') {
    const middle = segments.slice(1,-1);
    if (middle.length && middle.every(s=> s.type==='dot'||s.type==='star'||s.type==='plus')) {
      const gapMin = middle.reduce((a,s)=> a + (s.type==='dot'||s.type==='plus'?1:0), 0);
      const unboundedGap = middle.some(s=> s.type==='star' || s.type==='plus');
      return {
        ok: true,
        type: 'prefixSuffix',
        source: raw,
        normalized: cleaned,
        minLen: firstSeg.value.length + lastSeg.value.length + gapMin,
        maxLen: unboundedGap ? Infinity : firstSeg.value.length + lastSeg.value.length + gapMin,
        unbounded: unboundedGap,
        data: { prefix: firstSeg.value, suffix: lastSeg.value, gapMin, unboundedGap }
      };
    }
  }

  // mask: only literals and dots (at least one dot), no star/plus => fixed length positional mask
  if (!hasUnbounded && litCount > 0 && segments.every(s=> s.type==='lit' || s.type==='dot') && segments.some(s=> s.type==='dot')) {
    // Build runs of literals with starting positions
    let pos = 0;
    const runs = [];
    for (const s of segments) {
      if (s.type === 'lit') {
        runs.push({ pos, value: s.value });
        pos += s.value.length;
      } else { // dot
        pos += 1;
      }
    }
    return {
      ok: true,
      type: 'mask',
      source: raw,
      normalized: cleaned,
      minLen: pos,
      maxLen: pos,
      unbounded: false,
      data: { length: pos, runs }
    };
  }

  // Generic fallback
  const body = segments.map(s=>{
    if (s.type==='lit') return s.value;
    if (s.type==='dot') return '[a-z]';
    if (s.type==='star') return '[a-z]*';
    if (s.type==='plus') return '[a-z]+';
  }).join('');
  const regex = new RegExp('^' + body + '$','i');
  return {
    ok: true,
    type: 'generic',
    source: raw,
    normalized: cleaned,
    minLen: minLenAll,
    maxLen: maxLenAll,
    unbounded: hasUnbounded,
    data: { regex, segments }
  };
}

function searchRegex(pattern, { minLen = 0, maxLen = Infinity } = {}) {
  ensureInit();
  if (pattern == null) return [];
  const p = parseSimplifiedRegex(pattern);
  if (p.error || !p.ok) return [];
  if (maxLen < minLen) return [];

  // Adjust effective length range based on pattern inherent bounds
  const effMin = Math.max(minLen, p.minLen);
  const effMax = Math.min(maxLen, p.maxLen);
  if (effMax < effMin) return [];

  const out = [];
  switch (p.type) {
    case 'literal': {
      if (p.minLen < minLen || p.minLen > maxLen) return [];
      const idx = WORD_TO_INDEX.get(p.data.word);
      return idx == null ? [] : [idx];
    }
    case 'any': {
      if (!p.unbounded && p.minLen === p.maxLen) { // fixed-length wildcard-only pattern
        const len = p.minLen;
        if (len < effMin || len > effMax) return [];
        const bucket = WORDS_BY_LENGTH[len];
        return bucket ? bucket.slice() : [];
      }
      for (let L = effMin; L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
        const bucket = WORDS_BY_LENGTH[L]; if (!bucket) continue;
        out.push(...bucket);
      }
      return out;
    }
    case 'prefix': {
      const prefix = p.data.prefix;
      for (let L = Math.max(effMin, prefix.length); L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
        if (!p.unbounded && L !== p.minLen) continue; // bounded exact length
        if (L < p.minLen) continue;
        const bucket = WORDS_BY_LENGTH[L]; if (!bucket) continue;
        for (const idx of bucket) {
          const w = WORD_LIST[idx];
          if (w.startsWith(prefix)) out.push(idx);
        }
      }
      return out;
    }
    case 'suffix': {
      const suffix = p.data.suffix;
      for (let L = Math.max(effMin, suffix.length); L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
        if (!p.unbounded && L !== p.minLen) continue;
        if (L < p.minLen) continue;
        const bucket = WORDS_BY_LENGTH[L]; if (!bucket) continue;
        for (const idx of bucket) {
          const w = WORD_LIST[idx];
          if (w.endsWith(suffix)) out.push(idx);
        }
      }
      return out;
    }
    case 'contains': {
      const sub = p.data.substring;
      for (let L = Math.max(effMin, sub.length); L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
        const bucket = WORDS_BY_LENGTH[L]; if (!bucket) continue;
        for (const idx of bucket) {
          const w = WORD_LIST[idx];
          if (w.indexOf(sub) !== -1) out.push(idx);
        }
      }
      return out;
    }
    case 'prefixSuffix': {
      const { prefix, suffix, gapMin, unboundedGap } = p.data;
      const pLen = prefix.length, sLen = suffix.length;
      for (let L = Math.max(effMin, pLen + sLen + gapMin); L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
        if (!unboundedGap && L !== pLen + sLen + gapMin) continue; // fixed interior size
        const gapLen = L - pLen - sLen;
        if (gapLen < gapMin) continue;
        const bucket = WORDS_BY_LENGTH[L]; if (!bucket) continue;
        for (const idx of bucket) {
          const w = WORD_LIST[idx];
          if (!w.startsWith(prefix)) continue;
            if (!w.endsWith(suffix)) continue;
          out.push(idx);
        }
      }
      return out;
    }
    case 'mask': {
      const { length, runs } = p.data;
      if (length < effMin || length > effMax) return [];
      const bucket = WORDS_BY_LENGTH[length]; if (!bucket) return [];
      outer: for (const idx of bucket) {
        const w = WORD_LIST[idx];
        for (const r of runs) {
          if (w.substr(r.pos, r.value.length) !== r.value) continue outer;
        }
        out.push(idx);
      }
      return out;
    }
    case 'generic': {
      const { regex } = p.data;
      for (let L = effMin; L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
        const bucket = WORDS_BY_LENGTH[L]; if (!bucket) continue;
        for (const idx of bucket) {
          const w = WORD_LIST[idx]; if (regex.test(w)) out.push(idx);
        }
      }
      return out;
    }
    default: return [];
  }
}

// ------------------ Anagram Search (with optional digraph tokens) ------------------
// Supports input like:
//   "past(er)"  -> letters p a s t e r with required digraph substring "er"
//   "e(th)(er)" -> letters e t h e r with required digraphs "th" and "er"
// Behavior:
//   1. Expand all tokens into their letters (digraph tokens contribute their letters)
//   2. Lookup candidate anagrams via letter multiset signature
//   3. If digraph tokens were specified AND a global DIGRAPHS set exists and contains them, filter
//      candidates requiring each digraph substring to appear at least the specified count (non-overlapping per digraph).
//   4. If token text inside parentheses is not a known digraph, it is treated as plain letters.
// Edge cases: unmatched '(' ignored; empty pattern returns [].
function searchAnagrams(pattern) {
  ensureInit();
  if (pattern == null) return [];
  const input = String(pattern).trim();
  if (!input) return [];

  const digraphsAvailable = (typeof DIGRAPHS !== 'undefined' && DIGRAPHS && typeof DIGRAPHS.has === 'function');
  const digraphCounts = Object.create(null);
  const letters = [];
  let sawDigraphToken = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(') {
      const j = input.indexOf(')', i+1);
      if (j === -1) continue; // skip unmatched
      const token = input.slice(i+1, j).toLowerCase();
      i = j; // advance
      if (token) {
        if (digraphsAvailable && DIGRAPHS.has(token)) {
          digraphCounts[token] = (digraphCounts[token] || 0) + 1;
          sawDigraphToken = true;
          for (const c of token) letters.push(c);
        } else {
          // treat chars individually
            for (const c of token) if (/[a-z]/.test(c)) letters.push(c);
        }
      }
    } else if (/[a-z]/i.test(ch)) {
      letters.push(ch.toLowerCase());
    }
  }

  if (!letters.length) return [];
  const sig = letters.sort().join('');
  const candidates = ANAGRAM_INDEX.get(sig);
  if (!candidates) return [];

  const needFilter = sawDigraphToken && digraphsAvailable && Object.keys(digraphCounts).length;
  if (!needFilter) return candidates.slice();

  const out = [];
  candidateLoop: for (const idx of candidates) {
    const w = WORD_LIST[idx];
    for (const [dg, need] of Object.entries(digraphCounts)) {
      let found = 0; let pos = 0;
      while (found < need) {
        const p = w.indexOf(dg, pos);
        if (p === -1) { found = -1; break; }
        found++;
        pos = p + dg.length; // non-overlapping occurrences for same digraph
      }
      if (found < need) continue candidateLoop;
    }
    out.push(idx);
  }
  return out;
}

// Namespace export (browser/global)
const WordSearch = {
  init: ensureInit,
  stats,
  searchRegex,
  searchAnagrams,
  getWords,
  // (internal/raw) - expose cautiously for debugging / future optimizations
  _internal: () => ({ WORD_LIST, WORD_TO_INDEX, WORDS_BY_LENGTH, ANAGRAM_INDEX })
};

if (typeof window !== 'undefined') {
  window.WordSearch = window.WordSearch || WordSearch;
  // Expose individual globals
  window.wordSearchInit = ensureInit;
  window.wordSearchStats = stats;
  window.wordSearchRegex = searchRegex;
  window.wordSearchAnagrams = searchAnagrams;
  window.wordSearchGetWords = getWords;
  window.parseSimplifiedRegex = parseSimplifiedRegex;
} else {
  globalThis.WordSearch = globalThis.WordSearch || WordSearch;
  globalThis.wordSearchInit = ensureInit;
  globalThis.wordSearchStats = stats;
  globalThis.wordSearchRegex = searchRegex;
  globalThis.wordSearchAnagrams = searchAnagrams;
  globalThis.wordSearchGetWords = getWords;
  globalThis.parseSimplifiedRegex = parseSimplifiedRegex;
}
