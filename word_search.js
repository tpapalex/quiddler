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
  // Allow digraph parentheses: remove them if they wrap a known digraph so letters remain contiguous.
  let tmp = raw.replace(/\s+/g,'');
  // Strip valid digraph parentheses (always available)
  tmp = tmp.replace(/\(([a-zA-Z]+)\)/g, (m, inner) => DIGRAPHS.has(inner.toLowerCase()) ? inner : '');
  let cleaned = tmp.replace(/[^a-zA-Z.*+]/g,'');
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
  if (out.length > 1) out.sort((a,b)=>a-b);
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
  if (out.length > 1) out.sort((a,b)=>a-b);
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
  if (out.length > 1) out.sort((a,b)=>a-b);
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
  if (out.length > 1) out.sort((a,b)=>a-b);
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
  if (out.length > 1) out.sort((a,b)=>a-b);
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
    if (out.length > 1) out.sort((a,b)=>a-b);
        return out;
    }
    default: return [];
  }
}

// ------------------ Anagram Search (assumes prior validation) ------------------
// Pattern (already validated) may contain parenthesized digraph tokens like (th)(er) along with plain letters.
// Length of an anagram is fixed = total letters (digraph letters included individually).
function searchAnagrams(pattern, { minLen = 0, maxLen = Infinity } = {}) {
  ensureInit();
  if (pattern == null) return [];
  const input = String(pattern).trim(); if (!input) return [];

  const digraphCounts = Object.create(null);
  const letters = [];
  const tokenRe = /\([a-zA-Z]+\)|[a-zA-Z]/g;
  let m;
  while((m = tokenRe.exec(input)) !== null){
    const tok = m[0];
    if(tok.startsWith('(')){
      const inner = tok.slice(1,-1).toLowerCase();
      if (inner.length === 2 && DIGRAPHS && DIGRAPHS.has(inner)) {
        digraphCounts[inner] = (digraphCounts[inner]||0)+1;
        letters.push(inner[0], inner[1]);
      } else {
        // treat as plain letters if not a recognized digraph (should already be validated upstream)
        for(const ch of inner) letters.push(ch);
      }
    } else {
      letters.push(tok.toLowerCase());
    }
  }
  const sig = letters.slice().sort().join('');
  const candidates = ANAGRAM_INDEX.get(sig);
  if (!candidates) return [];

  if (!Object.keys(digraphCounts).length) return candidates.slice();

  const out = [];
  candidateLoop: for (const idx of candidates) {
    const w = WORD_LIST[idx];
    for (const [dg, need] of Object.entries(digraphCounts)) {
      let found = 0, pos = 0;
      while (found < need) {
        const p = w.indexOf(dg, pos);
        if (p === -1) { found = -1; break; }
        found++; pos = p + dg.length; // non-overlapping
      }
      if (found < need) continue candidateLoop;
    }
    out.push(idx);
  }
  return out;
}

// ------------------ Sub-anagram (rack subset) search ------------------
// Returns all dictionary words formable from given rack pattern (letters + parenthesized digraph tokens)
// Options: { minLen=2, maxLen=Infinity }
function searchSubanagrams(rackPattern, { minLen = 0, maxLen = Infinity, allowSingleDigraph = true } = {}) {
  ensureInit();
  if (rackPattern == null) return [];
  const text = String(rackPattern).trim(); if (!text) return [];
  const tokens = parseCards(text).map(normalizeToken);
  if (!tokens.length) return [];
  const rackCounts = countRack(tokens, DIGRAPHS);
  const trie = getValidWordTrie();
  const cands = generateWordCandidates(trie, rackCounts, { minLen, maxLen, allowSingleDigraph});
  const out = [];
  for (const c of cands) {
    if (c.length < minLen || c.length > maxLen) continue;
    const pw = plainWord(c.word).toLowerCase();
    const idx = WORD_TO_INDEX.get(pw);
    if (idx != null) out.push(idx);
  }
  out.sort((a,b)=>a-b);
  // dedupe
  const dedup = []; let prev = -1;
  for (const i of out) { if (i !== prev) dedup.push(i); prev = i; }
  return dedup;
}

// ------------------ Validation Helpers ------------------
// Return shape: { ok:true, normalized, type } OR { ok:false, errors:[ {code,message,details?} ... ] }
function vErr(code, message, details) { return { code, message, details }; }

// Shared scanner for parentheses-wrapped digraph tokens.
// Options:
//   strip: remove parentheses for valid digraph tokens in returned stripped string (default true)
//   requireValid: if true, any parenthesized token not in digraph set yields error
//   allowParens: if false, any parentheses produce error
//   allowNested: if false, a '(' encountered while already open produces error
function _scanDigraphParens(input, { strip = true, requireValid = true, allowParens = true, allowNested = false } = {}) {
  const digraphSet = DIGRAPHS; // assume defined
  const errors = [];
  let out = '';
  let i = 0; let open = false; let start = -1;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '(') {
      if (!allowParens) { errors.push(vErr('parentheses-not-allowed','Parentheses not allowed',{ index:i })); i++; continue; }
      if (open && !allowNested) errors.push(vErr('nested-parentheses','Nested parentheses not allowed',{ index:i }));
      open = true; start = i; i++; continue;
    }
    if (ch === ')') {
      if (!open) { errors.push(vErr('unmatched-close','Unmatched closing parenthesis',{ index:i })); i++; continue; }
      const token = input.slice(start+1, i);
      if (!/^[a-zA-Z]+$/.test(token)) {
        errors.push(vErr('invalid-digraph-chars','Non-letter characters inside parentheses',{ token }));
  } else if (requireValid && !digraphSet.has(token.toLowerCase())) {
        errors.push(vErr('invalid-digraph','Parenthesized token is not a valid digraph',{ token }));
      }
  if (strip && (!requireValid || digraphSet.has(token.toLowerCase()))) {
        out += token; // keep letters only
      } else {
        out += '(' + token + ')';
      }
      open = false; start = -1; i++; continue;
    }
    // regular char
    if (!open) out += ch; // inside open we'll append after closing to avoid mixing
    i++;
  }
  if (open) errors.push(vErr('unmatched-open','Unmatched opening parenthesis',{ index:start }));
  return { errors, stripped: out };
}

