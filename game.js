"use strict";

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
let startCards = 3; // NEW: configurable starting hand size
let maxRound = 10; // (was const) now configurable ending hand size
let roundsData = [];
let longestWordBonus = false;
let mostWordsBonus = false;
let longestWordPoints = 0;
let mostWordsPoints = 0;
let currentDealerIdx = 0;
const DEALER_EMOJI = "🦄 "; // Dealer indicator (alternatives: 🦄 🎲 🀄 🃏 🎴 ♣️ ♦️ ♠️ ❤️ 🂠)
const CARD_EMOJI = "\u2060🃏";
let dictSource = "local"; // NEW: 'local' | 'api'
// New UI flow state
let gameOver = false; // when true, no more rounds accepted
let lastGameCompletedAllRounds = false; // track whether the prior game reached the final round
// NEW (Partial round support): rounds may exist before all players submit.
// A round object now also has:
//   finalized: boolean (default true for legacy rounds / when all players submitted)
//   submittedPlayers: { [playerName]: true }
// We create the round on first player submission and keep adding/replacing rows until all submit.
let currentRoundDraftInputs = {}; // NEW: per-player in-progress text for current round

// --- Persistence (localStorage) ---
const Q_STORAGE_KEY = "quiddlerGameStateV2"; // bumped from V1; legacy load removed
// NEW: separate key to persist pre-game (new game page) options even if a game wasn't started yet.
const Q_PRE_CONFIG_KEY = "quiddlerPreGameConfigV1";
let __suppressPreConfigSave = false; // guard to avoid feedback loops while programmatically setting inputs
let __suppressAutoSave = false; // guard to avoid recursive saves during load

function serializeGameState() {
  if (!gameStarted || !players.length) return null;
  const draft =
    !gameOver &&
    currentRoundDraftInputs &&
    Object.keys(currentRoundDraftInputs).length
      ? { roundNum: currentRound, inputs: currentRoundDraftInputs }
      : null;
  return {
    version: 2,
    players: players.slice(),
    roundsData: roundsData.map((r) => ({
      roundNum: r.roundNum,
      dealer: r.dealer || null,
      finalized: r.finalized !== false,
      skipped: !!r.skipped,
      submittedPlayers: Object.keys(r.submittedPlayers || {}),
      players: Object.fromEntries(
        Object.entries(r.players || {}).map(([p, arr]) => [
          p,
          arr.map((w) => ({
            text: w.text,
            score: w.score,
            state: w.state,
            challenger: w.challenger == null ? null : w.challenger,
          })),
        ])
      ),
    })),
    currentRound,
    startCards,
    maxRound,
    currentDealerIdx,
    dictSource,
    longestWordBonus,
    mostWordsBonus,
    longestWordPoints,
    mostWordsPoints,
    gameOver,
    lastGameCompletedAllRounds,
    draftRound: draft,
  };
}

// Persist full in-game state (no-op during auto-load suppression)
function saveGameState() {
  if (__suppressAutoSave) return;
  try {
    const data = serializeGameState();
    if (data) localStorage.setItem(Q_STORAGE_KEY, JSON.stringify(data));
    else localStorage.removeItem(Q_STORAGE_KEY);
  } catch (e) {
    console.warn("Persist save failed", e);
  }
}

// --- Pre-game configuration persistence (separate lightweight snapshot) ---
function savePreGameConfig() {
  if (__suppressPreConfigSave) return;
  try {
    const p = document.getElementById("playersInput");
    const longestB = document.getElementById("longestWordBonus");
    const mostB = document.getElementById("mostWordsBonus");
    const longestPts = document.getElementById("longestWordPoints");
    const mostPts = document.getElementById("mostWordsPoints");
    const sc = document.getElementById("startCards");
    const ec = document.getElementById("endCards");
    const api = document.getElementById("dictApiAlso");
    const snap = {
      v: 1,
      playersRaw: p ? p.value : "",
      longestB: !!longestB?.checked,
      mostB: !!mostB?.checked,
      longestPts: longestPts ? longestPts.value : "",
      mostPts: mostPts ? mostPts.value : "",
      sc: sc ? sc.value : "",
      ec: ec ? ec.value : "",
      dictApiAlso: !!api?.checked,
    };
    localStorage.setItem(Q_PRE_CONFIG_KEY, JSON.stringify(snap));
  } catch (e) {
    /* ignore */
  }
}

