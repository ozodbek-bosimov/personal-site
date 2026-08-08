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

  function ensureLightbox() {
    if (lightbox && document.body.contains(lightbox)) return;

    if (lightbox && !document.body.contains(lightbox)) {
      lightbox = null;
      preview = null;
      caption = null;
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
    // Clicking anywhere on the overlay dismisses it.
    lightbox.addEventListener("click", close);
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
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    preview.removeAttribute("src");
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
    if ((event.key === "Enter" || event.key === " ") && lightbox && !lightbox.hidden) return;
    var image = event.target.closest && event.target.closest(selector);
    if (!image || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open(image);
  }, true);

  setupImages();
  document.addEventListener("htmx:afterSettle", setupImages);
  document.addEventListener("htmx:restored", setupImages);
  document.addEventListener("htmx:historyRestore", setupImages);
})();
