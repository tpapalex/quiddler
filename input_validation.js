// Generic input validation module
// Provides debounced soft validation + hard validation on blur for arbitrary text inputs.
// Usage: InputValidation.register({
//   selector: '.player-words',
//   validate: (value)=> ({ status:'ok' } | { status:'warning', message:'msg' } | { status:'error', message:'msg' })
//   allowed: /[a-zA-Z\s\-()]/g,          // regex OR function(event, el, prev) -> filteredValue
//   debounceMs: 700,
//   groupId: 'players',
//   dynamic: true,                        // watch for future matching nodes
//   showTooltipOn: 'hover',               // 'hover' | 'hover+focus' | 'never'
//   errorClass: 'ws-error',
//   autoValidateOnLoad: true,             // run hard validation once after attach
//   onStateChange: (el, prev, next)=>{},
// });
(function () {
  if (typeof window === "undefined") return;
  const registry = new Map(); // element -> meta
  const groups = new Map(); // groupId -> Set(elements)
  let observer = null;
  let nextId = 1;

  function ensureObserver() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type !== "childList") continue;
        if (m.addedNodes) {
          m.addedNodes.forEach((n) => {
            if (n.nodeType === 1) scanNode(n);
          });
        }
        if (m.removedNodes) {
          m.removedNodes.forEach((n) => {
            if (n.nodeType === 1) cleanupRemoved(n);
          });
        }
      }
    });
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  }

  function scanNode(root) {
    pendingConfigs.forEach((cfg) => {
      if (!cfg.dynamic) return;
      if (!root.matches || !root.querySelectorAll) return;
      if (root.matches(cfg.selector)) attachOne(root, cfg);
      root.querySelectorAll(cfg.selector).forEach((el) => attachOne(el, cfg));
    });
  }

  function cleanupRemoved(root) {
    // If a registered element is removed, destroy its tooltip and timers
    registry.forEach((meta, el) => {
      if (!document.contains(el)) destroyElement(el);
    });
  }

  function destroyElement(el) {
    const meta = registry.get(el);
    if (!meta) return;
    if (meta.timer) clearTimeout(meta.timer);
    if (el._tippy) {
      try {
        el._tippy.hide();
      } catch (_) {}
      try {
        el._tippy.destroy();
      } catch (_) {}
    }
    if (meta.groupId && groups.has(meta.groupId))
      groups.get(meta.groupId).delete(el);
    registry.delete(el);
  }

  function filterValue(el, cfg, prev, ev) {
    if (!cfg.allowed) return el.value;
    if (typeof cfg.allowed === "function") {
      try {
        return cfg.allowed(el.value, prev, ev);
      } catch {
        return el.value;
      }
    }
    const re = cfg.allowed; // regex
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const filteredFull = (el.value.match(re) || []).join("");
    const filteredBefore = (before.match(re) || []).join("");
    if (filteredFull !== el.value) {
      el.value = filteredFull;
      const pos = filteredBefore.length;
      try {
        el.setSelectionRange(pos, pos);
      } catch (_) {}
    }
    return el.value;
  }

  function clearIssue(el, meta) {
    el.classList.remove(meta.errorClass, meta.warningClass);
    if (el._tippy) {
      try {
        el._tippy.hide();
      } catch (_) {}
      try {
        el._tippy.destroy();
      } catch (_) {}
    }
    setState(el, meta, el.value.trim() ? "valid" : "pristine");
  }
  function showIssue(el, meta, issue) {
    const { status, message } = issue;
    el.classList.remove(meta.errorClass, meta.warningClass);
    if (status === "error") el.classList.add(meta.errorClass);
    else if (status === "warning") el.classList.add(meta.warningClass);
    setState(
      el,
      meta,
      status === "error" ? "error" : status === "warning" ? "warning" : "valid"
    );
    if (status === "ok") return;
    if (meta.showTooltipOn === "never") return;
    if (window.tippy) {
      if (el._tippy) {
        el._tippy.setContent(message);
      } else {
        const trigger =
          meta.showTooltipOn === "hover+focus"
            ? "mouseenter focus"
            : "mouseenter";
        tippy(el, {
          content: message,
          animation: "scale",
          placement: "bottom",
          theme: "plain",
          trigger,
          hideOnClick: true,
          delay: [120, 80],
        });
      }
      if (el._tippy && el.matches(":hover")) {
        try {
          el._tippy.show();
        } catch (_) {}
      }
    } else el.title = message;
  }
  function softValidate(el, meta) {
    const val = el.value.trim();
    if (!val) {
      clearIssue(el, meta);
      return;
    }
    const res = normalizeResult(safeValidate(meta.validate, val, el));
    if (res.status === "ok") clearIssue(el, meta);
    else showIssue(el, meta, res);
  }
  function hardValidate(el, meta) {
    const val = el.value.trim();
    if (!val) {
      clearIssue(el, meta);
      return true;
    }
    const res = normalizeResult(safeValidate(meta.validate, val, el));
    if (res.status === "ok") {
      clearIssue(el, meta);
      return true;
    }
    showIssue(el, meta, res);
    return res.status !== "error"; // return true if not blocking
  }
  function safeValidate(fn, val, el) {
    try {
      return fn(val, el);
    } catch (e) {
      return { status: "error", message: (e && e.message) || "Invalid" };
    }
  }
  function normalizeResult(r) {
    if (!r) return { status: "ok" };
    if (r.status) return r;
    // legacy shape support (while WIP) - can be removed later
    if (r.ok === true) return { status: "ok" };
    if (r.ok === false)
      return { status: "error", message: r.error || "Invalid" };
    return { status: "ok" };
  }
  function setState(el, meta, next) {
    const prev = el.dataset.ivState || "pristine";
    if (prev === next) return;
    el.dataset.ivState = next;
    if (meta.onStateChange) {
      try {
        meta.onStateChange(el, prev, next);
      } catch (_) {}
    }
  }

  const pendingConfigs = [];

  function attachOne(el, cfg) {
    if (registry.has(el)) return;
    const meta = {
      id: nextId++,
      cfg,
      groupId: cfg.groupId,
      validate: cfg.validate || ((v) => ({ status: "ok" })),
      allowed: cfg.allowed,
      debounceMs: cfg.debounceMs ?? 700,
      showTooltipOn: cfg.showTooltipOn || "hover",
      errorClass:
        (cfg.severityClasses && cfg.severityClasses.error) ||
        cfg.errorClass ||
        "ws-error",
      warningClass:
        (cfg.severityClasses && cfg.severityClasses.warning) || "ws-warn",
      onStateChange: cfg.onStateChange,
    };
    registry.set(el, meta);
    if (meta.groupId) {
      if (!groups.has(meta.groupId)) groups.set(meta.groupId, new Set());
      groups.get(meta.groupId).add(el);
    }
    setState(el, meta, "pristine");

    el.addEventListener("input", (ev) => {
      const prev = el.value;
      filterValue(el, meta.cfg, prev, ev);
      if (el.dataset.ivState === "error" || el.dataset.ivState === "warning")
        clearIssue(el, meta); // clear style while editing
      setState(el, meta, "dirty");
      if (meta.timer) clearTimeout(meta.timer);
      meta.timer = setTimeout(() => {
        if (document.contains(el)) softValidate(el, meta);
      }, meta.debounceMs);
    });
    el.addEventListener("blur", () => {
      if (meta.timer) {
        clearTimeout(meta.timer);
        meta.timer = null;
      }
      hardValidate(el, meta);
    });

    if (cfg.autoValidateOnLoad) {
      setTimeout(() => {
        if (document.contains(el)) hardValidate(el, meta);
      }, 0);
    }
  }

  function register(cfg) {
    pendingConfigs.push(cfg);
    // Attach to existing elements immediately
    document.querySelectorAll(cfg.selector).forEach((el) => attachOne(el, cfg));
    if (cfg.dynamic) ensureObserver();
    const handle = {
      config: cfg,
      elements: () => Array.from(groups.get(cfg.groupId) || []),
      forceHard: () =>
        handle
          .elements()
          .reduce((ok, el) => hardValidate(el, registry.get(el)) && ok, true),
      destroy: () => {
        handle.elements().forEach((el) => destroyElement(el));
        if (cfg.groupId) groups.delete(cfg.groupId);
      },
    };
    return handle;
  }

  function validateGroup(groupId) {
    const els = groups.get(groupId);
    if (!els) return true;
    let allOk = true;
    els.forEach((el) => {
      if (!hardValidate(el, registry.get(el)) && allOk) {
        try {
          el.focus();
          el.select?.();
        } catch (_) {}
        allOk = false;
      }
    });
    return allOk;
  }
  function anyBlockingInvalid(groupId) {
    const els = groups.get(groupId);
    if (!els) return false;
    for (const el of els) {
      if (el.dataset.ivState === "error") return true;
    }
    return false;
  }
  function anyWarnings(groupId) {
    const els = groups.get(groupId);
    if (!els) return false;
    for (const el of els) {
      if (el.dataset.ivState === "warning") return true;
    }
    return false;
  }

  function validateElement(el) {
    if (!el) return true;
    const meta = registry.get(el);
    if (!meta) return true;
    return hardValidate(el, meta);
  }
  window.InputValidation = {
    register,
    validateGroup,
    anyBlockingInvalid,
    anyWarnings,
    validateElement,
  };
})();