function loadPreGameConfig() {
  try {
    const raw = localStorage.getItem(Q_PRE_CONFIG_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return;
    __suppressPreConfigSave = true;
    const p = document.getElementById("playersInput");
    if (p && !p.disabled && data.playersRaw != null) {
      const norm = data.playersRaw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .join(", ");
      p.value = norm;
    }
    const l = document.getElementById("longestWordBonus");
    if (l && !l.disabled) l.checked = !!data.longestB;
    const m = document.getElementById("mostWordsBonus");
    if (m && !m.disabled) m.checked = !!data.mostB;
    const lp = document.getElementById("longestWordPoints");
    if (lp && !lp.disabled && data.longestPts != null)
      lp.value = data.longestPts;
    const mp = document.getElementById("mostWordsPoints");
    if (mp && !mp.disabled && data.mostPts != null) mp.value = data.mostPts;
    const sc = document.getElementById("startCards");
    if (sc && !sc.disabled && data.sc != null) sc.value = data.sc;
    const ec = document.getElementById("endCards");
    if (ec && !ec.disabled && data.ec != null) ec.value = data.ec;
    const api = document.getElementById("dictApiAlso");
    if (api && !api.disabled) api.checked = !!data.dictApiAlso;
    updateBonusInputs();
  } catch (e) {
    /* ignore */
  } finally {
    __suppressPreConfigSave = false;
  }
}

// --- Generic input validation registration for player word inputs ---
// Register validation for player inputs immediately (dynamic attaches future ones)
if (typeof window !== "undefined") {
  const DIGRAPHS_SET =
    typeof DIGRAPHS !== "undefined"
      ? DIGRAPHS
      : window.QuiddlerData && window.QuiddlerData.DIGRAPHS
      ? window.QuiddlerData.DIGRAPHS
      : new Set();
  const validatePlayerWords = (text, ctx) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return { status: "ok" };
    let open = false,
      start = -1,
      nested = false;
    const badPattern = new Set();
    const badDigraphs = new Set();
    const badChars = new Set();
    let interiorHyphen = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === "(") {
        if (open) nested = true;
        open = true;
        start = i;
        continue;
      }
      if (ch === ")") {
        if (!open) return { status: "error", message: "Unmatched parentheses" };
        const token = trimmed.slice(start + 1, i);
        if (!/^[a-zA-Z]+$/.test(token)) badPattern.add(token);
        else {
          if (token.length === 1) badPattern.add(token);
          else if (token.length === 2) {
            if (!DIGRAPHS_SET.has(token.toLowerCase())) badDigraphs.add(token);
          } else badPattern.add(token);
        }
        open = false;
        continue;
      }
      if (!/[a-zA-Z\s\-()]/.test(ch)) badChars.add(ch);
    }
    if (open) return { status: "error", message: "Unmatched parentheses" };
    if (nested) return { status: "error", message: "Nested parentheses" };
    // Invalid digraph pattern is now a blocking error (was warning)
    if (badPattern.size)
      return {
        status: "error",
        message:
          "Invalid digraph pattern: " +
          [...badPattern].map((t) => "(" + t + ")").join(", "),
      };
    if (badDigraphs.size)
      return {
        status: "warning",
        message:
          "Non-existent digraphs: " +
          [...badDigraphs].map((t) => "(" + t + ")").join(", "),
      };
    if (badChars.size)
      return {
        status: "error",
        message: "Invalid characters: " + [...badChars].join(", "),
      };
    // Token-level checks (after structural char scan)
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      if (tok.includes("-")) {
        // Allowed pattern: a single leading '-' (penalty chit) and no other hyphens
        const firstIdx = tok.indexOf("-");
        const secondIdx = tok.indexOf("-", firstIdx + 1);
        const leadingOnly = firstIdx === 0 && secondIdx === -1; // exactly one hyphen at start
        if (!leadingOnly) {
          interiorHyphen = true;
          break;
        }
      }
    }
    if (interiorHyphen)
      return {
        status: "error",
        message: 'Hyphen only allowed as leading "-" penalty chit',
      };
    const warnings = [];
    // New warning: single digraph word used as entire word (non-penalty) e.g. (qu)
    try {
      if (!ctx || !ctx.suppressSingleDigraphWarning) {
        const singleDigraphs = [];
        for (const tok of tokens) {
          if (tok.startsWith("-")) continue; // ignore penalty chits
          if (/^\([a-zA-Z]{2}\)$/.test(tok)) {
            const inner = tok.slice(1, -1).toLowerCase();
            if (DIGRAPHS_SET.has(inner)) singleDigraphs.push(tok);
          }
        }
        if (singleDigraphs.length === 1)
          warnings.push(`Single digraph word: ${singleDigraphs[0]}`);
        else if (singleDigraphs.length > 1)
          warnings.push(`Single digraph words: ${singleDigraphs.join(", ")}`);
      }
    } catch {}
    // Warning: card count mismatch with round size (digraph counts as ONE card)
    try {
      if (
        window.QuiddlerUI &&
        typeof window.QuiddlerUI.tokensForWord === "function"
      ) {
        let totalCards = 0;
        for (const tok of tokens) {
          // Strip leading '-' for card composition; penalty chits still represent actual cards
          const base = tok.replace(/^-/, "");
          const cards = window.QuiddlerUI.parseCards
            ? window.QuiddlerUI.parseCards(base)
            : base.match(/\([a-z]+\)|[a-z]/gi) || [];
          totalCards += cards.length;
        }
        let expected;
        if (ctx) {
          if (ctx.dataset && ctx.dataset.expectedCards) {
            const n = +ctx.dataset.expectedCards;
            if (Number.isFinite(n)) expected = n;
          } else if (Number.isFinite(ctx.expectedCards)) {
            expected = ctx.expectedCards;
          }
        }
        if (
          Number.isFinite(expected) &&
          totalCards &&
          totalCards !== expected
        ) {
          warnings.push(`Uses ${totalCards} cards; round is ${expected}`);
        }
      }
    } catch {}
    if (warnings.length)
      return { status: "warning", message: warnings.join("\n") };
    return { status: "ok" };
  };
  // Export for reuse (row flag tooltips)
  window.QuiddlerValidation = window.QuiddlerValidation || {};
  window.QuiddlerValidation.validatePlayerWords = validatePlayerWords;
  if (window.InputValidation) {
    try {
      window.InputValidation.register({
        selector: ".player-words",
        validate: (value, el) => validatePlayerWords(value, el),
        allowed: /[a-zA-Z\s\-()]/g,
        debounceMs: 700,
        groupId: "players",
        dynamic: true,
        showTooltipOn: "hover",
        autoValidateOnLoad: true,
        onStateChange: (el, prev, next) => {
          el.dataset.wsState = next;
        },
      });
      // Inline edit mode inputs (class .edit-input) use identical validation rules
      window.InputValidation.register({
        selector: ".edit-input",
        validate: (value, el) => validatePlayerWords(value, el),
        allowed: /[a-zA-Z\s\-()]/g,
        debounceMs: 700,
        groupId: "players",
        dynamic: true,
        showTooltipOn: "hover",
        autoValidateOnLoad: false,
        onStateChange: (el, prev, next) => {
          el.dataset.wsState = next;
        },
      });
      window.InputValidation.validateGroup("players");
    } catch {}
  } else {
    // If module loads after, it can choose to register again (module-level dynamic observation covers future nodes)
    document.addEventListener("DOMContentLoaded", () => {
      if (window.InputValidation) {
        try {
          window.InputValidation.register({
            selector: ".player-words",
            validate: (value, el) => validatePlayerWords(value, el),
            allowed: /[a-zA-Z\s\-()]/g,
            debounceMs: 700,
            groupId: "players",
            dynamic: true,
            showTooltipOn: "hover",
            autoValidateOnLoad: true,
            onStateChange: (el, prev, next) => {
              el.dataset.wsState = next;
            },
          });
          window.InputValidation.register({
            selector: ".edit-input",
            validate: (value, el) => validatePlayerWords(value, el),
            allowed: /[a-zA-Z\s\-()]/g,
            debounceMs: 700,
            groupId: "players",
            dynamic: true,
            showTooltipOn: "hover",
            autoValidateOnLoad: false,
            onStateChange: (el, prev, next) => {
              el.dataset.wsState = next;
            },
          });
          window.InputValidation.validateGroup("players");
        } catch {}
      }
    });
  }
}
// --- Pre-game player names validation (migrated to generic input_validation framework) ---
if (typeof window !== "undefined") {
  // Helper: normalize a single player name token (does not validate punctuation sequences)
  function normalizePlayerName(raw) {
    if (!raw) return "";
    let name = raw.replace(/\s+/g, " ").trim(); // collapse spaces
    // Strip leading/trailing hyphen/apostrophe/space
    name = name.replace(/^[\-'\s]+|[\-'\s]+$/g, "");
    if (!name) return "";
    // Lowercase everything then capitalize first letter of each run after start or separator (space, hyphen, apostrophe).
    // This keeps single-letter tokens (e.g., initials) uppercase: "Ted P" -> "Ted P".
    name = name
      .toLowerCase()
      .replace(/(^|[\s\-'])([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
    return name;
  }
  function validatePlayersRaw(value) {
    const raw = value || "";
    if (!raw.trim()) return { status: "ok" }; // pristine / user hasn't typed anything meaningful yet
    const tokens = raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (!tokens.length) return { status: "ok" }; // treat only separators as still pristine
    const accum = {
      invalidPunct: [],
      empty: 0,
      invalidChars: [],
      tooLong: [],
      long: [],
      duplicate: [],
    };
    const seen = new Set();
    for (const tok of tokens) {
      if (/--|''|'-|-'/.test(tok)) {
        accum.invalidPunct.push(tok);
        continue;
      }
      const norm = normalizePlayerName(tok);
      if (!norm) {
        accum.empty++;
        continue;
      }
      if (!/^[A-Za-z][A-Za-z '\-]*$/.test(norm)) {
        accum.invalidChars.push(norm);
        continue;
      }
      if (norm.length > 24) accum.tooLong.push(norm);
      else if (norm.length > 15) accum.long.push(norm);
      const key = norm.toLowerCase();
      if (seen.has(key)) accum.duplicate.push(norm);
      else seen.add(key);
    }
    const errorLines = [];
    if (accum.invalidPunct.length)
      errorLines.push(`Invalid punctuation: ${accum.invalidPunct.join(", ")}`);
    if (accum.empty)
      errorLines.push(
        accum.empty === 1 ? "Empty name" : `Empty name entries: ${accum.empty}`
      );
    if (accum.invalidChars.length)
      errorLines.push(
        `Invalid characters in: ${accum.invalidChars.join(", ")}`
      );
    if (accum.tooLong.length)
      errorLines.push(`Name too long (>24): ${accum.tooLong.join(", ")}`);
    if (accum.duplicate.length)
      errorLines.push(`Duplicate name: ${accum.duplicate.join(", ")}`);
    const warningLines = [];
    if (accum.long.length)
      warningLines.push(`Long name: ${accum.long.join(", ")}`);
    if (errorLines.length)
      return { status: "error", message: errorLines.join("\n") };
    if (warningLines.length)
      return { status: "warning", message: warningLines.join("\n") };
    return { status: "ok" };
  }
  window.QuiddlerValidation = window.QuiddlerValidation || {};
  window.QuiddlerValidation.normalizePlayerName = normalizePlayerName;
  window.QuiddlerValidation.validatePlayerNames = validatePlayersRaw;
  if (window.InputValidation) {
    try {
      window.InputValidation.register({
        selector: "#playersInput",
        validate: validatePlayersRaw,
        allowed: /[A-Za-z,'\- ]/g,
        debounceMs: 500,
        groupId: "pregame",
        dynamic: false,
        showTooltipOn: "hover+focus",
        autoValidateOnLoad: true,
        onStateChange: (el, prev, next) => {
          el.dataset.ivStatePlayers = next;
        },
      });
      // Remove any Tailwind focus ring utility classes accidentally applied that would cause blue halo stacking
      const el = document.getElementById("playersInput");
      if (el) {
        el.classList.forEach((cls) => {
          if (/^focus:/.test(cls) && cls.includes("ring"))
            el.classList.remove(cls);
        });
      }
    } catch (_) {}
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (window.InputValidation) {
        try {
          window.InputValidation.register({
            selector: "#playersInput",
            validate: validatePlayersRaw,
            allowed: /[A-Za-z,'\- ]/g,
            debounceMs: 500,
            groupId: "pregame",
            dynamic: false,
            showTooltipOn: "hover+focus",
            autoValidateOnLoad: true,
            onStateChange: (el, prev, next) => {
              el.dataset.ivStatePlayers = next;
            },
          });
          const el = document.getElementById("playersInput");
          if (el) {
            el.classList.forEach((cls) => {
              if (/^focus:/.test(cls) && cls.includes("ring"))
                el.classList.remove(cls);
            });
          }
        } catch (_) {}
      }
    });
  }
}
// Attach listeners to pre-game inputs to auto-save config while editing (only when not in a game)
function attachPreGameConfigListeners() {
  const ids = [
    "playersInput",
    "longestWordBonus",
    "mostWordsBonus",
    "longestWordPoints",
    "mostWordsPoints",
    "startCards",
    "endCards",
    "dictApiAlso",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt =
      el.tagName === "INPUT" && (el.type === "number" || el.type === "text")
        ? "input"
        : "change";
    el.addEventListener(evt, () => {
      if (!gameStarted) savePreGameConfig();
    });
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
    roundsData = (data.roundsData || []).map((r) => ({
      roundNum: r.roundNum,
      dealer: r.dealer || null,
      finalized: r.finalized !== false, // treat missing as finalized
      skipped: !!r.skipped, // NEW load skipped flag
      submittedPlayers: (r.submittedPlayers || []).reduce((m, p) => {
        m[p] = true;
        return m;
      }, {}),
      players: Object.fromEntries(
        Object.entries(r.players || {}).map(([p, arr]) => [
          p,
          arr.map((w) => ({
            text: w.text,
            score: w.score,
            state: w.state || "neutral",
            challenger: w.challenger == null ? null : w.challenger,
          })),
        ])
      ),
    }));
    // Backfill missing dealer fields if absent
    roundsData.forEach((r, i) => {
      if (!r.dealer && players.length) r.dealer = players[i % players.length];
    });
    currentRound = data.currentRound || 3;
    // NEW: load configurable ranges (fallback to legacy defaults)
    startCards = +data.startCards || 3;
    maxRound = +data.maxRound || 10;
    dictSource = data.dictSource === "api" ? "api" : "local";
    // NEW: restore draft inputs (only if not gameOver later)
    currentRoundDraftInputs =
      data.draftRound && typeof data.draftRound === "object"
        ? data.draftRound.roundNum === data.currentRound
          ? data.draftRound.inputs || {}
          : {}
        : {};
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
    const pInput = document.getElementById("playersInput");
    if (pInput) {
      pInput.value = players.join(", ");
      pInput.disabled = true;
    }
    const lCB = document.getElementById("longestWordBonus");
    const mCB = document.getElementById("mostWordsBonus");
    if (lCB) {
      lCB.checked = longestWordBonus;
      lCB.disabled = true;
    }
    if (mCB) {
      mCB.checked = mostWordsBonus;
      mCB.disabled = true;
    }
    const lPts = document.getElementById("longestWordPoints");
    const mPts = document.getElementById("mostWordsPoints");
    if (lPts) {
      lPts.value = longestWordPoints;
      lPts.disabled = true;
    }
    if (mPts) {
      mPts.value = mostWordsPoints;
      mPts.disabled = true;
    }
    // NEW: reflect start/end card inputs
    const sc = document.getElementById("startCards");
    const ec = document.getElementById("endCards");
    if (sc) {
      sc.value = startCards;
      sc.disabled = true;
    }
    if (ec) {
      ec.value = maxRound;
      ec.disabled = true;
    }
    // NEW: reflect dict source radios -> replaced with single checkbox
    const apiAlso = document.getElementById("dictApiAlso");
    if (apiAlso) {
      apiAlso.checked = dictSource === "api";
      apiAlso.disabled = true;
    }

    document.getElementById("preGameConfig")?.classList.add("hidden");
    document.getElementById("gameArea")?.classList.remove("hidden");
    document.getElementById("currentBonuses")?.classList.remove("hidden");
    // NEW: show skip button on restore (if game not over)
    const skipBtn2 = document.getElementById("skipRoundBtn");
    if (skipBtn2 && !gameOver) {
      skipBtn2.classList.remove("hidden");
      skipBtn2.disabled = false;
    }
    document.getElementById("endGameBtn")?.classList.remove("hidden");

    // Recompute (ensures scores and bonuses re-derived if logic changed)
    recalculateScores();
    updatePreviousRounds();

    if (gameOver) {
      // Re-show game over state & summary
      endGame(lastGameCompletedAllRounds);
    } else {
      // FIX: Dealer index adjustment
      // Previously we always decremented currentDealerIdx assuming we would call setupRound() next.
      // However, if an unfinalized round already exists (we will rebuildInputsFromExistingRound instead
      // of calling setupRound), decrementing caused the dealer pointer to move back one, leading to the
      // same dealer being assigned in two consecutive finalized rounds.
      // Logic now:
      //   If there is NO unfinalized round for currentRound (i.e. we are about to call setupRound again),
      //   then decrement so setupRound chooses the correct dealer and re-increments.
      //   Otherwise (we are resuming an in-progress round), leave currentDealerIdx as-is because it already
      //   points to the next dealer (one ahead of the current dealer for the in-progress round).
      const last = roundsData[roundsData.length - 1];
      const hasUnfinalizedCurrent =
        last && !last.finalized && last.roundNum === currentRound;
      if (!hasUnfinalizedCurrent && players.length) {
        currentDealerIdx =
          (currentDealerIdx - 1 + players.length) % players.length;
      }
      // If the current (last) round is unfinalized, rebuild inputs from it; else create fresh inputs
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
        Object.entries(roundDraft).forEach(([p, val]) => {
          const inp = document.querySelector(
            `.player-words[data-player="${p}"]`
          );
          if (
            inp &&
            !roundsData.find(
              (r) => r.roundNum === currentRound && r.finalized === false
            )?.submittedPlayers[p]
          ) {
            if (!inp.value || inp.value.trim() === "") inp.value = val;
          }
        });
      } catch {}
    }
    // Ensure headers visibility on restored game
    const hasRounds = roundsData.length > 0;
    // Running totals now always visible once a game is loaded
    const runHdr2 = document.getElementById("runningTotalsHeader");
    if (runHdr2) runHdr2.classList.remove("hidden");
    const scoreTotals2 = document.getElementById("scoreTotals");
    if (scoreTotals2) scoreTotals2.classList.remove("hidden");
    // Previous rounds related elements still conditional
    document
      .getElementById("previousRoundsHeader")
      ?.classList.toggle("hidden", !hasRounds);
    document
      .getElementById("previousRounds")
      ?.classList.toggle("hidden", !hasRounds);
    document
      .getElementById("previousRoundsHint")
      ?.classList.toggle("hidden", !hasRounds);
  } catch (e) {
    console.warn("Persist load failed", e);
  } finally {
    __suppressAutoSave = false;
    // Save immediately to normalize schema if needed
    // Remove anti-flash attribute once restore attempt finishes (success or fail)
    try {
      document.documentElement.removeAttribute("data-q-restoring");
    } catch (_) {}
    saveGameState();
    updateSkipVisibility(); // NEW ensure correct visibility after load
  }
}

// Local dictionary validation (re-added)
function validateWordLocal(raw) {
  if (!raw) return false;
  const txt = String(raw).trim();
  if (!txt || txt.startsWith("-")) return false; // unused/penalty chits never validated
  // Strip parentheses (keep inner letters), punctuation, and digits; normalize to upper
  const plain = txt
    .replace(/\([^)]*\)/g, (m) => m.replace(/[()]/g, "")) // remove parens but keep letters inside
    .replace(/[()]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  if (!plain) return false;
  try {
    return !!(typeof validWordsMap !== "undefined" && validWordsMap[plain]);
  } catch {
    return false;
  }
}

/**
 * Initialize a new game from the UI controls and render round 1.
 */
function startGame() {
  if (gameStarted) return; // prevent duplicate init
  // Ensure player names validation passes (hard check) before proceeding
  try {
    if (window.InputValidation) {
      window.InputValidation.validateGroup("pregame");
      if (window.InputValidation.anyBlockingInvalid("pregame")) {
        const el = document.getElementById("playersInput");
        if (el) {
          el.focus();
          el.select?.();
        }
        return; // block start due to invalid player names
      }
    }
  } catch (_) {}
  // Parse and clean players list
  const rawPlayers = document.getElementById("playersInput").value;
  players = rawPlayers
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) =>
      window.QuiddlerValidation?.normalizePlayerName
        ? window.QuiddlerValidation.normalizePlayerName(p)
        : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
    )
    .filter((p, idx, arr) => p && arr.indexOf(p) === idx);

  // Normalize players input display to include a space after commas
  const pInputNorm = document.getElementById("playersInput");
  if (pInputNorm) pInputNorm.value = players.join(", ");

  if (!players.length) {
    alert("Please enter at least one player");
    return;
  }
  // Secondary duplicate check (defensive)
  const dup = players.find((p, i) => players.indexOf(p) !== i);
  if (dup) {
    alert("Duplicate player name: " + dup);
    return;
  }

  // Read configurable card range first (validate before committing to game start)
  const rawStart = +(document.getElementById("startCards")?.value || 3);
  const rawEnd = +(document.getElementById("endCards")?.value || 10);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
    alert("Please enter numeric values for start/end cards.");
    return;
  }
  if (rawStart < 3) {
    alert("Starting number of cards must be at least 3.");
    return;
  }
  if (rawStart > rawEnd) {
    alert(
      "Starting number of cards cannot be greater than ending number of cards."
    );
    return;
  }
  startCards = rawStart;
  maxRound = rawEnd;
  dictSource = document.getElementById("dictApiAlso")?.checked
    ? "api"
    : "local";

  // Reset all global variables to initial state (after validation)
  gameStarted = true;
  gameOver = false;
  scores = {};
  currentRound = startCards;
  roundsData = [];
  currentDealerIdx = 0;
  longestWordBonus = document.getElementById("longestWordBonus").checked;
  mostWordsBonus = document.getElementById("mostWordsBonus").checked;
  longestWordPoints = +document.getElementById("longestWordPoints").value;
  mostWordsPoints = +document.getElementById("mostWordsPoints").value;

  // Initialize player scores
  players.forEach((player) => (scores[player] = 0));

  // Disable inputs after initial setup and hide pre-game block
  document.getElementById("playersInput").disabled = true;
  document.getElementById("longestWordBonus").disabled = true;
  document.getElementById("mostWordsBonus").disabled = true;
  document.getElementById("longestWordPoints").disabled = true;
  document.getElementById("mostWordsPoints").disabled = true;
  document.getElementById("startCards").disabled = true; // NEW
  document.getElementById("endCards").disabled = true; // NEW
  const apiAlso = document.getElementById("dictApiAlso");
  if (apiAlso) apiAlso.disabled = true; // UPDATED
  document.getElementById("preGameConfig")?.classList.add("hidden");

  // Clear previous game state from UI
  // (Preserve scoreboard sizing container so width constraints persist)
  const scoreTotalsWrapper = document.getElementById("scoreTotals");
  if (scoreTotalsWrapper) {
    const inner = scoreTotalsWrapper.querySelector(
      '[aria-label="Player running totals"]'
    );
    if (inner) inner.innerHTML = "";
    else {
      scoreTotalsWrapper.innerHTML =
        '<div class="inline-block w-full max-w-[20rem] sm:max-w-[21rem] rounded-lg bg-white/90 backdrop-blur-sm px-0 py-4" aria-label="Player running totals"></div>';
    }
  }
  document.getElementById("previousRounds").innerHTML = "";

  // Make game area visible and start first round
  document.getElementById("gameArea").classList.remove("hidden");
  document.getElementById("currentBonuses")?.classList.remove("hidden");
  // NEW: ensure skip round button visible
  const skipBtn = document.getElementById("skipRoundBtn");
  if (skipBtn) {
    skipBtn.classList.remove("hidden");
    skipBtn.disabled = false;
  }

  // Toolbar visibility
  document.getElementById("endGameBtn")?.classList.remove("hidden");

  // Ensure submit button is enabled for a fresh game
  const submitBtn = document.getElementById("submitRoundBtn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add("hidden");
  } // HIDE global submit in partial mode

  // Make sure round inputs are visible when starting anew
  document.getElementById("scoreInputs")?.classList.remove("hidden");

  // Running Totals now always shown (initialize with zero scores)
  const runHdr = document.getElementById("runningTotalsHeader");
  if (runHdr) runHdr.classList.remove("hidden");
  const scoreTotalsEl = document.getElementById("scoreTotals");
  if (scoreTotalsEl) scoreTotalsEl.classList.remove("hidden");
  // Hide only previous round related UI until first round finalized
  document.getElementById("previousRoundsHeader")?.classList.add("hidden");
  document.getElementById("previousRounds")?.classList.add("hidden");
  document.getElementById("previousRoundsHint")?.classList.add("hidden");
  // Populate initial zero scoreboard
  updateScores();
  setupRound();
  saveGameState();
  // On starting a game, remove the pre-game config snapshot (we will rely on real game state now)
  try {
    localStorage.removeItem(Q_PRE_CONFIG_KEY);
  } catch {}
}

