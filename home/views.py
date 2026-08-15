import hashlib
import ipaddress
import json
import logging
import operator
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from functools import reduce

from django.contrib.admin.views.decorators import staff_member_required
from django.core.cache import cache
from django.core.paginator import Paginator
from django.db.models import Count, Prefetch, Q
from django.http import (
    FileResponse,
    Http404,
    HttpResponse,
    HttpResponseRedirect,
    JsonResponse,
)
from django.shortcuts import render
from django.templatetags.static import static
from django.urls import reverse
from django.views.decorators.http import require_POST

from home.models import AboutMe, Blog, Experience, ExperienceRole, Project, Skill

logger = logging.getLogger(__name__)

# Sentinel: distinguishes "key not in cache" from "key cached with value None".
# cache.get() returns None in both cases, so we pass this as the default instead.
_CACHE_MISS = object()


# Google Form field detection is an admin-only convenience feature.  Keep its
# network work small because this site deliberately runs with a single worker.
_FORM_DETECT_RATE_LIMIT_REQUESTS = 6
_FORM_DETECT_RATE_LIMIT_WINDOW_SECONDS = 60
_FORM_DETECT_TIMEOUT_SECONDS = 5
_FORM_DETECT_MAX_RESPONSE_BYTES = 1 * 1024 * 1024
_FORM_DETECT_CACHE_SECONDS = 10 * 60
_GOOGLE_FORM_HOSTS = frozenset({"docs.google.com", "forms.gle"})
_GOOGLE_PUBLISHED_FORM_PATH_RE = re.compile(
    r"^/forms/(?:u/\d+/)?d/e/(?P<form_id>[A-Za-z0-9_-]+)"
    r"(?:/(?:viewform|edit|preview|formResponse))?/?$"
)
_GOOGLE_EDIT_FORM_PATH_RE = re.compile(
    r"^/forms/(?:u/\d+/)?d/(?P<form_id>[A-Za-z0-9_-]+)"
    r"(?:/(?:viewform|edit|preview|formResponse))?/?$"
)
_GOOGLE_SHORT_LINK_PATH_RE = re.compile(r"^/[A-Za-z0-9_-]{1,128}/?$")


class _UnsafeGoogleFormURL(ValueError):
    """Raised when a form URL or redirect leaves the Google Forms allowlist."""


class _GoogleFormResponseTooLarge(ValueError):
    """Raised when a remote response exceeds the bounded inspection size."""


class _GoogleFormFetchError(RuntimeError):
    """Raised for upstream failures without exposing transport details to clients."""


def _is_valid_ip(ip):
    """Validate if string is a valid IPv4 or IPv6 address using stdlib."""
    if not ip:
        return False
    try:
        ipaddress.ip_address(ip)
        return True
    except ValueError:
        return False


def custom_404(request, exception=None):
    return render(request, "404.html", status=404)


def index(request):
    # 'about_me' is already injected by the about_me context processor,
    # but we still need the object locally to build absolute image URLs.
    about_me = cache.get("about_me_singleton", _CACHE_MISS)
    if about_me is _CACHE_MISS:
        about_me = AboutMe.objects.first()
        cache.set("about_me_singleton", about_me, 86400 * 30)

    abs_profile_image = ""
    abs_hero_image = ""
    hero_bg_image = (
        f"{request.scheme}://{request.get_host()}{static('images/banner.jpg')}"
    )

    if about_me:
        abs_profile_image = about_me.get_absolute_profile_image_url(request)
        abs_hero_image = about_me.get_absolute_hero_image_url(request)

        if abs_hero_image:
            hero_bg_image = abs_hero_image

    # Cache intensive numbers and homepage queries to save VPS CPU
    latest_blogs = cache.get_or_set(
        "latest_blogs", lambda: list(Blog.objects.order_by("-time", "-sno")[:3]), 86400
    )
    total_blogs = cache.get_or_set("total_blogs", lambda: Blog.objects.count(), 86400)
    total_projects = cache.get_or_set(
        "total_projects", lambda: Project.objects.count(), 86400
    )
    total_topics = cache.get_or_set(
        "total_topics",
        lambda: Blog.objects.values("topic").distinct().count(),
        86400,
    )

    context = {
        # 'about_me' intentionally omitted — provided by the about_me context processor
        "abs_profile_image": abs_profile_image,
        "abs_hero_image": abs_hero_image,
        "hero_bg_image": hero_bg_image,
        "latest_blogs": latest_blogs,
        "total_blogs": total_blogs,
        "total_projects": total_projects,
        "total_topics": total_topics,
    }
    return render(request, "index.html", context)


