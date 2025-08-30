'use strict';

/*
  game.js — Game flow and scoring logic for Quiddler

  State:
  - players: ordered array of player names; dealer rotates each round
  - roundsData: array of round objects; each round keeps per-player chit objects
    round = {
      roundNum: number,
      players: {
        [playerName]: Array<{
          text: string,         // raw chit text, e.g. (qu)ick or -e(th)
          score: number,        // computed from scoring.calculateScore(parseCards(...))
          state: 'neutral'|'valid'|'invalid', // result of challenge resolution
          challenger: string|null // who challenged this word (or null for GOD/unassigned)
        }> & bookkeeping fields set during recalc:
        baseScore: number,
        challengeDeductions: number,
        bonus: number,
        gotLongestBonus: boolean,
        gotMostWordsBonus: boolean,
        roundScore: number
      }
    }

  Rules encoded here:
  - Words prefixed with '-' are unused/penalty chits and never get challenged or definition lookups.
  - A word contributes to base score if:
    • state !== 'invalid', OR
    • state === 'invalid' but has no challenger (definition-only check or unchallenged)
  - Challenge deductions:
    • If a VALID word is challenged, challenger pays the word's points.
    • If an INVALID word is challenged, owner pays the word's points.
  - Bonuses (if enabled via UI): strictly single-winner for longest word length and most words.
*/

let gameStarted = false;
let players = [];
let scores = {};
let currentRound = 3;
let startCards = 3;              // NEW: configurable starting hand size
let maxRound = 10;               // (was const) now configurable ending hand size
let roundsData = [];
let longestWordBonus = false;
let mostWordsBonus = false;
let longestWordPoints = 0;
let mostWordsPoints = 0;
let currentDealerIdx = 0;
const DEALER_EMOJI = '♠️'; // Dealer indicator (alternatives: 🃏 🎴 ♣️ ♦️ ♠️ ❤️ 🂠)
let dictSource = 'local';        // NEW: 'local' | 'api'
// New UI flow state
let gameOver = false;                   // when true, no more rounds accepted
let lastGameCompletedAllRounds = false; // track whether the prior game reached the final round
// NEW (Partial round support): rounds may exist before all players submit.
// A round object now also has:
//   finalized: boolean (default true for legacy rounds / when all players submitted)
//   submittedPlayers: { [playerName]: true }
// We create the round on first player submission and keep adding/replacing rows until all submit.
let currentRoundDraftInputs = {}; // NEW: per-player in-progress text for current round

// --- Persistence (localStorage) ---
const Q_STORAGE_KEY = 'quiddlerGameStateV2'; // bumped from V1; legacy load removed
// NEW: separate key to persist pre-game (new game page) options even if a game wasn't started yet.
const Q_PRE_CONFIG_KEY = 'quiddlerPreGameConfigV1';
let __suppressPreConfigSave = false; // guard to avoid feedback loops while programmatically setting inputs
let __suppressAutoSave = false; // guard to avoid recursive saves during load

