// Quiddler best-play solver
// Pipeline:
// 1) buildTrie: prefix trie from validWordsMap (built lazily once)
// 2) countRack: tally singles vs. digraph tiles
// 3) generateWordCandidates: DFS over trie with rack counts → scored candidates (keeps distinct usages)
// 4) chooseBestPlay: branch-and-bound search over candidate list with discard + bonuses
// 5) optimize: orchestrates and returns a play summary for rendering

// ---------- Build trie ----------
function buildTrie(words) {
  // Full-depth trie: every character of every word inserted; node.end marks complete words.
  const root = { children: Object.create(null), end: false };
  for (const wRaw of words) {
    const w = wRaw.toLowerCase();
    let node = root;
    for (const ch of w) {
      node = node.children[ch] ??= {
        children: Object.create(null),
        end: false,
      };
    }
    node.end = true;
  }
  return root;
}

// Global, lazily-initialized trie built from validWordsMap
let validWordTrie =
  typeof window !== "undefined" && window.validWordTrie
    ? window.validWordTrie
    : null;
function getValidWordTrie() {
  // Build once at full depth (no depth limiting); reuse thereafter.
  if (!validWordTrie) {
    const words =
      typeof validWordsMap !== "undefined" ? Object.keys(validWordsMap) : [];
    validWordTrie = buildTrie(words);
    if (typeof window !== "undefined") window.validWordTrie = validWordTrie;
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
    if (digraphSet.has(tile))
      digraphCounts[tile] = (digraphCounts[tile] || 0) + 1;
    else singleCounts[tile] = (singleCounts[tile] || 0) + 1;
  }
  return { singleCounts, digraphCounts };
}

// ---------- Gate helper (placeholder for future filtering) ----------
function getGate() {
  return null;
}