/**
 * Populate the score input fields for the current round and advance dealer.
 */
function setupRound() {
  const dealer = players[currentDealerIdx % players.length];
  document.getElementById(
    "roundHeader"
  ).innerHTML = `Current Round <span class="text-gray-500 text-base font-large ml-3 whitespace-nowrap">(${currentRound}${CARD_EMOJI})</span>`;
  // Show the global submit button for the round
  const submitBtn = document.getElementById("submitRoundBtn");
  if (submitBtn) {
    submitBtn.classList.remove("hidden");
    submitBtn.disabled = false;
    submitBtn.onclick = () => {
      if (!gameOver) submitPlayerPlay();
    };
  }

  // UPDATED LAYOUT: grid with auto-sized first column (max-content), shared alignment
  document.getElementById("scoreInputs").innerHTML = `
    <div class="text-sm text-gray-500 mb-2">Enter words separated by spaces (parentheses for digraphs, '-' prefix for unused). Round auto-advances after all players submit a play.</div>
    <div class="player-input-grid grid grid-cols-[max-content_1fr] gap-x-2 gap-y-2 items-center">
      ${players
        .map(
          (player, i) => `
        <div class="player-input-row contents">
          <label for="player-words-${i}" class="player-label shrink-0 whitespace-nowrap overflow-hidden text-ellipsis flex items-center rounded-md border border-gray-200/70 bg-white/60 backdrop-blur-sm px-2 py-1 text-gray-800 font-normal shadow-sm ring-1 ring-black/0 hover:bg-white/80 transition-colors">${player}${
            player === dealer
              ? `<span class="dealer-indicator ml-1" aria-label="${player} deals round ${currentRound}" data-tippy-content="${player} deals round ${currentRound}">${DEALER_EMOJI}</span>`
              : ""
          }</label>
          <input id="player-words-${i}" class="player-words flex-1 min-w-0 w-full p-2 border rounded text-left outline-none" data-player="${player}" data-expected-cards="${currentRound}" placeholder="e.g., (qu)ick(er) bad -e(th)">
        </div>`
        )
        .join("")}
    </div>`;
  document.getElementById("scoreInputs")?.classList.remove("hidden");
  // Initialize tippy for dealer indicator (current round)
  if (window.tippy) {
    document
      .querySelectorAll("#scoreInputs .dealer-indicator")
      .forEach((el) => {
        el.removeAttribute("title");
        const cfg = {
          delay: [500, 0],
          animation: "none",
          placement: "bottom",
          theme: "plain",
          arrow: false,
          offset: [0, 6],
        };
        if (!el._tippy) tippy(el, cfg);
        else el._tippy.setProps(cfg);
      });
  }
  document.querySelectorAll(".player-words").forEach((inp) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!gameOver) submitPlayerPlay();
      } else if (e.key === "Tab") {
        e.preventDefault();
        const inputs = Array.from(document.querySelectorAll(".player-words"));
        const idx = inputs.indexOf(inp);
        if (idx !== -1) {
          let nextIdx = e.shiftKey ? idx - 1 : idx + 1;
          if (nextIdx < 0) nextIdx = inputs.length - 1;
          if (nextIdx >= inputs.length) nextIdx = 0;
          const next = inputs[nextIdx];
          if (next) {
            next.focus();
            next.select?.();
          }
        }
      }
    });
  });
  // Attach validation to newly created inputs
  // validation already globally registered (dynamic)
  document.querySelectorAll(".submit-player-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!gameOver) submitPlayerPlay();
    });
  });
  const firstInput = document.querySelector(".player-words");
  if (firstInput) {
    firstInput.focus();
    firstInput.select?.();
  }
  currentDealerIdx++;
  currentRoundDraftInputs = {}; // NEW reset draft for new round
  updateSkipVisibility(); // NEW
}