def about(request):
    # Needed locally only to build the absolute profile image URL.
    about_me = cache.get("about_me_singleton", _CACHE_MISS)
    if about_me is _CACHE_MISS:
        about_me = AboutMe.objects.first()
        cache.set("about_me_singleton", about_me, 86400 * 30)

    # Skills rarely change — cache them for 24 hours.
    skills = cache.get_or_set("all_skills", lambda: list(Skill.objects.all()), 86400)

    # Experience entries — cache for 24 hours.
    experiences = cache.get_or_set(
        "all_experiences",
        lambda: list(
            Experience.objects.filter(roles__isnull=False)
            .distinct()
            .prefetch_related(
                Prefetch(
                    "roles", queryset=ExperienceRole.objects.order_by("-start_date")
                )
            )
        ),
        86400,
    )

    abs_profile_image = ""
    if about_me:
        abs_profile_image = about_me.get_absolute_profile_image_url(request)

    all_blogs = cache.get_or_set(
        "all_blogs_list",
        lambda: list(Blog.objects.order_by("-time", "-sno")),
        86400,
    )
    latest_blogs_about = all_blogs[:5]

    # 'about_me' intentionally omitted — provided by the about_me context processor
    context = {
        "skills": skills,
        "experiences": experiences,
        "abs_profile_image": abs_profile_image,
        "latest_blogs": latest_blogs_about,
    }
    return render(request, "about.html", context)


def projects(request):
    # prefetch_related keeps the gallery slides on the cached objects, so
    # rendering the carousel costs no extra queries on a cache hit.
    projects = cache.get_or_set(
        "all_projects",
        lambda: list(Project.objects.prefetch_related("images")),
        86400,
    )
    context = {"projects": projects}
    return render(request, "projects.html", context)


def blog(request):
    # Cache all blog posts for 24 hours; invalidated by post_save/post_delete signals.
    # Paginator slices the in-memory list — no extra DB queries per page.
    all_blogs = cache.get_or_set(
        "all_blogs_list",
        lambda: list(Blog.objects.order_by("-time", "-sno")),
        86400,
    )
    paginator = Paginator(all_blogs, 5)
    page = request.GET.get("page")
    blogs = paginator.get_page(page)
    context = {"blogs": blogs, "query": ""}
    return render(request, "blog.html", context)


def topic(request, topic):
    # Reuse the already-cached full blog list and filter in Python.
    # This avoids a per-topic DB query while keeping a single cache key to invalidate.
    all_blogs = cache.get_or_set(
        "all_blogs_list",
        lambda: list(Blog.objects.order_by("-time", "-sno")),
        86400,
    )
    topic_list = [b for b in all_blogs if b.topic == topic]

    if not topic_list:
        message = f"No posts found in topic: '{topic}'"
        # Return a real 404 (not a 200) so Google treats an empty/non-existent
        # topic as "Not found" instead of flagging it as a Soft 404.
        return render(
            request,
            "topic.html",
            {"message": message, "topic": topic, "query": ""},
            status=404,
        )

    paginator = Paginator(topic_list, 3)
    page = request.GET.get("page")
    topic_posts = paginator.get_page(page)
    return render(
        request,
        "topic.html",
        {"topic": topic, "topic_posts": topic_posts, "query": ""},
    )


def topics(request):
    all_topics = cache.get_or_set(
        "all_topics",
        lambda: list(
            Blog.objects.values("topic")
            .annotate(count=Count("topic"))
            .order_by("topic")
        ),
        86400,
    )
    return render(request, "topics.html", {"all_topics": all_topics})