// Regex validation (simplified dialect: letters, ., *, + only). Parentheses invalid here.
function validateRegex(pattern) {
  if (pattern == null) return { ok:false, errors:[vErr('invalid','Unmatched parentheses')] }; // generic null treated later by UI
  const raw = String(pattern); const input = raw.trim();
  if (!input) return { ok:false, errors:[vErr('empty','Empty pattern')] };
  return buildMinimalValidation('regex', input);
}

// Shared for anagram / subanagram inputs
function validateAnagramLike(pattern, type) {
  if (pattern == null) return { ok:false, errors:[vErr('invalid','Unmatched parentheses')] };
  const raw = String(pattern); const input = raw.trim();
  if (!input) return { ok:false, errors:[vErr('empty','Empty pattern')] };
  return buildMinimalValidation(type==='subanagrams'?'subanagram':type, input);
}
function validateAnagrams(p) { return validateAnagramLike(p,'anagrams'); }
function validateSubanagrams(p) { return validateAnagramLike(p,'subanagrams'); }

// --- Minimal validation builder (shared) ---
// Priority:
// 1. Unmatched parentheses -> 'Unmatched parentheses'
// 2. Nested parentheses   -> 'Nested parentheses'
// 3. Parentheses tokens length > 2 -> 'Invalid pattern in parentheses: aaaa, bbb'
// 4. Invalid digraphs (length 2 but not in DIGRAPHS) -> 'Invalid digraphs: xx, yy'
// 5. Invalid characters -> 'Invalid characters: %, @'
function buildMinimalValidation(kind, input){
  // Collect parenthesis tokens & structural issues
  const unmatched = { open:false, close:false };
  let nested = false;
  const invalidPatternTokens = new Set(); // tokens whose length != 2 OR contain non-letters
  const invalidDigraphs = new Set();      // length 2 tokens not in digraph list
  const digraphSet = DIGRAPHS || new Set();
  let open=false; let start=-1; let depth=0; const chars=[...input];
  for (let i=0;i<chars.length;i++) {
    const ch = chars[i];
    if (ch==='(') {
      if (open) nested = true; // '(' inside open without closing
      open = true; start = i; depth++;
      if (depth>1) nested = true;
      continue;
    }
    if (ch===')') {
      if (!open) { unmatched.close = true; continue; }
      const token = input.slice(start+1, i);
      // classify token
      if (/^[a-zA-Z]+$/.test(token)) {
        const low = token.toLowerCase();
        if (token.length === 2) {
          if (!digraphSet.has(low)) invalidDigraphs.add(low); // valid length, but not an existing digraph
        } else { // length 1 or >2
          invalidPatternTokens.add(low);
        }
      } else {
        invalidPatternTokens.add(token.toLowerCase());
      }
      open=false; depth--; if (depth<0) depth=0; // safety
      continue;
    }
  }
  if (open) unmatched.open = true;
  // Build invalid character set (ignore inside logic, just scan globally with allowed sets)
  const invalidChars = new Set();
  // Remove paren groups for invalid char scanning (except we still count parentheses themselves only for unmatched logic)
  const stripped = input.replace(/\([^)]+\)/g,'');
  for (const ch of stripped) {
    if (/[a-zA-Z]/.test(ch)) continue;
    if (kind==='regex') { if (ch==='.'||ch==='*'||ch==='+'||/\s/.test(ch)||ch==='('||ch===')') continue; }
    else { if (/\s/.test(ch) || ch==='(' || ch===')') continue; }
    if (kind==='length') { if (/[0-9+\-<=]/.test(ch)) continue; }
    invalidChars.add(ch);
  }
  // Priority selection
  if (unmatched.open || unmatched.close) return { ok:false, errors:[vErr('unmatched','Unmatched parentheses')] };
  if (nested) return { ok:false, errors:[vErr('nested','Nested parentheses')] };
  if (invalidPatternTokens.size) {
    const listed = [...invalidPatternTokens].map(t=>'('+t+')').join(', ');
    return { ok:false, errors:[vErr('invalid-digraph-pattern','Invalid digraph pattern: '+listed)] };
  }
  if (invalidDigraphs.size) {
    const listed = [...invalidDigraphs].map(t=>'('+t+')').join(', ');
    return { ok:false, errors:[vErr('bad-digraph','Non-existent digraphs: '+listed)] };
  }
  if (invalidChars.size) return { ok:false, errors:[vErr('invalid-chars','Invalid characters: '+[...invalidChars].join(', '))] };
  return { ok:true, normalized: normalizePostValidation(kind, input), type: kind };
}

function normalizePostValidation(kind, input){
  // For regex we still need stripped form (remove valid digraph parens tokens)
  if (kind==='regex') {
    // Remove parentheses around valid digraphs only
    return input.replace(/\(([a-zA-Z]+)\)/g,(m,inner)=>{
      const low=inner.toLowerCase();
      return (DIGRAPHS && DIGRAPHS.has(low)) ? inner : m; // keep original if not valid digraph (will have errored earlier)
    });
  }
  return input;
}

