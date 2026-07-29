# CKEditor Content Toolkit

Ready-made content blocks you paste into a CKEditor field (blog post body, About
bio) to get callouts, tabs, checklists, quizzes and forms inside otherwise
ordinary rich text.

The blocks are plain HTML with `data-*` configuration. They survive CKEditor's
save/reopen cycle, they render without JavaScript, and they cost a visitor
nothing on pages that do not use them.

---

## How it fits together

| Piece | Path | Role |
| --- | --- | --- |
| Stylesheet | `static/css/content-tools.css` | All block styling, driven by `--tk-*` tokens. |
| Runtime | `static/js/content-tools.js` | Draws every interactive control and owns all event handling. |
| Snippets | `tools/snippets/*.html` | The copy-paste source of truth, one file per block. |
| Preview | `tools/preview/index.html` | Offline gallery — open it straight from disk. |
| Catalog | `static/js/generated/tools-catalog.js` | Built from the snippets by `manage.py build_tools_catalog`. |
| Admin picker | `static/js/admin_tools_picker.js` | Searchable insert panel above each CKEditor instance. |

Both render sites load the toolkit **conditionally**:

```django
{% if blog.content and 'data-tk' in blog.content %}
{% include 'partials/_content_tools_css.html' %}
{% endif %}
```

A post with no toolkit block downloads neither the CSS nor the JS. That is why
every block — even the purely decorative ones — carries a `data-tk` marker.

---

## The constraints this toolkit is built around

CKEditor 5 is configured with General HTML Support in allow-all mode
(`blogApp/settings.py` → `CKEDITOR_5_CONFIGS["default"]["htmlSupport"]`). That
preserves unknown tags, classes and attributes, but it is not a licence to write
anything. Five rules come out of it, and every snippet obeys them.

**1. Only these tags.**

```
div  p  span  ul  ol  li  a  h2  h3  h4
strong  em  code  table  figure  img  blockquote
```

**2. No `script`, `style`, `input`, `button`, `select`, `textarea`, `form`, or
any `on*` attribute.** GHS removes them on the first save. This is not a style
preference — a snippet that ships a `<button>` loses it the moment the author
hits Save, leaving a dead block behind.

**3. Every control is drawn by the runtime.** Buttons, checkboxes, radios, text
inputs, tab strips: all created in `content-tools.js` from `data-*`
configuration. Snippets ship structure and prose only.

**4. No empty elements.** An empty `<span>` does not come back. GHS models span
attributes as *text* attributes, so a span with nothing inside has nothing to
attach them to and is dropped. Decorative marks are CSS pseudo-elements;
containers the runtime fills are created by the runtime, never left empty in the
snippet. For the same reason no `<div>` holds a bare text node — text always
sits in a `p`, `li`, heading or `span`, which is what CKEditor would enforce
anyway (it auto-wraps loose text in `<p>` and that counts as a changed round
trip).

**5. No Tailwind utility classes.** Tailwind's content globs
(`theme/static_src/tailwind.config.js`) scan `templates/` only — never database
content. A utility class used in a snippet is not in the compiled stylesheet, so
it renders as nothing. Toolkit classes are all prefixed `tk-` and defined in
`content-tools.css`.

### Labels are text, not attributes

Where a control has a visible label — an accordion question, a tab name, a
spoiler summary — that label lives in the markup as a real heading or paragraph,
and the runtime *promotes* it into a button. Two things fall out of this: the
author edits labels directly in the editor like any other prose, and with
JavaScript off the block degrades into a readable list of headings and text
rather than vanishing. Configuration that has no visible counterpart (a Google
Form field id, a quiz answer key, a copy-button tooltip) is what `data-*` is for.

---

## Round-trip check

Every snippet must survive the editor untouched:

1. Paste the snippet into the field (CKEditor toolbar → **Source**, or use the
   admin picker).
2. Save.
3. Reopen the record and look at **Source** again.
4. The markup must be structurally identical — same tags, same nesting, same
   classes, same `data-*` values.

