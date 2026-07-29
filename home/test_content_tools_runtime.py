from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from home.models import Blog
from home.templatetags.blog_extras import needs_content_tools_runtime


class ContentToolsRuntimeFilterTests(SimpleTestCase):
    def test_static_toolkit_blocks_do_not_load_the_runtime(self):
        self.assertFalse(
            needs_content_tools_runtime(
                '<div class="tk-block tk-callout" data-tk="callout"><p>Note</p></div>'
            )
        )

    def test_interactive_toolkit_blocks_load_the_runtime(self):
        self.assertTrue(
            needs_content_tools_runtime(
                "<div class='tk-block tk-quiz' data-tk='quiz'><p>Question</p></div>"
            )
        )

    def test_legacy_feedback_blocks_stay_supported(self):
        self.assertTrue(needs_content_tools_runtime('<div data-tk="feedback"></div>'))

    def test_table_of_contents_loads_the_runtime(self):
        self.assertTrue(needs_content_tools_runtime('<div data-tk="toc"></div>'))


class ContentToolsRuntimeTemplateTests(TestCase):
    def _post(self, slug, content):
        return Blog.objects.create(
            title=slug,
            meta="meta",
            content=content,
            topic="testing",
            slug=slug,
        )

    def test_static_block_loads_styles_without_the_runtime(self):
        blog = self._post(
            "static-tool",
            '<div class="tk-block tk-callout" data-tk="callout"><p>Note</p></div>',
        )

        response = self.client.get(reverse("blogpost", kwargs={"slug": blog.slug}))

        self.assertContains(response, "content-tools.css")
        self.assertNotContains(response, "content-tools.js")

    def test_interactive_block_loads_the_runtime(self):
        blog = self._post(
            "interactive-tool",
            '<div class="tk-block tk-spoiler" data-tk="spoiler"><p>Show</p></div>',
        )

        response = self.client.get(reverse("blogpost", kwargs={"slug": blog.slug}))

        self.assertContains(response, "content-tools.css")
        self.assertContains(response, "content-tools.js")