// ---------- Generate candidates (keep all distinct usages) ----------
function generateWordCandidates(trie, rackCounts, opts = {}) {
  // Options:
  // - minLen (default 2): minimum plain word length to accept
  // - maxLen (default Infinity): maximum plain word length to explore (prunes branching beyond)
  // - allowSingleDigraph (default false): if true, allow words composed of exactly one digraph tile (e.g., "qu")
  // - gate: optional predicate(word) -> boolean to filter candidates
  // DFS walks trie using available counts. Each path maintains:
  // - path: letters for trie traversal
  // - usedTokens: actual tiles used (singles or digraphs) to compute score/usage
  // De-duplication is per plain word by usage signature so (qu)a vs. q(u)a remain distinct if tiles differ.
  const {
    gate = null,
    minLen = 2,
    maxLen = Infinity,
    allowSingleDigraph = false,
    budget = null, // { start, budgetMs, timedOut }
  } = opts;

  const out = [];
  const path = [];
  const usedTokens = [];
  // use shared scoring util instead of local reducer
  // const scoreTokens = ts => ts.reduce((s, t) => s + (cardScores[t] || 0), 0);

  function usageFromTokens(tokens) {
    const u = {
      singleCounts: Object.create(null),
      digraphCounts: Object.create(null),
    };
    for (const t of tokens) {
      if (t.length === 1) u.singleCounts[t] = (u.singleCounts[t] || 0) + 1;
      else u.digraphCounts[t] = (u.digraphCounts[t] || 0) + 1;
    }
    return u;
  }
  function usageKey(u) {
    const s = Object.entries(u.singleCounts)
      .sort()
      .map(([k, v]) => k + v)
      .join("");
    const d = Object.entries(u.digraphCounts)
      .sort()
      .map(([k, v]) => k + v)
      .join("");
    return s + "|" + d;
  }

  const perWord = new Map();

  function pushResult() {
    const plainWord = path.join("");

    // Skip words that are a single digraph tile unless explicitly allowed
    if (
      !allowSingleDigraph &&
      usedTokens.length === 1 &&
      usedTokens[0].length > 1
    )
      return;

    if (gate && !gate(plainWord)) return;

    const usage = usageFromTokens(usedTokens);
    const key = usageKey(usage);

    const displayWord = joinTokensForDisplay(usedTokens);

    let bucket = perWord.get(plainWord);
    if (!bucket) {
      bucket = new Map();
      perWord.set(plainWord, bucket);
    }
    if (!bucket.has(key)) {
      const score = calculateScore(usedTokens);
      bucket.set(key, {
        word: displayWord,
        score,
        usage,
        length: plainWord.length,
      });
    }
  }

  let visitCounter = 0;
  function dfs(node, singleCounts, digraphCounts) {
    if (budget && !budget.timedOut) {
      // Check every 64 visits to amortize cost
      if ((visitCounter & 63) === 0) {
        const now =
          performance && performance.now ? performance.now() : Date.now();
        if (now - budget.start > budget.budgetMs) {
          budget.timedOut = true;
          return;
        }
      }
    }
    visitCounter++;
    if (budget && budget.timedOut) return;
    if (node.end && path.length >= minLen) pushResult();
    if (path.length >= maxLen) return; // stop expanding further

    for (const [L, c] of Object.entries(singleCounts)) {
      if (budget && budget.timedOut) return;
      if (c > 0 && node.children[L] && path.length + 1 <= maxLen) {
        singleCounts[L]--;
        path.push(L);
        usedTokens.push(L);
        dfs(node.children[L], singleCounts, digraphCounts);
        usedTokens.pop();
        path.pop();
        singleCounts[L]++;
      }
    }
    for (const [DG, c] of Object.entries(digraphCounts)) {
      if (budget && budget.timedOut) return;
      if (c > 0) {
        const a = DG[0],
          b = DG[1];
        const n1 = node.children[a],
          n2 = n1 && n1.children[b];
        if (n2 && path.length + 2 <= maxLen) {
          digraphCounts[DG]--;
          path.push(a, b);
          usedTokens.push(DG);
          dfs(n2, singleCounts, digraphCounts);
          usedTokens.pop();
          path.pop();
          path.pop();
          digraphCounts[DG]++;
        }
      }
    }
  }

  dfs(trie, { ...rackCounts.singleCounts }, { ...rackCounts.digraphCounts });

  for (const bucket of perWord.values())
    for (const cand of bucket.values()) out.push(cand);
  return out;
}

