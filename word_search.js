"use strict";
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
let WORD_LIST = []; // Array<string> lowercase words
let WORD_TO_INDEX = null; // Map<string, number>
let WORDS_BY_LENGTH = []; // Array<Array<number>>; index by length -> sorted arrays of word indices
let ANAGRAM_INDEX = null; // Map<string, Array<number>> signature -> sorted word indices (anagrams)
let WORD_LETTER_COUNTS = []; // Array<Uint8Array(26)> precomputed per-word letter frequency (a-z)

function ensureValidWordsMap() {
  if (typeof validWordsMap === "undefined" || !validWordsMap) {
    throw new Error("validWordsMap is not available globally");
  }
}

// (All signature / inventory logic intentionally omitted for now.)

// ------------------ Builders ------------------
function buildIndices() {
  ensureValidWordsMap();

  const keys = Object.keys(validWordsMap); // UPPERCASE dictionary keys
  WORD_LIST = keys.map((k) => k.toLowerCase());
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
    const sig = w.split("").sort().join("");
    const arr = ANAGRAM_INDEX.get(sig);
    if (arr) arr.push(i);
    else ANAGRAM_INDEX.set(sig, [i]);
    // Precompute letter counts (a-z only)
    const freq = new Uint8Array(26);
    for (let k = 0; k < w.length; k++) {
      const cc = w.charCodeAt(k) - 97; // assume lowercase
      if (cc >= 0 && cc < 26) freq[cc]++;
    }
    WORD_LETTER_COUNTS[i] = freq;
  }

  // Sort each length bucket for deterministic order
  for (const bucket of WORDS_BY_LENGTH) {
    if (Array.isArray(bucket)) bucket.sort((a, b) => a - b);
  }
  // Sort each anagram list (indices already ascending insertion by i, but keep safe if order changes later)
  for (const list of ANAGRAM_INDEX.values()) {
    list.sort((a, b) => a - b);
  }
}

function ensureInit() {
  if (!__initialized) {
    buildIndices();
    __initialized = true;
  }
}

// Helper to map indices to words (kept for convenience)
function getWords(indices) {
  ensureInit();
  return (indices || []).map((i) => WORD_LIST[i]);
}

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
// Internal configurable options for simplified regex.
// digraphUnits: if true, '.' / '*' / '+' operate on "units" where a unit is either a single letter OR any digraph in DIGRAPHS.
// This introduces variable-width for '.' (1-2 letters currently; future-proof for longer digraphs by using max digraph length).
let __regexOptions = { digraphUnits: true };
// Cache for parsed wildcard specs (pattern -> spec)
const __wildSpecCache = new Map();
function _setRegexOptions(opts) {
  if (opts && typeof opts === "object") {
    __regexOptions = { ...__regexOptions, ...opts };
  }
}
function _getRegexOptions() {
  return { ...__regexOptions };
}

function parseSimplifiedRegex(pattern, opts) {
  const { digraphUnits } = { ...__regexOptions, ...(opts || {}) };
  // Precompute digraph statistics if enabled.
  let digraphList = [];
  let maxDigraphLen = 2; // default assumption; updated if longer digraphs exist.
  if (digraphUnits) {
    // DIGRAPHS is guaranteed (per user constraint) to exist globally and be a Set.
    digraphList = Array.from(DIGRAPHS).filter((d) => /^[a-z]+$/i.test(d));
    // Sort longest-first for regex alternation stability.
    digraphList.sort((a, b) => b.length - a.length || a.localeCompare(b));
    for (const d of digraphList)
      if (d.length > maxDigraphLen) maxDigraphLen = d.length;
  }
  if (pattern == null) return { error: "null-pattern" };
  const raw = String(pattern).trim();
  if (!raw) return { error: "empty-pattern" };
  // Allow digraph parentheses: remove them if they wrap a known digraph so letters remain contiguous.
  let tmp = raw.replace(/\s+/g, "");
  // Strip valid digraph parentheses (always available)
  tmp = tmp.replace(/\(([a-zA-Z]+)\)/g, (m, inner) =>
    DIGRAPHS.has(inner.toLowerCase()) ? inner : ""
  );
  let cleaned = tmp.replace(/[^a-zA-Z.*+?]/g, "");
  if (!cleaned) return { error: "empty-after-clean" };
  cleaned = cleaned
    .replace(/\*+/g, "*")
    .replace(/\.\*/g, "+")
    .replace(/\*\+/g, "+")
    .replace(/\+\*/g, "+")
    .replace(/\*+/g, "*");
  if (!cleaned) return { error: "empty-after-clean" };

  // Single meta-only pattern fast path: '*' or '+'
  if (cleaned === "*" || cleaned === "+") {
    return {
      ok: true,
      type: "any",
      source: raw,
      normalized: cleaned,
      minLen: cleaned === "*" ? 0 : 1,
      maxLen: Infinity,
      unbounded: true,
      data: { minChar: cleaned === "*" ? 0 : 1 },
    };
  }

  // Tokenize
  const segments = [];
  let buf = "";
  const pushLit = () => {
    if (buf) {
      segments.push({ type: "lit", value: buf.toLowerCase() });
      buf = "";
    }
  };
  for (const ch of cleaned) {
    if (/[a-z]/i.test(ch)) {
      buf += ch;
      continue;
    }
    pushLit();
    if (ch === ".") segments.push({ type: "dot" });
    else if (ch === "*") segments.push({ type: "star" });
    else if (ch === "+") segments.push({ type: "plus" });
    else if (ch === "?") segments.push({ type: "opt" });
  }
  pushLit();
  if (!segments.length) return { error: "no-body" };

  const litCount = segments.filter((s) => s.type === "lit").length;

  // Literal only
  if (litCount === segments.length) {
    const word = segments.map((s) => s.value).join("");
    return {
      ok: true,
      type: "literal",
      source: raw,
      normalized: word,
      minLen: word.length,
      maxLen: word.length,
      unbounded: false,
      data: { word },
    };
  }

  const firstSeg = segments[0];
  const lastSeg = segments[segments.length - 1];

  // Helper scan for mandatory length
  const dotMin = 1;
  const dotMax = digraphUnits ? maxDigraphLen : 1; // variable width when digraph units enabled
  const minLenFromSegments = () => {
    let m = 0;
    for (const s of segments) {
      if (s.type === "lit") m += s.value.length;
      else if (s.type === "dot") m += dotMin;
      else if (s.type === "plus") m += 1; // plus contributes at least one unit
      else if (s.type === "opt") {
        /* 0 */
      }
      // star contributes 0
    }
    return m;
  };
  const maxLenFromSegments = () => {
    let m = 0;
    for (const s of segments) {
      if (s.type === "lit") m += s.value.length;
      else if (s.type === "dot") m += dotMax;
      else if (s.type === "opt") m += dotMax;
      else if (s.type === "plus" || s.type === "star") return Infinity; // unbounded
    }
    return m;
  };
  const hasUnbounded = segments.some(
    (s) => s.type === "star" || s.type === "plus"
  );
  const minLenAll = minLenFromSegments();
  const maxLenAll = hasUnbounded ? Infinity : maxLenFromSegments();

  // Meta-only unbounded pattern (no literals, at least one star/plus) => treat as 'any'
  if (litCount === 0 && hasUnbounded) {
    return {
      ok: true,
      type: "any",
      source: raw,
      normalized: cleaned,
      minLen: minLenAll,
      maxLen: Infinity,
      unbounded: true,
      data: { minChar: minLenAll },
    };
  }

  // Wildcard-only (all dots, no star/plus). If dot width fixed (no digraph units), treat as fixed-length any.
  // If variable-width (digraph units), fall through to generic so length range is honored.
  if (
    litCount === 0 &&
    !hasUnbounded &&
    segments.every((s) => s.type === "dot")
  ) {
    if (!(digraphUnits && dotMax > dotMin)) {
      return {
        ok: true,
        type: "any",
        source: raw,
        normalized: cleaned,
        minLen: minLenAll,
        maxLen: minLenAll,
        unbounded: false,
        data: { length: minLenAll },
      };
    }
    // else variable width -> generic path below
  }

  // prefix fast type
  if (litCount === 1 && firstSeg.type === "lit") {
    let tailMin = 0,
      tailMax = 0,
      tailUnbounded = false;
    for (const s of segments.slice(1)) {
      if (s.type === "dot") {
        tailMin += dotMin;
        tailMax += dotMax;
      } else if (s.type === "plus") {
        tailMin += 1;
        tailUnbounded = true;
      } else if (s.type === "star") {
        tailUnbounded = true;
      } else if (s.type === "opt") {
        tailMax += dotMax;
      }
    }
    if (tailUnbounded) tailMax = Infinity;
    // If variable-width bounded (tailMin != tailMax) under digraph units, skip prefix fast path (needs segmentation check) -> fall through to generic.
    if (
      digraphUnits &&
      dotMax > dotMin &&
      !tailUnbounded &&
      tailMin !== tailMax
    ) {
      // do nothing; allow generic fallback later
    } else {
      return {
        ok: true,
        type: "prefix",
        source: raw,
        normalized: cleaned,
        minLen: firstSeg.value.length + tailMin,
        maxLen:
          tailMax === Infinity ? Infinity : firstSeg.value.length + tailMax,
        unbounded: tailUnbounded,
        data: { prefix: firstSeg.value, tailMin, tailMax },
      };
    }
  }
  // suffix fast type
  if (litCount === 1 && lastSeg.type === "lit") {
    let headMin = 0,
      headMax = 0,
      headUnbounded = false;
    for (const s of segments.slice(0, -1)) {
      if (s.type === "dot") {
        headMin += dotMin;
        headMax += dotMax;
      } else if (s.type === "plus") {
        headMin += 1;
        headUnbounded = true;
      } else if (s.type === "star") {
        headUnbounded = true;
      } else if (s.type === "opt") {
        headMax += dotMax;
      }
    }
    if (headUnbounded) headMax = Infinity;
    if (
      digraphUnits &&
      dotMax > dotMin &&
      !headUnbounded &&
      headMin !== headMax
    ) {
      // fall through to generic
    } else {
      return {
        ok: true,
        type: "suffix",
        source: raw,
        normalized: cleaned,
        minLen: lastSeg.value.length + headMin,
        maxLen:
          headMax === Infinity ? Infinity : lastSeg.value.length + headMax,
        unbounded: headUnbounded,
        data: { suffix: lastSeg.value, headMin, headMax },
      };
    }
  }
  // contains fast type (single literal + only stars around it)
  if (litCount === 1) {
    const onlyLitStar = segments.every(
      (s) => s.type === "lit" || s.type === "star"
    );
    if (onlyLitStar) {
      const litSeg = segments.find((s) => s.type === "lit");
      return {
        ok: true,
        type: "contains",
        source: raw,
        normalized: cleaned,
        minLen: litSeg.value.length,
        maxLen: Infinity,
        unbounded: true,
        data: { substring: litSeg.value },
      };
    }
  }
  // prefixSuffix: exactly two literals, metas between
  if (litCount === 2 && firstSeg.type === "lit" && lastSeg.type === "lit") {
    const middle = segments.slice(1, -1);
    if (
      middle.length &&
      middle.every(
        (s) =>
          s.type === "dot" ||
          s.type === "star" ||
          s.type === "plus" ||
          s.type === "opt"
      )
    ) {
      let gapMin = 0,
        gapMax = 0,
        unboundedGap = false;
      for (const s of middle) {
        if (s.type === "dot") {
          gapMin += dotMin;
          gapMax += dotMax;
        } else if (s.type === "plus") {
          gapMin += 1;
          unboundedGap = true;
        } else if (s.type === "star") {
          unboundedGap = true;
        } else if (s.type === "opt") {
          gapMax += dotMax;
        }
      }
      if (unboundedGap) gapMax = Infinity;
      if (
        !(digraphUnits && dotMax > dotMin && !unboundedGap && gapMin !== gapMax)
      ) {
        return {
          ok: true,
          type: "prefixSuffix",
          source: raw,
          normalized: cleaned,
          minLen: firstSeg.value.length + lastSeg.value.length + gapMin,
          maxLen: unboundedGap
            ? Infinity
            : firstSeg.value.length + lastSeg.value.length + gapMax,
          unbounded: unboundedGap,
          data: {
            prefix: firstSeg.value,
            suffix: lastSeg.value,
            gapMin,
            gapMax,
            unboundedGap,
          },
        };
      }
    }
  }

  // mask: only literals and dots (at least one dot), no star/plus => fixed length positional mask
  // mask optimization no longer safe if '.' can vary in width (digraphUnits). Only apply when dotMax==dotMin (i.e., digraphUnits disabled) and no unbounded metas.
  if (
    !hasUnbounded &&
    dotMin === dotMax &&
    litCount > 0 &&
    segments.every((s) => s.type === "lit" || s.type === "dot") &&
    segments.some((s) => s.type === "dot")
  ) {
    // Build runs of literals with starting positions
    let pos = 0;
    const runs = [];
    for (const s of segments) {
      if (s.type === "lit") {
        runs.push({ pos, value: s.value });
        pos += s.value.length;
      } else {
        // dot
        pos += 1;
      }
    }
    return {
      ok: true,
      type: "mask",
      source: raw,
      normalized: cleaned,
      minLen: pos,
      maxLen: pos,
      unbounded: false,
      data: { length: pos, runs },
    };
  }

  // Generic fallback
  let unitPattern = "[a-z]";
  if (digraphUnits && digraphList.length) {
    const alternates = digraphList.map((d) => d.toLowerCase()).join("|");
    unitPattern = "(?:" + alternates + "|[a-z])";
  }
  const body = segments
    .map((s) => {
      if (s.type === "lit") return s.value;
      if (s.type === "dot") return unitPattern;
      if (s.type === "star") return "(?:" + unitPattern + ")*";
      if (s.type === "plus") return "(?:" + unitPattern + ")+";
      if (s.type === "opt") return "(?:" + unitPattern + ")?";
    })
    .join("");
  const regex = new RegExp("^" + body + "$", "i");
  return {
    ok: true,
    type: "generic",
    source: raw,
    normalized: cleaned,
    minLen: minLenAll,
    maxLen: maxLenAll,
    unbounded: hasUnbounded,
    data: { regex, segments },
  };
}

