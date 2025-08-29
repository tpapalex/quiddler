// Quiddler best-play solver
// Pipeline overview:
// 1) buildTrie: builds a prefix trie from validWordsMap (depth limited by maxRound)
// 2) countRack: splits tiles into single letters vs. digraph tile counts
// 3) makeCommonGateFromEntries: makes a frequency-based filter from common_lemmas.js entries
// 4) generateWordCandidates: DFS over trie using available rack counts to produce scored candidates
//    - Keeps distinct usages per plain word (different digraph/single compositions)
//    - Rejects words that are a single digraph tile (e.g., "qu")
// 5) chooseBestPlay: branch-and-bound search selecting a set of non-overlapping candidates
//    - Computes leftover penalty; supports optional discard of a single highest-value tile
//    - Applies strict bonuses vs. currentLongest/currentMost thresholds
// 6) optimize: orchestrates, wires to UI params, and returns a summary for rendering

// ---------- Build trie ----------
function buildTrie(words, maxDepth = 10) {
  // Insert each word up to maxDepth; mark node.end for words whose full length <= maxDepth.
  // This lets DFS stop early while still recognizing completes within the search horizon.
  const root = { children: Object.create(null), end: false };
  for (const wRaw of words) {
    const w = wRaw.toLowerCase();
    let node = root, depth = 0;
    for (const ch of w) {
      if (depth >= maxDepth) break;
      node = node.children[ch] ??= { children: Object.create(null), end: false };
      depth++;
    }
    if (w.length <= maxDepth) node.end = true;
  }
  return root;
}

// Global, lazily-initialized trie built from validWordsMap
let validWordTrie = (typeof window !== 'undefined' && window.validWordTrie) ? window.validWordTrie : null;
function getValidWordTrie() {
  // Create once, reuse across optimize() calls. Depth tied to maxRound so longer paths are pruned.
  if (!validWordTrie) {
    const words = (typeof validWordsMap !== 'undefined') ? Object.keys(validWordsMap) : [];
    const depth = (typeof maxRound === 'number') ? maxRound : 10;
    validWordTrie = buildTrie(words, depth);
    if (typeof window !== 'undefined') window.validWordTrie = validWordTrie;
  }
  return validWordTrie;
}

// ---------- Count rack ----------
function countRack(tiles, digraphSet) {
  // Separate inventory into singles vs. digraphs; used by candidate DFS and leftover accounting.
  const singleCounts = Object.create(null);
  const digraphCounts = Object.create(null);
  for (const raw of tiles) {
    const tile = raw.toLowerCase();
    if (digraphSet.has(tile)) digraphCounts[tile] = (digraphCounts[tile] || 0) + 1;
    else singleCounts[tile] = (singleCounts[tile] || 0) + 1;
  }
  return { singleCounts, digraphCounts };
}

// ---------- Common gate helper (runtime knob) ----------
function makeCommonGateFromEntries(
  entries,
  { mode = 'zipf', minZipF = 3.8, topK = 10000, override2and3 = false } = {},
  lemmatizer
) {
  // entries: array of [lemma, zipfScore, rank]
  // - mode zipf/rank/either/both controls acceptance
  // - override2and3: allow any 2–3 letter words regardless of frequency
  // - lemmatizer: optional wink-lemmatizer to map inflected forms to base lemma
  const MAP = new Map(entries.map(([l, z, r]) => [l, { zipf: z, rank: r }]));

  function lemma(word) {
    word = word.toLowerCase();
    let best = word;
    if (lemmatizer?.noun)      { const n = lemmatizer.noun(word);      if (n && n.length < best.length) best = n; }
    if (lemmatizer?.verb)      { const v = lemmatizer.verb(word);      if (v && v.length < best.length) best = v; }
    if (lemmatizer?.adjective) { const a = lemmatizer.adjective(word); if (a && a.length < best.length) best = a; }
    if (lemmatizer?.adverb)    { const r = lemmatizer.adverb(word);    if (r && r.length < best.length) best = r; }
    return best;
  }

  return function isCommon(word) {
    if (override2and3 && word.length >= 2 && word.length <= 3) return true;

    const l = lemma(word);
    const rec = MAP.get(l);
    if (!rec) return false;

    if (mode === 'zipf')   return rec.zipf >= minZipF;
    if (mode === 'rank')   return rec.rank <= topK;
    if (mode === 'either') return rec.zipf >= minZipF || rec.rank <= topK;
    if (mode === 'both')   return rec.zipf >= minZipF && rec.rank <= topK;
    return false;
  };
}

