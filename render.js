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
             title="">${(window.QuiddlerIcons && window.QuiddlerIcons.img) ? window.QuiddlerIcons.img('dictionary','w-2.5 h-2.5 filter invert') : '<img src="icons/magnifying-glass.svg" alt="" class="w-2.5 h-2.5 filter invert"/>'}</span>`
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
  const nameHTML = `${player}${isDealer ? `<span class=\"dealer-indicator ml-1.5 align-middle\" style=\"font-size:0.85em; line-height:1; display:inline-block; transform:translateY(-1px);\" aria-label=\"${player} dealt round ${round.roundNum}\" data-tippy-content=\"${player} dealt round ${round.roundNum}\">${dealerEmoji}</span>` : ''}`;
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

  const hasSubmitted = !!(round && round.submittedPlayers && round.submittedPlayers[player]);
  const isBlank = (pdata.length === 0);
  const isNoSubmission = !hasSubmitted || isBlank; // treat blank submission same as no submission

  let issues = [];
  if (isNoSubmission) {
    if (!(round && round.finalized === false)) issues = ['No submission'];
  } else {
    // Reconstruct raw text from words (ensure penalty chits last just in case)
    const wordsArr = pdata.slice();
    const penalties = wordsArr.filter(w=>w.text.startsWith('-'));
    const nonPen = wordsArr.filter(w=>!w.text.startsWith('-'));
    const raw = [...nonPen, ...penalties].map(w=>w.text).join(' ');
    if (window.QuiddlerValidation?.validatePlayerWords) {
      const res = window.QuiddlerValidation.validatePlayerWords(raw, { expectedCards });
      if (res.status === 'error') issues.push(res.message || 'Invalid');
      else if (res.status === 'warning') issues.push(res.message);
    }
  }

  const valHTML = (() => {
    if (!issues.length) return '';
    const htmlPieces = issues.map(issue => {
      // Escape, then replace newlines with <br/> so multi-line warnings/errors render properly in tooltip
      const escaped = escapeHtml(issue).replace(/\n/g,'<br/>');
      if (/^Total Cards: /.test(issue)) {
        return escaped.replace(/\(≠ [0-9]+\)$/,"<span class='text-gray-500'>$&</span>");
      }
      return escaped;
    });
  return `<span class="text-red-600 text-xs cursor-help row-val-flag" data-tippy-content="${htmlPieces.join('<br/>')}" title="">🚩</span>`;
  })();

  const controls = interactive ? renderRowControls(roundIdx, player, valHTML) : '';

  const chits = pdata.map((word, i) =>
    renderChit(word, { roundIdx, player, wordIdx: i, interactive, showDefIcon: true })
  ).join(' ');

  const editBlock = interactive ? `
    <div class="edit-container hidden w-full">
      <div class="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full">
  <input type="text" class="border rounded px-2 py-1 flex-auto min-w-0 w-full sm:w-auto text-left edit-input" data-expected-cards="${round.roundNum}"
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
function renderRound(round, roundIdx, {interactive = true, topBorder = false} = {}) {
  // Maps current global players order to rows for this round
  if (round && round.skipped) {
    const borderTopClasses = topBorder ? 'border-t pt-4' : '';
    return `
      <div class="my-4 flex gap-4 border-b border-gray-200 pb-4 ${borderTopClasses}">
        <div class="font-semibold min-w-[50px] flex items-center justify-center text-lg">${round.roundNum}${window.QuiddlerGame.CARD_EMOJI}</div>
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
  const borderTopClasses = topBorder ? 'border-t pt-4' : '';
  return `
    <div class="my-4 flex gap-4 border-b border-gray-200 pb-4 ${borderTopClasses}">
      <div class="font-semibold min-w-[50px] flex items-center justify-center text-lg">${round.roundNum}${window.QuiddlerGame.CARD_EMOJI}</div>
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
  // New presentation to mirror search output style:
  // 1. Header line: "Score <total>" (bold)
  // 2. Breakdown line: Base and bonus emojis (no parentheses) regular text
  // 3. Each chit (solution words, then unused, then discard) on its own centered row
  const el = document.getElementById(containerId);
  if (!el) return;

  const words = Array.isArray(result.words) ? result.words : [];
  const base = Number(result.baseScore ?? 0);
  const leftover = Number(result.leftoverValue ?? 0);
  const baseShown = Math.max(base - leftover, 0);
  const bLong = Number(result?.bonus?.longest ?? 0);
  const bMost = Number(result?.bonus?.most ?? 0);
  const total = Number(result.totalScore ?? (base + bLong + bMost));

  // Build word chits (one per row) using same styling as search (extraClasses '!m-0')
  const wordRows = words.map(w => {
    return `<div class="flex justify-center">${renderChit(
      { text: w.word, score: w.score, state: 'neutral' },
      { interactive:false, forceState:'neutral', forceShowDefIcon:true, showDefIcon:true, extraClasses:'!m-0' }
    )}</div>`;
  });

  // Unused tiles chit row
  if (Array.isArray(result.unusedTiles) && result.unusedTiles.length) {
    const combined = '-' + result.unusedTiles.map(toCardToken).join('');
    const unusedScore = calculateScore(parseCards(combined.replace('-', '')));
    wordRows.push(`<div class="flex justify-center">${renderChit(
      { text: combined, score: unusedScore, state: 'invalid' },
      { interactive:false, forceState:'invalid', showDefIcon:false, extraClasses:'!m-0' }
    )}</div>`);
  }

  // Discard tile chit row
  if (result.discardTile) {
    const discardText = '-' + toCardToken(result.discardTile);
    const discardScore = calculateScore(parseCards(discardText.replace('-', '')));
    wordRows.push(`<div class="flex justify-center">${renderChit(
      { text: discardText, score: discardScore, state: 'neutral' },
      { interactive:false, forceState:'neutral', showDefIcon:false, extraClasses:'bg-yellow-200 !m-0' }
    )}</div>`);
  }

  // Breakdown line
  let breakdown = `Base ${baseShown}`;
  if (bLong) breakdown += ` 🦒${bLong}`;
  if (bMost) breakdown += ` 🥒${bMost}`;

  el.innerHTML = `
    <div class="space-y-2 text-center text-sm">
      <div class="font-bold text-sm">Score <span class="tabular-nums">${total}</span></div>
      <div class="text-gray-600">${breakdown}</div>
      <div class="flex flex-col gap-2 items-center mt-2">${wordRows.join('')}</div>
    </div>
  `;

  // Wire definition icon clicks
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
