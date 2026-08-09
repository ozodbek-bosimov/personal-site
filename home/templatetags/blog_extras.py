import concurrent.futures
import datetime as _datetime
import html as _html
import json
import math
import re
import urllib.request

from django import template
from django.core.cache import cache
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
    r"""data-tk\s*=\s*["'](?:accordion|checklist|feedback|flashcards|gform|pros-cons|quiz|rating|spoiler|tabs|terminal|toc)["']""",
    re.IGNORECASE,
)

# Matches a native (non-toolkit) task/todo list — CKEditor 5's To-do List
# (`<ul class="todo-list">` with checkbox inputs), GitHub-flavoured markdown
# task lists, or a bare Unicode/markdown checkbox square. These carry no
# `data-tk` marker, but the runtime upgrades them into persistable
# tk-checklist blocks, so a page that contains one needs the stylesheet and
# the runtime too. Mirrors the detection in autoUpgradeNativeTaskLists.
_NATIVE_TODO_RE = re.compile(
    r"""class\s*=\s*["'][^"']*\b(?:todo-list|contains-task-list|task-list)\b|type\s*=\s*["']checkbox["']|[\u25a0\u25a1\u2610\u2611\u2612]|\s*\[[ xX]?\]""",
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
            # Spotify players are fixed-height widgets: a track is 152px,
            # artist/album/playlist 352px, show/episode 232px. Tag the
            # placeholder so its shimmer matches the real iframe height
            # instead of defaulting to the 152px track size (which leaves
            # a layout jump — and an oversized box — for longer embeds).
            ph_class += " lazy-iframe-ph--spotify"
            spotify_type_match = re.search(
                r"spotify\.com/embed/([a-z]+)/", iframe_lower
            )
            if spotify_type_match:
                ph_class += f" lazy-iframe-ph--spotify-{spotify_type_match.group(1)}"

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
    current snippet names, and native CKEditor to-do lists (which have no
    data-tk marker but are upgraded into persistable checklists at runtime),
    so existing posts keep working while their markup is migrated.
    """
    return bool(
        content
        and (_INTERACTIVE_TOOL_RE.search(content) or _NATIVE_TODO_RE.search(content))
    )


@register.filter(name="needs_content_tools_styles")
def needs_content_tools_styles(content):
    """Return whether stored rich text needs the content toolkit stylesheet.

    Broader than the runtime check: any data-tk block — including purely
    presentational ones such as callouts and quotes — needs the stylesheet,
    and so does a native to-do list, which the runtime turns into a styled,
    persistable checklist.
    """
    return bool(content and ("data-tk" in content or _NATIVE_TODO_RE.search(content)))


# ── X (Twitter) tweet cards ────────────────────────────────────
# The X embed iframe cannot be themed from outside: its media card is
# rendered white by X, and the card height varies by content, leaving a
# white gap at the iframe's bottom edge (both inside the cross-origin
# iframe). Instead of fighting the iframe we render our own dark card
# from the tweet page's payload — avatar, name, text, media thumbnail,
# timestamp and engagement counts — so the embed matches the site.

# Matches <figure class="media"><oembed url="https://x.com/USER/status/ID?...">
_X_OEMBED_RE = re.compile(
    r"""<figure\b[^>]*class\s*=\s*["'][^"']*\bmedia\b[^"']*["'][^>]*>\s*<oembed\b[^>]*url\s*=\s*["'](https://(?:x|twitter)\.com/[A-Za-z0-9_]+/status/(\d+)[^"']*)["'][^>]*>\s*</oembed>\s*</figure>""",
    re.IGNORECASE,
)

_X_FETCH_FAILED = "__x_fetch_failed__"

# Long-form / video tweets expose only the tweet's own shortened link in the
# anonymous payload (the body text is served to logged-in clients). A card
# whose "text" is just a t.co URL has no readable message, so omit it.
_X_TCO_ONLY_RE = re.compile(r"^https?://t\.co/\S+$")
_X_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)


