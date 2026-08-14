from __future__ import annotations

import tempfile
import urllib.request
from io import BytesIO, StringIO
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import Client, RequestFactory, TestCase, override_settings
from django.urls import reverse
from PIL import Image

from home import views
from home.content_tools import (
    Snippet,
    check_all,
    check_css_coverage,
    check_preview_coverage,
    check_snippet,
    load_all,
    parse_meta,
)
from home.context_processors import USED_TAGS_CACHE_KEY, used_tags
from home.imaging import compress_to_webp
from home.models import AboutMe, Blog
from home.templatetags.blog_extras import highlight, lazy_iframes, reading_time


@override_settings(
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "tests",
        }
    }
)
class BlogModelTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_blog_effective_thumbnail_prefers_upload(self):
        blog = Blog.objects.create(
            title="t",
            meta="m",
            content="c",
            thumbnail_url="https://example.com/x.jpg",
            topic="Test",
            slug="s1",
        )

        self.assertEqual(blog.effective_thumbnail, "https://example.com/x.jpg")

        class _FakeFieldFile:
            url = "/media/images/upload.jpg"

        blog.thumbnail_img = _FakeFieldFile()
        self.assertEqual(blog.effective_thumbnail, "/media/images/upload.jpg")

    def test_blog_save_normalizes_topic_and_clears_cache(self):
        cache.set(USED_TAGS_CACHE_KEY, ["cached"])
        blog = Blog.objects.create(
            title="t",
            meta="m",
            content="c",
            topic="  PyThOn  ",
            slug="s2",
        )
        blog.refresh_from_db()
        self.assertEqual(blog.topic, "python")
        self.assertIsNone(cache.get(USED_TAGS_CACHE_KEY))


class AboutMeSingletonTests(TestCase):
    def test_aboutme_second_save_updates_existing_instead_of_creating(self):
        first = AboutMe.objects.create(
            name="A",
            profession="P",
            bio="B",
            email="a@example.com",
        )
        self.assertEqual(AboutMe.objects.count(), 1)

        second = AboutMe(
            name="A2",
            profession="P2",
            bio="B2",
            email="a2@example.com",
        )
        second.save()

        self.assertEqual(AboutMe.objects.count(), 1)
        only = AboutMe.objects.get()
        self.assertEqual(only.pk, first.pk)
        self.assertEqual(only.name, "A2")

    def test_aboutme_social_links_in_base_defaults_and_rendering(self):
        about = AboutMe.objects.create(
            name="Ozodbek",
            profession="Engineer",
            bio="Bio text",
            email="test@example.com",
            github_url="https://github.com/test",
            telegram_url="https://t.me/test",
            show_github_in_base=True,
            show_telegram_in_base=False,
        )
        self.assertTrue(about.show_github_in_base)
        self.assertFalse(about.show_telegram_in_base)

        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "https://github.com/test")
        self.assertNotContains(response, "https://t.me/test")

        # Now enable telegram link in base
        about.show_telegram_in_base = True
        about.save()

        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "https://t.me/test")