def search(request):
    # Rate limit: 20 requests per minute per IP
    ip = (
        (
            request.META.get("HTTP_X_FORWARDED_FOR", "")
            or request.META.get("REMOTE_ADDR", "")
        )
        .split(",")[0]
        .strip()
    )

    if ip and _is_valid_ip(ip):
        rl_key = f"search_rl_{ip}"
        try:
            req_count = cache.incr(rl_key)
        except ValueError:
            # Key doesn't exist yet — set it with a 60-second window.
            cache.set(rl_key, 1, 60)
            req_count = 1

        if req_count > 20:
            # Keep template expectations consistent: `results` should be a Page object
            # so pagination checks (`has_previous`/`has_next`) don't error.
            empty_page = Paginator(Blog.objects.none(), 3).get_page(1)
            return render(
                request,
                "search.html",
                {
                    "results": empty_page,
                    "query": "",
                    "message": "Too many requests. Please wait a moment and try again.",
                    "rate_limited": True,
                },
                status=429,
            )

    query = (request.GET.get("q") or "").strip()

    # Prevent abusive queries: max 50 characters
    query = query[:50]

    if query:
        # Prevent SQL complexity DoS: max 5 words per search
        query_list = query.split()[:5]
        q_objects = [
            Q(title__icontains=word) | Q(content__icontains=word) for word in query_list
        ]
        combined_q = reduce(operator.and_, q_objects)
        results = Blog.objects.filter(combined_q).distinct().order_by("-time", "-sno")
    else:
        results = Blog.objects.none()

    paginator = Paginator(results, 3)
    page = request.GET.get("page")
    results_page = paginator.get_page(page)

    if len(results_page) == 0:
        message = (
            "Sorry, no results found for your search query."
            if query
            else "Please enter a search query."
        )
        rate_limited = False
    else:
        message = ""
        rate_limited = False

    return render(
        request,
        "search.html",
        {
            "results": results_page,
            "query": query,
            "message": message,
            "rate_limited": rate_limited,
        },
    )


def blogpost(request, slug):
    try:
        blog_cache_key = f"blogpost_{slug}"
        blog = cache.get_or_set(
            blog_cache_key, lambda: Blog.objects.get(slug=slug), 86400
        )

        thumb = blog.get_absolute_thumbnail_url(request)

        # Build full blog URL for sharing
        blog_url = f"{request.scheme}://{request.get_host()}{request.path}"

        context = {"blog": blog, "abs_thumbnail": thumb, "blog_url": blog_url}
        return render(request, "blogpost.html", context)
    except Blog.DoesNotExist:
        context = {"message": "Blog post not found"}
        return render(request, "404.html", context, status=404)


def github_calendar_proxy(request):
    about_me = cache.get("about_me_singleton", _CACHE_MISS)
    if about_me is _CACHE_MISS:
        about_me = AboutMe.objects.first()
        cache.set("about_me_singleton", about_me, 86400 * 30)

    if not about_me or not about_me.github_url:
        return HttpResponse("GitHub URL not configured", status=404)

    match = re.search(r"github\.com/([a-zA-Z0-9_-]+)", about_me.github_url)
    if not match:
        return HttpResponse("Invalid GitHub URL in config", status=400)

    username = match.group(1)

    cache_key = f"github_contrib_{username}"
    cached_html = cache.get(cache_key)
    if cached_html is not None:
        response = HttpResponse(cached_html, content_type="text/html")
        response["Cache-Control"] = "public, max-age=600"
        return response

    url = f"https://github.com/users/{username}/contributions"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as api_response:
            html_data = api_response.read().decode("utf-8")
            # Cache for 10 minutes so a Cloudflare/browser miss doesn't hit GitHub every time.
            cache.set(cache_key, html_data, 600)
            response = HttpResponse(html_data, content_type="text/html")
            response["Cache-Control"] = "public, max-age=600"
            return response
    except Exception:
        logger.warning(
            "GitHub contributions proxy failed for %s", username, exc_info=True
        )
        return HttpResponse(status=502)