function searchRegex(
  pattern,
  { minLen = 0, maxLen = Infinity, regexOptions } = {}
) {
  ensureInit();
  if (pattern == null) return [];
  const p = parseSimplifiedRegex(pattern, regexOptions);
  if (p.error || !p.ok) return [];
  if (maxLen < minLen) return [];

  // Adjust effective length range based on pattern inherent bounds
  const effMin = Math.max(minLen, p.minLen);
  const effMax = Math.min(maxLen, p.maxLen);
  if (effMax < effMin) return [];

  const out = [];
  switch (p.type) {
    case "literal": {
      if (p.minLen < minLen || p.minLen > maxLen) return [];
      const idx = WORD_TO_INDEX.get(p.data.word);
      return idx == null ? [] : [idx];
    }
    case "any": {
      if (!p.unbounded && p.minLen === p.maxLen) {
        // fixed-length wildcard-only pattern
        const len = p.minLen;
        if (len < effMin || len > effMax) return [];
        const bucket = WORDS_BY_LENGTH[len];
        return bucket ? bucket.slice() : [];
      }
      for (let L = effMin; L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
        const bucket = WORDS_BY_LENGTH[L];
        if (!bucket) continue;
        out.push(...bucket);
      }
      if (out.length > 1) out.sort((a, b) => a - b);
      return out;
    }
    case "prefix": {
      const { prefix } = p.data;
      for (let L = effMin; L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
        if (L < p.minLen || L > p.maxLen) continue;
        const bucket = WORDS_BY_LENGTH[L];
        if (!bucket) continue;
        for (const idx of bucket) {
          const w = WORD_LIST[idx];
          if (w.startsWith(prefix)) out.push(idx);
        }
      }
      if (out.length > 1) out.sort((a, b) => a - b);
      return out;
    }
    case "suffix": {
      const { suffix } = p.data;
      for (let L = effMin; L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
        if (L < p.minLen || L > p.maxLen) continue;
        const bucket = WORDS_BY_LENGTH[L];
        if (!bucket) continue;
        for (const idx of bucket) {
          const w = WORD_LIST[idx];
          if (w.endsWith(suffix)) out.push(idx);
        }
      }
      if (out.length > 1) out.sort((a, b) => a - b);
      return out;
    }
    case "contains": {
      const sub = p.data.substring;
      for (
        let L = Math.max(effMin, sub.length);
        L <= effMax && L < WORDS_BY_LENGTH.length;
        L++
      ) {
        const bucket = WORDS_BY_LENGTH[L];
        if (!bucket) continue;
        for (const idx of bucket) {
          const w = WORD_LIST[idx];
          if (w.indexOf(sub) !== -1) out.push(idx);
        }
      }
      if (out.length > 1) out.sort((a, b) => a - b);
      return out;
    }
    case "prefixSuffix": {
      const { prefix, suffix, gapMin, gapMax, unboundedGap } = p.data;
      const pLen = prefix.length,
        sLen = suffix.length;
      for (let L = effMin; L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
        if (L < p.minLen || L > p.maxLen) continue;
        const gapLen = L - pLen - sLen;
        if (gapLen < gapMin) continue;
        if (!unboundedGap && gapLen > gapMax) continue;
        const bucket = WORDS_BY_LENGTH[L];
        if (!bucket) continue;
        for (const idx of bucket) {
          const w = WORD_LIST[idx];
          if (w.startsWith(prefix) && w.endsWith(suffix)) out.push(idx);
        }
      }
      if (out.length > 1) out.sort((a, b) => a - b);
      return out;
    }
    case "mask": {
      const { length, runs } = p.data;
      if (length < effMin || length > effMax) return [];
      const bucket = WORDS_BY_LENGTH[length];
      if (!bucket) return [];
      outer: for (const idx of bucket) {
        const w = WORD_LIST[idx];
        for (const r of runs) {
          if (w.substr(r.pos, r.value.length) !== r.value) continue outer;
        }
        out.push(idx);
      }
      return out;
    }
    case "generic": {
      const { regex } = p.data;
      for (let L = effMin; L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
        const bucket = WORDS_BY_LENGTH[L];
        if (!bucket) continue;
        for (const idx of bucket) {
          const w = WORD_LIST[idx];
          if (regex.test(w)) out.push(idx);
        }
      }
      if (out.length > 1) out.sort((a, b) => a - b);
      return out;
    }
    default:
      return [];
  }
}

// ------------------ Anagram Search (assumes prior validation) ------------------
// Pattern (already validated) may contain parenthesized digraph tokens like (th)(er) along with plain letters.
// Length of an anagram is fixed = total letters (digraph letters included individually).
// ------------------ Wildcard Anagram/Subanagram Shared Logic ------------------
// Pattern language tokens: single letters, parenthesized digraph literals (always length>=2), and meta tokens . ? * + (standalone, unordered multiset semantics)
// Wildcard contributions (token counts): '.' => [1,1], '?' => [0,1], '+' => [1,∞], '*' => [0,∞]
function parseWildcardAnagramPattern(pattern) {
  if (pattern == null) return { error: "null-pattern" };
  const raw = String(pattern).trim();
  if (!raw) return { error: "empty-pattern" };
  // Cache lookup (raw preserves original spacing already trimmed above)
  const cached = __wildSpecCache.get(raw);
  if (cached) return cached;
  const tokenRe = /\([a-zA-Z]+\)|[a-zA-Z]|[.*+?]/g;
  const literals = new Map(); // token -> count (single letters or parenthesized multi-letter tokens)
  const adjacencyLiteralCounts = new Map(); // parenthesized tokens requiring contiguous occurrence
  let anyMin = 0,
    anyMax = 0; // requirement semantics (anagram mode)
  let unbounded = false;
  let hasWildcards = false;
  // Supply semantics fields (subanagram mode)
  let finiteWildcards = 0; // '.' and '?' tokens
  let plusCount = 0; // number of '+' tokens (require usage)
  let starCount = 0; // number of '*' tokens
  let dotCount = 0; // count of '.' tokens
  let qCount = 0; // count of '?' tokens
  let m;
  const metas = new Set([".", "?", "*", "+"]);
  const DIG = DIGRAPHS || new Set();
  while ((m = tokenRe.exec(raw)) !== null) {
    const tok = m[0];
    if (metas.has(tok)) {
      hasWildcards = true;
      if (tok === ".") {
        anyMin += 1;
        anyMax += 1;
        finiteWildcards += 1;
        dotCount += 1;
      } else if (tok === "?") {
        anyMax += 1;
        finiteWildcards += 1;
        qCount += 1;
      } else if (tok === "+") {
        anyMin += 1;
        anyMax = Infinity;
        unbounded = true;
        plusCount += 1;
      } else if (tok === "*") {
        anyMax = Infinity;
        unbounded = true;
        starCount += 1;
      }
      continue;
    }
    if (tok.startsWith("(")) {
      const inner = tok.slice(1, -1).toLowerCase();
      const litTok = inner; // treat as atomic token
      literals.set(litTok, (literals.get(litTok) || 0) + 1);
      if (litTok.length > 1) {
        adjacencyLiteralCounts.set(
          litTok,
          (adjacencyLiteralCounts.get(litTok) || 0) + 1
        );
      }
    } else {
      // single letter
      const ch = tok.toLowerCase();
      literals.set(ch, (literals.get(ch) || 0) + 1);
    }
  }
  // Derive totals
  let totalLiteralTokens = 0;
  let totalLiteralLetters = 0;
  for (const [tok, cnt] of literals.entries()) {
    totalLiteralTokens += cnt; // each literal token counts as one token
    totalLiteralLetters += cnt * tok.length; // letters length for bounds
  }
  const spec = {
    ok: true,
    source: raw,
    literals, // Map token->count (letters or digraph literal token)
    digraphLiteralCounts: adjacencyLiteralCounts, // reuse field name in downstream code
    anyMin,
    anyMax: anyMax === 0 ? 0 : anyMax, // keep 0 if no wildcards
    unbounded,
    totalLiteralTokens,
    totalLiteralLetters,
    hasWildcards,
    finiteWildcards,
    plusCount,
    starCount,
    dotCount,
    qCount,
    hasInfiniteWildcards: plusCount + starCount > 0,
  };
  __wildSpecCache.set(raw, spec);
  return spec;
}