Attribute *order* may differ; CKEditor re-serialises attributes from its own
model. That is not a failure. Losing a tag, an attribute, or a nesting level is.

`python manage.py build_tools_catalog --check` enforces the mechanical half of
this (rules 1–5 above, plus metadata completeness) on every snippet file. Step
3's visual comparison is the part a human still has to do, once, when adding a
new block.

**If a block cannot survive the round trip**, fall back to raw HTML embed:
insert it as a `raw-html-embed` block instead (the admin picker has a toggle for
this). CKEditor then stores the markup verbatim and never parses it. The cost is
that the block is no longer editable as rich text — the author edits raw HTML in
a small textarea — so it is a last resort, not a default.

---

## Block reference

### Buttons / CTA row

**Tool:** `button` · **Group:** Actions

A row of link-buttons in four styles. Keep the ones you need and delete the rest.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `variant class` | tk-btn--primary / tk-btn--gradient / tk-btn--ghost / tk-btn--icon | tk-btn--primary | Second class on the anchor. Chooses the look. |
| `data-tk-icon` | arrow / download / external / play / mail / check / star / code | arrow | Leading glyph. Only read by tk-btn--icon. |
| `href` | url | # | Where the button goes. Add target/rel yourself for external links. |

**Accessibility:** These are real links, so keyboard and screen-reader behaviour is the browser's. The glyph is CSS-generated and stays out of the accessible name.

**Limits:** Anchors only — a `<button>` would be stripped on save. For an action that needs JavaScript, use a block that ships its own control (terminal, quiz, gform).

---

### CTA banner

**Tool:** `cta-banner` · **Group:** Actions

Full-width prompt with a headline, a line of supporting copy and one or two buttons.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-variant` | solid / gradient / outline | gradient | Background treatment of the banner. |
| `buttons` | 1-2 anchors | 1 | Add a second anchor inside p.tk-cta__actions for a secondary action. |

**Accessibility:** The headline is an h3, so it takes part in the document outline. Keep it under the h2 of its section.

**Limits:** Buttons stack full-width below 34rem. Three or more actions crowd the banner — use a button row instead.

---

### File card

**Tool:** `file-card` · **Group:** Cards

Download row for an attachment, with a file-type badge and a size/format line.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-ext` | any short string | pdf | Text shown in the badge. Rendered straight from the attribute via CSS, so nothing is duplicated as markup. |
| `href` | url | # | File URL. Point it at /media/... for an uploaded file or /shared/... for a shared one. |
| `meta paragraph` | text | PDF · 1.4 MB | Free-form. Type the real size yourself; nothing measures it. |

**Accessibility:** The badge and download arrow are CSS-generated. The link text should name the file, not say "click here".

**Limits:** One link per card (full-card hit area, same as the link card). Uploading the file is a separate step — this block only points at it.

---

### Link card

**Tool:** `link-card` · **Group:** Cards

A bordered card that links out, with room for a title, a short description and the host name.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `href` | url | https://example.com | Target of the card. The whole card is clickable, not just the title. |
| `host paragraph` | text | example.com | Optional. Delete p.tk-linkcard__host to drop the footer line. |

**Accessibility:** One link, one accessible name — the title text. The link-icon and hit area are CSS, so nothing extra is announced.

**Limits:** Exactly one link per card. A second link would sit under the invisible full-card hit area and be unreachable.

---

### Accordion / FAQ

**Tool:** `accordion` · **Group:** Disclosure · **Interactive:** yes

