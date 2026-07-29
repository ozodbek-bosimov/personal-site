/* ═══════════════════════════════════════════════════════════════════════
   CKEditor Content Toolkit — runtime
   ═══════════════════════════════════════════════════════════════════════

   Why this file exists
   ────────────────────
   Snippets are pasted into CKEditor and stored in the database. CKEditor's
   General HTML Support strips <script>, <style>, form controls and on*
   handlers, so a snippet can only ever be inert markup: containers, text,
   and `data-*` configuration. Everything interactive — every button, every
   checkbox, every input — is drawn here at runtime from those data
   attributes.

   Contract with the markup
   ────────────────────────
     data-tk="<tool>"      marks a block root and selects its initialiser
     data-tk-*             per-block configuration, read at init
     data-tk-ready="1"     set by us after a successful init (idempotency)
     data-tk-gen="1"       set by us on every node we create, so a block
                           can be torn back down to its stored form
     data-tk-act="<name>"  on a generated control; routes document-level
                           delegated events to a handler

   Event model
   ───────────
   Listeners are attached once, to `document`, and dispatch on the closest
   `[data-tk-act]` ancestor. Nothing is bound per element, so htmx swapping
   the page body never leaves stale handlers behind and never needs rebinding.

   Lifecycle
   ─────────
     DOMContentLoaded   → init
     htmx:afterSettle   → init (fresh server HTML; new nodes only)
     htmx:restored      → init + rehydrate

   Why htmx:restored is nearly free
   ────────────────────────────────
   htmx caches history entries as HTML, so a restored page already contains
   the controls we injected and already carries data-tk-ready — but none of
   the JavaScript state that was behind them.

   Rather than try to rewind a block to its stored form (impossible to do
   faithfully once a tool has moved author nodes into a generated control),
   every tool keeps its state *in the DOM*: aria-expanded, aria-selected,
   hidden, data-* values. Handlers read the DOM, compute, and write the DOM
   back. A restored snapshot is therefore already working, and needs nothing.

   The two tools that own a real JavaScript object — an IntersectionObserver
   — declare a `rehydrate` hook, which is the only thing that runs on restore.
   ═══════════════════════════════════════════════════════════════════════ */