// ---------- Generate candidates (keep all distinct usages) ----------
function generateWordCandidates(trie, rackCounts, minLen = 2, opts = {}) {
  // DFS walks trie using available counts. Each path maintains:
  // - path: letters for trie traversal
  // - usedTokens: actual tiles used (singles or digraphs) to compute score/usage
  // De-duplication is per plain word by usage signature so (qu)a vs. q(u)a remain distinct if tiles differ.
  const { commonGate = null } = opts;

  const out = [];
  const path = [];
  const usedTokens = [];
  // use shared scoring util instead of local reducer
  // const scoreTokens = ts => ts.reduce((s, t) => s + (cardScores[t] || 0), 0);

  function usageFromTokens(tokens) {
    const u = { singleCounts: Object.create(null), digraphCounts: Object.create(null) };
    for (const t of tokens) {
      if (t.length === 1) u.singleCounts[t] = (u.singleCounts[t] || 0) + 1;
      else u.digraphCounts[t] = (u.digraphCounts[t] || 0) + 1;
    }
    return u;
  }
  function usageKey(u) {
    const s = Object.entries(u.singleCounts).sort().map(([k,v])=>k+v).join('');
    const d = Object.entries(u.digraphCounts).sort().map(([k,v])=>k+v).join('');
    return s + '|' + d;
  }

  const perWord = new Map();

  function pushResult() {
    const plainWord = path.join('');

    // Skip words that are a single digraph tile (e.g., "qu", "th")
    if (usedTokens.length === 1 && usedTokens[0].length > 1) return;

    if (commonGate && !commonGate(plainWord)) return;

    const usage = usageFromTokens(usedTokens);
    const key = usageKey(usage);

    const displayWord = joinTokensForDisplay(usedTokens);

    let bucket = perWord.get(plainWord);
    if (!bucket) { bucket = new Map(); perWord.set(plainWord, bucket); }
    if (!bucket.has(key)) {
      const score = calculateScore(usedTokens);
      bucket.set(key, { word: displayWord, score, usage, length: plainWord.length });
    }
  }

  function dfs(node, singleCounts, digraphCounts) {
    if (node.end && path.length >= minLen) pushResult();

    for (const [L, c] of Object.entries(singleCounts)) {
      if (c > 0 && node.children[L]) {
        singleCounts[L]--; path.push(L); usedTokens.push(L);
        dfs(node.children[L], singleCounts, digraphCounts);
        usedTokens.pop(); path.pop(); singleCounts[L]++;
      }
    }
    for (const [DG, c] of Object.entries(digraphCounts)) {
      if (c > 0) {
        const a = DG[0], b = DG[1];
        const n1 = node.children[a], n2 = n1 && n1.children[b];
        if (n2) {
          digraphCounts[DG]--; path.push(a,b); usedTokens.push(DG);
          dfs(n2, singleCounts, digraphCounts);
          usedTokens.pop(); path.pop(); path.pop(); digraphCounts[DG]++;
        }
      }
    }
  }

  dfs(trie, { ...rackCounts.singleCounts }, { ...rackCounts.digraphCounts });

  for (const bucket of perWord.values()) for (const cand of bucket.values()) out.push(cand);
  return out;
}