// Attempt to select non-overlapping occurrences of required digraph literals.
function selectDigraphLiteralSpans(word, digraphCounts) {
  if (!digraphCounts.size) return { ok: true, spans: [] };
  // Build list of required digraphs expanded: [{dg, idx} repeated}
  const reqList = [];
  for (const [dg, cnt] of digraphCounts.entries()) {
    for (let i = 0; i < cnt; i++) reqList.push(dg);
  }
  // Precompute occurrences for each digraph
  const occMap = new Map();
  for (const dg of new Set(reqList)) {
    const occ = [];
    let pos = 0;
    while (true) {
      const p = word.indexOf(dg, pos);
      if (p === -1) break;
      occ.push({ start: p, end: p + dg.length });
      pos = p + 1;
    }
    occMap.set(dg, occ);
  }
  // Backtracking assign
  const spans = [];
  const used = []; // intervals chosen
  function overlaps(a, b) {
    return !(a.end <= b.start || b.end <= a.start);
  }
  function dfs(i) {
    if (i === reqList.length) return true;
    const dg = reqList[i];
    const occ = occMap.get(dg);
    if (!occ || !occ.length) return false;
    for (const o of occ) {
      let clash = false;
      for (const u of used) {
        if (overlaps(o, u)) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      used.push(o);
      spans.push({ dg, ...o });
      if (dfs(i + 1)) return true;
      used.pop();
      spans.pop();
    }
    return false;
  }
  const ok = dfs(0);
  return ok ? { ok: true, spans } : { ok: false };
}

// Compute minimal tokens possible for a letter string given optional digraph usage (assumes digraph length 2) via greedy DP.
function minTokensForRemainder(letters, digraphSet) {
  if (!digraphSet || !digraphSet.size) return letters.length; // only singles
  // DP: f[i] = min tokens for suffix starting at i
  const n = letters.length;
  const f = new Array(n + 1).fill(0);
  f[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    // single letter
    let best = 1 + f[i + 1];
    // any digraph starting at i
    for (const dg of digraphSet) {
      if (dg.length !== 2) continue; // current implementation assumption
      if (i + 2 <= n && letters[i] === dg[0] && letters[i + 1] === dg[1]) {
        const v = 1 + f[i + 2];
        if (v < best) best = v;
      }
    }
    f[i] = best;
  }
  return f[0];
}

function wordMatchesWildcardSpec(
  spec,
  word,
  mode,
  { digraphUnits = true } = {}
) {
  // mode: 'anagram' | 'sub'
  // Step 1: build letter counts for quick rejection of single-letter literals
  const lower = word.toLowerCase();
  // Step 2: enforce digraph literal occurrences (non-overlapping)
  const digraphCounts = spec.digraphLiteralCounts;
  const chosen = selectDigraphLiteralSpans(lower, digraphCounts);
  if (!chosen.ok) return false;
  // Mark letters consumed by digraph literal spans
  const consumed = new Array(lower.length).fill(false);
  for (const s of chosen.spans) {
    for (let i = s.start; i < s.end; i++) consumed[i] = true;
  }
  // Count available letters for single-letter literals
  const letterNeed = new Map();
  for (const [tok, cnt] of spec.literals.entries()) {
    if (tok.length === 1) letterNeed.set(tok, cnt + (letterNeed.get(tok) || 0));
  }
  if (letterNeed.size) {
    const have = Object.create(null);
    for (let i = 0; i < lower.length; i++) {
      if (consumed[i]) continue;
      const ch = lower[i];
      have[ch] = (have[ch] || 0) + 1;
    }
    for (const [ch, need] of letterNeed.entries()) {
      if ((have[ch] || 0) < need) return false;
    }
  }
  // Compute leftover letters string after reserving digraph literal spans & reserving the minimal necessary single-letter literal tokens.
  // Previous implementation compacted leftover letters which incorrectly let wildcard tokens (especially '.') treat
  // non-adjacent letters (separated by consumed literals) as adjacent, enabling artificial digraph formation.
  // Fix: operate over original indices; construct contiguous runs of leftover letters based on original positions.
  // Step A: mark single-letter literal consumptions on original index array (choose earliest occurrences; this may
  // over-estimate min token usage but will never under-estimate, avoiding false positives).
  if (letterNeed.size) {
    // Build lists of positions per letter
    const positionsByLetter = Object.create(null);
    for (let i = 0; i < lower.length; i++)
      if (!consumed[i]) {
        const ch = lower[i];
        (positionsByLetter[ch] || (positionsByLetter[ch] = [])).push(i);
      }
    for (const [ch, need] of letterNeed.entries()) {
      const arr = positionsByLetter[ch];
      if (!arr || arr.length < need) return false; // safety (should have been validated earlier)
      // Consume earliest indices (simple heuristic). Since removal cannot merge separated runs (indices remain non-consecutive),
      // this choice won't create invalid adjacency for wildcard pairing.
      for (let k = 0; k < need; k++) consumed[arr[k]] = true;
    }
  }
  // Step B: collect leftover contiguous runs (indices where !consumed and consecutive in original word)
  const runs = [];
  let runStart = -1,
    prev = -2; // prev initialized so first char starts new run
  for (let i = 0; i < lower.length; i++) {
    if (consumed[i]) {
      if (runStart !== -1) {
        runs.push({ start: runStart, end: prev });
        runStart = -1;
      }
      continue;
    }
    if (runStart === -1) {
      runStart = i;
      prev = i;
    } else if (i === prev + 1) {
      prev = i;
    } else {
      runs.push({ start: runStart, end: prev });
      runStart = i;
      prev = i;
    }
  }
  if (runStart !== -1) runs.push({ start: runStart, end: prev });
  const digraphSet = digraphUnits ? DIGRAPHS || new Set() : new Set();
  let minTokensR = 0;
  let maxTokensR = 0;
  for (const r of runs) {
    const seg = lower.slice(r.start, r.end + 1);
    maxTokensR += seg.length; // all singles
    if (digraphUnits) minTokensR += minTokensForRemainder(seg, digraphSet);
    else minTokensR += seg.length;
  }
  const totalLiteralTokens = spec.totalLiteralTokens; // parenthesized digraphs + single letters
  const candidateTokenMin = totalLiteralTokens + minTokensR;
  const candidateTokenMax = totalLiteralTokens + maxTokensR;
  if (mode === "anagram") {
    const needMin = totalLiteralTokens + spec.anyMin;
    const needMax =
      spec.anyMax === Infinity ? Infinity : totalLiteralTokens + spec.anyMax;
    // Intervals [candidateTokenMin, candidateTokenMax] and [needMin, needMax] must intersect, *and* actual total tokens must equal total tokens of the word under some segmentation.
    // Since candidate interval covers all achievable token counts, intersection non-empty => feasible.
    if (candidateTokenMax < needMin) return false;
    if (needMax < candidateTokenMin) return false;
    // Additionally token count must be exact: there exists token count N between both intervals. Already ensured.
    return true;
  } else {
    // subanagram
    const maxWildcardTokens = candidateTokenMax - totalLiteralTokens; // available tokens beyond literals
    return maxWildcardTokens >= spec.anyMin; // ANY_min must be satisfiable
  }
}

function searchAnagramLike(
  pattern,
  mode,
  { minLen = 0, maxLen = Infinity, regexOptions } = {}
) {
  ensureInit();
  const raw = String(pattern == null ? "" : pattern).trim();
  // -------- Pure wildcard fast path (no literal letters or digraph tokens) --------
  // Recognize patterns consisting solely of wildcard metas . ? * +
  // Disabled when digraphUnits is true because unit->letter expansion (1..2) would require filtering to avoid false positives / omissions.
  const mergedRegexOptions = { ...__regexOptions, ...(regexOptions || {}) };
  const digraphUnitsFast = !!mergedRegexOptions.digraphUnits;
  if (/^[.?*+]+$/.test(raw)) {
    if (!digraphUnitsFast) {
      let dots = 0,
        qs = 0,
        plus = 0,
        stars = 0;
      for (const ch of raw) {
        if (ch === ".") dots++;
        else if (ch === "?") qs++;
        else if (ch === "+") plus++;
        else if (ch === "*") stars++;
      }
      const minLenWild = dots + plus; // each '.' & '+' contribute at least 1
      const maxLenWild = stars === 0 && plus === 0 ? dots + qs : Infinity; // '+' or '*' introduce unbounded growth
      let effMin = Math.max(minLen, minLenWild);
      let effMax = Math.min(maxLen, maxLenWild);
      if (effMax < effMin) return [];
      if (mode === "sub" && plus > 0) effMin = Math.max(effMin, 1);
      const out = [];
      for (let L = effMin; L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
        const bucket = WORDS_BY_LENGTH[L];
        if (bucket) out.push(...bucket);
      }
      return out;
    }
    // else fall through to full spec parsing for correctness under digraph units
  }
  // -------- Subanagram pure literal (single letters only) fast path --------
  if (mode === "sub" && /^[a-zA-Z]+$/.test(raw)) {
    const supply = new Uint8Array(26);
    for (const ch of raw.toLowerCase()) {
      const ci = ch.charCodeAt(0) - 97;
      if (ci >= 0 && ci < 26) supply[ci]++;
    }
    const supplyLetters = raw.length;
    const effMax = Math.min(maxLen, supplyLetters);
    const effMin = Math.max(minLen, 0);
    if (effMax < effMin) return [];
    const out = [];
    for (let L = effMin; L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
      const bucket = WORDS_BY_LENGTH[L];
      if (!bucket) continue;
      outer: for (let i = 0; i < bucket.length; i++) {
        const idx = bucket[i];
        const freq = WORD_LETTER_COUNTS[idx];
        // subset check (letters outside supply auto-fail if count>0 while supply count is 0)
        for (let c = 0; c < 26; c++) {
          if (freq[c] && freq[c] > supply[c]) continue outer; // exceeds supply
        }
        out.push(idx);
      }
    }
    return out;
  }
  const spec = parseWildcardAnagramPattern(pattern);
  if (!spec.ok) return [];
  const digraphUnits = !!mergedRegexOptions.digraphUnits;
  // Fast path: no wildcards (spec.anyMin==0 && anyMax==0 && !spec.hasWildcards)
  if (!spec.hasWildcards) {
    // Reconstruct plain letters for signature (each digraph literal contributes its letters)
    const letters = [];
    for (const [tok, cnt] of spec.literals.entries()) {
      for (let i = 0; i < cnt; i++) letters.push(...tok);
    }
    const sig = letters.sort().join("");
    const candidates = ANAGRAM_INDEX.get(sig) || [];
    if (mode === "anagram") {
      // If there are parenthesized adjacency tokens, filter candidates accordingly.
      if (spec.digraphLiteralCounts && spec.digraphLiteralCounts.size) {
        const out = [];
        const counts = spec.digraphLiteralCounts;
        for (const idx of candidates) {
          const w = WORD_LIST[idx];
          if (selectDigraphLiteralSpans(w.toLowerCase(), counts).ok)
            out.push(idx);
        }
        return out;
      }
      return candidates.slice();
    }
    // subanagram: every anagram candidate is trivially a subanagram; but subanagram needs to allow longer words too -> fall through to generic enumeration.
    if (mode === "sub") {
      // we still need to enumerate broader set; skip fast path
    }
  }
  // Derive letter length bounds for bucket scanning.
  const letterMinReq = spec.totalLiteralLetters + spec.anyMin; // requirement mode (anagram)
  const letterMaxReq =
    spec.anyMax === Infinity
      ? Infinity
      : spec.totalLiteralLetters + spec.anyMax * (digraphUnits ? 2 : 1);
  // Supply minimal length (sub mode): optional literals; only '+' enforces at least one wildcard usage
  function supplyMinLetters(spec) {
    if (spec.plusCount > 0) return 1; // must use at least one wildcard letter
    // If any single-letter literal exists, we can form length 1 word from it
    for (const [tok, cnt] of spec.literals.entries()) {
      if (tok.length === 1 && cnt > 0) return 1;
    }
    // Else try adjacency literals (pick smallest length token)
    if (spec.digraphLiteralCounts && spec.digraphLiteralCounts.size) {
      let m = Infinity;
      for (const [tok, cnt] of spec.digraphLiteralCounts.entries()) {
        if (cnt > 0 && tok.length < m) m = tok.length;
      }
      if (m !== Infinity) return m;
    }
    // Else rely on wildcard capacity if present
    if (spec.finiteWildcards > 0 || spec.hasInfiniteWildcards) return 1;
    return 0; // degenerate (no supply)
  }
  const letterMinSupply = supplyMinLetters(spec);
  const supplyMaxLetters = spec.hasInfiniteWildcards
    ? Infinity // total available letters if all supply consumed (account for unit-sized wildcards)
    : Array.from(spec.literals.entries()).reduce(
        (s, [tok, c]) => s + tok.length * c,
        0
      ) +
      spec.finiteWildcards * (digraphUnits ? 2 : 1);
  const effMin =
    mode === "anagram"
      ? Math.max(minLen, letterMinReq)
      : Math.max(minLen, letterMinSupply);
  const effMaxRaw = mode === "anagram" ? letterMaxReq : supplyMaxLetters;
  const effMax = Math.min(maxLen, effMaxRaw);
  if (effMax < effMin) return [];
  const out = [];
  const opt = { digraphUnits };
  if (mode === "sub") {
    // Supply semantics with optional digraph units: each finite wildcard can supply up to unitMax letters (1 or 2)
    const unitMax = digraphUnits ? 2 : 1;
    const singleLetterSupply = Array.from(spec.literals.entries())
      .filter(([tok]) => tok.length === 1)
      .reduce((s, [, c]) => s + c, 0);
    const adjacencySupply = Array.from(
      spec.digraphLiteralCounts.entries()
    ).reduce((s, [tok, c]) => s + c * tok.length, 0);
    const finiteWildcardLettersMax = spec.finiteWildcards * unitMax;
    const letterMaxSupply = spec.hasInfiniteWildcards
      ? Infinity
      : singleLetterSupply + adjacencySupply + finiteWildcardLettersMax;
    const subEffMax = Math.min(effMax, letterMaxSupply);
    for (let L = effMin; L <= subEffMax && L < WORDS_BY_LENGTH.length; L++) {
      const bucket = WORDS_BY_LENGTH[L];
      if (!bucket) continue;
      for (const idx of bucket) {
        const w = WORD_LIST[idx];
        if (w.length < effMin || w.length > subEffMax) continue;
        if (subanagramSupplyMatches(spec, w, opt)) out.push(idx);
      }
    }
  } else {
    for (let L = effMin; L <= effMax && L < WORDS_BY_LENGTH.length; L++) {
      const bucket = WORDS_BY_LENGTH[L];
      if (!bucket) continue;
      for (const idx of bucket) {
        const w = WORD_LIST[idx];
        if (w.length < effMin || w.length > effMax) continue;
        if (wordMatchesWildcardSpec(spec, w, "anagram", opt)) out.push(idx);
      }
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

function searchAnagrams(
  pattern,
  { minLen = 0, maxLen = Infinity, regexOptions } = {}
) {
  // Cache key must include digraphUnits to avoid stale results when overriding.
  const digraphUnits =
    regexOptions && "digraphUnits" in regexOptions
      ? !!regexOptions.digraphUnits
      : !!(__regexOptions && __regexOptions.digraphUnits);
  const cacheKey =
    pattern +
    "|" +
    (digraphUnits ? "du1" : "du0") +
    "|mn" +
    minLen +
    "|mx" +
    (isFinite(maxLen) ? maxLen : "INF");
  let cached = __anagramCache.get(cacheKey);
  if (!cached) {
    cached = searchAnagramLike(pattern, "anagram", {
      minLen,
      maxLen,
      regexOptions,
    });
    __anagramCache.set(cacheKey, cached);
  }
  return cached;
}

function searchSubanagrams(
  pattern,
  { minLen = 0, maxLen = Infinity, regexOptions } = {}
) {
  const digraphUnits =
    regexOptions && "digraphUnits" in regexOptions
      ? !!regexOptions.digraphUnits
      : !!(__regexOptions && __regexOptions.digraphUnits);
  const cacheKey =
    pattern +
    "|" +
    (digraphUnits ? "du1" : "du0") +
    "|mn" +
    minLen +
    "|mx" +
    (isFinite(maxLen) ? maxLen : "INF");
  let cached = __subanaCache.get(cacheKey);
  if (!cached) {
    cached = searchAnagramLike(pattern, "sub", {
      minLen,
      maxLen,
      regexOptions,
    });
    __subanaCache.set(cacheKey, cached);
  }
  return cached;
}

// --------- Subanagram Supply Semantics Matcher (S2) ---------
function subanagramSupplyMatches(spec, word, { digraphUnits = true } = {}) {
  const lower = word.toLowerCase();
  const need = Object.create(null);
  for (const ch of lower) need[ch] = (need[ch] || 0) + 1;
  // Separate literal supplies
  const singleLetterSupply = Object.create(null);
  for (const [tok, cnt] of spec.literals.entries())
    if (tok.length === 1)
      singleLetterSupply[tok] = (singleLetterSupply[tok] || 0) + cnt;
  // First consume single-letter literal tokens greedily
  for (const [ch, avail] of Object.entries(singleLetterSupply)) {
    if (!need[ch]) continue;
    const use = Math.min(need[ch], avail);
    need[ch] -= use;
  }
  // Prepare adjacency tokens (parenthesized literals) optional use
  const adjList = [];
  for (const [tok, cnt] of spec.digraphLiteralCounts.entries()) {
    const occ = [];
    let pos = 0;
    while (true) {
      const p = lower.indexOf(tok, pos);
      if (p === -1) break;
      occ.push({ start: p, end: p + tok.length });
      pos = p + 1;
    }
    if (!occ.length) continue; // can't use this token at all
    adjList.push({ token: tok, count: cnt, occ });
  }
  // Greedy usage of adjacency tokens to reduce remaining deficits
  const usedIntervals = [];
  function overlaps(a, b) {
    return !(a.end <= b.start || b.end <= a.start);
  }
  for (const entry of adjList) {
    let remaining = entry.count;
    for (const o of entry.occ) {
      if (remaining <= 0) break;
      // Check overlap
      let clash = false;
      for (const u of usedIntervals) {
        if (overlaps(o, u)) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      // Determine if token helps (any letter still deficit)
      let helps = false;
      for (let i = o.start; i < o.end; i++) {
        const ch = lower[i];
        if ((need[ch] || 0) > 0) {
          helps = true;
          break;
        }
      }
      if (!helps) continue;
      // Apply
      for (let i = o.start; i < o.end; i++) {
        const ch = lower[i];
        if (need[ch] > 0) need[ch]--;
      }
      usedIntervals.push(o);
      remaining--;
    }
  }
  // Remaining deficits (letters) after literal supplies consumed
  let deficits = 0;
  for (const v of Object.values(need)) deficits += v;
  const infinite = spec.hasInfiniteWildcards; // '+' or '*' introduces infinite letter potential
  const wildcardTokenCount = spec.finiteWildcards + spec.plusCount; // tokens we can use (excluding '*')
  if (deficits === 0) {
    // Must still satisfy '+' usage requirement: if plusCount>0 we need at least one letter to consume; we can optionally "create" a letter only if infinite (* or +) supply exists; but semantics: '+' must be used -> require deficits>0.
    if (spec.plusCount > 0) return false;
    return true;
  }
  if (infinite) {
    // Need at least plusCount tokens used; any positive deficits lets us satisfy usage.
    return deficits >= spec.plusCount;
  }
  // Finite case: Each wildcard token can represent 1 or (if digraphUnits) 2 letters, but 2-letter usage must align with an actual digraph in the word.
  if (deficits > wildcardTokenCount * (digraphUnits ? 2 : 1)) return false; // impossible even with maximal pairing
  // Need at least deficits single-letter coverage: require wildcardTokenCount >= ceil(deficits / 2) when digraphUnits, else deficits.
  const minTokensNeeded = digraphUnits ? Math.ceil(deficits / 2) : deficits;
  if (wildcardTokenCount < minTokensNeeded) return false;
  // '+' usage requirement: at least spec.plusCount of those tokens must be used -> deficits letters imply at least minTokensNeeded tokens used, so check minTokensNeeded >= plusCount (else we might still use more tokens than minimum; ensure possibility)
  if (spec.plusCount > 0 && deficits < spec.plusCount) return false;
  // Additional pruning: ensure there are enough disjoint digraph occurrences to realize required pairings when relying on 2-letter tokens.
  if (digraphUnits && deficits > wildcardTokenCount) {
    // Need to pair (deficits - wildcardTokenCount) letters via digraphs composed ONLY of remaining deficit letters.
    const neededPairs = deficits - wildcardTokenCount;
    if (neededPairs > 0) {
      const needCopy = { ...need }; // counts of remaining deficit letters
      let pairs = 0;
      // Greedy scan over contiguous digraph occurrences; only use one if both letters still deficit.
      for (let i = 0; i < lower.length - 1 && pairs < neededPairs; i++) {
        const dg = lower.slice(i, i + 2);
        if (DIGRAPHS && DIGRAPHS.has(dg)) {
          const a = dg[0],
            b = dg[1];
          if ((needCopy[a] || 0) > 0 && (needCopy[b] || 0) > 0) {
            needCopy[a]--;
            needCopy[b]--;
            pairs++;
            // Skip overlapping with itself by advancing one position only; overlapping digraphs can still be considered at i+1.
          }
        }
      }
      if (pairs < neededPairs) return false; // insufficient valid digraph pairings from leftover letters
    }
  }
  return true;
}

// (Legacy rack-based searchSubanagrams removed. The active implementation above now
// provides wildcard supply semantics (S2) via searchAnagramLike -> subanagramSupplyMatches.)

// ------------------ Validation Helpers ------------------
// Return shape: { ok:true, normalized, type } OR { ok:false, errors:[ {code,message,details?} ... ] }
function vErr(code, message, details) {
  return { code, message, details };
}

// Shared scanner for parentheses-wrapped digraph tokens.
// Options:
//   strip: remove parentheses for valid digraph tokens in returned stripped string (default true)
//   requireValid: if true, any parenthesized token not in digraph set yields error
//   allowParens: if false, any parentheses produce error
//   allowNested: if false, a '(' encountered while already open produces error
function _scanDigraphParens(
  input,
  {
    strip = true,
    requireValid = true,
    allowParens = true,
    allowNested = false,
  } = {}
) {
  const digraphSet = DIGRAPHS; // assume defined
  const errors = [];
  let out = "";
  let i = 0;
  let open = false;
  let start = -1;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "(") {
      if (!allowParens) {
        errors.push(
          vErr("parentheses-not-allowed", "Parentheses not allowed", {
            index: i,
          })
        );
        i++;
        continue;
      }
      if (open && !allowNested)
        errors.push(
          vErr("nested-parentheses", "Nested parentheses not allowed", {
            index: i,
          })
        );
      open = true;
      start = i;
      i++;
      continue;
    }
    if (ch === ")") {
      if (!open) {
        errors.push(
          vErr("unmatched-close", "Unmatched closing parenthesis", { index: i })
        );
        i++;
        continue;
      }
      const token = input.slice(start + 1, i);
      if (!/^[a-zA-Z]+$/.test(token)) {
        errors.push(
          vErr(
            "invalid-digraph-chars",
            "Non-letter characters inside parentheses",
            { token }
          )
        );
      } else if (requireValid && !digraphSet.has(token.toLowerCase())) {
        errors.push(
          vErr(
            "invalid-digraph",
            "Parenthesized token is not a valid digraph",
            { token }
          )
        );
      }
      if (strip && (!requireValid || digraphSet.has(token.toLowerCase()))) {
        out += token; // keep letters only
      } else {
        out += "(" + token + ")";
      }
      open = false;
      start = -1;
      i++;
      continue;
    }
    // regular char
    if (!open) out += ch; // inside open we'll append after closing to avoid mixing
    i++;
  }
  if (open)
    errors.push(
      vErr("unmatched-open", "Unmatched opening parenthesis", { index: start })
    );
  return { errors, stripped: out };
}

// Regex validation (simplified dialect: letters, ., *, + only). Parentheses invalid here.
function validateRegex(pattern) {
  if (pattern == null)
    return { ok: false, errors: [vErr("invalid", "Unmatched parentheses")] }; // generic null treated later by UI
  const raw = String(pattern);
  const input = raw.trim();
  if (!input) return { ok: false, errors: [vErr("empty", "Empty pattern")] };
  return buildMinimalValidation("regex", input);
}

// Shared for anagram / subanagram inputs
// (Legacy rack enumeration helpers removed.)
function buildMinimalValidation(kind, input) {
  // Collect parenthesis tokens & structural issues
  const unmatched = { open: false, close: false };
  let nested = false;
  const invalidPatternTokens = new Set();
  const invalidDigraphs = new Set();
  const invalidChars = new Set();
  const digraphSet = DIGRAPHS || new Set();
  let open = false;
  let start = -1;
  let depth = 0;
  const chars = [...input];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "(") {
      if (open) nested = true; // nested
      open = true;
      start = i;
      depth++;
      if (depth > 1) nested = true;
      continue;
    }
    if (ch === ")") {
      if (!open) {
        unmatched.close = true;
        continue;
      }
      const token = input.slice(start + 1, i);
      if (/^[a-zA-Z]+$/.test(token)) {
        const low = token.toLowerCase();
        if (token.length === 2) {
          if (!digraphSet.has(low)) invalidDigraphs.add(low);
        } else if (token.length !== 1) {
          invalidPatternTokens.add(token);
        }
      } else {
        invalidPatternTokens.add(token);
      }
      open = false;
      depth--;
      continue;
    }
    // Track invalid chars for given kind. Allowed: letters, wildcard meta (. ? * +), parentheses handled, whitespace is trimmed earlier.
    if (!/[a-zA-Z.?*+]/.test(ch)) invalidChars.add(ch);
  }
  if (open) unmatched.open = true;
  if (unmatched.open || unmatched.close)
    return { ok: false, errors: [vErr("invalid", "Unmatched parentheses")] };
  if (nested)
    return { ok: false, errors: [vErr("invalid", "Nested parentheses")] };
  if (invalidPatternTokens.size)
    return {
      ok: false,
      errors: [
        vErr(
          "invalid",
          "Invalid pattern in parentheses: " +
            [...invalidPatternTokens].join(", ")
        ),
      ],
    };
  if (invalidDigraphs.size)
    return {
      ok: false,
      errors: [
        vErr(
          "bad-digraph",
          "Non-existent digraphs: " +
            [...invalidDigraphs].map((t) => "(" + t + ")").join(", ")
        ),
      ],
    };
  if (invalidChars.size)
    return {
      ok: false,
      errors: [
        vErr(
          "invalid-chars",
          "Invalid characters: " + [...invalidChars].join(", ")
        ),
      ],
    };
  return {
    ok: true,
    normalized: normalizePostValidation(kind, input),
    type: kind,
  };
}

function normalizePostValidation(kind, input) {
  // For regex we still need stripped form (remove valid digraph parens tokens)
  if (kind === "regex") {
    // Remove parentheses around valid digraphs only
    return input.replace(/\(([a-zA-Z]+)\)/g, (m, inner) => {
      const low = inner.toLowerCase();
      return DIGRAPHS && DIGRAPHS.has(low) ? inner : m; // keep original if not valid digraph (will have errored earlier)
    });
  }
  return input;
}

// Reintroduced lightweight validators for anagram / subanagram patterns (legacy cleanup removed originals).
// Behavior: use buildMinimalValidation then downgrade 'bad-digraph' errors to warnings (non-blocking),
// matching the UI's InputValidation approach where unknown digraphs are warnings.
function validateAnagrams(pattern) {
  if (pattern == null)
    return {
      ok: false,
      errors: [vErr("null-pattern", "Pattern is null/undefined")],
    };
  const base = buildMinimalValidation("anagram", String(pattern));
  if (!base.ok) return base;
  // Heuristic warnings for very broad wildcard anagram patterns (may return huge result sets)
  // Only evaluate if wildcards present
  if (/[.?*+]/.test(base.normalized)) {
    try {
      const spec = parseWildcardAnagramPattern(base.normalized);
      if (spec && spec.ok && spec.hasWildcards) {
        const literalTokens = spec.totalLiteralTokens; // each single letter or digraph literal
        const unbounded = spec.hasInfiniteWildcards; // plus or star present
        // Length window (anagram requirement semantics)
        const digraphUnits =
          (__regexOptions && __regexOptions.digraphUnits) || false;
        const letterMinReq = spec.totalLiteralLetters + spec.anyMin;
        const letterMaxReq =
          spec.anyMax === Infinity
            ? Infinity
            : spec.totalLiteralLetters + spec.anyMax * (digraphUnits ? 2 : 1);
        const rangeWidth = !isFinite(letterMaxReq)
          ? Infinity
          : letterMaxReq - letterMinReq;
        const wildcardTokens =
          spec.dotCount + spec.qCount + spec.plusCount + spec.starCount;
        const wildcardDensity =
          wildcardTokens / Math.max(1, wildcardTokens + literalTokens);
        let warnings = [];
        if (unbounded && literalTokens <= 2) {
          warnings.push({
            code: "broad-unbounded-anagram",
            message:
              "Very broad wildcard anagram; may match a large portion of the dictionary.",
          });
        } else if (wildcardDensity >= 0.6 && rangeWidth >= 6) {
          warnings.push({
            code: "broad-dense-anagram",
            message:
              "Broad wildcard anagram pattern may produce a very large result set.",
          });
        }
        if (warnings.length) return { ...base, warnings };
      }
    } catch (_) {
      /* ignore heuristics failures */
    }
  }
  return base;
}
function validateSubanagrams(pattern) {
  if (pattern == null)
    return {
      ok: false,
      errors: [vErr("null-pattern", "Pattern is null/undefined")],
    };
  const base = buildMinimalValidation("subanagram", String(pattern));
  if (!base.ok) return base;
  if (/[.?*+]/.test(base.normalized) || /[()]/.test(base.normalized)) {
    try {
      const spec = parseWildcardAnagramPattern(base.normalized);
      if (spec && spec.ok) {
        const literalTokens = spec.totalLiteralTokens;
        const unbounded = spec.hasInfiniteWildcards;
        const wildcardTokens =
          spec.dotCount + spec.qCount + spec.plusCount + spec.starCount;
        const wildcardDensity =
          wildcardTokens / Math.max(1, wildcardTokens + literalTokens);
        // Supply capacity estimate
        const digraphUnits =
          (__regexOptions && __regexOptions.digraphUnits) || false;
        const unitMax = digraphUnits ? 2 : 1;
        const finiteCap = spec.finiteWildcards * unitMax;
        const literalLetters = Array.from(spec.literals.entries()).reduce(
          (s, [tok, c]) => s + tok.length * c,
          0
        );
        const capMax = spec.hasInfiniteWildcards
          ? Infinity
          : literalLetters + finiteCap;
        let warnings = [];
        if (unbounded) {
          warnings.push({
            code: "broad-unbounded-sub",
            message:
              "Subanagram pattern contains * or + (unbounded); expect a very large result set.",
          });
        } else if (!unbounded && wildcardDensity >= 0.6 && capMax >= 10) {
          warnings.push({
            code: "broad-dense-sub",
            message:
              "Broad subanagram pattern may produce a very large result set.",
          });
        }
        if (warnings.length) return { ...base, warnings };
      }
    } catch (_) {}
  }
  return base;
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
  if (pattern == null)
    return {
      ok: false,
      errors: [vErr("null-pattern", "Pattern is null/undefined")],
    };
  const source = String(pattern);
  const raw = source.trim();
  if (!raw)
    return { ok: false, errors: [vErr("empty-pattern", "Pattern is empty")] };
  const p = raw.replace(/\s+/g, "");
  const errors = [];
  let minLen = 0,
    maxLen = Infinity;
  const num = (n) => {
    if (!/^\d+$/.test(n)) {
      errors.push(vErr("invalid-number", "Invalid number", { token: n }));
      return null;
    }
    return parseInt(n, 10);
  };

  function finish() {
    if (errors.length) return { ok: false, errors };
    if (minLen < 0)
      errors.push(
        vErr("neg-length", "Negative length not allowed", { minLen })
      );
    if (maxLen < 0)
      errors.push(
        vErr("neg-length", "Negative length not allowed", { maxLen })
      );
    if (minLen > maxLen)
      errors.push(
        vErr("range-order", "Min length exceeds max length", { minLen, maxLen })
      );
    if (errors.length) return { ok: false, errors };
    return { ok: true, minLen, maxLen, source, normalized: p };
  }

  // Exact n
  // Standalone '-' means any length (no constraint)
  if (p === "-") {
    minLen = 0;
    maxLen = Infinity;
    return finish();
  }
  if (/^\d+$/.test(p)) {
    const n = num(p);
    if (n == null) return { ok: false, errors };
    minLen = maxLen = n;
    return finish();
  }
  // Range n-m
  if (/^(\d+)-(\d+)$/.test(p)) {
    const [, a, b] = p.match(/^(\d+)-(\d+)$/);
    const n1 = num(a),
      n2 = num(b);
    if (n1 == null || n2 == null) return { ok: false, errors };
    minLen = n1;
    maxLen = n2;
    return finish();
  }
  // Open range m- (>= m)
  if (/^(\d+)-$/.test(p)) {
    const [, a] = p.match(/^(\d+)-$/);
    const n1 = num(a);
    if (n1 == null) return { ok: false, errors };
    minLen = n1;
    maxLen = Infinity;
    return finish();
  }
  // Shorthand -n (<= n)
  if (/^-\d+$/.test(p)) {
    const n = num(p.slice(1));
    if (n == null) return { ok: false, errors };
    minLen = 0;
    maxLen = n;
    return finish();
  }
  // >=n / <=n / >n / <n
  if (/^(>=|<=|>|<)\d+$/.test(p)) {
    const [, op, numStr] = p.match(/^(>=|<=|>|<)(\d+)$/);
    const n = numStr ? parseInt(numStr, 10) : null;
    if (n == null) return { ok: false, errors };
    if (op === ">=") {
      minLen = n;
    } else if (op === "<=") {
      maxLen = n;
    } else if (op === ">") {
      minLen = n + 1;
    } else if (op === "<") {
      maxLen = Math.max(0, n - 1);
    }
    return finish();
  }
  // n+ shorthand for >= n
  if (/^\d+\+$/.test(p)) {
    const n = num(p.slice(0, -1));
    if (n == null) return { ok: false, errors };
    minLen = n;
    return finish();
  }

  errors.push(
    vErr("unrecognized", "Unrecognized length pattern", { pattern: p })
  );
  return { ok: false, errors };
}

function validateLengthPattern(pattern) {
  return parseLengthPattern(pattern);
}

// ------------------ Multi-search (intersection) ------------------
// specs: array of { type: 'regex'|'anagram'|'subanagram'|'length', pattern: string }
// Returns { ok:true, indices:[...], words:[], plan:[...], minLen, maxLen } or { ok:false, errors:[...] }

// Caches
const __regexParseCache = new Map(); // pattern -> parsed regex object
const __anagramCache = new Map(); // pattern -> indices array
const __subanaCache = new Map(); // pattern -> indices array (default minLen=0,max=Inf, allowSingleDigraph true)

function intersectSorted(a, b) {
  if (!a || !a.length) return [];
  if (!b || !b.length) return [];
  const out = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i],
      y = b[j];
    if (x === y) {
      out.push(x);
      i++;
      j++;
    } else if (x < y) i++;
    else j++;
  }
  return out;
}

