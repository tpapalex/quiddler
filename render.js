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
  const tooltipAttr = showBreakdown
    ? `data-tippy-content="${breakdownStr(word.text).replace(/"/g, '&quot;')}"`
    : '';

  const colorClass =
    effectiveState === 'invalid' ? 'bg-red-200'
    : effectiveState === 'valid' ? 'bg-green-200'
    : 'bg-gray-200';

  const wantDefIcon = (forceShowDefIcon || effectiveState === 'valid') && showDefIcon;
  const defIcon = wantDefIcon
    ? `<span class="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-500 hover:bg-gray-600 text-white cursor-pointer def-open"
             data-word="${word.text.replace(/"/g,'&quot;')}"
             data-tippy-content="Look up"
             title="">
         <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
           <path d="M12 6.75c-1.71-1.02-3.77-1.5-6-1.5v11.25c2.23 0 4.29.48 6 1.5m0-11.25c1.71-1.02 3.77-1.5 6-1.5v11.25c-2.23 0-4.29.48-6 1.5m0-11.25v11.25"/>
         </svg>
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
      ${defIcon}
    </button>
  `;
}

// Row header segments
function renderPlayerRowHeader(player, pdata) {
  // Displays: player name | roundScore | inline breakdown (base - deductions + bonuses)
  const parts = [];
  parts.push(Math.max(pdata.baseScore, 0));
  if (pdata.challengeDeductions) parts.push(`- ${pdata.challengeDeductions}`);
  if (pdata.gotLongestBonus) parts.push(`+🦒`);
  if (pdata.gotMostWordsBonus) parts.push(`+🥒`);
  const breakdown = parts.join(' ');

  return `
    <span class="truncate min-w-0 flex-none max-w-[8ch] sm:justify-self-start" title="${player}">${player}</span>
    <span class="tabular-nums text-right justify-self-end flex-none w-[4ch]">${pdata.roundScore}</span>
    <span class="text-gray-600 truncate min-w-0 flex-1 sm:flex-none sm:block"
          title="${(pdata.challengeDeductions || pdata.bonus) ? '('+breakdown+')' : ''}">
      ${(pdata.challengeDeductions || pdata.bonus) ? '('+breakdown+')' : ''}
    </span>
  `;
}

// Interactive controls (edit + gear). Call only when interactive=true
function renderRowControls(roundIdx, player) {
  // Edit toggles inline text editing; gear pre-fills Play Helper with current row
  return `
    <span class="controls-cell flex-none flex items-center justify-start w-full">
      <span class="controls-view-mode inline-flex items-center gap-1 w-full">
        <button data-action="edit" data-player="${player}" data-round="${roundIdx}"
                class="opacity-100 sm:opacity-0 group-hover:opacity-100 transition">✏️</button>
        <button data-action="prefill-play" data-player="${player}" data-round="${roundIdx}"
                class="opacity-100 sm:opacity-0 group-hover:opacity-100 transition text-emerald-700 hover:text-emerald-900"
                title="Open Play Helper">⚙️</button>
      </span>
      <span class="controls-edit-mode hidden inline-flex items-center gap-1 w-full">
        <button data-action="save-edit" data-player="${player}" data-round="${roundIdx}"
                class="opacity-100 transition" title="Save">✔️</button>
        <button data-action="cancel-edit" class="opacity-100 transition" title="Cancel">❌</button>
      </span>
    </span>
  `;
}

// Render one player's row (interactive or static)
function renderPlayerRow(roundIdx, player, pdata, {interactive = true} = {}) {
  // Builds header, optional controls, list of chits and hidden edit block
  const header = renderPlayerRowHeader(player, pdata);
  const controls = interactive ? renderRowControls(roundIdx, player) : '';

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
    <div class="relative group items-start gap-2 flex flex-wrap sm:grid sm:items-baseline sm:grid-cols-[8ch_4ch_11ch_2.5rem_1fr]">
      <div class="grid grid-cols-[8ch_4ch_minmax(0,1fr)_2.5rem] items-baseline gap-2 w-full sm:contents">
        ${header}
        ${controls}
      </div>
      <div class="row-chits-cell min-w-0 flex-1 basis-full sm:basis-auto">
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
  const playerList = (window.QuiddlerGame?.players)
    ? window.QuiddlerGame.players
    : (typeof players !== 'undefined' ? players : []);

  const rows = playerList
    .map(player => renderPlayerRow(roundIdx, player, round.players[player], {interactive}))
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
    return { breakdownInstances: [], defInstances: [] };
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

  return { breakdownInstances, defInstances };
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

  const base     = Number(result.baseScore ?? 0);
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
