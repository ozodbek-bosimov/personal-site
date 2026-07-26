"""Custom file storage for CKEditor 5 uploads.

Two jobs:

* route every inline image into ``postimages/`` under ``MEDIA_ROOT`` so
  editor uploads sit next to the blog thumbnails instead of cluttering
  the media root;
* compress them. Uploads arrive here straight from the browser — no model
  ``ImageField`` is involved, so nothing else in the project touches them
  and full-size camera / screenshot files were being served as-is.
"""

from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage

from home.imaging import compress_to_webp, webp_name

# Post images render at ~800px wide at most; 1600 leaves retina headroom.
MAX_SIZE = (1600, 1600)
QUALITY = 82


class CKEditor5Storage(FileSystemStorage):
    """Places CKEditor uploads under ``postimages/`` as compressed WebP."""

    def save(self, name, content, max_length=None):
        name, content = self._compress(name, content)

        # Ensure the file is placed under the postimages/ subdirectory
        if not name.startswith("postimages/"):
            name = f"postimages/{name}"
        return super().save(name, content, max_length=max_length)

    @staticmethod
    def _compress(name, content):
        """Return a WebP version of the upload, or the input unchanged.

        Vector files, animations and images that would not get smaller are
        left alone by ``compress_to_webp``.
        """
        result = compress_to_webp(content, max_size=MAX_SIZE, quality=QUALITY)
        if result is None:
            return name, content

        buffer, _size = result
        directory = name.rsplit("/", 1)[0] + "/" if "/" in name else ""
        return directory + webp_name(name), ContentFile(buffer.getvalue())