function serializeGameState() {
  if (!gameStarted || !players.length) return null;
  const draft = (!gameOver && currentRoundDraftInputs && Object.keys(currentRoundDraftInputs).length)
    ? { roundNum: currentRound, inputs: currentRoundDraftInputs }
    : null;
  return {
    version: 2,
    players: players.slice(),
    roundsData: roundsData.map(r => ({
      roundNum: r.roundNum,
      dealer: r.dealer || null,
      finalized: r.finalized !== false,
      skipped: !!r.skipped, // NEW persisted skipped flag
      submittedPlayers: Object.keys(r.submittedPlayers || {}),
      players: Object.fromEntries(Object.entries(r.players || {}).map(([p, arr]) => [p, arr.map(w => ({
        text: w.text,
        score: w.score,
        state: w.state,
        challenger: w.challenger == null ? null : w.challenger
      }))]))
    })),
    currentRound,
    currentDealerIdx,
    longestWordBonus,
    mostWordsBonus,
    longestWordPoints,
    mostWordsPoints,
    gameOver,
    lastGameCompletedAllRounds,
    startCards,
    maxRound,
    dictSource,
    draftRound: draft
  };
}
function saveGameState() {
  if (__suppressAutoSave) return;
  try {
    const data = serializeGameState();
    if (!data) {
      localStorage.removeItem(Q_STORAGE_KEY);
      return;
    }
    localStorage.setItem(Q_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Persist save failed', e);
  }
}
// NEW: Serialize current pre-game form values (only when not in an active game)
function serializePreGameConfig() {
  if (gameStarted) return null; // only store when on new game page
  try {
    const playersRaw = document.getElementById('playersInput')?.value || '';
    const longestB = !!document.getElementById('longestWordBonus')?.checked;
    const mostB = !!document.getElementById('mostWordsBonus')?.checked;
    const longestPts = +(document.getElementById('longestWordPoints')?.value || 0) || 0;
    const mostPts = +(document.getElementById('mostWordsPoints')?.value || 0) || 0;
    const sc = +(document.getElementById('startCards')?.value || 3) || 3;
    const ec = +(document.getElementById('endCards')?.value || 10) || 10;
    const dictApiAlso = !!document.getElementById('dictApiAlso')?.checked;
    return {
      v: 1,
      playersRaw,
      longestB,
      mostB,
      longestPts,
      mostPts,
      sc,
      ec,
      dictApiAlso
    };
  } catch { return null; }
}
function savePreGameConfig() {
  if (__suppressPreConfigSave) return;
  const data = serializePreGameConfig();
  try {
    if (!data) localStorage.removeItem(Q_PRE_CONFIG_KEY); else localStorage.setItem(Q_PRE_CONFIG_KEY, JSON.stringify(data));
  } catch {}
}
function loadPreGameConfig() {
  if (gameStarted) return; // don't override running game UI
  try {
    const raw = localStorage.getItem(Q_PRE_CONFIG_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return;
    __suppressPreConfigSave = true;
    const p = document.getElementById('playersInput'); if (p && !p.disabled && data.playersRaw != null) p.value = data.playersRaw;
    const l = document.getElementById('longestWordBonus'); if (l && !l.disabled) l.checked = data.longestB;
    const m = document.getElementById('mostWordsBonus'); if (m && !m.disabled) m.checked = data.mostB;
    const lp = document.getElementById('longestWordPoints'); if (lp && !lp.disabled) lp.value = data.longestPts;
    const mp = document.getElementById('mostWordsPoints'); if (mp && !mp.disabled) mp.value = data.mostPts;
    const sc = document.getElementById('startCards'); if (sc && !sc.disabled) sc.value = data.sc;
    const ec = document.getElementById('endCards'); if (ec && !ec.disabled) ec.value = data.ec;
    const api = document.getElementById('dictApiAlso'); if (api && !api.disabled) api.checked = !!data.dictApiAlso;
    updateBonusInputs(); // reflect enabling/disabling points
  } catch {} finally { __suppressPreConfigSave = false; }
}
// Attach listeners to pre-game inputs to auto-save config while editing (only when not in a game)
function attachPreGameConfigListeners() {
  const ids = ['playersInput','longestWordBonus','mostWordsBonus','longestWordPoints','mostWordsPoints','startCards','endCards','dictApiAlso'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = (el.tagName === 'INPUT' && (el.type === 'number' || el.type === 'text')) ? 'input' : 'change';
    el.addEventListener(evt, () => { if (!gameStarted) savePreGameConfig(); });
  });
}
function loadGameState() {
  try {
    const raw = localStorage.getItem(Q_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || data.version !== 2) return; // only V2 supported

    __suppressAutoSave = true;

    players = data.players || [];
    roundsData = (data.roundsData || []).map(r => ({
      roundNum: r.roundNum,
      dealer: r.dealer || null,
      finalized: r.finalized !== false, // treat missing as finalized
      skipped: !!r.skipped,            // NEW load skipped flag
      submittedPlayers: (r.submittedPlayers || []).reduce((m,p)=>{ m[p]=true; return m; }, {}),
      players: Object.fromEntries(Object.entries(r.players || {}).map(([p, arr]) => [p, arr.map(w => ({
        text: w.text,
        score: w.score,
        state: w.state || 'neutral',
        challenger: w.challenger == null ? null : w.challenger
      }))]))
    }));
    // Backfill missing dealer fields if absent
    roundsData.forEach((r,i)=>{ if(!r.dealer && players.length) r.dealer = players[i % players.length]; });
    currentRound = data.currentRound || 3;
    // NEW: load configurable ranges (fallback to legacy defaults)
    startCards = +data.startCards || 3;
    maxRound = +data.maxRound || 10;
    dictSource = data.dictSource === 'api' ? 'api' : 'local';
    // NEW: restore draft inputs (only if not gameOver later)
    currentRoundDraftInputs = (data.draftRound && typeof data.draftRound === 'object') ? (data.draftRound.roundNum === data.currentRound ? (data.draftRound.inputs || {}) : {}) : {};
    const __restoredDraftCopy = { ...currentRoundDraftInputs }; // preserve before setupRound() may clear
    currentDealerIdx = data.currentDealerIdx || 0;
    longestWordBonus = !!data.longestWordBonus;
    mostWordsBonus = !!data.mostWordsBonus;
    longestWordPoints = +data.longestWordPoints || 0;
    mostWordsPoints = +data.mostWordsPoints || 0;
    gameOver = !!data.gameOver;
    lastGameCompletedAllRounds = !!data.lastGameCompletedAllRounds;
    gameStarted = true;

    // --- Adjust round progression respecting unfinalized round ---
    if (!gameOver && roundsData.length) {
      const last = roundsData[roundsData.length - 1];
      if (last.finalized) {
        if (currentRound <= last.roundNum && last.roundNum < maxRound) {
          currentRound = last.roundNum + 1; // advance only if last was finalized
        }
      } else {
        currentRound = last.roundNum; // keep working on this round
      }
    }

    // Reflect UI controls
    const pInput = document.getElementById('playersInput');
    if (pInput) { pInput.value = players.join(','); pInput.disabled = true; }
    const lCB = document.getElementById('longestWordBonus');
    const mCB = document.getElementById('mostWordsBonus');
    if (lCB) { lCB.checked = longestWordBonus; lCB.disabled = true; }
    if (mCB) { mCB.checked = mostWordsBonus; mCB.disabled = true; }
    const lPts = document.getElementById('longestWordPoints');
    const mPts = document.getElementById('mostWordsPoints');
    if (lPts) { lPts.value = longestWordPoints; lPts.disabled = true; }
    if (mPts) { mPts.value = mostWordsPoints; mPts.disabled = true; }
    // NEW: reflect start/end card inputs
    const sc = document.getElementById('startCards');
    const ec = document.getElementById('endCards');
    if (sc) { sc.value = startCards; sc.disabled = true; }
    if (ec) { ec.value = maxRound; ec.disabled = true; }
    // NEW: reflect dict source radios -> replaced with single checkbox
    const apiAlso = document.getElementById('dictApiAlso');
    if (apiAlso) { apiAlso.checked = (dictSource === 'api'); apiAlso.disabled = true; }

    document.getElementById('preGameConfig')?.classList.add('hidden');
    document.getElementById('gameArea')?.classList.remove('hidden');
    document.getElementById('currentBonuses')?.classList.remove('hidden');
    // NEW: show skip button on restore (if game not over)
    const skipBtn2 = document.getElementById('skipRoundBtn'); if (skipBtn2 && !gameOver) { skipBtn2.classList.remove('hidden'); skipBtn2.disabled = false; }
    document.getElementById('endGameBtn')?.classList.remove('hidden');

    // Recompute (ensures scores and bonuses re-derived if logic changed)
    recalculateScores();
    updatePreviousRounds();

    if (gameOver) {
      // Re-show game over state & summary
      endGame(lastGameCompletedAllRounds);
    } else {
      // Dealer index in saved state is always one ahead (setupRound increments after using it)
      if (players.length) {
        currentDealerIdx = (currentDealerIdx - 1 + players.length) % players.length;
      }
      // If the current (last) round is unfinalized, rebuild inputs from it; else create fresh inputs
      const last = roundsData[roundsData.length - 1];
      if (last && !last.finalized && last.roundNum === currentRound) {
        rebuildInputsFromExistingRound(last);
      } else {
        setupRound();
        // Reapply preserved draft inputs AFTER setupRound cleared them
        currentRoundDraftInputs = __restoredDraftCopy;
      }
      // After building inputs, apply any draft text for players not yet submitted (and without existing row words)
      try {
        const roundDraft = __restoredDraftCopy; // use preserved copy
        Object.entries(roundDraft).forEach(([p,val]) => {
          const inp = document.querySelector(`.player-words[data-player="${p}"]`);
            if (inp && (!roundsData.find(r=>r.roundNum===currentRound && r.finalized===false)?.submittedPlayers[p])) {
              if (!inp.value || inp.value.trim() === '') inp.value = val;
            }
        });
      } catch {}
    }
    // Ensure headers visibility on restored game
    const hasRounds = roundsData.length > 0;
    document.getElementById('runningTotalsHeader')?.classList.toggle('hidden', !hasRounds);
    document.getElementById('previousRoundsHeader')?.classList.toggle('hidden', !hasRounds);
    // NEW: keep lists in sync with headers when restoring
    document.getElementById('scoreTotals')?.classList.toggle('hidden', !hasRounds);
    document.getElementById('previousRounds')?.classList.toggle('hidden', !hasRounds);
    // NEW: toggle hint under Previous Rounds with the section
    document.getElementById('previousRoundsHint')?.classList.toggle('hidden', !hasRounds);
  } catch (e) {
    console.warn('Persist load failed', e);
  } finally {
    __suppressAutoSave = false;
    // Save immediately to normalize schema if needed
    saveGameState();
  }
}

// Local dictionary validation (re-added)
function validateWordLocal(raw) {
  if (!raw) return false;
  const txt = String(raw).trim();
  if (!txt || txt.startsWith('-')) return false; // unused/penalty chits never validated
  // Strip parentheses (keep inner letters), punctuation, and digits; normalize to upper
  const plain = txt
    .replace(/\([^)]*\)/g, (m) => m.replace(/[()]/g, '')) // remove parens but keep letters inside
    .replace(/[()]/g,'')
    .replace(/[^A-Za-z]/g,'')
    .toUpperCase();
  if (!plain) return false;
  try {
    return !!(typeof validWordsMap !== 'undefined' && validWordsMap[plain]);
  } catch {
    return false;
  }
}

