import math
import re

from django import template
from django.utils.safestring import mark_safe

register = template.Library()


@register.filter(name="reading_time")
def reading_time(content):
    """Return estimated reading time in minutes for HTML content."""
    if not content:
        return 1
    # Strip HTML tags
    text = re.sub(r"<[^>]+>", " ", content)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    # Count words
    word_count = len(text.split()) if text else 0
    # Average reading speed: 160 words per minute
    minutes = max(1, math.ceil(word_count / 160))
    return minutes


# Matches an entire <iframe ...>...</iframe> element (with optional closing tag)
_IFRAME_RE = re.compile(
    r"(<iframe\b[^>]*>)(</iframe>)?",
    re.IGNORECASE,
)


# The content toolkit stylesheet is useful for every `data-tk` block, but its
# runtime is only needed by blocks that promote stored prose into controls or
# retain browser-local state.  Keeping this list here lets templates skip the
# 20 KB (gzip) runtime for purely presentational blocks such as callouts,
# quotes and CTA banners.
_INTERACTIVE_TOOL_RE = re.compile(
    r'''data-tk\s*=\s*["'](?:accordion|checklist|feedback|flashcards|gform|pros-cons|quiz|rating|spoiler|tabs|terminal|toc)["']''',
    re.IGNORECASE,
)


@register.filter(name="lazy_iframes")
def lazy_iframes(content):
    """Replace iframes with placeholder + <template> for true lazy loading.

    The <template> element is inert — its content is NOT parsed, rendered,
    or loaded by the browser. When IntersectionObserver fires, we clone the
    template content and insert the ORIGINAL iframe into the DOM as a fresh
    element. This avoids Safari's Error 153 (caused by dynamically setting
    iframe.src via JS) because the cloned iframe has src set from birth.
    """
    if not content or "<iframe" not in content.lower():
        return content

    def _process(match):
        iframe_open = match.group(1)  # <iframe ...>
        iframe_close = match.group(2) or "</iframe>"  # </iframe>
        original = iframe_open + iframe_close

        ph_class = "lazy-iframe-ph"
        iframe_lower = iframe_open.lower()
        if "spotify.com" in iframe_lower:
            ph_class += " lazy-iframe-ph--spotify"

        return (
            f'<div class="{ph_class}"></div>'
            '<template class="lazy-tpl">' + original + "</template>"
        )

    result = _IFRAME_RE.sub(_process, content)
    return mark_safe(result)


@register.filter(name="needs_content_tools_runtime")
def needs_content_tools_runtime(content):
    """Return whether stored rich text needs the interactive toolkit runtime.

    This intentionally recognises legacy ``feedback`` blocks alongside the
    current snippet names, so existing posts keep working while their markup
    is migrated to the canonical Google Form bridge.
    """
    return bool(content and _INTERACTIVE_TOOL_RE.search(content))