def leetcode_proxy(request):
    about_me = cache.get("about_me_singleton", _CACHE_MISS)
    if about_me is _CACHE_MISS:
        about_me = AboutMe.objects.first()
        cache.set("about_me_singleton", about_me, 86400 * 30)

    if not about_me or not about_me.leetcode_url:
        return HttpResponse("LeetCode URL not configured", status=404)

    match = re.search(r"leetcode\.com/(?:u/)?([a-zA-Z0-9_-]+)", about_me.leetcode_url)
    if not match:
        return HttpResponse("Invalid LeetCode URL in config", status=400)

    username = match.group(1)

    cache_key = f"leetcode_svg_{username}"
    cached_svg = cache.get(cache_key)
    if cached_svg:
        response = HttpResponse(cached_svg, content_type="image/svg+xml")
        response["Cache-Control"] = "public, max-age=600"
        return response

    url = f"https://leetcard.jacoblin.cool/{username}?font=Poppins&ext=heatmap&border=0&radius=0&theme=dark"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as api_response:
            svg_data = api_response.read().decode("utf-8")

            # Inject custom CSS to make the heatmap match the site's cyan theme perfectly
            custom_styles = """
            <style>
                #background, #total-solved-bg, #total-solved-ring { fill: transparent !important; }
                #total-solved-bg, #easy-solved-bg, #medium-solved-bg, #hard-solved-bg, line:not([id*="-solved-"]) { stroke: #2d3748 !important; }
                rect[class^="ext-heatmap-"] { rx: 2px !important; ry: 2px !important; }
                #ext-heatmap-cells { opacity: 1 !important; }

                /* Graduated intensity scale by daily submission count.
                   Default (highest tier, 21+ submissions) is the brightest cyan;
                   the specific lower buckets below override it. */
                rect[class^="ext-heatmap-"] { fill: #67e8f9 !important; opacity: 1 !important; }

                /* No activity */
                rect.ext-heatmap-0 { fill: #2d3748 !important; }
                /* 1-2 submissions */
                rect.ext-heatmap-1, rect.ext-heatmap-2 { fill: #164e63 !important; }
                /* 3-5 submissions */
                rect.ext-heatmap-3, rect.ext-heatmap-4, rect.ext-heatmap-5 { fill: #0e7490 !important; }
                /* 6-10 submissions */
                rect.ext-heatmap-6, rect.ext-heatmap-7, rect.ext-heatmap-8,
                rect.ext-heatmap-9, rect.ext-heatmap-10 { fill: #06b6d4 !important; }
                /* 11-20 submissions */
                rect.ext-heatmap-11, rect.ext-heatmap-12, rect.ext-heatmap-13,
                rect.ext-heatmap-14, rect.ext-heatmap-15, rect.ext-heatmap-16,
                rect.ext-heatmap-17, rect.ext-heatmap-18, rect.ext-heatmap-19,
                rect.ext-heatmap-20 { fill: #22d3ee !important; }

                #username-text, #username { font-size: 16px !important; }
                #ranking { font-size: 12px !important; }
                #total-solved-text { font-size: 20px !important; }
                #easy-solved-type, #medium-solved-type, #hard-solved-type { font-size: 11px !important; }
                #easy-solved-count, #medium-solved-count, #hard-solved-count { font-size: 12px !important; }
                #ext-heatmap-from, #ext-heatmap-to { font-size: 8px !important; }
            </style>
            """
            if "</svg>" in svg_data:
                final_svg = svg_data.replace("</svg>", custom_styles + "</svg>")
            else:
                final_svg = svg_data

            # Cache for 10 minutes to keep it extremely fresh while avoiding spam
            cache.set(cache_key, final_svg, 600)

            response = HttpResponse(final_svg, content_type="image/svg+xml")
            response["Cache-Control"] = "public, max-age=600"
            return response

    except Exception:
        logger.warning("LeetCode proxy failed for %s", username, exc_info=True)
        return HttpResponse(
            '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="320"><rect width="100%" height="100%" fill="#0f172a"/><text x="50%" y="50%" fill="#9ca3af" text-anchor="middle" font-family="sans-serif">Failed to load LeetCode stats</text></svg>',
            content_type="image/svg+xml",
        )


def _parse_google_form_url(url):
    """Return safe URL parts for a supported Google Form URL, otherwise None."""
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port  # Accessing it validates malformed ports too.
    except ValueError:
        return None

    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme.lower() != "https"
        or parsed.username
        or parsed.password
        or port not in (None, 443)
        or host not in _GOOGLE_FORM_HOSTS
    ):
        return None

    if host == "docs.google.com":
        if not (
            _GOOGLE_PUBLISHED_FORM_PATH_RE.fullmatch(parsed.path)
            or _GOOGLE_EDIT_FORM_PATH_RE.fullmatch(parsed.path)
        ):
            return None
    elif not _GOOGLE_SHORT_LINK_PATH_RE.fullmatch(parsed.path):
        return None

    return parsed