class TemplateTagTests(TestCase):
    def test_reading_time_min_1(self):
        self.assertEqual(reading_time(""), 1)
        self.assertEqual(reading_time(None), 1)
        self.assertEqual(reading_time("<p>Hello</p>"), 1)

    def test_reading_time_ceil_160_wpm(self):
        # 161 words => ceil(161/160) = 2 minutes
        content = " ".join(["word"] * 161)
        self.assertEqual(reading_time(content), 2)

    def test_reading_time_strips_html(self):
        # Should count words, not tags/attrs
        content = '<p>Hello <a href="x">world</a></p>'
        self.assertEqual(reading_time(content), 1)

    def test_lazy_iframes_tags_spotify_embed_type(self):
        # A single track must get a type-specific placeholder class so the
        # shimmer matches the real (152px) widget height instead of the
        # 16:9 box CKEditor reserves around it.
        html = (
            '<figure class="media"><div data-oembed-url="https://open.spotify.com/track/1">'
            '<div style="padding-bottom:56.25%"><iframe src="https://open.spotify.com/embed/track/1">'
            "</iframe></div></div></figure>"
        )
        out = lazy_iframes(html)
        self.assertIn("lazy-iframe-ph--spotify", out)
        self.assertIn("lazy-iframe-ph--spotify-track", out)

    def test_lazy_iframes_spotify_artist_playlist_show(self):
        artist = lazy_iframes(
            '<iframe src="https://open.spotify.com/embed/artist/2?utm_source=generator"></iframe>'
        )
        self.assertIn("lazy-iframe-ph--spotify-artist", artist)

        playlist = lazy_iframes(
            '<iframe src="https://open.spotify.com/embed/playlist/4"></iframe>'
        )
        self.assertIn("lazy-iframe-ph--spotify-playlist", playlist)

        show = lazy_iframes(
            '<iframe src="https://open.spotify.com/embed/show/3"></iframe>'
        )
        self.assertIn("lazy-iframe-ph--spotify-show", show)

    def test_lazy_iframes_keeps_original_iframe_in_template(self):
        html = '<iframe src="https://open.spotify.com/embed/track/1"></iframe>'
        out = lazy_iframes(html)
        self.assertIn('<template class="lazy-tpl">', out)
        self.assertIn(
            '<iframe src="https://open.spotify.com/embed/track/1"></iframe>', out
        )

    def test_highlight_wraps_every_term_occurrence(self):
        out = highlight("Learning Django with the Django ORM", "django")
        self.assertEqual(
            out,
            "Learning <mark>Django</mark> with the <mark>Django</mark> ORM",
        )

    def test_highlight_matches_multiple_words_case_insensitively(self):
        out = highlight("Django REST framework guide", "django rest")
        self.assertEqual(out, "<mark>Django</mark> <mark>REST</mark> framework guide")

    def test_highlight_escapes_html_before_matching(self):
        out = highlight("Attack <script> & more", "attack")
        self.assertEqual(out, "<mark>Attack</mark> &lt;script&gt; &amp; more")

    def test_highlight_noop_without_query_or_value(self):
        self.assertEqual(highlight("Hello world", ""), "Hello world")
        self.assertEqual(highlight("Hello world", None), "Hello world")
        self.assertEqual(highlight("Hello world", "   "), "Hello world")
        self.assertEqual(highlight("", "django"), "")
        self.assertIsNone(highlight(None, "django"))


class ImageOptimizationTests(TestCase):
    def test_large_image_is_resized_and_encoded_as_webp(self):
        source = BytesIO()
        Image.new("RGB", (2400, 1200), (20, 40, 60)).save(source, format="JPEG")
        source.seek(0)

        result = compress_to_webp(source, max_size=(1200, 800), quality=80)

        self.assertIsNotNone(result)
        output, _size = result
        with Image.open(output) as optimized:
            self.assertEqual(optimized.format, "WEBP")
            self.assertEqual(optimized.size, (1200, 600))


@override_settings(
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "tests",
        }
    }
)
class ContextProcessorTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()

    def test_used_tags_returns_distinct_sorted(self):
        Blog.objects.create(
            title="t1",
            meta="m",
            content="c",
            topic="python",
            slug="c1",
        )
        Blog.objects.create(
            title="t2",
            meta="m",
            content="c",
            topic="django",
            slug="c2",
        )
        Blog.objects.create(
            title="t3",
            meta="m",
            content="c",
            topic="django",
            slug="c3",
        )
        data = used_tags(self.rf.get("/"))
        self.assertEqual(data["used_tags"], ["django", "python"])

    def test_used_tags_is_cached(self):
        Blog.objects.create(
            title="t1",
            meta="m",
            content="c",
            topic="python",
            slug="c1",
        )
        _ = used_tags(self.rf.get("/"))
        self.assertEqual(cache.get(USED_TAGS_CACHE_KEY), ["python"])

        # Blog.save() clears the cache, so after creating a new blog
        # the cache should be invalidated and the next call returns fresh data.
        Blog.objects.create(
            title="t2",
            meta="m",
            content="c",
            topic="django",
            slug="c2",
        )
        # Cache was cleared by Blog.save()
        self.assertIsNone(cache.get(USED_TAGS_CACHE_KEY))
        # Next call rebuilds cache with both tags
        data = used_tags(self.rf.get("/"))
        self.assertEqual(data["used_tags"], ["django", "python"])