// NEW: Rebuild current round input UI from an existing unfinalized round (on reload)
function rebuildInputsFromExistingRound(round) {
  if (!round) return;
  const dealer = round.dealer;
  document.getElementById(
    "roundHeader"
  ).innerHTML = `Current Round <span class=\"text-gray-500 text-base font-medium ml-1\">(${round.roundNum}${CARD_EMOJI})</span>`;
  // Show the global submit button for the round
  const submitBtn = document.getElementById("submitRoundBtn");
  if (submitBtn) {
    submitBtn.classList.remove("hidden");
    submitBtn.disabled = false;
    submitBtn.onclick = () => {
      if (!gameOver) submitPlayerPlay();
    };
  }
  // UPDATED LAYOUT (same grid approach as setupRound)
  document.getElementById("scoreInputs").innerHTML = `
    <div class="text-sm text-gray-500 mb-2">Round in progress. Edit & resubmit a single player as needed; challenges reset for that player's changed words. Enter submits just that player.</div>
    <div class="player-input-grid grid grid-cols-[max-content_1fr] gap-x-2 gap-y-2 items-center">
      ${players
        .map((player, i) => {
          const existing = (round.players[player] || [])
            .map((w) => w.text)
            .join(" ");
          return `
        <div class=\"player-input-row contents\">
          <label for=\"player-words-${i}\" class=\"player-label shrink-0 whitespace-nowrap overflow-hidden text-ellipsis flex items-center rounded-md border border-gray-200/70 bg-white/60 backdrop-blur-sm px-2 py-1 text-gray-800 font-normal shadow-sm ring-1 ring-black/0 hover:bg-white/80 transition-colors\">${player}${
            player === dealer
              ? `<span class=\"dealer-indicator ml-1.5\" aria-label=\"${player} deals round ${currentRound}\" data-tippy-content=\"${player} deals round ${currentRound}\">${DEALER_EMOJI}</span>`
              : ""
          }</label>
          <input id=\"player-words-${i}\" class=\"player-words flex-1 min-w-0 w-full p-2 border rounded text-left outline-none\" data-player=\"${player}\" data-expected-cards=\"${
            round.roundNum
          }\" value=\"${existing.replace(
            /"/g,
            "&quot;"
          )}\" placeholder=\"e.g., (qu)ick(er) bad -e(th)\"> 
        </div>`;
        })
        .join("")}
    </div>`;
  document.getElementById("scoreInputs")?.classList.remove("hidden");
  if (window.tippy) {
    document
      .querySelectorAll("#scoreInputs .dealer-indicator")
      .forEach((el) => {
        el.removeAttribute("title");
        const cfg = {
          delay: [500, 0],
          animation: "none",
          placement: "bottom",
          theme: "plain",
          arrow: false,
          offset: [0, 6],
        };
        if (!el._tippy) tippy(el, cfg);
        else el._tippy.setProps(cfg);
      });
  }
  document.querySelectorAll(".player-words").forEach((inp) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!gameOver) submitPlayerPlay();
      } else if (e.key === "Tab") {
        e.preventDefault();
        const inputs = Array.from(document.querySelectorAll(".player-words"));
        const idx = inputs.indexOf(inp);
        if (idx !== -1) {
          let nextIdx = e.shiftKey ? idx - 1 : idx + 1;
          if (nextIdx < 0) nextIdx = inputs.length - 1;
          if (nextIdx >= inputs.length) nextIdx = 0;
          const next = inputs[nextIdx];
          if (next) {
            next.focus();
            next.select?.();
          }
        }
      }
    });
  });
  // Attach validation after rebuilding inputs
  // validation already globally registered (dynamic)
  // No per-player submit buttons anymore
  currentRoundDraftInputs = Object.assign({}, currentRoundDraftInputs); // ensure object
  setTimeout(() => {
    Object.entries(currentRoundDraftInputs).forEach(([p, val]) => {
      const r = roundsData.find(
        (r) => r.roundNum === round.roundNum && r.finalized === false
      );
      if (r && !r.submittedPlayers[p]) {
        const inp = document.querySelector(`.player-words[data-player="${p}"]`);
        if (inp && inp.value.trim() === "") inp.value = val;
      }
    });
  }, 0);
  updateSkipVisibility(); // NEW
}

