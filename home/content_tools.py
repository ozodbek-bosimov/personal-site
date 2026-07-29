"""Parsing and validation for the CKEditor Content Toolkit snippets.

The snippets in ``tools/snippets/*.html`` are the source of truth for every
paste-able block. This module reads them, pulls the ``tk:meta`` header off the
top, and checks the markup against the rules that keep a block intact through
CKEditor's save/reopen cycle.

Those rules are not stylistic. CKEditor 5 runs with General HTML Support in
allow-all mode, which preserves unknown tags and attributes but still drops
anything it cannot model:

* ``script``/``style``/form controls and ``on*`` handlers are removed outright,
  so a snippet that ships a ``<button>`` loses it on the first save;
* an empty ``<span>`` disappears, because GHS stores span attributes as *text*
  attributes and there is no text to attach them to;
* a bare text node inside a ``<div>`` gets wrapped in ``<p>``, which counts as
  the markup changing.

``check_all()`` enforces the mechanical half of the round-trip contract.  The
visual half — paste, save, reopen, compare — is still a human step, documented
in ``tools/README.md``.

Consumed by ``manage.py build_tools_catalog`` (build and ``--check``) and by the
test suite.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

from django.conf import settings

# ── locations ───────────────────────────────────────────────────────────────

SNIPPET_DIRNAME = "tools/snippets"
PREVIEW_PAGE = "tools/preview/index.html"
CATALOG_PATH = "static/js/generated/tools-catalog.js"


def snippet_dir() -> Path:
    return Path(settings.BASE_DIR) / SNIPPET_DIRNAME


# ── the tag contract ────────────────────────────────────────────────────────

#: Tags a snippet may use directly.
ALLOWED_TAGS = frozenset(
    {
        "div",
        "p",
        "span",
        "ul",
        "ol",
        "li",
        "a",
        "h2",
        "h3",
        "h4",
        "strong",
        "em",
        "code",
        "table",
        "figure",
        "img",
        "blockquote",
    }
)

#: Tags implied by ``table`` and ``figure``. A table cannot exist without rows
#: and cells, and CKEditor always emits ``figure.table > table > thead|tbody``,
#: so these come along with the two container tags that are explicitly allowed.
IMPLIED_TAGS = frozenset({"thead", "tbody", "tfoot", "tr", "th", "td", "figcaption"})

#: Tags GHS strips, or that have no business in stored content.
FORBIDDEN_TAGS = frozenset(
    {
        "script",
        "style",
        "input",
        "button",
        "select",
        "textarea",
        "form",
        "label",
        "option",
        "fieldset",
        "iframe",
        "object",
        "embed",
        "link",
        "meta",
        "base",
        "svg",
        "details",
        "summary",
        "dialog",
        "template",
    }
)

#: Elements with no closing tag, exempt from the "no empty elements" rule.
VOID_TAGS = frozenset({"img", "br", "hr", "source", "track", "wbr"})

#: Non-``tk-`` classes that are legitimately present because CKEditor itself
#: emits them. Anything else must carry the ``tk-`` prefix.
ALLOWED_FOREIGN_CLASSES = frozenset(
    {
        "table",  # figure.table — CKEditor's table wrapper
        "image",
        "image_resized",
        "media",
        "raw-html-embed",
        "todo-list",
        "text-tiny",
        "text-small",
        "text-big",
        "text-huge",
    }
)

CLASS_PREFIX = "tk-"
MARKER_ATTR = "data-tk"

REQUIRED_META_KEYS = ("name", "tool", "group", "description")

_ON_ATTR_RE = re.compile(r"^on", re.IGNORECASE)
_META_RE = re.compile(r"<!--\s*tk:meta\s*(.*?)-->", re.DOTALL)
_PARAM_SEP = "::"


# ── data model ──────────────────────────────────────────────────────────────


@dataclass
class Param:
    name: str
    values: str
    default: str
    description: str

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "values": self.values,
            "default": self.default,
            "description": self.description,
        }


@dataclass
class Snippet:
    path: Path
    tool: str
    name: str
    group: str
    description: str
    html: str
    interactive: bool = False
    a11y: str = ""
    limits: str = ""
    params: list[Param] = field(default_factory=list)

    @property
    def filename(self) -> str:
        return self.path.name

    def as_dict(self) -> dict:
        return {
            "tool": self.tool,
            "name": self.name,
            "group": self.group,
            "description": self.description,
            "interactive": self.interactive,
            "a11y": self.a11y,
            "limits": self.limits,
            "params": [p.as_dict() for p in self.params],
            "html": self.html,
        }


# ── metadata parsing ────────────────────────────────────────────────────────


def parse_meta(source: str) -> tuple[dict, str]:
    """Split a snippet file into its ``tk:meta`` mapping and its markup.

    The header is deliberately not YAML: pulling in a parser for a dozen
    ``key: value`` lines is not worth a dependency. ``param:`` may repeat and
    its value is four ``::``-separated fields.
    """
    match = _META_RE.search(source)
    if not match:
        return {}, source.strip()

    meta: dict = {"params": []}
    for raw_line in match.group(1).splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip().lower()
        value = value.strip()
        if not value:
            continue
        if key == "param":
            fields = [f.strip() for f in value.split(_PARAM_SEP)]
            while len(fields) < 4:
                fields.append("")
            meta["params"].append(
                Param(
                    name=fields[0],
                    values=fields[1],
                    default=fields[2],
                    description=_PARAM_SEP.join(fields[3:]).strip(),
                )
            )
        else:
            meta[key] = value

    html = source[match.end() :].strip()
    return meta, html


def _as_bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "yes", "true", "on"}


def load_snippet(path: Path) -> Snippet:
    meta, html = parse_meta(path.read_text(encoding="utf-8"))
    return Snippet(
        path=path,
        tool=meta.get("tool", ""),
        name=meta.get("name", ""),
        group=meta.get("group", ""),
        description=meta.get("description", ""),
        interactive=_as_bool(meta.get("interactive"), False),
        a11y=meta.get("a11y", ""),
        limits=meta.get("limits", ""),
        params=list(meta.get("params", [])),
        html=html,
    )


def load_all(directory: Path | None = None) -> list[Snippet]:
    """Every snippet, ordered by group then display name."""
    directory = directory or snippet_dir()
    if not directory.is_dir():
        return []
    snippets = [load_snippet(p) for p in sorted(directory.glob("*.html"))]
    snippets.sort(key=lambda s: (s.group.lower(), s.name.lower()))
    return snippets


# ── markup inspection ───────────────────────────────────────────────────────


@dataclass
class Node:
    tag: str
    attrs: dict
    children: list = field(default_factory=list)
    text: str = ""
    #: Whitespace-stripped text belonging directly to this element.
    own_text: str = ""


class _TreeBuilder(HTMLParser):
    """Minimal HTML → tree parser.

    ``html.parser`` from the standard library is enough here: snippets are
    small, well-formed, hand-written documents. Using it avoids adding lxml or
    BeautifulSoup as a dependency for a lint that runs a couple of dozen times.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node(tag="#root", attrs={})
        self._stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag=tag, attrs={k: (v or "") for k, v in attrs})
        self._stack[-1].children.append(node)
        if tag not in VOID_TAGS:
            self._stack.append(node)

    def handle_startendtag(self, tag, attrs):
        node = Node(tag=tag, attrs={k: (v or "") for k, v in attrs})
        self._stack[-1].children.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self._stack) - 1, 0, -1):
            if self._stack[index].tag == tag:
                del self._stack[index:]
                return

    def handle_data(self, data):
        if data.strip():
            self._stack[-1].own_text += data

    def error(self, message):  # pragma: no cover - py<3.10 compatibility hook
        raise AssertionError(message)


