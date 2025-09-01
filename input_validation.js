// Generic input validation module
// Provides debounced soft validation + hard validation on blur for arbitrary text inputs.
// Usage: InputValidation.register({
//   selector: '.player-words',
//   validate: (value)=> ({ ok:true } | { ok:false, error:'msg' }),
//   allowed: /[a-zA-Z\s\-()]/g,          // regex OR function(event, el, prev) -> filteredValue
//   debounceMs: 700,
//   groupId: 'players',
//   dynamic: true,                        // watch for future matching nodes
//   showTooltipOn: 'hover',               // 'hover' | 'hover+focus' | 'never'
//   errorClass: 'ws-error',
//   autoValidateOnLoad: true,             // run hard validation once after attach
//   onStateChange: (el, prev, next)=>{},
// });
(function(){
  if (typeof window === 'undefined') return;
  const registry = new Map();               // element -> meta
  const groups = new Map();                 // groupId -> Set(elements)
  let observer = null;
  let nextId = 1;

  function ensureObserver(){
    if (observer) return;
    observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type !== 'childList') continue;
        if (m.addedNodes) {
          m.addedNodes.forEach(n=>{ if (n.nodeType===1) scanNode(n); });
        }
        if (m.removedNodes) {
          m.removedNodes.forEach(n=>{ if (n.nodeType===1) cleanupRemoved(n); });
        }
      }
    });
    observer.observe(document.documentElement || document.body, { childList:true, subtree:true });
  }

  function scanNode(root){
    pendingConfigs.forEach(cfg => {
      if (!cfg.dynamic) return;
      if (!root.matches || !root.querySelectorAll) return;
      if (root.matches(cfg.selector)) attachOne(root, cfg);
      root.querySelectorAll(cfg.selector).forEach(el=>attachOne(el, cfg));
    });
  }

  function cleanupRemoved(root){
    // If a registered element is removed, destroy its tooltip and timers
    registry.forEach((meta, el) => {
      if (!document.contains(el)) destroyElement(el);
    });
  }

  function destroyElement(el){
    const meta = registry.get(el); if(!meta) return;
    if (meta.timer) clearTimeout(meta.timer);
    if (el._tippy) { try { el._tippy.hide(); } catch(_){} try { el._tippy.destroy(); } catch(_){} }
    if (meta.groupId && groups.has(meta.groupId)) groups.get(meta.groupId).delete(el);
    registry.delete(el);
  }

  function filterValue(el, cfg, prev, ev){
    if (!cfg.allowed) return el.value;
    if (typeof cfg.allowed === 'function') {
      try { return cfg.allowed(el.value, prev, ev); } catch { return el.value; }
    }
    const re = cfg.allowed; // regex
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const filteredFull = (el.value.match(re) || []).join('');
    const filteredBefore = (before.match(re) || []).join('');
    if (filteredFull !== el.value) {
      el.value = filteredFull;
      const pos = filteredBefore.length; try { el.setSelectionRange(pos,pos); } catch(_){}
    }
    return el.value;
  }

  function clearError(el, meta){
    el.classList.remove(meta.errorClass);
    if (el._tippy) { try { el._tippy.hide(); } catch(_){} try { el._tippy.destroy(); } catch(_){} }
    setState(el, meta, el.value.trim()? 'valid':'pristine');
  }
  function showError(el, meta, msg){
    el.classList.add(meta.errorClass);
    setState(el, meta, 'invalid');
    if (meta.showTooltipOn === 'never') return;
    if (window.tippy) {
      if (el._tippy) { el._tippy.setContent(msg); }
      else {
        const trigger = meta.showTooltipOn === 'hover+focus' ? 'mouseenter focus' : 'mouseenter';
        tippy(el, { content:msg, animation:'scale', placement:'bottom', theme:'plain', trigger, hideOnClick:true, delay:[120,80] });
      }
      if (el._tippy && el.matches(':hover')) { try { el._tippy.show(); } catch(_){} }
    } else el.title = msg;
  }
  function softValidate(el, meta){
    const val = el.value.trim(); if (!val){ clearError(el, meta); return; }
    const res = safeValidate(meta.validate, val); if (res.ok) { clearError(el, meta); } else { showError(el, meta, res.error || 'Invalid'); }
  }
  function hardValidate(el, meta){
    const val = el.value.trim(); if (!val){ clearError(el, meta); return true; }
    const res = safeValidate(meta.validate, val); if (res.ok) { clearError(el, meta); return true; }
    showError(el, meta, res.error || 'Invalid'); return false;
  }
  function safeValidate(fn, val){
    try { return fn(val) || { ok:true }; } catch(e){ return { ok:false, error: e && e.message || 'Invalid' }; }
  }
  function setState(el, meta, next){
    const prev = el.dataset.ivState || 'pristine';
    if (prev === next) return;
    el.dataset.ivState = next;
    if (meta.onStateChange) { try { meta.onStateChange(el, prev, next); } catch(_){} }
  }

  const pendingConfigs = [];

  function attachOne(el, cfg){
    if (registry.has(el)) return;
    const meta = {
      id: nextId++, cfg, groupId: cfg.groupId, validate: cfg.validate || (v=>({ok:true})), allowed: cfg.allowed,
      debounceMs: cfg.debounceMs ?? 700, showTooltipOn: cfg.showTooltipOn || 'hover', errorClass: cfg.errorClass || 'ws-error',
      onStateChange: cfg.onStateChange
    };
    registry.set(el, meta);
    if (meta.groupId){ if(!groups.has(meta.groupId)) groups.set(meta.groupId, new Set()); groups.get(meta.groupId).add(el); }
    setState(el, meta, 'pristine');

    el.addEventListener('input', ev => {
      const prev = el.value; filterValue(el, meta.cfg, prev, ev);
      if (el.dataset.ivState === 'invalid') clearError(el, meta); // clear style while editing
      setState(el, meta, 'dirty');
      if (meta.timer) clearTimeout(meta.timer);
      meta.timer = setTimeout(()=>{ if(document.contains(el)) softValidate(el, meta); }, meta.debounceMs);
    });
    el.addEventListener('blur', ()=>{ if (meta.timer) { clearTimeout(meta.timer); meta.timer=null; } hardValidate(el, meta); });

    if (cfg.autoValidateOnLoad) { setTimeout(()=>{ if(document.contains(el)) hardValidate(el, meta); }, 0); }
  }

  function register(cfg){
    pendingConfigs.push(cfg);
    // Attach to existing elements immediately
    document.querySelectorAll(cfg.selector).forEach(el=>attachOne(el,cfg));
    if (cfg.dynamic) ensureObserver();
    const handle = {
      config: cfg,
      elements: () => Array.from(groups.get(cfg.groupId)||[]),
      forceHard: () => handle.elements().reduce((ok,el)=> hardValidate(el, registry.get(el)) && ok, true),
      destroy: () => { handle.elements().forEach(el=>destroyElement(el)); if (cfg.groupId) groups.delete(cfg.groupId); }
    };
    return handle;
  }

  function validateGroup(groupId){
    const els = groups.get(groupId); if(!els) return true; let allOk=true; els.forEach(el=>{ if(!hardValidate(el, registry.get(el)) && allOk){ try { el.focus(); el.select?.(); } catch(_){} allOk=false; } }); return allOk; }
  function anyInvalid(groupId){ const els=groups.get(groupId); if(!els) return false; for(const el of els){ if((el.dataset.ivState==='invalid')) return true; } return false; }

  window.InputValidation = { register, validateGroup, anyInvalid };
})();