// ------------------ Length Pattern Parsing & Validation ------------------
// Supported syntaxes (whitespace ignored):
//   n         exact length n (e.g. "3")
//   n-m       inclusive range (e.g. "3-5")
//   <=n       max length n
//   >=n       min length n
//   <n        max length n-1 (if n>0 else 0)
//   >n        min length n+1
//   n+        shorthand for >=n
//   -n        shorthand for <=n
//   -         ANY length (no constraint)  [NEW]
// Additional accepted forms:
//   m-        shorthand for >=m  (e.g. "5-" => >=5)
// Returns { ok:true, minLen, maxLen, source, normalized } or { ok:false, errors:[...] }
function parseLengthPattern(pattern) {
  if (pattern == null) return { ok:false, errors:[vErr('null-pattern','Pattern is null/undefined')] };
  const source = String(pattern);
  const raw = source.trim();
  if (!raw) return { ok:false, errors:[vErr('empty-pattern','Pattern is empty')] };
  const p = raw.replace(/\s+/g,'');
  const errors = [];
  let minLen = 0, maxLen = Infinity;
  const num = n => {
    if (!/^\d+$/.test(n)) { errors.push(vErr('invalid-number','Invalid number',{ token:n })); return null; }
    return parseInt(n,10);
  };

  function finish() {
    if (errors.length) return { ok:false, errors };
    if (minLen < 0) errors.push(vErr('neg-length','Negative length not allowed',{ minLen }));
    if (maxLen < 0) errors.push(vErr('neg-length','Negative length not allowed',{ maxLen }));
    if (minLen > maxLen) errors.push(vErr('range-order','Min length exceeds max length',{ minLen, maxLen }));
    if (errors.length) return { ok:false, errors };
    return { ok:true, minLen, maxLen, source, normalized:p };
  }

  // Exact n
  // Standalone '-' means any length (no constraint)
  if (p === '-') {
    minLen = 0; maxLen = Infinity; return finish();
  }
  if (/^\d+$/.test(p)) {
    const n = num(p); if (n == null) return { ok:false, errors };
    minLen = maxLen = n; return finish();
  }
  // Range n-m
  if (/^(\d+)-(\d+)$/.test(p)) {
    const [,a,b] = p.match(/^(\d+)-(\d+)$/);
    const n1 = num(a), n2 = num(b); if (n1==null||n2==null) return { ok:false, errors };
    minLen = n1; maxLen = n2; return finish();
  }
  // Open range m- (>= m)
  if (/^(\d+)-$/.test(p)) {
    const [,a] = p.match(/^(\d+)-$/); const n1 = num(a); if (n1==null) return { ok:false, errors };
    minLen = n1; maxLen = Infinity; return finish();
  }
  // Shorthand -n (<= n)
  if (/^-\d+$/.test(p)) {
    const n = num(p.slice(1)); if (n==null) return { ok:false, errors };
    minLen = 0; maxLen = n; return finish();
  }
  // >=n / <=n / >n / <n
  if (/^(>=|<=|>|<)\d+$/.test(p)) {
    const [,op,numStr] = p.match(/^(>=|<=|>|<)(\d+)$/);
    const n = numStr ? parseInt(numStr,10) : null; if (n==null) return { ok:false, errors };
    if (op==='>=') { minLen = n; }
    else if (op==='<=') { maxLen = n; }
    else if (op==='>') { minLen = n + 1; }
    else if (op==='<') { maxLen = Math.max(0, n - 1); }
    return finish();
  }
  // n+ shorthand for >= n
  if (/^\d+\+$/.test(p)) {
    const n = num(p.slice(0,-1)); if (n==null) return { ok:false, errors };
    minLen = n; return finish();
  }

  errors.push(vErr('unrecognized','Unrecognized length pattern',{ pattern: p }));
  return { ok:false, errors };
}

function validateLengthPattern(pattern) { return parseLengthPattern(pattern); }

// ------------------ Multi-search (intersection) ------------------
// specs: array of { type: 'regex'|'anagram'|'subanagram'|'length', pattern: string }
// Returns { ok:true, indices:[...], words:[], plan:[...], minLen, maxLen } or { ok:false, errors:[...] }

// Caches
const __regexParseCache = new Map();    // pattern -> parsed regex object
const __anagramCache    = new Map();    // pattern -> indices array
const __subanaCache     = new Map();    // pattern -> indices array (default minLen=0,max=Inf, allowSingleDigraph true)

function intersectSorted(a, b) {
  if (!a || !a.length) return [];
  if (!b || !b.length) return [];
  const out = []; let i=0,j=0;
  while (i < a.length && j < b.length) {
    const x=a[i], y=b[j];
    if (x===y) { out.push(x); i++; j++; }
    else if (x<y) i++; else j++;
  }
  return out;
}

function uniqueSorted(arr) {
  if (!arr.length) return arr;
  const out=[]; let prev=arr[0]-1;
  for (const v of arr) { if (v!==prev) out.push(v); prev=v; }
  return out;
}

function estimateRegexSelectivity(parsed) {
  if (!parsed || parsed.error) return 0.5; // unknown
  switch (parsed.type) {
    case 'literal': return 0.0001;
    case 'mask': return 0.01;
    case 'prefixSuffix': return parsed.unbounded ? 0.1 : 0.05;
    case 'prefix':
    case 'suffix': return 0.1;
    case 'contains': return 0.3;
    case 'any': return 1.0;
    default: return 0.6; // generic
  }
}

function signatureForAnagramPattern(pattern) {
  // pattern already validated: collect letters & digraph letters
  const tokenRe=/\([a-zA-Z]+\)|[a-zA-Z]/g; const letters=[]; let m;
  while ((m=tokenRe.exec(pattern))!==null) {
    const tok=m[0];
    if (tok[0]==='(') {
      for (const c of tok.slice(1,-1).toLowerCase()) letters.push(c);
    } else letters.push(tok.toLowerCase());
  }
  return letters.sort().join('');
}

function rackMaxLengthSubanagram(pattern) {
  // sum letters of tokens (digraph counts letters). Use parseCards + normalizeToken
  const tokens = parseCards(pattern).map(normalizeToken);
  let total=0; for (const t of tokens) total += t.length; return total;
}

function rackCountsForPattern(pattern) {
  // Reuse solver's canonical countRack to avoid divergence.
  const tokens = parseCards(pattern).map(normalizeToken);
  return countRack(tokens, DIGRAPHS);
}

