"""Shared image compression.

Both paths that accept images route through here:

* model ``ImageField`` uploads (see ``_compress_and_rename_image`` in
  ``models.py``) — thumbnails, logos, project gallery slides;
* CKEditor inline uploads inside post content (see ``storage.py``).

Everything is converted to WebP, which is where the size win comes from.
The helper is deliberately conservative: anything it cannot safely
re-encode (vector files, animations, images that would grow) is reported
as "leave it alone" so the caller stores the original untouched.
"""

from io import BytesIO

from PIL import Image, ImageOps

# Below this size a photo is already cheap to serve; re-encoding buys
# little and can even cost bytes.
SKIP_BELOW_BYTES = 20 * 1024


def compress_to_webp(fileobj, max_size=(1000, 1000), quality=80, original_size=None):
    """Re-encode an image file to WebP, shrinking it to fit ``max_size``.

    Returns ``(buffer, byte_count)`` positioned at the start, or ``None``
    when the original should be kept as-is. The file pointer is rewound
    either way, so the caller can always fall back to saving the input.
    """
    try:
        if original_size is None:
            original_size = _size_of(fileobj)

        _rewind(fileobj)
        with Image.open(fileobj) as probe:
            width, height = probe.size
            # Animated GIF / WebP: a WebP re-encode would keep only the
            # first frame, so these are never touched.
            if getattr(probe, "n_frames", 1) > 1:
                return None
            fits = width <= max_size[0] and height <= max_size[1]

        # Already small and already within bounds — nothing worth doing.
        if fits and original_size is not None and original_size < SKIP_BELOW_BYTES:
            return None

        _rewind(fileobj)
        with Image.open(fileobj) as source:
            # Camera uploads often store orientation in EXIF instead of
            # rotating pixels. Apply it before resizing so dimensions and
            # the final WebP match what users actually see.
            img = ImageOps.exif_transpose(source)
            if not fits:
                img.thumbnail(max_size, Image.Resampling.LANCZOS)

            # Keep the alpha channel where there is one, drop it otherwise.
            has_alpha = img.mode in ("RGBA", "LA") or (
                img.mode == "P" and "transparency" in img.info
            )
            converted = img.convert("RGBA" if has_alpha else "RGB")

        buffer = BytesIO()
        converted.save(buffer, format="WEBP", quality=quality, method=6)
        converted.close()
        compressed_size = buffer.tell()

        # Never hand back something larger than what we were given.
        if original_size is not None and compressed_size >= original_size and fits:
            return None

        buffer.seek(0)
        return buffer, compressed_size
    except Exception:
        # Unsupported format (SVG), truncated upload, Pillow failure —
        # the caller stores the original file.
        return None
    finally:
        _rewind(fileobj)


def webp_name(name):
    """Swap a file name's extension for ``.webp``, dropping any directory."""
    base = (name or "img").rsplit("/", 1)[-1]
    stem = base.rsplit(".", 1)[0] or "img"
    return f"{stem}.webp"


def _size_of(fileobj):
    size = getattr(fileobj, "size", None)
    if isinstance(size, int):
        return size
    try:
        current = fileobj.tell()
        fileobj.seek(0, 2)
        size = fileobj.tell()
        fileobj.seek(current)
        return size
    except Exception:
        return None


def _rewind(fileobj):
    try:
        fileobj.seek(0)
    except Exception:
        pass