function uniqueSorted(arr) {
  if (!arr.length) return arr;
  const out = [];
  let prev = arr[0] - 1;
  for (const v of arr) {
    if (v !== prev) out.push(v);
    prev = v;
  }
  return out;
}

function estimateRegexSelectivity(parsed) {
  if (!parsed || parsed.error) return 0.5; // unknown
  switch (parsed.type) {
    case "literal":
      return 0.0001;
    case "mask":
      return 0.01;
    case "prefixSuffix":
      return parsed.unbounded ? 0.1 : 0.05;
    case "prefix":
    case "suffix":
      return 0.1;
    case "contains":
      return 0.3;
    case "any":
      return 1.0;
    default:
      return 0.6; // generic
  }
}

function signatureForAnagramPattern(pattern) {
  // pattern already validated: collect letters & digraph letters
  const tokenRe = /\([a-zA-Z]+\)|[a-zA-Z]/g;
  const letters = [];
  let m;
  while ((m = tokenRe.exec(pattern)) !== null) {
    const tok = m[0];
    if (tok[0] === "(") {
      for (const c of tok.slice(1, -1).toLowerCase()) letters.push(c);
    } else letters.push(tok.toLowerCase());
  }
  return letters.sort().join("");
}

function rackMaxLengthSubanagram(pattern, { digraphUnits } = {}) {
  // Supply semantics: maximum letters obtainable from literals + optional wildcard capacities.
  // '.' and '?' each contribute at most 1 (letters) unless digraphUnits => up to 2 via a digraph.
  // '+' and '*' introduce unbounded capacity.
  // Parenthesized digraph tokens contribute their literal length; plain letters contribute 1.
  if (!pattern) return 0;
  const unitMax = digraphUnits ? 2 : 1;
  let i = 0;
  let total = 0;
  const s = String(pattern);
  while (i < s.length) {
    const ch = s[i];
    if (ch === "(") {
      const close = s.indexOf(")", i + 1);
      if (close === -1) break; // malformed
      const token = s.slice(i + 1, close);
      total += token.length; // token already validated
      i = close + 1;
      continue;
    }
    if (ch === "." || ch === "?") {
      total += unitMax;
      i++;
      continue;
    }
    if (ch === "+" || ch === "*") {
      return Infinity;
    }
    if (/[a-zA-Z]/.test(ch)) {
      total += 1;
      i++;
      continue;
    }
    i++; // ignore unexpected
  }
  return total;
}

