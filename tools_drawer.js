function initToolsDrawer(){
  const drawer   = document.getElementById('toolsDrawer');
  const closeBtn = document.getElementById('toolsCloseBtn');
  const backdrop = document.getElementById('toolsBackdrop');

  function openDrawer() {
    drawer.classList.remove('translate-x-full');
    backdrop.classList.remove('hidden');
    void backdrop.offsetWidth; // force reflow for transition
    backdrop.classList.remove('opacity-0');
  }
  function closeDrawer() {
    drawer.classList.add('translate-x-full');
    backdrop.classList.add('opacity-0');
    const onEnd = () => { backdrop.classList.add('hidden'); backdrop.removeEventListener('transitionend', onEnd); };
    backdrop.addEventListener('transitionend', onEnd);
  }

  document.getElementById('dictToolBtn')?.addEventListener('click', () => {
    openDrawer();
    showTab('dict');
  });
  document.getElementById('optToolBtn')?.addEventListener('click', () => {
    openDrawer();
    showTab('play');
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
  }
  tabDict.addEventListener('click', () => showTab('dict'));
  tabPlay.addEventListener('click', () => showTab('play'));
  showTab('dict');

  // ===== Dictionary (async, render <br>) =====
  const dictInput  = document.getElementById('dictInput');
  const dictGo     = document.getElementById('dictGo');
  const dictEmpty  = document.getElementById('dictEmpty');

  async function renderDefinition(word) {
    const localWrap  = document.getElementById('dictLocalWrap');
    const localEl    = document.getElementById('dictLocal');
    const onlineWrap = document.getElementById('dictOnlineWrap');
    const onlineEl   = document.getElementById('dictOnline');
    const loadingEl  = document.getElementById('dictOnlineLoading');
    const w = (word || '').trim();

    // No input → hide everything
    if (!w) {
      localWrap?.classList.add('hidden');
      onlineWrap?.classList.add('hidden');
      loadingEl?.classList.add('hidden');
      return;
    }

    // Local: always show a section; fallback text if missing
    const local = getWordDefinitionLocal(w);
    if (localWrap && localEl) {
      localEl.innerHTML = local ?? '<span class="text-gray-500">No definition found</span>';
      localWrap.classList.remove('hidden');
    }

    // Prepare online area
    onlineWrap?.classList.add('hidden');
    loadingEl?.classList.remove('hidden');

    // Fetch online
    const online = await getWordDefinitionAPI(w);

    // Update online section
    loadingEl?.classList.add('hidden');
    if (online && onlineEl && onlineWrap) {
      onlineEl.innerHTML = online; // supports <br>
      onlineWrap.classList.remove('hidden');
    } else {
      onlineWrap?.classList.add('hidden');
    }
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

  async function onFindBestPlay() {
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
      const result = await optimize({ tiles, noDiscard, commonOnly, override2and3, minZipF, currentLongest, currentMost });

      playStatus.textContent = '';

      if (result && Array.isArray(result.words) && result.words.length > 0) {
        renderOptimizedPlayFromResult('playResult', result);
      } else {
        playResult.innerHTML = '<div class="text-sm text-gray-500">No playable words found.</div>';
      }
    } catch (err) {
      console.error(err);
      playStatus.textContent = '';
      playResult.innerHTML = '<div class="text-sm text-red-600">Error computing best play.</div>';
    }
  }

  async function optimize({ tiles, noDiscard, commonOnly, override2and3, minZipF, currentLongest, currentMost }) {
    const rack = parseCards(tiles).map(w => w.replace(/[()]/g, '').toLowerCase());
    const rackCounts = countRack(rack, DIGRAPHS);

    const lemmatizer = window.winkLemmatizer;
    const commonGate = commonOnly
      ? makeCommonGateFromEntries(wordFreq, { mode: 'zipf', override2and3, minZipF }, lemmatizer)
      : null;

    const trie = buildTrie(Object.keys(validWordsMap), maxRound);

    const candidates = generateWordCandidates(trie, rackCounts, 2, { commonGate });

    const bestplay = chooseBestPlay(candidates, rackCounts, {
      noDiscard,
      currentLongest: currentLongest === 0 ? Infinity : currentLongest,
      currentMost:    currentMost    === 0 ? Infinity : currentMost,
      longestBonus: longestWordPoints,
      mostBonus:    mostWordsPoints,
    });

    return bestplay;
  }

  // Expose a tiny public API for use elsewhere
  window.QuiddlerTools = {
    open: openDrawer,
    close: closeDrawer,
    showDict: async (word) => {
      openDrawer();
      showTab('dict');
      dictInput.value = (word || '').replace(/[()]/g, '');
      await renderDefinition(dictInput.value);
    },
    showPlay: () => {
      openDrawer();
      showTab('play');
    },
    prefillPlay: ({ tiles, currentLongest, currentMost }) => {
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
