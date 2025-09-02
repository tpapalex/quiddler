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
  try { if (window.tippy && typeof tippy.hideAll === 'function') tippy.hideAll({ duration:0 }); } catch(_){ }
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
  try { if (window.tippy && typeof tippy.hideAll === 'function') tippy.hideAll({ duration:0 }); } catch(_){ }
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
  document.getElementById('searchToolBtn')?.addEventListener('click', () => {
    window.QuiddlerHideShortcuts?.();
    openDrawer();
    showTab('search');
    setTimeout(() => document.getElementById('searchInput')?.focus(), 0);
    // Lazy init indices
    try { window.WordSearch?.init?.(); } catch(_){ }
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
    } else if (k === 'k') { // Search
      window.QuiddlerHideShortcuts?.();
      e.preventDefault();
      openDrawer();
      showTab('search');
      setTimeout(() => document.getElementById('searchInput')?.focus(), 0);
      try { window.WordSearch?.init?.(); } catch(_){ }
    }
  });

  // Tabs
  const tabDict = document.getElementById('toolsTabDict');
  const tabPlay = document.getElementById('toolsTabPlay');
  const tabSearch = document.getElementById('toolsTabSearch');
  const panelDict = document.getElementById('toolsPanelDict');
  const panelPlay = document.getElementById('toolsPanelPlay');
  const panelSearch = document.getElementById('toolsPanelSearch');

  function activateTab(tabEl, active) {
    if (!tabEl) return;
    tabEl.classList.toggle('bg-white', active);
    tabEl.classList.toggle('text-gray-900', active);
    tabEl.classList.toggle('bg-gray-100', !active);
    tabEl.classList.toggle('text-gray-600', !active);
  }

  function showTab(which) {
    const isDict = which === 'dict';
    const isPlay = which === 'play';
    const isSearch = which === 'search';
    if (panelDict) panelDict.classList.toggle('hidden', !isDict);
    if (panelPlay) panelPlay.classList.toggle('hidden', !isPlay);
    if (panelSearch) panelSearch.classList.toggle('hidden', !isSearch);
    activateTab(tabDict, isDict);
    activateTab(tabPlay, isPlay);
    activateTab(tabSearch, isSearch);

    setTimeout(() => {
      const isOpen = !drawer.classList.contains('translate-x-full');
      if (!isOpen) return;
      if (isDict) document.getElementById('dictInput')?.focus();
      else if (isPlay) document.getElementById('tilesInput')?.focus();
      else if (isSearch) {
        const first = document.querySelector('#searchRows .ws-input');
        if(first){ first.focus(); try { first.select(); } catch(_){ } }
      }
    }, 0);

    if (which === 'play') {
      applyApiFilterDefault();
    }
    if (which === 'search') {
      try { window.WordSearch?.init?.(); } catch(_){ }
  // Sync sort dropdown width now that panel is visible
  setTimeout(()=>{ window.syncSearchSortWidth?.(); }, 0);
  requestAnimationFrame(()=>{ window.syncSearchSortWidth?.(); });
    }
  }
  tabDict?.addEventListener('click', () => showTab('dict'));
  tabPlay?.addEventListener('click', () => showTab('play'));
  tabSearch?.addEventListener('click', () => showTab('search'));
  showTab('dict');

  // ===== Dictionary (async, render <br>) =====
  const dictInput  = document.getElementById('dictInput');
  const dictEmpty  = document.getElementById('dictEmpty');
  const LAST_DICT_WORD_KEY = 'quiddlerLastDictWord'; // NEW persistence key
  const LAST_DICT_API_JSON_KEY = 'quiddlerLastDictApiJson'; // cache last successful Free Dictionary API JSON
  // Register validation (letters only, single word)
  (function registerDictValidation(){
    if (!dictInput) return;
    function validateDictWord(val){
      const v = (val||'').trim();
      if (!v) return { status:'ok' }; // pristine/empty fine
      if (/\s/.test(v)) return { status:'error', message:'Single word only' };
      if (!/^[A-Za-z]+$/.test(v)) return { status:'error', message:'Letters A-Z only' };
      return { status:'ok' };
    }
    function doRegister(){
      try {
        if (!window.InputValidation) return false;
        window.InputValidation.register({
          selector: '#dictInput',
            validate: (value, el) => validateDictWord(value),
          allowed: /[A-Za-z]/g, // filters out spaces, digits, punctuation
          debounceMs: 300,
          groupId: 'dictionary',
          dynamic: false,
          showTooltipOn: 'hover+focus',
          autoValidateOnLoad: false,
          onStateChange: (el, prev, next) => { el.dataset.ivStateDict = next; }
        });
        return true;
      } catch { return false; }
    }
    if (!doRegister()) {
      document.addEventListener('DOMContentLoaded', doRegister, { once:true });
    }
    // Expose for potential reuse
    window.QuiddlerValidation = window.QuiddlerValidation || {};
    window.QuiddlerValidation.validateDictWord = validateDictWord;
  })();
  // Debounce timer so we don't fetch on every keystroke
  let dictDebounceTimer = null;
  const DICT_DEBOUNCE_MS = 350;
  // Track last value actually processed so filtered (unchanged) keystrokes don't re-trigger lookups
  let __lastDictInputValue = dictInput ? dictInput.value : '';
  // Track last looked-up cleaned word to suppress redundant Enter lookups
  let __lastLookedUpWord = '';
  // Burst gate to coalesce rapid successive input events (e.g. paste bursts)
  let dictBurstTimer = null;
  const DICT_BURST_WINDOW_MS = 30;

  async function renderDefinition(word) {
    const localWrap  = document.getElementById('dictLocalWrap');
    const localEl    = document.getElementById('dictLocal');
    const onlineWrap = document.getElementById('dictOnlineWrap');
    const onlineEl   = document.getElementById('dictOnline');
  const localToggle = document.getElementById('dictLocalToggle');
  const onlineToggle= document.getElementById('dictOnlineToggle');
    const loadingEl  = document.getElementById('dictOnlineLoading');
    const emptyHint  = document.getElementById('dictEmpty');
    const raw = (word || '').trim();
    const cleaned = plainWord(raw);

    if (!cleaned) {
      // Clear persisted key when user empties input intentionally
      try { if (!raw) localStorage.removeItem(LAST_DICT_WORD_KEY); } catch(_){ }
  try { localStorage.removeItem(LAST_DICT_API_JSON_KEY); } catch(_){ }
      localWrap?.classList.add('hidden');
      onlineWrap?.classList.add('hidden');
      loadingEl?.classList.add('hidden');
      // Keep the hint always visible now (no hide/show toggle)
      return;
    }
  // Persist last successful cleaned lookup
  try { localStorage.setItem(LAST_DICT_WORD_KEY, cleaned); } catch(_){ }
  __lastLookedUpWord = cleaned;
    // Hint remains visible even while showing definitions

    // Prepare lazy tracking state for this new lookup
    // (Will be initialized if lazy helpers exist, otherwise no-op)
    if (window.__dictLazy) {
      window.__dictLazy.local = { word: cleaned, done: false };
      window.__dictLazy.online = { word: cleaned, done: false };
    }

    const isLocalCollapsed  = (window.__dictSectionState?.local === 'collapsed');
    const isOnlineCollapsed = (window.__dictSectionState?.online === 'collapsed');

    // Local dictionary (lazy if collapsed)
    if (localWrap && localEl) {
      localWrap.classList.remove('hidden');
      if (isLocalCollapsed) {
        localEl.innerHTML = ''; // defer rendering until expanded
      } else {
        window.__fetchLocalDefinition ? window.__fetchLocalDefinition(cleaned) : null;
      }
    }

    // Online dictionary (lazy if collapsed)
    if (onlineWrap && onlineEl) {
      onlineWrap.classList.remove('hidden');
      if (isOnlineCollapsed) {
        onlineEl.innerHTML = '';
        loadingEl?.classList.add('hidden');
      } else {
        // Try cached JSON first (avoids refetch on reload)
        let usedCache = false;
        try {
          const rawCache = localStorage.getItem(LAST_DICT_API_JSON_KEY);
          if (rawCache) {
            const parsed = JSON.parse(rawCache);
            if (parsed && parsed.w && parsed.w.toLowerCase() === cleaned.toLowerCase() && parsed.d) {
              // Render from cache
              try { renderOnlineDict(cleaned, parsed.d, { senseLimit: 3 }); usedCache = true; } catch(_){}
              // Mark lazy state done
              if (window.__dictLazy && window.__dictLazy.online) { window.__dictLazy.online.done = true; window.__dictLazy.online.word = cleaned; }
            }
          }
        } catch(_){ }
        if (!usedCache) {
          window.__fetchOnlineDefinition ? window.__fetchOnlineDefinition(cleaned) : null;
        }
      }
    }
    // Apply current expand/collapse state after new content inserted
    applyDictSectionStates();
  }

  async function doLookup(){ await renderDefinition(dictInput.value); }

  // If an older cached HTML still has the button, keep this safe-guarded listener
  const dictGo = document.getElementById('dictGo');
  if (dictGo) dictGo.addEventListener('click', doLookup);

  // --- Collapse / Expand state management ---
  const DICT_SECTION_STATE_KEY = 'quiddlerDictSectionState';
  // Load persisted collapse state (fallback to expanded)
  let persistedState = null;
  try { persistedState = JSON.parse(localStorage.getItem(DICT_SECTION_STATE_KEY)||'null'); } catch(_){ }
  const dictSectionState = {
    local: (persistedState && (persistedState.local==='collapsed'||persistedState.local==='expanded')) ? persistedState.local : 'expanded',
    online:(persistedState && (persistedState.online==='collapsed'||persistedState.online==='expanded')) ? persistedState.online : 'expanded'
  }; // session + persisted
  window.__dictSectionState = dictSectionState; // expose for lazy helpers
  // Lazy lookup tracking
  window.__dictLazy = { local:{ word:'', done:false }, online:{ word:'', done:false } };

  // Helper: local definition (synchronous lookup + parse) respecting current requested word
  window.__fetchLocalDefinition = function(word){
    const lazy = window.__dictLazy?.local; if (!lazy) return; lazy.word = word; lazy.done = false;
    const wrap = document.getElementById('dictLocalWrap');
    const el   = document.getElementById('dictLocal');
    if (!wrap || !el) return;
    const raw = getWordDefinitionLocal(word);
  let html = '<span class="text-gray-500 mt-2 block">No definition found.</span>';
    if (raw) {
      try {
        const parsed = (typeof parseCollinsEntry === 'function') ? parseCollinsEntry(word) : (window.CollinsParsing?.parseCollinsEntry?.(word));
        if (parsed && typeof renderParsedCollins === 'function') html = renderParsedCollins(parsed); else html = raw;
      } catch(_) { html = raw; }
    }
    // If word changed mid-processing, abort
    if (lazy.word !== word) return;
    el.innerHTML = html;
    wrap.classList.remove('hidden');
    lazy.done = true;
  };

  // Helper: online definition (async fetch) respecting current requested word
  window.__fetchOnlineDefinition = async function(word){
    const lazy = window.__dictLazy?.online; if (!lazy) return; lazy.word = word; lazy.done=false;
    const wrap = document.getElementById('dictOnlineWrap');
    const el   = document.getElementById('dictOnline');
    const loading = document.getElementById('dictOnlineLoading');
    if (!wrap || !el || !loading) return;
    el.innerHTML = '';
    loading.classList.remove('hidden');
    wrap.classList.remove('hidden');
    const requestWord = word;
    // Abort any prior in-flight fetch (best-effort) if getWordDefinitionAPI supports AbortController
    if (window.__dictOnlineAbort) { try { window.__dictOnlineAbort.abort(); } catch(_){} }
    let abortCtrl = null;
    if (typeof AbortController !== 'undefined') {
      try { abortCtrl = new AbortController(); } catch(_) { abortCtrl = null; }
    }
    window.__dictOnlineAbort = abortCtrl;
    try {
      const apiFn = getWordDefinitionAPI;
      const apiRes = abortCtrl ? await apiFn(word, { signal: abortCtrl.signal }) : await apiFn(word);
      const { found, error, data } = apiRes || {};
      if (window.__dictLazy?.online.word !== requestWord) return; // outdated
      if (!error && found && data) {
        renderOnlineDict(word, data, { senseLimit: 3 });
        wrap.classList.remove('hidden');
          // Cache last successful JSON (structure: { w: word, d: data })
          try { localStorage.setItem(LAST_DICT_API_JSON_KEY, JSON.stringify({ w: word, d: data })); } catch(_){ }
      } else {
  el.innerHTML = '<span class="text-gray-500 mt-2 block">No definition found.</span>';
      }
    } catch(err) {
      const aborted = err && (err.name === 'AbortError');
      if (aborted) return; // silently ignore
      if (window.__dictLazy?.online.word === requestWord) {
        el.innerHTML = '<span class="text-gray-500">Lookup unavailable</span>';
      }
        try { localStorage.removeItem(LAST_DICT_API_JSON_KEY); } catch(_){ }
    } finally {
      if (window.__dictLazy?.online.word === requestWord) {
        loading.classList.add('hidden');
        lazy.done = true;
      }
      if (window.__dictOnlineAbort === abortCtrl) window.__dictOnlineAbort = null;
    }
  };

  function toggleSection(kind){
  const wrap   = kind==='local' ? document.getElementById('dictLocalWrap') : document.getElementById('dictOnlineWrap');
  const bodyEl = kind==='local' ? document.getElementById('dictLocal')    : document.getElementById('dictOnline');
  const loadingEl = kind==='online' ? document.getElementById('dictOnlineLoading') : null;
    const btn    = kind==='local' ? document.getElementById('dictLocalToggle') : document.getElementById('dictOnlineToggle');
    if (!wrap || !bodyEl || !btn) return;
    const cur = dictSectionState[kind] || 'expanded';
    const next = cur === 'expanded' ? 'collapsed' : 'expanded';
    dictSectionState[kind] = next;
  // Persist
  try { localStorage.setItem(DICT_SECTION_STATE_KEY, JSON.stringify(dictSectionState)); } catch(_){ }
    if (next === 'collapsed') {
      bodyEl.classList.add('hidden');
      loadingEl?.classList.add('hidden');
      btn.textContent = 'Expand';
    } else {
      bodyEl.classList.remove('hidden');
      // Only show loading if currently in a lookup state (has hidden class removed separately in renderDefinition)
      if (kind==='online' && document.getElementById('dictOnline')?.innerHTML.trim()==='') {
        loadingEl?.classList.remove('hidden');
      }
      btn.textContent = 'Collapse';
      // Perform deferred lookup if needed
      if (window.__dictLazy && !window.__dictLazy[kind].done && window.__dictLazy[kind].word) {
        if (kind==='local') window.__fetchLocalDefinition(window.__dictLazy.local.word);
        else window.__fetchOnlineDefinition(window.__dictLazy.online.word);
      }
    }
  }
  function applyDictSectionStates(){
    ['local','online'].forEach(kind => {
  const bodyEl = kind==='local' ? document.getElementById('dictLocal') : document.getElementById('dictOnline');
  const btn    = kind==='local' ? document.getElementById('dictLocalToggle') : document.getElementById('dictOnlineToggle');
  const loadingEl = kind==='online' ? document.getElementById('dictOnlineLoading') : null;
      if (!bodyEl || !btn) return;
      const state = dictSectionState[kind] || 'expanded';
      if (state === 'collapsed') {
        bodyEl.classList.add('hidden');
        loadingEl?.classList.add('hidden');
        btn.textContent = 'Expand';
      } else {
        bodyEl.classList.remove('hidden');
        btn.textContent = 'Collapse';
      }
    });
  }
  document.getElementById('dictLocalToggle')?.addEventListener('click', ()=>toggleSection('local'));
  document.getElementById('dictOnlineToggle')?.addEventListener('click', ()=>toggleSection('online'));

  // Auto-lookup with burst + debounce on input changes
  dictInput.addEventListener('input', () => {
    const val = dictInput.value || '';
    if (val === __lastDictInputValue) return; // no effective change
    __lastDictInputValue = val;
    if (dictDebounceTimer) { clearTimeout(dictDebounceTimer); dictDebounceTimer = null; }
    if (dictBurstTimer) { clearTimeout(dictBurstTimer); dictBurstTimer = null; }
    if (!val.trim()) { renderDefinition(''); return; }
    // Start short burst window; after quiet, start main debounce
    dictBurstTimer = setTimeout(() => {
      dictBurstTimer = null;
      dictDebounceTimer = setTimeout(() => { doLookup(); }, DICT_DEBOUNCE_MS);
    }, DICT_BURST_WINDOW_MS);
  });

  dictInput.addEventListener('keydown', async (e)=>{
    if (e.key === 'Enter') {
      const val = (dictInput.value || '').trim();
      const same = val && val.toLowerCase() === (__lastLookedUpWord||'').toLowerCase();
      if (same && !dictDebounceTimer && !dictBurstTimer) { e.preventDefault(); return; }
      if (dictDebounceTimer) { clearTimeout(dictDebounceTimer); dictDebounceTimer = null; }
      if (dictBurstTimer) { clearTimeout(dictBurstTimer); dictBurstTimer = null; }
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
  // (Common-only / Zipf filtering controls removed from UI)
  const optCurrentLongest = document.getElementById('optCurrentLongest');
  const optCurrentMost    = document.getElementById('optCurrentMost');
  const playGo            = document.getElementById('playGo');
  const playReset         = document.getElementById('playReset');
  // Status now lives inside the button (spinner + label)
  const playStatus        = null;
  const playGoLabel       = document.getElementById('playGoLabel');
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

  // Frequency filtering options removed

  // === Validation for solver tiles input ===
  // Migrated: solver tiles input now uses generic InputValidation framework (same rules as player words)
  (function registerSolverTilesValidation(){
    if (!tilesInput) return;
    // Reuse core player word validation logic to avoid divergence; add solver-specific rack size warning.
    function validateSolverRack(text){
      const baseFn = window.QuiddlerValidation?.validatePlayerWords;
      const trimmed = (text||'').trim(); if(!trimmed) return { status:'ok' };
      // Pass suppressSingleDigraphWarning to avoid solver showing that player-only warning
      let res = baseFn ? baseFn(trimmed, { suppressSingleDigraphWarning:true }) : { status:'ok' }; // no expectedCards context
      // If base produced an error/warning, keep it unless we want to append rack-size warning (prefer not to stack messages for now)
      if (res.status === 'ok') {
        try {
          const matches = trimmed.match(/\([a-zA-Z]+\)|[a-zA-Z]/g) || [];
          const cardCount = matches.length; // digraph counts as one (regex matches whole paren group)
          if (cardCount > 15) res = { status:'warning', message:'Large rack size. Solver may time out' };
        } catch {}
      }
      return res || { status:'ok' };
    }
    function doRegister(){
      if (!window.InputValidation) return false;
      try {
        window.InputValidation.register({
          selector: '#tilesInput',
          validate: validateSolverRack,
          allowed: /[a-zA-Z\s\-()]/g,
          debounceMs: 700,
          groupId: 'solver',
          dynamic: false,
          showTooltipOn: 'hover+focus',
          autoValidateOnLoad: false,
          onStateChange: (el, prev, next) => { el.dataset.ivStateSolver = next; }
        });
        return true;
      } catch { return false; }
    }
    if (!doRegister()) document.addEventListener('DOMContentLoaded', doRegister, { once:true });
    window.QuiddlerValidation = window.QuiddlerValidation || {};
    window.QuiddlerValidation.validateSolverRack = validateSolverRack;
  })();

  // Zipf slider/value removed

  function cleanInt(el){ const n = Number(el.value); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; }

  playGo.addEventListener('click', onFindBestPlay);
  if (playReset) {
    playReset.addEventListener('click', () => {
      if (tilesInput) { tilesInput.value = ''; try { window.InputValidation?.validateElement?.(tilesInput); } catch(_){} }
      if (optNoDiscard) optNoDiscard.checked = false;
      if (optApiFilter) optApiFilter.checked = false;
      if (optCurrentLongest) optCurrentLongest.value = '0';
      if (optCurrentMost)    optCurrentMost.value    = '0';
      if (playResult) { playResult.innerHTML=''; playResult.classList.add('hidden'); }
      tilesInput?.focus();
    });
  }
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
  // Frequency filtering no longer available
    const currentLongest = cleanInt(optCurrentLongest);
    const currentMost    = cleanInt(optCurrentMost);
    const apiFilter      = !!optApiFilter?.checked; // RENAMED
    // Show solving indicator & disable button to avoid re-entry
    if (playGo) {
      playGo.disabled = true;
      playGo.classList.add('opacity-60','pointer-events-none');
      playGo.setAttribute('aria-busy','true');
      if (playGoLabel) playGoLabel.textContent = 'Solving…';
    }
    playResult.classList.remove('hidden');
    playResult.innerHTML = '';

  // Yield to the browser so the Solving… text & disabled state can paint before heavy sync work.
  // Using double rAF fallback to ensure a paint even on slower devices.
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    try {
      // 10s timeout wrapper
      const TIMEOUT_MS = 10000; 
      let timedOut = false;
      const result = await Promise.race([
  window.QuiddlerSolver.optimize(tiles, { noDiscard, currentLongest, currentMost, apiFilter }),
        new Promise(res => setTimeout(()=>{ timedOut = true; res(null); }, TIMEOUT_MS))
      ]);

      if (playGo) {
        playGo.disabled = false;
        playGo.classList.remove('opacity-60','pointer-events-none');
        playGo.removeAttribute('aria-busy');
        if (playGoLabel) playGoLabel.textContent = 'Solve';
      }

      if (timedOut) {
        playResult.innerHTML = '<div class="text-sm text-red-600">Solver took too long. Try a smaller rack.</div>';
      } else if (result && result._timedOut) {
        playResult.innerHTML = '<div class="text-sm text-red-600">Solver took too long. Try a smaller rack.</div>';
      } else if (result && Array.isArray(result.words) && result.words.length > 0) {
        window.QuiddlerRender.renderOptimizedPlayFromResult('playResult', result);
      } else {
        playResult.innerHTML = '<div class="text-sm text-red-600">No playable words found.</div>';
      }
    } catch (err) {
      console.error(err);
      if (playGo) {
        playGo.disabled = false;
        playGo.classList.remove('opacity-60','pointer-events-none');
        playGo.removeAttribute('aria-busy');
        if (playGoLabel) playGoLabel.textContent = 'Solve';
      }
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
    showSearch: () => {
      openDrawer();
      showTab('search');
      setTimeout(() => document.getElementById('searchInput')?.focus(), 0);
      try { window.WordSearch?.init?.(); } catch(_){ }
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

  // No external status span now.
      if (playResult) {
        playResult.innerHTML = '';
        playResult.classList.add('hidden');
      }
      // Force a revalidation (hard) after value injection so any warnings/errors show immediately.
      setTimeout(() => {
        if (tilesInput) {
          try { window.InputValidation?.validateElement?.(tilesInput); } catch(_){ }
          tilesInput.focus();
          try { tilesInput.select(); } catch(_){}
        }
      }, 0);
    }
  };

  // Initialize tooltips for the drawer buttons
  if (window.tippy) {
    tippy('#dictToolBtn', { placement: 'left', animation: 'scale' });
    tippy('#optToolBtn',  { placement: 'left', animation: 'scale' });
  tippy('#searchToolBtn', { placement: 'left', animation: 'scale' });
    tippy('#newGameBtn',  { placement: 'left', animation: 'scale' }); // NEW
  }
}