function rackCountsForPattern(pattern) {
  // Reuse solver's canonical countRack to avoid divergence.
  const tokens = parseCards(pattern).map(normalizeToken);
  return countRack(tokens, DIGRAPHS);
}

function canFormWordFromRack(word, rackCounts) {
  // Quick letter availability check combining singles+digraph contributions
  const need = Object.create(null);
  for (const c of word) need[c] = (need[c] || 0) + 1;
  for (const [ch, cnt] of Object.entries(need)) {
    let avail = rackCounts.singleCounts[ch] || 0;
    for (const [dg, c] of Object.entries(rackCounts.digraphCounts))
      if (dg.includes(ch)) avail += c; // upper bound
    if (cnt > avail) return false;
  }
  // Backtracking exact cover using tokens
  const singles = { ...rackCounts.singleCounts };
  const digraphs = { ...rackCounts.digraphCounts };
  const dgList = Object.keys(digraphs).filter((d) => digraphs[d] > 0);
  const memo = new Map();
  function key(i) {
    // compact key: i + serialized remaining digraph counts + first few singles counts for pruning
    let k = i + ":";
    for (const dg of dgList) k += dg + digraphs[dg] + ";";
    // Optionally include remaining counts of letters in need subset to improve pruning
    return k;
  }
  function dfs(i) {
    if (i === word.length) return true;
    const k = key(i);
    if (memo.has(k)) return false; // only memo failures; successes return early
    const ch = word[i];
    // Try digraphs first (sometimes reduces branching)
    for (const dg of dgList) {
      const left = digraphs[dg];
      if (left <= 0) continue;
      if (word.startsWith(dg, i)) {
        digraphs[dg]--;
        if (dfs(i + dg.length)) return true;
        digraphs[dg]++;
      }
    }
    // Single letter option
    if ((singles[ch] || 0) > 0) {
      singles[ch]--;
      if (dfs(i + 1)) return true;
      singles[ch]++;
    }
    memo.set(k, false);
    return false;
  }
  return dfs(0);
}