def parse_html(html: str) -> Node:
    builder = _TreeBuilder()
    builder.feed(html)
    builder.close()
    return builder.root


def walk(node: Node):
    for child in node.children:
        yield child
        yield from walk(child)


def _has_content(node: Node) -> bool:
    """True when the element would survive CKEditor's data processor."""
    if node.tag in VOID_TAGS:
        return True
    if node.own_text.strip():
        return True
    return any(_has_content(child) or child.tag in VOID_TAGS for child in node.children)


def root_element(tree: Node) -> Node | None:
    for child in tree.children:
        if child.tag != "#root":
            return child
    return None


# ── validation ──────────────────────────────────────────────────────────────


def check_snippet(snippet: Snippet) -> list[str]:
    """Return a list of human-readable problems; empty means the snippet is fine."""
    problems: list[str] = []

    # -- metadata -----------------------------------------------------------
    for key in REQUIRED_META_KEYS:
        if not getattr(snippet, key, ""):
            problems.append(f"tk:meta is missing the required key '{key}'")

    stem = snippet.path.stem
    if snippet.tool and snippet.tool != stem:
        problems.append(
            f"tk:meta tool '{snippet.tool}' does not match the filename '{stem}.html'"
        )

    for param in snippet.params:
        if not param.name or not param.description:
            problems.append(
                "param line needs at least a name and a description "
                f"(got {param.as_dict()!r})"
            )

    if not snippet.html:
        problems.append("no markup after the tk:meta header")
        return problems

    tree = parse_html(snippet.html)
    root = root_element(tree)

    # -- root element -------------------------------------------------------
    if root is None:
        problems.append("no root element found")
        return problems

    top_level = [c for c in tree.children if c.tag != "#root"]
    if len(top_level) > 1:
        problems.append(
            f"{len(top_level)} top-level elements; a snippet must have exactly one root"
        )

    marker = root.attrs.get(MARKER_ATTR)
    if marker is None:
        problems.append(f"root element is missing the {MARKER_ATTR} marker")
    elif snippet.tool and marker != snippet.tool:
        problems.append(
            f'root {MARKER_ATTR}="{marker}" does not match tk:meta tool "{snippet.tool}"'
        )

    root_classes = (root.attrs.get("class") or "").split()
    if "tk-block" not in root_classes:
        problems.append("root element should carry the 'tk-block' class")

    # -- every element ------------------------------------------------------
    for node in walk(tree):
        tag = node.tag

        if tag in FORBIDDEN_TAGS:
            problems.append(
                f"<{tag}> is stripped by CKEditor's General HTML Support; "
                "the runtime must create it instead"
            )
        elif tag not in ALLOWED_TAGS and tag not in IMPLIED_TAGS:
            problems.append(f"<{tag}> is not on the allowed-tag list")

        for name, value in node.attrs.items():
            lowered = name.lower()
            if _ON_ATTR_RE.match(lowered):
                problems.append(f"<{tag}> has an inline handler '{name}'")
            if lowered == "style":
                problems.append(
                    f"<{tag}> has a style attribute; move the rule into "
                    "content-tools.css so it stays themeable"
                )

            if lowered == "class":
                for token in value.split():
                    if token.startswith(CLASS_PREFIX):
                        continue
                    if token in ALLOWED_FOREIGN_CLASSES:
                        continue
                    problems.append(
                        f"<{tag}> class '{token}' is neither {CLASS_PREFIX}-prefixed "
                        "nor a CKEditor-native class. Tailwind utilities in "
                        "particular will not work: Tailwind never scans database "
                        "content, so the class is purged from the build"
                    )

        if not _has_content(node):
            problems.append(
                f"<{tag}> is empty. Empty elements do not survive a round trip "
                "(GHS keeps span attributes as text attributes, so there is "
                "nothing to attach them to). Use a CSS pseudo-element, or let "
                "the runtime create the node"
            )

        if tag == "div" and node.own_text.strip():
            problems.append(
                "<div> holds a bare text node; CKEditor would wrap it in <p>, "
                f"changing the markup (text: {node.own_text.strip()[:40]!r})"
            )

    return problems


