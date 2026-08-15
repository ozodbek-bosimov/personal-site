// Resolve the current search modal from the document: HTMX history restores
// re-create it from a snapshot, so a closure holding one reference would go
// stale (the same bug class as the lightbox).
function currentSearchModal() {
  return document.querySelector(".searchModal") || null;
}

// Remember which button opened the modal so focus can be returned on close.
// `var` (not `let`): htmx re-executes this script on every boosted swap, and
// a top-level `let` would throw "already declared" on the second run, killing
// the whole script.
var searchOpener = null;

function initApp(root = document) {
  // ── Hover Reset (bfcache / tap residue) ───────────────────────────
  // Touch browsers keep a sticky :hover highlight after a tap or a
  // bfcache restore. Momentarily disabling pointer-events on <body>
  // forces the browser to re-evaluate and clear those hover states.
  // Removal is scheduled on the next animation frame AND backed by a
  // timeout, so the class can never stick if requestAnimationFrame is
  // throttled (e.g. the tab is in the background) — a stuck
  // `no-hover-reset` would make the whole page unclickable.
  function applyHoverReset() {
    document.body.classList.add("no-hover-reset");
    const clear = function () {
      document.body.classList.remove("no-hover-reset");
    };
    requestAnimationFrame(clear);
    setTimeout(clear, 120);
  }

  // Back to Top Button
  // Init guards are JS-only properties (not data-* attributes): HTMX history
  // snapshots serialize data attributes, so a restored page would carry the
  // "initialized" mark while its listeners live on the pre-restore elements.
  const backToTopBtn = document.getElementById("back-to-top");
  if (backToTopBtn && !backToTopBtn._initialized) {
    backToTopBtn._initialized = true;
    window.addEventListener(
      "scroll",
      function () {
        if (window.scrollY > 400) {
          backToTopBtn.classList.add("visible");
        } else {
          backToTopBtn.classList.remove("visible");
        }
      },
      { passive: true },
    );

    backToTopBtn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
      backToTopBtn.classList.add("fly-animation");
      backToTopBtn.blur();
      setTimeout(() => {
        backToTopBtn.classList.remove("fly-animation");
      }, 800);
    });
  }

  // Mobile Menu
  const toggleButton = root.querySelector(".nav-btn");
  const navbarContent = root.querySelector(".mob-nav");

  if (toggleButton && navbarContent && !toggleButton._initialized) {
    toggleButton._initialized = true;
    function toggleMobileMenu() {
      // translate-x-full is the hidden state, so this reads "was it closed?"
      const wasHidden = navbarContent.classList.contains("translate-x-full");
      if (wasHidden) {
        navbarContent.classList.remove("translate-x-full", "opacity-0");
        toggleButton.setAttribute("aria-expanded", "true");
      } else {
        closeMobileMenu();
      }
    }

    toggleButton.addEventListener("click", toggleMobileMenu);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !navbarContent.classList.contains("translate-x-full")) {
        closeMobileMenu();
      }
    });

    function closeMobileMenu() {
      navbarContent.classList.add("translate-x-full", "opacity-0");
      toggleButton.setAttribute("aria-expanded", "false");
      // The tap that opened the menu leaves the button with a sticky hover
      // highlight on touch screens. Clear it so the button does not stay
      // "lit" after the menu closes itself (e.g. on scroll).
      toggleButton.blur();
      applyHoverReset();
    }

    root.querySelectorAll(".mob-nav a").forEach((link) => {
      link.addEventListener("click", closeMobileMenu);
    });

    document.addEventListener("click", (event) => {
      if (
        !navbarContent.contains(event.target) &&
        !toggleButton.contains(event.target)
      ) {
        closeMobileMenu();
      }
    });

    window.addEventListener("scroll", closeMobileMenu, { passive: true });
  }

  // Search Modal
  // HTMX history restores re-create the modal element, so every handler
  // resolves the current element from the document instead of holding a
  // stale reference.
  const searchBtns = root.querySelectorAll(".searchBtn, .searchBtn1");
  const searchModal = currentSearchModal();
  const searchCloseBtn = searchModal?.querySelector(".searchCloseBtn");

  function showSearchModal() {
    const modal = currentSearchModal();
    if (!modal) return;
    // Remember which button opened the modal so focus can be returned on close.
    searchOpener = document.activeElement;
    modal.style.display = "block";
    document.body.classList.add("search-open");
    const input = modal.querySelector(".searchInput");
    // Delay focus so the modal entry animation finishes first.
    // On mobile this prevents the keyboard from pushing the modal off-screen.
    setTimeout(() => {
      if (input) input.focus({ preventScroll: true });
    }, 320);
  }

  function hideSearchModal() {
    const modal = currentSearchModal();
    if (modal) {
      modal.style.display = "none";
      document.body.classList.remove("search-open");
      const input = modal.querySelector(".searchInput");
      if (input) input.value = "";
    }
    // Return focus to the element that opened the dialog, if it still exists.
    if (searchOpener && document.contains(searchOpener)) {
      searchOpener.focus();
    }
    searchOpener = null;
  }

  // Trap Tab / Shift+Tab inside the open dialog so keyboard focus cannot
  // escape the aria-modal container (Escape already closes it).
  function trapSearchFocus(event) {
    const modal = currentSearchModal();
    if (!modal || modal.style.display !== "block") return;
    if (event.key !== "Tab") return;
    const focusables = modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function submitSearchForm(event) {
    const modal = currentSearchModal();
    const input = modal && modal.querySelector(".searchInput");
    if (!input) return;
    const searchQuery = input.value.trim();
    if (!searchQuery) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      input.classList.add("shake");
      setTimeout(() => {
        input.classList.remove("shake");
      }, 500);
    }
  }

  if (searchModal && !searchModal._initialized) {
    searchModal._initialized = true;
    searchBtns.forEach((btn) => btn.addEventListener("click", showSearchModal));

    if (searchCloseBtn) {
      searchCloseBtn.addEventListener("click", hideSearchModal);
    }

    const searchForm = searchModal.querySelector("form");
    if (searchForm) {
      searchForm.addEventListener("submit", submitSearchForm);
    }
  }

  // Window-level listeners are attached exactly once per page load — initApp
  // re-runs after every HTMX history restore, and each run would otherwise
  // stack another Escape / overlay-click / focus-trap handler. They resolve
  // the current modal from the document, so one binding serves every restore.
  if (!window.__searchModalGlobalListeners) {
    window.__searchModalGlobalListeners = true;
    window.addEventListener("click", (event) => {
      const modal = currentSearchModal();
      const overlay = modal && modal.querySelector(".searchModal-overlay");
      if (event.target === modal || event.target === overlay) {
        hideSearchModal();
      }
    });

    window.addEventListener("keydown", (event) => {
      const modal = currentSearchModal();
      if (event.key === "Escape" && modal && modal.style.display === "block") {
        hideSearchModal();
      }
    });

    // Focus containment for the aria-modal dialog (added after Escape so it
    // never intercepts that key).
    window.addEventListener("keydown", trapSearchFocus);
  }

  // ── Scroll Reveal Animations ──────────────────────────────────────
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root
      .querySelectorAll(".reveal:not(.reveal-visible), .reveal-fade:not(.reveal-visible), .reveal-scale:not(.reveal-visible), .reveal-left:not(.reveal-visible)")
      .forEach(function (el) {
        el.classList.add("reveal-visible");
      });
  } else {
    root.querySelectorAll(".reveal-stagger").forEach(function (parent) {
      var children = parent.querySelectorAll(
        ":scope > .reveal, :scope > .reveal-scale, :scope > .reveal-fade, :scope > .reveal-left",
      );
      children.forEach(function (child, i) {
        child.style.setProperty("--reveal-i", i);
      });
    });

    if (!("IntersectionObserver" in window)) {
      root
        .querySelectorAll(".reveal, .reveal-fade, .reveal-scale, .reveal-left")
        .forEach(function (el) {
          el.classList.add("reveal-visible");
        });
    } else {
      var observer = new IntersectionObserver(
        function (entries, obs) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting || entry.boundingClientRect.top < window.innerHeight) {
              entry.target.classList.add("reveal-visible");
              obs.unobserve(entry.target);
            }
          });
        },
        {
          threshold: 0.01,
          rootMargin: "0px 0px 0px 0px",
        },
      );

      root
        .querySelectorAll(".reveal:not(.reveal-visible), .reveal-fade:not(.reveal-visible), .reveal-scale:not(.reveal-visible), .reveal-left:not(.reveal-visible)")
        .forEach(function (el) {
          observer.observe(el);
        });
    }
  }

  // ── Mobile Touch Fix ──────────────────────────────────────────────
  var isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (isTouch && !document.body.dataset.touchFixed) {
    document.body.dataset.touchFixed = "true";
    var interactive =
      "a, button, .glass-card, .btn-icon, .btn-primary, .btn-ghost, " +
      ".btn-hero-primary, .btn-hero-ghost, .btn-pagination, " +
      ".solid-content-card, .profile-card";

    window.addEventListener("pagehide", function () {
      if (document.activeElement) document.activeElement.blur();
    });

    window.addEventListener("pageshow", function () {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      applyHoverReset();
    });

    var tappedEl = null;
    var clearTimer = null;

    document.addEventListener(
      "touchstart",
      function (e) {
        var el = e.target.closest(interactive);
        if (!el || el.closest("[data-image-lightbox], .project-image-preview-trigger, .image-lightbox-trigger, .nav-btn, .searchBtn, .searchBtn1, .timeline-header-link, .timeline-card-header, .timeline-role-content")) return;

        if (tappedEl && tappedEl !== el) {
          tappedEl.classList.remove("tapped");
        }

        tappedEl = el;
        el.classList.add("tapped");

        clearTimeout(clearTimer);
        clearTimer = setTimeout(function () {
          if (tappedEl) {
            tappedEl.classList.remove("tapped");
            tappedEl = null;
          }
        }, 400);
      },
      { passive: true },
    );

    document.addEventListener(
      "touchend",
      function () {
        if (!tappedEl) return;
        var el = tappedEl;

        clearTimeout(clearTimer);
        setTimeout(function () {
          el.classList.remove("tapped");
          el.blur();
          tappedEl = null;
        }, 150);
      },
      { passive: true },
    );

    document.addEventListener(
      "touchmove",
      function () {
        if (tappedEl) {
          tappedEl.classList.remove("tapped");
          tappedEl = null;
          clearTimeout(clearTimer);
        }
      },
      { passive: true },
    );
  }
}