// ---------- Choose best play (no-flatten discard, leftover penalty, strict bonuses) ----------
function chooseBestPlay(candidates, rackCounts, params = {}, budget = null) {
  // Greedy sort for heuristic ordering; search is exhaustive with a pruning upper bound (ub).
  // leftover penalty: sum(points of unused tiles) minus best discard if allowed.
  // bonuses apply only if strictly exceeding opponents' currentLongest/currentMost thresholds.
  const {
    currentLongest = Infinity,
    currentMost = Infinity,
    noDiscard = false,
    longestBonus = 10,
    mostBonus = 10,
  } = params;

  candidates.sort(
    (a, b) =>
      b.score / Math.max(1, b.length) - a.score / Math.max(1, a.length) ||
      b.score - a.score ||
      b.length - a.length
  );

  const remSingles = { ...rackCounts.singleCounts };
  const remDigraphs = { ...rackCounts.digraphCounts };

  const remainingValue = () => {
    let s = 0;
    for (const [L, c] of Object.entries(remSingles))
      s += (cardScores[L] || 0) * c;
    for (const [D, c] of Object.entries(remDigraphs))
      s += (cardScores[D] || 0) * c;
    return s;
  };

  function totalRemainingCount() {
    let n = 0;
    for (const c of Object.values(remSingles)) n += c;
    for (const c of Object.values(remDigraphs)) n += c;
    return n;
  }

  function listRemainingTiles() {
    const arr = [];
    for (const [t, c] of Object.entries(remSingles))
      for (let i = 0; i < c; i++) arr.push(t);
    for (const [t, c] of Object.entries(remDigraphs))
      for (let i = 0; i < c; i++) arr.push(t);
    return arr;
  }

  function bestDiscardInfo() {
    let bestTile = null,
      bestVal = -Infinity;
    for (const [t, c] of Object.entries(remSingles)) {
      if (c > 0) {
        const v = cardScores[t] || 0;
        if (v > bestVal) {
          bestVal = v;
          bestTile = t;
        }
      }
    }
    for (const [t, c] of Object.entries(remDigraphs)) {
      if (c > 0) {
        const v = cardScores[t] || 0;
        if (v > bestVal) {
          bestVal = v;
          bestTile = t;
        }
      }
    }
    return { bestTile, bestVal: bestVal === -Infinity ? 0 : bestVal };
  }

  const fits = (u) => {
    for (const [L, c] of Object.entries(u.singleCounts))
      if ((remSingles[L] || 0) < c) return false;
    for (const [D, c] of Object.entries(u.digraphCounts))
      if ((remDigraphs[D] || 0) < c) return false;
    return true;
  };
  const apply = (u, sign) => {
    for (const [L, c] of Object.entries(u.singleCounts))
      remSingles[L] -= sign * c;
    for (const [D, c] of Object.entries(u.digraphCounts))
      remDigraphs[D] -= sign * c;
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
      penalty = remVal;
      discardTile = null;
      unusedTiles = listRemainingTiles();
    } else {
      const { bestTile, bestVal } = bestDiscardInfo();
      penalty = remVal - bestVal;
      discardTile = bestTile;

      const leftovers = listRemainingTiles();
      let removed = false;
      unusedTiles = [];
      for (const t of leftovers) {
        if (!removed && t === bestTile) {
          removed = true;
          continue;
        }
        unusedTiles.push(t);
      }
    }

    const bonus = {
      longest: cur.longest > currentLongest ? longestBonus : 0,
      most: cur.count > currentMost ? mostBonus : 0,
    };

    const total =
      Math.max(cur.baseScore - penalty, 0) + bonus.longest + bonus.most;

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
    if (budget && !budget.timedOut) {
      const now =
        performance && performance.now ? performance.now() : Date.now();
      if (now - budget.start > budget.budgetMs) {
        budget.timedOut = true;
        return;
      }
    }
    if (budget && budget.timedOut) return;
    const ub = cur.baseScore + remainingValue() + longestBonus + mostBonus;
    if (ub <= best.totalScore) return;

    if (i === candidates.length) {
      evalCurrent();
      return;
    }

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

/**
 * Compute the best play for a rack.
 * @param {string} tiles Rack string e.g. "(qu)a(th)i". Parentheses wrap digraph tiles.
 * @param {Object} [opts]
 * @param {boolean} [opts.noDiscard=false] If true, may not discard a single leftover tile; all leftovers penalize.
 * @param {number}  [opts.currentLongest=0] Opponent longest to beat (strictly >). 0 disables bonus comparison.
 * @param {number}  [opts.currentMost=0] Opponent word-count to beat (strictly >). 0 disables bonus comparison.
 * @param {boolean} [opts.apiFilter=false] If true, re-validates candidate set words against external API.
 * @param {number}  [opts.timeBudgetMs=5000] Soft time budget for candidate generation / search.
 * @returns {Promise<{words:Array<{word:string,score:number}>, baseScore:number, leftoverValue:number, bonus:{longest:number,most:number}, totalScore:number, longestWordLength:number, wordCount:number, discardTile:string|null, unusedTiles:string[], _timedOut?:boolean}>}
 */
async function optimize(tiles, opts = {}) {
  // Parse options
  const {
    noDiscard = false,
    currentLongest = 0,
    currentMost = 0,
    apiFilter = false,
    timeBudgetMs,
  } = opts;

  if (!tiles || typeof tiles !== "string")
    throw new Error("optimize: tiles string required");
  const rack = parseCards(tiles).map(normalizeToken);
  const startTime =
    performance && performance.now ? performance.now() : Date.now();
  const TIME_BUDGET_MS = Number.isFinite(timeBudgetMs) ? timeBudgetMs : 5000; // soft budget
  function timedOut() {
    const now = performance && performance.now ? performance.now() : Date.now();
    return now - startTime > TIME_BUDGET_MS;
  }
  const rackCounts = countRack(rack, DIGRAPHS);

  // (No frequency/Zipf filtering; build a trivial gate placeholder.)
  const gate = getGate();

  // Use the global, lazily-initialized trie instead of rebuilding each time
  const trie = getValidWordTrie();
  const budget = {
    start: startTime,
    budgetMs: TIME_BUDGET_MS,
    timedOut: false,
  };
  const candidates = generateWordCandidates(trie, rackCounts, {
    gate,
    minLen: 2,
    budget,
  });
  if (budget.timedOut) {
    return {
      words: [],
      baseScore: 0,
      leftoverValue: 0,
      bonus: { longest: 0, most: 0 },
      totalScore: 0,
      longestWordLength: 0,
      wordCount: 0,
      discardTile: null,
      unusedTiles: rack.slice(),
      _timedOut: true,
    };
  }
  if (timedOut()) {
    // fallback safeguard
    return {
      words: [],
      baseScore: 0,
      leftoverValue: 0,
      bonus: { longest: 0, most: 0 },
      totalScore: 0,
      longestWordLength: 0,
      wordCount: 0,
      discardTile: null,
      unusedTiles: rack.slice(),
      _timedOut: true,
    };
  }

  let bestplay = chooseBestPlay(
    candidates,
    rackCounts,
    {
      noDiscard,
      currentLongest: currentLongest === 0 ? Infinity : currentLongest,
      currentMost: currentMost === 0 ? Infinity : currentMost,
      longestBonus: longestWordPoints,
      mostBonus: mostWordsPoints,
    },
    budget
  );
  if (budget.timedOut || timedOut()) {
    return Object.assign(bestplay || {}, { _timedOut: true });
  }

  if (apiFilter) {
    if (typeof validateWordAPIBatch !== "function") {
      console.warn(
        "API filter requested but validateWordAPIBatch is unavailable. Skipping API filter."
      );
    } else {
      let remainingCandidates = candidates.slice();
      let iterations = 0;
      while (iterations < 5 && bestplay.words.length) {
        const { invalidPlain } = await validateWordAPIBatch(
          bestplay.words.map((w) => w.word)
        );
        if (!invalidPlain.size) break;
        remainingCandidates = remainingCandidates.filter(
          (c) => !invalidPlain.has(plainWord(c.word).toLowerCase())
        );
        if (!remainingCandidates.length) {
          bestplay = {
            words: [],
            baseScore: 0,
            leftoverValue: 0,
            bonus: { longest: 0, most: 0 },
            totalScore: 0,
            longestWordLength: 0,
            wordCount: 0,
            discardTile: null,
            unusedTiles: rack.slice(),
          };
          break;
        }
        bestplay = chooseBestPlay(
          remainingCandidates,
          rackCounts,
          {
            noDiscard,
            currentLongest: currentLongest === 0 ? Infinity : currentLongest,
            currentMost: currentMost === 0 ? Infinity : currentMost,
            longestBonus: longestWordPoints,
            mostBonus: mostWordsPoints,
          },
          budget
        );
        if (budget.timedOut || timedOut()) {
          return Object.assign(bestplay || {}, { _timedOut: true });
        }
        iterations++;
      }
    }
  }

  return bestplay;
}

if (typeof window !== "undefined") {
  // Namespace exports (used by UI + other modules).
  window.QuiddlerSolver = Object.assign({}, window.QuiddlerSolver || {}, {
    optimize,
    countRack, // expose for word_search sub-anagram reuse
  });
}