class ManagementCommandTests(TestCase):
    def test_media_migration_does_not_rewrite_nested_media_paths_without_files(self):
        content = '<img src="/media/math/render/svg/abc123" alt="formula">'
        blog = Blog.objects.create(
            title="Formula",
            meta="meta",
            content=content,
            topic="math",
            slug="formula-post",
        )

        with (
            tempfile.TemporaryDirectory() as tmpdir,
            override_settings(MEDIA_ROOT=tmpdir),
        ):
            out = StringIO()
            call_command("migrate_media_to_postimages", stdout=out)

        blog.refresh_from_db()
        self.assertEqual(blog.content, content)
        self.assertIn("No DB references to update", out.getvalue())


@override_settings(
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "tests",
        }
    }
)
class ViewsSmokeTests(TestCase):
    def setUp(self):
        cache.clear()

        self.blog = Blog.objects.create(
            title="Hello Django",
            meta="meta",
            content="<p>Some content</p>",
            topic="django",
            slug="hello-django",
        )

    def test_home_page_ok(self):
        resp = self.client.get(reverse("home"))
        self.assertEqual(resp.status_code, 200)
        self.assertTemplateUsed(resp, "index.html")

    def test_blog_list_ok(self):
        resp = self.client.get(reverse("blog"))
        self.assertEqual(resp.status_code, 200)
        self.assertTemplateUsed(resp, "blog.html")

    def test_blogpost_ok_and_context(self):
        resp = self.client.get(reverse("blogpost", kwargs={"slug": self.blog.slug}))
        self.assertEqual(resp.status_code, 200)
        self.assertTemplateUsed(resp, "blogpost.html")
        self.assertIn("blog_url", resp.context)

    def test_blogpost_missing_returns_404_template(self):
        resp = self.client.get(reverse("blogpost", kwargs={"slug": "missing"}))
        self.assertEqual(resp.status_code, 404)
        self.assertTemplateUsed(resp, "404.html")

    def test_topic_missing_returns_404_with_message(self):
        resp = self.client.get(reverse("topic", kwargs={"topic": "nope"}))
        # An empty/non-existent topic returns a real 404 (avoids Google Soft 404)
        # while still rendering the friendly topic template with a message.
        self.assertEqual(resp.status_code, 404)
        self.assertTemplateUsed(resp, "topic.html")
        self.assertContains(resp, "No posts found in topic", status_code=404)

    def test_topic_with_posts_returns_200(self):
        resp = self.client.get(reverse("topic", kwargs={"topic": "django"}))
        self.assertEqual(resp.status_code, 200)
        self.assertTemplateUsed(resp, "topic.html")
        self.assertContains(resp, "Hello Django")

    def test_search_empty_query_shows_message(self):
        resp = self.client.get(reverse("search"))
        self.assertEqual(resp.status_code, 200)
        self.assertTemplateUsed(resp, "search.html")
        self.assertContains(resp, "Please enter a search query.")

    def test_search_finds_results(self):
        resp = self.client.get(reverse("search"), {"q": "Django"})
        self.assertEqual(resp.status_code, 200)
        self.assertTemplateUsed(resp, "search.html")
        self.assertIn("results", resp.context)
        self.assertTrue(resp.context["results"].paginator.count >= 1)

    def test_search_highlights_matching_terms_in_results(self):
        resp = self.client.get(reverse("search"), {"q": "Django"})
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "<mark>Django</mark>")

    def test_blog_list_has_no_highlight_without_query(self):
        resp = self.client.get(reverse("blog"))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Hello Django")
        self.assertNotContains(resp, "<mark>")

    def test_search_rate_limit_returns_429_and_flag(self):
        url = reverse("search")
        for _ in range(20):
            resp = self.client.get(url, {"q": "django"}, REMOTE_ADDR="1.2.3.4")
            self.assertEqual(resp.status_code, 200)

        resp = self.client.get(url, {"q": "django"}, REMOTE_ADDR="1.2.3.4")
        self.assertEqual(resp.status_code, 429)
        self.assertTrue(resp.context["rate_limited"])

    def test_blogpost_no_code_blocks_does_not_load_prism(self):
        blog = Blog.objects.create(
            title="Simple Post",
            meta="meta",
            content="<p>No code here.</p>",
            topic="python",
            slug="simple-post",
        )
        resp = self.client.get(reverse("blogpost", kwargs={"slug": blog.slug}))
        self.assertEqual(resp.status_code, 200)
        self.assertNotContains(resp, "prism.min.js")
        self.assertNotContains(resp, "prism-tomorrow.min.css")
        self.assertNotContains(resp, "widgets.js")
        self.assertNotContains(resp, "embed.js")

    def test_blogpost_with_code_blocks_loads_prism(self):
        blog = Blog.objects.create(
            title="Tech Post",
            meta="meta",
            content="<pre><code class='language-python'>print('hello')</code></pre>",
            topic="python",
            slug="tech-post",
        )
        resp = self.client.get(reverse("blogpost", kwargs={"slug": blog.slug}))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "prism.min.js")
        self.assertContains(resp, "prism-tomorrow.min.css")

    def test_blogpost_with_twitter_link_uses_local_embed_processor(self):
        blog = Blog.objects.create(
            title="Social Post",
            meta="meta",
            content='<p><a href="https://twitter.com/test/status/1234567890">https://twitter.com/test/status/1234567890</a></p>',
            topic="python",
            slug="social-post",
        )
        resp = self.client.get(reverse("blogpost", kwargs={"slug": blog.slug}))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "blogpost.js")
        self.assertContains(resp, "twitter.com/test/status/1234567890")
        self.assertNotContains(resp, "widgets.js")