// PARTIAL ROUND: per-player submission
function submitPlayerPlay() {
  // UPDATED: Now submits ALL players' current inputs (playerName ignored).
  if (gameOver) return;
  // Run a hard validation pass; ignore blocking errors for submission purposes
  try {
    if (window.InputValidation) window.InputValidation.validateGroup("players");
  } catch {}
  // Find or create unfinalized round for currentRound
  let round = roundsData.find(
    (r) => r.roundNum === currentRound && r.finalized === false
  );
  if (!round) {
    const roundDealer =
      players[(currentDealerIdx - 1 + players.length) % players.length];
    round = {
      roundNum: currentRound,
      dealer: roundDealer,
      finalized: false,
      skipped: false,
      submittedPlayers: {},
      players: Object.fromEntries(players.map((p) => [p, []])),
    };
    roundsData.push(round);
  }

  // For each player, parse their current input into word objects unless it has a blocking error
  const errorInputs = [];
  document.querySelectorAll(".player-words").forEach((inp) => {
    const p = inp.dataset.player;
    if (!p) return;
    const raw = inp.value.trim();
    const state = inp.dataset.ivState; // 'error' | 'warning' | 'valid' | 'dirty' | etc.
    if (state === "error") {
      errorInputs.push(inp);
      return;
    }
    if (!raw) {
      // Blank (non-error) input: treat as NOT submitted. Clear any prior submission.
      round.players[p] = [];
      if (round.submittedPlayers) delete round.submittedPlayers[p];
      if (currentRoundDraftInputs) delete currentRoundDraftInputs[p];
      return;
    }
    const consolidated = consolidatePenaltyChits(raw);
    const words = consolidated
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => ({
        text: t,
        score: typeof scoreForChit === "function" ? scoreForChit(t) : 0,
        state: t.startsWith("-") ? "invalid" : "neutral",
        challenger: null,
      }));
    round.players[p] = words;
    if (words.length) round.submittedPlayers[p] = true;
    else delete round.submittedPlayers[p];
    if (currentRoundDraftInputs) delete currentRoundDraftInputs[p];
  });

  // If there are blocking errors, focus the first one (but still accept other valid submissions)
  if (errorInputs.length) {
    try {
      errorInputs[0].focus();
      errorInputs[0].select?.();
    } catch {}
  }

  recalculateScores();
  updatePreviousRounds();
  saveGameState();

  // Auto-finalize only if EVERY player has a non-blank submission
  const allSubmitted = players.every((p) => round.submittedPlayers[p]);
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
    return;
  }

  // Focus first unsubmitted player's input
  const inputs = Array.from(document.querySelectorAll(".player-words"));
  for (const inp of inputs) {
    const p = inp.dataset.player;
    if (!round.submittedPlayers[p]) {
      inp.focus();
      inp.select?.();
      break;
    }
  }
}

// Validation now handled by generic module via attachPlayValidation defined earlier.

// ---------- Helpers ----------
// A word counts toward base if it's not invalid OR it's invalid with no challenger (definition-only / unchallenged).
function eligibleForBase(word) {
  return (
    word.state !== "invalid" ||
    (word.state === "invalid" && word.challenger == null)
  );
}
// A word counts toward bonuses if it is NOT a '-' chit and passes base eligibility.
function eligibleForBonus(word) {
  return !word.text.startsWith("-") && eligibleForBase(word);
}
// Signed value for a single word (handles '-' penalty).
function wordBaseValue(word) {
  const sign = word.text.startsWith("-") ? -1 : 1;
  return sign * word.score;
}
// Base points for a player's row.
function baseScoreForPlayer(pdata) {
  return pdata.reduce(
    (sum, w) => sum + (eligibleForBase(w) ? wordBaseValue(w) : 0),
    0
  );
}
// Words eligible for bonuses.
function bonusEligibleWords(pdata) {
  return pdata.filter(eligibleForBonus);
}
// Longest word length (letters only).
function longestWordLen(pdata) {
  return bonusEligibleWords(pdata).reduce(
    (max, w) => Math.max(max, plainLength(w.text)),
    0
  );
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
  pdata.forEach((word) => {
    if (word.state === "valid" && word.challenger) {
      round.players[word.challenger].challengeDeductions += word.score;
    } else if (word.state === "invalid" && word.challenger) {
      pdata.challengeDeductions += word.score;
    }
  });
}

// ---------- Main ----------
/**
 * Recompute every player's score across all rounds, including bonuses and challenges.
 */
