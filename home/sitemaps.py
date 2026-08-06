from typing import Any

from django.contrib.sitemaps import Sitemap
from django.db.models import Max
from django.urls import reverse

from home.models import Blog


class StaticViewSitemap(Sitemap):
    """Top-level static pages.

    Priority and changefreq are tuned per page: the home and blog index are
    the most important entry points, the about/projects pages change rarely,
    and the topics index updates whenever a new post adds a topic.
    """

    # Per-page hints. Google treats these as advisory, but accurate values
    # never hurt and help distinguish primary pages from secondary ones.
    _PAGES = {
        "home": (1.0, "weekly"),
        "blog": (0.9, "daily"),
        "projects": (0.7, "monthly"),
        "about": (1.0, "monthly"),
        "topics": (0.5, "weekly"),
        "resume": (0.8, "monthly"),
    }

    def items(self):
        return list(self._PAGES.keys())

    def location(self, obj: Any) -> str:
        return reverse(obj)

    def priority(self, obj: Any):
        return self._PAGES[obj][0]

    def changefreq(self, obj: Any):
        return self._PAGES[obj][1]


class BlogPostSitemap(Sitemap):
    priority = 0.8
    # Posts rarely change after publishing, so "monthly" is a more honest
    # signal than "weekly". lastmod (below) is what actually tells Google
    # when a post was genuinely updated.
    changefreq = "monthly"

    def items(self):
        return Blog.objects.all().order_by("-updated_at")

    def lastmod(self, obj: Any):
        # Reflect real edits: updated_at auto-updates on every save, so an
        # edited post gets re-crawled instead of looking stale.
        return obj.updated_at

    def location(self, obj: Any) -> str:
        return reverse("blogpost", args=[obj.slug])


class TopicSitemap(Sitemap):
    priority = 0.5
    changefreq = "weekly"

    def __init__(self):
        # Build a {topic: latest_post_update} map in a single query so
        # lastmod() doesn't run one query per topic.
        self._lastmod_map = {}

    def items(self):
        rows = (
            Blog.objects.exclude(topic__isnull=True)
            .exclude(topic__exact="")
            .values("topic")
            .annotate(latest=Max("updated_at"))
            .order_by("topic")
        )
        self._lastmod_map = {row["topic"]: row["latest"] for row in rows}
        return list(self._lastmod_map.keys())

    def lastmod(self, obj: Any):
        return self._lastmod_map.get(obj)

    def location(self, obj: Any) -> str:
        return reverse("topic", args=[obj])