/**
 * Initialize a new game from the UI controls and render round 1.
 */
function startGame() {
  if (gameStarted) return; // prevent duplicate init
  // Parse and clean players list
  players = document.getElementById('playersInput').value
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());

  if (!players.length) {
    alert('Please enter at least one player');
    return;
  }

  // Read configurable card range first (validate before committing to game start)
  const rawStart = +(document.getElementById('startCards')?.value || 3);
  const rawEnd = +(document.getElementById('endCards')?.value || 10);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
    alert('Please enter numeric values for start/end cards.');
    return;
  }
  if (rawStart < 3) {
    alert('Starting number of cards must be at least 3.');
    return;
  }
  if (rawStart > rawEnd) {
    alert('Starting number of cards cannot be greater than ending number of cards.');
    return;
  }
  startCards = rawStart;
  maxRound = rawEnd;
  dictSource = document.getElementById('dictApiAlso')?.checked ? 'api' : 'local';

  // Reset all global variables to initial state (after validation)
  gameStarted = true;
  gameOver = false;
  scores = {};
  currentRound = startCards;
  roundsData = [];
  currentDealerIdx = 0;
  longestWordBonus = document.getElementById('longestWordBonus').checked;
  mostWordsBonus = document.getElementById('mostWordsBonus').checked;
  longestWordPoints = +document.getElementById('longestWordPoints').value;
  mostWordsPoints = +document.getElementById('mostWordsPoints').value;

  // Initialize player scores
  players.forEach(player => scores[player] = 0);

  // Disable inputs after initial setup and hide pre-game block
  document.getElementById('playersInput').disabled = true;
  document.getElementById('longestWordBonus').disabled = true;
  document.getElementById('mostWordsBonus').disabled = true;
  document.getElementById('longestWordPoints').disabled = true;
  document.getElementById('mostWordsPoints').disabled = true;
  document.getElementById('startCards').disabled = true; // NEW
  document.getElementById('endCards').disabled = true;   // NEW
  const apiAlso = document.getElementById('dictApiAlso'); if (apiAlso) apiAlso.disabled = true; // UPDATED
  document.getElementById('preGameConfig')?.classList.add('hidden');

  // Clear previous game state from UI
  document.getElementById('scoreTotals').innerHTML = '';
  document.getElementById('previousRounds').innerHTML = '';

  // Make game area visible and start first round
  document.getElementById('gameArea').classList.remove('hidden');
  document.getElementById('currentBonuses')?.classList.remove('hidden');
  // NEW: ensure skip round button visible
  const skipBtn = document.getElementById('skipRoundBtn'); if (skipBtn) { skipBtn.classList.remove('hidden'); skipBtn.disabled = false; }

  // Toolbar visibility
  document.getElementById('endGameBtn')?.classList.remove('hidden');

  // Ensure submit button is enabled for a fresh game
  const submitBtn = document.getElementById('submitRoundBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add('hidden'); } // HIDE global submit in partial mode

  // Make sure round inputs are visible when starting anew
  document.getElementById('scoreInputs')?.classList.remove('hidden');

  // Hide section headers until a first round exists
  document.getElementById('runningTotalsHeader')?.classList.add('hidden');
  document.getElementById('previousRoundsHeader')?.classList.add('hidden');
  // NEW: also hide the lists themselves until there are rounds
  document.getElementById('scoreTotals')?.classList.add('hidden');
  document.getElementById('previousRounds')?.classList.add('hidden');
  // NEW: hide the hint under Previous Rounds until there are rounds
  document.getElementById('previousRoundsHint')?.classList.add('hidden');
  setupRound();
  saveGameState();
  // On starting a game, remove the pre-game config snapshot (we will rely on real game state now)
  try { localStorage.removeItem(Q_PRE_CONFIG_KEY); } catch {}
}

/**
 * Populate the score input fields for the current round and advance dealer.
 */
