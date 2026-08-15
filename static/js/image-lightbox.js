(function () {
  "use strict";

  // HTMX can evaluate body scripts again after a boosted page swap. Keep one
  // document-level listener and one modal for the entire browsing session;
  // otherwise every evaluation creates another stacked preview to close.
  if (window.__imageLightboxInitialized) return;
  window.__imageLightboxInitialized = true;

  var selector = [
    "[data-image-lightbox]",
    ".blogpost-thumbnail-wrap img",
    ".blog-content img:not([data-image-lightbox='false'])",
  ].join(", ");
  var activeTrigger = null;
  var lightbox;
  var preview;
  var caption;

  function imageFromTrigger(trigger) {
    if (trigger.tagName === "IMG") return trigger;
    return trigger.querySelector("img");
  }

  function captionFor(image) {
    var figure = image.closest("figure");
    var figureCaption = figure && figure.querySelector("figcaption");
    return (figureCaption && figureCaption.textContent.trim()) || image.alt || "Image preview";
  }

  // HTMX history restore rebuilds the page from a snapshot, so the lightbox
  // element (and the closure variables pointing at it) can become stale.
  // Always resolve the current element from the document instead.
  function currentLightbox() {
    return document.querySelector(".image-lightbox") || null;
  }

  function ensureLightbox() {
    // Reuse whatever lightbox is currently in the document — either the one
    // created here or one restored from the HTMX history cache. Otherwise a
    // restored page would stack a second overlay on top of the first.
    var existing = currentLightbox();
    if (existing) {
      lightbox = existing;
      preview = lightbox.querySelector(".image-lightbox__image");
      caption = lightbox.querySelector(".image-lightbox__caption");
      return;
    }

    lightbox = document.createElement("div");
    lightbox.className = "image-lightbox";
    lightbox.hidden = true;
    lightbox.tabIndex = -1;
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("aria-label", "Image preview");
    lightbox.innerHTML =
      '<div class="image-lightbox__dialog" role="document">' +
      '<img class="image-lightbox__image" alt="" />' +
      '<p class="image-lightbox__caption"></p>' +
      '</div>';
    document.body.appendChild(lightbox);

    preview = lightbox.querySelector(".image-lightbox__image");
    caption = lightbox.querySelector(".image-lightbox__caption");
    // Click-to-close is delegated on the document (see below) so it survives
    // HTMX history restores that replace this element with a fresh clone.
  }

  function open(trigger) {
    var image = imageFromTrigger(trigger);
    if (!image) return;
    ensureLightbox();
    activeTrigger = trigger;
    preview.src = image.currentSrc || image.src;
    preview.alt = image.alt || "";
    caption.textContent = captionFor(image);
    lightbox.hidden = false;
    document.body.classList.add("image-lightbox-open");
    lightbox.focus();
  }

  function close() {
    // Resolve the visible element from the document: after an HTMX history
    // restore the closure variable may point at an element that was removed
    // with the old page, while the visible lightbox is a fresh clone.
    var el = currentLightbox();
    if (!el || el.hidden) return;
    lightbox = el;
    el.hidden = true;
    preview = el.querySelector(".image-lightbox__image");
    caption = el.querySelector(".image-lightbox__caption");
    if (preview) preview.removeAttribute("src");
    document.body.classList.remove("image-lightbox-open");
    if (activeTrigger && document.contains(activeTrigger)) activeTrigger.focus();
    activeTrigger = null;
  }

  function setupImages() {
    document.querySelectorAll(selector).forEach(function (trigger) {
      if (trigger.dataset.imageLightboxReady === "1") return;
      var image = imageFromTrigger(trigger);
      if (!image) return;
      trigger.dataset.imageLightboxReady = "1";
      trigger.classList.add("image-lightbox-trigger");
      trigger.setAttribute("aria-haspopup", "dialog");
      if (trigger.tagName !== "BUTTON") {
        trigger.setAttribute("tabindex", "0");
        trigger.setAttribute("role", "button");
        trigger.setAttribute("aria-label", "Open image preview: " + captionFor(image));
      }
    });
  }

  // Close on any click inside the overlay. Delegated (like open) so it keeps
  // working on lightbox elements restored from the HTMX history cache, which
  // are fresh DOM nodes that never received a direct listener. Registered
  // before the open listener below: clicking a trigger is never inside the
  // lightbox, so the two can never both fire for the same target.
  document.addEventListener("click", function (event) {
    if (event.target.closest && event.target.closest(".image-lightbox")) {
      close();
    }
  }, true);

  document.addEventListener("click", function (event) {
    var image = event.target.closest(selector);
    if (!image) return;
    event.preventDefault();
    // Run ahead of a stale, pre-HTMX listener that may still be attached to
    // the document after a body swap. This prevents duplicate previews.
    event.stopImmediatePropagation();
    open(image);
  }, true);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      close();
      return;
    }
    var lb = currentLightbox();
    if ((event.key === "Enter" || event.key === " ") && lb && !lb.hidden) return;
    var image = event.target.closest && event.target.closest(selector);
    if (!image || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open(image);
  }, true);

  // While navigating, HTMX snapshots the current body into its history cache
  // and restores it on back/forward. If the lightbox is open at snapshot time
  // the restored overlay comes back with its close listener gone — clicking
  // it would do nothing and Escape would unlock the page but leave the
  // overlay visible. Drop the open lightbox from the DOM before the snapshot
  // is taken so restored pages are always clean. htmx fires this event and
  // caches the body synchronously in the same task, so removal is guaranteed
  // to happen before the snapshot is read.
  document.addEventListener("htmx:beforeHistorySave", function () {
    var el = currentLightbox();
    if (el && !el.hidden) {
      el.remove();
      lightbox = null;
      preview = null;
      caption = null;
      activeTrigger = null;
      document.body.classList.remove("image-lightbox-open");
    }
  });

  // Safety net for snapshots that already contain a stale lightbox (taken
  // before this handler existed). Adopt the restored element so the module
  // state never points at a removed node, and remove it if the snapshot
  // restored it open — the page must never come back with a stuck overlay.
  function cleanRestoredLightbox() {
    var els = document.querySelectorAll(".image-lightbox");
    if (!els.length) return;
    els.forEach(function (el) {
      el.remove();
    });
    lightbox = null;
    preview = null;
    caption = null;
    activeTrigger = null;
    document.body.classList.remove("image-lightbox-open");
  }
  document.addEventListener("htmx:historyRestore", cleanRestoredLightbox);

  setupImages();
  document.addEventListener("htmx:afterSettle", setupImages);
  document.addEventListener("htmx:historyRestore", setupImages);
})();