function recalculateScores() {
  players.forEach((player) => {
    scores[player] = 0;
  });

  roundsData.forEach((round) => {
    if (!round || typeof round !== "object") return;
    if (!round.players) round.players = {};

    // Ensure a row exists for every current player, then reset per-round fields
    players.forEach((player) => {
      if (!Array.isArray(round.players[player])) round.players[player] = [];
      resetRoundPlayerState(round.players[player]);
    });

    let longestLength = 0;
    let mostWordsCount = 0;
    let longestPlayers = [];
    let mostWordsPlayers = [];

    players.forEach((player) => {
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

    players.forEach((player) =>
      applyChallengeDeductionsForPlayer(round, player)
    );

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

    players.forEach((player) => {
      const pdata = round.players[player];
      pdata.roundScore =
        Math.max(0, pdata.baseScore - pdata.challengeDeductions) + pdata.bonus;
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
  const tiles = pdata.map((w) => w.text).join(" ");

  let oppMaxLongest = 0;
  let oppMaxMost = 0;
  players.forEach((p) => {
    if (p === playerName) return;
    const opData = round.players[p] || [];
    oppMaxLongest = Math.max(oppMaxLongest, longestWordLen(opData));
    oppMaxMost = Math.max(oppMaxMost, wordsCount(opData));
  });

  window.QuiddlerTools?.prefillPlay?.({
    tiles,
    currentLongest: oppMaxLongest,
    currentMost: oppMaxMost,
  });
}

/**
 * Switch a player's row to edit mode (inline editing of chits as text).
 */
function enterEditMode(player, roundIdx, btn) {
  // NEW: enforce single edit mode
  const row = btn.closest(".group");
  if (!row) return;
  // Close any other open edit rows first
  closeAllEditModes(row);
  const cell =
    row.querySelector(".row-chits-cell") ||
    row.querySelector(".flex-1.min-w-0");
  if (!cell) return;

  const chits = cell.querySelector(".chit-container");
  const edit = cell.querySelector(".edit-container");
  if (!edit) return;

  // Swap controls to Save/Cancel
  const controls = row.querySelector(".controls-cell");
  if (controls) {
    const viewC = controls.querySelector(".controls-view-mode");
    const editC = controls.querySelector(".controls-edit-mode");
    viewC?.classList.add("hidden");
    editC?.classList.remove("hidden");
  }

  chits?.classList.add("hidden");
  edit.classList.remove("hidden");

  // HIDE validation flag while editing
  row.querySelector(".row-val-flag")?.classList.add("hidden");

  const input = edit.querySelector(".edit-input");
  if (input) {
    // Reconstruct original raw row text from current data model (penalties last to match display ordering)
    try {
      const r = roundsData[roundIdx];
      if (r && r.players && Array.isArray(r.players[player])) {
        const arr = r.players[player];
        const penalties = arr.filter((w) => w.text.startsWith("-"));
        const nonPen = arr.filter((w) => !w.text.startsWith("-"));
        const raw = [...nonPen, ...penalties].map((w) => w.text).join(" ");
        input.dataset.originalValue = raw; // stash for cancel
        input.value = raw; // always reset on entering edit mode (discard prior unsaved draft)
      }
    } catch (_) {}
    // Focus & place caret at end
    try {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    } catch (_) {}
    // Immediate validation so warnings/errors show while editing
    try {
      window.InputValidation?.validateElement?.(input);
    } catch (_) {}

    function keyHandler(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        const ok = saveEdit(player, roundIdx, btn);
        if (ok) input.removeEventListener("keydown", keyHandler); // detach only if save succeeded
      } else if (e.key === "Escape") {
        // Escape cancels regardless of validation state
        e.preventDefault();
        e.stopPropagation();
        const cancelBtn = row.querySelector(
          '[data-action="cancel-edit"][data-player="' +
            player +
            '"][data-round="' +
            roundIdx +
            '"]'
        );
        if (cancelBtn) {
          cancelEdit(cancelBtn);
        } else {
          // Fallback if cancel button not found
          chits?.classList.remove("hidden");
          edit.classList.add("hidden");
          const viewC = row.querySelector(".controls-view-mode");
          const editC = row.querySelector(".controls-edit-mode");
          editC?.classList.add("hidden");
          viewC?.classList.remove("hidden");
          row.querySelector(".row-val-flag")?.classList.remove("hidden");
        }
        input.removeEventListener("keydown", keyHandler);
      }
    }
    input.addEventListener("keydown", keyHandler);
  }
}

// NEW: helper to close all other edit modes (used for single edit mode enforcement)
function closeAllEditModes(exceptRow) {
  document
    .querySelectorAll(".group .edit-container:not(.hidden)")
    .forEach((editContainer) => {
      const row = editContainer.closest(".group");
      if (exceptRow && row === exceptRow) return; // leave target row alone
      const cancelBtn = row?.querySelector('[data-action="cancel-edit"]');
      if (cancelBtn) {
        cancelEdit(cancelBtn);
      } else {
        // fallback: manually revert UI
        editContainer.classList.add("hidden");
        row?.querySelector(".chit-container")?.classList.remove("hidden");
        const controls = row?.querySelector(".controls-cell");
        if (controls) {
          controls
            .querySelector(".controls-edit-mode")
            ?.classList.add("hidden");
          controls
            .querySelector(".controls-view-mode")
            ?.classList.remove("hidden");
        }
      }
    });
}

function cancelEdit(btn) {
  const row = btn.closest(".group");
  const cell =
    row.querySelector(".row-chits-cell") ||
    row.querySelector(".flex-1.min-w-0");
  if (!cell) return;

  cell.querySelector(".edit-container")?.classList.add("hidden");
  cell.querySelector(".chit-container")?.classList.remove("hidden");

  // Restore controls to Edit/Gear
  const controls = row.querySelector(".controls-cell");
  if (controls) {
    const viewC = controls.querySelector(".controls-view-mode");
    const editC = controls.querySelector(".controls-edit-mode");
    editC?.classList.add("hidden");
    viewC?.classList.remove("hidden");
  }
  // RESTORE validation flag visibility
  row.querySelector(".row-val-flag")?.classList.remove("hidden");
  // Reset edit input value back to original (discard any un-saved draft)
  try {
    const input = row.querySelector(".edit-input");
    if (input && input.dataset.originalValue != null)
      input.value = input.dataset.originalValue;
  } catch (_) {}
}

/**
 * Save edits to a player's row, then re-render and recalc totals.
 */
function saveEdit(player, roundIdx, btn) {
  const row = btn.closest(".group");
  const cell =
    row.querySelector(".row-chits-cell") ||
    row.querySelector(".flex-1.min-w-0");
  if (!cell) return false;

  const input = cell.querySelector(".edit-input");
  // Immediate synchronous revalidation (bypass debounce) so rapid Enter / click sees up-to-date state
  try {
    if (input && window.QuiddlerValidation?.validatePlayerWords) {
      const res = window.QuiddlerValidation.validatePlayerWords(
        input.value,
        input
      );
      if (res) {
        // Mirror InputValidation's dataset convention ("valid" vs ok)
        if (input.dataset) {
          input.dataset.wsState = res.status === "ok" ? "valid" : res.status;
          if (res.message) input.dataset.wsMessage = res.message;
          else delete input.dataset.wsMessage;
        }
      }
    }
  } catch (_) {}
  // Run hard validation and block save if input currently has a blocking error state.
  try {
    window.InputValidation?.validateElement?.(input);
  } catch (_) {}
  if (input && input.dataset && input.dataset.wsState === "error") {
    try {
      input.focus();
      input.select?.();
    } catch (_) {}
    return false; // do not persist invalid edit
  }
  const consolidatedRaw = consolidatePenaltyChits((input?.value || "").trim());
  const newWords = consolidatedRaw.split(/\s+/).filter(Boolean);

  roundsData[roundIdx].players[player] = newWords.map((word) => ({
    text: word,
    score: scoreForChit(word),
    state: word.startsWith("-") ? "invalid" : "neutral",
    challenger: null,
  }));

  // If this edit pertains to the current (unfinalized) round, mirror it into the live round input box
  try {
    const editedRound = roundsData[roundIdx];
    if (
      editedRound &&
      editedRound.finalized === false &&
      editedRound.roundNum === currentRound
    ) {
      const liveInput = document.querySelector(
        `.player-words[data-player="${player}"]`
      );
      if (liveInput) {
        liveInput.value = consolidatedRaw;
        // Immediate validation so its state/tooltips update without waiting for debounce
        try {
          window.InputValidation?.validateElement?.(liveInput);
        } catch (_) {}
      }
    }
  } catch (_) {}

  // If editing an unfinalized round, mark that player as submitted (re)submitted
  const r = roundsData[roundIdx];
  if (r && r.finalized === false) {
    r.submittedPlayers = r.submittedPlayers || {};
    r.submittedPlayers[player] = true;
  }

  recalculateScores();
  updatePreviousRounds();

  // After re-render, the edited row is no longer in edit mode; flag will reappear via fresh render if still applicable
  return true;
}

/**
 * Update the leaderboard list from the current totals.
 */
function updateScores() {
  const wrapper = document.getElementById("scoreTotals");
  if (!wrapper) return;
  let box = wrapper.querySelector('[aria-label="Player running totals"]');
  if (!box) {
    box = document.createElement("div");
    box.setAttribute("aria-label", "Player running totals");
    box.className =
      "inline-block w-full max-w-[20rem] sm:max-w-[21rem] rounded-lg bg-white/90 backdrop-blur-sm px-0 py-4";
    wrapper.appendChild(box);
  } else {
    // Ensure required classes exist (handles case where container was rebuilt without them)
    const needed = [
      "inline-block",
      "w-full",
      "max-w-[20rem]",
      "sm:max-w-[21rem]",
      "rounded-lg",
      "bg-white/90",
      "backdrop-blur-sm",
      "px-0",
      "py-4",
    ];
    needed.forEach((c) => {
      if (!box.classList.contains(c)) box.classList.add(c);
    });
    // Remove any old horizontal padding variants (px-5 etc)
    if (box.classList.contains("px-5")) box.classList.remove("px-5");
  }
  box.classList.add("space-y-2");

  const rows = players
    .map((player) => ({ player, score: scores[player] }))
    .sort((a, b) => b.score - a.score);
  const topScore = rows.length ? rows[0].score : 0;

  // Header row (no Rank column now)
  const headerRow = `<div class=\"flex items-center justify-between px-3 pb-1 text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200/70\">
      <span>Player</span>
      <span>Score</span>
    </div>`;

  const body =
    rows
      .map(({ player, score }) => {
        const leader = score === topScore && topScore !== 0;
        const decoratedName = leader && gameOver ? `${player} 🎉` : player;
        return `<div class=\"flex items-center justify-between px-3 py-2 text-[16px] leading-tight rounded-lg ${
          leader
            ? "bg-blue-50 font-semibold text-blue-700"
            : "bg-white/70 hover:bg-white"
        } transition\">\n              <span class=\"truncate leading-none ${
          leader ? "font-semibold" : "font-medium"
        }\">${decoratedName}</span>\n              <span class=\"tabular-nums ${
          leader ? "text-blue-700 font-semibold" : "text-gray-900 font-semibold"
        } leading-none text-[16px]\">${score}</span>\n            </div>`;
      })
      .join("") ||
    '<div class="px-2 py-2 text-sm text-gray-500">No scores yet</div>';
  box.innerHTML = headerRow + body;
}

/**
 * Toggle a word's challenge state and assign a challenger via a dropdown.
 * Flow:
 * - Click cycles from neutral → choose challenger → valid/invalid based on dictionary → neutral.
 * - 'GOD' selection marks a challenged resolution without attributing deductions to another player.
 */
function toggleChallenge(btn, e) {
  e.stopPropagation();

  document
    .querySelectorAll(".challenger-dropdown")
    .forEach((el) => el.remove());

  const roundIdx = btn.dataset.round;
  const player = btn.dataset.player;
  const wordIdx = btn.dataset.word;
  const wordObj = roundsData[roundIdx].players[player][wordIdx];

  if (wordObj.text.startsWith("-")) return;

  if (wordObj.state === "valid" || wordObj.state === "invalid") {
    wordObj.state = "neutral";
    wordObj.challenger = null;
    recalculateScores();
    updatePreviousRounds();
    return;
  }

  const challengerDropdown = document.createElement("select");
  challengerDropdown.className = "ml-2 p-1 border rounded challenger-dropdown";
  challengerDropdown.innerHTML =
    `<option value="">Select Challenger</option><option value="null">GOD</option>` +
    players
      .filter((p) => p !== player)
      .map((p) => `<option>${p}</option>`)
      .join("");

  challengerDropdown.onchange = async function () {
    if (this.value === "") {
      this.remove();
      return;
    }
    if (this.value !== "null") wordObj.challenger = this.value;
    // UPDATED: Gate API validation behind local dictionary presence.
    if (dictSource === "api") {
      const locallyValid = validateWordLocal(wordObj.text);
      if (!locallyValid) {
        // Immediately mark invalid; do not hit API for non-local words.
        wordObj.state = "invalid";
        recalculateScores();
        updatePreviousRounds();
        this.remove();
        return;
      }
      wordObj.state = "checking";
      updatePreviousRounds();
      try {
        const plain = wordObj.text
          .replace(/\([^)]*\)/g, (m) => m.replace(/[()]/g, ""))
          .replace(/[()]/g, "")
          .replace(/[^A-Za-z]/g, "")
          .toLowerCase();
        if (!plain) {
          wordObj.state = "invalid";
        } else {
          const { found, error } = await getWordDefinitionAPI(plain);
          if (error) {
            // On API error, fall back to local validity (already true here).
            wordObj.state = "valid";
          } else {
            wordObj.state = found ? "valid" : "invalid";
          }
        }
      } catch {
        // On unexpected failure, default to locally valid (conservative) result.
        wordObj.state = "valid";
      }
      recalculateScores();
      updatePreviousRounds();
      this.remove();
      return;
    }
    // Local path (sync)
    wordObj.state = validateWordLocal(wordObj.text) ? "valid" : "invalid";
    recalculateScores();
    updatePreviousRounds();
    this.remove();
  };

  btn.after(challengerDropdown);

  function clickOutsideHandler(event) {
    if (!challengerDropdown.contains(event.target)) {
      challengerDropdown.remove();
      document.removeEventListener("click", clickOutsideHandler);
    }
  }
  setTimeout(() => {
    document.addEventListener("click", clickOutsideHandler);
  }, 0);
}

// Players input affects default bonuses
// - 1 player: no bonuses; 2 players: longest only; 3+: both bonuses
document.getElementById("playersInput")?.addEventListener("input", function () {
  const playersList = this.value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const longestWordCheckbox = document.getElementById("longestWordBonus");
  const mostWordsCheckbox = document.getElementById("mostWordsBonus");

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
document.getElementById("playersInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (!gameStarted) startGame();
  }
});

function updateBonusInputs() {
  document.getElementById("longestWordPoints").disabled =
    !document.getElementById("longestWordBonus").checked;
  document.getElementById("mostWordsPoints").disabled =
    !document.getElementById("mostWordsBonus").checked;
}

// Initialize bonus inputs to match toggles
updateBonusInputs();

document
  .getElementById("longestWordBonus")
  ?.addEventListener("change", updateBonusInputs);
document
  .getElementById("mostWordsBonus")
  ?.addEventListener("change", updateBonusInputs);

/**
 * Render the previous rounds list and wire tooltip/dictionary handlers.
 */
function updatePreviousRounds() {
  const hasRounds = roundsData.length > 0;
  // Running totals are always visible now; only toggle previous rounds section
  document
    .getElementById("previousRoundsHeader")
    ?.classList.toggle("hidden", !hasRounds);
  document
    .getElementById("previousRounds")
    ?.classList.toggle("hidden", !hasRounds);
  document
    .getElementById("previousRoundsHint")
    ?.classList.toggle("hidden", !hasRounds);

  const html = roundsData
    .slice()
    .reverse()
    .map((round, revIdx) => {
      const roundIdx = roundsData.length - 1 - revIdx;
      const topBorder = revIdx === 0; // latest round gets top separator
      return (window.QuiddlerRender?.renderRound || renderRound)(
        round,
        roundIdx,
        { interactive: true, topBorder }
      );
    })
    .join("");

  const container = document.getElementById("previousRounds");
  container.innerHTML = html;

  // Delegated click handling for interactive controls
  container.addEventListener("click", function onClick(e) {
    const target = e.target.closest("[data-action]");
    if (!target || !container.contains(target)) return;

    const action = target.getAttribute("data-action");
    if (!action) return;

    if (action === "toggle-challenge") {
      toggleChallenge(target, e);
      return;
    }

    if (action === "edit") {
      const player = target.getAttribute("data-player");
      const roundIdx = +target.getAttribute("data-round");
      enterEditMode(player, roundIdx, target);
      return;
    }

    if (action === "save-edit") {
      const player = target.getAttribute("data-player");
      const roundIdx = +target.getAttribute("data-round");
      // Force a synchronous validation pass before attempting save
      try {
        const row = target.closest(".group");
        const input = row?.querySelector(".edit-input");
        if (input && window.QuiddlerValidation?.validatePlayerWords) {
          const res = window.QuiddlerValidation.validatePlayerWords(
            input.value,
            input
          );
          if (res) {
            input.dataset.wsState = res.status === "ok" ? "valid" : res.status;
            if (res.message) input.dataset.wsMessage = res.message;
            else delete input.dataset.wsMessage;
          }
        }
      } catch (_) {}
      saveEdit(player, roundIdx, target);
      return;
    }

    if (action === "cancel-edit") {
      cancelEdit(target);
      return;
    }

    if (action === "prefill-play") {
      const player = target.getAttribute("data-player");
      const roundIdx = +target.getAttribute("data-round");
      prefillPlayFor(roundIdx, player, e);
      return;
    }
  });

  container.querySelectorAll(".def-open").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const w = el.getAttribute("data-word") || "";
      if (window.QuiddlerTools?.showDict)
        await window.QuiddlerTools.showDict(w);
    });
  });

  (window.QuiddlerRender?.initChitTooltips || initChitTooltips)(container);
}