function setupRound() {
  const dealer = players[currentDealerIdx % players.length];
  document.getElementById('roundHeader').innerText = `Round ${currentRound} Cards`;

  document.getElementById('scoreInputs').innerHTML = `
    <div class="text-sm text-gray-500 mb-2">Enter words separated by spaces (parentheses for digraphs, '-' prefix for unused). Submit each player individually; round auto-advances after all submitted. Enter submits just that player.</div>
    ${players.map((player, i) => `
      <div class="player-input-row mb-2 flex items-center gap-2">
        <label for="player-words-${i}" class="font-semibold w-24 md:w-28 lg:w-32 shrink-0 whitespace-nowrap overflow-hidden text-ellipsis pr-1 flex items-center">${player}${player === dealer ? `<span class="dealer-indicator ml-0.5" aria-label="Deals this round" data-tippy-content="Deals this round">${DEALER_EMOJI}</span>` : ''}</label>
        <input id="player-words-${i}" class="player-words flex-1 min-w-0 w-full p-2 border rounded text-left" data-player="${player}" placeholder="e.g., (qu)ick(er) bad -e(th)">
        <button type="button" class="submit-player-btn px-2 py-1 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded" data-player="${player}" title="Submit ${player}'s play">Submit</button>
      </div>
    `).join('')}`;
  document.getElementById('scoreInputs')?.classList.remove('hidden');
  // Initialize tippy for dealer indicator (current round)
  if (window.tippy) {
    document.querySelectorAll('#scoreInputs .dealer-indicator').forEach(el => {
      el.removeAttribute('title');
      const cfg = { delay:[500,0], animation:'none', placement:'bottom', theme:'plain', arrow:false, offset:[0,6] };
      if (!el._tippy) tippy(el, cfg); else el._tippy.setProps(cfg);
    });
  }
  document.querySelectorAll('.player-words').forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!gameOver) submitPlayerPlay(inp.dataset.player);
      }
    });
  });
  document.querySelectorAll('.submit-player-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!gameOver) submitPlayerPlay(btn.dataset.player);
    });
  });
  const firstInput = document.querySelector('.player-words');
  if (firstInput) { firstInput.focus(); firstInput.select?.(); }
  currentDealerIdx++;
  currentRoundDraftInputs = {}; // NEW reset draft for new round
}

// NEW: Rebuild current round input UI from an existing unfinalized round (on reload)
function rebuildInputsFromExistingRound(round) {
  if (!round) return;
  const dealer = round.dealer;
  document.getElementById('roundHeader').innerText = `Round ${round.roundNum} Cards`;
  document.getElementById('scoreInputs').innerHTML = `
    <div class="text-sm text-gray-500 mb-2">Round in progress. Edit & resubmit a single player as needed; challenges reset for that player's changed words. Enter submits just that player.</div>
    ${players.map((player, i) => {
      const existing = (round.players[player] || []).map(w=>w.text).join(' ');
      return `
      <div class=\"player-input-row mb-2 flex items-center gap-2\">
        <label for=\"player-words-${i}\" class=\"font-semibold w-24 md:w-28 lg:w-32 shrink-0 whitespace-nowrap overflow-hidden text-ellipsis pr-1 flex items-center\">${player}${player === dealer ? `<span class=\"dealer-indicator ml-0.5\" aria-label=\"Deals this round\" data-tippy-content=\"Deals this round\">${DEALER_EMOJI}</span>` : ''}</label>
        <input id=\"player-words-${i}\" class=\"player-words flex-1 min-w-0 w-full p-2 border rounded text-left\" data-player=\"${player}\" value=\"${existing.replace(/"/g,'&quot;')}\" placeholder=\"e.g., (qu)ick(er) bad -e(th)\">
        <button type=\"button\" class=\"submit-player-btn px-2 py-1 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded\" data-player=\"${player}\" title=\"Submit ${player}'s play\">Submit</button>
      </div>`;
    }).join('')}`;
  document.getElementById('scoreInputs')?.classList.remove('hidden');
  if (window.tippy) {
    document.querySelectorAll('#scoreInputs .dealer-indicator').forEach(el => {
      el.removeAttribute('title');
      const cfg = { delay:[500,0], animation:'none', placement:'bottom', theme:'plain', arrow:false, offset:[0,6] };
      if (!el._tippy) tippy(el, cfg); else el._tippy.setProps(cfg);
    });
  }
  document.querySelectorAll('.player-words').forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (!gameOver) submitPlayerPlay(inp.dataset.player); }
    });
  });
  document.querySelectorAll('.submit-player-btn').forEach(btn => {
    btn.addEventListener('click', () => { if (!gameOver) submitPlayerPlay(btn.dataset.player); });
  });
  currentRoundDraftInputs = Object.assign({}, currentRoundDraftInputs); // ensure object
  // Reapply any draft into inputs (players not yet submitted)
  setTimeout(() => {
    Object.entries(currentRoundDraftInputs).forEach(([p,val]) => {
      const r = roundsData.find(r=>r.roundNum===round.roundNum && r.finalized===false);
      if (r && !r.submittedPlayers[p]) {
        const inp = document.querySelector(`.player-words[data-player="${p}"]`);
        if (inp && (inp.value.trim()==='')) inp.value = val;
      }
    });
  },0);
}

// PARTIAL ROUND: per-player submission
function submitPlayerPlay(playerName) {
  if (gameOver || !playerName) return;
  // Find existing unfinalized round for currentRound
  let round = roundsData.find(r => r.roundNum === currentRound && r.finalized === false);
  if (!round) {
    // Create new in-progress round (first submission for this round)
    const roundDealer = players[(currentDealerIdx - 1 + players.length) % players.length];
    round = { roundNum: currentRound, dealer: roundDealer, players: {}, finalized: false, submittedPlayers: {} };
    // Seed empty arrays for consistency
    players.forEach(p => round.players[p] = round.players[p] || []);
    roundsData.push(round);
  }
  // Read input value for this player
  let inputEl = null;
  document.querySelectorAll('.player-words').forEach(inp => { if (inp.dataset.player === playerName) inputEl = inp; });
  const text = (inputEl?.value || '').trim();
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  // Replace player's row; clear any previous challenges by constructing fresh objects
  round.players[playerName] = words.map(word => ({
    text: word,
    score: scoreForChit(word),
    state: word.startsWith('-') ? 'invalid' : 'neutral',
    challenger: null
  }));
  // Mark submitted even if blank (explicit clear). Blank wipes prior words.
  round.submittedPlayers[playerName] = true;
  // Clear draft for submitted player
  delete currentRoundDraftInputs[playerName];

  recalculateScores(); // dynamic bonuses allowed
  updatePreviousRounds();
  saveGameState();

  // Auto-finalize when all players submitted
  const allSubmitted = players.every(p => round.submittedPlayers[p]);
  if (allSubmitted) {
    round.finalized = true;
    recalculateScores();
    updatePreviousRounds();
    saveGameState();
    if (currentRound < maxRound) {
      currentRound += 1;
      setupRound();
      saveGameState();
    } else {
      endGame(true);
    }
    return; // stop focusing logic; new round (or game end) handled
  }

  // Focus next blank/unsubmitted input for convenience
  const inputs = Array.from(document.querySelectorAll('.player-words'));
  for (const inp of inputs) {
    const p = inp.dataset.player;
    const val = inp.value.trim();
    if (!round.submittedPlayers[p] || val === '') { // not yet submitted or still blank
      inp.focus();
      inp.select?.();
      break;
    }
  }
}