@register.filter(name="x_cards")
def x_cards(content):
    """Replace X oEmbed figures with dark, site-native tweet cards.

    Tweet data is scraped from the status page and cached for a day; all
    cache misses for one page are fetched in parallel. A failed fetch is
    cached as a marker for five minutes, and the original <oembed> markup
    is kept so blogpost.js falls back to the regular iframe embed.
    """
    if not content:
        return content
    if "x.com" not in content.lower() and "twitter.com" not in content.lower():
        return content
    if not _X_OEMBED_RE.search(content):
        return content

    def _load(tweet_id, status_url):
        data = cache.get(f"x_card_{tweet_id}")
        if data is None:
            try:
                data = _fetch_x_data(tweet_id, status_url)
            except Exception:
                data = _X_FETCH_FAILED
            cache.set(
                f"x_card_{tweet_id}",
                data,
                86400 if data != _X_FETCH_FAILED else 300,
            )
        return tweet_id, data

    jobs = []
    seen = set()
    for m in _X_OEMBED_RE.finditer(content):
        status_url = _html.unescape(m.group(1)).split("?")[0]
        tweet_id = m.group(2)
        if tweet_id in seen:
            continue
        seen.add(tweet_id)
        jobs.append((tweet_id, status_url))

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        results = dict(ex.map(lambda job: _load(*job), jobs))

    def _replace(match):
        tweet_id = match.group(2)
        data = results[tweet_id]
        if (
            data is None
            or data == _X_FETCH_FAILED
            or not isinstance(data, dict)
            or not data.get("text")
        ):
            return match.group(0)
        return _render_x_card(data)

    return mark_safe(_X_OEMBED_RE.sub(_replace, content))


def _x_decode_escaped(value):
    """Decode a Relay-payload string, which may carry \\uXXXX escapes."""
    for _ in range(2):
        try:
            value = json.loads('"' + value + '"')
        except ValueError:
            break
    return value


def _fetch_x_data(tweet_id, status_url):
    """Fetch the status page and pull the tweet's identity, text and counts."""
    req = urllib.request.Request(status_url, headers={"User-Agent": _X_UA})
    with urllib.request.urlopen(req, timeout=10) as resp:
        page = resp.read().decode("utf-8", errors="replace")

    data = {
        "tweet_id": tweet_id,
        "status_url": status_url,
        "handle": None,
        "name": None,
        "avatar": None,
        "verified": False,
        "text": None,
        "media_url": None,
        "video_url": None,
        "aspect": None,
        "is_video": False,
        "created_ms": None,
        "likes": None,
        "replies": None,
    }

    m = re.search(r'screen_name:"([^"]+)"', page)
    if not m:
        raise ValueError("no tweet data")
    data["handle"] = m.group(1)

    m = re.search(
        r'name:"((?:[^"\\]|\\.)*)",url:"https://(?:x|twitter)\.com/'
        + re.escape(data["handle"]),
        page,
    )
    if m:
        data["name"] = _x_decode_escaped(m.group(1))
    m = re.search(r'image:"(https://pbs\.twimg\.com/profile_images/[^"]+)"', page)
    if m:
        data["avatar"] = m.group(1)
    if "is_blue_verified:!0" in page or re.search(r'"verified":true', page):
        data["verified"] = True

    m = re.search(r'full_text:"((?:[^"\\]|\\.)*)"', page)
    if m:
        data["text"] = _x_decode_escaped(m.group(1))
    if not data["text"]:
        raise ValueError("no tweet text")

    m = re.search(r'media_url_https:"(https://pbs\.twimg\.com/[^"]+)"', page)
    if not m:
        m = re.search(r'<meta property="og:image" content="(https://[^"]+)"', page)
    if m:
        data["media_url"] = _html.unescape(m.group(1))
    data["is_video"] = bool(re.search(r"video_info", page)) or (
        data["media_url"] and "amplify_video_thumb" in data["media_url"]
    )

    # Direct mp4 URL from the video variants (public CDN, no auth). Pick
    # the highest-resolution one; the video element plays it inline.
    variants = re.findall(
        r'content_type:"video/mp4",url:"(https://video\.twimg\.com/[^"]+)"',
        page,
    )
    if variants:

        def _vid_w(url):
            m = re.search(r"/vid/avc1/(\d+)x\d+/", url)
            return int(m.group(1)) if m else 0

        data["video_url"] = max(variants, key=_vid_w)

    mw = re.search(r'<meta property="og:image:width" content="(\d+)"', page)
    mh = re.search(r'<meta property="og:image:height" content="(\d+)"', page)
    if mw and mh and int(mh.group(1)) > 0:
        data["aspect"] = f"{mw.group(1)} / {mh.group(1)}"

    m = re.search(r"created_at_ms:(\d+)", page)
    if m:
        data["created_ms"] = int(m.group(1))
    m = re.search(r"favorite_count:(\d+)", page)
    if m:
        data["likes"] = int(m.group(1))
    m = re.search(r"reply_count:(\d+)", page)
    if m:
        data["replies"] = int(m.group(1))

    return data