@override_settings(
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "detect-form-fields-tests",
        }
    }
)
class DetectFormFieldsTests(TestCase):
    """Security and behavior tests for the admin-only Google Form helper."""

    endpoint = reverse("detect_form_fields")
    form_url = "https://docs.google.com/forms/d/e/test-form_123/viewform"
    form_html = """
        <script>
        var FB_PUBLIC_LOAD_DATA_ = [null,[null,[[null,"Name",null,0,[[123,null,1]]],[null,"Message",null,1,[[456,null,0]]]]]];
        </script>
    """

    def setUp(self):
        cache.clear()
        user_model = get_user_model()
        self.staff_user = user_model.objects.create_user(
            username="form-admin",
            password="safe-password",
            is_staff=True,
        )
        self.regular_user = user_model.objects.create_user(
            username="form-reader",
            password="safe-password",
        )

    def _staff_post(self, url=None, **extra):
        self.client.force_login(self.staff_user)
        return self.client.post(self.endpoint, {"url": url or self.form_url}, **extra)

    def test_endpoint_is_staff_only(self):
        response = self.client.post(self.endpoint, {"url": self.form_url})
        self.assertEqual(response.status_code, 302)

        self.client.force_login(self.regular_user)
        response = self.client.post(self.endpoint, {"url": self.form_url})
        self.assertEqual(response.status_code, 302)

    def test_endpoint_requires_post_for_staff(self):
        self.client.force_login(self.staff_user)
        response = self.client.get(self.endpoint)
        self.assertEqual(response.status_code, 405)

    def test_endpoint_enforces_csrf_for_staff_posts(self):
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.force_login(self.staff_user)

        response = csrf_client.post(self.endpoint, {"url": self.form_url})
        self.assertEqual(response.status_code, 403)

    @patch("home.views._fetch_google_form_html")
    def test_staff_can_detect_fields_with_csrf(self, fetch_form):
        fetch_form.return_value = (self.form_html, self.form_url)
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.force_login(self.staff_user)
        csrf_token = "a" * 32
        csrf_client.cookies["csrftoken"] = csrf_token

        response = csrf_client.post(
            self.endpoint,
            {"url": self.form_url},
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            fetch_form.call_args.args[0],
            "https://docs.google.com/forms/d/e/test-form_123/viewform",
        )
        self.assertEqual(
            response.json()["action"],
            "https://docs.google.com/forms/d/e/test-form_123/formResponse",
        )
        self.assertEqual(
            response.json()["fields"],
            [
                {
                    "title": "Name",
                    "entry": "entry.123",
                    "type": "text",
                    "required": True,
                },
                {
                    "title": "Message",
                    "entry": "entry.456",
                    "type": "textarea",
                    "required": False,
                },
            ],
        )

    @patch("home.views._fetch_google_form_html")
    def test_rejects_non_google_or_non_https_urls_before_fetching(self, fetch_form):
        for url in (
            "https://docs.google.com.evil.example/forms/d/e/test-form_123/viewform",
            "https://evil.example/forms/d/e/test-form_123/viewform",
            "http://docs.google.com/forms/d/e/test-form_123/viewform",
        ):
            response = self._staff_post(url)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(
                response.json()["error"], "Enter a valid HTTPS Google Forms URL."
            )
        fetch_form.assert_not_called()

    def test_redirect_handler_rejects_non_google_redirect_targets(self):
        handler = views._GoogleFormsRedirectHandler()
        request = urllib.request.Request("https://forms.gle/short-link")

        with self.assertRaises(views._UnsafeGoogleFormURL):
            handler.redirect_request(
                request,
                None,
                302,
                "Found",
                {},
                "http://127.0.0.1/internal-only",
            )

    def test_response_size_is_bounded_before_reading(self):
        test_case = self

        class OversizedResponse:
            headers = {"Content-Length": str(views._FORM_DETECT_MAX_RESPONSE_BYTES + 1)}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def geturl(self):
                return DetectFormFieldsTests.form_url

            def read(self, _size):
                test_case.fail(
                    "The body must not be read when Content-Length is too large"
                )

        class FakeOpener:
            def open(self, _request, timeout):
                test_case.assertEqual(timeout, views._FORM_DETECT_TIMEOUT_SECONDS)
                return OversizedResponse()

        with patch("home.views.urllib.request.build_opener", return_value=FakeOpener()):
            with self.assertRaises(views._GoogleFormResponseTooLarge):
                views._fetch_google_form_html(self.form_url)

    @patch("home.views._fetch_google_form_html")
    def test_rate_limits_repeated_staff_requests(self, fetch_form):
        fetch_form.return_value = (self.form_html, self.form_url)
        for index in range(views._FORM_DETECT_RATE_LIMIT_REQUESTS):
            response = self._staff_post(
                f"https://docs.google.com/forms/d/e/test-{index}/viewform"
            )
            self.assertEqual(response.status_code, 200)

        response = self._staff_post(
            "https://docs.google.com/forms/d/e/test-over-limit/viewform"
        )
        self.assertEqual(response.status_code, 429)
        self.assertIn("Too many detection requests", response.json()["error"])

    @patch("home.views._fetch_google_form_html")
    def test_upstream_errors_do_not_expose_transport_details(self, fetch_form):
        fetch_form.side_effect = views._GoogleFormFetchError(
            "dial tcp 127.0.0.1:9999: connection refused"
        )

        response = self._staff_post()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("127.0.0.1", response.json()["error"])