// ---------- Helpers ----------
// A word counts toward base if it's not invalid OR it's invalid with no challenger (definition-only / unchallenged).
function eligibleForBase(word) {
  return (word.state !== 'invalid') || (word.state === 'invalid' && word.challenger == null);
}
// A word counts toward bonuses if it is NOT a '-' chit and passes base eligibility.
function eligibleForBonus(word) {
  return !word.text.startsWith('-') && eligibleForBase(word);
}
// Signed value for a single word (handles '-' penalty).
function wordBaseValue(word) {
  const sign = word.text.startsWith('-') ? -1 : 1;
  return sign * word.score;
}
// Base points for a player's row.
function baseScoreForPlayer(pdata) {
  return pdata.reduce((sum, w) => sum + (eligibleForBase(w) ? wordBaseValue(w) : 0), 0);
}
// Words eligible for bonuses.
function bonusEligibleWords(pdata) {
  return pdata.filter(eligibleForBonus);
}
// Longest word length (letters only).
function longestWordLen(pdata) {
  return bonusEligibleWords(pdata)
    .reduce((max, w) => Math.max(max, plainLength(w.text)), 0);
}
// Count of bonus-eligible words.
function wordsCount(pdata) {
  return bonusEligibleWords(pdata).length;
}
// Reset per-round bookkeeping fields on a player's row data.
function resetRoundPlayerState(pdata) {
  pdata.roundScore = 0;
  pdata.challengeDeductions = 0;
  pdata.bonus = 0;
  pdata.gotLongestBonus = false;
  pdata.gotMostWordsBonus = false;
}
// Apply challenge deductions per the rules (see README for details).
function applyChallengeDeductionsForPlayer(round, player) {
  const pdata = round.players[player];
  pdata.forEach(word => {
    if (word.state === 'valid' && word.challenger) {
      round.players[word.challenger].challengeDeductions += word.score;
    } else if (word.state === 'invalid' && word.challenger) {
      pdata.challengeDeductions += word.score;
    }
  });
}

// ---------- Main ----------
/**
 * Recompute every player's score across all rounds, including bonuses and challenges.
 */
function recalculateScores() {
  players.forEach(player => { scores[player] = 0; });

  roundsData.forEach(round => {
    if (!round || typeof round !== 'object') return;
    if (!round.players) round.players = {};

    // Ensure a row exists for every current player, then reset per-round fields
    players.forEach(player => {
      if (!Array.isArray(round.players[player])) round.players[player] = [];
      resetRoundPlayerState(round.players[player]);
    });

    let longestLength = 0;
    let mostWordsCount = 0;
    let longestPlayers = [];
    let mostWordsPlayers = [];

    players.forEach(player => {
      const pdata = round.players[player];
      pdata.baseScore = baseScoreForPlayer(pdata);

      const pLongest = longestWordLen(pdata);
      if (pLongest > longestLength) {
        longestLength = pLongest;
        longestPlayers = [player];
      } else if (pLongest === longestLength && pLongest > 0) {
        longestPlayers.push(player);
      }

      const pCount = wordsCount(pdata);
      if (pCount > mostWordsCount) {
        mostWordsCount = pCount;
        mostWordsPlayers = [player];
      } else if (pCount === mostWordsCount && pCount > 0) {
        mostWordsPlayers.push(player);
      }
    });

    players.forEach(player => applyChallengeDeductionsForPlayer(round, player));

    if (longestWordBonus && longestPlayers.length === 1) {
      const p = longestPlayers[0];
      round.players[p].bonus += longestWordPoints;
      round.players[p].gotLongestBonus = true;
    }
    if (mostWordsBonus && mostWordsPlayers.length === 1) {
      const p = mostWordsPlayers[0];
      round.players[p].bonus += mostWordsPoints;
      round.players[p].gotMostWordsBonus = true;
    }

    players.forEach(player => {
      const pdata = round.players[player];
      pdata.roundScore = Math.max(0, pdata.baseScore - pdata.challengeDeductions) + pdata.bonus;
      scores[player] += pdata.roundScore;
    });
  });

  updateScores();
  saveGameState();
}

/**
 * Open the Play Helper prefilled from a player's current round row.
 */
function prefillPlayFor(roundIdx, playerName, e) {
  e?.stopPropagation?.();
  const round = roundsData[roundIdx];
  if (!round) return;

  const pdata = round.players[playerName] || [];
  const tiles = pdata.map(w => w.text).join(' ');

  let oppMaxLongest = 0;
  let oppMaxMost = 0;
  players.forEach(p => {
    if (p === playerName) return;
    const opData = round.players[p] || [];
    oppMaxLongest = Math.max(oppMaxLongest, longestWordLen(opData));
    oppMaxMost    = Math.max(oppMaxMost,    wordsCount(opData));
  });

  window.QuiddlerTools?.prefillPlay?.({
    tiles,
    currentLongest: oppMaxLongest,
    currentMost: oppMaxMost
  });
}

/**
 * Switch a player's row to edit mode (inline editing of chits as text).
 */
function enterEditMode(player, roundIdx, btn) {
  const row = btn.closest('.group');
  const cell = row.querySelector('.row-chits-cell') || row.querySelector('.flex-1.min-w-0');
  if (!cell) return;

  const chits = cell.querySelector('.chit-container');
  const edit  = cell.querySelector('.edit-container');
  if (!edit) return;

  // Swap controls to Save/Cancel
  const controls = row.querySelector('.controls-cell');
  if (controls) {
    const viewC = controls.querySelector('.controls-view-mode');
    const editC = controls.querySelector('.controls-edit-mode');
    viewC?.classList.add('hidden');
    editC?.classList.remove('hidden');
  }

  chits?.classList.add('hidden');
  edit.classList.remove('hidden');

  const input = edit.querySelector('.edit-input');
  if (input) {
    input.focus();
    const v = input.value; input.value = ''; input.value = v;

    input.addEventListener('keydown', function handler(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEdit(player, roundIdx, btn);
        input.removeEventListener('keydown', handler);
      }
    });
  }
}

function cancelEdit(btn) {
  const row = btn.closest('.group');
  const cell = row.querySelector('.row-chits-cell') || row.querySelector('.flex-1.min-w-0');
  if (!cell) return;

  cell.querySelector('.edit-container')?.classList.add('hidden');
  cell.querySelector('.chit-container')?.classList.remove('hidden');

  // Restore controls to Edit/Gear
  const controls = row.querySelector('.controls-cell');
  if (controls) {
    const viewC = controls.querySelector('.controls-view-mode');
    const editC = controls.querySelector('.controls-edit-mode');
    editC?.classList.add('hidden');
    viewC?.classList.remove('hidden');
  }
}