A stack of collapsible question-and-answer rows. Good for an FAQ section or a set of optional details.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-single` | yes / no | yes | When yes, opening one row closes the others. |
| `item data-open` | yes / no | no | Put it on a .tk-accordion__item to have that row start expanded. |
| `question` | h3 text | — | One h3.tk-accordion__q per item. The runtime promotes it into a button inside the heading. |

**Accessibility:** Follows the ARIA accordion pattern — h3 > button with aria-expanded and aria-controls, panels as labelled regions. Up/Down arrows move between rows, Home and End jump to the ends.

**Limits:** Questions stay h3, so keep them under an h2 in the page outline. With JavaScript off every question and answer is simply visible.

---

### Spoiler

**Tool:** `spoiler` · **Group:** Disclosure · **Interactive:** yes

Hides an answer, a solution or a long aside behind a single click.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-open` | yes / no | no | Whether the block starts expanded. |
| `summary paragraph` | text | Show the answer | The clickable label. Inline formatting inside it survives — the runtime moves the nodes, it does not copy the text. |

**Accessibility:** The runtime turns the summary into a real button with aria-expanded and aria-controls; the body is a labelled group. Enter and Space work because it is a genuine button.

**Limits:** With JavaScript off both the summary and the body are plain visible text. That is deliberate — a spoiler that can never be opened is worse than no spoiler.

---

### Tabs

**Tool:** `tabs` · **Group:** Disclosure · **Interactive:** yes

Shows one panel at a time from a strip of tabs. Best for the same thing in several languages, tools or operating systems.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-active` | 1-based index | 1 | Which panel is open when the page loads. |
| `panel label` | h3 text | — | One h3.tk-tabs__label per panel. Its text becomes the tab name and the heading is then hidden. |

**Accessibility:** Proper tablist/tab/tabpanel roles with aria-selected and a roving tabindex, so Tab moves past the strip into the panel. Left/Right arrows switch panel, Home and End jump to the ends.

**Limits:** Needs at least two panels or the block is left alone. With JavaScript off every panel is visible with its label showing, which reads as a run of subsections.

---

### Terminal with copy

**Tool:** `terminal` · **Group:** Disclosure · **Interactive:** yes

A shell transcript with a one-click copy button. Copies the commands only — never the prompt, never the output.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-label` | text | terminal | Caption in the title bar. Usually the shell name: bash, zsh, psql. |
| `data-copy-label` | text | Copy | Resting label of the copy button. |
| `line data-kind` | out | (command) | Put data-kind="out" on a line to mark it as program output: dimmed, no prompt, and left out of what the copy button collects. |

**Accessibility:** The copy button is a real button; the result is announced through a polite live region. The prompt is a CSS pseudo-element and is never read out.

**Limits:** pre is not on the allowed-tag list, so each line is its own paragraph. That wraps better on a phone, but it also means blank lines have to be omitted rather than typed.

---

### Google Form bridge

**Tool:** `gform` · **Group:** Feedback · **Interactive:** yes

Renders a validated form from data attributes and sends it to a Google Form without exposing editor-hostile controls in stored content.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-action` | Google Forms formResponse URL | — | HTTPS endpoint copied from the target form, ending in /formResponse. |
| `field data-field` | entry.`<number>` | — | Google Forms entry id that receives this field. |
| `field data-type` | text / email / url / tel / number / date / textarea / select / radio / checkbox | text | Runtime control type. |
| `field data-label` | text | — | Visible and accessible control label. |
| `field data-required` | yes / no | no | Enables required validation. |
| `field data-options` | values separated by `\|` | — | Required for select, radio and checkbox fields. |
| `data-min-time` | seconds | 3 | Rejects submissions completed implausibly quickly. |
| `data-cooldown` | seconds | 30 | Minimum wait after a successful send in this browser. |
| `data-submit-label` | text | Send | Submit action label. |
| `data-success / data-error` | text | built-in messages | Success and transport-error status messages. |

**Accessibility:** Runtime labels are explicitly associated with controls, required fields expose aria-required, errors are linked with aria-describedby, the first invalid control receives focus, and status uses a polite live region.

**Limits:** Google Forms no-cors responses are opaque, so success means the browser dispatched the request, not that Google accepted a specific value. Replace every REPLACE placeholder before publishing.

---

### Helpful rating

**Tool:** `rating` · **Group:** Feedback · **Interactive:** yes

Sends a thumbs-up or thumbs-down value to one Google Forms field and remembers the vote in this browser.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-action` | Google Forms formResponse URL | — | HTTPS endpoint copied from the target form, ending in /formResponse. |
| `data-field` | entry.`<number>` | — | Google Forms field that receives the vote. |
| `data-up-label / data-down-label` | text | Helpful / Not helpful | Visible button labels. |
| `data-up-value / data-down-value` | text | up / down | Values posted to Google Forms. |
| `data-cooldown` | seconds | 30 | Minimum wait after a successful vote. |
| `data-success / data-error` | text | built-in messages | Result messages announced after submission. |