def _x_format_count(count):
    """1908 -> 1.9K, 15500 -> 15.5K, 155 -> 155"""
    if count is None:
        return None
    if count >= 1_000_000:
        s = f"{count / 1_000_000:.1f}M"
    elif count >= 1_000:
        s = f"{count / 1_000:.1f}K"
    else:
        return str(count)
    return s.rstrip("0").rstrip(".")


def _x_format_time(ms):
    """1782039173000 -> "3:52 PM · Jun 21, 2026"""
    if not ms:
        return ""
    dt = _datetime.datetime.fromtimestamp(ms / 1000)
    time_part = dt.strftime("%I:%M %p").lstrip("0")
    return f"{time_part} · {dt.strftime('%b %d, %Y')}"


def _render_x_card(data):
    """Build the dark tweet card markup from the scraped data."""
    name = _html.escape(data.get("name") or data.get("handle") or "")
    handle = _html.escape(data.get("handle") or "")
    avatar = _html.escape(data.get("avatar") or "")
    text = _html.escape(data.get("text") or "")
    status_url = _html.escape(data["status_url"])

    badge = (
        '<span class="x-embed__badge" aria-label="Verified">'
        '<i class="bi bi-check2"></i></span>'
        if data.get("verified")
        else ""
    )

    # The media sits between two links (identity/text and footer) so a video
    # player is not nested inside an anchor: tapping play must play the video,
    # not navigate away. The tweet itself stays reachable from both links.
    # The media box has a fixed 4:5 ratio in CSS (like the Instagram
    # embed) so a tall source clip can't stretch the card — the media is
    # cover-cropped to fit, matching how X displays feed media.
    media = ""
    media_url = data.get("media_url")
    if media_url:
        if data.get("is_video") and data.get("video_url"):
            video_url = _html.escape(data["video_url"])
            media = (
                '<div class="x-embed__media">'
                f'<video controls preload="none" playsinline '
                f'poster="{_html.escape(media_url)}" src="{video_url}">'
                f'<a href="{status_url}" rel="noopener noreferrer">Watch on X</a>'
                "</video>"
                "</div>"
            )
        else:
            media = (
                '<div class="x-embed__media">'
                f'<img src="{_html.escape(media_url)}" alt="" '
                'loading="lazy" decoding="async" data-image-lightbox="false" />'
                "</div>"
            )

    stats = []
    likes = _x_format_count(data.get("likes"))
    replies = _x_format_count(data.get("replies"))
    if likes:
        stats.append(f'<span class="x-embed__stat"><i class="bi bi-heart"></i>{likes}</span>')
    if replies:
        stats.append(f'<span class="x-embed__stat"><i class="bi bi-chat"></i>{replies}</span>')
    stats_html = (
        f'<span class="x-embed__stats">{" ".join(stats)}</span>' if stats else ""
    )

    time_html = _x_format_time(data.get("created_ms"))

    # Omit the paragraph when the only extractable text is the tweet's own
    # t.co link (long-form/video tweets have no readable body anonymously).
    text_html = ""
    if text and not _X_TCO_ONLY_RE.match(text):
        text_html = f'<p class="x-embed__text">{text}</p>'

    return (
        '<figure class="media x-embed">'
        f'<a class="x-embed__link" href="{status_url}" '
        'target="_blank" rel="noopener noreferrer">'
        '<div class="x-embed__head">'
        f'<img class="x-embed__avatar" src="{avatar}" alt="" loading="lazy" />'
        '<span class="x-embed__who">'
        f'<span class="x-embed__user">{name}{badge}</span>'
        f'<span class="x-embed__handle">@{handle}</span>'
        "</span>"
        "</div>"
        f"{text_html}"
        "</a>"
        f"{media}"
        f'<a class="x-embed__link" href="{status_url}" '
        'target="_blank" rel="noopener noreferrer">'
        '<div class="x-embed__foot">'
        f'<span class="x-embed__time">{time_html}</span>'
        f"{stats_html}"
        '<span class="x-embed__cta">View on X</span>'
        "</div>"
        "</a>"
        "</figure>"
    )