/**
 * Save edits to a player's row, then re-render and recalc totals.
 */
function saveEdit(player, roundIdx, btn) {
  const row = btn.closest('.group');
  const cell = row.querySelector('.row-chits-cell') || row.querySelector('.flex-1.min-w-0');
  if (!cell) return;

  const input = cell.querySelector('.edit-input');
  const newWords = (input?.value || '').trim().split(/\s+/).filter(Boolean);

  roundsData[roundIdx].players[player] = newWords.map(word => ({
    text: word,
    score: scoreForChit(word),
    state: word.startsWith('-') ? 'invalid' : 'neutral',
    challenger: null
  }));

  // If editing an unfinalized round, mark that player as submitted (re)submitted
  const r = roundsData[roundIdx];
  if (r && r.finalized === false) {
    r.submittedPlayers = r.submittedPlayers || {};
    r.submittedPlayers[player] = true;
  }

  recalculateScores();
  updatePreviousRounds();
}

/**
 * Update the leaderboard list from the current totals.
 */
function updateScores() {
  document.getElementById('scoreTotals').innerHTML = players
    .map(player => ({ player, score: scores[player] }))
    .sort((a, b) => b.score - a.score)
    .map(({ player, score }) => `<li>${player}: ${score} points</li>`)
    .join('');
}

/**
 * Toggle a word's challenge state and assign a challenger via a dropdown.
 * Flow:
 * - Click cycles from neutral → choose challenger → valid/invalid based on dictionary → neutral.
 * - 'GOD' selection marks a challenged resolution without attributing deductions to another player.
 */
function toggleChallenge(btn, e) {
  e.stopPropagation();

  document.querySelectorAll('.challenger-dropdown').forEach(el => el.remove());

  const roundIdx = btn.dataset.round;
  const player = btn.dataset.player;
  const wordIdx = btn.dataset.word;
  const wordObj = roundsData[roundIdx].players[player][wordIdx];

  if (wordObj.text.startsWith('-')) return;

  if (wordObj.state === 'valid' || wordObj.state === 'invalid') {
    wordObj.state = 'neutral';
    wordObj.challenger = null;
    recalculateScores();
    updatePreviousRounds();
    return;
  }

  const challengerDropdown = document.createElement('select');
  challengerDropdown.className = 'ml-2 p-1 border rounded challenger-dropdown';
  challengerDropdown.innerHTML = `<option value="">Select Challenger</option><option value="null">GOD</option>` +
    players.filter(p => p !== player).map(p => `<option>${p}</option>`).join('');

  challengerDropdown.onchange = async function() {
    if (this.value === '') { this.remove(); return; }
    if (this.value !== 'null') wordObj.challenger = this.value;
    // UPDATED: Gate API validation behind local dictionary presence.
    if (dictSource === 'api') {
      const locallyValid = validateWordLocal(wordObj.text);
      if (!locallyValid) {
        // Immediately mark invalid; do not hit API for non-local words.
        wordObj.state = 'invalid';
        recalculateScores();
        updatePreviousRounds();
        this.remove();
        return;
      }
      wordObj.state = 'checking';
      updatePreviousRounds();
      try {
        const plain = wordObj.text
          .replace(/\([^)]*\)/g, m => m.replace(/[()]/g,''))
          .replace(/[()]/g,'')
          .replace(/[^A-Za-z]/g,'')
          .toLowerCase();
        if (!plain) {
          wordObj.state = 'invalid';
        } else {
          const { found, error } = await getWordDefinitionAPI(plain);
          if (error) {
            // On API error, fall back to local validity (already true here).
            wordObj.state = 'valid';
          } else {
            wordObj.state = found ? 'valid' : 'invalid';
          }
        }
      } catch {
        // On unexpected failure, default to locally valid (conservative) result.
        wordObj.state = 'valid';
      }
      recalculateScores();
      updatePreviousRounds();
      this.remove();
      return;
    }
    // Local path (sync)
    wordObj.state = validateWordLocal(wordObj.text) ? 'valid' : 'invalid';
    recalculateScores();
    updatePreviousRounds();
    this.remove();
  };

  btn.after(challengerDropdown);

  function clickOutsideHandler(event) {
    if (!challengerDropdown.contains(event.target)) {
      challengerDropdown.remove();
      document.removeEventListener('click', clickOutsideHandler);
    }
  }
  setTimeout(() => { document.addEventListener('click', clickOutsideHandler); }, 0);
}

// Players input affects default bonuses
// - 1 player: no bonuses; 2 players: longest only; 3+: both bonuses
document.getElementById('playersInput')?.addEventListener('input', function() {
  const playersList = this.value
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const longestWordCheckbox = document.getElementById('longestWordBonus');
  const mostWordsCheckbox = document.getElementById('mostWordsBonus');

  if (playersList.length <= 1) {
    longestWordCheckbox.checked = false;
    mostWordsCheckbox.checked = false;
  } else if (playersList.length === 2) {
    longestWordCheckbox.checked = true;
    mostWordsCheckbox.checked = false;
  } else {
    longestWordCheckbox.checked = true;
    mostWordsCheckbox.checked = true;
  }
  // NEW: reflect changed checkbox state in points inputs immediately
  updateBonusInputs();
});

// Pressing Enter on the players input starts the game
document.getElementById('playersInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!gameStarted) startGame();
  }
});

function updateBonusInputs() {
  document.getElementById('longestWordPoints').disabled = !document.getElementById('longestWordBonus').checked;
  document.getElementById('mostWordsPoints').disabled = !document.getElementById('mostWordsBonus').checked;
}

// Initialize bonus inputs to match toggles
updateBonusInputs();

document.getElementById('longestWordBonus')?.addEventListener('change', updateBonusInputs);
document.getElementById('mostWordsBonus')?.addEventListener('change', updateBonusInputs);

/**
 * Render the previous rounds list and wire tooltip/dictionary handlers.
 */