**Accessibility:** The two runtime buttons form a labelled group, expose aria-pressed, and report submission state through a polite live region.

**Limits:** One vote is stored per page and block id in this browser. A no-cors response confirms dispatch only. Replace every REPLACE placeholder before publishing.

---

### Badge · kbd · chip

**Tool:** `inline` · **Group:** Inline

Small inline pieces for prose — a status badge, a keyboard key, and a tag chip.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `span.tk-badge data-variant` | info / success / warning / danger / accent | neutral | Colour of the badge. Omit the attribute for the neutral grey. |
| `span.tk-kbd` | text | — | One key per span. Type the + between two of them as ordinary text. |
| `span.tk-chip` | text | — | The leading # is CSS, so do not type it. |

**Accessibility:** Plain spans, so the text is read normally in the flow of the sentence. The chip's # is decorative and not announced.

**Limits:** The data-tk marker on the paragraph is what loads the toolkit stylesheet for the page. Moving these spans into an ordinary paragraph leaves them unstyled unless that paragraph gets data-tk="inline" too, or another toolkit block is present.

---

### Callout

**Tool:** `callout` · **Group:** Notes & callouts

Coloured note box for an aside, a tip, a caveat or a result. Five variants share one layout.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-variant` | info / tip / warning / danger / success | info | Sets the rail colour, background wash and badge glyph. |
| `title paragraph` | text | "Good to know" | Optional. Delete the whole p.tk-callout__title line to drop the heading. |

**Accessibility:** The badge glyph is drawn with CSS content, so it stays out of the accessibility tree and out of copied text.

**Limits:** Body takes paragraphs, lists and inline formatting. Do not nest another data-tk block inside it.

---

### Key takeaways

**Tool:** `key-takeaways` · **Group:** Notes & callouts

Tinted summary panel with a tick-marked list. Works at the top of a long post as a preview, or at the end as a recap.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `title paragraph` | text | Key takeaways | Optional. Delete p.tk-takeaways__title to drop the heading. |
| `list items` | 2-6 li | 3 | Add or remove li. One sentence each reads best. |

**Accessibility:** A real ul, so screen readers announce the item count. The tick marks are CSS and are not read out.

**Limits:** Plain sentences only. Nest no other data-tk block inside the list.

---

### Pull quote

**Tool:** `quote` · **Group:** Notes & callouts

A quotation set off from the body text, with an attribution line for name and role.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `quote text` | p inside blockquote | — | One or more paragraphs. The opening curly quote is CSS, so do not type one. |
| `attribution` | strong + span | — | Delete the whole p.tk-quote__cite line for an unattributed quote. |

**Accessibility:** A real blockquote, announced as a quotation. The decorative quote mark is a pseudo-element and is not read.

**Limits:** Overrides the blockquote styling from base.css on purpose, so it will not match a plain editor blockquote. Pick one or the other per post.

---

### Checklist

**Tool:** `checklist` · **Group:** Progress · **Interactive:** yes

A tickable list that remembers where the reader got to, with a progress bar and a clear button.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-tk-id` | short slug | (position in page) | Storage key for this block. Set it on any checklist whose progress is worth keeping — without it the key falls back to the block's position, which shifts if blocks are reordered. |
| `data-persist` | yes / no | yes | Set no for a throwaway checklist that should start empty on every visit. |
| `data-reset-label` | text | Clear | Label of the button that unticks everything. |
| `title paragraph` | text | — | Optional p.tk-checklist__title. Also used as the accessible name of the progress bar. |