function canFormWordFromRack(word, rackCounts) {
  // Quick letter availability check combining singles+digraph contributions
  const need = Object.create(null);
  for (const c of word) need[c]=(need[c]||0)+1;
  for (const [ch, cnt] of Object.entries(need)) {
    let avail = (rackCounts.singleCounts[ch]||0);
    for (const [dg, c] of Object.entries(rackCounts.digraphCounts)) if (dg.includes(ch)) avail += c; // upper bound
    if (cnt > avail) return false;
  }
  // Backtracking exact cover using tokens
  const singles = { ...rackCounts.singleCounts };
  const digraphs = { ...rackCounts.digraphCounts };
  const dgList = Object.keys(digraphs).filter(d=>digraphs[d]>0);
  const memo = new Map();
  function key(i) {
    // compact key: i + serialized remaining digraph counts + first few singles counts for pruning
    let k = i+':';
    for (const dg of dgList) k+=dg+digraphs[dg]+';';
    // Optionally include remaining counts of letters in need subset to improve pruning
    return k;
  }
  function dfs(i) {
    if (i===word.length) return true;
    const k=key(i); if (memo.has(k)) return false; // only memo failures; successes return early
    const ch = word[i];
    // Try digraphs first (sometimes reduces branching)
    for (const dg of dgList) {
      const left = digraphs[dg]; if (left<=0) continue;
      if (word.startsWith(dg, i)) {
        digraphs[dg]--; if (dfs(i+dg.length)) return true; digraphs[dg]++;
      }
    }
    // Single letter option
    if ((singles[ch]||0) > 0) {
      singles[ch]--; if (dfs(i+1)) return true; singles[ch]++;
    }
    memo.set(k,false); return false;
  }
  return dfs(0);
}

// Lightweight upper-bound feasibility (no backtracking) used for quick pruning.
function quickLetterUpperBoundFeasible(word, rackCounts) {
  const need = Object.create(null);
  for (const c of word) need[c] = (need[c] || 0) + 1;
  for (const [ch, cnt] of Object.entries(need)) {
    let avail = (rackCounts.singleCounts[ch] || 0);
    for (const [dg, c] of Object.entries(rackCounts.digraphCounts)) if (dg.includes(ch)) avail += c;
    if (cnt > avail) return false;
  }
  return true;
}

// Heuristic: lower score => better (smaller branching) rack for base enumeration.
function scoreRackForEnumeration(rackCounts) {
  // Distinct token types (singles + digraphs) primary driver.
  let distinct = Object.keys(rackCounts.singleCounts).length + Object.keys(rackCounts.digraphCounts).length;
  // Total tiles (not letters) – larger adds branching.
  let totalTiles = 0; for (const v of Object.values(rackCounts.singleCounts)) totalTiles += v; for (const v of Object.values(rackCounts.digraphCounts)) totalTiles += v;
  // Vowel abundance increases branching slightly.
  const vowels = ['a','e','i','o','u'];
  let vowelTiles = 0; for (const v of vowels) vowelTiles += (rackCounts.singleCounts[v]||0);
  // Rare letters reduce branching (acts as anchor); subtract weight if present.
  const rareSet = ['q','z','j','x'];
  let rareBonus = 0; for (const r of rareSet) if ((rackCounts.singleCounts[r]||0) > 0) rareBonus += 1;
  // Digraph presence (esp. qu, th, ch, sh) also anchors.
  let digraphBonus = 0; for (const dg of Object.keys(rackCounts.digraphCounts)) { if (/qu|th|ch|sh|ph|wh/.test(dg)) digraphBonus += 0.5; }
  // Score formula (tuned heuristically):
  const score = distinct*50 + totalTiles*10 + vowelTiles*5 - rareBonus*30 - digraphBonus*15;
  return score;
}