def _normalise_google_form_url(raw_url):
    """Validate an editor-supplied URL and return one safe fetch target."""
    raw_url = (raw_url or "").strip()
    if not raw_url or len(raw_url) > 2048:
        return None

    if "://" not in raw_url:
        raw_url = f"https://{raw_url}"

    parsed = _parse_google_form_url(raw_url)
    if not parsed:
        return None

    host = (parsed.hostname or "").lower()
    published_match = _GOOGLE_PUBLISHED_FORM_PATH_RE.fullmatch(parsed.path)
    if host == "docs.google.com" and published_match:
        return (
            "https://docs.google.com/forms/d/e/"
            f"{published_match.group('form_id')}/viewform"
        )

    edit_match = _GOOGLE_EDIT_FORM_PATH_RE.fullmatch(parsed.path)
    if host == "docs.google.com" and edit_match:
        return f"https://docs.google.com/forms/d/{edit_match.group('form_id')}/viewform"

    # A forms.gle link needs its Google-owned redirect to resolve the form ID.
    return urllib.parse.urlunsplit(
        ("https", "forms.gle", parsed.path, parsed.query, "")
    )


class _GoogleFormsRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow redirects only while they remain inside the Forms allowlist."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirect_url = urllib.parse.urljoin(req.full_url, newurl)
        if not _parse_google_form_url(redirect_url):
            raise _UnsafeGoogleFormURL("Redirect target is outside Google Forms")
        return super().redirect_request(req, fp, code, msg, headers, redirect_url)


def _fetch_google_form_html(url):
    """Fetch one validated Google Form while bounding latency and response size."""
    headers = {
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
        "User-Agent": "Mozilla/5.0 (compatible; form-field-detector/1.0)",
    }
    request = urllib.request.Request(url, headers=headers)
    opener = urllib.request.build_opener(_GoogleFormsRedirectHandler())

    try:
        with opener.open(request, timeout=_FORM_DETECT_TIMEOUT_SECONDS) as response:
            final_url = response.geturl()
            if not _parse_google_form_url(final_url):
                raise _UnsafeGoogleFormURL("Final URL is outside Google Forms")

            content_length = response.headers.get("Content-Length")
            if content_length:
                try:
                    declared_length = int(content_length)
                except ValueError:
                    # Ignore malformed upstream metadata; the bounded read below
                    # remains authoritative.
                    pass
                else:
                    if declared_length > _FORM_DETECT_MAX_RESPONSE_BYTES:
                        raise _GoogleFormResponseTooLarge

            content = response.read(_FORM_DETECT_MAX_RESPONSE_BYTES + 1)
    except (_UnsafeGoogleFormURL, _GoogleFormResponseTooLarge):
        raise
    except (OSError, TimeoutError, urllib.error.URLError) as exc:
        raise _GoogleFormFetchError from exc

    if len(content) > _FORM_DETECT_MAX_RESPONSE_BYTES:
        raise _GoogleFormResponseTooLarge

    return content.decode("utf-8", errors="replace"), final_url


def _google_form_response_url(url):
    """Build the Google formResponse URL only from a validated final URL."""
    parsed = _parse_google_form_url(url)
    if not parsed or (parsed.hostname or "").lower() != "docs.google.com":
        return ""

    published_match = _GOOGLE_PUBLISHED_FORM_PATH_RE.fullmatch(parsed.path)
    if published_match:
        return (
            "https://docs.google.com/forms/d/e/"
            f"{published_match.group('form_id')}/formResponse"
        )

    edit_match = _GOOGLE_EDIT_FORM_PATH_RE.fullmatch(parsed.path)
    if edit_match:
        return (
            "https://docs.google.com/forms/d/"
            f"{edit_match.group('form_id')}/formResponse"
        )
    return ""


def _extract_google_form_fields(html):
    """Extract the small field subset required by the admin picker."""
    match = re.search(
        r"var\s+FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);\s*</script>",
        html,
        re.DOTALL,
    )
    if not match:
        return None

    try:
        data = json.loads(match.group(1))
        questions = data[1][1]
    except (IndexError, TypeError, json.JSONDecodeError):
        return None

    if not isinstance(questions, list):
        return None

    fields = []
    for question in questions:
        try:
            title = question[1] or ""
            entry = question[4][0]
            entry_id = entry[0]
            if not isinstance(title, str) or not isinstance(entry_id, (str, int)):
                continue
            is_required = len(entry) > 2 and entry[2] == 1
            raw_type = question[3] if len(question) > 3 else 0
        except (IndexError, TypeError):
            continue

        fields.append(
            {
                "title": title,
                "entry": f"entry.{entry_id}",
                "type": "textarea" if raw_type == 1 else "text",
                "required": is_required,
            }
        )
    return fields


