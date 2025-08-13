'use strict';

// HTML for a single chit (reusable for rounds or optimizer)
function renderChit(word, opts = {}) {
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
    ? `data-player="${player}" data-round="${roundIdx}" data-word="${wordIdx}"
       onclick="toggleChallenge(this,event)"`
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
  const parts = [];
  parts.push(Math.max(pdata.baseScore, 0));
  if (pdata.challengeDeductions) parts.push(`- ${pdata.challengeDeductions}`);
  if (pdata.gotLongestBonus) parts.push(`+🦒`);
  if (pdata.gotMostWordsBonus) parts.push(`+🥒`);
  const breakdown = parts.join(' ');

  return `
    <span class="w-28 sm:w-20 shrink-0 truncate" title="${player}">${player}</span>
    <span class="w-10 sm:w-10 shrink-0 tabular-nums">${pdata.roundScore}</span>
    <span class="w-60 sm:w-32 shrink-0 text-gray-600"
          title="${(pdata.challengeDeductions || pdata.bonus) ? '('+breakdown+')' : ''}">
      ${(pdata.challengeDeductions || pdata.bonus) ? '('+breakdown+')' : ''}
    </span>
  `;
}

// Interactive controls (edit + gear). Call only when interactive=true
function renderRowControls(roundIdx, player) {
  return `
    <span class="w-10 shrink-0 flex items-center gap-1 justify-start">
      <button onclick="enterEditMode('${player}', ${roundIdx}, this)"
              class="opacity-0 group-hover:opacity-100 transition">✏️</button>
      <button onclick="prefillPlayFor(${roundIdx}, '${player}', event)"
              class="opacity-0 group-hover:opacity-100 transition text-emerald-700 hover:text-emerald-900"
              title="Open Play Helper">⚙️</button>
    </span>
  `;
}

// Render one player's row (interactive or static)
function renderPlayerRow(roundIdx, player, pdata, {interactive = true} = {}) {
  const header = renderPlayerRowHeader(player, pdata);
  const controls = interactive ? renderRowControls(roundIdx, player) : '';

  const chits = pdata.map((word, i) =>
    renderChit(word, { roundIdx, player, wordIdx: i, interactive, showDefIcon: true })
  ).join(' ');

  const editBlock = interactive ? `
    <div class="edit-container hidden">
      <div class="flex items-center gap-2">
        <input type="text" class="border rounded p-1 flex-1 min-w-0 edit-input"
               value="${pdata.map(w=>w.text).join(' ')}">
        <button onclick="saveEdit('${player}', ${roundIdx}, this)" class="px-2">✔️</button>
        <button onclick="cancelEdit(this)" class="px-2">❌</button>
      </div>
    </div>
  ` : '';

  return `
    <div class="flex items-center gap-2 relative group flex-wrap">
      ${header}
      ${controls}
      <div class="flex-1 min-w-0">
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
  const rows = players
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