// Run immediately — this script is loaded at the end of <body>, so DOM is ready
initApp(document);

// Re-initialize after HTMX swaps in new content
if (!window._baseListenerAdded) {
  window._baseListenerAdded = true;

  // Regular boosted navigation: the server HTML is swapped in and scripts
  // re-run, but initApp still needs re-invoking for the fresh nodes.
  document.addEventListener("htmx:afterSettle", function(event) {
    if (document.body) {
      document.body.classList.remove("image-lightbox-open", "search-open");
    }
    initApp(event.target);
  });

  // Browser back/forward: htmx 2.0 restores the page from its history cache
  // and fires ONLY htmx:historyRestore (htmx:afterSettle and htmx:restored
  // do not fire here, and external scripts are not re-executed), so every
  // interaction bound on the pre-restore elements would be gone. Re-run
  // initApp against the restored DOM — the _initialized flags are JS-only
  // properties, so they never survive the snapshot round-trip and nothing
  // is skipped. Also reset transient UI state that got frozen into the
  // snapshot (open modals, sticky hover classes).
  document.addEventListener("htmx:historyRestore", function () {
    if (document.body) {
      document.body.classList.remove("image-lightbox-open", "search-open", "no-hover-reset");
    }
    var searchModalEl = document.querySelector(".searchModal");
    if (searchModalEl && searchModalEl.style.display === "block") {
      searchModalEl.style.display = "none";
      var searchInputEl = searchModalEl.querySelector(".searchInput");
      if (searchInputEl) searchInputEl.value = "";
    }
    var mobNavEl = document.querySelector(".mob-nav");
    if (mobNavEl) {
      mobNavEl.classList.add("translate-x-full", "opacity-0");
      var navToggleEl = document.querySelector(".nav-btn");
      if (navToggleEl) navToggleEl.setAttribute("aria-expanded", "false");
    }
    var backToTopEl = document.getElementById("back-to-top");
    if (backToTopEl) backToTopEl.classList.remove("visible", "fly-animation");
    initApp(document);
  });
}

// ── Rasmlarni drag qilishni to'xtatish ─────────────────────────────
// CSS `-webkit-user-drag` Firefox'da ishlamaydi, shuning uchun document
// darajasida `dragstart`ni bloklaymiz. Delegated listener bo'lgani uchun
// HTMX swap'dan keyin kelgan yangi rasmlarga ham amal qiladi.
// hx-boost body'ni yangilaganda skript qayta ishga tushishi mumkin —
// flag bilan listener bir marta ro'yxatga olinishini kafolatlaymiz.
if (!window.__imgDragBlocked) {
  window.__imgDragBlocked = true;
  document.addEventListener("dragstart", function (event) {
    var el = event.target;
    if (el && el.nodeType === 1 && el.closest("img, picture, svg")) {
      event.preventDefault();
    }
  });
}