// searchMulti(specs, { sortMode } = {})
//  - specs: array of spec objects (same as before)
//  - sortMode values:
//       'len+', 'len-' (length ascending / descending; ties alpha ascending)
//       'alpha+', 'alpha-' (alphabetical ascending / descending)
//    Aliases: 'length+', 'length-', 'length-asc', 'length-desc', 'alpha', 'alpha-asc', 'alpha-desc'
//  - Always returns words now (previous returnWords/debug removed).
function searchMulti(specs, { sortMode } = {}) {
  ensureInit();
  if (!Array.isArray(specs)) return { ok:false, errors:[vErr('invalid-args','Specs must be an array')] };
  if (!specs.length) return { ok:true, indices:[], words: [], plan:[], minLen:0, maxLen:Infinity };

  const errors=[]; const norm=[]; // normalized specs
  let globalMin=0, globalMax=Infinity;
  const anagramSignatures=new Set();
  const literalRegexWords=new Set();
  // First pass: validate & derive inherent length bounds
  for (const s of specs) {
    if (!s || typeof s!=='object') { errors.push(vErr('bad-spec','Spec must be object', { spec:s })); continue; }
    const { type, pattern } = s;
    if (!['regex','anagram','subanagram','length'].includes(type)) { errors.push(vErr('bad-type','Unknown search type',{ type })); continue; }
    if (pattern == null) { errors.push(vErr('null-pattern','Pattern null',{ type })); continue; }
    let valRes;
    if (type==='regex') valRes = validateRegex(pattern);
    else if (type==='anagram') valRes = validateAnagrams(pattern);
    else if (type==='subanagram') valRes = validateSubanagrams(pattern);
    else if (type==='length') {
      valRes = validateLengthPattern(pattern);
    }
    if (!valRes.ok) { errors.push(...valRes.errors.map(e=>({...e, type }))); continue; }

    let inherentMin=0, inherentMax=Infinity, meta={};
    if (type==='length') {
      inherentMin = valRes.minLen; inherentMax = valRes.maxLen;
    } else if (type==='regex') {
      // parse / cache
      let parsed = __regexParseCache.get(valRes.normalized);
      if (!parsed) { parsed = parseSimplifiedRegex(valRes.normalized); __regexParseCache.set(valRes.normalized, parsed); }
      if (parsed.error) { errors.push(vErr('parse-fail','Regex parse failed',{ pattern: valRes.normalized })); continue; }
      inherentMin = parsed.minLen; inherentMax = parsed.maxLen;
      meta.parsed = parsed;
      if (parsed.type==='literal') literalRegexWords.add(parsed.data.word);
    } else if (type==='anagram') {
      const sig = signatureForAnagramPattern(valRes.normalized);
      meta.signature = sig;
      const len = sig.length; inherentMin = len; inherentMax = len;
      anagramSignatures.add(sig);
    } else if (type==='subanagram') {
      const rackMax = rackMaxLengthSubanagram(valRes.normalized);
      inherentMin = 0; inherentMax = rackMax; // we don't assume min; could add option
  meta.rackCounts = rackCountsForPattern(valRes.normalized);
    }

    // apply to global bounds
    if (inherentMin > globalMin) globalMin = inherentMin;
    if (inherentMax < globalMax) globalMax = inherentMax;
    norm.push({ type, pattern: String(pattern), normalized: valRes.normalized, inherentMin, inherentMax, meta, options: s.options || {} });
  }
  if (errors.length) return { ok:false, errors };
  // Early unsatisfiable length bounds. Ensure consistent shape (include words:[]).
  if (globalMin > globalMax) return { ok:true, indices:[], words:[], plan:[{ reason:'length-contradiction', globalMin, globalMax }], minLen:globalMin, maxLen:globalMax, sortMode: normalizeSortMode(sortMode) };

  // Early contradictions
  if (anagramSignatures.size > 1) return { ok:true, indices:[], words:[], plan:[{ reason:'anagram-signature-mismatch' }], minLen:globalMin, maxLen:globalMax, sortMode: normalizeSortMode(sortMode) };
  if (literalRegexWords.size > 1) return { ok:true, indices:[], words:[], plan:[{ reason:'literal-mismatch' }], minLen:globalMin, maxLen:globalMax, sortMode: normalizeSortMode(sortMode) };
  // If both literal regex word and anagram signature present, ensure match
  if (literalRegexWords.size===1 && anagramSignatures.size===1) {
    const lit=[...literalRegexWords][0]; const sig=[...anagramSignatures][0];
  if (lit.split('').sort().join('') !== sig) return { ok:true, indices:[], words:[], plan:[{ reason:'literal-vs-anagram-mismatch' }], minLen:globalMin, maxLen:globalMax, sortMode: normalizeSortMode(sortMode) };
  }

  // Derive execution list (exclude pure length specs)
  const executables = norm.filter(s=> s.type !== 'length');
  if (!executables.length) {
    // Only length constraints; return all word indices within bounds
  const out=[]; for (let L=globalMin; L<=globalMax && L<WORDS_BY_LENGTH.length; L++) { const b=WORDS_BY_LENGTH[L]; if (b) out.push(...b); }
  // out is concatenation of per-length sorted buckets but not globally sorted; sort to preserve contract
  out.sort((a,b)=>a-b);
  let indices = uniqueSorted(out); // use let so we can reassign after sorting step
  let words = getWords(indices);
  ({ indices, words } = applySearchMultiSorting(indices, words, sortMode));
  return { ok:true, indices, words, plan:[{ type:'length-only', globalMin, globalMax, produced: indices.length, after: indices.length }], minLen:globalMin, maxLen:globalMax, sortMode: normalizeSortMode(sortMode) };
  }

  function rank(s) {
    if (s.type==='anagram') return 1;
    if (s.type==='regex') {
      const t = s.meta.parsed.type;
      if (t==='literal') return 0;
      if (t==='mask') return 2;
      if (t==='prefixSuffix' && !s.meta.parsed.unbounded) return 2;
      if (t==='prefix'||t==='suffix') return 3;
      if (t==='contains') return 4;
      if (t==='any') return 7; // low selectivity
      return 5; // generic
    }
    if (s.type==='subanagram') {
      const rackLen = s.inherentMax; // letters available
      return rackLen <= 7 ? 2 : (rackLen <= 10 ? 4 : 6);
    }
    return 8;
  }

  executables.sort((a,b)=> rank(a)-rank(b));

  // Sub-anagram base rack selection: choose the one with lowest enumeration score among sub-anagram specs.
  const subSpecs = executables.filter(s => s.type==='subanagram');
  if (subSpecs.length > 1) {
    for (const s of subSpecs) {
      if (!s.meta.rackCounts) s.meta.rackCounts = rackCountsForPattern(s.normalized);
      s.meta.enumerationScore = scoreRackForEnumeration(s.meta.rackCounts);
    }
    let best = subSpecs[0];
    for (const s of subSpecs) if (s.meta.enumerationScore < best.meta.enumerationScore) best = s;
    // Ensure best is earliest among subanagrams while keeping earlier higher-selectivity types (anagram/literal regex) ahead.
    const firstIdx = executables.findIndex(s => s.type==='subanagram');
    const bestIdx = executables.indexOf(best);
    if (bestIdx !== -1 && firstIdx !== -1 && bestIdx !== firstIdx) {
      const tmp = executables[firstIdx];
      executables[firstIdx] = executables[bestIdx];
      executables[bestIdx] = tmp;
    }
    best.meta.isBaseSub = true;
  } else if (subSpecs.length === 1) {
    // Single subanagram automatically base.
    subSpecs[0].meta.enumerationScore = scoreRackForEnumeration(subSpecs[0].meta.rackCounts || rackCountsForPattern(subSpecs[0].normalized));
    subSpecs[0].meta.isBaseSub = true;
  }

  let current = null;
  const plan=[];

  for (const spec of executables) {
    let produced=[];
    const t=spec.type;
    const minLen = globalMin, maxLen = globalMax;
  let action='enumerate';
  if (t==='subanagram' && spec.meta && spec.meta.isBaseSub) action='enumerate-base';
    if (t==='regex') {
      // literal: direct lookup + length check
      if (spec.meta.parsed.type==='literal') {
        const w=spec.meta.parsed.data.word; const idx = WORD_TO_INDEX.get(w);
        produced = (idx!=null && w.length>=minLen && w.length<=maxLen) ? [idx] : [];
      } else if (current) {
        // Filter existing candidates instead of full search
        const parsed=spec.meta.parsed;
        const kind=parsed.type;
        const out=[];
        const regexObj = (kind==='generic') ? parsed.data.regex : null;
        for (const idx of current) {
          const w = WORD_LIST[idx];
          if (w.length < minLen || w.length > maxLen) continue;
          let ok=false;
          switch(kind) {
            case 'any': ok = (w.length>=parsed.minLen && w.length<=parsed.maxLen); break;
            case 'prefix': ok = w.startsWith(parsed.data.prefix); break;
            case 'suffix': ok = w.endsWith(parsed.data.suffix); break;
            case 'contains': ok = w.includes(parsed.data.substring); break;
            case 'prefixSuffix': {
              const { prefix, suffix, gapMin, unboundedGap } = parsed.data;
              if (w.startsWith(prefix) && w.endsWith(suffix)) {
                const gapLen = w.length - prefix.length - suffix.length;
                ok = gapLen >= gapMin && (unboundedGap || gapLen===gapMin);
              }
              break;
            }
            case 'mask': {
              const { runs } = parsed.data; ok=true; for (const r of runs) { if (w.substr(r.pos, r.value.length)!==r.value) { ok=false; break; } }
              break; }
            case 'generic': ok = regexObj.test(w); break;
          }
          if (ok) out.push(idx);
        }
        produced = out;
      } else {
        produced = searchRegex(spec.normalized, { minLen, maxLen });
      }
    } else if (t==='anagram') {
      let cached = __anagramCache.get(spec.normalized);
      if (!cached) { cached = searchAnagrams(spec.normalized, { minLen, maxLen }); __anagramCache.set(spec.normalized, cached); }
      produced = cached;
    } else if (t==='subanagram') {
      const rackCounts = spec.meta.rackCounts || rackCountsForPattern(spec.normalized);
      // Decide enumeration vs filter dynamically if we already have a candidate set and this is not marked base.
      if (current && !spec.meta.isBaseSub) {
        // Heuristic: if current set small, filtering cheaper; else consider enumerating if rack small.
        const enumScore = spec.meta.enumerationScore != null ? spec.meta.enumerationScore : (spec.meta.enumerationScore = scoreRackForEnumeration(rackCounts));
        const FILTER_THRESHOLD = 2500; // size above which pure filtering may be slower
        const ENUM_SCORE_CUTOFF = 800; // rough heuristic for 'small' rack
        if (current.length > FILTER_THRESHOLD && enumScore < ENUM_SCORE_CUTOFF) {
          action='enumerate';
        } else {
          action='filter';
        }
      }
      if (action==='filter') {
        const out=[];
        for (const idx of current) {
          const w = WORD_LIST[idx];
          if (w.length < minLen || w.length > maxLen) continue;
          if (canFormWordFromRack(w, rackCounts)) out.push(idx);
        }
        produced = out;
      } else {
        let cached = __subanaCache.get(spec.normalized);
        if (!cached) { cached = searchSubanagrams(spec.normalized, { minLen, maxLen }); __subanaCache.set(spec.normalized, cached); }
        produced = cached;
        // Early pruning using other subanagram racks (upper-bound feasibility only) if this is the designated base.
        if (spec.meta.isBaseSub) {
          const otherSubRacks = executables.filter(s => s!==spec && s.type==='subanagram').map(s => s.meta.rackCounts || rackCountsForPattern(s.normalized));
            if (otherSubRacks.length) {
            const pre = produced.length;
            const pruned=[];
            for (const idx of produced) {
              const w = WORD_LIST[idx];
              let ok = true;
              for (const rc of otherSubRacks) { if (!quickLetterUpperBoundFeasible(w, rc)) { ok=false; break; } }
              if (ok) pruned.push(idx);
            }
            if (pruned.length !== produced.length) {
              spec.meta.prunedByOtherSubanagrams = pre - pruned.length;
              produced = pruned;
            }
          }
        }
      }
    }
    produced = uniqueSorted(produced);
    const after = current ? (action==='filter' ? produced : intersectSorted(current, produced)) : produced;
    plan.push({ type:t, pattern: spec.pattern, normalized: spec.normalized, produced: produced.length, before: current ? current.length : null, after: after.length, rank: rank(spec), action });
    current = after;
    if (!current.length) break;
  }

  let indices = current || [];
  let words = getWords(indices);
  ({ indices, words } = applySearchMultiSorting(indices, words, sortMode));
  return { ok:true, indices, words, plan, minLen:globalMin, maxLen:globalMax, sortMode: normalizeSortMode(sortMode) };
}