(function (window, document) {
  "use strict";

  if (window.ContentTools && window.ContentTools.__loaded) {
    return; // Double-included (e.g. boosted navigation re-running a tag).
  }

  var READY = "data-tk-ready";
  var GEN = "data-tk-gen";
  var ACT = "data-tk-act";

  var tools = Object.create(null); // tool name  -> init(el, ctx)
  var handlers = Object.create(null); // "act:type" -> fn(el, ev, root)
  var uidCounter = 0;

  /* ── tiny DOM helpers ─────────────────────────────────────────────── */

  function qsa(root, sel) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function qs(root, sel) {
    return (root || document).querySelector(sel);
  }

  /* Element factory. Every node born here is tagged data-tk-gen so
       reset() can find it again; `opt.keep` opts out for the rare node that
       must survive a teardown. */
  function make(tag, opt) {
    var el = document.createElement(tag);
    opt = opt || {};

    if (opt.cls) el.className = opt.cls;
    if (opt.text != null) el.textContent = String(opt.text);
    if (opt.html != null) el.innerHTML = opt.html;

    if (opt.attrs) {
      Object.keys(opt.attrs).forEach(function (k) {
        var v = opt.attrs[k];
        if (v === null || v === false || v === undefined) return;
        el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    if (opt.act) el.setAttribute(ACT, opt.act);
    if (!opt.keep) el.setAttribute(GEN, "1");
    if (opt.kids) {
      opt.kids.forEach(function (k) {
        if (k) el.appendChild(k);
      });
    }
    return el;
  }

  function uid(prefix) {
    uidCounter += 1;
    return (prefix || "tk") + "-" + uidCounter.toString(36);
  }

  function attr(el, name, fallback) {
    if (!el || !el.hasAttribute(name)) return fallback;
    var v = el.getAttribute(name);
    return v === null || v === "" ? fallback : v;
  }

  function boolAttr(el, name, fallback) {
    var v = attr(el, name, null);
    if (v === null) return !!fallback;
    v = String(v).toLowerCase();
    return v === "" || v === "1" || v === "true" || v === "yes" || v === "on";
  }

  function intAttr(el, name, fallback) {
    var n = parseInt(attr(el, name, ""), 10);
    return isNaN(n) ? fallback : n;
  }

  /* Split a delimited attribute value. Authors type these by hand, so
       empty entries and stray whitespace are forgiven. */
  function splitList(value, sep) {
    if (!value) return [];
    return String(value)
      .split(sep || "|")
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return s.length > 0;
      });
  }

  function addClass(el, cls) {
    if (el && cls) el.classList.add(cls);
  }

  function removeClass(el, cls) {
    if (el && cls) el.classList.remove(cls);
  }

  /* ── per-element state ─────────────────────────────────────────────
       Kept on an expando rather than a WeakMap so that a teardown which
       removes the element also drops the state with it. */

  function state(el) {
    if (!el.__tk) el.__tk = {};
    return el.__tk;
  }

  /* ── storage ───────────────────────────────────────────────────────
       localStorage throws in private-mode Safari and when a site is opened
       from file://. Everything degrades to an in-memory map so the feature
       still works for the current page view. */

  var memStore = Object.create(null);
  var lsOk = (function () {
    try {
      var k = "__tk_probe__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  })();

  var store = {
    get: function (key) {
      // A failed write (quota, browser policy) falls back to memory even
      // when the initial localStorage probe succeeded. Prefer that newer
      // in-memory value over an older value still present on disk.
      if (key in memStore) return memStore[key];
      if (!lsOk) return null;
      try {
        return window.localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set: function (key, value) {
      if (!lsOk) {
        memStore[key] = String(value);
        return;
      }
      try {
        window.localStorage.setItem(key, String(value));
      } catch (e) {
        memStore[key] = String(value); // quota exceeded
      }
    },
    remove: function (key) {
      delete memStore[key];
      if (!lsOk) return;
      try {
        window.localStorage.removeItem(key);
      } catch (e) {
        /* nothing sensible to do */
      }
    },
    getJSON: function (key, fallback) {
      var raw = store.get(key);
      if (!raw) return fallback;
      try {
        var parsed = JSON.parse(raw);
        return parsed === null ? fallback : parsed;
      } catch (e) {
        return fallback;
      }
    },
    setJSON: function (key, value) {
      try {
        store.set(key, JSON.stringify(value));
      } catch (e) {
        /* circular value — not something snippets can produce */
      }
    },
  };

  /* A stable identity for "this block on this page", used as the
       localStorage key for checklists and quiz scores.

       Page part: an explicit data-tk-page on the container wins (the
       templates set it to the post slug), otherwise the pathname. Block
       part: an author-supplied data-tk-id wins; otherwise the block's
       ordinal among same-tool blocks on the page. The ordinal is stable as
       long as blocks are not reordered, which is why data-tk-id is the
       documented choice for anything worth keeping. */
  function pageKey(el) {
    var host = el && el.closest ? el.closest("[data-tk-page]") : null;
    var explicit = host ? host.getAttribute("data-tk-page") : null;
    if (explicit) return explicit;
    try {
      return window.location.pathname || "/";
    } catch (e) {
      return "/";
    }
  }

  function blockKey(el, tool) {
    var own = attr(el, "data-tk-id", null);
    if (!own) {
      var peers = qsa(document, '[data-tk="' + tool + '"]');
      own = "n" + Math.max(0, peers.indexOf(el));
    }
    return "tk:" + pageKey(el) + ":" + tool + ":" + own;
  }

  /* ── base64 (optional obfuscation of quiz answers) ─────────────────
       Not security — it only stops an answer being spotted while scrolling
       the page source. Unicode-safe via percent-encoding round-trip. */

  function decodeB64(value) {
    if (!value) return "";
    try {
      var bin = window.atob(String(value).trim());
      try {
        return decodeURIComponent(
          bin
            .split("")
            .map(function (c) {
              return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
            })
            .join(""),
        );
      } catch (e) {
        return bin; // plain ASCII payload
      }
    } catch (e) {
      warn("could not decode data-*-b64 value");
      return "";
    }
  }

  /* ── announcements ─────────────────────────────────────────────────
       One shared polite region for transient, page-level messages such as
       "Copied". Block-local status text uses its own aria-live node so the
       message keeps its context. */

  var liveRegion = null;

  function announce(message) {
    if (!message) return;
    if (!liveRegion || !liveRegion.isConnected) {
      liveRegion = make("div", {
        cls: "tk-sr",
        attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
        keep: true,
      });
      document.body.appendChild(liveRegion);
    }
    // Re-setting identical text does not re-announce; clear first.
    liveRegion.textContent = "";
    window.setTimeout(function () {
      liveRegion.textContent = message;
    }, 30);
  }

  function warn(message, el) {
    if (window.console && window.console.warn) {
      window.console.warn("[content-tools] " + message, el || "");
    }
  }

  /* ── clipboard ─────────────────────────────────────────────────────
       navigator.clipboard needs a secure context; the textarea trick is
       the fallback for plain http and older Safari. */

  function copyText(text) {
    if (!text) return Promise.resolve(false);

    if (
      window.navigator &&
      window.navigator.clipboard &&
      window.isSecureContext
    ) {
      return window.navigator.clipboard
        .writeText(text)
        .then(function () {
          return true;
        })
        .catch(function () {
          return legacyCopy(text);
        });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;";
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.select();
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  /* ── registration ─────────────────────────────────────────────────── */

  /* register(name, init)                       — the common case
       register(name, init, { rehydrate: fn })    — for a tool that owns a
       real JavaScript object (an observer, a timer) which does not survive
       being restored from htmx's HTML history cache. */
  function register(name, init, opts) {
    if (tools[name]) warn('tool "' + name + '" registered twice');
    tools[name] = {
      init: init,
      rehydrate: (opts && opts.rehydrate) || null,
    };
  }

  /* Register a delegated handler. `type` defaults to click. */
  function action(name, fn, type) {
    handlers[(type || "click") + ":" + name] = fn;
  }

  /* ── init / rehydrate ──────────────────────────────────────────────
       init() is safe to call any number of times on any subtree: the READY
       attribute makes each block init exactly once. A block whose
       initialiser throws is marked data-tk-error and skipped from then on,
       leaving its stored markup on screen and still readable — a broken
       toolkit block should cost the reader a control, never the content. */

  function eachBlock(scope, tool, fn) {
    var sel = '[data-tk="' + tool + '"]';
    if (scope.nodeType === 1 && scope.matches && scope.matches(sel)) fn(scope);
    qsa(scope, sel).forEach(fn);
  }

  function normaliseScope(root) {
    if (!root) return document;
    var t = root.nodeType;
    return t === 1 || t === 9 || t === 11 ? root : document;
  }

  function initOne(el, tool) {
    if (el.getAttribute(READY) === "1" || el.hasAttribute("data-tk-error"))
      return;

    // Initialisers may move authored nodes into generated controls. Keep a
    // complete snapshot so an exception restores the readable stored form
    // rather than leaving a half-built widget behind.
    var originalHTML = el.innerHTML;
    var originalAttrs = Array.prototype.map.call(
      el.attributes,
      function (item) {
        return [item.name, item.value];
      },
    );

    try {
      tools[tool].init(el, api);
      el.setAttribute(READY, "1");
    } catch (err) {
      el.innerHTML = originalHTML;
      Array.prototype.slice.call(el.attributes).forEach(function (item) {
        el.removeAttribute(item.name);
      });
      originalAttrs.forEach(function (item) {
        el.setAttribute(item[0], item[1]);
      });
      el.setAttribute("data-tk-error", "1");
      warn(
        'tool "' + tool + '" failed to initialise: ' + (err && err.message),
        el,
      );
    }
  }

  function init(root) {
    var scope = normaliseScope(root);
    Object.keys(tools).forEach(function (tool) {
      eachBlock(scope, tool, function (el) {
        initOne(el, tool);
      });
    });
  }

  /* Called for blocks that came back from htmx's history cache already
       initialised. Only tools that declared a rehydrate hook do anything. */
  function rehydrate(root) {
    var scope = normaliseScope(root);
    Object.keys(tools).forEach(function (tool) {
      var hook = tools[tool].rehydrate;
      if (!hook) return;
      eachBlock(scope, tool, function (el) {
        if (el.getAttribute(READY) !== "1") return;
        try {
          hook(el, api);
        } catch (err) {
          warn(
            'tool "' + tool + '" failed to rehydrate: ' + (err && err.message),
            el,
          );
        }
      });
    });
  }

  /* Give an element an id so it can be referenced by aria-controls or
       aria-labelledby, without clobbering one the author already set. */
  function ensureId(el, prefix) {
    if (!el) return "";
    if (!el.id) el.setAttribute("id", uid(prefix || "tk"));
    return el.id;
  }

  /* ── delegated event dispatch ─────────────────────────────────────── */

  function dispatch(type, ev) {
    var target = ev.target;
    if (!target || !target.closest) return;

    var ctl = target.closest("[" + ACT + "]");
    if (!ctl) return;

    var name = ctl.getAttribute(ACT);
    var fn = handlers[type + ":" + name];
    if (!fn) return;

    var root = ctl.closest("[data-tk]");
    if (!root) return;

    try {
      fn(ctl, ev, root, api);
    } catch (err) {
      warn(
        'handler "' + type + ":" + name + '" failed: ' + (err && err.message),
        ctl,
      );
    }
  }

  ["click", "change", "input", "keydown", "submit", "focusin"].forEach(
    function (type) {
      document.addEventListener(
        type,
        function (ev) {
          dispatch(type, ev);
        },
        type === "focusin" ? true : false,
      );
    },
  );

  /* ── public surface ───────────────────────────────────────────────── */

  var api = {
    __loaded: true,
    version: "1.0.0",
    register: register,
    action: action,
    init: init,
    rehydrate: rehydrate,
    // DOM
    make: make,
    qs: qs,
    qsa: qsa,
    uid: uid,
    ensureId: ensureId,
    addClass: addClass,
    removeClass: removeClass,
    // attributes
    attr: attr,
    boolAttr: boolAttr,
    intAttr: intAttr,
    splitList: splitList,
    // misc
    state: state,
    store: store,
    blockKey: blockKey,
    pageKey: pageKey,
    decodeB64: decodeB64,
    announce: announce,
    copyText: copyText,
    warn: warn,
    GEN: GEN,
    READY: READY,
    ACT: ACT,
  };

  window.ContentTools = api;

  /* ── boot ─────────────────────────────────────────────────────────── */

  function boot() {
    init(document);
  }

  if (document.readyState === "loading") {
    // Normal first load. Registrations below finish during parsing, well
    // before DOMContentLoaded fires.
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    /* The document is already parsed — which is the usual case here, not
           the exception: hx-boost re-executes this script while swapping in a
           new page, at which point readyState is "complete".

           Booting synchronously would scan the document *before* the tool
           registrations further down this same file had run, leaving the
           registry empty and every block inert. Yielding to a microtask lets
           the rest of the file execute first, and still lands before the next
           paint, so no un-promoted markup is ever shown. */
    Promise.resolve().then(boot);
  }

  // Fresh HTML from the server: only brand-new blocks need work.
  document.addEventListener("htmx:afterSettle", function (ev) {
    init((ev && ev.target) || document);
  });

  // Restored from htmx's history cache. The snapshot already contains the
  // controls we injected, and every handler reads its state from the DOM,
  // so the only work is re-creating observers for the tools that own one.
  document.addEventListener("htmx:restored", function (ev) {
    var root = (ev && ev.target) || document;
    init(root);
    rehydrate(root);
  });
})(window, document);

/* ═══════════════════════════════════════════════════════════════════════
   Tools — disclosure: spoiler · accordion · tabs · terminal
   ═══════════════════════════════════════════════════════════════════════

   Shared approach: the visible label of a control is already in the markup
   as a paragraph or a heading, and init *promotes* it into a button by
   moving its child nodes inside one. Two things fall out of that:

     • the author edits labels as ordinary prose in the editor, and inline
       formatting inside a label (<code>, <strong>) survives;
     • with JavaScript off, every block degrades into headings followed by
       their content — a readable document, not an empty one.

   A <button> nested in a <p> or an <h3> is valid HTML (a button is phrasing
   content), and `<h3><button aria-expanded>` is the ARIA-recommended
   accordion header, so nothing is being smuggled past the spec here.

   Every handler is stateless: it reads aria-expanded / aria-selected /
   hidden off the DOM, works out the next state, and writes it back. That is
   what makes a page restored from htmx's history cache work with no
   re-initialisation at all.
   ═══════════════════════════════════════════════════════════════════════ */

(function (TK) {
  "use strict";

  if (!TK || TK.__disclosureLoaded) return;
  TK.__disclosureLoaded = true;

  /* ── local helpers ────────────────────────────────────────────────── */

  function directChildren(el, sel) {
    return Array.prototype.filter.call(el.children, function (node) {
      return node.matches(sel);
    });
  }

  /* Keep only the nodes that belong to *this* block, not to a nested one
       of the same kind. Without this an outer accordion's "close the others"
       pass would reach into an accordion nested in one of its panels. */
  function ownedBy(root, tool, nodes) {
    return nodes.filter(function (node) {
      return node.closest('[data-tk="' + tool + '"]') === root;
    });
  }

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  /* Move an element's children into a freshly made button, then put the
       button back where they were. */
  function promoteToButton(host, cls, act, extraAttrs) {
    var attrs = { type: "button" };
    Object.keys(extraAttrs || {}).forEach(function (k) {
      attrs[k] = extraAttrs[k];
    });
    var btn = TK.make("button", { cls: cls, act: act, attrs: attrs });
    while (host.firstChild) btn.appendChild(host.firstChild);
    host.appendChild(btn);
    return btn;
  }

  function setExpanded(btn, open) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    var panel = document.getElementById(btn.getAttribute("aria-controls"));
    if (panel) panel.hidden = !open;
    return panel;
  }

  /* Move focus between the controls of a composite widget.
       Returns true when the key was ours, so the caller can suppress the
       browser's own scrolling. */
  function roveFocus(controls, current, key, orientation) {
    var prevKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    var nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    var i = controls.indexOf(current);
    if (i < 0) return -1;

    var target = -1;
    if (key === nextKey) target = (i + 1) % controls.length;
    else if (key === prevKey)
      target = (i - 1 + controls.length) % controls.length;
    else if (key === "Home") target = 0;
    else if (key === "End") target = controls.length - 1;
    return target;
  }

  /* ── spoiler ──────────────────────────────────────────────────────── */

  TK.register("spoiler", function (el) {
    var summary = TK.qs(el, ".tk-spoiler__summary");
    var body = TK.qs(el, ".tk-spoiler__body");

    if (!summary) throw new Error("missing .tk-spoiler__summary");
    if (!body) throw new Error("missing .tk-spoiler__body");

    var open = TK.boolAttr(el, "data-open", false);
    var btn = promoteToButton(
      summary,
      "tk-ctl tk-spoiler__btn",
      "spoiler-toggle",
      {
        "aria-expanded": open ? "true" : "false",
        "aria-controls": TK.ensureId(body, "tk-spoiler-body"),
      },
    );

    TK.ensureId(btn, "tk-spoiler-btn");
    body.setAttribute("role", "group");
    body.setAttribute("aria-labelledby", btn.id);
    body.hidden = !open;
  });

  TK.action("spoiler-toggle", function (btn) {
    setExpanded(btn, btn.getAttribute("aria-expanded") !== "true");
  });

  /* ── accordion / FAQ ──────────────────────────────────────────────── */

  function accButtons(root) {
    return ownedBy(root, "accordion", TK.qsa(root, ".tk-accordion__btn"));
  }

  TK.register("accordion", function (el) {
    var items = directChildren(el, ".tk-accordion__item");
    if (!items.length) throw new Error("no .tk-accordion__item children");

    items.forEach(function (item, index) {
      var question = TK.qs(item, ".tk-accordion__q");
      var answer = TK.qs(item, ".tk-accordion__a");
      if (!question || !answer) {
        throw new Error(
          "item " +
            (index + 1) +
            " needs both .tk-accordion__q and .tk-accordion__a",
        );
      }

      var open = TK.boolAttr(item, "data-open", false);
      var btn = promoteToButton(
        question,
        "tk-ctl tk-accordion__btn",
        "acc-toggle",
        {
          "aria-expanded": open ? "true" : "false",
          "aria-controls": TK.ensureId(answer, "tk-acc-panel"),
        },
      );

      TK.ensureId(btn, "tk-acc-btn");
      answer.setAttribute("role", "region");
      answer.setAttribute("aria-labelledby", btn.id);
      answer.hidden = !open;
    });
  });

  TK.action("acc-toggle", function (btn, ev, root) {
    var open = btn.getAttribute("aria-expanded") === "true";

    // data-single turns the block into "one open at a time". Read at
    // event time rather than cached at init, so the state stays in the DOM.
    if (!open && TK.boolAttr(root, "data-single", false)) {
      accButtons(root).forEach(function (other) {
        if (other !== btn && other.getAttribute("aria-expanded") === "true") {
          setExpanded(other, false);
        }
      });
    }
    setExpanded(btn, !open);
  });

  TK.action(
    "acc-toggle",
    function (btn, ev, root) {
      var target = roveFocus(accButtons(root), btn, ev.key, "vertical");
      if (target < 0) return;
      ev.preventDefault();
      accButtons(root)[target].focus();
    },
    "keydown",
  );

  /* ── tabs ─────────────────────────────────────────────────────────── */

  function tabControls(root) {
    return ownedBy(root, "tabs", TK.qsa(root, ".tk-tabs__tab"));
  }

  function selectTab(root, index) {
    var tabs = tabControls(root);
    if (!tabs.length) return null;
    index = clamp(index, 0, tabs.length - 1);

    tabs.forEach(function (tab, i) {
      var on = i === index;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      // Roving tabindex: only the selected tab is in the tab order, so
      // Tab moves past the strip into the panel rather than through
      // every tab in turn.
      tab.setAttribute("tabindex", on ? "0" : "-1");
      var panel = document.getElementById(tab.getAttribute("aria-controls"));
      if (panel) panel.hidden = !on;
    });
    return tabs[index];
  }

  TK.register("tabs", function (el) {
    var panels = directChildren(el, ".tk-tabs__panel");
    if (panels.length < 2)
      throw new Error("needs at least two .tk-tabs__panel children");

    var active = clamp(TK.intAttr(el, "data-active", 1), 1, panels.length) - 1;
    var list = TK.make("div", {
      cls: "tk-tabs__list",
      attrs: { role: "tablist", "aria-orientation": "horizontal" },
    });

    panels.forEach(function (panel, i) {
      var label = TK.qs(panel, ".tk-tabs__label");
      var tab = TK.make("button", {
        cls: "tk-ctl tk-tabs__tab",
        act: "tab-select",
        text: label ? label.textContent.trim() : "Tab " + (i + 1),
        attrs: {
          type: "button",
          role: "tab",
          "aria-controls": TK.ensureId(panel, "tk-tab-panel"),
        },
      });
      list.appendChild(tab);

      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", TK.ensureId(tab, "tk-tab"));
      // Panels can contain more text than fits; making them focusable
      // gives keyboard users something to scroll.
      panel.setAttribute("tabindex", "0");

      // The heading has become the tab button. Hiding it stops the
      // label being shown and announced twice over.
      if (label) label.hidden = true;
    });

    el.insertBefore(list, el.firstChild);
    selectTab(el, active);
  });

  TK.action("tab-select", function (tab, ev, root) {
    selectTab(root, tabControls(root).indexOf(tab));
  });

  TK.action(
    "tab-select",
    function (tab, ev, root) {
      var target = roveFocus(tabControls(root), tab, ev.key, "horizontal");
      if (target < 0) return;
      ev.preventDefault();
      // Automatic activation: for panels this cheap, ARIA prefers the
      // arrow key to both move focus and switch panel.
      var next = selectTab(root, target);
      if (next) next.focus();
    },
    "keydown",
  );

  /* ── terminal with copy ───────────────────────────────────────────── */

  /* What lands on the clipboard: the commands, and only the commands.
       Lines marked data-kind="out" are program output and are skipped, and
       the `$` prompt is a CSS pseudo-element so it was never in textContent
       to begin with. The point is that the result can be pasted into a shell
       and run as-is. */
  function terminalText(root) {
    return TK.qsa(root, ".tk-term__line")
      .filter(function (line) {
        return line.getAttribute("data-kind") !== "out";
      })
      .map(function (line) {
        return line.textContent.replace(/\s+$/, "");
      });
  }

  TK.register("terminal", function (el) {
    var body = TK.qs(el, ".tk-term__body");
    if (!body) throw new Error("missing .tk-term__body");

    var idle = TK.attr(el, "data-copy-label", "Copy");
    var bar = TK.make("div", {
      cls: "tk-term__bar",
      kids: [
        TK.make("span", {
          cls: "tk-term__label",
          text: TK.attr(el, "data-label", "terminal"),
        }),
        TK.make("button", {
          cls: "tk-ctl tk-term__copy",
          act: "term-copy",
          text: idle,
          attrs: { type: "button", "data-tk-idle": idle },
        }),
      ],
    });
    el.insertBefore(bar, el.firstChild);
  });

  TK.action("term-copy", function (btn, ev, root) {
    var lines = terminalText(root);
    var idle = TK.attr(btn, "data-tk-idle", "Copy");

    TK.copyText(lines.join("\n")).then(function (ok) {
      btn.textContent = ok ? "Copied" : "Press \u2318C";
      btn.classList.toggle("tk-term__copy--done", ok);
      TK.announce(
        ok
          ? lines.length +
              (lines.length === 1 ? " line copied" : " lines copied")
          : "Copy failed — select the text and copy manually",
      );

      window.setTimeout(function () {
        btn.textContent = idle;
        btn.classList.remove("tk-term__copy--done");
      }, 1800);
    });
  });
})(window.ContentTools);

/* ═══════════════════════════════════════════════════════════════════════
   Tools — progress: checklist · table of contents
   ═══════════════════════════════════════════════════════════════════════ */

(function (TK) {
  "use strict";

  if (!TK || TK.__progressLoaded) return;
  TK.__progressLoaded = true;

  /* ── checklist ──────────────────────────────────────────────────────
       data-tk="checklist"

       Progress is stored per reader in localStorage. Two decisions worth
       spelling out:

       Storage key. `blockKey()` namespaces by page (the templates pass the
       post slug through data-tk-page) and by block. Without a data-tk-id the
       block half is its ordinal among checklists on the page, which is
       stable until blocks are reordered — hence the documented advice to set
       data-tk-id on any checklist whose progress is worth keeping.

       Item key. Not the item's index but a hash of its text. Inserting a new
       step in the middle of a checklist therefore does not silently shift
       everyone's ticks onto the wrong lines. The trade-off is that editing an
       item's wording resets that one item, which is the safer failure.     */

  function hashText(text) {
    var normalised = String(text).replace(/\s+/g, " ").trim().toLowerCase();
    var hash = 5381;
    for (var i = 0; i < normalised.length; i++) {
      hash = ((hash << 5) + hash + normalised.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
  }

  function checklistBoxes(root) {
    return TK.qsa(root, ".tk-checklist__box").filter(function (box) {
      return box.closest('[data-tk="checklist"]') === root;
    });
  }

  /* Recompute everything the checklist shows from the checkboxes alone —
       no cached counts, so this is safe to call at init, after a change, and
       on a page restored from htmx's cache. */
  function syncChecklist(root) {
    var boxes = checklistBoxes(root);
    var total = boxes.length;
    var done = boxes.filter(function (box) {
      return box.checked;
    }).length;

    root.style.setProperty(
      "--tk-cl-progress",
      (total ? Math.round((done / total) * 100) : 0) + "%",
    );

    boxes.forEach(function (box) {
      var item = box.closest(".tk-checklist__item");
      if (item) item.toggleAttribute("data-done", box.checked);
    });

    var bar = TK.qs(root, ".tk-checklist__bar");
    if (bar) {
      bar.setAttribute("aria-valuenow", String(done));
      bar.setAttribute("aria-valuetext", done + " of " + total + " done");
    }

    var count = TK.qs(root, ".tk-checklist__count");
    if (count) count.textContent = done + " / " + total;

    var reset = TK.qs(root, ".tk-checklist__reset");
    if (reset) reset.disabled = done === 0;

    if (TK.boolAttr(root, "data-persist", true)) {
      var key = TK.blockKey(root, "checklist");
      var ticked = boxes
        .filter(function (box) {
          return box.checked;
        })
        .map(function (box) {
          return box.getAttribute("data-tk-key");
        });
      if (ticked.length) TK.store.setJSON(key, ticked);
      else TK.store.remove(key);
    }
  }

  TK.register("checklist", function (el) {
    var items = TK.qsa(el, ".tk-checklist__item");
    var list = TK.qs(el, ".tk-checklist__list");
    if (!items.length) throw new Error("no .tk-checklist__item entries");
    if (!list) throw new Error("missing .tk-checklist__list");

    var persist = TK.boolAttr(el, "data-persist", true);
    var saved = persist
      ? TK.store.getJSON(TK.blockKey(el, "checklist"), [])
      : [];
    if (!Array.isArray(saved)) saved = [];

    var title = TK.qs(el, ".tk-checklist__title");
    var seen = Object.create(null);

    items.forEach(function (item) {
      // Two items with identical wording would otherwise share a key
      // and tick together; the suffix keeps them apart deterministically.
      var base = hashText(item.textContent);
      seen[base] = (seen[base] || 0) + 1;
      var key = seen[base] > 1 ? base + "~" + seen[base] : base;

      var box = TK.make("input", {
        cls: "tk-checklist__box",
        act: "check-item",
        attrs: { type: "checkbox", "data-tk-key": key },
      });
      // A <label> wrapping the checkbox associates the two implicitly,
      // so the whole row is a hit target with no id plumbing.
      var row = TK.make("label", { cls: "tk-checklist__row" });
      row.appendChild(box);
      while (item.firstChild) row.appendChild(item.firstChild);
      item.appendChild(row);

      if (saved.indexOf(key) !== -1) box.checked = true;
    });

    var head = TK.make("div", {
      cls: "tk-checklist__head",
      kids: [
        TK.make("span", {
          cls: "tk-checklist__count",
          attrs: { role: "status", "aria-live": "polite" },
        }),
        TK.make("button", {
          cls: "tk-ctl tk-checklist__reset",
          act: "check-reset",
          text: TK.attr(el, "data-reset-label", "Clear"),
          attrs: { type: "button" },
        }),
      ],
    });

    var bar = TK.make("div", {
      cls: "tk-checklist__bar",
      attrs: {
        role: "progressbar",
        "aria-label":
          (title ? title.textContent.trim() + " — " : "") + "progress",
        "aria-valuemin": "0",
        "aria-valuemax": String(items.length),
        "aria-valuenow": "0",
      },
      kids: [TK.make("div", { cls: "tk-checklist__fill" })],
    });

    el.insertBefore(head, list);
    el.insertBefore(bar, list);
    syncChecklist(el);
  });

  TK.action(
    "check-item",
    function (box, ev, root) {
      syncChecklist(root);
    },
    "change",
  );

  TK.action("check-reset", function (btn, ev, root) {
    checklistBoxes(root).forEach(function (box) {
      box.checked = false;
    });
    TK.store.remove(TK.blockKey(root, "checklist"));
    syncChecklist(root);
    TK.announce("Checklist cleared");
  });

  /* ── table of contents ──────────────────────────────────────────────
       data-tk="toc"  ·  data-variant=inline|sticky  ·  data-levels="2,3"

       Built from the headings already in the article, so it cannot fall out
       of step with the prose. Headings that belong to a toolkit block — an
       accordion question, a tab label, a step title — are skipped: a table of
       contents should describe the document, not the internals of a widget
       inside it.                                                           */

  var TOC_OFFSET = 100; // px below the sticky site nav

  function tocScope(el) {
    return el.closest(".blog-content, [data-tk-page]") || document.body;
  }

  function tocHeadings(el) {
    var levels = TK.splitList(TK.attr(el, "data-levels", "2,3"), ",")
      .map(function (n) {
        return "h" + parseInt(n, 10);
      })
      .filter(function (tag) {
        return /^h[2-4]$/.test(tag);
      });
    if (!levels.length) levels = ["h2", "h3"];

    return TK.qsa(tocScope(el), levels.join(",")).filter(function (heading) {
      return !heading.closest("[data-tk]");
    });
  }

  /* Active section = the last heading whose top has passed the offset.
       Computed from live geometry rather than from whichever entries the
       observer happened to report, which keeps it correct when several
       headings are crossed in one fast scroll. */
  function updateToc(el, headings) {
    var current = headings[0];
    headings.forEach(function (heading) {
      if (heading.getBoundingClientRect().top <= TOC_OFFSET) current = heading;
    });
    if (!current) return;

    TK.qsa(el, ".tk-toc__link").forEach(function (link) {
      var on = link.getAttribute("href") === "#" + current.id;
      link.classList.toggle("tk-toc__link--active", on);
      if (on) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  }

  /* The observer is only a throttled trigger — it fires when a heading
       crosses the viewport edge, and updateToc() then does the real work. */
  function observeToc(el, headings) {
    var st = TK.state(el);
    if (st.observer) st.observer.disconnect();

    if (!("IntersectionObserver" in window)) {
      updateToc(el, headings);
      return;
    }

    st.observer = new window.IntersectionObserver(
      function () {
        updateToc(el, headings);
      },
      { rootMargin: "-" + TOC_OFFSET + "px 0px 0px 0px", threshold: [0, 1] },
    );
    headings.forEach(function (heading) {
      st.observer.observe(heading);
    });
    updateToc(el, headings);
  }

  TK.register(
    "toc",
    function (el) {
      var headings = tocHeadings(el);

      // A one-entry table of contents is noise, not navigation.
      if (headings.length < 2) {
        el.hidden = true;
        TK.warn("toc: fewer than two headings in scope, hiding the block", el);
        return;
      }

      var list = TK.make("ul", { cls: "tk-list tk-toc__list" });
      headings.forEach(function (heading) {
        var link = TK.make("a", {
          cls: "tk-toc__link",
          text: heading.textContent.trim(),
          attrs: {
            href: "#" + TK.ensureId(heading, "tk-h"),
            "data-level": heading.tagName.toLowerCase(),
          },
        });
        // Keeps the sticky site nav from covering the heading you
        // just jumped to.
        heading.classList.add("tk-toc-target");
        list.appendChild(TK.make("li", { cls: "tk-toc__item", kids: [link] }));
      });

      var fallback = TK.qs(el, ".tk-toc__fallback");
      if (fallback) fallback.hidden = true;

      el.appendChild(
        TK.make("nav", {
          cls: "tk-toc__nav",
          attrs: {
            "aria-label": TK.attr(el, "data-label", "Table of contents"),
          },
          kids: [list],
        }),
      );

      observeToc(el, headings);
    },
    {
      /* An IntersectionObserver does not survive being restored from
               htmx's HTML history cache. The generated links do, so the
               heading list is recovered from them and the observer rebuilt. */
      rehydrate: function (el) {
        var headings = TK.qsa(el, ".tk-toc__link")
          .map(function (link) {
            return document.getElementById(link.getAttribute("href").slice(1));
          })
          .filter(Boolean);
        if (headings.length) observeToc(el, headings);
      },
    },
  );
})(window.ContentTools);

/* ═══════════════════════════════════════════════════════════════════════
   Tools — recall: quiz · flashcards
   ═══════════════════════════════════════════════════════════════════════ */

(function (TK) {
  "use strict";

  if (!TK || TK.__recallLoaded) return;
  TK.__recallLoaded = true;

  function owned(root, tool, sel) {
    return TK.qsa(root, sel).filter(function (node) {
      return node.closest('[data-tk="' + tool + '"]') === root;
    });
  }

  /* ── quiz ───────────────────────────────────────────────────────────
       data-tk="quiz"

       Feedback is immediate: picking an answer marks the question, reveals
       the explanation and updates the score. Multiple-choice questions are
       the one exception — there is no way to know the reader has finished
       choosing, so those get a per-question Check button.

       The answer key is never written into the DOM. It is re-resolved from
       data-answer / data-answer-b64 at the moment of judging, which is what
       keeps data-answer-b64 meaningful: obfuscating the attribute would be
       pointless if init helpfully expanded it into a plain one next door.  */

  function questions(root) {
    return owned(root, "quiz", ".tk-quiz__q");
  }

  function options(question) {
    return TK.qsa(question, ".tk-quiz__option");
  }

  /* Accepts 1-based indices ("2", "1,3") or the option's own text
       ("true", "false", "Paris"). Matching on text is what makes
       data-type="truefalse" read naturally and lets an author write the
       answer they mean rather than counting list items. */
  function resolveAnswer(question, opts) {
    var encoded = TK.attr(question, "data-answer-b64", null);
    var raw = encoded
      ? TK.decodeB64(encoded)
      : TK.attr(question, "data-answer", "");
    var wanted = [];

    TK.splitList(raw, ",").forEach(function (token) {
      var lowered = token.toLowerCase();
      var byText = -1;
      opts.forEach(function (li, i) {
        if (byText === -1 && li.textContent.trim().toLowerCase() === lowered)
          byText = i;
      });
      if (byText !== -1) {
        if (wanted.indexOf(byText) === -1) wanted.push(byText);
        return;
      }
      var n = parseInt(token, 10);
      if (
        !isNaN(n) &&
        n >= 1 &&
        n <= opts.length &&
        wanted.indexOf(n - 1) === -1
      ) {
        wanted.push(n - 1);
      }
    });
    return wanted;
  }

  function judge(question) {
    var opts = options(question);
    var answer = resolveAnswer(question, opts);
    var picked = [];

    opts.forEach(function (li, i) {
      var input = TK.qs(li, ".tk-quiz__input");
      if (input && input.checked) picked.push(i);
    });

    var correct =
      answer.length > 0 &&
      picked.length === answer.length &&
      picked.every(function (i) {
        return answer.indexOf(i) !== -1;
      });

    question.setAttribute("data-state", correct ? "correct" : "wrong");

    opts.forEach(function (li, i) {
      var isAnswer = answer.indexOf(i) !== -1;
      var isPicked = picked.indexOf(i) !== -1;

      // hit = chosen and right · miss = chosen and wrong ·
      // answer = not chosen but was right (shown so the reader learns it)
      if (isPicked && isAnswer) li.setAttribute("data-mark", "hit");
      else if (isPicked) li.setAttribute("data-mark", "miss");
      else if (isAnswer) li.setAttribute("data-mark", "answer");
      else li.removeAttribute("data-mark");

      var input = TK.qs(li, ".tk-quiz__input");
      if (input) input.disabled = true; // a judged question is final
    });

    var explain = TK.qs(question, ".tk-quiz__explain");
    if (explain) explain.hidden = false;

    var check = TK.qs(question, ".tk-quiz__check");
    if (check) check.hidden = true;

    return correct;
  }

  function syncQuiz(root) {
    var all = questions(root);
    var total = all.length;
    var judged = all.filter(function (q) {
      return q.hasAttribute("data-state");
    });
    var correct = all.filter(function (q) {
      return q.getAttribute("data-state") === "correct";
    }).length;

    var score = TK.qs(root, ".tk-quiz__score");
    if (score) score.textContent = correct + " / " + total;

    var retry = TK.qs(root, ".tk-quiz__retry");
    if (retry) retry.disabled = judged.length === 0;

    var done = total > 0 && judged.length === total;
    root.toggleAttribute("data-complete", done);

    var percent = total ? Math.round((correct / total) * 100) : 0;
    var key = TK.blockKey(root, "quiz") + ":best";
    var best = parseInt(TK.store.get(key) || "-1", 10);

    if (done && percent > best) {
      best = percent;
      TK.store.set(key, String(best));
    }

    var bestEl = TK.qs(root, ".tk-quiz__best");
    if (bestEl) {
      bestEl.textContent = best >= 0 ? "Best " + best + "%" : "";
      bestEl.hidden = best < 0;
    }

    // One notification per completed run; cleared again by Try again.
    if (done && !root.hasAttribute("data-tk-reported")) {
      root.setAttribute("data-tk-reported", "1");
      TK.announce("Quiz finished: " + correct + " of " + total + " correct.");
      // Seam for the reporting block (see the rating/report tool): the
      // quiz itself has no opinion about where a result should go.
      root.dispatchEvent(
        new window.CustomEvent("tk:quiz-complete", {
          bubbles: true,
          detail: {
            correct: correct,
            total: total,
            percent: percent,
            best: best,
          },
        }),
      );
    }
  }

  function currentQuestion(list) {
    for (var i = 0; i < list.length; i++) {
      if (!list[i].hidden) return i;
    }
    return 0;
  }

  function showQuestion(root, index) {
    var list = questions(root);
    if (!list.length) return;
    index = ((index % list.length) + list.length) % list.length;
    list.forEach(function (q, i) {
      q.hidden = (i !== index);
    });
    var count = TK.qs(root, ".tk-quiz__count");
    if (count) count.textContent = index + 1 + " / " + list.length;
  }

  TK.register("quiz", function (el) {
    var all = questions(el);
    if (!all.length) throw new Error("no .tk-quiz__q blocks");

    var group = TK.uid("tk-quiz");

    all.forEach(function (question, qi) {
      var opts = options(question);
      if (opts.length < 2) {
        throw new Error("question " + (qi + 1) + " needs at least two options");
      }

      var multi = TK.attr(question, "data-type", "single") === "multi";
      var name = group + "-q" + qi;
      var prompt = TK.qs(question, ".tk-quiz__prompt");

      question.setAttribute("role", "group");
      if (prompt) {
        question.setAttribute(
          "aria-labelledby",
          TK.ensureId(prompt, "tk-quiz-p"),
        );
      }

      opts.forEach(function (li) {
        var input = TK.make("input", {
          cls: "tk-quiz__input",
          act: multi ? null : "quiz-pick",
          attrs: { type: multi ? "checkbox" : "radio", name: name },
        });
        var row = TK.make("label", { cls: "tk-quiz__row" });
        row.appendChild(input);
        while (li.firstChild) row.appendChild(li.firstChild);
        li.appendChild(row);
      });

      if (multi) {
        question.appendChild(
          TK.make("button", {
            cls: "tk-ctl tk-quiz__check",
            act: "quiz-check",
            text: TK.attr(el, "data-check-label", "Check"),
            attrs: { type: "button" },
          }),
        );
      }

      var explanation = TK.attr(question, "data-explain", "");
      if (explanation) {
        question.appendChild(
          TK.make("p", {
            cls: "tk-quiz__explain",
            text: explanation,
            attrs: { hidden: "" },
          }),
        );
      }
    });

    var bar = TK.make("div", {
      cls: "tk-quiz__bar",
      kids: [
        TK.make("button", {
          cls: "tk-ctl tk-quiz__nav",
          act: "quiz-prev",
          text: "\u2190",
          attrs: { type: "button", "aria-label": "Previous question" },
        }),
        TK.make("span", {
          cls: "tk-quiz__count",
          attrs: { role: "status", "aria-live": "polite" },
        }),
        TK.make("button", {
          cls: "tk-ctl tk-quiz__nav",
          act: "quiz-next",
          text: "\u2192",
          attrs: { type: "button", "aria-label": "Next question" },
        }),
      ],
    });
    el.appendChild(bar);

    var foot = TK.make("div", {
      cls: "tk-quiz__foot",
      kids: [
        TK.make("span", {
          cls: "tk-quiz__score",
          attrs: { role: "status", "aria-live": "polite" },
        }),
        TK.make("span", { cls: "tk-quiz__best", attrs: { hidden: "" } }),
        TK.make("button", {
          cls: "tk-ctl tk-quiz__retry",
          act: "quiz-retry",
          text: TK.attr(el, "data-retry-label", "Try again"),
          attrs: { type: "button" },
        }),
      ],
    });
    el.appendChild(foot);

    showQuestion(el, 0);
    syncQuiz(el);
  });

  TK.action("quiz-prev", function (btn, ev, root) {
    showQuestion(root, currentQuestion(questions(root)) - 1);
  });

  TK.action("quiz-next", function (btn, ev, root) {
    showQuestion(root, currentQuestion(questions(root)) + 1);
  });

  function announceResult(question, correct) {
    var explanation = TK.attr(question, "data-explain", "");
    TK.announce((correct ? "Correct. " : "Not quite. ") + explanation);
  }

  TK.action(
    "quiz-pick",
    function (input, ev, root) {
      var question = input.closest(".tk-quiz__q");
      if (!question) return;
      announceResult(question, judge(question));
      syncQuiz(root);
      // Automatically advance to the next question after a short delay if correct?
      // For now, let the user read the explanation and click Next.
    },
    "change",
  );

  TK.action("quiz-check", function (btn, ev, root) {
    var question = btn.closest(".tk-quiz__q");
    if (!question) return;
    announceResult(question, judge(question));
    syncQuiz(root);
  });

  TK.action("quiz-retry", function (btn, ev, root) {
    questions(root).forEach(function (question) {
      question.removeAttribute("data-state");
      options(question).forEach(function (li) {
        li.removeAttribute("data-mark");
        var input = TK.qs(li, ".tk-quiz__input");
        if (input) {
          input.checked = false;
          input.disabled = false;
        }
      });
      var explain = TK.qs(question, ".tk-quiz__explain");
      if (explain) explain.hidden = true;
      var check = TK.qs(question, ".tk-quiz__check");
      if (check) check.hidden = false;
    });

    root.removeAttribute("data-tk-reported");
    syncQuiz(root);
    TK.announce("Quiz reset. Try again.");
  });

  /* ── flashcards ─────────────────────────────────────────────────────
       data-tk="flashcards"

       One card at a time, front first. The current card and the flip state
       both live in the DOM (which card is not [hidden], whether the back is
       not [hidden]), so nothing needs re-initialising after a restore.

       With JavaScript off every card shows front and back as consecutive
       paragraphs, which reads as a glossary — still useful, just not drilled. */

  function cards(root) {
    var list = owned(root, "flashcards", ".tk-cards__card");
    if (!list.length) {
      list = owned(root, "flashcards", ".tk-flashcard");
    }
    return list;
  }

  function cardBack(card) {
    if (!card) return null;
    return TK.qs(card, ".tk-cards__back") || TK.qs(card, ".tk-flashcard__back");
  }

  function cardFront(card) {
    if (!card) return null;
    return TK.qs(card, ".tk-cards__front") || TK.qs(card, ".tk-flashcard__front");
  }

  function currentCard(list) {
    for (var i = 0; i < list.length; i++) {
      if (!list[i].hidden) return i;
    }
    return 0;
  }

  function showCard(root, index) {
    var list = cards(root);
    if (!list.length) return;

    // Wrap in both directions so Previous on the first card goes to the last.
    index = ((index % list.length) + list.length) % list.length;

    list.forEach(function (card, i) {
      card.hidden = i !== index;
      var back = cardBack(card);
      if (back) back.hidden = true; // a card always arrives face-up
    });

    var flip = TK.qs(root, ".tk-cards__flip");
    if (flip) {
      var back = cardBack(list[index]);
      flip.setAttribute("aria-expanded", "false");
      if (back) flip.setAttribute("aria-controls", back.id);
      flip.disabled = !back;
    }

    var count = TK.qs(root, ".tk-cards__count");
    if (count) count.textContent = index + 1 + " / " + list.length;
  }

  function shuffleCards(root) {
    var list = cards(root);
    if (list.length < 2) return;

    var order = list.slice();
    for (var i = order.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    // Keep the generated control bar after the deck while moving the
    // authored cards into their new order.
    var bar = TK.qs(root, ".tk-cards__bar");
    order.forEach(function (card) {
      root.insertBefore(card, bar || null);
    });
    showCard(root, 0);
  }

  TK.register("flashcards", function (el) {
    var list = cards(el);
    if (!list.length) return;

    list.forEach(function (card) {
      var front = cardFront(card);
      var back = cardBack(card);
      if (back) TK.ensureId(back, "tk-card-back");
      card.setAttribute("role", "group");
      if (front) {
        card.setAttribute(
          "aria-labelledby",
          TK.ensureId(front, "tk-card-front"),
        );
      }
    });

    var bar = TK.make("div", {
      cls: "tk-cards__bar",
      kids: [
        TK.make("button", {
          cls: "tk-ctl tk-cards__nav",
          act: "card-prev",
          text: "\u2190",
          attrs: { type: "button", "aria-label": "Previous card" },
        }),
        TK.make("span", {
          cls: "tk-cards__count",
          attrs: { role: "status", "aria-live": "polite" },
        }),
        TK.make("button", {
          cls: "tk-ctl tk-cards__nav",
          act: "card-next",
          text: "\u2192",
          attrs: { type: "button", "aria-label": "Next card" },
        }),
        TK.make("button", {
          cls: "tk-ctl tk-cards__flip",
          act: "card-flip",
          text: TK.attr(el, "data-flip-label", "Flip"),
          attrs: { type: "button", "aria-expanded": "false" },
        }),
        TK.make("button", {
          cls: "tk-ctl tk-cards__shuffle",
          act: "card-shuffle",
          text: TK.attr(el, "data-shuffle-label", "Shuffle"),
          attrs: { type: "button" },
        }),
      ],
    });

    el.appendChild(bar);
    showCard(el, 0);
    if (TK.boolAttr(el, "data-shuffle", false)) shuffleCards(el);
  });

  TK.action("card-flip", function (btn, ev, root) {
    var list = cards(root);
    var card = list[currentCard(list)];
    var back = cardBack(card);
    if (!back) return;
    var open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", open ? "false" : "true");
    back.hidden = open;
  });

  TK.action("card-prev", function (btn, ev, root) {
    var list = cards(root);
    showCard(root, currentCard(list) - 1);
  });

  TK.action("card-next", function (btn, ev, root) {
    var list = cards(root);
    showCard(root, currentCard(list) + 1);
  });

  TK.action("card-shuffle", function (btn, ev, root) {
    shuffleCards(root);
    TK.announce("Cards shuffled");
  });

  /* Arrow keys move through the deck from any of the bar controls, so a
       keyboard user does not have to tab back to the arrows each time. */
  function deckKeys(btn, ev, root) {
    var list = cards(root);
    if (ev.key === "ArrowLeft") showCard(root, currentCard(list) - 1);
    else if (ev.key === "ArrowRight") showCard(root, currentCard(list) + 1);
    else return;
    ev.preventDefault();
  }

  ["card-prev", "card-next", "card-flip", "card-shuffle"].forEach(
    function (act) {
      TK.action(act, deckKeys, "keydown");
    },
  );
})(window.ContentTools);

/* ═══════════════════════════════════════════════════════════════════════
   Tools — feedback: Google Forms bridge · rating · quiz reporting
   ═══════════════════════════════════════════════════════════════════════ */

(function (TK) {
  "use strict";

  if (!TK || TK.__feedbackLoaded) return;
  TK.__feedbackLoaded = true;

  function owned(root, tool, sel) {
    return TK.qsa(root, sel).filter(function (node) {
      return node.closest('[data-tk="' + tool + '"]') === root;
    });
  }

  function fieldHosts(root) {
    return TK.qsa(root, ".tk-form__field").filter(function (node) {
      return node.closest("[data-tk]") === root;
    });
  }

  function setStatus(root, state, message) {
    if (state) root.setAttribute("data-state", state);
    else root.removeAttribute("data-state");

    var status = TK.qs(root, ".tk-form__status, .tk-rating__status");
    if (status) status.textContent = message || "";
  }

  function googleAction(root) {
    var raw = TK.attr(root, "data-action", "");
    if (!raw) return "";
    try {
      var url = new window.URL(raw, window.location.href);
      var validHost =
        url.protocol === "https:" && url.hostname === "docs.google.com";
      var validPath = /\/forms\/.*\/formResponse\/?$/.test(url.pathname);
      return validHost && validPath ? url.href : "";
    } catch (e) {
      return "";
    }
  }

  function iframePost(action, params) {
    return new Promise(function (resolve, reject) {
      var frame = null;
      var transport = null;
      try {
        var target = TK.uid("tk-gform-target");
        frame = TK.make("iframe", {
          cls: "tk-form__transport",
          attrs: {
            name: target,
            title: "Form submission transport",
            hidden: "",
          },
        });
        transport = TK.make("form", {
          cls: "tk-form__transport",
          attrs: {
            method: "post",
            action: action,
            target: target,
            hidden: "",
          },
        });

        params.forEach(function (value, key) {
          transport.appendChild(
            TK.make("input", {
              attrs: { type: "hidden", name: key, value: value },
            }),
          );
        });

        document.body.appendChild(frame);
        document.body.appendChild(transport);
        transport.submit();

        // Cross-origin iframe responses are intentionally unreadable. A
        // successful native submit means the fallback dispatched the payload;
        // clean its temporary DOM up after the browser has consumed it.
        window.setTimeout(function () {
          if (transport && transport.parentNode)
            transport.parentNode.removeChild(transport);
          if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
        }, 5000);
        resolve();
      } catch (err) {
        if (transport && transport.parentNode)
          transport.parentNode.removeChild(transport);
        if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
        reject(err);
      }
    });
  }

  function postGoogle(root, params) {
    if (TK.boolAttr(root, "data-demo", false)) {
      return new Promise(function (resolve) {
        window.setTimeout(resolve, 250);
      });
    }

    var action = googleAction(root);
    if (!action)
      return Promise.reject(new Error("invalid Google Form action URL"));

    if (window.fetch && window.URLSearchParams) {
      return window
        .fetch(action, {
          method: "POST",
          mode: "no-cors",
          body: params,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        })
        .catch(function () {
          return iframePost(action, params);
        });
    }
    return iframePost(action, params);
  }

  function fieldError(host, message) {
    host.toggleAttribute("data-invalid", !!message);
    var error = TK.qs(host, ".tk-form__error");
    if (error) error.textContent = message || "";
  }

  function commonControlAttrs(host, id, type) {
    var required = TK.boolAttr(host, "data-required", false);
    var attrs = {
      id: id,
      name: TK.attr(host, "data-field", ""),
      "aria-required": required ? "true" : null,
      required: required ? true : null,
    };
    if (type) attrs.type = type;
    var autocomplete = TK.attr(host, "data-autocomplete", "");
    if (autocomplete) attrs.autocomplete = autocomplete;
    return attrs;
  }

  function choiceGroup(host, id, type, labelId) {
    var field = TK.attr(host, "data-field", "");
    var required = TK.boolAttr(host, "data-required", false);
    var choices = TK.make("div", {
      cls: "tk-form__choices",
      attrs: {
        role: type === "radio" ? "radiogroup" : "group",
        "aria-labelledby": labelId,
        "aria-required": required ? "true" : null,
      },
    });
    var values = TK.splitList(TK.attr(host, "data-options", ""), "|");
    if (!values.length)
      throw new Error('field "' + field + '" needs data-options');

    values.forEach(function (value, index) {
      var input = TK.make("input", {
        cls: "tk-form__choice",
        attrs: {
          id: id + "-" + index,
          type: type,
          name: field,
          value: value,
        },
      });
      choices.appendChild(
        TK.make("label", {
          cls: "tk-form__choice-row",
          attrs: { for: input.id },
          kids: [input, TK.make("span", { text: value })],
        }),
      );
    });
    return choices;
  }

  function renderField(host, index) {
    var field = TK.attr(host, "data-field", "");
    var labelText = TK.attr(host, "data-label", "");
    if (!field || !labelText)
      throw new Error("every form field needs data-field and data-label");

    var id = TK.uid("tk-field");
    var label = TK.make("label", {
      cls: "tk-form__label",
      text: labelText,
      attrs: { id: id + "-label", for: id },
    });
    if (TK.boolAttr(host, "data-required", false))
      label.setAttribute("data-required", "1");

    var rawType = TK.attr(host, "data-type", "text").toLowerCase();
    var type = rawType === "true-false" ? "radio" : rawType;
    var control;

    if (type === "textarea") {
      control = TK.make("textarea", {
        cls: "tk-form__control",
        attrs: commonControlAttrs(host, id, null),
      });
      control.setAttribute(
        "rows",
        String(Math.max(2, TK.intAttr(host, "data-rows", 4))),
      );
    } else if (type === "select") {
      control = TK.make("select", {
        cls: "tk-form__control",
        attrs: commonControlAttrs(host, id, null),
      });
      control.appendChild(
        TK.make("option", {
          text: TK.attr(host, "data-placeholder", "Choose one"),
          attrs: { value: "", selected: true, disabled: true },
        }),
      );
      TK.splitList(TK.attr(host, "data-options", ""), "|").forEach(
        function (value) {
          control.appendChild(
            TK.make("option", { text: value, attrs: { value: value } }),
          );
        },
      );
      if (control.options.length < 2)
        throw new Error('field "' + field + '" needs data-options');
    } else if (type === "radio" || type === "checkbox") {
      control = choiceGroup(host, id, type, label.id);
      label.removeAttribute("for");
    } else {
      var safeTypes = ["text", "email", "url", "tel", "number", "date"];
      if (safeTypes.indexOf(type) === -1) type = "text";
      control = TK.make("input", {
        cls: "tk-form__control",
        attrs: commonControlAttrs(host, id, type),
      });
      var placeholder = TK.attr(host, "data-placeholder", "");
      if (placeholder) control.setAttribute("placeholder", placeholder);
    }

    var error = TK.make("span", {
      cls: "tk-form__error",
      attrs: { id: id + "-error", "aria-live": "polite" },
    });
    if (control.setAttribute)
      control.setAttribute("aria-describedby", error.id);

    var fallback = TK.qs(host, ".tk-form__fallback");
    if (fallback) fallback.hidden = true;
    host.appendChild(label);
    host.appendChild(control);
    host.appendChild(error);
  }

  function validateForm(root) {
    var firstInvalid = null;
    fieldHosts(root).forEach(function (host) {
      fieldError(host, "");
      var required = TK.boolAttr(host, "data-required", false);
      var controls = TK.qsa(host, ".tk-form__control, .tk-form__choice");
      var message = "";

      if (required) {
        var hasValue = controls.some(function (control) {
          if (control.type === "radio" || control.type === "checkbox")
            return control.checked;
          return String(control.value || "").trim().length > 0;
        });
        if (!hasValue)
          message = TK.attr(host, "data-error", "This field is required.");
      }

      if (!message) {
        controls.some(function (control) {
          if (control.checkValidity && !control.checkValidity()) {
            message = TK.attr(host, "data-error", "Enter a valid value.");
            return true;
          }
          return false;
        });
      }

      if (message) {
        fieldError(host, message);
        if (!firstInvalid) firstInvalid = controls[0] || host;
      }
    });

    if (firstInvalid && firstInvalid.focus) firstInvalid.focus();
    return !firstInvalid;
  }

  function formParams(root) {
    var params = new window.URLSearchParams();
    TK.qsa(root, ".tk-form__control, .tk-form__choice").forEach(
      function (control) {
        if (!control.name || control.disabled) return;
        if (
          (control.type === "radio" || control.type === "checkbox") &&
          !control.checked
        )
          return;
        var value = String(control.value || "").trim();
        if (value) params.append(control.name, value);
      },
    );
    return params;
  }

  function cooldownRemaining(root, tool) {
    var seconds = Math.max(0, TK.intAttr(root, "data-cooldown", 30));
    var last = parseInt(
      TK.store.get(TK.blockKey(root, tool) + ":sent") || "0",
      10,
    );
    return Math.max(0, seconds - Math.floor((Date.now() - last) / 1000));
  }

  function markSent(root, tool) {
    TK.store.set(TK.blockKey(root, tool) + ":sent", String(Date.now()));
  }

  function initialiseGform(el) {
    var hosts = fieldHosts(el);
    if (!hosts.length) throw new Error("no .tk-form__field definitions");
    el.setAttribute("data-tk-started", String(Date.now()));

    var form = TK.make("form", {
      cls: "tk-form__form",
      act: "gform-submit",
      attrs: { novalidate: true },
    });
    hosts.forEach(function (host, index) {
      renderField(host, index);
      form.appendChild(host);
    });

    form.appendChild(
      TK.make("div", {
        cls: "tk-form__trap",
        attrs: { "aria-hidden": "true" },
        kids: [
          TK.make("label", {
            text: "Leave this field empty",
            kids: [
              TK.make("input", {
                cls: "tk-form__honeypot",
                attrs: {
                  type: "text",
                  name: TK.attr(el, "data-honeypot", "tk_company"),
                  tabindex: "-1",
                  autocomplete: "off",
                },
              }),
            ],
          }),
        ],
      }),
    );
    form.appendChild(
      TK.make("button", {
        cls: "tk-ctl tk-form__submit",
        text: TK.attr(el, "data-submit-label", "Send"),
        attrs: { type: "submit" },
      }),
    );
    form.appendChild(
      TK.make("p", {
        cls: "tk-form__status",
        attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
      }),
    );
    el.appendChild(form);
  }

  TK.register("gform", initialiseGform);

  TK.action(
    "gform-submit",
    function (form, ev, root) {
      ev.preventDefault();
      if (root.getAttribute("data-state") === "submitting") return;

      var submit = TK.qs(root, ".tk-form__submit");
      var honeypot = TK.qs(root, ".tk-form__honeypot");
      if (honeypot && honeypot.value) {
        setStatus(
          root,
          "success",
          TK.attr(root, "data-success", "Thanks — sent."),
        );
        return;
      }

      var minTime = Math.max(0, TK.intAttr(root, "data-min-time", 3)) * 1000;
      var started = parseInt(root.getAttribute("data-tk-started") || "0", 10);
      if (Date.now() - started < minTime) {
        setStatus(
          root,
          "error",
          TK.attr(root, "data-too-fast", "Please wait a moment and try again."),
        );
        return;
      }

      var remaining = cooldownRemaining(root, "gform");
      if (remaining > 0) {
        setStatus(
          root,
          "error",
          "Please wait " + remaining + " seconds before sending again.",
        );
        return;
      }
      if (!validateForm(root)) {
        setStatus(
          root,
          "error",
          TK.attr(root, "data-invalid", "Check the highlighted fields."),
        );
        return;
      }

      setStatus(root, "submitting", TK.attr(root, "data-sending", "Sending…"));
      if (submit) submit.disabled = true;
      postGoogle(root, formParams(root))
        .then(function () {
          markSent(root, "gform");
          form.reset();
          setStatus(
            root,
            "success",
            TK.attr(root, "data-success", "Thanks — sent."),
          );
        })
        .catch(function (err) {
          TK.warn(
            "Google Form submission failed: " + (err && err.message),
            root,
          );
          setStatus(
            root,
            "error",
            TK.attr(root, "data-error", "Could not send. Please try again."),
          );
        })
        .then(function () {
          if (submit) submit.disabled = false;
        });
    },
    "submit",
  );

  /* Legacy feedback blocks stored native controls in CKEditor content. New
     blocks use `gform`, but preserve old posts by converting their in-memory
     DOM into the same inert-field contract before rendering the controls.
     The database markup is never rewritten in a page view. */
  function legacyFeedbackMap(el) {
    var mapping = {};
    var raw = TK.attr(el, "data-fields", "");
    if (raw) {
      try {
        mapping = JSON.parse(raw) || {};
      } catch (e) {
        mapping = {};
      }
    }
    if (!Object.keys(mapping).length) {
      ["name", "email", "topic", "message"].forEach(function (key) {
        var entry = TK.attr(el, "data-" + key, "");
        if (entry) mapping[key] = entry;
      });
    }
    return mapping;
  }

  function legacyFieldType(control) {
    if (control.tagName === "TEXTAREA") return "textarea";
    if (control.tagName === "SELECT") return "select";
    return String(control.getAttribute("type") || "text").toLowerCase();
  }

  function migrateLegacyFeedback(el) {
    var mapping = legacyFeedbackMap(el);
    var hosts = fieldHosts(el);
    var oldFields = TK.qs(el, ".tk-form__fields");
    if (!hosts.length) throw new Error("legacy feedback has no fields");

    var success = TK.attr(el, "data-success-msg", "");
    var error = TK.attr(el, "data-error-msg", "");
    if (success && !el.hasAttribute("data-success"))
      el.setAttribute("data-success", success);
    if (error && !el.hasAttribute("data-error")) el.setAttribute("data-error", error);

    hosts.forEach(function (host) {
      var control = TK.qs(host, "input, textarea, select");
      var label = TK.qs(host, "label");
      var key = control && control.getAttribute("data-field");
      var entry = key && mapping[key];
      if (!control || !label || !/^entry\.\d+$/.test(entry || ""))
        throw new Error("legacy feedback field is missing a Google Forms entry id");

      var labelText = String(label.textContent || "")
        .replace(/\s*\(optional\)\s*/i, "")
        .trim();
      var required = control.hasAttribute("required");
      host.setAttribute("data-field", entry);
      host.setAttribute("data-type", legacyFieldType(control));
      host.setAttribute("data-label", labelText || "Field");
      host.setAttribute("data-required", required ? "yes" : "no");
      if (control.getAttribute("placeholder"))
        host.setAttribute("data-placeholder", control.getAttribute("placeholder"));
      if (legacyFieldType(control) === "textarea" && control.getAttribute("rows"))
        host.setAttribute("data-rows", control.getAttribute("rows"));

      host.innerHTML = "";
      host.appendChild(
        TK.make("p", {
          cls: "tk-form__fallback",
          text:
            labelText +
            ". " +
            (required ? "Required field." : "Optional field."),
        }),
      );
    });

    TK.qsa(el, ".tk-form__status, .tk-form__actions").forEach(function (node) {
      node.parentNode.removeChild(node);
    });
    initialiseGform(el);
    if (oldFields && !oldFields.children.length && oldFields.parentNode)
      oldFields.parentNode.removeChild(oldFields);
  }

  TK.register("feedback", migrateLegacyFeedback);

  TK.register("rating", function (el) {
    var field = TK.attr(el, "data-field", "");
    if (!field) throw new Error("rating needs data-field");

    var controls = TK.make("div", {
      cls: "tk-rating__controls",
      attrs: {
        role: "group",
        "aria-label": TK.attr(el, "data-label", "Rate this content"),
      },
    });
    [
      [
        "up",
        TK.attr(el, "data-up-label", "Helpful"),
        TK.attr(el, "data-up-value", "up"),
      ],
      [
        "down",
        TK.attr(el, "data-down-label", "Not helpful"),
        TK.attr(el, "data-down-value", "down"),
      ],
    ].forEach(function (item) {
      controls.appendChild(
        TK.make("button", {
          cls: "tk-ctl tk-rating__button tk-rating__button--" + item[0],
          act: "rating-pick",
          text: item[1],
          attrs: {
            type: "button",
            "aria-pressed": "false",
            "data-tk-value": item[2],
          },
        }),
      );
    });
    el.appendChild(controls);
    el.appendChild(
      TK.make("p", {
        cls: "tk-rating__status",
        attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
      }),
    );

    var saved = TK.store.get(TK.blockKey(el, "rating") + ":vote");
    if (saved) {
      TK.qsa(el, ".tk-rating__button").forEach(function (button) {
        var selected = button.getAttribute("data-tk-value") === saved;
        button.setAttribute("aria-pressed", selected ? "true" : "false");
        button.disabled = true;
      });
      setStatus(
        el,
        "success",
        TK.attr(el, "data-success", "Thanks for the feedback."),
      );
    }
  });

  TK.action("rating-pick", function (button, ev, root) {
    if (root.getAttribute("data-state") === "submitting") return;
    var remaining = cooldownRemaining(root, "rating");
    if (remaining > 0) {
      setStatus(
        root,
        "error",
        "Please wait " + remaining + " seconds before voting again.",
      );
      return;
    }

    var value = button.getAttribute("data-tk-value");
    var params = new window.URLSearchParams();
    params.append(TK.attr(root, "data-field", ""), value);
    setStatus(root, "submitting", TK.attr(root, "data-sending", "Sending…"));
    TK.qsa(root, ".tk-rating__button").forEach(function (item) {
      item.disabled = true;
    });

    postGoogle(root, params)
      .then(function () {
        markSent(root, "rating");
        TK.store.set(TK.blockKey(root, "rating") + ":vote", value);
        TK.qsa(root, ".tk-rating__button").forEach(function (item) {
          item.setAttribute(
            "aria-pressed",
            item.getAttribute("data-tk-value") === value ? "true" : "false",
          );
        });
        setStatus(
          root,
          "success",
          TK.attr(root, "data-success", "Thanks for the feedback."),
        );
      })
      .catch(function (err) {
        TK.warn("rating submission failed: " + (err && err.message), root);
        TK.qsa(root, ".tk-rating__button").forEach(function (item) {
          item.disabled = false;
        });
        setStatus(
          root,
          "error",
          TK.attr(root, "data-error", "Could not send. Please try again."),
        );
      });
  });

  // Quiz reporting is opt-in. data-report names the Google Forms entry field;
  // data-action is the same formResponse URL used by the form and rating tools.
  document.addEventListener("tk:quiz-complete", function (ev) {
    var root =
      ev.target && ev.target.closest
        ? ev.target.closest('[data-tk="quiz"]')
        : null;
    if (!root) return;
    var field = TK.attr(root, "data-report", "");
    if (!field) return;

    var detail = ev.detail || {};
    var params = new window.URLSearchParams();
    params.append(
      field,
      String(detail.correct || 0) +
        "/" +
        String(detail.total || 0) +
        " (" +
        String(detail.percent || 0) +
        "%), best " +
        String(detail.best || 0) +
        "%",
    );
    postGoogle(root, params).catch(function (err) {
      TK.warn("quiz report failed: " + (err && err.message), root);
    });
  });
})(window.ContentTools);
