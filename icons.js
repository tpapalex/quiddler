// icons.js — central icon mapping & helpers
// Provides: window.QuiddlerIcons.paths, .img(name, classes), .apply(root)
// Usage patterns:
// 1. Static markup: <span data-icon="dictionary" data-icon-classes="w-7 h-7 invert"></span>
//    After DOMContentLoaded, .apply() injects the <img>.
// 2. JS generation: window.QuiddlerIcons.img('dictionary', 'w-4 h-4')
// 3. Re-run apply() on dynamic containers if you add data-icon nodes later.
(function(){
  const paths = {
    dictionary: 'icons/book-open.svg',
    search: 'icons/adjustments-horizontal.svg',
    solver: 'icons/beaker.svg',
    refresh: 'icons/arrow-path.svg',
    collapse: 'icons/chevron-up.svg',
    // Additional available icon assets (not yet wired everywhere):
    play: 'icons/play.svg',
    forward: 'icons/forward.svg',
    settings: 'icons/cog-6-tooth.svg'
  };

  function img(name, classes=''){ const src = paths[name]; if(!src) return ''; return `<img src="${src}" alt="" class="${classes}"/>`; }

  function apply(root=document){
    if(!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-icon]')?.forEach(el => {
      // Skip if already populated (allows reapply without duplication)
      if (el.dataset.iconApplied === '1') return;
      const name = el.getAttribute('data-icon');
      const classes = el.getAttribute('data-icon-classes') || '';
      if(!name) return;
      const html = img(name, classes);
      if(html){ el.innerHTML = html; el.dataset.iconApplied = '1'; }
    });
  }

  // Expose namespace
  window.QuiddlerIcons = Object.assign({}, window.QuiddlerIcons || {}, { paths, img, apply });

  // Auto apply after DOM ready (covers static markup). If script loaded after ready, run immediately.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply());
  } else {
    try { apply(); } catch(_){ }
  }
})();