// ---------- Choose best play (no-flatten discard, leftover penalty, strict bonuses) ----------
function chooseBestPlay(candidates, rackCounts, params = {}) {
  // Greedy sort for heuristic ordering; search is exhaustive with a pruning upper bound (ub).
  // leftover penalty: sum(points of unused tiles) minus best discard if allowed.
  // bonuses apply only if strictly exceeding opponents' currentLongest/currentMost thresholds.
  const {
    currentLongest = Infinity,
    currentMost    = Infinity,
    noDiscard      = false,
    longestBonus   = 10,
    mostBonus      = 10,
  } = params;

  candidates.sort((a, b) =>
    (b.score / Math.max(1, b.length)) - (a.score / Math.max(1, a.length)) ||
    (b.score - a.score) ||
    (b.length - a.length)
  );

  const remSingles  = { ...rackCounts.singleCounts };
  const remDigraphs = { ...rackCounts.digraphCounts };

  const remainingValue = () => {
    let s = 0;
    for (const [L, c] of Object.entries(remSingles))  s += (cardScores[L] || 0) * c;
    for (const [D, c] of Object.entries(remDigraphs)) s += (cardScores[D] || 0) * c;
    return s;
  };

  function totalRemainingCount() {
    let n = 0;
    for (const c of Object.values(remSingles))  n += c;
    for (const c of Object.values(remDigraphs)) n += c;
    return n;
  }

  function listRemainingTiles() {
    const arr = [];
    for (const [t, c] of Object.entries(remSingles))  for (let i = 0; i < c; i++) arr.push(t);
    for (const [t, c] of Object.entries(remDigraphs)) for (let i = 0; i < c; i++) arr.push(t);
    return arr;
  }

  function bestDiscardInfo() {
    let bestTile = null, bestVal = -Infinity;
    for (const [t, c] of Object.entries(remSingles)) {
      if (c > 0) {
        const v = cardScores[t] || 0;
        if (v > bestVal) { bestVal = v; bestTile = t; }
      }
    }
    for (const [t, c] of Object.entries(remDigraphs)) {
      if (c > 0) {
        const v = cardScores[t] || 0;
        if (v > bestVal) { bestVal = v; bestTile = t; }
      }
    }
    return { bestTile, bestVal: (bestVal === -Infinity ? 0 : bestVal) };
  }

  const fits = (u) => {
    for (const [L, c] of Object.entries(u.singleCounts))  if ((remSingles[L]  || 0) < c) return false;
    for (const [D, c] of Object.entries(u.digraphCounts)) if ((remDigraphs[D] || 0) < c) return false;
    return true;
  };
  const apply = (u, sign) => {
    for (const [L, c] of Object.entries(u.singleCounts))  remSingles[L]  -= sign * c;
    for (const [D, c] of Object.entries(u.digraphCounts)) remDigraphs[D] -= sign * c;
  };

  let best = {
    baseScore: -Infinity,
    words: [],
    longest: 0,
    count: 0,
    leftoverValue: Infinity,
    totalScore: -Infinity,
    bonus: { longest: 0, most: 0 },
    discardTile: null,
    unusedTiles: [],
  };

  const cur = { baseScore: 0, words: [], longest: 0, count: 0 };

  function evalCurrent() {
    const remCount = totalRemainingCount();

    if (!noDiscard && remCount === 0) return;

    const remVal = remainingValue();
    let penalty, discardTile, unusedTiles;

    if (noDiscard) {
      penalty     = remVal;
      discardTile = null;
      unusedTiles = listRemainingTiles();
    } else {
      const { bestTile, bestVal } = bestDiscardInfo();
      penalty     = remVal - bestVal;
      discardTile = bestTile;

      const leftovers = listRemainingTiles();
      let removed = false;
      unusedTiles = [];
      for (const t of leftovers) {
        if (!removed && t === bestTile) { removed = true; continue; }
        unusedTiles.push(t);
      }
    }

    const bonus = {
      longest: cur.longest > currentLongest ? longestBonus : 0,
      most:    cur.count   > currentMost    ? mostBonus   : 0,
    };

    const total = Math.max(cur.baseScore - penalty, 0) + bonus.longest + bonus.most;

    if (total > best.totalScore) {
      best = {
        baseScore: cur.baseScore,
        words: cur.words.map(({ word, score }) => ({ word, score })),
        longest: cur.longest,
        count: cur.count,
        leftoverValue: penalty,
        totalScore: total,
        bonus,
        discardTile,
        unusedTiles,
      };
    }
  }

  function dfs(i) {
    const ub = cur.baseScore + remainingValue() + longestBonus + mostBonus;
    if (ub <= best.totalScore) return;

    if (i === candidates.length) { evalCurrent(); return; }

    const w = candidates[i];

    if (fits(w.usage)) {
      apply(w.usage, +1);
      cur.words.push(w);
      const prevLongest = cur.longest;
      cur.longest = Math.max(cur.longest, w.length);
      cur.baseScore += w.score;
      cur.count += 1;

      dfs(i + 1);

      cur.count -= 1;
      cur.baseScore -= w.score;
      cur.longest = prevLongest;
      cur.words.pop();
      apply(w.usage, -1);
    }

    dfs(i + 1);
  }

  dfs(0);

  return {
    words: best.words,
    baseScore: best.baseScore,
    leftoverValue: best.leftoverValue,
    bonus: best.bonus,
    totalScore: best.totalScore,
    longestWordLength: best.longest,
    wordCount: best.count,
    discardTile: best.discardTile,
    unusedTiles: best.unusedTiles,
  };
}

