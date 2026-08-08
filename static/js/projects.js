// Project description "more / less" toggle.
//
// Goals:
//   • Preserve the author's own line breaks (rendered via white-space: pre-line).
//   • Show at most 3 lines collapsed, with "... more" sitting INLINE at the end
//     of the 3rd line (never dropping onto its own line).
//   • When expanded, "less" sits INLINE right after the last word.
//   • The "more" button only appears when the text is actually longer than
//     3 lines.
(function () {
  "use strict";

  function lineHeightOf(el) {
    var cs = getComputedStyle(el);
    var lh = parseFloat(cs.lineHeight);
    if (isNaN(lh)) {
      lh = parseFloat(cs.fontSize) * 1.625;
    }
    return lh;
  }

  function buildToggle(label, withEllipsis) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "project-desc-toggle";
    if (withEllipsis) {
      var ell = document.createElement("span");
      ell.className = "project-desc-ellipsis";
      ell.textContent = "\u2026 "; // "… "
      btn.appendChild(ell);
    } else {
      // No leading ellipsis (the "less" button) — give it a small gap
      // so it doesn't butt right up against the final word.
      btn.classList.add("project-desc-toggle--gap");
    }
    btn.appendChild(document.createTextNode(label));
    return btn;
  }

  function setupCard(desc) {
    var full = desc.getAttribute("data-fulltext");
    if (full === null) {
      full = desc.textContent;
      desc.setAttribute("data-fulltext", full);
    }

    // Reset the element to a single text span we control.
    desc.classList.remove("is-clamped");
    desc.textContent = "";
    var textSpan = document.createElement("span");
    textSpan.className = "project-desc-text";
    desc.appendChild(textSpan);

    var maxH = lineHeightOf(desc) * 3 + 1;

    // Does the full text already fit within 3 lines? Then no toggle needed.
    textSpan.textContent = full;
    if (desc.scrollHeight <= maxH) {
      return;
    }

    // Word-boundary cut points (char index just after each word).
    var wordEnds = [];
    var re = /\S+/g;
    var m;
    while ((m = re.exec(full)) !== null) {
      wordEnds.push(m.index + m[0].length);
    }
    if (wordEnds.length === 0) return;

    var moreBtn = buildToggle("more", true);
    var lessBtn = buildToggle("less", false);

    function measureFits(len) {
      textSpan.textContent = full.slice(0, len).replace(/\s+$/, "");
      return desc.scrollHeight <= maxH;
    }

    // Binary search for the largest prefix that still fits in 3 lines
    // WITH the "more" button present at the end.
    function computeCut() {
      desc.appendChild(moreBtn); // present while measuring
      var lo = 0;
      var hi = wordEnds.length - 1;
      var best = wordEnds[0];
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (measureFits(wordEnds[mid])) {
          best = wordEnds[mid];
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return best;
    }

    var cutLen = computeCut();

    function collapse() {
      desc.classList.remove("is-expanded");
      textSpan.textContent = full.slice(0, cutLen).replace(/\s+$/, "");
      if (lessBtn.parentNode) lessBtn.remove();
      desc.appendChild(moreBtn);
    }

    function expand() {
      desc.classList.add("is-expanded");
      textSpan.textContent = full;
      if (moreBtn.parentNode) moreBtn.remove();
      desc.appendChild(lessBtn);
    }

    moreBtn.addEventListener("click", expand);
    lessBtn.addEventListener("click", collapse);

    // Start collapsed.
    collapse();
    // Remember expanded state across resizes.
    desc._collapse = collapse;
    desc._expand = expand;
    desc._recompute = function () {
      var wasExpanded = desc.classList.contains("is-expanded");
      maxH = lineHeightOf(desc) * 3 + 1;
      cutLen = computeCut();
      if (wasExpanded) {
        expand();
      } else {
        collapse();
      }
    };
  }

  function setupAll() {
    document.querySelectorAll(".project-desc").forEach(setupCard);
  }

  let _projectsInitTimer = null;
  function debouncedSetupAll() {
    if (_projectsInitTimer) clearTimeout(_projectsInitTimer);
    _projectsInitTimer = setTimeout(setupAll, 50);
  }

  // Run immediately for initial page load
  setTimeout(debouncedSetupAll, 10);

  if (!window._projectsListenerAdded) {
    document.body.addEventListener("htmx:afterSettle", function () {
      if (window.location.pathname.includes('/projects')) {
        debouncedSetupAll();
      }
    });
    document.body.addEventListener("htmx:restored", function () {
      if (window.location.pathname.includes('/projects')) {
        debouncedSetupAll();
      }
    });
    window._projectsListenerAdded = true;
  }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      document.querySelectorAll(".project-desc").forEach(function (desc) {
        if (typeof desc._recompute === "function") {
          desc._recompute();
        } else {
          setupCard(desc);
        }
      });
    }, 150);
  });
})();