// Lightweight upper-bound feasibility (no backtracking) used for quick pruning.
function quickLetterUpperBoundFeasible(word, rackCounts) {
  const need = Object.create(null);
  for (const c of word) need[c] = (need[c] || 0) + 1;
  for (const [ch, cnt] of Object.entries(need)) {
    let avail = rackCounts.singleCounts[ch] || 0;
    for (const [dg, c] of Object.entries(rackCounts.digraphCounts))
      if (dg.includes(ch)) avail += c;
    if (cnt > avail) return false;
  }
  return true;
}

// Heuristic: lower score => better (smaller branching) rack for base enumeration.
function scoreRackForEnumeration(rackCounts) {
  // Distinct token types (singles + digraphs) primary driver.
  let distinct =
    Object.keys(rackCounts.singleCounts).length +
    Object.keys(rackCounts.digraphCounts).length;
  // Total tiles (not letters) – larger adds branching.
  let totalTiles = 0;
  for (const v of Object.values(rackCounts.singleCounts)) totalTiles += v;
  for (const v of Object.values(rackCounts.digraphCounts)) totalTiles += v;
  // Vowel abundance increases branching slightly.
  const vowels = ["a", "e", "i", "o", "u"];
  let vowelTiles = 0;
  for (const v of vowels) vowelTiles += rackCounts.singleCounts[v] || 0;
  // Rare letters reduce branching (acts as anchor); subtract weight if present.
  const rareSet = ["q", "z", "j", "x"];
  let rareBonus = 0;
  for (const r of rareSet)
    if ((rackCounts.singleCounts[r] || 0) > 0) rareBonus += 1;
  // Digraph presence (esp. qu, th, ch, sh) also anchors.
  let digraphBonus = 0;
  for (const dg of Object.keys(rackCounts.digraphCounts)) {
    if (/qu|th|ch|sh|ph|wh/.test(dg)) digraphBonus += 0.5;
  }
  // Score formula (tuned heuristically):
  const score =
    distinct * 50 +
    totalTiles * 10 +
    vowelTiles * 5 -
    rareBonus * 30 -
    digraphBonus * 15;
  return score;
}

