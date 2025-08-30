// render.js — UI rendering helpers for rounds, rows, and chits
// Responsibilities:
// - renderChit: visual for a word/chit with score, color by state, optional def icon
// - renderPlayerRow/Header/Controls: per-player row with inline edit and play helper gear
// - renderRound: compose a round block from per-player rows
// - initChitTooltips: wire up tippy tooltips for breakdowns and def icons
// - renderOptimizedPlayFromResult: present solver output as chits and score summary
// Notes:
// - Word state colors: neutral=gray, valid=green, invalid=red
// - The def-open icon triggers the dictionary drawer; breakdown tooltips are suppressed while hovering def icons

// HTML for a single chit (reusable for rounds or optimizer)
function renderChit(word, opts = {}) {
  // opts: { roundIdx, player, wordIdx, interactive, showDefIcon, showBreakdown, forceState, forceShowDefIcon, extraClasses }
  // - interactive adds data-action for challenge toggle
  // - showDefIcon is auto-enabled for valid words unless forceShowDefIcon is true
  // - showBreakdown enables tooltip built from scoring.breakdownStr
  const {
    roundIdx = null,
    player = null,
    wordIdx = null,
    interactive = false,
    showDefIcon = true,
    showBreakdown = true,
    forceState = null,
    forceShowDefIcon = false,
    extraClasses = ''
  } = opts;

  const effectiveState = forceState ?? word.state;
  // Build tooltip content (score breakdown + optional challenger)
  let tipContent = breakdownStr(word.text);
  if (word.challenger) {
    const chall = String(word.challenger).replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    tipContent = `${tipContent}<br><span class=\"text-xs text-gray-500\">Challenged by ${chall}</span>`;
  }
  const tooltipAttr = showBreakdown
    ? `data-tippy-content="${tipContent.replace(/"/g, '&quot;')}"`
    : '';

  const colorClass =
    effectiveState === 'invalid' ? 'bg-red-200'
    : effectiveState === 'valid' ? 'bg-green-200'
    : effectiveState === 'checking' ? 'bg-yellow-200 animate-pulse'
    : 'bg-gray-200';

  const wantDefIcon = (forceShowDefIcon || effectiveState === 'valid') && showDefIcon;
  const defIcon = wantDefIcon
    ? `<span class="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-500 hover:bg-gray-600 text-white cursor-pointer def-open"
             data-word="${word.text.replace(/"/g,'&quot;')}"
             data-tippy-content="Look up"
             title="">
         <img src="book-open.svg" alt="" class="w-3 h-3 filter invert"/>
       </span>`
    : '';

  // interactive wiring (only when interactive=true)
  const interAttrs = interactive
    ? `data-action="toggle-challenge" data-player="${player}" data-round="${roundIdx}" data-word="${wordIdx}"`
    : `aria-disabled="true"`;

  const cursorClass = interactive ? 'cursor-pointer hover:bg-opacity-80' : 'cursor-default';

  return `
    <button type="button"
      class="inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded-md ${colorClass} ${cursorClass} ${extraClasses}
             breakdown-tip ring-1 ring-black/5"
      ${tooltipAttr} ${interAttrs}>
      <span class="font-semibold tracking-tight">${word.text.toUpperCase()}</span>
      <span class="opacity-80">[${word.score}]</span>
      ${effectiveState === 'checking' ? '<span class="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin"></span>' : ''}
      ${defIcon}
    </button>
  `;
}

// Row header segments
function renderPlayerRowHeader(player, pdata, round) {
  // Displays: player name (+ dealer emoji if this player dealt) | roundScore | breakdown
  const isDealer = round && round.dealer === player;
  const dealerEmoji = (typeof window !== 'undefined' && window.QuiddlerGame?.DEALER_EMOJI) ? window.QuiddlerGame.DEALER_EMOJI : '🃏';
  // Smaller emoji (0.85em) for historical rounds only (current round inputs use game.js markup unchanged)
  const nameHTML = `${player}${isDealer ? `<span class=\"dealer-indicator ml-0.5 align-middle\" style=\"font-size:0.85em; line-height:1; display:inline-block; transform:translateY(-1px);\" aria-label=\"${player} dealt round ${round.roundNum}\" data-tippy-content=\"${player} dealt round ${round.roundNum}\">${dealerEmoji}</span>` : ''}`;
  const parts = [];
  parts.push(Math.max(pdata.baseScore, 0));
  if (pdata.challengeDeductions) parts.push(`- ${pdata.challengeDeductions}`);
  if (pdata.gotLongestBonus) parts.push(`+🦒`);
  if (pdata.gotMostWordsBonus) parts.push(`+🥒`);
  const breakdown = parts.join(' ');

  return `
    <span class="truncate min-w-0 flex-none max-w-[8ch] sm:justify-self-start">${nameHTML}</span>
    <span class="tabular-nums text-right justify-self-end flex-none w-[4ch]">${pdata.roundScore}</span>
    <span class="text-gray-600 truncate min-w-0 flex-1 sm:flex-none sm:block"
          title="${(pdata.challengeDeductions || pdata.bonus) ? '('+breakdown+')' : ''}">
      ${(pdata.challengeDeductions || pdata.bonus) ? '('+breakdown+')' : ''}
    </span>
  `;
}