# ── Content toolkit ─────────────────────────────────────────────────────────


class ContentToolsParseMetaTest(TestCase):
    """Tests for the tk:meta header parser."""

    def test_basic_parse(self):
        source = """<!-- tk:meta
name: Test block
tool: test
group: Testing
description: A test snippet.
-->
<div data-tk="test" class="tk-block tk-test"><p>Hello</p></div>"""
        meta, html = parse_meta(source)
        self.assertEqual(meta["name"], "Test block")
        self.assertEqual(meta["tool"], "test")
        self.assertEqual(meta["group"], "Testing")
        self.assertEqual(meta["description"], "A test snippet.")
        self.assertIn("data-tk", html)

    def test_params_parsed(self):
        source = """<!-- tk:meta
name: X
tool: x
group: G
description: D
param: data-variant :: a | b :: a :: Chooses style.
param: data-size :: small | large :: small :: Controls size.
-->
<div data-tk="x" class="tk-block tk-x"><p>ok</p></div>"""
        meta, _ = parse_meta(source)
        self.assertEqual(len(meta["params"]), 2)
        self.assertEqual(meta["params"][0].name, "data-variant")
        self.assertEqual(meta["params"][1].description, "Controls size.")

    def test_no_header(self):
        meta, html = parse_meta("<div><p>no header</p></div>")
        self.assertEqual(meta, {})
        self.assertEqual(html, "<div><p>no header</p></div>")


