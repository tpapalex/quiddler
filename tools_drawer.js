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

  function openDrawer() {
    // Slide in drawer and fade in backdrop
    drawer.classList.remove('translate-x-full');
    backdrop.classList.remove('hidden');
    void backdrop.offsetWidth; // force reflow for transition
    backdrop.classList.remove('opacity-0');
  }
  function closeDrawer() {
    // Slide out drawer and fade out backdrop
    drawer.classList.add('translate-x-full');
    backdrop.classList.add('opacity-0');
    const onEnd = () => { backdrop.classList.add('hidden'); backdrop.removeEventListener('transitionend', onEnd); };
    backdrop.addEventListener('transitionend', onEnd);
  }

  // Launchers
  document.getElementById('dictToolBtn')?.addEventListener('click', () => {
    openDrawer();
    showTab('dict');
    setTimeout(() => document.getElementById('dictInput')?.focus(), 0);
  });
  document.getElementById('optToolBtn')?.addEventListener('click', () => {
    openDrawer();
    showTab('play');
    setTimeout(() => document.getElementById('tilesInput')?.focus(), 0);
  });
  closeBtn.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeDrawer(); });

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

    // Focus appropriate input after switching tabs
    setTimeout(() => {
      if (isDict) document.getElementById('dictInput')?.focus();
      else document.getElementById('tilesInput')?.focus();
    }, 0);
  }
  tabDict.addEventListener('click', () => showTab('dict'));
  tabPlay.addEventListener('click', () => showTab('play'));
  showTab('dict');

  // ===== Dictionary (async, render <br>) =====
  const dictInput  = document.getElementById('dictInput');
  const dictGo     = document.getElementById('dictGo');
  const dictEmpty  = document.getElementById('dictEmpty');

  async function renderDefinition(word) {
    // Show local immediately; then fetch online and replace when available.
    const localWrap  = document.getElementById('dictLocalWrap');
    const localEl    = document.getElementById('dictLocal');
    const onlineWrap = document.getElementById('dictOnlineWrap');
    const onlineEl   = document.getElementById('dictOnline');
    const loadingEl  = document.getElementById('dictOnlineLoading');
    const raw = (word || '').trim();
    const cleaned = plainWord(raw);

    // No input → hide everything
    if (!cleaned) {
      localWrap?.classList.add('hidden');
      onlineWrap?.classList.add('hidden');
      loadingEl?.classList.add('hidden');
      return;
    }

    // Local: always show a section; fallback text if missing
    const local = getWordDefinitionLocal(cleaned);
    if (localWrap && localEl) {
      localEl.innerHTML = local ?? '<span class="text-gray-500">No definition found</span>';
      localWrap.classList.remove('hidden');
    }

    // If no local definition, do NOT fetch or show online
    if (!local) {
      loadingEl?.classList.add('hidden');
      onlineWrap?.classList.add('hidden');
      return;
    }

    // Prepare online area and fetch only when local exists
    onlineWrap?.classList.add('hidden');
    loadingEl?.classList.remove('hidden');

    const online = await getWordDefinitionAPI(cleaned);
    renderOnlineDict(word, online, { senseLimit: 3 });
    loadingEl?.classList.add('hidden');
  }

  async function doLookup(){ await renderDefinition(dictInput.value); }
  dictGo.addEventListener('click', doLookup);
  dictInput.addEventListener('keydown', async (e)=>{
    if (e.key === 'Enter') await doLookup();
    if (e.key === 'Escape') { dictInput.value = ''; renderDefinition(''); }
  });

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

    playStatus.textContent = 'Searching…';
    playResult.classList.remove('hidden');
    playResult.innerHTML = '';

    try {
      const result = await window.QuiddlerSolver.optimize({ tiles, noDiscard, commonOnly, override2and3, minZipF, currentLongest, currentMost });

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
      dictInput.value = plainWord(word);
      await renderDefinition(dictInput.value);
      setTimeout(() => { dictInput?.focus(); dictInput?.select?.(); }, 0);
    },
    showPlay: () => {
      openDrawer();
      showTab('play');
      setTimeout(() => document.getElementById('tilesInput')?.focus(), 0);
    },
    prefillPlay: ({ tiles, currentLongest, currentMost }) => {
      // Pre-populate Play Helper with a row's tiles and current opponent thresholds.
      openDrawer(); showTab('play');
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