// Expose selected game APIs under a namespace (keep globals intact for existing calls)
// + Provide read-only snapshots for introspection and debugging.
if (typeof window !== "undefined") {
  const ns = {
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
    skipRound, // NEW export
  };

  // Read-only getters for state
  Object.defineProperties(ns, {
    players: {
      get() {
        return players.slice();
      },
    },
    currentRound: {
      get() {
        return currentRound;
      },
    },
    roundsData: {
      get() {
        try {
          return JSON.parse(JSON.stringify(roundsData));
        } catch {
          return [];
        }
      },
    },
    scores: {
      get() {
        return Object.assign({}, scores);
      },
    },
    startCards: {
      get() {
        return startCards;
      },
    }, // NEW
    endCards: {
      get() {
        return maxRound;
      },
    }, // NEW
    dictSource: {
      get() {
        return dictSource;
      },
    }, // NEW
  });

  // NEW: expose a helper to clear only persisted caches (does not mutate in-memory state).
  function clearGameCacheOnly() {
    try {
      localStorage.removeItem(Q_STORAGE_KEY);
    } catch {}
    try {
      localStorage.removeItem(Q_PRE_CONFIG_KEY);
    } catch {}
  }
  ns.clearGameCacheOnly = clearGameCacheOnly;

  window.QuiddlerGame = ns;
  // Add persistence helpers to namespace
  window.QuiddlerGame.saveGameState = saveGameState;
  window.QuiddlerGame.loadGameState = loadGameState;
  window.QuiddlerGame.DEALER_EMOJI = DEALER_EMOJI; // expose emoji for render helpers
  window.QuiddlerGame.CARD_EMOJI = CARD_EMOJI; // expose emoji for render helpers
}

// --------------- New UI Flow helpers ---------------
function setElementVisible(el, visible) {
  if (!el) return;
  if (visible) {
    el.classList.remove("hidden");
    el.classList.add("flex");
  } else {
    el.classList.add("hidden");
    el.classList.remove("flex");
  }
}

// NEW: centralize skip button visibility (hide in final round or when game over)
function updateSkipVisibility() {
  const btn = document.getElementById("skipRoundBtn");
  if (!btn) return;
  const hide = !gameStarted || gameOver; // allow skip in final round too
  btn.classList.toggle("hidden", hide);
  btn.disabled = hide;
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
  startCards = 3; // NEW
  maxRound = 10; // NEW
  roundsData = [];
  currentDealerIdx = 0;
  currentRoundDraftInputs = {}; // NEW clear drafts

  // Clear dynamic UI
  document.getElementById("scoreTotals").innerHTML = "";
  document.getElementById("previousRounds").innerHTML = "";
  const rh = document.getElementById("roundHeader");
  if (rh) rh.innerText = "";
  const si = document.getElementById("scoreInputs");
  if (si) si.innerHTML = "";

  // Restore running totals header label for next game
  const runHdr = document.getElementById("runningTotalsHeader");
  if (runHdr) runHdr.textContent = "Running Totals";

  // Toggle visibility
  document.getElementById("gameArea")?.classList.add("hidden");
  document.getElementById("preGameConfig")?.classList.remove("hidden");
  document.getElementById("endGameBtn")?.classList.add("hidden");
  // NEW hide skip round button
  const skipBtn4 = document.getElementById("skipRoundBtn");
  if (skipBtn4) {
    skipBtn4.classList.add("hidden");
    skipBtn4.disabled = true;
  }

  // Re-enable pre-game inputs
  document.getElementById("playersInput").disabled = false;
  document.getElementById("longestWordBonus").disabled = false;
  document.getElementById("mostWordsBonus").disabled = false;
  document.getElementById("longestWordPoints").disabled = false;
  document.getElementById("mostWordsPoints").disabled = false;
  document.getElementById("startCards").disabled = false; // NEW
  document.getElementById("endCards").disabled = false; // NEW
  const apiAlso2 = document.getElementById("dictApiAlso");
  if (apiAlso2) apiAlso2.disabled = false; // UPDATED

  // Reset primary CTA label
  const go = document.getElementById("gameGo");
  if (go) go.textContent = "Start Game";

  // Focus player names input
  const p = document.getElementById("playersInput");
  if (p && p.value) {
    p.value = p.value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .join(", ");
    p.focus();
    p.select?.();
  }

  // Hide submit button in pre-game
  const submitBtn = document.getElementById("submitRoundBtn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add("hidden");
  }

  // Hide section headers
  document.getElementById("runningTotalsHeader")?.classList.add("hidden");
  document.getElementById("previousRoundsHeader")?.classList.add("hidden");
  // NEW: also hide the lists so totals don’t show without a title
  document.getElementById("scoreTotals")?.classList.add("hidden");
  document.getElementById("previousRounds")?.classList.add("hidden");
  // NEW: hide the hint under Previous Rounds
  document.getElementById("previousRoundsHint")?.classList.add("hidden");

  try {
    localStorage.removeItem(Q_STORAGE_KEY);
  } catch {}
  // After resetting, re-load saved pre-game config (if any) & reattach listeners
  loadPreGameConfig();
  attachPreGameConfigListeners();
}