function updatePreviousRounds() {
  const hasRounds = roundsData.length > 0;
  document.getElementById('runningTotalsHeader')?.classList.toggle('hidden', !hasRounds);
  document.getElementById('previousRoundsHeader')?.classList.toggle('hidden', !hasRounds);
  // NEW: keep containers in sync with header visibility
  document.getElementById('scoreTotals')?.classList.toggle('hidden', !hasRounds);
  document.getElementById('previousRounds')?.classList.toggle('hidden', !hasRounds);
  // NEW: toggle hint visibility with section
  document.getElementById('previousRoundsHint')?.classList.toggle('hidden', !hasRounds);

  const html = roundsData
    .slice()
    .reverse()
    .map((round, revIdx) => {
      const roundIdx = roundsData.length - 1 - revIdx;
      return (window.QuiddlerRender?.renderRound || renderRound)(round, roundIdx, { interactive: true });
    })
    .join('');

  const container = document.getElementById('previousRounds');
  container.innerHTML = html;

  // Delegated click handling for interactive controls
  container.addEventListener('click', function onClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target || !container.contains(target)) return;

    const action = target.getAttribute('data-action');
    if (!action) return;

    if (action === 'toggle-challenge') {
      toggleChallenge(target, e);
      return;
    }

    if (action === 'edit') {
      const player = target.getAttribute('data-player');
      const roundIdx = +target.getAttribute('data-round');
      enterEditMode(player, roundIdx, target);
      return;
    }

    if (action === 'save-edit') {
      const player = target.getAttribute('data-player');
      const roundIdx = +target.getAttribute('data-round');
      saveEdit(player, roundIdx, target);
      return;
    }

    if (action === 'cancel-edit') {
      cancelEdit(target);
      return;
    }

    if (action === 'prefill-play') {
      const player = target.getAttribute('data-player');
      const roundIdx = +target.getAttribute('data-round');
      prefillPlayFor(roundIdx, player, e);
      return;
    }
  });

  container.querySelectorAll('.def-open').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const w = el.getAttribute('data-word') || '';
      if (window.QuiddlerTools?.showDict) await window.QuiddlerTools.showDict(w);
    });
  });

  (window.QuiddlerRender?.initChitTooltips || initChitTooltips)(container);
}

// Expose selected game APIs under a namespace (keep globals intact for existing calls)
// + Provide read-only snapshots for introspection and debugging.
if (typeof window !== 'undefined') {
  const ns = Object.assign({}, window.QuiddlerGame || {}, {
    startGame,
    setupRound,
    validateWordLocal,
    recalculateScores,
    prefillPlayFor,
    enterEditMode,
    cancelEdit,
    saveEdit,
    updateScores,
    toggleChallenge,
    updatePreviousRounds,
    endGame,
    closeEndGameDialog,
    resetToPreGame,
    submitPlayerPlay, // NEW export
    rebuildInputsFromExistingRound, // NEW export
    getWordDefinitionAPI, // NEW: re-export API lookup helper
    skipRound // NEW export
  });

  // Read-only getters for state
  Object.defineProperties(ns, {
    players: {
      get() { return players.slice(); }
    },
    currentRound: {
      get() { return currentRound; }
    },
    roundsData: {
      get() { try { return JSON.parse(JSON.stringify(roundsData)); } catch { return []; } }
    },
    scores: {
      get() { return Object.assign({}, scores); }
    },
    startCards: { get() { return startCards; } },      // NEW
    endCards:   { get() { return maxRound; } },        // NEW
    dictSource: { get() { return dictSource; } },      // NEW
  });

  // NEW: expose a helper to clear only persisted caches (does not mutate in-memory state).
  function clearGameCacheOnly() {
    try { localStorage.removeItem(Q_STORAGE_KEY); } catch {}
    try { localStorage.removeItem(Q_PRE_CONFIG_KEY); } catch {}
  }
  ns.clearGameCacheOnly = clearGameCacheOnly;

  window.QuiddlerGame = ns;
  // Add persistence helpers to namespace
  window.QuiddlerGame.saveGameState = saveGameState;
  window.QuiddlerGame.loadGameState = loadGameState;
  window.QuiddlerGame.DEALER_EMOJI = DEALER_EMOJI; // expose emoji for render helpers
}

// --------------- New UI Flow helpers ---------------
function setElementVisible(el, visible) {
  if (!el) return;
  if (visible) { el.classList.remove('hidden'); el.classList.add('flex'); }
  else { el.classList.add('hidden'); el.classList.remove('flex'); }
}

function resetToPreGame() {
  // Hide game UI and show pre-game inputs
  closeEndGameDialog();

  gameStarted = false;
  gameOver = false;
  lastGameCompletedAllRounds = false;
  players = [];
  scores = {};
  currentRound = 3;
  startCards = 3;      // NEW
  maxRound = 10;       // NEW
  roundsData = [];
  currentDealerIdx = 0;
  currentRoundDraftInputs = {}; // NEW clear drafts

  // Clear dynamic UI
  document.getElementById('scoreTotals').innerHTML = '';
  document.getElementById('previousRounds').innerHTML = '';
  const rh = document.getElementById('roundHeader'); if (rh) rh.innerText = '';
  const si = document.getElementById('scoreInputs'); if (si) si.innerHTML = '';

  // Restore running totals header label for next game
  const runHdr = document.getElementById('runningTotalsHeader');
  if (runHdr) runHdr.textContent = 'Running Totals';

  // Toggle visibility
  document.getElementById('gameArea')?.classList.add('hidden');
  document.getElementById('preGameConfig')?.classList.remove('hidden');
  document.getElementById('endGameBtn')?.classList.add('hidden');
  // NEW hide skip round button
  const skipBtn4 = document.getElementById('skipRoundBtn'); if (skipBtn4) { skipBtn4.classList.add('hidden'); skipBtn4.disabled = true; }

  // Re-enable pre-game inputs
  document.getElementById('playersInput').disabled = false;
  document.getElementById('longestWordBonus').disabled = false;
  document.getElementById('mostWordsBonus').disabled = false;
  document.getElementById('longestWordPoints').disabled = false;
  document.getElementById('mostWordsPoints').disabled = false;
  document.getElementById('startCards').disabled = false;  // NEW
  document.getElementById('endCards').disabled = false;    // NEW
  const apiAlso2 = document.getElementById('dictApiAlso'); if (apiAlso2) apiAlso2.disabled = false; // UPDATED

  // Reset primary CTA label
  const go = document.getElementById('gameGo');
  if (go) go.textContent = 'Start Game';

  // Focus player names input
  const p = document.getElementById('playersInput');
  if (p) { p.focus(); p.select?.(); }

  // Ensure submit is enabled for the next game
  const submitBtn = document.getElementById('submitRoundBtn');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove('hidden'); }

  // Hide section headers
  document.getElementById('runningTotalsHeader')?.classList.add('hidden');
  document.getElementById('previousRoundsHeader')?.classList.add('hidden');
  // NEW: also hide the lists so totals don’t show without a title
  document.getElementById('scoreTotals')?.classList.add('hidden');
  document.getElementById('previousRounds')?.classList.add('hidden');
  // NEW: hide the hint under Previous Rounds
  document.getElementById('previousRoundsHint')?.classList.add('hidden');

  try { localStorage.removeItem(Q_STORAGE_KEY); } catch {}
  // After resetting, re-load saved pre-game config (if any) & reattach listeners
  loadPreGameConfig();
  attachPreGameConfigListeners();
}