async function optimize(params) {
  // Params from UI:
  // - tiles: rack string like "(qu)a(th)i"; parser handles parentheses
  // - noDiscard: if true, cannot discard one leftover tile; all leftovers penalize
  // - commonOnly + minZipF + override2and3: frequency filter using common_lemmas.js (window.wordFreq)
  // - currentLongest/currentMost: thresholds to beat for bonuses (strictly greater)
  // - apiFilter: if true, further require words to appear in Free Dictionary API (lazy best-play validation)
  // Returns: bestplay summary consumed by render.renderOptimizedPlayFromResult
  const {
    tiles = '',
    noDiscard = false,
    commonOnly = false,
    override2and3 = false,
    minZipF = 0,
    currentLongest = 0,
    currentMost = 0,
    apiFilter = false,
  } = params || {};

  const rack = parseCards(String(tiles)).map(normalizeToken);
  const rackCounts = countRack(rack, DIGRAPHS);

  const lemmatizer = (typeof window !== 'undefined') ? window.winkLemmatizer : undefined;

  // Resolve frequency list from global if available
  const wf = (typeof window !== 'undefined') ? window.wordFreq : undefined;

  const commonGate = (commonOnly && Array.isArray(wf) && wf.length)
    ? makeCommonGateFromEntries(wf, { mode: 'zipf', override2and3, minZipF }, lemmatizer)
    : null;

  // Use the global, lazily-initialized trie instead of rebuilding each time
  const trie = getValidWordTrie();
  const candidates = generateWordCandidates(trie, rackCounts, 2, { commonGate });

  let bestplay = chooseBestPlay(candidates, rackCounts, {
    noDiscard,
    currentLongest: currentLongest === 0 ? Infinity : currentLongest,
    currentMost:    currentMost    === 0 ? Infinity : currentMost,
    longestBonus: longestWordPoints,
    mostBonus:    mostWordsPoints,
  });

  if (apiFilter) {
    if (typeof validateWordAPIBatch !== 'function') {
      console.warn('API filter requested but validateWordAPIBatch is unavailable. Skipping API filter.');
    } else {
      let remainingCandidates = candidates.slice();
      let iterations = 0;
      while (iterations < 5 && bestplay.words.length) {
        const { invalidPlain } = await validateWordAPIBatch(bestplay.words.map(w => w.word));
        if (!invalidPlain.size) break;
        remainingCandidates = remainingCandidates.filter(c => !invalidPlain.has(plainWord(c.word).toLowerCase()));
        if (!remainingCandidates.length) {
          bestplay = {
            words: [], baseScore: 0, leftoverValue: 0, bonus: { longest:0, most:0 }, totalScore: 0,
            longestWordLength: 0, wordCount: 0, discardTile: null, unusedTiles: rack.slice()
          };
          break;
        }
        bestplay = chooseBestPlay(remainingCandidates, rackCounts, {
          noDiscard,
          currentLongest: currentLongest === 0 ? Infinity : currentLongest,
          currentMost:    currentMost    === 0 ? Infinity : currentMost,
          longestBonus: longestWordPoints,
          mostBonus:    mostWordsPoints,
        });
        iterations++;
      }
    }
  }

  return bestplay;
}

if (typeof window !== 'undefined') {
  // Namespace exports used by tools_drawer and debug consoles.
  window.QuiddlerSolver = Object.assign({}, window.QuiddlerSolver || {}, {
    optimize,
  });
}
