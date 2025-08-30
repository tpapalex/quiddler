// tools_drawer.js — Right-side tools drawer (Dictionary + Solver)
// Responsibilities:
// - Manage drawer open/close with backdrop and ESC
// - Switch between Dictionary and Play Helper tabs
// - Dictionary: render local definition immediately, fetch online definition async
// - Play Helper: gather options and call QuiddlerSolver.optimize, then render via QuiddlerRender
// - Expose a small API on window.QuiddlerTools for other modules

function initToolsDrawer(){
  const drawer   = document.getElementById('toolsDrawer');
  const closeBtn = document.getElementById('toolsCloseBtn');
  const backdrop = document.getElementById('toolsBackdrop');
  let closeFocusTimer = null; // NEW: track pending focus restore

  function openDrawer() {
    // Cancel any pending focus restore from a prior close (Escape on shortcut modal etc.)
    if (closeFocusTimer) { clearTimeout(closeFocusTimer); closeFocusTimer = null; }
    // Slide in drawer and fade in backdrop
    drawer.classList.remove('translate-x-full');
    backdrop.classList.remove('hidden');
    void backdrop.offsetWidth; // force reflow for transition
    backdrop.classList.remove('opacity-0');
  }
  function focusFirstEmptyPlayerInput() {
    const inputs = Array.from(document.querySelectorAll('.player-words'));
    if (inputs.length > 0) {
      const empty = inputs.find(i => !i.value || i.value.trim() === '');
      const target = empty || inputs[0];
      target?.focus();
      target?.select?.();
      return;
    }
    // Fallback to players input on pre-game screen
    const p = document.getElementById('playersInput');
    const pre = document.getElementById('preGameConfig');
    if (p && pre && !pre.classList.contains('hidden') && !p.disabled) {
      p.focus(); p.select?.();
    }
  }
  function closeDrawer() {
    // Slide out drawer and fade out backdrop
    drawer.classList.add('translate-x-full');
    backdrop.classList.add('opacity-0');
    const onEnd = () => {
      backdrop.classList.add('hidden');
      backdrop.removeEventListener('transitionend', onEnd);
      // Schedule focus back ONLY if we really closed the drawer intentionally
      closeFocusTimer = setTimeout(() => focusFirstEmptyPlayerInput(), 0);
    };
    backdrop.addEventListener('transitionend', onEnd);
  }

  // Launchers
  document.getElementById('dictToolBtn')?.addEventListener('click', () => {
    window.QuiddlerHideShortcuts?.(); // hide shortcuts popup if open
    openDrawer();
    showTab('dict');
    setTimeout(() => document.getElementById('dictInput')?.focus(), 0);
  });
  document.getElementById('optToolBtn')?.addEventListener('click', () => {
    window.QuiddlerHideShortcuts?.(); // hide shortcuts popup if open
    openDrawer();
    showTab('play');
    setTimeout(() => document.getElementById('tilesInput')?.focus(), 0);
  });
  closeBtn.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    // Global shortcuts
    if (e.key === 'Escape') {
      // If shortcut modal is open, ignore (modal handler will run). Only close drawer if actually open.
      const sm = document.getElementById('shortcutModal');
      const modalVisible = sm && !sm.classList.contains('hidden');
      const drawerOpen = !drawer.classList.contains('translate-x-full');
      if (!modalVisible && drawerOpen) {
        closeDrawer();
      }
      return;
    }
    const isAccel = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
    if (!isAccel) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'i') { // Dictionary (was D)
      window.QuiddlerHideShortcuts?.();
      e.preventDefault();
      openDrawer();
      showTab('dict');
      setTimeout(() => document.getElementById('dictInput')?.focus(), 0);
    } else if (k === 'o') { // Solver (was S)
      window.QuiddlerHideShortcuts?.();
      e.preventDefault();
      openDrawer();
      showTab('play');
      setTimeout(() => document.getElementById('tilesInput')?.focus(), 0);
    }
  });

  // Tabs
  const tabDict = document.getElementById('toolsTabDict');
  const tabPlay = document.getElementById('toolsTabPlay');
  const panelDict = document.getElementById('toolsPanelDict');
  const panelPlay = document.getElementById('toolsPanelPlay');

  function showTab(which) {
    const isDict = which === 'dict';
    panelDict.classList.toggle('hidden', !isDict);
    panelPlay.classList.toggle('hidden', isDict);
    tabDict.classList.toggle('bg-white', isDict);
    tabDict.classList.toggle('text-gray-900', isDict);
    tabDict.classList.toggle('bg-gray-100', !isDict);
    tabDict.classList.toggle('text-gray-600', !isDict);
    tabPlay.classList.toggle('bg-white', !isDict);
    tabPlay.classList.toggle('text-gray-900', !isDict);
    tabPlay.classList.toggle('bg-gray-100', isDict);
    tabPlay.classList.toggle('text-gray-600', isDict);

    // Focus appropriate input after switching tabs, but only if drawer is open
    setTimeout(() => {
      const isOpen = !drawer.classList.contains('translate-x-full');
      if (!isOpen) return;
      if (isDict) document.getElementById('dictInput')?.focus();
      else document.getElementById('tilesInput')?.focus();
    }, 0);

    // AFTER switching, if showing Play tab ensure API filter default reflects current game dictionary source.
    if (which === 'play') {
      applyApiFilterDefault();
    }
  }
  tabDict.addEventListener('click', () => showTab('dict'));
  tabPlay.addEventListener('click', () => showTab('play'));
  showTab('dict');

  // ===== Dictionary (async, render <br>) =====
  const dictInput  = document.getElementById('dictInput');
  const dictEmpty  = document.getElementById('dictEmpty');
  const LAST_DICT_WORD_KEY = 'quiddlerLastDictWord'; // NEW persistence key
  // Debounce timer so we don't fetch on every keystroke
  let dictDebounceTimer = null;
  const DICT_DEBOUNCE_MS = 350;

  async function renderDefinition(word) {
    const localWrap  = document.getElementById('dictLocalWrap');
    const localEl    = document.getElementById('dictLocal');
    const onlineWrap = document.getElementById('dictOnlineWrap');
    const onlineEl   = document.getElementById('dictOnline');
    const loadingEl  = document.getElementById('dictOnlineLoading');
    const emptyHint  = document.getElementById('dictEmpty');
    const raw = (word || '').trim();
    const cleaned = plainWord(raw);

    if (!cleaned) {
      // Clear persisted key when user empties input intentionally
      try { if (!raw) localStorage.removeItem(LAST_DICT_WORD_KEY); } catch(_){ }
      localWrap?.classList.add('hidden');
      onlineWrap?.classList.add('hidden');
      loadingEl?.classList.add('hidden');
      if (emptyHint) emptyHint.classList.remove('hidden');
      return;
    }
    // Persist last successful cleaned lookup
    try { localStorage.setItem(LAST_DICT_WORD_KEY, cleaned); } catch(_){ }
    if (emptyHint) emptyHint.classList.add('hidden');

    // Local dictionary (always show block, with fallback text)
    const localRaw = getWordDefinitionLocal(cleaned);
    if (localWrap && localEl) {
      let localHTML = '<span class="text-gray-500">No definition found</span>';
      if (localRaw) {
        try {
          // Use parser for structured Collins rendering (badges for pos / variants / aka / inflections)
            const parsed = (typeof parseCollinsEntry === 'function') ? parseCollinsEntry(cleaned) : (window.CollinsParsing?.parseCollinsEntry?.(cleaned));
            if (parsed && typeof renderParsedCollins === 'function') {
              localHTML = renderParsedCollins(parsed);
            } else {
              localHTML = localRaw; // fallback
            }
        } catch(_) {
          localHTML = localRaw; // safety fallback on any parsing error
        }
      }
      localEl.innerHTML = localHTML;
      localWrap.classList.remove('hidden');
    }

    // Online dictionary
    onlineWrap?.classList.remove('hidden');
    if (onlineEl) onlineEl.innerHTML = '';
    loadingEl?.classList.remove('hidden');
    try {
      const { found, error, data } = await getWordDefinitionAPI(cleaned);
      if (!error && found && data) {
        renderOnlineDict(word, data, { senseLimit: 3 });
        // renderOnlineDict will unhide wrapper; ensure visible
        onlineWrap?.classList.remove('hidden');
      } else {
        // Show explicit message instead of hiding
        if (onlineEl) onlineEl.innerHTML = '<span class="text-gray-500">No definition found</span>';
        onlineWrap?.classList.remove('hidden');
      }
    } catch (e) {
      if (onlineEl) onlineEl.innerHTML = '<span class="text-gray-500">Lookup unavailable</span>';
      onlineWrap?.classList.remove('hidden');
    } finally {
      loadingEl?.classList.add('hidden');
    }
  }

  async function doLookup(){ await renderDefinition(dictInput.value); }

  // If an older cached HTML still has the button, keep this safe-guarded listener
  const dictGo = document.getElementById('dictGo');
  if (dictGo) dictGo.addEventListener('click', doLookup);

  // Auto-lookup with debounce on input changes
  dictInput.addEventListener('input', () => {
    if (dictDebounceTimer) { clearTimeout(dictDebounceTimer); dictDebounceTimer = null; }
    const val = dictInput.value || '';
    if (!val.trim()) { renderDefinition(''); return; }
    dictDebounceTimer = setTimeout(() => { doLookup(); }, DICT_DEBOUNCE_MS);
  });

  dictInput.addEventListener('keydown', async (e)=>{
    if (e.key === 'Enter') {
      if (dictDebounceTimer) { clearTimeout(dictDebounceTimer); dictDebounceTimer = null; }
      await doLookup();
    }
    if (e.key === 'Escape') {
      // Previously: cleared input & definition. Removed to preserve last lookup when closing drawer or shortcut modal.
      // Intentionally NO action so the definition persists.
      // (User can manually clear the field; Escape now only affects modal/drawer visibility.)
    }
  });

  // On init, restore last looked-up word if input empty
  try {
    if (dictInput && (!dictInput.value || !dictInput.value.trim())) {
      const last = localStorage.getItem(LAST_DICT_WORD_KEY);
      if (last) {
        dictInput.value = last;
        renderDefinition(last);
      }
    }
  } catch(_){ }

  // ===== Play Helper =====
  const tilesInput        = document.getElementById('tilesInput');
  const optNoDiscard      = document.getElementById('optNoDiscard');
  const optCommonOnly     = document.getElementById('optCommonOnly');
  const optCommonOverride = document.getElementById('optCommonOverride');
  const optZipf           = document.getElementById('optZipf');
  const zipfVal           = document.getElementById('zipfVal');
  const optCurrentLongest = document.getElementById('optCurrentLongest');
  const optCurrentMost    = document.getElementById('optCurrentMost');
  const playGo            = document.getElementById('playGo');
  const playStatus        = document.getElementById('playStatus');
  const playResult        = document.getElementById('playResult');
  const optApiFilter      = document.getElementById('optApiFilter'); // RENAMED

  // Helper to (re)apply default API filter when game dict source is API.
  function applyApiFilterDefault(){
    if (!optApiFilter) return;
    try {
      const ds = (window.QuiddlerGame && window.QuiddlerGame.dictSource) ? window.QuiddlerGame.dictSource : (typeof dictSource !== 'undefined' ? dictSource : 'local');
      // Only auto-check if user has not manually toggled (tracked via data-user-set flag)
      if (ds === 'api' && !optApiFilter.dataset.userSet) {
        optApiFilter.checked = true;
      }
    } catch(_){}
  }

  // Default API filter checkbox if game dictionary source is API (initial pass)
  try {
    applyApiFilterDefault();
  } catch(_){}

  // Track user interaction so we don’t override their choice later
  if (optApiFilter) {
    optApiFilter.addEventListener('change', () => { optApiFilter.dataset.userSet = '1'; });
  }

  // Default API filter checkbox if game dictionary source is API
  try {
    const ds = (window.QuiddlerGame && window.QuiddlerGame.dictSource) ? window.QuiddlerGame.dictSource : (typeof dictSource !== 'undefined' ? dictSource : 'local');
    if (optApiFilter && ds === 'api') optApiFilter.checked = true;
  } catch(_){}

  function updateCommonOptions() {
    // Enable/disable frequency controls as a group
    const enabled = optCommonOnly.checked;
    optCommonOverride.disabled = !enabled;
    optZipf.disabled = !enabled;
    optCommonOverride.closest('label').classList.toggle('opacity-50', !enabled);
    optZipf.classList.toggle('opacity-50', !enabled);
  }
  optCommonOnly.addEventListener('change', updateCommonOptions);
  updateCommonOptions();

  const fmtZipf = v => Number(v).toFixed(1);
  zipfVal.textContent = fmtZipf(optZipf.value);
  optZipf.addEventListener('input', () => { zipfVal.textContent = fmtZipf(optZipf.value); });

  function cleanInt(el){ const n = Number(el.value); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; }

  playGo.addEventListener('click', onFindBestPlay);
  // Pressing Enter in the tiles input triggers Solve
  tilesInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onFindBestPlay();
    }
  });

  async function onFindBestPlay() {
    // Normalize inputs, then call the solver and render results
    const tiles = tilesInput.value.trim().replace(/[, -]+/g, '');
    const noDiscard      = !!optNoDiscard.checked;
    const commonOnly     = !!optCommonOnly.checked;
    const override2and3  = commonOnly ? !!optCommonOverride.checked : false;
    const minZipF        = commonOnly ? Number(optZipf.value) : 0;
    const currentLongest = cleanInt(optCurrentLongest);
    const currentMost    = cleanInt(optCurrentMost);
    const apiFilter      = !!optApiFilter?.checked; // RENAMED

    playStatus.textContent = 'Searching…';
    playResult.classList.remove('hidden');
    playResult.innerHTML = '';

    try {
      const result = await window.QuiddlerSolver.optimize({ tiles, noDiscard, commonOnly, override2and3, minZipF, currentLongest, currentMost, apiFilter });

      playStatus.textContent = '';

      if (result && Array.isArray(result.words) && result.words.length > 0) {
        window.QuiddlerRender.renderOptimizedPlayFromResult('playResult', result);
      } else {
        playResult.innerHTML = '<div class="text-sm text-gray-500">No playable words found.</div>';
      }
    } catch (err) {
      console.error(err);
      playStatus.textContent = '';
      playResult.innerHTML = '<div class="text-sm text-red-600">Error computing best play.</div>';
    }
  }

  // Expose a tiny public API for use elsewhere
  window.QuiddlerTools = {
    init: initToolsDrawer,
    open: openDrawer,
    close: closeDrawer,
    showDict: async (word) => {
      openDrawer();
      showTab('dict');
      if (word) { // only overwrite if a new word provided
        dictInput.value = plainWord(word);
      }
      if (dictDebounceTimer) { clearTimeout(dictDebounceTimer); dictDebounceTimer = null; }
      if (dictInput.value.trim()) {
        await renderDefinition(dictInput.value);
      }
      setTimeout(() => { dictInput?.focus(); if (word) dictInput?.select?.(); }, 0);
      const panel = document.getElementById('toolsPanelDict');
      if (panel) panel.scrollTop = 0;
    },
    showPlay: () => {
      openDrawer();
      showTab('play');
      setTimeout(() => document.getElementById('tilesInput')?.focus(), 0);
    },
    prefillPlay: ({ tiles, currentLongest, currentMost }) => {
      // Pre-populate Play Helper with a row's tiles and current opponent thresholds.
      openDrawer(); showTab('play');
      applyApiFilterDefault(); // ensure default gets applied even when opened via prefill API
      const tilesInput = document.getElementById('tilesInput');
      const optNoDiscard = document.getElementById('optNoDiscard');
      const optCurrentLongest = document.getElementById('optCurrentLongest');
      const optCurrentMost = document.getElementById('optCurrentMost');
      const playResult = document.getElementById('playResult');
      const playStatus = document.getElementById('playStatus');

      if (tilesInput) tilesInput.value = tiles ?? '';
      if (optCurrentLongest && Number.isFinite(currentLongest)) optCurrentLongest.value = String(currentLongest);
      if (optCurrentMost && Number.isFinite(currentMost))       optCurrentMost.value    = String(currentMost);
      if (optNoDiscard) optNoDiscard.checked = true;

      // If bonuses are not enabled in this game, force thresholds to 0 (ignore prefill values)
      const longestBonusEnabled = document.getElementById('longestWordBonus')?.checked;
      const mostBonusEnabled    = document.getElementById('mostWordsBonus')?.checked;
      if (!longestBonusEnabled && optCurrentLongest) optCurrentLongest.value = '0';
      if (!mostBonusEnabled && optCurrentMost)       optCurrentMost.value    = '0';

      if (playStatus) playStatus.textContent = '';
      if (playResult) {
        playResult.innerHTML = '';
        playResult.classList.add('hidden');
      }

      setTimeout(() => tilesInput?.focus(), 0);
    }
  };

  // Initialize tooltips for the drawer buttons
  if (window.tippy) {
    tippy('#dictToolBtn', { placement: 'left', animation: 'scale' });
    tippy('#optToolBtn',  { placement: 'left', animation: 'scale' });
  }
}