// ══════════════════════════════════════════════════════════════════════
// Project card gallery
//
// The track is a native scroll-snap container, so touch swipes and
// trackpad gestures already work with zero JS.  This layer adds what the
// browser does not give for free:
//   • mouse / pen dragging (grab & pull the image)
//   • prev / next arrows with end-of-list disabling
//   • clickable dots to jump straight to a slide
//   • keyboard control (arrows, Home, End) when the track is focused
//   • screen-reader announcements of the current slide
// Scroll position stays the single source of truth: whatever moves the
// track (native swipe, wheel, drag, dot) flows through the same update.
// ══════════════════════════════════════════════════════════════════════
(function () {
  "use strict";

  var DRAG_THRESHOLD = 8; // px before a press counts as a drag
  var SWIPE_RATIO = 0.15; // fraction of slide width that advances a slide

  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function setupGallery(root) {
    if (root.dataset.galleryReady === "1") return;

    var viewport = root.querySelector("[data-gallery-viewport]");
    if (!viewport) return;

    var slides = Array.prototype.slice.call(
      root.querySelectorAll("[data-gallery-slide]"),
    );
    if (slides.length < 2) return;

    var dots = Array.prototype.slice.call(
      root.querySelectorAll("[data-gallery-dot]"),
    );
    var prevBtn = root.querySelector("[data-gallery-prev]");
    var nextBtn = root.querySelector("[data-gallery-next]");
    var live = root.querySelector("[data-gallery-live]");

    root.dataset.galleryReady = "1";

    var total = slides.length;
    var current = 0;

    function slideWidth() {
      // Measured rather than assumed: the card width changes across
      // breakpoints and during HTMX swaps.
      return viewport.clientWidth || 1;
    }

    function indexFromScroll() {
      return Math.round(viewport.scrollLeft / slideWidth());
    }

    function clamp(i) {
      return Math.max(0, Math.min(total - 1, i));
    }

    function render(index) {
      current = index;

      dots.forEach(function (dot, i) {
        var active = i === index;
        dot.classList.toggle("is-active", active);
        dot.setAttribute("aria-selected", active ? "true" : "false");
      });

      if (prevBtn) prevBtn.disabled = index <= 0;
      if (nextBtn) nextBtn.disabled = index >= total - 1;
    }

    function announce(index) {
      if (live) live.textContent = "Image " + (index + 1) + " of " + total;
    }

    function goTo(index, options) {
      var target = clamp(index);
      var instant = (options && options.instant) || prefersReducedMotion();
      viewport.scrollTo({
        left: target * slideWidth(),
        behavior: instant ? "auto" : "smooth",
      });
      render(target);
    }

    // ── Scroll → state ───────────────────────────────────────────────
    // Dots follow the scroll position live (so they track a finger
    // mid-swipe), while the screen-reader announcement waits for the
    // scrolling to settle — otherwise every slide passed through would
    // be read out.
    var scrollFrame = null;
    var settleTimer = null;

    viewport.addEventListener(
      "scroll",
      function () {
        if (!scrollFrame) {
          scrollFrame = requestAnimationFrame(function () {
            scrollFrame = null;
            var index = clamp(indexFromScroll());
            if (index !== current) render(index);
          });
        }

        clearTimeout(settleTimer);
        settleTimer = setTimeout(function () {
          var index = clamp(indexFromScroll());
          render(index);
          announce(index);
        }, 110);
      },
      { passive: true },
    );

    // ── Arrows ───────────────────────────────────────────────────────
    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        goTo(current - 1);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        goTo(current + 1);
      });
    }

    // ── Dots ─────────────────────────────────────────────────────────
    dots.forEach(function (dot) {
      dot.addEventListener("click", function () {
        goTo(parseInt(dot.dataset.galleryDot, 10) || 0);
      });
    });

    // ── Keyboard ─────────────────────────────────────────────────────
    viewport.addEventListener("keydown", function (event) {
      var handled = true;
      switch (event.key) {
        case "ArrowLeft":
          goTo(current - 1);
          break;
        case "ArrowRight":
          goTo(current + 1);
          break;
        case "Home":
          goTo(0);
          break;
        case "End":
          goTo(total - 1);
          break;
        default:
          handled = false;
      }
      if (handled) event.preventDefault();
    });

    // ── Mouse / pen dragging ─────────────────────────────────────────
    // Touch is left to the browser: native scrolling there is smoother
    // than anything reimplemented on top of pointer events.
    var dragging = false;
    var moved = false;
    var startX = 0;
    var startScroll = 0;
    var startIndex = 0;
    var activePointer = null;

    viewport.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "touch") return;
      if (event.button !== 0) return;

      // Preview images are real buttons. Do not capture their mouse pointer
      // for carousel dragging, otherwise the browser retargets the eventual
      // click to the viewport and the preview button never receives it.
      if (event.target.closest("[data-image-lightbox]")) return;

      dragging = true;
      moved = false;
      startX = event.clientX;
      startScroll = viewport.scrollLeft;
      startIndex = clamp(indexFromScroll());
      activePointer = event.pointerId;
      viewport.classList.add("is-dragging");
      try {
        viewport.setPointerCapture(event.pointerId);
      } catch (err) {
        /* capture is a nice-to-have; dragging still works without it */
      }
    });

    viewport.addEventListener("pointermove", function (event) {
      if (!dragging || event.pointerId !== activePointer) return;
      var dx = event.clientX - startX;
      if (!moved && Math.abs(dx) > DRAG_THRESHOLD) moved = true;
      if (moved) {
        event.preventDefault();
        viewport.scrollLeft = startScroll - dx;
      }
    });

    function endDrag(event) {
      if (!dragging || (event && event.pointerId !== activePointer)) return;
      dragging = false;
      activePointer = null;
      viewport.classList.remove("is-dragging");

      var dx = event ? event.clientX - startX : 0;
      var target;
      if (Math.abs(dx) > slideWidth() * SWIPE_RATIO) {
        // Deliberate flick: advance exactly one slide in that direction
        target = startIndex + (dx < 0 ? 1 : -1);
      } else {
        target = indexFromScroll();
      }
      goTo(target);
    }

    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);

    // A drag that ends on top of a link/image must not also fire a click
    viewport.addEventListener(
      "click",
      function (event) {
        if (moved) {
          event.preventDefault();
          event.stopPropagation();
          moved = false;
        }
      },
      true,
    );

    // ── Re-snap after layout changes ─────────────────────────────────
    var resizeTimer = null;
    function handleResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        goTo(current, { instant: true });
      }, 120);
    }

    if (typeof ResizeObserver === "function") {
      var observer = new ResizeObserver(handleResize);
      observer.observe(viewport);
    } else {
      window.addEventListener("resize", handleResize);
    }

    render(0);
  }

  function setupAllGalleries() {
    document.querySelectorAll("[data-project-gallery]").forEach(setupGallery);
  }

  setupAllGalleries();

  if (!window._projectGalleryListenerAdded) {
    document.body.addEventListener("htmx:afterSettle", setupAllGalleries);
    document.body.addEventListener("htmx:restored", setupAllGalleries);
    window._projectGalleryListenerAdded = true;
  }
})();
