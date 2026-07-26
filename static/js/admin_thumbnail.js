// Client-side thumbnail image size validation for Django admin
(function () {
  'use strict';

  var MAX_SIZE_MB = 15;
  var MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
  var META_MAX_CHARS = 300;

  // Inputs currently holding an oversized file. Save stays disabled while
  // this is non-empty, which matters now that a form can carry several
  // image inputs (project gallery inlines).
  var oversized = [];

  function setSaveDisabled(disabled) {
    document.querySelectorAll('[name="_save"], [name="_continue"], [name="_addanother"]')
      .forEach(function (btn) { btn.disabled = disabled; });
  }

  function errorNodeFor(input) {
    var next = input.nextSibling;
    while (next) {
      if (next.nodeType === 1 && next.classList.contains('image-size-error')) {
        return next;
      }
      next = next.nextSibling;
    }
    return null;
  }

  function validateThumbnail(input) {
    if (!input.files || input.files.length === 0) return;

    var file = input.files[0];
    var existing = errorNodeFor(input);
    var position = oversized.indexOf(input);

    if (file.size > MAX_SIZE_BYTES) {
      var sizeMB = (file.size / (1024 * 1024)).toFixed(1);

      if (!existing) {
        var msg = document.createElement('p');
        msg.className = 'errornote image-size-error';
        msg.style.cssText =
          'color:#ba2121; background:#fff0f0; border:1px solid #ba2121;' +
          ' padding:8px 12px; margin-top:8px; border-radius:4px;';
        input.parentNode.insertBefore(msg, input.nextSibling);
        existing = msg;
      }

      existing.textContent =
        'Image size is ' + sizeMB + ' MB — maximum allowed size is ' +
        MAX_SIZE_MB + ' MB. Please choose a smaller file.';

      if (position === -1) oversized.push(input);
      setSaveDisabled(true);

      // Reset input so user must re-pick
      setTimeout(function () {
        input.value = '';
        var index = oversized.indexOf(input);
        if (index !== -1) oversized.splice(index, 1);
        if (oversized.length === 0) setSaveDisabled(false);
      }, 0);
    } else {
      if (existing) existing.remove();
      if (position !== -1) oversized.splice(position, 1);
      if (oversized.length === 0) setSaveDisabled(false);
    }
  }

  function enforceMetaLimit(input) {
    if (!input) return;

    // Read the limit straight from the field's maxlength (set by the Django
    // form to match the model's max_length). This keeps the client counter and
    // the server-side validation in sync with a single source of truth.
    var maxChars = parseInt(input.getAttribute('maxlength'), 10);
    if (!maxChars || maxChars < 1) {
      maxChars = META_MAX_CHARS;
    }
    input.setAttribute('maxlength', String(maxChars));

    var counterId = 'meta-char-counter';
    var counter = document.getElementById(counterId);

    if (!counter) {
      counter = document.createElement('p');
      counter.id = counterId;
      counter.style.cssText = 'margin-top:6px; font-size:12px; color:#8f8f8f;';
      input.parentNode.appendChild(counter);
    }

    function updateCounter() {
      var length = (input.value || '').length;
      counter.textContent = length + ' / ' + maxChars;
      counter.style.color = length >= maxChars ? '#ba2121' : '#8f8f8f';
    }

    function trimToLimit() {
      var value = input.value || '';
      if (value.length > maxChars) {
        input.value = value.slice(0, maxChars);
      }
      updateCounter();
    }

    input.addEventListener('input', trimToLimit);
    input.addEventListener('paste', function () {
      setTimeout(trimToLimit, 0);
    });

    trimToLimit();
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Delegated so it also covers image inputs inside inline formsets —
    // including rows added after page load via "Add another".
    document.addEventListener('change', function (event) {
      var target = event.target;
      if (target && target.tagName === 'INPUT' && target.type === 'file') {
        validateThumbnail(target);
      }
    });

    var metaInput = document.getElementById('id_meta');
    enforceMetaLimit(metaInput);
  });
})();
