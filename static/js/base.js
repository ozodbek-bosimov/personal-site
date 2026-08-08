function initApp(root = document) {
  // Back to Top Button
  const backToTopBtn = document.getElementById("back-to-top");
  if (backToTopBtn && !backToTopBtn.dataset.initialized) {
    backToTopBtn.dataset.initialized = "true";
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

  if (toggleButton && navbarContent && !toggleButton.dataset.initialized) {
    toggleButton.dataset.initialized = "true";
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
      document.body.classList.add("no-hover-reset");
      requestAnimationFrame(function () {
        document.body.classList.remove("no-hover-reset");
      });
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
  const searchBtns = root.querySelectorAll(".searchBtn, .searchBtn1");
  const searchModal = root.querySelector(".searchModal") || document.querySelector(".searchModal");
  const searchCloseBtn = searchModal?.querySelector(".searchCloseBtn");
  const searchInput = searchModal?.querySelector(".searchInput");
  const searchModalOverlay = searchModal?.querySelector(".searchModal-overlay");

  // Remember which button opened the modal so focus can be returned on close.
  let searchOpener = null;

  function showSearchModal() {
    if (!searchModal) return;
    searchOpener = document.activeElement;
    searchModal.style.display = "block";
    document.body.classList.add("search-open");
    // Delay focus so the modal entry animation finishes first.
    // On mobile this prevents the keyboard from pushing the modal off-screen.
    setTimeout(() => {
      if (searchInput) searchInput.focus({ preventScroll: true });
    }, 320);
  }

  function hideSearchModal() {
    if (searchModal) {
      searchModal.style.display = "none";
      document.body.classList.remove("search-open");
      if (searchInput) searchInput.value = "";
    }
    // Return focus to the element that opened the dialog, if it still exists.
    if (searchOpener && document.contains(searchOpener)) {
      searchOpener.focus();
      searchOpener = null;
    }
  }

  // Trap Tab / Shift+Tab inside the open dialog so keyboard focus cannot
  // escape the aria-modal container (Escape already closes it).
  function trapSearchFocus(event) {
    if (!searchModal || searchModal.style.display !== "block") return;
    if (event.key !== "Tab") return;
    const focusables = searchModal.querySelectorAll(
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
    if (!searchInput) return;
    const searchQuery = searchInput.value.trim();
    if (!searchQuery) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      searchInput.classList.add("shake");
      setTimeout(() => {
        searchInput.classList.remove("shake");
      }, 500);
    }
  }

  if (searchModal && !searchModal.dataset.initialized) {
    searchModal.dataset.initialized = "true";
    searchBtns.forEach((btn) => btn.addEventListener("click", showSearchModal));

    if (searchCloseBtn) {
      searchCloseBtn.addEventListener("click", hideSearchModal);
    }

    const searchForm = searchModal.querySelector("form");
    if (searchForm) {
      searchForm.addEventListener("submit", submitSearchForm);
    }

    window.addEventListener("click", (event) => {
      if (event.target === searchModal || event.target === searchModalOverlay) {
        hideSearchModal();
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && searchModal.style.display === "block") {
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
      document.body.classList.add("no-hover-reset");
      requestAnimationFrame(function () {
        document.body.classList.remove("no-hover-reset");
      });
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
document.addEventListener("htmx:afterSettle", function(event) {
  if (document.body) {
    document.body.classList.remove("image-lightbox-open", "search-modal-open");
  }
  initApp(event.target);
});

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