// Show end-of-game state inline (no modal) and disable further input
function endGame(completedAllRounds = false) {
  gameOver = true;
  lastGameCompletedAllRounds = !!completedAllRounds;
  const submitBtn = document.getElementById('submitRoundBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add('hidden'); }
  // NEW disable & hide skip button when game ends
  const skipBtn = document.getElementById('skipRoundBtn'); if (skipBtn) { skipBtn.disabled = true; skipBtn.classList.add('hidden'); }

  // Remove and hide current round inputs so Enter can't submit new rounds
  const inputs = document.getElementById('scoreInputs');
  if (inputs) { inputs.innerHTML = ''; inputs.classList.add('hidden'); }
  const header = document.getElementById('roundHeader');
  if (header) header.textContent = 'Game Over 🎉';
  
  // Rename Running Totals header to Final Scores
  const runHdr = document.getElementById('runningTotalsHeader');
  if (runHdr) runHdr.textContent = 'Final Scores';

  // Ensure totals are visible
  document.getElementById('runningTotalsHeader')?.classList.remove('hidden');
  document.getElementById('scoreTotals')?.classList.remove('hidden');

  // (Modal removed — previously summary + new game options displayed here.)
  currentRoundDraftInputs = {}; // NEW clear drafts
  saveGameState();
}

function closeEndGameDialog() {
  const modal = document.getElementById('endGameModal');
  setElementVisible(modal, false);

  // Remove temporary listeners if present
  if (modal && modal.__clickToClose) {
    modal.removeEventListener('click', modal.__clickToClose);
    delete modal.__clickToClose;
  }
  if (modal && modal.__escToClose) {
    document.removeEventListener('keydown', modal.__escToClose);
    delete modal.__escToClose;
  }
  if (modal && modal.__enterNewGame) {
    document.removeEventListener('keydown', modal.__enterNewGame);
    delete modal.__enterNewGame;
  }
  if (modal && modal.__enterArmTime) {
    delete modal.__enterArmTime;
  }
}

// On first load, focus players input if in pre-game state (skip if a game was restored)
(function(){
  // Attempt to load any saved game once DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadGameState);
  } else {
    loadGameState();
  }

  if (!gameStarted) {
    // Load any saved pre-game config (only if no active game restored)
    loadPreGameConfig();
    attachPreGameConfigListeners();
    const p = document.getElementById('playersInput');
    if (p && !p.disabled) { p.focus(); p.select?.(); }
  }

  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+E -> End Game (only if a game is in progress and not already over)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'e' || e.key === 'E')) {
      window.QuiddlerHideShortcuts?.();
      if (gameStarted && !gameOver) {
        e.preventDefault();
        endGame(false);
        return;
      }
    }
    // Ctrl/Cmd+Enter -> New Game setup (fresh settings input screen)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === 'Enter') {
      window.QuiddlerHideShortcuts?.();
      e.preventDefault();
      resetToPreGame();
      return;
    }
    // Ctrl/Cmd+. -> Skip current round (if active)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === '.') {
      if (gameStarted && !gameOver) {
        e.preventDefault();
        skipRound();
        return;
      }
    }
    // Note: Enter alone is handled on the end-game modal to start a new game
  });
})();

// Shortcut modal helpers
(function(){
  function toggleShortcutModal(force) {
    const modal = document.getElementById('shortcutModal');
    if (!modal) return;
    const show = (force === true) || (force == null && modal.classList.contains('hidden'));
    modal.classList.toggle('hidden', !show);
    modal.classList.toggle('flex', show);
  }
  function hideShortcutModal(){
    const modal = document.getElementById('shortcutModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  // Expose globally for footer click and for other shortcuts to auto-hide
  if (typeof window !== 'undefined') {
    window.QuiddlerToggleShortcuts = toggleShortcutModal;
    window.QuiddlerHideShortcuts = hideShortcutModal;
  }

  function globalShortcutHelpHandler(e){
    // Removed Cmd/Ctrl + / handling here to avoid double toggle (now handled in index.html bootstrap script)
    if (e.key === 'Escape') window.QuiddlerHideShortcuts?.();
  }
  document.addEventListener('keydown', globalShortcutHelpHandler);
})();

// Attach draft persistence listeners (helper)
function attachDraftListeners() {
  document.querySelectorAll('.player-words').forEach(inp => {
    inp.addEventListener('input', () => {
      if (gameOver) return;
      const player = inp.dataset.player;
      if (!player) return;
      currentRoundDraftInputs[player] = inp.value;
      saveGameState();
    });
  });
}
// Call after UI creations
// Patch setupRound and rebuildInputsFromExistingRound invocation sites by appending attachDraftListeners
// (Simplest: observe DOM mutations after a tick)
const __observer = new MutationObserver(() => {
  if (document.querySelector('.player-words') && !gameOver) attachDraftListeners();
});
__observer.observe(document.getElementById('scoreInputs') || document.body, { childList:true, subtree:true });

// NEW: Skip current round feature
function skipRound() {
  if (!gameStarted || gameOver) return;
  // Check for existing unfinalized round for currentRound
  let existing = roundsData.find(r => r.roundNum === currentRound && r.finalized === false && !r.skipped);
  if (existing) {
    const anySubmitted = existing.submittedPlayers && Object.keys(existing.submittedPlayers).length > 0;
    if (anySubmitted) {
      if (!confirm('Some players have submitted entries this round. Skipping will discard them. Continue?')) return;
    }
    // Remove existing partial round
    roundsData = roundsData.filter(r => r !== existing);
  }
  const dealerForRound = players[(currentDealerIdx - 1 + players.length) % players.length];
  const skippedRound = {
    roundNum: currentRound,
    dealer: dealerForRound,
    skipped: true,
    finalized: true,
    submittedPlayers: {},
    players: Object.fromEntries(players.map(p => [p, []]))
  };
  roundsData.push(skippedRound);
  updatePreviousRounds();
  recalculateScores();
  saveGameState();
  if (currentRound < maxRound) {
    currentRound += 1;
    setupRound();
    saveGameState();
  } else {
    endGame(true);
  }
}