def check_all(directory: Path | None = None) -> dict[str, list[str]]:
    """Validate every snippet. Returns ``{filename: [problems]}`` for failures only."""
    results: dict[str, list[str]] = {}
    for snippet in load_all(directory):
        problems = check_snippet(snippet)
        if problems:
            results[snippet.filename] = problems
    return results


_CLASS_ATTR_RE = re.compile(r'class="([^"]*)"')
_CSS_CLASS_RE = re.compile(r"\.(tk-[A-Za-z0-9_-]+)")


def check_css_coverage(snippets: list[Snippet] | None = None) -> list[str]:
    """Report ``tk-`` classes used in snippets that no CSS rule defines.

    Catches the failure that is easiest to miss and hardest to spot by eye: a
    mistyped class name renders as unstyled markup rather than as an error.

    Only checked in one direction. Classes defined but unused are fine — the
    runtime creates most of its own nodes, so those rules have no counterpart
    in any snippet file.
    """
    stylesheet = Path(settings.BASE_DIR) / "static/css/content-tools.css"
    if not stylesheet.is_file():
        return ["static/css/content-tools.css does not exist"]

    defined = set(_CSS_CLASS_RE.findall(stylesheet.read_text(encoding="utf-8")))

    problems: list[str] = []
    for snippet in snippets if snippets is not None else load_all():
        used: set[str] = set()
        for match in _CLASS_ATTR_RE.finditer(snippet.html):
            used.update(
                token
                for token in match.group(1).split()
                if token.startswith(CLASS_PREFIX)
            )
        for token in sorted(used - defined):
            problems.append(
                f"{snippet.filename}: class '{token}' has no rule in content-tools.css"
            )
    return problems


def check_preview_coverage(snippets: list[Snippet] | None = None) -> list[str]:
    """Report tools that have no example in the preview gallery.

    The gallery is hand-written so each block can be shown in several states
    at once, which a generated page would flatten. This check is what keeps
    the hand-written page from drifting behind the snippet directory.
    """
    snippets = snippets if snippets is not None else load_all()
    page = Path(settings.BASE_DIR) / PREVIEW_PAGE
    if not page.is_file():
        return [f"{PREVIEW_PAGE} does not exist"]

    markup = page.read_text(encoding="utf-8")
    return [
        f"tool '{s.tool}' has no example in {PREVIEW_PAGE}"
        for s in snippets
        if s.tool and f'{MARKER_ATTR}="{s.tool}"' not in markup
    ]