// searchMulti(specs, { sortMode } = {})
//  - specs: array of spec objects (same as before)
//  - sortMode values:
//       'len+', 'len-' (length ascending / descending; ties alpha ascending)
//       'alpha+', 'alpha-' (alphabetical ascending / descending)
//    Aliases: 'length+', 'length-', 'length-asc', 'length-desc', 'alpha', 'alpha-asc', 'alpha-desc'
//  - Always returns words now (previous returnWords/debug removed).
function searchMulti(specs, { sortMode, regexOptions } = {}) {
  ensureInit();
  if (!Array.isArray(specs))
    return {
      ok: false,
      errors: [vErr("invalid-args", "Specs must be an array")],
    };
  if (!specs.length)
    return {
      ok: true,
      indices: [],
      words: [],
      plan: [],
      minLen: 0,
      maxLen: Infinity,
    };

  const errors = [];
  const norm = []; // normalized specs
  let globalMin = 0,
    globalMax = Infinity;
  const anagramSignatures = new Set();
  const literalRegexWords = new Set();
  // First pass: validate & derive inherent length bounds
  for (const s of specs) {
    if (!s || typeof s !== "object") {
      errors.push(vErr("bad-spec", "Spec must be object", { spec: s }));
      continue;
    }
    const { type, pattern } = s;
    if (!["regex", "anagram", "subanagram", "length"].includes(type)) {
      errors.push(vErr("bad-type", "Unknown search type", { type }));
      continue;
    }
    if (pattern == null) {
      errors.push(vErr("null-pattern", "Pattern null", { type }));
      continue;
    }
    let valRes;
    if (type === "regex") valRes = validateRegex(pattern);
    else if (type === "anagram") valRes = validateAnagrams(pattern);
    else if (type === "subanagram") valRes = validateSubanagrams(pattern);
    else if (type === "length") {
      valRes = validateLengthPattern(pattern);
    }
    if (!valRes.ok) {
      errors.push(...valRes.errors.map((e) => ({ ...e, type })));
      continue;
    }

    let inherentMin = 0,
      inherentMax = Infinity,
      meta = {};
    // Merge regexOptions precedence: global < top-level call < per-spec
    const mergedRegexOptions = {
      ...__regexOptions,
      ...(regexOptions || {}),
      ...(s.options && s.options.regexOptions ? s.options.regexOptions : {}),
    };
    if (type === "length") {
      inherentMin = valRes.minLen;
      inherentMax = valRes.maxLen;
    } else if (type === "regex") {
      // parse / cache
      const regexCacheKey =
        valRes.normalized +
        "|" +
        (mergedRegexOptions.digraphUnits ? "du1" : "du0");
      let parsed = __regexParseCache.get(regexCacheKey);
      if (!parsed) {
        parsed = parseSimplifiedRegex(valRes.normalized, mergedRegexOptions);
        __regexParseCache.set(regexCacheKey, parsed);
      }
      if (parsed.error) {
        errors.push(
          vErr("parse-fail", "Regex parse failed", {
            pattern: valRes.normalized,
          })
        );
        continue;
      }
      inherentMin = parsed.minLen;
      inherentMax = parsed.maxLen;
      meta.parsed = parsed;
      if (parsed.type === "literal") literalRegexWords.add(parsed.data.word);
    } else if (type === "anagram") {
      if (/[.?+*]/.test(valRes.normalized)) {
        // Wildcard anagram: derive bounds via wildcard spec
        const wildSpec = parseWildcardAnagramPattern(valRes.normalized);
        if (!wildSpec.ok) {
          errors.push(
            vErr("parse-fail", "Wildcard anagram parse failed", {
              pattern: valRes.normalized,
            })
          );
          continue;
        }
        const digraphUnits = !!mergedRegexOptions.digraphUnits;
        const letterMinReq = wildSpec.totalLiteralLetters + wildSpec.anyMin;
        const letterMaxReq =
          wildSpec.anyMax === Infinity
            ? Infinity
            : wildSpec.totalLiteralLetters +
              wildSpec.anyMax * (digraphUnits ? 2 : 1);
        inherentMin = letterMinReq;
        inherentMax = letterMaxReq;
        meta.wildSpec = wildSpec;
        meta.hasWildcards = true;
        meta.literalOnly = false;
        meta.lengthRange = { min: letterMinReq, max: letterMaxReq };
      } else {
        const sig = signatureForAnagramPattern(valRes.normalized);
        meta.signature = sig;
        const len = sig.length;
        inherentMin = len;
        inherentMax = len;
        anagramSignatures.add(sig);
        meta.literalOnly = true;
        meta.hasWildcards = false;
        meta.lengthRange = { min: len, max: len };
      }
    } else if (type === "subanagram") {
      const rackMax = rackMaxLengthSubanagram(valRes.normalized, {
        digraphUnits: mergedRegexOptions.digraphUnits,
      });
      inherentMin = 0;
      inherentMax = rackMax; // subset semantics: empty intersection allowed length-wise
      meta.hasWildcards = /[.?+*]/.test(valRes.normalized);
      meta.lengthRange = { min: 0, max: rackMax };
    }

    // apply to global bounds
    if (inherentMin > globalMin) globalMin = inherentMin;
    if (inherentMax < globalMax) globalMax = inherentMax;
    norm.push({
      type,
      pattern: String(pattern),
      normalized: valRes.normalized,
      inherentMin,
      inherentMax,
      meta,
      options: s.options || {},
      mergedRegexOptions,
    });
  }
  if (errors.length) return { ok: false, errors };
  // Early unsatisfiable length bounds. Ensure consistent shape (include words:[]).
  if (globalMin > globalMax)
    return {
      ok: true,
      indices: [],
      words: [],
      plan: [{ reason: "length-contradiction", globalMin, globalMax }],
      minLen: globalMin,
      maxLen: globalMax,
      sortMode: normalizeSortMode(sortMode),
    };

  // Early contradictions
  // Only enforce signature contradiction for purely literal-only anagram specs.
  if (anagramSignatures.size > 1)
    return {
      ok: true,
      indices: [],
      words: [],
      plan: [{ reason: "anagram-signature-mismatch" }],
      minLen: globalMin,
      maxLen: globalMax,
      sortMode: normalizeSortMode(sortMode),
    };
  if (literalRegexWords.size > 1)
    return {
      ok: true,
      indices: [],
      words: [],
      plan: [{ reason: "literal-mismatch" }],
      minLen: globalMin,
      maxLen: globalMax,
      sortMode: normalizeSortMode(sortMode),
    };
  // If both literal regex word and anagram signature present, ensure match
  if (literalRegexWords.size === 1 && anagramSignatures.size === 1) {
    const lit = [...literalRegexWords][0];
    const sig = [...anagramSignatures][0];
    if (lit.split("").sort().join("") !== sig)
      return {
        ok: true,
        indices: [],
        words: [],
        plan: [{ reason: "literal-vs-anagram-mismatch" }],
        minLen: globalMin,
        maxLen: globalMax,
        sortMode: normalizeSortMode(sortMode),
      };
  }

  // Derive execution list (exclude pure length specs)
  const executables = norm.filter((s) => s.type !== "length");
  if (!executables.length) {
    // Only length constraints; return all word indices within bounds
    const out = [];
    for (let L = globalMin; L <= globalMax && L < WORDS_BY_LENGTH.length; L++) {
      const b = WORDS_BY_LENGTH[L];
      if (b) out.push(...b);
    }
    // out is concatenation of per-length sorted buckets but not globally sorted; sort to preserve contract
    out.sort((a, b) => a - b);
    let indices = uniqueSorted(out); // use let so we can reassign after sorting step
    let words = getWords(indices);
    ({ indices, words } = applySearchMultiSorting(indices, words, sortMode));
    return {
      ok: true,
      indices,
      words,
      plan: [
        {
          type: "length-only",
          globalMin,
          globalMax,
          produced: indices.length,
          after: indices.length,
        },
      ],
      minLen: globalMin,
      maxLen: globalMax,
      sortMode: normalizeSortMode(sortMode),
    };
  }

  function rank(s) {
    if (s.type === "regex") {
      const t = s.meta.parsed.type;
      if (t === "literal") return 0;
      if (t === "mask") return 2;
      if (t === "prefixSuffix" && !s.meta.parsed.unbounded) return 2;
      if (t === "prefix" || t === "suffix") return 3;
      if (t === "contains") return 4;
      if (t === "any") return 7;
      return 5;
    }
    if (s.type === "anagram") {
      if (s.meta.literalOnly) return 1; // very selective fixed-length
      const r = s.inherentMax - s.inherentMin;
      if (!isFinite(s.inherentMax)) return 6;
      if (r <= 2) return 3; // tight finite window
      return 5; // broader wildcard anagram
    }
    if (s.type === "subanagram") {
      if (!isFinite(s.inherentMax)) return 6; // unbounded due to +/*
      if (s.inherentMax <= 7) return 4; // small rack
      if (s.inherentMax <= 10) return 5; // medium
      return 6; // large
    }
    return 8;
  }

  executables.sort((a, b) => rank(a) - rank(b));

  // (Legacy subanagram base rack selection removed – wildcard supply semantics enumeration handled internally.)

  let current = null;
  const plan = [];

  for (const spec of executables) {
    let produced = [];
    const t = spec.type;
    const minLen = globalMin,
      maxLen = globalMax;
    let action = "enumerate";
    if (t === "regex") {
      // literal: direct lookup + length check
      if (spec.meta.parsed.type === "literal") {
        const w = spec.meta.parsed.data.word;
        const idx = WORD_TO_INDEX.get(w);
        produced =
          idx != null && w.length >= minLen && w.length <= maxLen ? [idx] : [];
      } else if (current) {
        // Filter existing candidates instead of full search
        const parsed = spec.meta.parsed;
        const kind = parsed.type;
        const out = [];
        const regexObj = kind === "generic" ? parsed.data.regex : null;
        for (const idx of current) {
          const w = WORD_LIST[idx];
          if (w.length < minLen || w.length > maxLen) continue;
          let ok = false;
          switch (kind) {
            case "any":
              ok = w.length >= parsed.minLen && w.length <= parsed.maxLen;
              break;
            case "prefix":
              ok = w.startsWith(parsed.data.prefix);
              break;
            case "suffix":
              ok = w.endsWith(parsed.data.suffix);
              break;
            case "contains":
              ok = w.includes(parsed.data.substring);
              break;
            case "prefixSuffix": {
              const { prefix, suffix, gapMin, unboundedGap } = parsed.data;
              if (w.startsWith(prefix) && w.endsWith(suffix)) {
                const gapLen = w.length - prefix.length - suffix.length;
                ok = gapLen >= gapMin && (unboundedGap || gapLen === gapMin);
              }
              break;
            }
            case "mask": {
              const { runs } = parsed.data;
              ok = true;
              for (const r of runs) {
                if (w.substr(r.pos, r.value.length) !== r.value) {
                  ok = false;
                  break;
                }
              }
              break;
            }
            case "generic":
              ok = regexObj.test(w);
              break;
          }
          if (ok) out.push(idx);
        }
        produced = out;
      } else {
        produced = searchRegex(spec.normalized, { minLen, maxLen });
      }
    } else if (t === "anagram") {
      produced = searchAnagrams(spec.normalized, {
        minLen,
        maxLen,
        regexOptions: spec.mergedRegexOptions,
      });
    } else if (t === "subanagram") {
      produced = searchSubanagrams(spec.normalized, {
        minLen,
        maxLen,
        regexOptions: spec.mergedRegexOptions,
      });
    }
    produced = uniqueSorted(produced);
    const after = current
      ? action === "filter"
        ? produced
        : intersectSorted(current, produced)
      : produced;
    plan.push({
      type: t,
      pattern: spec.pattern,
      normalized: spec.normalized,
      produced: produced.length,
      before: current ? current.length : null,
      after: after.length,
      rank: rank(spec),
      action,
    });
    current = after;
    if (!current.length) break;
  }

  let indices = current || [];
  let words = getWords(indices);
  ({ indices, words } = applySearchMultiSorting(indices, words, sortMode));
  return {
    ok: true,
    indices,
    words,
    plan,
    minLen: globalMin,
    maxLen: globalMax,
    sortMode: normalizeSortMode(sortMode),
  };
}

function normalizeSortMode(mode) {
  if (!mode) return null;
  const m = String(mode).toLowerCase().trim();
  if (
    [
      "len+",
      "length+",
      "length-asc",
      "len-asc",
      "length",
      "len",
      "lengthasc",
    ].includes(m)
  )
    return "len+";
  if (["len-", "length-", "length-desc", "len-desc", "lengthdesc"].includes(m))
    return "len-";
  if (["alpha+", "alpha", "alpha-asc", "a+", "a-asc"].includes(m))
    return "alpha+";
  if (["alpha-", "alpha-desc", "a-", "a-desc"].includes(m)) return "alpha-";
  return null; // unknown -> no sorting
}

function applySearchMultiSorting(indices, words, sortMode) {
  const mode = normalizeSortMode(sortMode);
  if (!mode) return { indices, words }; // no sorting requested or unknown code
  const pairs = indices.map((idx, i) => ({ idx, word: words[i] }));
  const alphaAsc = (a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0);
  if (mode === "len+") {
    pairs.sort((a, b) => a.word.length - b.word.length || alphaAsc(a, b));
  } else if (mode === "len-") {
    pairs.sort((a, b) => b.word.length - a.word.length || alphaAsc(a, b));
  } else if (mode === "alpha+") {
    pairs.sort(alphaAsc);
  } else if (mode === "alpha-") {
    pairs.sort((a, b) => -alphaAsc(a, b));
  }
  return {
    indices: pairs.map((p) => p.idx),
    words: pairs.map((p) => p.word),
  };
}

// Namespace export (browser/global)
const WordSearch = {
  init: ensureInit,
  stats,
  searchRegex,
  setRegexOptions: _setRegexOptions,
  getRegexOptions: _getRegexOptions,
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
    if (raw == null) return "*";
    let p = String(raw).trim();
    if (!p) return "*";
    // Do not double-wrap if user already started/ended with '*'
    if (!p.startsWith("*")) p = "*" + p;
    if (!p.endsWith("*")) p = p + "*";
    return p;
  },
};

// Ensure global access for UI scripts using window.WordSearch (const does not auto-attach)
try {
  if (typeof window !== "undefined") {
    window.WordSearch = WordSearch;
  }
} catch (_) {}