// Show end-of-game state inline (no modal) and disable further input
function endGame(completedAllRounds = false) {
  gameOver = true;
  lastGameCompletedAllRounds = !!completedAllRounds;
  const submitBtn = document.getElementById("submitRoundBtn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add("hidden");
  }
  const skipBtn = document.getElementById("skipRoundBtn");
  if (skipBtn) {
    skipBtn.disabled = true;
    skipBtn.classList.add("hidden");
  }
  // Hide current round header & inputs entirely (no Game Over label)
  const inputs = document.getElementById("scoreInputs");
  if (inputs) {
    inputs.innerHTML = "";
    inputs.classList.add("hidden");
  }
  const header = document.getElementById("roundHeader");
  if (header) {
    header.textContent = "";
    header.classList.add("hidden");
  }
  const runHdr = document.getElementById("runningTotalsHeader");
  if (runHdr) runHdr.textContent = "Final Scores";
  document.getElementById("scoreTotals")?.classList.remove("hidden");
  currentRoundDraftInputs = {};
  updateScores();
  saveGameState();
}

function closeEndGameDialog() {
  const modal = document.getElementById("endGameModal");
  setElementVisible(modal, false);

  // Remove temporary listeners if present
  if (modal && modal.__clickToClose) {
    modal.removeEventListener("click", modal.__clickToClose);
    delete modal.__clickToClose;
  }
  if (modal && modal.__escToClose) {
    document.removeEventListener("keydown", modal.__escToClose);
    delete modal.__escToClose;
  }
  if (modal && modal.__enterNewGame) {
    document.removeEventListener("keydown", modal.__enterNewGame);
    delete modal.__enterNewGame;
  }
  if (modal && modal.__enterArmTime) {
    delete modal.__enterArmTime;
  }
}

// On first load, focus players input if in pre-game state (skip if a game was restored)
(function () {
  // Attempt to load any saved game once DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadGameState);
  } else {
    loadGameState();
  }

  if (!gameStarted) {
    // Load any saved pre-game config (only if no active game restored)
    loadPreGameConfig();
    attachPreGameConfigListeners();
    const p = document.getElementById("playersInput");
    if (p && !p.disabled) {
      p.focus();
      p.select?.();
    }
  }

  // Global keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // Ctrl/Cmd+E -> End Game (only if a game is in progress and not already over)
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      !e.shiftKey &&
      (e.key === "e" || e.key === "E")
    ) {
      window.QuiddlerHideShortcuts?.();
      if (gameStarted && !gameOver) {
        e.preventDefault();
        endGame(false);
        return;
      }
    }
    // Ctrl/Cmd+Enter -> New Game setup (fresh settings input screen)
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      !e.shiftKey &&
      e.key === "Enter"
    ) {
      window.QuiddlerHideShortcuts?.();
      e.preventDefault();
      resetToPreGame();
      return;
    }
    // Ctrl/Cmd+. -> Skip current round (if active)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === ".") {
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
(function () {
  function toggleShortcutModal(force) {
    const modal = document.getElementById("shortcutModal");
    if (!modal) return;
    const show =
      force === true || (force == null && modal.classList.contains("hidden"));
    modal.classList.toggle("hidden", !show);
    modal.classList.toggle("flex", show);
  }
  function hideShortcutModal() {
    const modal = document.getElementById("shortcutModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
  // Expose globally for footer click and for other shortcuts to auto-hide
  if (typeof window !== "undefined") {
    window.QuiddlerToggleShortcuts = toggleShortcutModal;
    window.QuiddlerHideShortcuts = hideShortcutModal;
  }

  function globalShortcutHelpHandler(e) {
    // Escape should ONLY close the shortcuts modal if it is currently visible.
    // Prevent the drawer's Escape handler from also firing (which would close the drawer)
    // by stopping propagation when we handled the modal. Then refocus an input in the open drawer.
    if (e.key === "Escape") {
      const modal = document.getElementById("shortcutModal");
      const wasVisible = modal && !modal.classList.contains("hidden");
      if (wasVisible) {
        window.QuiddlerHideShortcuts?.();
        // If tools drawer remains open, restore focus to its active tab input
        const drawer = document.getElementById("toolsDrawer");
        if (drawer && !drawer.classList.contains("translate-x-full")) {
          const dictPanel = document.getElementById("toolsPanelDict");
          // Defer focus till after any layout / visibility changes settle
          setTimeout(() => {
            if (dictPanel && !dictPanel.classList.contains("hidden")) {
              document.getElementById("dictInput")?.focus();
            } else {
              document.getElementById("tilesInput")?.focus();
            }
          }, 0);
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    }
  }
  document.addEventListener("keydown", globalShortcutHelpHandler);
})();

// Attach draft persistence listeners (helper)
function attachDraftListeners() {
  document.querySelectorAll(".player-words").forEach((inp) => {
    inp.addEventListener("input", () => {
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
  if (document.querySelector(".player-words") && !gameOver)
    attachDraftListeners();
  // After restoration and attaching draft listeners, run a one-time hard validation pass so error styling/tooltips are accurate.
  if (
    window.QuiddlerGame &&
    typeof window.QuiddlerGame.validatePlayerInputs === "function"
  ) {
    try {
      window.QuiddlerGame.validatePlayerInputs();
    } catch (_) {}
  } else {
    // Fallback: defer until validation function is defined (in case script load order delays it)
    setTimeout(() => {
      try {
        window.QuiddlerGame?.validatePlayerInputs?.();
      } catch (_) {}
    }, 50);
  }
});
__observer.observe(document.getElementById("scoreInputs") || document.body, {
  childList: true,
  subtree: true,
});

// NEW: Skip current round feature
function skipRound() {
  if (!gameStarted || gameOver) return;
  // Check for existing unfinalized round for currentRound
  let existing = roundsData.find(
    (r) => r.roundNum === currentRound && r.finalized === false && !r.skipped
  );
  if (existing) {
    const anySubmitted =
      existing.submittedPlayers &&
      Object.keys(existing.submittedPlayers).length > 0;
    if (anySubmitted) {
      // Finalize the round automatically: keep existing submissions, auto-add blank zero submissions for the rest
      existing.submittedPlayers = existing.submittedPlayers || {};
      players.forEach((p) => {
        if (!existing.submittedPlayers[p]) {
          // Ensure player entry exists as empty array (counts as no submission but finalized)
          existing.players[p] = [];
          existing.submittedPlayers[p] = true;
        }
      });
      existing.finalized = true;
      // NOT marked as skipped (we keep actual submissions)
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
      return;
    } else {
      // No submissions -> discard placeholder and create a skipped round below
      roundsData = roundsData.filter((r) => r !== existing);
    }
  }
  // No existing round with submissions: record as a skipped round
  const dealerForRound =
    players[(currentDealerIdx - 1 + players.length) % players.length];
  const skippedRound = {
    roundNum: currentRound,
    dealer: dealerForRound,
    skipped: true,
    finalized: true,
    submittedPlayers: {},
    players: Object.fromEntries(players.map((p) => [p, []])),
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

// Consolidate multiple penalty chits: if more than one token begins with '-', merge them into a single leading '-' token
function consolidatePenaltyChits(raw) {
  if (!raw) return raw;
  const tokens = raw.split(/\s+/).filter(Boolean);
  // Collect penalty chits (tokens starting with '-') but ignore standalone '-'
  const penalties = tokens.filter((t) => t.startsWith("-") && t.length > 1);
  const others = tokens.filter((t) => !t.startsWith("-"));
  // If there are no multi-letter penalty chits and only standalone '-' tokens, drop them entirely
  if (!penalties.length) return others.join(" ");
  // Always consolidate into a single penalty chit and move it to the end for consistent rendering
  const combined = "-" + penalties.map((t) => t.replace(/^-/, "")).join("");
  return [...others, combined].join(" ");
}