**Accessibility:** Real checkboxes wrapped in labels, so the whole row is clickable and keyboard behaviour is the browser's. The counter is a polite live region and the bar is a progressbar with aria-valuetext.

**Limits:** Progress lives in this browser's localStorage only — it does not follow the reader to another device, and private browsing loses it on close. Item state is keyed on the item's text, so rewording an item resets that one line.

---

### Flashcards

**Tool:** `flashcards` · **Group:** Recall · **Interactive:** yes

A keyboard-friendly deck that shows one prompt at a time, reveals its answer, moves in both directions and can shuffle.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-shuffle` | yes / no | no | Shuffle once when the deck initializes. |
| `data-flip-label` | text | Flip | Label of the answer reveal action. |
| `data-shuffle-label` | text | Shuffle | Label of the deck shuffle action. |
| `front paragraph` | text and inline markup | — | The prompt or term shown first and used as the card's accessible label. |
| `back container` | rich text | — | The answer revealed by the runtime. |

**Accessibility:** Previous, next, flip and shuffle are real buttons. The flip button carries aria-expanded and aria-controls, the counter is a polite live region, and Left/Right arrows move through the deck from any deck control.

**Limits:** Progress is not persisted. With JavaScript off all front/back pairs remain visible in source order as a readable glossary.

---

### Quiz

**Tool:** `quiz` · **Group:** Recall · **Interactive:** yes

Single-choice, multiple-choice and true/false questions with immediate feedback, score, retry and a best result saved in this browser.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-tk-id` | short slug | (position in page) | Stable localStorage identity for the best score. Set this when the result is worth keeping. |
| `question data-type` | single / multi / true-false | single | Chooses radio buttons, checkboxes with a Check action, or a two-choice true/false question. |
| `question data-answer` | option text or 1-based index; comma-separated for multi | — | Correct answer key. Text matching is case-insensitive. |
| `question data-answer-b64` | base64 text | — | Optional obfuscated replacement for data-answer. This is not encryption; it only makes source inspection less obvious. |
| `question data-explain` | text | — | Explanation shown and announced immediately after the question is judged. |
| `data-check-label` | text | Check | Label for the per-question action on multi-answer questions. |
| `data-retry-label` | text | Try again | Label for the action that resets the current run without deleting the best score. |
| `data-report` | entry.`<number>` | — | Optional Google Forms field that receives the completed score. |
| `data-action` | Google Forms formResponse URL | — | Required only when data-report is set. |

**Accessibility:** Runtime inputs are wrapped by labels; prompts label their groups; score and feedback use polite live regions. Native radio and checkbox keyboard behaviour is preserved.

**Limits:** Best score is local to this browser. Multi-answer questions wait for the explicit Check action because selecting one checkbox does not mean the reader has finished.

---

### Divider

**Tool:** `divider` · **Group:** Structure

A section break: a hairline, a gradient rule, three dots, or a small centred label between two rules.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-variant` | line / dots / gradient / label | dots | Which treatment to draw. |
| `mark paragraph` | text | * * * | Visible for dots and label. Hidden by CSS for line and gradient — leave it in place regardless. |

**Accessibility:** For line and gradient the mark paragraph is display:none, so screen readers skip it too and the divider stays purely decorative.

**Limits:** hr is not on the allowed-tag list and an empty div is not safe to hand CKEditor, which is why the mark paragraph always ships.

---

### Pros & cons

**Tool:** `pros-cons` · **Group:** Structure

Two tinted columns for weighing an option. Green ticks on the left, red crosses on the right.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-kind` | pro / con | pro | On each column. Sets the accent colour and the list marker. |
| `column title` | text | Pros / Cons | Rename freely — "Worth it" / "Watch out", "Before" / "After". |