function normalizeSortMode(mode) {
  if (!mode) return null;
  const m = String(mode).toLowerCase().trim();
  if (['len+','length+','length-asc','len-asc','length','len','lengthasc'].includes(m)) return 'len+';
  if (['len-','length-','length-desc','len-desc','lengthdesc'].includes(m)) return 'len-';
  if (['alpha+','alpha','alpha-asc','a+','a-asc'].includes(m)) return 'alpha+';
  if (['alpha-','alpha-desc','a-','a-desc'].includes(m)) return 'alpha-';
  return null; // unknown -> no sorting
}

function applySearchMultiSorting(indices, words, sortMode) {
  const mode = normalizeSortMode(sortMode);
  if (!mode) return { indices, words }; // no sorting requested or unknown code
  const pairs = indices.map((idx,i)=>({ idx, word: words[i] }));
  const alphaAsc = (a,b)=> a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
  if (mode === 'len+') {
    pairs.sort((a,b)=> (a.word.length - b.word.length) || alphaAsc(a,b));
  } else if (mode === 'len-') {
    pairs.sort((a,b)=> (b.word.length - a.word.length) || alphaAsc(a,b));
  } else if (mode === 'alpha+') {
    pairs.sort(alphaAsc);
  } else if (mode === 'alpha-') {
    pairs.sort((a,b)=> -alphaAsc(a,b));
  }
  return {
    indices: pairs.map(p=>p.idx),
    words: pairs.map(p=>p.word)
  };
}