// ---- Word Search InputValidation integration (migrated from inline script) ----
(function () {
  if (typeof window === "undefined") return;
  if (!window.InputValidation) return; // framework not loaded yet
  // Obtain the digraph set. Note: top-level `const DIGRAPHS` does NOT become window.DIGRAPHS.
  // We defined DIGRAPHS in card_scores.js (as a top-level const) and also exposed it under window.QuiddlerData.
  const DIG =
    typeof DIGRAPHS !== "undefined"
      ? DIGRAPHS
      : window.QuiddlerData && window.QuiddlerData.DIGRAPHS
      ? window.QuiddlerData.DIGRAPHS
      : new Set();
  const ALLOWED = {
    regex: /[a-zA-Z.*+?()]/g,
    // Contains now supports same wildcard meta set as regex (letters, ., *, +, ?, parentheses for digraph convenience)
    contains: /[a-zA-Z.*+?()]/g,
    anagram: /[a-zA-Z.*+?()]/g,
    subanagram: /[a-zA-Z.*+?()]/g,
    length: /[0-9+\-<=]/g,
  };
  function collectParenTokens(input) {
    let open = -1;
    let nested = false;
    let unmatchedOpen = false;
    let unmatchedClose = false;
    const tokens = [];
    const chars = [...input];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === "(") {
        if (open !== -1) nested = true;
        open = i;
      } else if (ch === ")") {
        if (open === -1) {
          unmatchedClose = true;
        } else {
          const inner = input.slice(open + 1, i);
          tokens.push(inner);
          open = -1;
        }
      }
    }
    if (open !== -1) unmatchedOpen = true;
    return { tokens, nested, unmatchedOpen, unmatchedClose };
  }
  // --- Per-type validators (extracted for clarity) ---
  // Contains validator now mirrors regex (wildcards) but applies relaxed rules:
  //  - Allows empty (treated as no filter) and meta-only (e.g. '*') which map to 'any'.
  //  - Parentheses for digraphs validated like anagram/regex; valid digraph parens are stripped upstream.
  function validateContains(val) {
    const trimmed = (val == null ? "" : String(val)).trim();
    if (!trimmed) return { status: "ok" }; // empty accepted => no filter
    // Reuse regex-style validator with meta allowed
    const scan = collectParenTokens(trimmed);
    if (scan.unmatchedOpen || scan.unmatchedClose)
      return { status: "error", message: "Unmatched parentheses" };
    if (scan.nested) return { status: "error", message: "Nested parentheses" };
    const invalidDigraphPattern = [];
    const badDigraph = [];
    const invalidChars = new Set();
    for (const inner of scan.tokens) {
      if (!/^[a-zA-Z]+$/.test(inner)) {
        invalidDigraphPattern.push("(" + inner.toLowerCase() + ")");
        continue;
      }
      if (inner.length !== 2) {
        invalidDigraphPattern.push("(" + inner.toLowerCase() + ")");
        continue;
      }
      if (!DIG.has(inner.toLowerCase()))
        badDigraph.push("(" + inner.toLowerCase() + ")");
    }
    if (invalidDigraphPattern.length)
      return {
        status: "error",
        message: "Invalid digraph pattern: " + invalidDigraphPattern.join(", "),
      };
    if (badDigraph.length)
      return {
        status: "error",
        message: "Non-existent digraphs: " + badDigraph.join(", "),
      };
    const stripped = trimmed.replace(/\([^)]+\)/g, "");
    for (const ch of stripped) {
      if (/[a-zA-Z.*+?]/.test(ch)) continue;
      if (/[()\s]/.test(ch)) continue;
      invalidChars.add(ch);
    }
    if (invalidChars.size)
      return {
        status: "error",
        message: "Invalid characters: " + [...invalidChars].join(", "),
      };
    return { status: "ok" };
  }
  function validateLength(val) {
    const p = val.replace(/\s+/g, "");
    const errors = [];
    const num = (n) =>
      /^\d+$/.test(n)
        ? parseInt(n, 10)
        : (errors.push("Invalid number: " + n), null);
    let minLen = 0,
      maxLen = Infinity;
    const finish = () => {
      if (minLen < 0 || maxLen < 0) errors.push("Negative length not allowed");
      if (minLen > maxLen) errors.push("Min length exceeds max length");
      return errors;
    };
    if (p === "-") {
      const errs = finish();
      return errs.length
        ? { status: "error", message: errs.join("; ") }
        : { status: "ok" };
    }
    if (/^\d+$/.test(p)) {
      const n = num(p);
      if (n != null) {
        minLen = maxLen = n;
      }
      const errs = finish();
      return errs.length
        ? { status: "error", message: errs.join("; ") }
        : { status: "ok" };
    }
    if (/^(\d+)-(\d+)$/.test(p)) {
      const [, a, b] = p.match(/^(\d+)-(\d+)$/);
      const n1 = num(a),
        n2 = num(b);
      if (n1 != null && n2 != null) {
        minLen = n1;
        maxLen = n2;
      }
      const errs = finish();
      return errs.length
        ? { status: "error", message: errs.join("; ") }
        : { status: "ok" };
    }
    if (/^(\d+)-$/.test(p)) {
      const [, a] = p.match(/^(\d+)-$/);
      const n = num(a);
      if (n != null) minLen = n;
      const errs = finish();
      return errs.length
        ? { status: "error", message: errs.join("; ") }
        : { status: "ok" };
    }
    if (/^-(\d+)$/.test(p)) {
      const n = num(p.slice(1));
      if (n != null) {
        minLen = 0;
        maxLen = n;
      }
      const errs = finish();
      return errs.length
        ? { status: "error", message: errs.join("; ") }
        : { status: "ok" };
    }
    if (/^(>=|<=|>|<)\d+$/.test(p)) {
      const [, op, numStr] = p.match(/^(>=|<=|>|<)(\d+)$/);
      const n = parseInt(numStr, 10);
      if (op === ">=") minLen = n;
      else if (op === "<=") maxLen = n;
      else if (op === ">") minLen = n + 1;
      else if (op === "<") maxLen = Math.max(0, n - 1);
      const errs = finish();
      return errs.length
        ? { status: "error", message: errs.join("; ") }
        : { status: "ok" };
    }
    if (/^\d+\+$/.test(p)) {
      const n = num(p.slice(0, -1));
      if (n != null) minLen = n;
      const errs = finish();
      return errs.length
        ? { status: "error", message: errs.join("; ") }
        : { status: "ok" };
    }
    return { status: "error", message: "Unrecognized length pattern" };
  }
  function validateParenAware(
    val,
    {
      allowMeta = false,
      warnLargeSub = false,
      suppressBroadWarning = false,
    } = {}
  ) {
    const scan = collectParenTokens(val);
    if (scan.unmatchedOpen || scan.unmatchedClose)
      return { status: "error", message: "Unmatched parentheses" };
    if (scan.nested) return { status: "error", message: "Nested parentheses" };
    const invalidDigraphPattern = [];
    const badDigraph = [];
    const invalidChars = new Set();
    for (const inner of scan.tokens) {
      if (!/^[a-zA-Z]+$/.test(inner)) {
        invalidDigraphPattern.push("(" + inner.toLowerCase() + ")");
        continue;
      }
      if (inner.length !== 2) {
        invalidDigraphPattern.push("(" + inner.toLowerCase() + ")");
        continue;
      }
      if (!DIG.has(inner.toLowerCase()))
        badDigraph.push("(" + inner.toLowerCase() + ")");
    }
    if (invalidDigraphPattern.length)
      return {
        status: "error",
        message: "Invalid digraph pattern: " + invalidDigraphPattern.join(", "),
      };
    if (badDigraph.length)
      return {
        status: "error",
        message: "Non-existent digraphs: " + badDigraph.join(", "),
      };
    const stripped = val.replace(/\([^)]+\)/g, "");
    for (const ch of stripped) {
      if (allowMeta) {
        if (/[a-zA-Z.*+?]/.test(ch)) continue;
      } else {
        if (/[a-zA-Z]/.test(ch)) continue;
      }
      if (/[()\s]/.test(ch)) continue;
      invalidChars.add(ch);
    }
    if (invalidChars.size)
      return {
        status: "error",
        message: "Invalid characters: " + [...invalidChars].join(", "),
      };
    // Heuristic warnings (skip if suppressed)
    let letters = 0;
    const tokenRe = /\([^)]+\)|[a-zA-Z]/g;
    let m;
    while ((m = tokenRe.exec(val)) !== null) {
      const tok = m[0];
      letters += tok.startsWith("(") ? tok.length - 2 : 1;
    }
    const hasWild = /[.?*+]/.test(val);
    const unbounded = /[+*]/.test(val);
    const wildcardCount = (val.match(/[.?*+]/g) || []).length;
    // Broad pattern warnings (both anagram & subanagram when allowMeta) unless suppressed
    if (!suppressBroadWarning && allowMeta && hasWild) {
      // crude density: wildcards vs total tokens (letters+wildcards)
      const totalTokens = letters + wildcardCount;
      const density = wildcardCount / Math.max(1, totalTokens);
      if (unbounded) {
        // Subanagram (warnLargeSub flag true) always warn; anagram/regex only if few literals (letters <=2)
        if (warnLargeSub || letters <= 2) {
          const msg = warnLargeSub
            ? "Subanagram pattern has * or +; expect a large result set"
            : "Anagram pattern has * or + with few literals; expect a large result set";
          return { status: "warning", message: msg };
        }
      }
      if (!unbounded && density >= 0.6 && letters + wildcardCount >= 8)
        return {
          status: "warning",
          message: "Broad pattern; expect a large result set",
        };
    }
    return { status: "ok" };
  }
  const validators = {
    // Contains now also suppresses broad pattern warnings (same as regex/Pattern)
    contains: (v) =>
      validateParenAware(v, { allowMeta: true, suppressBroadWarning: true }),
    length: (v) => validateLength(v),
    // 'Pattern' (regex) should not show broadness warnings; suppress them.
    regex: (v) =>
      validateParenAware(v, { allowMeta: true, suppressBroadWarning: true }),
    anagram: (v) => validateParenAware(v, { allowMeta: true }),
    subanagram: (v) =>
      validateParenAware(v, { allowMeta: true, warnLargeSub: true }),
  };
  function validateByType(type, raw) {
    const val = (raw == null ? "" : String(raw)).trim();
    if (!val) return { status: "ok" };
    const fn = validators[type] || validators.regex;
    return fn(val);
  }
  // Register once (dynamic covers future rows)
  try {
    const reg = window.InputValidation.register({
      selector: "#searchRows .ws-input",
      dynamic: true,
      groupId: "word-search",
      debounceMs: 600,
      showTooltipOn: "hover",
      errorClass: "ws-error",
      allowed: function (currentValue, prevValue, ev) {
        try {
          const el =
            ev &&
            ev.target &&
            ev.target.classList &&
            ev.target.classList.contains("ws-input")
              ? ev.target
              : this;
          const row = el && el.closest ? el.closest("div") : null;
          const sel = row ? row.querySelector(".ws-type") : null;
          const type = sel ? sel.value : "regex";
          const re = ALLOWED[type] || /[\s\S]/g;
          const filtered = (currentValue.match(re) || []).join("");
          if (el && filtered !== currentValue) {
            el.value = filtered;
          }
          return filtered;
        } catch (_) {
          return currentValue;
        }
      },
      validate: function (value, el) {
        const row = el.closest("div");
        const sel = row ? row.querySelector(".ws-type") : null;
        const type = sel ? sel.value : "regex";
        return validateByType(type, value);
      },
    });
    // Revalidate inputs when their type select changes (new rules may apply)
    const rowsContainer = document.getElementById("searchRows");
    if (rowsContainer) {
      rowsContainer.addEventListener("change", (e) => {
        const sel =
          e.target &&
          e.target.classList &&
          e.target.classList.contains("ws-type")
            ? e.target
            : null;
        if (!sel) return;
        const row = sel.closest("div");
        const inp = row ? row.querySelector(".ws-input") : null;
        if (
          inp &&
          window.InputValidation &&
          typeof window.InputValidation.validateElement === "function"
        ) {
          // Defer so the other listener (which focuses/selects input) runs first; instance created after focus won't auto-show.
          setTimeout(() => {
            window.InputValidation.validateElement(inp);
          }, 0);
        }
      });
    }
    // Remove default Tailwind focus ring utility classes from dynamically created inputs to avoid blue halo overriding ws-error outline.
    const stripFocusRings = (el) => {
      if (!el || !el.classList) return;
      el.classList.forEach((cls) => {
        if (/^focus:/.test(cls) && /ring/.test(cls)) el.classList.remove(cls);
      });
    };
    // Initial existing inputs
    document.querySelectorAll("#searchRows .ws-input").forEach(stripFocusRings);
    // Observe future additions via MutationObserver (already used by framework, but we add a small observer for style cleanup)
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) {
            if (n.matches && n.matches("#searchRows .ws-input"))
              stripFocusRings(n);
            n.querySelectorAll &&
              n.querySelectorAll(".ws-input").forEach(stripFocusRings);
          }
        });
      }
    });
    try {
      mo.observe(document.getElementById("searchRows"), {
        childList: true,
        subtree: true,
      });
    } catch (_) {}
  } catch (_) {}
})();
