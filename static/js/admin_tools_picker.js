/* ═══════════════════════════════════════════════════════════════════════
   CKEditor Content Toolkit — admin insert panel with GUI Block Builder
   ═══════════════════════════════════════════════════════════════════════ */

(function (window, document) {
    "use strict";
  
    if (window.__TK_PICKER_LOADED) return;
    window.__TK_PICKER_LOADED = true;
  
    var CATALOG = window.__TK_CATALOG__ || [];
    if (!CATALOG.length) return;
  
    /* ── helpers ─────────────────────────────────────────────────────── */
  
    function el(tag, cls, text) {
      var node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text != null) node.textContent = text;
      return node;
    }
  
    function escapeHtml(str) {
      var div = document.createElement("div");
      div.appendChild(document.createTextNode(str || ""));
      return div.innerHTML;
    }
  
    function insertSnippet(editor, html) {
      if (!editor || !editor.model || !html) return false;
      try {
        // Blokdan keyin yozishni davom ettirish uchun bo'sh paragraf qo'shamiz
        var finalHtml = html + '<p>&nbsp;</p>';
        var viewFragment = editor.data.processor.toView(finalHtml);
        var modelFragment = editor.data.toModel(viewFragment);
        editor.model.insertContent(modelFragment);
        return true;
      } catch (e) {
        if (window.console && window.console.warn) {
          window.console.warn("[tk-picker] insert failed:", e);
        }
        return false;
      }
    }
  
    /* ── block builders ──────────────────────────────────────────────── */
    // Each builder defines a render() function that sets up the configuration modal DOM,
    // and returns a function to generate the final HTML string.
    var BUILDERS = {
        accordion: {
            render: function(container) {
                container.innerHTML = `
                    <div class="tk-field"><label>Only allow one open at a time?</label><select id="t-single"><option value="yes">Yes</option><option value="no">No</option></select></div>
                    <div id="t-items"></div>
                    <button type="button" id="t-add" class="tk-picker-btn">Add Question</button>
                `;
                var itemsDiv = container.querySelector('#t-items');
                function addItem() {
                    var div = el('div', 'tk-item-box');
                    div.innerHTML = `<input type="text" class="t-q" placeholder="Question">
                                     <textarea class="t-a" placeholder="Answer"></textarea>
                                     <button type="button" class="t-rem tk-picker-btn">Remove</button>`;
                    div.querySelector('.t-rem').onclick = function() { div.remove(); };
                    itemsDiv.appendChild(div);
                }
                addItem(); addItem();
                container.querySelector('#t-add').onclick = addItem;
                return function() {
                    var single = container.querySelector('#t-single').value;
                    var html = `<div class="tk-block tk-accordion" data-tk="accordion" data-single="${single}">`;
                    itemsDiv.querySelectorAll('.tk-item-box').forEach(function(item, i) {
                        var q = item.querySelector('.t-q').value || 'Question ' + (i+1);
                        var a = item.querySelector('.t-a').value || 'Answer';
                        html += `
                        <div class="tk-accordion__item" data-open="no">
                            <h3 class="tk-accordion__q">${escapeHtml(q)}</h3>
                            <div class="tk-accordion__a"><p>${escapeHtml(a).replace(/\n/g, '<br>')}</p></div>
                        </div>`;
                    });
                    html += `</div>`;
                    return html;
                };
            }
        },
        button: {
            render: function(container) {
                container.innerHTML = `
                    <div class="tk-field"><label>Text</label><input type="text" id="t-text" value="Click here"></div>
                    <div class="tk-field"><label>URL</label><input type="text" id="t-url" value="https://"></div>
                    <div class="tk-field"><label>Variant</label><select id="t-var">
                        <option value="tk-btn--primary">Primary</option><option value="tk-btn--ghost">Outline / Ghost</option><option value="tk-btn--gradient">Gradient</option>
                    </select></div>
                `;
                return function() {
                    var t = container.querySelector('#t-text').value;
                    var u = container.querySelector('#t-url').value;
                    var v = container.querySelector('#t-var').value;
                    return `<div class="tk-block tk-button" data-tk="button"><a href="${escapeHtml(u)}" class="tk-btn ${v}">${escapeHtml(t)}</a></div>`;
                };
            }
        },
        callout: {
            render: function(container) {
                container.innerHTML = `
                    <div class="tk-field"><label>Variant</label><select id="t-var">
                        <option value="info">Info</option><option value="tip">Tip</option><option value="warning">Warning</option><option value="danger">Danger</option><option value="success">Success</option>
                    </select></div>
                    <div class="tk-field"><label>Title (optional)</label><input type="text" id="t-title"></div>
                    <div class="tk-field"><label>Body</label><textarea id="t-body">Callout text goes here...</textarea></div>
                `;
                return function() {
                    var v = container.querySelector('#t-var').value;
                    var t = container.querySelector('#t-title').value;
                    var b = container.querySelector('#t-body').value;
                    var html = `<div class="tk-block tk-callout" data-tk="callout" data-variant="${v}">`;
                    if (t) html += `<p class="tk-callout__title">${escapeHtml(t)}</p>`;
                    html += `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p></div>`;
                    return html;
                }
            }
        },
        checklist: {
            render: function(container) {
                container.innerHTML = `
                    <div class="tk-field"><label>Style</label><select id="t-style"><option value="checkbox">Checkbox</option><option value="radio">Radio</option></select></div>
                    <div id="t-items"></div><button type="button" id="t-add" class="tk-picker-btn">Add Item</button>
                `;
                var itemsDiv = container.querySelector('#t-items');
                function addItem() {
                    var div = el('div', 'tk-item-box');
                    div.innerHTML = `<input type="text" class="t-txt" placeholder="Item text"><button type="button" class="t-rem tk-picker-btn">Remove</button>`;
                    div.querySelector('.t-rem').onclick = function() { div.remove(); };
                    itemsDiv.appendChild(div);
                }
                addItem(); addItem();
                container.querySelector('#t-add').onclick = addItem;
                return function() {
                    var s = container.querySelector('#t-style').value;
                    var html = `<div class="tk-block tk-checklist" data-tk="checklist" data-style="${s}"><ul class="tk-list tk-checklist__list">`;
                    itemsDiv.querySelectorAll('.tk-item-box').forEach(function(item) {
                        html += `<li class="tk-checklist__item" data-state="none">${escapeHtml(item.querySelector('.t-txt').value)}</li>`;
                    });
                    html += `</ul></div>`;
                    return html;
                }
            }
        },
        "cta-banner": {
            render: function(container) {
                container.innerHTML = `
                    <div class="tk-field"><label>Variant</label><select id="t-var"><option value="solid">Solid</option><option value="outline">Outline</option></select></div>
                    <div class="tk-field"><label>Headline</label><input type="text" id="t-head" value="Ready to start?"></div>
                    <div class="tk-field"><label>Body</label><textarea id="t-body">Join the newsletter.</textarea></div>
                    <div class="tk-field"><label>Button 1 Text</label><input type="text" id="t-b1t" value="Sign up"></div>
                    <div class="tk-field"><label>Button 1 URL</label><input type="text" id="t-b1u" value="https://"></div>
                `;
                return function() {
                    var v = container.querySelector('#t-var').value;
                    var h = container.querySelector('#t-head').value;
                    var b = container.querySelector('#t-body').value;
                    var b1t = container.querySelector('#t-b1t').value;
                    var b1u = container.querySelector('#t-b1u').value;
                    return `<div class="tk-block tk-cta" data-tk="cta-banner" data-variant="${v}">
                        <h2 class="tk-cta__headline">${escapeHtml(h)}</h2>
                        <p class="tk-cta__body">${escapeHtml(b)}</p>
                        <div class="tk-cta__actions"><a href="${escapeHtml(b1u)}" class="tk-btn tk-btn--primary">${escapeHtml(b1t)}</a></div>
                    </div>`;
                }
            }
        },
        "file-card": {
            render: function(container) {
                container.innerHTML = `
                    <div class="tk-field"><label>File URL</label><input type="text" id="t-url" value="" placeholder="/shared/file.pdf or https://example.com/file.zip"></div>
                    <div class="tk-field"><label>File Name (optional)</label><input type="text" id="t-name" value="" placeholder="e.g., Project_Requirements.pdf"></div>
                    <div class="tk-field"><label>Meta size/info (optional)</label><input type="text" id="t-meta" value="" placeholder="e.g., 1.2 MB or PDF Document"></div>
                `;
                return function() {
                    var u = container.querySelector('#t-url').value;
                    if (u && !/^https?:\/\//i.test(u) && !u.startsWith('/') && !u.startsWith('#') && !u.startsWith('mailto:')) {
                        u = 'https://' + u;
                    }
                    var m = container.querySelector('#t-meta').value;
                    
                    // Auto-extract name if empty
                    var cleanUrl = u.split('?')[0].split('#')[0];
                    var name = container.querySelector('#t-name').value || cleanUrl.split('/').pop() || 'Download File';
                    
                    // Auto-extract extension
                    var ext = 'file';
                    if (cleanUrl.includes('.')) {
                        var parts = cleanUrl.split('.');
                        var last = parts[parts.length - 1];
                        if (last.length <= 5 && /^[a-zA-Z0-9]+$/.test(last)) {
                            ext = last;
                        }
                    }
                    
                    var metaHtml = m ? `<p class="tk-filecard__meta">${escapeHtml(m)}</p>` : '';
                    
                    return `<div class="tk-block tk-filecard" data-tk="file-card" data-ext="${escapeHtml(ext)}">
                        <a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer" class="tk-filecard__link">${escapeHtml(name)}</a>
                        ${metaHtml}
                    </div>`;
                }
            }
        },
        flashcards: {
            render: function(container) {
                container.innerHTML = `
                    <div class="tk-field"><label>Deck Title (optional)</label><input type="text" id="t-title" placeholder="e.g., HTTP flashcards"></div>
                    <div id="t-items"></div>
                    <button type="button" id="t-add" class="tk-picker-btn">Add Card</button>
                `;
                var itemsDiv = container.querySelector('#t-items');
                function addItem() {
                    var div = el('div', 'tk-item-box');
                    div.innerHTML = `<input type="text" class="t-f" placeholder="Front text / prompt"><textarea class="t-b" placeholder="Back text / answer"></textarea><button type="button" class="t-rem tk-picker-btn">Remove</button>`;
                    div.querySelector('.t-rem').onclick = function() { div.remove(); };
                    itemsDiv.appendChild(div);
                }
                addItem(); addItem();
                container.querySelector('#t-add').onclick = addItem;
                return function() {
                    var title = container.querySelector('#t-title').value;
                    var html = `<div class="tk-block tk-cards" data-tk="flashcards" data-shuffle="no" data-flip-label="Show answer" data-shuffle-label="Shuffle">`;
                    if (title) html += `<p class="tk-cards__title">${escapeHtml(title)}</p>`;
                    itemsDiv.querySelectorAll('.tk-item-box').forEach(function(item) {
                        var f = item.querySelector('.t-f').value || 'Question';
                        var b = item.querySelector('.t-b').value || 'Answer';
                        html += `
                        <div class="tk-cards__card">
                            <p class="tk-cards__front"><strong>${escapeHtml(f)}</strong></p>
                            <div class="tk-cards__back">
                                <p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>
                            </div>
                        </div>`;
                    });
                    html += `</div>`;
                    return html;
                }
            }
        },
        gform: {
            render: function(container) {
                container.innerHTML = `
                    <div class="tk-field"><label>Form Title</label><input type="text" id="t-title" value="Send Feedback"></div>
                    <div class="tk-field"><label>Intro Text</label><input type="text" id="t-intro" value="Please share your thoughts below."></div>
                    <div class="tk-field"><label>Success Message</label><input type="text" id="t-success" value="Thanks for your feedback!"></div>
                    <div class="tk-field"><label>Submit Button Text</label><input type="text" id="t-submit-text" value="Submit"></div>
                    <hr class="tk-builder-rule">
                    <div class="tk-field"><label>Google Form URL</label>
                        <div class="tk-builder-inline">
                            <input type="text" id="t-action" placeholder="Paste a published Google Form link">
                            <button type="button" id="t-detect" class="tk-picker-btn tk-picker-btn--accent">Auto-detect</button>
                        </div>
                        <small id="t-detect-msg" class="tk-builder-message" aria-live="polite"></small>
                    </div>
                    <hr class="tk-builder-rule">
                    <p class="tk-builder-heading">Form fields</p>
                    <div id="t-fields"></div>
                    <button type="button" id="t-add-field" class="tk-picker-btn">Add field</button>
                    <p id="t-builder-error" class="tk-builder-message tk-builder-message--error" aria-live="polite"></p>
                `;
                var fieldsDiv = container.querySelector('#t-fields');
                var actionInput = container.querySelector('#t-action');
                var detectBtn = container.querySelector('#t-detect');
                var detectMsg = container.querySelector('#t-detect-msg');
                var builderError = container.querySelector('#t-builder-error');
                var fieldIdx = 0;

                function addField(label, type, entryId, required, placeholder) {
                    fieldIdx++;
                    var div = el('div', 'tk-item-box');
                    div.innerHTML = `
                        <div class="tk-builder-grid tk-builder-grid--two">
                            <div class="tk-field"><label>Label</label><input type="text" class="f-label" value="${escapeHtml(label || '')}"></div>
                            <div class="tk-field"><label>Entry ID</label><input type="text" class="f-entry" placeholder="entry.123456789" value="${escapeHtml(entryId || '')}"></div>
                        </div>
                        <div class="tk-builder-grid tk-builder-grid--three">
                            <div class="tk-field"><label>Type</label><select class="f-type">
                                <option value="text"${type === 'text' || !type ? ' selected' : ''}>Text</option>
                                <option value="email"${type === 'email' ? ' selected' : ''}>Email</option>
                                <option value="textarea"${type === 'textarea' ? ' selected' : ''}>Textarea</option>
                            </select></div>
                            <div class="tk-field"><label>Placeholder</label><input type="text" class="f-placeholder" value="${escapeHtml(placeholder || '')}"></div>
                            <div class="tk-builder-required">
                                <label>
                                    <input type="checkbox" class="f-required" ${required ? 'checked' : ''}> Required
                                </label>
                            </div>
                        </div>
                        <div class="tk-builder-actions">
                            <button type="button" class="f-up tk-picker-btn" title="Move up" aria-label="Move field up">Up</button>
                            <button type="button" class="f-down tk-picker-btn" title="Move down" aria-label="Move field down">Down</button>
                            <button type="button" class="f-rem tk-picker-btn tk-picker-btn--danger" title="Remove">Remove</button>
                        </div>
                    `;
                    div.querySelector('.f-rem').onclick = function() { div.remove(); };
                    div.querySelector('.f-up').onclick = function() {
                        var prev = div.previousElementSibling;
                        if (prev) fieldsDiv.insertBefore(div, prev);
                    };
                    div.querySelector('.f-down').onclick = function() {
                        var next = div.nextElementSibling;
                        if (next) fieldsDiv.insertBefore(next, div);
                    };
                    fieldsDiv.appendChild(div);
                }

                function clearFields() {
                    fieldsDiv.innerHTML = '';
                }

                function getCsrfToken() {
                    var match = document.cookie.match(/(?:^|; )csrftoken=([^;]*)/);
                    return match ? decodeURIComponent(match[1]) : '';
                }

                function isGoogleFormUrl(rawUrl) {
                    try {
                        var candidate = rawUrl.indexOf('://') === -1 ? 'https://' + rawUrl : rawUrl;
                        var url = new URL(candidate);
                        return url.protocol === 'https:' && (url.hostname === 'docs.google.com' || url.hostname === 'forms.gle');
                    } catch (e) {
                        return false;
                    }
                }

                // Auto-detect button
                detectBtn.onclick = function() {
                    var rawUrl = actionInput.value.trim();
                    if (!isGoogleFormUrl(rawUrl)) {
                        detectMsg.className = 'tk-builder-message tk-builder-message--error';
                        detectMsg.textContent = 'Enter a published docs.google.com or forms.gle URL.';
                        return;
                    }
                    detectBtn.disabled = true;
                    detectMsg.className = 'tk-builder-message';
                    detectMsg.textContent = 'Detecting fields…';

                    fetch('/api/detect-form-fields/', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'X-CSRFToken': getCsrfToken()
                        },
                        body: 'url=' + encodeURIComponent(rawUrl)
                    })
                    .then(function(r) {
                        return r.json().then(function(data) {
                            if (!r.ok) {
                                throw new Error(data.error || 'Server error (' + r.status + ')');
                            }
                            return data;
                        });
                    })
                    .then(function(data) {
                        if (!data.fields || !data.fields.length) {
                            throw new Error('No fields found. Make sure the form is published and "Accepting responses" is enabled.');
                        }
                        if (data.action) actionInput.value = data.action;
                        clearFields();
                        data.fields.forEach(function(f) {
                            var isEmail = f.title.toLowerCase().indexOf('email') !== -1;
                            addField(f.title, isEmail ? 'email' : f.type, f.entry, f.required !== false, '');
                        });
                        detectMsg.className = 'tk-builder-message tk-builder-message--success';
                        detectMsg.textContent = data.fields.length + ' fields detected and added.';
                    })
                    .catch(function(err) {
                        detectMsg.className = 'tk-builder-message tk-builder-message--error';
                        detectMsg.textContent = 'Error: ' + (err.message || err);
                    })
                    .then(function() {
                        detectBtn.disabled = false;
                    });
                };

                container.querySelector('#t-add-field').onclick = function() {
                    addField('', 'text', '', false, '');
                };

                return function() {
                    var action = container.querySelector('#t-action').value;
                    var title = container.querySelector('#t-title').value;
                    var intro = container.querySelector('#t-intro').value;
                    var suc = container.querySelector('#t-success').value;
                    var submitText = container.querySelector('#t-submit-text').value || 'Submit';
                    var fieldsHtml = '';
                    var missing = [];
                    fieldsDiv.querySelectorAll('.tk-item-box').forEach(function(item, index) {
                        var label = item.querySelector('.f-label').value || 'Field';
                        var entry = item.querySelector('.f-entry').value.trim();
                        var type = item.querySelector('.f-type').value;
                        var placeholder = item.querySelector('.f-placeholder').value;
                        var required = item.querySelector('.f-required').checked;
                        if (!/^entry\.\d+$/.test(entry)) missing.push('field ' + (index + 1));
                        fieldsHtml += '<div class="tk-form__field" data-field="' + escapeHtml(entry) + '" data-type="' + escapeHtml(type) + '" data-label="' + escapeHtml(label) + '" data-required="' + (required ? 'yes' : 'no') + '"';
                        if (placeholder) fieldsHtml += ' data-placeholder="' + escapeHtml(placeholder) + '"';
                        if (type === 'textarea') fieldsHtml += ' data-rows="4"';
                        fieldsHtml += '><p class="tk-form__fallback"><strong>' + escapeHtml(label) + '.</strong> ' + (required ? 'Required' : 'Optional') + ' ' + (type === 'textarea' ? 'long-text' : type) + ' field.</p></div>';
                    });

                    if (!action || !fieldsHtml || missing.length) {
                        builderError.textContent = !action ? 'Detect a Google Form before inserting.' : !fieldsHtml ? 'Add at least one field.' : 'Every field needs a valid Google entry ID.';
                        return '';
                    }
                    builderError.textContent = '';
                    var blockId = 'form-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
                    var html = '<div class="tk-block tk-form" data-tk="gform" data-tk-id="' + blockId + '" data-action="' + escapeHtml(action) + '" data-min-time="3" data-cooldown="60" data-submit-label="' + escapeHtml(submitText) + '" data-success="' + escapeHtml(suc) + '" data-error="Could not send your feedback. Please try again.">';
                    if (title) html += '<h3 class="tk-form__title">' + escapeHtml(title) + '</h3>';
                    if (intro) html += '<p class="tk-form__intro">' + escapeHtml(intro) + '</p>';
                    html += fieldsHtml + '</div>';
                    return html;
                }
            }
        },
        "link-card": {
            render: function(container) {
                container.innerHTML = `
                    <div class="tk-field"><label>URL</label><input type="text" id="t-url" value="https://example.com"></div>
                    <div class="tk-field"><label>Title</label><input type="text" id="t-title" value="Example"></div>
                    <div class="tk-field"><label>Description</label><textarea id="t-desc">Description text here.</textarea></div>
                    <div class="tk-field"><label>Host (e.g. example.com)</label><input type="text" id="t-host" value="example.com"></div>
                `;
                return function() {
                    var u = container.querySelector('#t-url').value;
                    if (u && !/^https?:\/\//i.test(u) && !u.startsWith('/') && !u.startsWith('#') && !u.startsWith('mailto:')) {
                        u = 'https://' + u;
                    }
                    var t = container.querySelector('#t-title').value;
                    var d = container.querySelector('#t-desc').value;
                    var h = container.querySelector('#t-host').value;
                    return `<div class="tk-block tk-linkcard" data-tk="link-card"><a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer" class="tk-linkcard__link">
                        <strong class="tk-linkcard__title">${escapeHtml(t)}</strong>
                        <span class="tk-linkcard__desc">${escapeHtml(d)}</span>
                        <span class="tk-linkcard__host">${escapeHtml(h)}</span>
                    </a></div>`;
                }
            }
        },
        "pros-cons": {
            render: function(container) {
                container.innerHTML = `
                    <div class="tk-field"><label>Pros Title</label><input type="text" id="t-pt" value="Pros"></div>
                    <div id="t-pros"></div><button type="button" id="t-p-add" class="tk-picker-btn">Add Pro</button><br><br>
                    <div class="tk-field"><label>Cons Title</label><input type="text" id="t-ct" value="Cons"></div>
                    <div id="t-cons"></div><button type="button" id="t-c-add" class="tk-picker-btn">Add Con</button>
                `;
                var addL = function(id, ph) {
                    var div = el('div', 'tk-item-box');
                    div.innerHTML = `<input type="text" class="t-txt" placeholder="${ph}"><button type="button" class="t-rem tk-picker-btn">Remove</button>`;
                    div.querySelector('.t-rem').onclick = function() { div.remove(); };
                    container.querySelector('#'+id).appendChild(div);
                };
                addL('t-pros', 'Pro'); addL('t-cons', 'Con');
                container.querySelector('#t-p-add').onclick = function() { addL('t-pros', 'Pro'); };
                container.querySelector('#t-c-add').onclick = function() { addL('t-cons', 'Con'); };
                return function() {
                    var pt = container.querySelector('#t-pt').value || 'Pros';
                    var ct = container.querySelector('#t-ct').value || 'Cons';
                    var html = `<div class="tk-block tk-proscons" data-tk="pros-cons">
                        <div class="tk-proscons__col" data-kind="pro"><p class="tk-proscons__title">${escapeHtml(pt)}</p><ul class="tk-list tk-proscons__list">`;
                    container.querySelectorAll('#t-pros .tk-item-box').forEach(function(i) {
                        var txt = i.querySelector('.t-txt').value;
                        if (txt) html += `<li>${escapeHtml(txt)}</li>`;
                    });
                    html += `</ul></div><div class="tk-proscons__col" data-kind="con"><p class="tk-proscons__title">${escapeHtml(ct)}</p><ul class="tk-list tk-proscons__list">`;
                    container.querySelectorAll('#t-cons .tk-item-box').forEach(function(i) {
                        var txt = i.querySelector('.t-txt').value;
                        if (txt) html += `<li>${escapeHtml(txt)}</li>`;
                    });
                    html += `</ul></div></div>`;
                    return html;
                }
            }
        },
        quiz: {
            render: function(container) {
                container.innerHTML = `<div class="tk-field"><label>Quiz Title</label><input type="text" id="t-t" value="Knowledge check"></div><div id="t-items"></div><button type="button" id="t-add" class="tk-picker-btn">Add Question</button>`;
                var itemsDiv = container.querySelector('#t-items');
                function addItem() {
                    var div = el('div', 'tk-item-box');
                    div.innerHTML = `
                        <div class="tk-field"><label>Type</label><select class="t-type"><option value="single">Single choice</option><option value="multi">Multiple choice</option><option value="true-false">True/False</option></select></div>
                        <div class="tk-field"><label>Question Text</label><input type="text" class="t-p" placeholder="Prompt"></div>
                        <div class="tk-field"><label>Explanation on complete</label><input type="text" class="t-e"></div>
                        <div class="tk-field"><label>Correct Answer Index (1-based, comma separated)</label><input type="text" class="t-a" placeholder="e.g. 1 or 1,3"></div>
                        <div class="tk-field"><label>Options (comma separated, ignored for T/F)</label><input type="text" class="t-o" placeholder="Option 1, Option 2, Option 3"></div>
                        <button type="button" class="t-rem tk-picker-btn">Remove</button>
                    `;
                    div.querySelector('.t-rem').onclick = function() { div.remove(); };
                    itemsDiv.appendChild(div);
                }
                addItem();
                container.querySelector('#t-add').onclick = addItem;
                return function() {
                    var uid = 'q-' + Math.floor(Math.random() * 10000);
                    var html = `<div class="tk-block tk-quiz" data-tk="quiz" data-tk-id="${uid}" data-check-label="Check" data-retry-label="Try again"><p class="tk-quiz__title">${escapeHtml(container.querySelector('#t-t').value)}</p>`;
                    itemsDiv.querySelectorAll('.tk-item-box').forEach(function(item) {
                        var t = item.querySelector('.t-type').value;
                        var p = item.querySelector('.t-p').value;
                        var e = item.querySelector('.t-e').value;
                        var a = item.querySelector('.t-a').value;
                        var optsHtml = '';
                        if (t === 'true-false') {
                            optsHtml = `<li class="tk-quiz__option">True</li><li class="tk-quiz__option">False</li>`;
                            if (a === '1') a = btoa('True'); else if (a === '2') a = btoa('False'); else a = btoa(a);
                        } else {
                            item.querySelector('.t-o').value.split(',').forEach(function(o) { optsHtml += `<li class="tk-quiz__option">${escapeHtml(o.trim())}</li>`; });
                        }
                        html += `<div class="tk-quiz__q" data-type="${t}" ${t==='true-false'?'data-answer-b64':'data-answer'}="${escapeHtml(a)}" data-explain="${escapeHtml(e)}"><h3 class="tk-quiz__prompt">${escapeHtml(p)}</h3><ul class="tk-list tk-quiz__options">${optsHtml}</ul></div>`;
                    });
                    html += `</div>`;
                    return html;
                }
            }
        },
        quote: {
            render: function(container) {
                container.innerHTML = `
                    <div class="tk-field"><label>Quote Text</label><textarea id="t-txt">The sentence worth setting apart.</textarea></div>
                    <div class="tk-field"><label>Author Name</label><input type="text" id="t-nm" value="Name Surname"></div>
                    <div class="tk-field"><label>Role / Company (optional)</label><input type="text" id="t-rl" value="Role, Company"></div>
                `;
                return function() {
                    var t = container.querySelector('#t-txt').value;
                    var n = container.querySelector('#t-nm').value;
                    var r = container.querySelector('#t-rl').value;
                    var html = `<div class="tk-block tk-quote" data-tk="quote"><blockquote class="tk-quote__body"><p>${escapeHtml(t).replace(/\n/g, '<br>')}</p></blockquote><p class="tk-quote__cite"><strong>${escapeHtml(n)}</strong>`;
                    if (r) html += `<span class="tk-quote__role">${escapeHtml(r)}</span>`;
                    html += `</p></div>`;
                    return html;
                }
            }
        },
        spoiler: {
            render: function(container) {
                container.innerHTML = `
                    <div class="tk-field"><label>Start Open?</label><select id="t-open"><option value="no">No</option><option value="yes">Yes</option></select></div>
                    <div class="tk-field"><label>Summary Text</label><input type="text" id="t-sum" value="Show the answer"></div>
                    <div class="tk-field"><label>Hidden Body</label><textarea id="t-body">Hidden content goes here.</textarea></div>
                `;
                return function() {
                    var o = container.querySelector('#t-open').value;
                    var s = container.querySelector('#t-sum').value;
                    var b = container.querySelector('#t-body').value;
                    return `<div class="tk-block tk-spoiler" data-tk="spoiler" data-open="${o}">
                        <p class="tk-spoiler__summary">${escapeHtml(s)}</p>
                        <div class="tk-spoiler__body"><p>${escapeHtml(b).replace(/\n/g, '<br>')}</p></div>
                    </div>`;
                }
            }
        },
        stats: {
            render: function(container) {
                container.innerHTML = `<div class="tk-field"><label>Columns</label><select id="t-cols"><option value="3">3</option><option value="2">2</option><option value="4">4</option></select></div><div id="t-items"></div><button type="button" id="t-add" class="tk-picker-btn">Add Stat</button>`;
                var itemsDiv = container.querySelector('#t-items');
                function addItem() {
                    var div = el('div', 'tk-item-box');
                    div.innerHTML = `<input type="text" class="t-v" placeholder="Value (e.g. 98%)"><input type="text" class="t-l" placeholder="Label"><input type="text" class="t-n" placeholder="Note (optional)"><button type="button" class="t-rem tk-picker-btn">Remove</button>`;
                    div.querySelector('.t-rem').onclick = function() { div.remove(); };
                    itemsDiv.appendChild(div);
                }
                addItem(); addItem(); addItem();
                container.querySelector('#t-add').onclick = addItem;
                return function() {
                    var c = container.querySelector('#t-cols').value;
                    var html = `<div class="tk-block tk-stats" data-tk="stats" data-cols="${c}">`;
                    itemsDiv.querySelectorAll('.tk-item-box').forEach(function(item) {
                        html += `<div class="tk-stat"><p class="tk-stat__value">${escapeHtml(item.querySelector('.t-v').value)}</p><p class="tk-stat__label">${escapeHtml(item.querySelector('.t-l').value)}</p>`;
                        var n = item.querySelector('.t-n').value;
                        if (n) html += `<p class="tk-stat__note">${escapeHtml(n)}</p>`;
                        html += `</div>`;
                    });
                    html += `</div>`;
                    return html;
                }
            }
        },
        tabs: {
            render: function(container) {
                container.innerHTML = `<div id="t-items"></div><button type="button" id="t-add" class="tk-picker-btn">Add Tab</button>`;
                var itemsDiv = container.querySelector('#t-items');
                function addItem() {
                    var div = el('div', 'tk-item-box');
                    div.innerHTML = `<input type="text" class="t-lbl" placeholder="Tab Name (e.g. macOS)"><textarea class="t-txt" placeholder="Tab content"></textarea><button type="button" class="t-rem tk-picker-btn">Remove</button>`;
                    div.querySelector('.t-rem').onclick = function() { div.remove(); };
                    itemsDiv.appendChild(div);
                }
                addItem(); addItem();
                container.querySelector('#t-add').onclick = addItem;
                return function() {
                    var html = `<div class="tk-block tk-tabs" data-tk="tabs" data-active="1">`;
                    itemsDiv.querySelectorAll('.tk-item-box').forEach(function(item) {
                        html += `<div class="tk-tabs__panel"><h3 class="tk-tabs__label">${escapeHtml(item.querySelector('.t-lbl').value)}</h3><p>${escapeHtml(item.querySelector('.t-txt').value).replace(/\n/g, '<br>')}</p></div>`;
                    });
                    html += `</div>`;
                    return html;
                }
            }
        }
    };
  
    // Fallback generic builder if a tool is not explicitly defined in BUILDERS
    var GENERIC_BUILDER = {
        render: function(container, entry) {
            container.innerHTML = `<p>This block has no specific builder UI. Proceeding will insert the default structure.</p>`;
            return function() { return entry.html; };
        }
    };
  
    /* ── Modal logic ─────────────────────────────────────────────────── */
    
    // Inject modal CSS directly to avoid browser caching and CKEditor CSS scoping issues
    if (!document.getElementById('tk-picker-modal-styles')) {
        var style = document.createElement('style');
        style.id = 'tk-picker-modal-styles';
        style.textContent = `
            .tk-picker-modal-overlay {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(15, 23, 42, 0.85);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                z-index: 2147483647; /* Max z-index to guarantee top level */
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .tk-picker-modal {
                background: #0f172a;
                border: 1px solid #334155;
                border-radius: 8px;
                width: 600px;
                max-width: 90vw;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            .tk-picker-modal__header {
                padding: 16px 20px;
                border-bottom: 1px solid #1e293b;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .tk-picker-modal__header h3 {
                margin: 0;
                color: #e2e8f0;
                font-size: 16px;
                font-weight: 600;
            }
            .tk-picker-modal__close {
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 24px;
                cursor: pointer;
                line-height: 1;
            }
            .tk-picker-modal__close:hover { color: #f87171; }
            .tk-picker-modal__body {
                padding: 20px;
                overflow-y: auto;
                flex: 1;
            }
            .tk-picker-modal__footer {
                padding: 16px 20px;
                border-top: 1px solid #1e293b;
                display: flex;
                justify-content: flex-end;
                gap: 12px;
            }
            .tk-field { margin-bottom: 16px; }
            .tk-field label {
                display: block; margin-bottom: 6px;
                color: #94a3b8; font-size: 13px; font-weight: 500;
            }
            .tk-field input, .tk-field textarea, .tk-field select,
            .tk-item-box input, .tk-item-box textarea, .tk-item-box select {
                width: 100%; padding: 8px 12px; background: #1e293b;
                border: 1px solid #334155; border-radius: 4px;
                color: #f1f5f9; font-size: 14px; font-family: inherit;
                box-sizing: border-box;
                line-height: 1.5;
            }
            .tk-field select, .tk-item-box select {
                height: 38px;
            }
            .tk-field textarea, .tk-item-box textarea {
                min-height: 80px; resize: vertical;
            }
            .tk-item-box {
                background: #1e293b; border: 1px solid #334155;
                padding: 12px; border-radius: 4px; margin-bottom: 12px;
                display: flex; flex-direction: column; gap: 8px;
            }
            .tk-picker-btn {
                background: #334155; color: #e2e8f0; border: none;
                padding: 8px 16px; border-radius: 4px; cursor: pointer;
                font-size: 13px; font-weight: 500; transition: background 0.15s;
            }
            .tk-picker-btn:hover { background: #475569; }
            .tk-picker-btn--accent { background: #06b6d4; color: #082f49; font-weight: 700; white-space: nowrap; }
            .tk-picker-btn--accent:hover { background: #22d3ee; }
            .tk-picker-btn--danger { color: #fca5a5; }
            .tk-btn-insert { background: #3b82f6; }
            .tk-btn-insert:hover { background: #2563eb; }
            .tk-btn-cancel { background: transparent; border: 1px solid #334155; }
            .tk-btn-cancel:hover { background: #1e293b; }
            .tk-item-box .t-rem {
                align-self: flex-end; background: transparent; color: #f87171; padding: 4px 8px; border: 1px solid #f87171;
            }
            .tk-item-box .t-rem:hover { background: rgba(248, 113, 113, 0.1); }
            .tk-builder-rule { margin: 12px 0; border: 0; border-top: 1px solid #334155; }
            .tk-builder-inline { display: flex; gap: 6px; }
            .tk-builder-inline input { flex: 1; }
            .tk-builder-heading { margin: 0 0 8px; color: #cbd5e1; font-size: 13px; font-weight: 700; }
            .tk-builder-grid { display: grid; gap: 6px; align-items: end; }
            .tk-builder-grid--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .tk-builder-grid--three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            .tk-builder-required { padding-bottom: 15px; }
            .tk-builder-required label { display: inline-flex; align-items: center; gap: 4px; margin: 0; cursor: pointer; white-space: nowrap; }
            .tk-builder-required input { width: auto; }
            .tk-builder-actions { display: flex; justify-content: flex-end; gap: 4px; }
            .tk-builder-actions .tk-picker-btn { padding: 4px 8px; }
            .tk-builder-message { display: block; min-height: 1.25em; margin-top: 4px; color: #94a3b8; font-size: 11px; }
            .tk-builder-message--success { color: #86efac; }
            .tk-builder-message--error { color: #fca5a5; }
            @media (max-width: 480px) {
                .tk-builder-inline, .tk-builder-grid--two, .tk-builder-grid--three { grid-template-columns: 1fr; display: grid; }
                .tk-builder-required { padding-bottom: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    function openConfigModal(editor, entry) {
        var overlay = el('div', 'tk-picker-modal-overlay');
        var modal = el('div', 'tk-picker-modal');
        var header = el('div', 'tk-picker-modal__header');
        header.innerHTML = `<h3>Configure: ${escapeHtml(entry.name)}</h3>`;
        var closeBtn = el('button', 'tk-picker-modal__close', '×');
        closeBtn.type = 'button';
        header.appendChild(closeBtn);
        
        var body = el('div', 'tk-picker-modal__body');
        var footer = el('div', 'tk-picker-modal__footer');
        
        var cancelBtn = el('button', 'tk-picker-btn tk-btn-cancel', 'Cancel');
        var insertBtn = el('button', 'tk-picker-btn tk-btn-insert', 'Insert Block');
        insertBtn.style.background = '#3b82f6';
        
        footer.appendChild(cancelBtn);
        footer.appendChild(insertBtn);
        
        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        var closeModal = function() {
            overlay.remove();
        };
        closeBtn.onclick = closeModal;
        cancelBtn.onclick = closeModal;
        
        var builder = BUILDERS[entry.tool] || GENERIC_BUILDER;
        var getHtmlFn = builder.render(body, entry);
        
        insertBtn.onclick = function() {
            var finalHtml = getHtmlFn();
            if (insertSnippet(editor, finalHtml)) {
                closeModal();
            } else {
                insertBtn.textContent = 'Failed!';
                insertBtn.style.background = '#ef4444';
                setTimeout(function() {
                    insertBtn.textContent = 'Insert Block';
                    insertBtn.style.background = '#3b82f6';
                }, 2000);
            }
        };
    }
  
    /* ── build the panel DOM for one editor ──────────────────────────── */
  
    /* group by category */
    var groups = Object.create(null);
    var groupOrder = [];
    CATALOG.forEach(function (entry) {
      var g = entry.group || "Other";
      if (!groups[g]) {
        groups[g] = [];
        groupOrder.push(g);
      }
      groups[g].push(entry);
    });
  
    function buildPanel(editor) {
      var panel = el("div", "tk-picker");
  
      /* toggle button */
      var toggle = el("button", "tk-picker__toggle", "⊕ Insert content block");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", "false");
      panel.appendChild(toggle);
  
      /* collapsible body */
      var body = el("div", "tk-picker__body");
      body.hidden = true;
  
      /* search */
      var search = el("input", "tk-picker__search");
      search.type = "search";
      search.placeholder = "Search blocks…";
      search.setAttribute("aria-label", "Search content blocks");
      body.appendChild(search);
  
      /* tab bar */
      var tabBar = el("div", "tk-picker__tabs");
      body.appendChild(tabBar);

      /* group list */
      var list = el("div", "tk-picker__list");
  
      var tabBtns = [];
      var groupSections = [];

      groupOrder.forEach(function (groupName, idx) {
        /* tab button */
        var tab = el("button", "tk-picker__tab", groupName);
        tab.type = "button";
        tab.setAttribute("data-target", groupName);
        if (idx === 0) tab.classList.add("tk-picker__tab--active");
        tabBar.appendChild(tab);
        tabBtns.push(tab);

        /* section container */
        var section = el("div", "tk-picker__group");
        section.setAttribute("data-group", groupName);
        if (idx !== 0) section.hidden = true; /* hide all but first initially */
        
        /* The title is no longer needed inside the group since we have tabs, but keep it for structure or hide it via CSS if preferred. Let's omit it for a cleaner look. */

        groups[groupName].forEach(function (entry) {
          var card = el("div", "tk-picker__card");
          card.setAttribute("data-tool", entry.tool);
          card.setAttribute(
            "data-search",
            (entry.name + " " + entry.tool + " " + entry.description + " " + groupName).toLowerCase()
          );
  
          var header = el("div", "tk-picker__card-header");
          header.appendChild(el("strong", "tk-picker__card-name", entry.name));
          if (entry.interactive) {
            header.appendChild(el("span", "tk-picker__badge", "interactive"));
          }
          card.appendChild(header);
  
          card.appendChild(
            el("p", "tk-picker__card-desc", entry.description)
          );
  
          /* insert button opens modal */
          var insertBtn = el("button", "tk-picker__insert", "Configure");
          insertBtn.type = "button";
          insertBtn.addEventListener("click", function () {
            openConfigModal(editor, entry);
          });
          card.appendChild(insertBtn);
  
          section.appendChild(card);
        });
  
        list.appendChild(section);
        groupSections.push(section);
      });
  
      body.appendChild(list);
      panel.appendChild(body);
  
      /* tab click logic */
      tabBar.addEventListener("click", function(e) {
          if (e.target.tagName !== "BUTTON") return;
          var targetGroup = e.target.getAttribute("data-target");
          
          /* clear search when changing tabs manually */
          search.value = "";
          var cards = list.querySelectorAll(".tk-picker__card");
          cards.forEach(function (c) { c.hidden = false; });

          tabBtns.forEach(function(btn) {
              if (btn === e.target) btn.classList.add("tk-picker__tab--active");
              else btn.classList.remove("tk-picker__tab--active");
          });
          groupSections.forEach(function(sec) {
              if (sec.getAttribute("data-group") === targetGroup) sec.hidden = false;
              else sec.hidden = true;
          });
      });

      /* toggle logic */
      toggle.addEventListener("click", function () {
        var open = body.hidden;
        body.hidden = !open;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) search.focus();
      });
  
      /* search filter */
      search.addEventListener("input", function () {
        var term = search.value.trim().toLowerCase();
        
        if (term.length === 0) {
            /* reset to currently active tab */
            var activeTab = tabBar.querySelector(".tk-picker__tab--active").getAttribute("data-target");
            groupSections.forEach(function(sec) {
                sec.hidden = (sec.getAttribute("data-group") !== activeTab);
                sec.querySelectorAll(".tk-picker__card").forEach(function(c) { c.hidden = false; });
            });
            tabBar.hidden = false;
            return;
        }

        /* hide tabs when searching */
        tabBar.hidden = true;

        var cards = list.querySelectorAll(".tk-picker__card");
        cards.forEach(function (c) {
          c.hidden = term.length > 0 && c.getAttribute("data-search").indexOf(term) === -1;
        });
        /* hide empty groups */
        var sections = list.querySelectorAll(".tk-picker__group");
        sections.forEach(function (sec) {
          var visible = sec.querySelectorAll(".tk-picker__card:not([hidden])");
          sec.hidden = visible.length === 0;
        });
      });
  
      return panel;
    }
  
    /* ── inject into CKEditor instances ──────────────────────────────── */
  
    function attachPanel(editor) {
      if (editor.ui.view.element.parentNode.querySelector(".tk-picker")) return;
      var panel = buildPanel(editor);
      editor.ui.view.element.parentNode.insertBefore(panel, editor.ui.view.element);
    }
  
    function scanAndAttach() {
      if (window.editors) {
        for (var key in window.editors) {
          attachPanel(window.editors[key]);
        }
      }
    }
  
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scanAndAttach);
    } else {
      scanAndAttach();
    }
  
    /* Also hook ckeditorRegisterCallback if defined */
    if (window.ckeditorRegisterCallback) {
      var oldCallback = window.ckeditorRegisterCallback;
      window.ckeditorRegisterCallback = function (id) {
        oldCallback(id);
        setTimeout(scanAndAttach, 100);
      };
    } else {
      window.ckeditorRegisterCallback = function (id) {
        setTimeout(scanAndAttach, 100);
      };
    }
  
  })(window, document);
