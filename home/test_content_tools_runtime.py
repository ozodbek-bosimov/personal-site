from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from home.models import Blog
from home.templatetags.blog_extras import (
    needs_content_tools_runtime,
    needs_content_tools_styles,
)


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

    def test_native_ckeditor_todo_list_loads_the_runtime(self):
        # CKEditor 5's built-in To-do List emits class="todo-list" with a
        # disabled checkbox input. It has no data-tk marker, but the runtime
        # upgrades it into a persistable tk-checklist block, so it must load.
        self.assertTrue(
            needs_content_tools_runtime(
                '<ul class="todo-list"><li><label><input type="checkbox" '
                'disabled="disabled"><span>Task</span></label></li></ul>'
            )
        )

    def test_native_todo_list_loads_styles(self):
        self.assertTrue(
            needs_content_tools_styles('<ul class="todo-list"><li>Task</li></ul>')
        )
        self.assertFalse(needs_content_tools_styles('<p>plain prose</p>'))
        self.assertTrue(needs_content_tools_styles('<div data-tk="callout"></div>'))


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

    def test_native_todo_list_loads_styles_and_runtime(self):
        # A post whose only toolkit-adjacent content is a native To-do List
        # must still get the stylesheet and the runtime, so the checkboxes
        # become interactive and persist to localStorage.
        blog = self._post(
            "native-todo",
            '<ul class="todo-list"><li><label><input type="checkbox" '
            'disabled="disabled"><span>Task</span></label></li></ul>',
        )

        response = self.client.get(reverse("blogpost", kwargs={"slug": blog.slug}))

        self.assertContains(response, "content-tools.css")
        self.assertContains(response, "content-tools.js")