class ContentToolsValidationTest(TestCase):
    """Tests for snippet validation rules."""

    def _snippet(self, html, **kwargs):
        defaults = {
            "path": Path("test.html"),
            "tool": "test",
            "name": "Test",
            "group": "Testing",
            "description": "A test.",
            "html": html,
        }
        defaults.update(kwargs)
        return Snippet(**defaults)

    def test_valid_snippet(self):
        html = '<div data-tk="test" class="tk-block tk-test"><p>Hello</p></div>'
        problems = check_snippet(self._snippet(html))
        self.assertEqual(problems, [])

    def test_forbidden_tag_detected(self):
        html = '<div data-tk="test" class="tk-block tk-test"><script>alert(1)</script></div>'
        problems = check_snippet(self._snippet(html))
        self.assertTrue(any("script" in p for p in problems))

    def test_on_handler_detected(self):
        html = (
            '<div data-tk="test" class="tk-block tk-test"><p onclick="x()">Hi</p></div>'
        )
        problems = check_snippet(self._snippet(html))
        self.assertTrue(any("onclick" in p for p in problems))

    def test_empty_element_detected(self):
        html = '<div data-tk="test" class="tk-block tk-test"><span class="tk-x"></span></div>'
        problems = check_snippet(self._snippet(html))
        self.assertTrue(any("empty" in p.lower() for p in problems))

    def test_missing_marker_detected(self):
        html = '<div class="tk-block tk-test"><p>No marker</p></div>'
        problems = check_snippet(self._snippet(html))
        self.assertTrue(any("data-tk" in p for p in problems))

    def test_style_attribute_rejected(self):
        html = '<div data-tk="test" class="tk-block tk-test"><p style="color:red">Styled</p></div>'
        problems = check_snippet(self._snippet(html))
        self.assertTrue(any("style" in p for p in problems))

    def test_non_tk_class_rejected(self):
        html = '<div data-tk="test" class="tk-block tk-test"><p class="text-red-500">Tailwind</p></div>'
        problems = check_snippet(self._snippet(html))
        self.assertTrue(any("text-red-500" in p for p in problems))

    def test_missing_metadata_detected(self):
        html = '<div data-tk="test" class="tk-block tk-test"><p>Hi</p></div>'
        s = self._snippet(html, name="", description="")
        problems = check_snippet(s)
        self.assertTrue(any("name" in p for p in problems))

    def test_tool_filename_mismatch(self):
        html = '<div data-tk="test" class="tk-block tk-test"><p>Hi</p></div>'
        s = self._snippet(html, path=Path("wrong.html"))
        problems = check_snippet(s)
        self.assertTrue(any("filename" in p for p in problems))


class ContentToolsSnippetFilesTest(TestCase):
    """Tests that run against the real snippet files on disk."""

    def test_all_snippets_pass_validation(self):
        """Every snippet in tools/snippets/ must pass check_snippet()."""
        failures = check_all()
        if failures:
            details = "\n".join(
                f"  {name}: {', '.join(problems)}"
                for name, problems in failures.items()
            )
            self.fail(f"Snippet validation failed:\n{details}")

    def test_all_snippets_have_css(self):
        """Every tk- class used in a snippet must have a CSS rule."""
        problems = check_css_coverage()
        if problems:
            self.fail("CSS coverage gaps:\n  " + "\n  ".join(problems))

    def test_all_snippets_in_preview(self):
        """Every tool must appear in the preview gallery."""
        problems = check_preview_coverage()
        if problems:
            self.fail("Preview coverage gaps:\n  " + "\n  ".join(problems))

    def test_load_all_returns_snippets(self):
        """Sanity check that snippets are found and loaded."""
        snippets = load_all()
        # Per-snippet validation, CSS coverage and preview coverage above are
        # the actual catalog contract.  Do not duplicate a hand-maintained
        # count here: it becomes stale whenever a block is intentionally
        # added or retired.
        self.assertTrue(snippets)
        tools = {s.tool for s in snippets}
        self.assertIn("callout", tools)
        self.assertIn("quiz", tools)
        self.assertIn("gform", tools)