def _form_detection_rate_limited(request):
    """Rate-limit the expensive outbound request per authenticated staff user."""
    cache_key = f"form_detect_rate_limit_user_{request.user.pk}"
    if cache.add(cache_key, 1, _FORM_DETECT_RATE_LIMIT_WINDOW_SECONDS):
        return False

    try:
        request_count = cache.incr(cache_key)
    except ValueError:
        # The key can expire after add() fails but before incr().  Treat this as
        # the start of a fresh window rather than returning an internal error.
        cache.set(cache_key, 1, _FORM_DETECT_RATE_LIMIT_WINDOW_SECONDS)
        request_count = 1
    return request_count > _FORM_DETECT_RATE_LIMIT_REQUESTS


def _form_detection_cache_key(url):
    """Keep cache keys short and independent of editor-supplied text."""
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
    return f"form_detect_result_{digest}"


@staff_member_required
@require_POST
def detect_form_fields(request):
    """Safely inspect a published Google Form for the admin content picker."""
    fetch_url = _normalise_google_form_url(request.POST.get("url"))
    if not fetch_url:
        return JsonResponse(
            {"error": "Enter a valid HTTPS Google Forms URL."}, status=400
        )

    result_cache_key = _form_detection_cache_key(fetch_url)
    cached_result = cache.get(result_cache_key)
    if cached_result is not None:
        return JsonResponse(cached_result)

    # Only a cache miss can lead to an outbound request, so the rate limit is
    # deliberately placed here rather than penalising a quick cached lookup.
    if _form_detection_rate_limited(request):
        return JsonResponse(
            {
                "error": "Too many detection requests. Please wait a minute and try again."
            },
            status=429,
        )

    try:
        html, final_url = _fetch_google_form_html(fetch_url)
    except _UnsafeGoogleFormURL:
        return JsonResponse(
            {
                "error": (
                    "The form link redirected outside Google Forms. "
                    "Please use a published Google Form URL."
                )
            },
            status=400,
        )
    except _GoogleFormResponseTooLarge:
        return JsonResponse(
            {"error": "The form response is too large to inspect."}, status=400
        )
    except _GoogleFormFetchError:
        return JsonResponse(
            {
                "error": (
                    "Unable to fetch this Google Form. Make sure it is published "
                    "and accepting responses."
                )
            },
            status=502,
        )
    except Exception:
        logger.warning("Google Form field detection failed", exc_info=True)
        return JsonResponse(
            {"error": "Unable to inspect this Google Form right now."}, status=502
        )

    fields = _extract_google_form_fields(html)
    if fields is None:
        return JsonResponse(
            {
                "error": (
                    "Could not read form fields. Make sure the form is published "
                    "and accepting responses."
                )
            },
            status=400,
        )

    result = {"fields": fields, "action": _google_form_response_url(final_url)}
    cache.set(result_cache_key, result, _FORM_DETECT_CACHE_SECONDS)
    return JsonResponse(result)


def resume_view(request, filename=None):
    """Serves the resume PDF under /resume/ or /resume/<filename>.

    Redirects invalid/outdated filenames to canonical /resume/ instead of showing a 404.
    """
    about_me = AboutMe.objects.first()
    if not about_me:
        raise Http404("Resume not found.")

    if about_me.resume_file:
        actual_filename = os.path.basename(about_me.resume_file.name)
        if filename is not None and filename != actual_filename:
            return HttpResponseRedirect(reverse("resume"))

        try:
            file_obj = about_me.resume_file.open("rb")
            response = FileResponse(file_obj, content_type="application/pdf")
            response["Content-Disposition"] = f'inline; filename="{actual_filename}"'
            return response
        except (ValueError, FileNotFoundError, OSError):
            pass

    if about_me.resume_url:
        if filename is not None:
            return HttpResponseRedirect(reverse("resume"))
        return HttpResponseRedirect(about_me.resume_url)

    raise Http404("Resume file not found.")