// Namespace export (browser/global)
const WordSearch = {
  init: ensureInit,
  stats,
  searchRegex,
  searchAnagrams,
  validateRegex,
  validateAnagrams,
  validateSubanagrams,
  parseLengthPattern,
  validateLengthPattern,
  searchSubanagrams,
  searchMulti,
  getWords,
  // Helper: given a raw Contains pattern (now may include wildcards) produce a regex-compatible pattern.
  // Rules: empty => '*'; otherwise wrap with leading & trailing '*' unless already supplied.
  transformContainsPattern(raw) {
    if (raw == null) return '*';
    let p = String(raw).trim();
    if (!p) return '*';
    // Do not double-wrap if user already started/ended with '*'
    if (!p.startsWith('*')) p = '*' + p;
    if (!p.endsWith('*')) p = p + '*';
    return p;
  },
};

// Ensure global access for UI scripts using window.WordSearch (const does not auto-attach)
try { if (typeof window !== 'undefined') { window.WordSearch = WordSearch; } } catch(_){ }

// ---- Word Search InputValidation integration (migrated from inline script) ----
;(function(){
  if (typeof window === 'undefined') return;
  if (!window.InputValidation) return; // framework not loaded yet
  // Obtain the digraph set. Note: top-level `const DIGRAPHS` does NOT become window.DIGRAPHS.
  // We defined DIGRAPHS in card_scores.js (as a top-level const) and also exposed it under window.QuiddlerData.
  const DIG = (typeof DIGRAPHS !== 'undefined')
    ? DIGRAPHS
    : (window.QuiddlerData && window.QuiddlerData.DIGRAPHS) ? window.QuiddlerData.DIGRAPHS : new Set();
  const ALLOWED = {
  regex: /[a-zA-Z.*+()]/g,
  // Contains now supports same wildcard meta set as regex (letters, ., *, +, parentheses for digraph convenience)
  contains: /[a-zA-Z.*+()]/g,
    anagram: /[a-zA-Z()]/g,
    subanagram: /[a-zA-Z()]/g,
    length: /[0-9+\-<=]/g,
  };
  function collectParenTokens(input){
    let open=-1; let nested=false; let unmatchedOpen=false; let unmatchedClose=false; const tokens=[]; const chars=[...input];
    for(let i=0;i<chars.length;i++){
      const ch=chars[i];
      if(ch==='('){ if(open!==-1) nested=true; open=i; }
      else if(ch===')'){
        if(open===-1){ unmatchedClose=true; }
        else { const inner=input.slice(open+1,i); tokens.push(inner); open=-1; }
      }
    }
    if(open!==-1) unmatchedOpen=true;
    return { tokens, nested, unmatchedOpen, unmatchedClose };
  }
  // --- Per-type validators (extracted for clarity) ---
  // Contains validator now mirrors regex (wildcards) but applies relaxed rules:
  //  - Allows empty (treated as no filter) and meta-only (e.g. '*') which map to 'any'.
  //  - Parentheses for digraphs validated like anagram/regex; valid digraph parens are stripped upstream.
  function validateContains(val){
    const trimmed = (val==null?'':String(val)).trim();
    if (!trimmed) return { status:'ok' }; // empty accepted => no filter
    // Reuse regex-style validator with meta allowed
    const scan=collectParenTokens(trimmed);
    if(scan.unmatchedOpen || scan.unmatchedClose) return { status:'error', message:'Unmatched parentheses' };
    if(scan.nested) return { status:'error', message:'Nested parentheses' };
    const invalidDigraphPattern=[]; const badDigraph=[]; const invalidChars=new Set();
    for(const inner of scan.tokens){
      if(!/^[a-zA-Z]+$/.test(inner)){ invalidDigraphPattern.push('('+inner.toLowerCase()+')'); continue; }
      if(inner.length!==2){ invalidDigraphPattern.push('('+inner.toLowerCase()+')'); continue; }
      if(!DIG.has(inner.toLowerCase())) badDigraph.push('('+inner.toLowerCase()+')');
    }
  if(invalidDigraphPattern.length) return { status:'error', message:'Invalid digraph pattern: '+invalidDigraphPattern.join(', ') };
  if(badDigraph.length) return { status:'warning', message:'Non-existent digraphs: '+badDigraph.join(', ') };
    const stripped=trimmed.replace(/\([^)]+\)/g,'');
    for(const ch of stripped){
      if(/[a-zA-Z.*+]/.test(ch)) continue;
      if(/[()\s]/.test(ch)) continue;
      invalidChars.add(ch);
    }
    if(invalidChars.size) return { status:'error', message:'Invalid characters: '+[...invalidChars].join(', ') };
    return { status:'ok' };
  }
  function validateLength(val){
    const p=val.replace(/\s+/g,'');
    const errors=[]; const num=n=> /^\d+$/.test(n)? parseInt(n,10):(errors.push('Invalid number: '+n), null);
    let minLen=0, maxLen=Infinity; const finish=()=>{ if(minLen<0||maxLen<0) errors.push('Negative length not allowed'); if(minLen>maxLen) errors.push('Min length exceeds max length'); return errors; };
  if(p==='-'){ const errs=finish(); return errs.length? { status:'error', message:errs.join('; ') } : { status:'ok' }; }
    if(/^\d+$/.test(p)){ const n=num(p); if(n!=null){ minLen=maxLen=n; } const errs=finish(); return errs.length? { status:'error', message:errs.join('; ') } : { status:'ok' }; }
    if(/^(\d+)-(\d+)$/.test(p)){ const [,a,b]=p.match(/^(\d+)-(\d+)$/); const n1=num(a), n2=num(b); if(n1!=null&&n2!=null){ minLen=n1; maxLen=n2; } const errs=finish(); return errs.length? { status:'error', message:errs.join('; ') } : { status:'ok' }; }
    if(/^(\d+)-$/.test(p)){ const [,a]=p.match(/^(\d+)-$/); const n=num(a); if(n!=null) minLen=n; const errs=finish(); return errs.length? { status:'error', message:errs.join('; ') } : { status:'ok' }; }
    if(/^-(\d+)$/.test(p)){ const n=num(p.slice(1)); if(n!=null){ minLen=0; maxLen=n; } const errs=finish(); return errs.length? { status:'error', message:errs.join('; ') } : { status:'ok' }; }
    if(/^(>=|<=|>|<)\d+$/.test(p)){ const [,op,numStr]=p.match(/^(>=|<=|>|<)(\d+)$/); const n=parseInt(numStr,10); if(op==='>=') minLen=n; else if(op==='<=') maxLen=n; else if(op==='>') minLen=n+1; else if(op==='<') maxLen=Math.max(0,n-1); const errs=finish(); return errs.length? { status:'error', message:errs.join('; ') } : { status:'ok' }; }
    if(/^\d+\+$/.test(p)){ const n=num(p.slice(0,-1)); if(n!=null) minLen=n; const errs=finish(); return errs.length? { status:'error', message:errs.join('; ') } : { status:'ok' }; }
    return { status:'error', message:'Unrecognized length pattern' };
  }
  function validateParenAware(val, { allowMeta=false, warnLargeSub=false }={}){
    const scan=collectParenTokens(val);
    if(scan.unmatchedOpen || scan.unmatchedClose) return { status:'error', message:'Unmatched parentheses' };
    if(scan.nested) return { status:'error', message:'Nested parentheses' };
    const invalidDigraphPattern=[]; const badDigraph=[]; const invalidChars=new Set();
    for(const inner of scan.tokens){
      if(!/^[a-zA-Z]+$/.test(inner)){ invalidDigraphPattern.push('('+inner.toLowerCase()+')'); continue; }
      if(inner.length!==2){ invalidDigraphPattern.push('('+inner.toLowerCase()+')'); continue; }
      if(!DIG.has(inner.toLowerCase())) badDigraph.push('('+inner.toLowerCase()+')');
    }
  if(invalidDigraphPattern.length) return { status:'error', message:'Invalid digraph pattern: '+invalidDigraphPattern.join(', ') };
  if(badDigraph.length) return { status:'warning', message:'Non-existent digraphs: '+badDigraph.join(', ') };
    const stripped=val.replace(/\([^)]+\)/g,'');
    for(const ch of stripped){
      if(allowMeta){ if(/[a-zA-Z.*+]/.test(ch)) continue; }
      else { if(/[a-zA-Z]/.test(ch)) continue; }
      if(/[()\s]/.test(ch)) continue;
      invalidChars.add(ch);
    }
    if(invalidChars.size) return { status:'error', message:'Invalid characters: '+[...invalidChars].join(', ') };
    if(warnLargeSub){
      let letters=0; const tokenRe=/\([^)]+\)|[a-zA-Z]/g; let m; while((m=tokenRe.exec(val))!==null){ const tok=m[0]; letters += tok.startsWith('(')? tok.length-2 : 1; }
      if(letters>15) return { status:'warning', message:'Large rack, search may time out' };
    }
    return { status:'ok' };
  }
  const validators = {
    contains: v => validateContains(v),
    length: v => validateLength(v),
    regex: v => validateParenAware(v, { allowMeta:true }),
    anagram: v => validateParenAware(v),
    subanagram: v => validateParenAware(v, { warnLargeSub:true }),
  };
  function validateByType(type, raw){
    const val = (raw==null?'':String(raw)).trim(); if(!val) return { status:'ok' };
    const fn = validators[type] || validators.regex;
    return fn(val);
  }
  // Register once (dynamic covers future rows)
  try {
    const reg = window.InputValidation.register({
      selector:'#searchRows .ws-input', dynamic:true, groupId:'word-search', debounceMs:600, showTooltipOn:'hover', errorClass:'ws-error',
      allowed:function(currentValue, prevValue, ev){
        try {
          const el = ev && ev.target && ev.target.classList && ev.target.classList.contains('ws-input') ? ev.target : this;
          const row = el && el.closest ? el.closest('div') : null;
          const sel = row ? row.querySelector('.ws-type') : null;
          const type = sel ? sel.value : 'regex';
          const re = ALLOWED[type] || /[\s\S]/g;
          const filtered = (currentValue.match(re)||[]).join('');
          if (el && filtered !== currentValue) { el.value = filtered; }
          return filtered;
        } catch(_){ return currentValue; }
      },
      validate:function(value, el){ const row=el.closest('div'); const sel=row?row.querySelector('.ws-type'):null; const type=sel?sel.value:'regex'; return validateByType(type, value); }
    });
    // Revalidate inputs when their type select changes (new rules may apply)
    const rowsContainer = document.getElementById('searchRows');
    if(rowsContainer){
      rowsContainer.addEventListener('change', (e)=>{
        const sel = e.target && e.target.classList && e.target.classList.contains('ws-type') ? e.target : null;
        if(!sel) return;
        const row = sel.closest('div');
        const inp = row ? row.querySelector('.ws-input') : null;
        if(inp && window.InputValidation && typeof window.InputValidation.validateElement==='function'){
          // Defer so the other listener (which focuses/selects input) runs first; instance created after focus won't auto-show.
          setTimeout(()=>{ window.InputValidation.validateElement(inp); },0);
        }
      });
    }
    // Remove default Tailwind focus ring utility classes from dynamically created inputs to avoid blue halo overriding ws-error outline.
    const stripFocusRings = (el) => {
      if(!el || !el.classList) return; el.classList.forEach(cls=>{ if(/^focus:/.test(cls) && /ring/.test(cls)) el.classList.remove(cls); });
    };
    // Initial existing inputs
    document.querySelectorAll('#searchRows .ws-input').forEach(stripFocusRings);
    // Observe future additions via MutationObserver (already used by framework, but we add a small observer for style cleanup)
    const mo = new MutationObserver(muts=>{
      for(const m of muts){
        m.addedNodes.forEach(n=>{
          if(n.nodeType===1){ if(n.matches && n.matches('#searchRows .ws-input')) stripFocusRings(n); n.querySelectorAll && n.querySelectorAll('.ws-input').forEach(stripFocusRings); }
        });
      }
    });
    try { mo.observe(document.getElementById('searchRows'), { childList:true, subtree:true }); } catch(_){ }
  } catch(_){ }
})();