// Interactive controls (edit + gear). Call only when interactive=true
function renderRowControls(roundIdx, player, extraRightHTML = '') {
  // Edit toggles inline text editing; gear pre-fills Play Helper with current row
  return `
    <span class="controls-cell flex items-center w-full">
      <span class="flex items-center gap-1 flex-auto">
        <span class="controls-view-mode inline-flex items-center gap-1">
          <button data-action="edit" data-player="${player}" data-round="${roundIdx}"
                  class="plain-tip opacity-100 sm:opacity-0 group-hover:opacity-100 transition" data-tippy-content="Edit play">✏️</button>
          <button data-action="prefill-play" data-player="${player}" data-round="${roundIdx}"
                  class="plain-tip opacity-100 sm:opacity-0 group-hover:opacity-100 transition text-emerald-700 hover:text-emerald-900" data-tippy-content="Open with solver">⚙️</button>
        </span>
        <span class="controls-edit-mode hidden inline-flex items-center gap-1">
          <button data-action="save-edit" data-player="${player}" data-round="${roundIdx}"
                  class="plain-tip opacity-100 transition" data-tippy-content="Save">✔️</button>
          <button data-action="cancel-edit" class="plain-tip opacity-100 transition" data-tippy-content="Cancel">❌</button>
        </span>
      </span>
      <span class="flex-none ml-1">${extraRightHTML}</span>
    </span>
  `;
}

// ---------- Row validation (subtle) ----------
function buildRowValidationIssues(pdata, expectedCards) {
  try {
    const cards = window.QuiddlerData?.cardScores || (typeof cardScores !== 'undefined' ? cardScores : {});

    let recognizedCount = 0;      // tokens matched by the parser
    let unknownDeck = [];         // matched tokens not in deck (normalized)
    let unmatchedFragments = [];  // characters/spans the parser could not consume (incl. midword '-')

    (pdata || []).forEach(w => {
      const txt = String(w?.text || '');
      const core = txt.startsWith('-') ? txt.slice(1) : txt;

      // Scan core, capturing matched tokens and gaps that are not parsed
      const re = /\([a-z]+\)|[a-z]/gi;
      let m;
      let idx = 0;
      const matchedTokens = [];
      while ((m = re.exec(core)) !== null) {
        const gap = core.slice(idx, m.index);
        if (gap.length) {
          // record raw gap segments split by whitespace; keep punctuation like '-' as its own token
          gap.split(/\s+/).forEach(seg => { if (seg) unmatchedFragments.push(seg); });
        }
        matchedTokens.push(m[0]);
        idx = m.index + m[0].length;
      }
      const tail = core.slice(idx);
      if (tail.length) {
        tail.split(/\s+/).forEach(seg => { if (seg) unmatchedFragments.push(seg); });
      }

      // Tally recognized tokens and unknown deck items
      recognizedCount += matchedTokens.length;
      matchedTokens.forEach(t => {
        const norm = normalizeToken(t);
        if (!(norm in cards)) unknownDeck.push(norm);
      });
    });

    // Compute total found as recognized tokens plus unmatched fragments
    const foundCount = recognizedCount + unmatchedFragments.length;

    const issues = [];

    // Combine all invalid items under one line
    const invalidItems = Array.from(new Set([
      // display tokens for unknown deck items
      ...unknownDeck.map(toCardToken),
      // raw unmatched fragments
      ...unmatchedFragments
    ]));
    if (invalidItems.length) {
      issues.push(`Invalid cards: ${invalidItems.join(', ')}`);
    }

    // Short card count message only when mismatched
    if (Number.isFinite(expectedCards) && expectedCards > 0 && foundCount !== expectedCards) {
      issues.push(`Total Cards: ${foundCount}`);
    }

    return issues;
  } catch (e) {
    return [];
  }
}