class ContentToolsBuildCatalogTest(TestCase):
    """Tests for the build_tools_catalog management command."""

    def test_build_catalog_command(self):
        """manage.py build_tools_catalog should succeed and write the file."""
        out = StringIO()
        call_command("build_tools_catalog", stdout=out)
        output = out.getvalue()
        self.assertIn("snippet", output.lower())

        catalog_path = (
            Path(__file__).resolve().parent.parent
            / "static/js/generated/tools-catalog.js"
        )
        self.assertTrue(catalog_path.is_file())
        content = catalog_path.read_text(encoding="utf-8")
        self.assertIn("__TK_CATALOG__", content)
        self.assertIn('"callout"', content)

    def test_check_mode_passes(self):
        """manage.py build_tools_catalog --check should succeed."""
        out = StringIO()
        call_command("build_tools_catalog", check=True, stdout=out)
        self.assertIn("passed", out.getvalue().lower())


class _FakeResumeFile:
    name = "resume/Ozodbek_Bosimov.pdf"

    def open(self, mode="rb"):
        from io import BytesIO

        return BytesIO(b"%PDF-1.4 dummy resume content")


class ResumeViewTests(TestCase):
    def setUp(self):
        cache.clear()
        AboutMe.objects.all().delete()

    def test_effective_resume_returns_resume_url(self):
        about = AboutMe.objects.create(
            name="Ozodbek", resume_url="https://example.com/resume.pdf"
        )
        self.assertEqual(about.effective_resume, "https://example.com/resume.pdf")

    def test_effective_resume_returns_custom_resume_path(self):
        about = AboutMe.objects.create(name="Ozodbek")
        about.resume_file = _FakeResumeFile()
        self.assertEqual(about.effective_resume, "/resume/")

    def test_resume_view_redirects_to_resume_url_if_no_file(self):
        AboutMe.objects.create(
            name="Ozodbek", resume_url="https://example.com/resume.pdf"
        )
        response = self.client.get(reverse("resume"))
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, "https://example.com/resume.pdf")

    def test_resume_view_redirects_invalid_filename(self):
        AboutMe.objects.create(
            name="Ozodbek", resume_url="https://example.com/resume.pdf"
        )
        response = self.client.get("/resume/invalid_name.pdf")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, reverse("resume"))

    def test_resume_included_in_sitemap(self):
        response = self.client.get("/sitemap.xml")
        self.assertEqual(response.status_code, 200)
        self.assertIn("/resume/", response.content.decode("utf-8"))

    def test_resume_view_serves_file_when_filename_matches(self):
        about = AboutMe.objects.create(name="Ozodbek")
        about.resume_file = _FakeResumeFile()

        with patch.object(AboutMe.objects, "first", return_value=about):
            # /resume/ should work
            res1 = self.client.get(reverse("resume"))
            self.assertEqual(res1.status_code, 200)

            # /resume/Ozodbek_Bosimov.pdf should work
            res2 = self.client.get(
                reverse("resume_file", kwargs={"filename": "Ozodbek_Bosimov.pdf"})
            )
            self.assertEqual(res2.status_code, 200)

            # /resume/wrong_name.pdf should redirect to /resume/
            res3 = self.client.get(
                reverse("resume_file", kwargs={"filename": "wrong_name.pdf"})
            )
            self.assertEqual(res3.status_code, 302)
            self.assertEqual(res3.url, reverse("resume"))