**Accessibility:** Two separate lists rather than a table, so each column is announced with its own heading and item count.

**Limits:** Two columns. The grid will accept a third but the colour vocabulary only has two meanings.

---

### Responsive table

**Tool:** `table` · **Group:** Structure

Wraps a table so wide columns scroll sideways instead of overflowing the page, with a sticky header row.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `inner table` | figure.table > table | 3 x 3 | Edit with the normal CKEditor table tools once inserted — insert row, merge cells and so on all still work. |
| `hint paragraph` | text | Scroll sideways... | Optional. Shown below 48rem only. Delete p.tk-tablewrap__hint to drop it. |

**Accessibility:** Header cells stay th, so row/column association survives. The scroll container is focusable by keyboard in browsers that support it.

**Limits:** Inner markup deliberately mirrors what CKEditor's table feature emits (figure.table > table > thead/tbody). Do not replace the figure with a div or the round trip breaks.

---

### Stat cards

**Tool:** `stats` · **Group:** Structure

A row of headline numbers with labels. For results, benchmarks or before/after figures.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-cols` | 2 / 3 / 4 | 3 | Columns from 40rem up. Below that the grid falls back to auto-fit. |
| `note paragraph` | text | — | Optional third line per card for a caveat or source. |

**Accessibility:** Values and labels are ordinary paragraphs, read in order. The gradient number keeps a real text colour fallback.

**Limits:** Figures are typed in, not computed. Keep values short — a long number breaks the single-line layout.

---

### Steps

**Tool:** `steps` · **Group:** Structure

Numbered procedure with a connector rail down the left. Numbers come from a CSS counter, so inserting a step renumbers the rest.

| Attribute | Values | Default | Purpose |
| --- | --- | --- | --- |
| `data-start` | 2 - 10 | 1 | Number the first step from here. For a procedure continued after an interruption. |
| `step title` | h3 text | — | Optional per step. Delete the h3 and keep only the paragraph for an unheaded step. |

**Accessibility:** A real ol, so position and count are announced. Numbers are CSS-generated, which means they are not read twice.

**Limits:** data-start is supported up to 10 (counter-reset takes a literal integer, so each value is a separate rule). No nested steps.

---

## Adding a new block

1. **Write the snippet** at `tools/snippets/<tool>.html`, starting with a
   `tk:meta` header (see format below) and a root element carrying
   `data-tk="<tool>"` plus `class="tk-block tk-<tool>"`.
2. **Style it** in `static/css/content-tools.css`, using `--tk-*` tokens rather
   than literal colours so it tracks the site palette and the editor's light
   surface automatically.
3. **If it is interactive**, register a tool in `static/js/content-tools.js`
   with `ContentTools.register('<tool>', fn)` and its handlers with
   `ContentTools.action('<name>', fn)`.
4. **Rebuild the catalog**: `python manage.py build_tools_catalog`.
5. **Verify**: `python manage.py build_tools_catalog --check`, then the manual
   round-trip check above, then add the block to `tools/preview/index.html`.
6. **Bump** `STATIC_ASSET_VERSION` in `blogApp/settings.py` (or set
   `APP_STATIC_ASSET_VERSION`) so browsers pick up the new CSS/JS.

### `tk:meta` header format

An HTML comment at the very top of the snippet file. Keys are `key: value`, one
per line; `param:` may repeat and its value is four `::`-separated fields.

```html
<!-- tk:meta
name: Callout
tool: callout
group: Notes & callouts
description: One sentence, shown in the picker.
interactive: no
param: <attribute or part> :: <allowed values> :: <default> :: <what it does>
a11y: Anything a reviewer should know about assistive tech.
limits: What the block will not do.
-->
```

`name`, `tool`, `group` and `description` are required; the rest are optional.
`tool` must match the `data-tk` value in the markup — the check command
verifies it.