function escapeHtml(s){
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Render one player's row (interactive or static)
function renderPlayerRow(roundIdx, player, pdata, {interactive = true, expectedCards = null, round = null} = {}) {
  // Builds header, optional controls, list of chits and hidden edit block
  const header = renderPlayerRowHeader(player, pdata, round);

  const issues = buildRowValidationIssues(pdata, expectedCards);
  const tooltipHTML = issues.length ? issues.map(escapeHtml).join('<br/>') : '';
  const valHTML = issues.length
    ? `<span class="text-red-600 text-xs cursor-help row-val-flag" data-tippy-content="${tooltipHTML}" title="">🚩</span>`
    : '';

  const controls = interactive ? renderRowControls(roundIdx, player, valHTML) : '';

  const chits = pdata.map((word, i) =>
    renderChit(word, { roundIdx, player, wordIdx: i, interactive, showDefIcon: true })
  ).join(' ');

  const editBlock = interactive ? `
    <div class="edit-container hidden w-full">
      <div class="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full">
        <input type="text" class="border rounded px-2 py-1 flex-auto min-w-0 w-full sm:w-auto text-left edit-input"
               value="${pdata.map(w=>w.text).join(' ')}">
      </div>
    </div>
  ` : '';

  return `
    <div class="relative group items-start gap-2 flex flex-wrap sm:grid sm:items-baseline sm:grid-cols-[8ch_4ch_11ch_3rem_1fr]">
      <div class="grid grid-cols-[7ch_4ch_minmax(0,1fr)_3rem] items-baseline gap-2 w-full sm:contents">
        ${header}
        ${controls}
      </div>
      <div class="row-chits-cell min-w-0 flex-1 basis-full sm:basis-auto sm:mt-1">
        <div class="chit-container flex flex-wrap gap-1">
          ${chits}
        </div>
        ${editBlock}
      </div>
    </div>
  `;
}

// Render a whole round block (interactive or static)
function renderRound(round, roundIdx, {interactive = true} = {}) {
  // Maps current global players order to rows for this round
  if (round && round.skipped) {
    return `
      <div class="my-4 flex gap-4 border-b border-gray-200 pb-4">
        <div class="font-bold min-w-[50px] flex items-center justify-center text-xl">${round.roundNum}</div>
        <div class="flex items-center text-gray-500 italic">Skipped</div>
      </div>
    `;
  }
  const playerList = (window.QuiddlerGame?.players)
    ? window.QuiddlerGame.players
    : (typeof players !== 'undefined' ? players : []);

  const rows = playerList
    .map(player => renderPlayerRow(roundIdx, player, round.players[player], {interactive, expectedCards: round.roundNum, round}))
    .join('');
  return `
    <div class="my-4 flex gap-4 border-b border-gray-200 pb-4">
      <div class="font-bold min-w-[50px] flex items-center justify-center text-xl">${round.roundNum}</div>
      <div class="flex flex-col gap-2">
        ${rows}
      </div>
    </div>
  `;
}

// Global flag so breakdown tooltips don't show while a def icon is hovered
window.__defOpenHover = false;

function initChitTooltips(container = document) {
  if (typeof window === 'undefined' || !window.tippy) {
    return { breakdownInstances: [], defInstances: [], valInstances: [], dealerInstances: [] };
  }
  // Two tippy groups:
  // - breakdownInstances on .breakdown-tip show letter-by-letter points
  // - defInstances on .def-open indicate dictionary action; they suppress breakdown tooltips while active
  const breakdownInstances = tippy(container.querySelectorAll('.breakdown-tip'), {
    delay: [100, 50],
    animation: 'scale',
    allowHTML: true,
    onTrigger(instance, event) {
      if (window.__defOpenHover) {
        event.preventDefault();
      }
    },
    onShow(instance) {
      return !window.__defOpenHover;
    }
  });

  const defInstances = tippy(container.querySelectorAll('.def-open'), {
    delay: [100, 50],
    animation: 'scale',
    onShow() {
      window.__defOpenHover = true;
      breakdownInstances.forEach(inst => inst.hide());
    },
    onHidden() {
      window.__defOpenHover = false;
    }
  });

  const valInstances = tippy(container.querySelectorAll('.row-val-flag'), {
    delay: [100, 50],
    animation: 'scale',
    allowHTML: true,
    placement: 'top'
  });

  // NEW: dealer emoji tooltips (fast appearance)
  const dealerInstances = tippy(container.querySelectorAll('.dealer-indicator'), {
    delay: [500, 0],
    animation: 'none',
    placement: 'bottom',
    theme: 'plain',
    arrow: false,
    offset: [0, 6]
  });

  // NEW: control emoji tooltips (edit/gear/save/cancel)
  const controlInstances = tippy(container.querySelectorAll('.plain-tip'), {
    delay: [500,0],
    animation: 'none',
    placement: 'bottom',
    theme: 'plain',
    arrow: false,
    offset: [0,6]
  });

  return { breakdownInstances, defInstances, valInstances, dealerInstances, controlInstances };
}

function renderOptimizedPlayFromResult(containerId, result) {
  // Renders solver result as chits:
  // - words[] as neutral chits with forced def icons
  // - unusedTiles collapsed into a single invalid '-' chit
  // - discardTile shown as a yellow neutral '-' chit (informational)
  const el = document.getElementById(containerId);
  if (!el) return;

  const usedWordChits = (result.words || [])
    .map(w => renderChit(
      { text: w.word, score: w.score, state: 'neutral' },
      { interactive: false, forceState: 'neutral', forceShowDefIcon: true, showDefIcon: true }
    ))
    .join(' ');

  let unusedChitHTML = '';
  if (Array.isArray(result.unusedTiles) && result.unusedTiles.length) {
    const toTok = toCardToken;
    const parse = parseCards;
    const calc  = calculateScore;

    const combined = '-' + result.unusedTiles.map(toTok).join('');
    const unusedScore = calc(parse(combined.replace('-', '')));
    unusedChitHTML = renderChit(
      { text: combined, score: unusedScore, state: 'invalid' },
      { interactive: false, forceState: 'invalid', showDefIcon: false }
    );
  }

  let discardChitHTML = '';
  if (result.discardTile) {
    const toTok = toCardToken;
    const parse = parseCards;
    const calc  = calculateScore;

    const discardText = '-' + toTok(result.discardTile);
    const discardScore = calc(parse(discardText.replace('-', '')));
    discardChitHTML = renderChit(
      { text: discardText, score: discardScore, state: 'neutral' },
      {
        interactive: false,
        forceState: 'neutral',
        showDefIcon: false,
        extraClasses: 'bg-yellow-200'
      }
    );
  }

  const base = Number(result.baseScore ?? 0);
  const leftover = Number(result.leftoverValue ?? 0);
  const baseShown = Math.max(base - leftover, 0);

  const bLong = Number(result?.bonus?.longest ?? 0);
  const bMost = Number(result?.bonus?.most ?? 0);
  const total = Number(result.totalScore ?? (base + bLong + bMost));
  const hasBonus = Boolean(bLong || bMost);

  const breakdownInline = hasBonus
    ? ` <span class="text-gray-600 text-[18px]">(${baseShown}${bLong ? ' + 🦒' : ''}${bMost ? ' + 🥒' : ''})</span>`
    : '';

  el.innerHTML = `
    <div class="space-y-2">
      <div class="flex items-baseline gap-2">
        <span class="text-[18px] font-semibold">Score:</span>
        <span class="text-[18px] font-semibold tabular-nums">${total}</span>
        ${breakdownInline}
      </div>
      <div class="flex flex-wrap items-center gap-1">
        ${usedWordChits} ${unusedChitHTML} ${discardChitHTML}
      </div>
    </div>
  `;

  el.querySelectorAll('.def-open').forEach(icon => {
    icon.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const w = icon.getAttribute('data-word') || '';
      if (window.QuiddlerTools?.showDict) await window.QuiddlerTools.showDict(w);
    });
  });

  initChitTooltips(el);
}

// Expose render helpers under a namespace
if (typeof window !== 'undefined') {
  window.QuiddlerRender = Object.assign({}, window.QuiddlerRender || {}, {
    renderChit,
    renderPlayerRowHeader,
    renderRowControls,
    renderPlayerRow,
    renderRound,
    initChitTooltips,
    renderOptimizedPlayFromResult,
  });
}
