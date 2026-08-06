import math
import os
import re
from urllib.parse import urlparse

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.files.storage import FileSystemStorage, default_storage
from django.core.files.uploadedfile import InMemoryUploadedFile
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone

from home.imaging import compress_to_webp, webp_name


def _compress_and_rename_image(image_field, max_size=(1000, 1000), quality=80):
    """Compress a newly uploaded image field to WebP.

    The actual re-encoding lives in ``home.imaging`` so CKEditor uploads
    (which never pass through a model field) share exactly the same rules.
    """
    if not image_field:
        return image_field

    # Only process *new* uploads (not already-saved files)
    if getattr(image_field, "_committed", True):
        return image_field

    result = compress_to_webp(image_field, max_size=max_size, quality=quality)
    if result is None:
        return image_field

    buffer, compressed_size = result
    new_name = webp_name(getattr(image_field, "name", "img"))
    return InMemoryUploadedFile(
        buffer, "ImageField", new_name, "image/webp", compressed_size, None
    )


class Blog(models.Model):
    sno = models.AutoField(primary_key=True)
    title = models.CharField(max_length=200)
    meta = models.CharField(
        max_length=300,
        help_text=(
            "Short summary shown on cards and in search/social previews "
            "(max 300 characters)."
        ),
    )
    content = models.TextField()
    thumbnail_img = models.ImageField(null=True, blank=True, upload_to="postimages/")
    thumbnail_url = models.URLField(blank=True, null=True)
    topic = models.CharField(
        max_length=255, default="uncategorized", verbose_name="topic"
    )
    slug = models.CharField(max_length=100, unique=True)
    time = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    reading_time_minutes = models.PositiveSmallIntegerField(default=1, editable=False)

    def __str__(self):
        return self.title

    def _compute_reading_time(self):
        """Calculate estimated reading time in minutes from HTML content."""
        if not self.content:
            return 1
        text = re.sub(r"<[^>]+>", " ", self.content)
        text = re.sub(r"\s+", " ", text).strip()
        word_count = len(text.split()) if text else 0
        return max(1, math.ceil(word_count / 160))

    def save(self, *args, **kwargs):
        if self.topic:
            self.topic = self.topic.strip().lower()

        if self.thumbnail_img:
            self.thumbnail_img = _compress_and_rename_image(
                self.thumbnail_img, max_size=(1280, 720), quality=90
            )

        self.reading_time_minutes = self._compute_reading_time()
        super().save(*args, **kwargs)

    @property
    def effective_thumbnail(self):
        """Return the URL to use for the thumbnail, preferring the uploaded image."""
        if self.thumbnail_img and hasattr(self.thumbnail_img, "url"):
            return self.thumbnail_img.url
        return self.thumbnail_url or ""

    def get_absolute_thumbnail_url(self, request):
        """Return the absolute URL for the thumbnail, including scheme and host."""
        img_url = self.effective_thumbnail
        if img_url and not img_url.startswith(("http://", "https://")):
            return f"{request.scheme}://{request.get_host()}{img_url}"
        return img_url


class AboutMe(models.Model):
    """Singleton model for About Me section"""

    name = models.CharField(max_length=100)
    profession = models.CharField(max_length=150)
    bio = models.TextField()
    email = models.EmailField()
    phone = models.CharField(max_length=20, blank=True)
    profile_img = models.ImageField(null=True, blank=True, upload_to="profile/")
    profile_image_url = models.URLField(
        blank=True, help_text="CDN URL for profile image (used if no image is uploaded)"
    )
    hero_img = models.ImageField(null=True, blank=True, upload_to="hero/")
    hero_image_url = models.URLField(
        blank=True, help_text="CDN URL for the homepage hero background image"
    )
    resume_file = models.FileField(
        null=True,
        blank=True,
        upload_to="resume/",
        help_text="Upload your resume file directly (e.g. PDF)",
    )
    resume_url = models.URLField(
        blank=True,
        help_text="External URL for your resume (used if no file is uploaded)",
    )
    linkedin_url = models.URLField(blank=True)
    show_linkedin_in_base = models.BooleanField(
        default=True, verbose_name="Show LinkedIn in base/footer"
    )
    github_url = models.URLField(blank=True)
    show_github_in_base = models.BooleanField(
        default=True, verbose_name="Show GitHub in base/footer"
    )
    telegram_url = models.URLField(blank=True)
    show_telegram_in_base = models.BooleanField(
        default=False, verbose_name="Show Telegram in base/footer"
    )
    x_url = models.URLField(blank=True, help_text="X (formerly Twitter) profile URL")
    show_x_in_base = models.BooleanField(
        default=False, verbose_name="Show X in base/footer"
    )
    leetcode_url = models.URLField(blank=True)
    show_leetcode_in_base = models.BooleanField(
        default=True, verbose_name="Show LeetCode in base/footer"
    )
    youtube_url = models.URLField(blank=True, help_text="YouTube channel URL")
    show_youtube_in_base = models.BooleanField(
        default=False, verbose_name="Show YouTube in base/footer"
    )
    instagram_url = models.URLField(blank=True, help_text="Instagram profile URL")
    show_instagram_in_base = models.BooleanField(
        default=False, verbose_name="Show Instagram in base/footer"
    )

    @property
    def effective_resume(self):
        """Return the canonical /resume/ URL if uploaded resume exists, otherwise the external resume URL."""
        if self.resume_file and hasattr(self.resume_file, "name") and self.resume_file.name:
            return "/resume/"
        return self.resume_url or ""

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        """Enforce singleton pattern - only one AboutMe instance allowed"""
        if not self.pk and AboutMe.objects.exists():
            # Update the existing instance instead of deleting
            existing = AboutMe.objects.first()
            self.pk = existing.pk

        if self.profile_img:
            self.profile_img = _compress_and_rename_image(
                self.profile_img, max_size=(800, 800), quality=95
            )
        if self.hero_img:
            self.hero_img = _compress_and_rename_image(
                self.hero_img, max_size=(2560, 1440), quality=85
            )

        super().save(*args, **kwargs)

    @property
    def effective_profile_image(self):
        """Return the URL to use for the profile image, preferring the uploaded image."""
        if self.profile_img and hasattr(self.profile_img, "url"):
            return self.profile_img.url
        return self.profile_image_url or ""

    @property
    def effective_hero_image(self):
        """Return the URL to use for the hero background image."""
        if self.hero_img and hasattr(self.hero_img, "url"):
            return self.hero_img.url
        return self.hero_image_url or ""

    def get_absolute_profile_image_url(self, request):
        """Return the absolute URL for the profile image, including scheme and host."""
        img_url = self.effective_profile_image
        if img_url and not img_url.startswith(("http://", "https://")):
            return f"{request.scheme}://{request.get_host()}{img_url}"
        return img_url

    def get_absolute_hero_image_url(self, request):
        """Return the absolute URL for the hero image, including scheme and host."""
        img_url = self.effective_hero_image
        if img_url and not img_url.startswith(("http://", "https://")):
            return f"{request.scheme}://{request.get_host()}{img_url}"
        return img_url

    class Meta:
        verbose_name = "About Me"
        verbose_name_plural = "About Me"


class Skill(models.Model):
    """Skills with percentage proficiency"""

    # Upper bound of each proficiency band -> label. Single source of truth
    # for the About page badge, the admin column and the admin filter.
    LEVEL_BANDS = (
        (19, "Familiar"),
        (39, "Basic"),
        (69, "Working knowledge"),
        (89, "Advanced"),
        (100, "Expert"),
    )

    name = models.CharField(max_length=100)
    percentage = models.IntegerField(
        validators=[MinValueValidator(0), MaxValueValidator(100)],
        help_text="Skill proficiency (0-100)",
    )
    order = models.IntegerField(
        default=0, help_text="Display order (lower numbers first)"
    )

    def __str__(self):
        return f"{self.name} — {self.percentage}%"

    @property
    def level_display(self):
        """Proficiency band label, e.g. 'Advanced'."""
        for ceiling, label in self.LEVEL_BANDS:
            if (self.percentage or 0) <= ceiling:
                return label
        return self.LEVEL_BANDS[-1][1]

    class Meta:
        ordering = ["order", "name"]


class Experience(models.Model):
    """Work experience entries for the About page timeline.

    Single-position: fill in position/dates directly on this model.
    Multi-position (promotions): leave position/dates here empty and add
    ExperienceRole children instead.  The template handles both cases.
    """

    WORK_TYPE_CHOICES = [
        ("on-site", "On-site"),
        ("hybrid", "Hybrid"),
        ("remote", "Remote"),
    ]

    EMPLOYMENT_TYPE_CHOICES = [
        ("full-time", "Full-time"),
        ("part-time", "Part-time"),
        ("self-employed", "Self-employed"),
        ("freelance", "Freelance"),
        ("contract", "Contract"),
        ("internship", "Internship"),
        ("apprenticeship", "Apprenticeship"),
        ("seasonal", "Seasonal"),
    ]

    company = models.CharField(max_length=200)
    company_url = models.URLField(
        blank=True, help_text="Company website URL (opens in new tab)"
    )
    company_logo = models.ImageField(
        upload_to="companies/",
        blank=True,
        help_text="Company logo image (will be compressed to WebP)",
    )
    company_logo_url = models.URLField(
        blank=True,
        help_text="External URL for company logo (used if no file uploaded)",
    )
    # Single-position fields (used when no ExperienceRole children exist)
    position = models.CharField(max_length=200, blank=True)
    work_type = models.CharField(
        max_length=10,
        choices=WORK_TYPE_CHOICES,
        default="on-site",
        help_text="On-site, Hybrid, or Remote",
    )
    location = models.CharField(max_length=200, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(
        null=True, blank=True, help_text="Leave blank if current"
    )
    is_current = models.BooleanField(
        default=False, help_text="Check if this is your current position"
    )
    description = models.TextField(
        blank=True,
        help_text="Key responsibilities and achievements. Each line becomes a bullet point.",
    )
    order = models.IntegerField(
        default=0, help_text="Display order (lower numbers first)"
    )

    @property
    def logo_url(self):
        """Return the best available logo URL, or None for the SVG fallback."""
        if self.company_logo:
            return self.company_logo.url
        if self.company_logo_url:
            return self.company_logo_url
        return None

    def save(self, *args, **kwargs):
        if self.company_logo:
            self.company_logo = _compress_and_rename_image(
                self.company_logo, max_size=(128, 128), quality=95
            )
        super().save(*args, **kwargs)

    @staticmethod
    def _compute_duration(start_date, end_date, is_current):
        """Shared duration formatter: '2 yrs 1 mo', '3 mos', etc."""
        if not start_date:
            return ""
        end = end_date if end_date and not is_current else timezone.now().date()
        total_months = (end.year - start_date.year) * 12 + (
            end.month - start_date.month
        )
        total_months = max(total_months, 1)
        years = total_months // 12
        months = total_months % 12
        parts = []
        if years == 1:
            parts.append("1 yr")
        elif years > 1:
            parts.append(f"{years} yrs")
        if months == 1:
            parts.append("1 mo")
        elif months > 1:
            parts.append(f"{months} mos")
        return " ".join(parts) if parts else "1 mo"

    @property
    def has_roles(self):
        """True when this Experience has ExperienceRole children.
        Uses .all() (not .exists()) so prefetch_related cache is respected —
        avoids an extra SELECT per experience on the About page."""
        return bool(self.roles.all())

    @property
    def duration_display(self):
        """Duration for single-position entries."""
        return self._compute_duration(self.start_date, self.end_date, self.is_current)

    @property
    def total_duration_display(self):
        """Duration spanning all roles (min start_date → max end_date / present).
        Iterates the prefetched roles list exactly once."""
        roles = list(self.roles.all())  # uses prefetch cache; materialise once
        if not roles:
            return self.duration_display

        earliest = None
        latest = None
        any_current = False

        for r in roles:
            if not r.start_date:
                continue
            if earliest is None or r.start_date < earliest:
                earliest = r.start_date
            if r.is_current:
                any_current = True
            elif r.end_date:
                if latest is None or r.end_date > latest:
                    latest = r.end_date

        if earliest is None:
            return ""
        # If any role is current, pass latest=None so _compute_duration uses today
        return self._compute_duration(
            earliest, None if any_current else latest, any_current
        )

    @property
    def description_lines(self):
        """Split description into individual lines."""
        if not self.description:
            return []
        return [
            line.strip()
            for line in self.description.strip().splitlines()
            if line.strip()
        ]

    def __str__(self):
        if self.position:
            if self.is_current:
                status = "Present"
            elif self.end_date:
                status = self.end_date.strftime("%m/%Y")
            else:
                status = "Present"
            start = self.start_date.strftime("%m/%Y") if self.start_date else "?"
            return f"{self.position} @ {self.company} ({start} – {status})"
        return self.company

    class Meta:
        ordering = ["order", "-start_date"]
        verbose_name = "Experience"
        verbose_name_plural = "Experiences"


class ExperienceRole(models.Model):
    """A position/role within an Experience (company).

    Use this when someone held multiple positions at the same company.
    """

    experience = models.ForeignKey(
        Experience, on_delete=models.CASCADE, related_name="roles"
    )
    position = models.CharField(max_length=200)
    employment_type = models.CharField(
        max_length=20,
        choices=Experience.EMPLOYMENT_TYPE_CHOICES,
        default="full-time",
    )
    work_type = models.CharField(
        max_length=10,
        choices=Experience.WORK_TYPE_CHOICES,
        default="on-site",
    )
    location = models.CharField(max_length=200, blank=True)
    start_date = models.DateField()
    end_date = models.DateField(
        null=True, blank=True, help_text="Leave blank if current"
    )
    is_current = models.BooleanField(
        default=False, help_text="Check if this is your current position"
    )
    description = models.TextField(
        blank=True,
        help_text="Each line becomes a bullet point.",
    )

    @property
    def duration_display(self):
        return Experience._compute_duration(
            self.start_date, self.end_date, self.is_current
        )

    @property
    def description_lines(self):
        if not self.description:
            return []
        return [
            line.strip()
            for line in self.description.strip().splitlines()
            if line.strip()
        ]

    def clean(self):
        super().clean()
        if self.is_current and self.end_date:
            raise ValidationError("A current role should not have an end date.")
        if not self.is_current and not self.end_date:
            raise ValidationError(
                "Please provide an end date or mark the role as current."
            )

    def __str__(self):
        return f"{self.position} @ {self.experience.company}"

    class Meta:
        ordering = ["-start_date"]
        verbose_name = "Experience Role"
        verbose_name_plural = "Experience Roles"


class Project(models.Model):
    """Portfolio projects"""

    title = models.CharField(max_length=200)
    description = models.TextField(
        max_length=2000,
        help_text="Project description (max 2000 characters).",
    )
    start_date = models.DateField(
        null=True,
        blank=True,
        help_text="When the project was started.",
    )
    end_date = models.DateField(
        null=True,
        blank=True,
        help_text="When the project was finished. Leave blank if ongoing.",
    )
    is_current = models.BooleanField(
        default=False,
        help_text="Check if this project is still in progress.",
    )
    github_link = models.URLField(blank=True)
    demo_link = models.URLField(blank=True)
    technologies = models.CharField(
        max_length=500, help_text="Comma-separated technologies"
    )
    order = models.IntegerField(
        default=0, help_text="Display order (lower numbers first)"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        label = self.title
        if self.start_date:
            start = self.start_date.strftime("%m/%Y")
            if self.is_current:
                label += f" ({start} – Present)"
            elif self.end_date:
                label += f" ({start} – {self.end_date.strftime('%m/%Y')})"
            else:
                label += f" ({start} – Present)"
        return label

    @property
    def duration_display(self):
        """Human-readable duration, e.g. '1 yr 3 mos'."""
        return Experience._compute_duration(
            self.start_date, self.end_date, self.is_current
        )

    @property
    def date_range_display(self):
        """Formatted date range, e.g. 'Jan 2024 – Present'."""
        if not self.start_date:
            return ""
        start = self.start_date.strftime("%b %Y")
        if self.is_current:
            end = "Present"
        elif self.end_date:
            end = self.end_date.strftime("%b %Y")
        else:
            end = "Present"
        return f"{start} – {end}"

    def get_technologies_list(self):
        """Return technologies as a list"""
        if self.technologies:
            return [
                tech.strip() for tech in self.technologies.split(",") if tech.strip()
            ]
        return []

    @property
    def gallery(self):
        """Slides for the project card carousel, in admin order.

        Returns a list of ``{"url", "caption"}`` dicts.  Images live in a
        single ProjectImage list — the first one doubles as the cover /
        social-preview image.  Duplicate URLs are dropped.
        """
        slides = []
        seen = set()

        for image in self.images.all():
            url = image.effective_image
            if url and url not in seen:
                slides.append({"url": url, "caption": image.caption})
                seen.add(url)

        return slides

    @property
    def effective_thumbnail(self):
        """URL of the cover image, i.e. the first gallery slide."""
        slides = self.gallery
        return slides[0]["url"] if slides else ""

    class Meta:
        ordering = ["order", "-created_at"]


class ProjectImage(models.Model):
    """One image of a project's gallery.

    This is the only place project images live: the first row (lowest
    ``order``) is the cover shown on the card and in social previews, and
    every row becomes a slide in the card carousel.  Like every other image
    on the site, an entry can either be an uploaded file or an external URL.
    """

    project = models.ForeignKey(
        Project,
        related_name="images",
        on_delete=models.CASCADE,
    )
    image = models.ImageField(
        null=True,
        blank=True,
        upload_to="projects/",
        help_text="Upload an image (preferred over URL)",
    )
    image_url = models.URLField(
        blank=True,
        help_text="CDN URL for the image (used if no file is uploaded)",
    )
    caption = models.CharField(
        max_length=200,
        blank=True,
        help_text="Optional caption, also used as the image alt text",
    )
    order = models.IntegerField(
        default=0,
        help_text="Lower numbers first. Leave at 0 to append after the existing images.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]
        verbose_name = "Project image"
        verbose_name_plural = "Project images"

    def __str__(self):
        """Label shown as the row heading in the admin inline.

        Deliberately free of primary keys: '#22' means nothing to whoever
        is editing the page. Falls back to the file name, then the URL's
        last segment.
        """
        if self.caption:
            return self.caption

        source = self.image.name if self.image else (self.image_url or "")
        filename = source.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
        return filename or "Image"

    @property
    def effective_image(self):
        """Return the URL to use, preferring the uploaded file."""
        if self.image and hasattr(self.image, "url"):
            return self.image.url
        return self.image_url or ""

    def clean(self):
        if not self.image and not self.image_url:
            raise ValidationError(
                "Provide either an uploaded image or an image URL for this slide."
            )

    def save(self, *args, **kwargs):
        if self.image:
            self.image = _compress_and_rename_image(
                self.image, max_size=(1600, 900), quality=90
            )

        # New rows left at the default land after the existing images
        # instead of piling up at position 0.
        if self._state.adding and not self.order and self.project_id:
            last = (
                ProjectImage.objects.filter(project_id=self.project_id)
                .order_by("-order")
                .values_list("order", flat=True)
                .first()
            )
            self.order = (last or 0) + 1

        super().save(*args, **kwargs)


# signals for cleaning up image files when a Blog is changed or removed


def _extract_media_paths_from_html(html_content):
    if not html_content:
        return set()

    media_url = settings.MEDIA_URL or "/media/"
    if not media_url.endswith("/"):
        media_url = f"{media_url}/"

    paths = set()
    for raw_url in re.findall(r'(?:src|href)=["\']([^"\']+)["\']', html_content):
        parsed_path = urlparse(raw_url).path
        if parsed_path.startswith(media_url):
            relative_path = parsed_path[len(media_url) :].lstrip("/")
            if relative_path:
                paths.add(relative_path)
    return paths


def _is_media_still_referenced(
    relative_path, exclude_aboutme_pk=None, exclude_blog_pk=None
):
    media_url = settings.MEDIA_URL or "/media/"
    if not media_url.endswith("/"):
        media_url = f"{media_url}/"
    absolute_media_url = f"{media_url}{relative_path}"

    aboutme_qs = AboutMe.objects.all()
    if exclude_aboutme_pk:
        aboutme_qs = aboutme_qs.exclude(pk=exclude_aboutme_pk)

    blog_qs = Blog.objects.all()
    if exclude_blog_pk:
        blog_qs = blog_qs.exclude(pk=exclude_blog_pk)

    return (
        aboutme_qs.filter(bio__icontains=absolute_media_url).exists()
        or blog_qs.filter(content__icontains=absolute_media_url).exists()
    )


def _delete_media_paths_if_unused(
    media_paths, exclude_aboutme_pk=None, exclude_blog_pk=None
):
    for path in media_paths:
        if _is_media_still_referenced(
            path,
            exclude_aboutme_pk=exclude_aboutme_pk,
            exclude_blog_pk=exclude_blog_pk,
        ):
            continue
        if default_storage.exists(path):
            default_storage.delete(path)


@receiver(pre_save, sender=Blog)
def cleanup_blog_on_save(sender, instance, **kwargs):
    """Delete old thumbnail and removed media files when Blog is saved.
    Also stores the old slug on the instance for post_save cache invalidation."""
    if not instance.pk:
        instance._old_slug = None
        return
    try:
        old_instance = sender.objects.get(pk=instance.pk)
    except sender.DoesNotExist:
        instance._old_slug = None
        return

    # Store old slug so post_save can invalidate stale cache when slug changes
    instance._old_slug = old_instance.slug

    # Delete old thumbnail if it changed
    if (
        old_instance.thumbnail_img
        and old_instance.thumbnail_img != instance.thumbnail_img
    ):
        old_instance.thumbnail_img.delete(save=False)

    # Delete media files removed from content
    old_media = _extract_media_paths_from_html(old_instance.content)
    new_media = _extract_media_paths_from_html(instance.content)
    removed_media = old_media - new_media
    _delete_media_paths_if_unused(removed_media, exclude_blog_pk=instance.pk)


@receiver(post_delete, sender=Blog)
def cleanup_blog_on_delete(sender, instance, **kwargs):
    """Delete thumbnail and media files from Blog.content when Blog is deleted."""
    if instance.thumbnail_img:
        instance.thumbnail_img.delete(save=False)
    removed_media = _extract_media_paths_from_html(instance.content)
    _delete_media_paths_if_unused(removed_media)

    # Invalidate all related caches
    cache.delete("used_tags")
    cache.delete(f"blogpost_{instance.slug}")
    cache.delete_many(
        [
            "latest_blogs",
            "total_blogs",
            "total_topics",
            "all_topics",
            "all_blogs_list",
        ]
    )


@receiver(post_save, sender=Blog)
def invalidate_blog_cache_on_save(sender, instance, **kwargs):
    """Invalidate caches when a Blog post is created or updated."""
    cache.delete("used_tags")
    cache.delete(f"blogpost_{instance.slug}")
    # If slug was changed, also invalidate the old slug's cache to avoid stale responses
    old_slug = getattr(instance, "_old_slug", None)
    if old_slug and old_slug != instance.slug:
        cache.delete(f"blogpost_{old_slug}")
    cache.delete_many(
        [
            "latest_blogs",
            "total_blogs",
            "total_topics",
            "all_topics",
            "all_blogs_list",
        ]
    )


@receiver([post_save, post_delete], sender=Project)
def invalidate_project_cache(sender, instance, **kwargs):
    """Invalidate cache when a Project is created, updated, or deleted."""
    cache.delete_many(["total_projects", "all_projects"])


@receiver(pre_save, sender=ProjectImage)
def cleanup_project_image_on_save(sender, instance, **kwargs):
    """Delete the old gallery file when a slide's image is replaced."""
    if not instance.pk:
        return
    try:
        old = sender.objects.get(pk=instance.pk)
    except sender.DoesNotExist:
        return

    old_name = old.image.name if old.image else None
    new_name = instance.image.name if instance.image else None
    if old_name and old_name != new_name:
        try:
            if default_storage.exists(old_name):
                default_storage.delete(old_name)
        except Exception:
            pass


@receiver(post_delete, sender=ProjectImage)
def cleanup_project_image_on_delete(sender, instance, **kwargs):
    """Delete the gallery file when a slide is removed."""
    if instance.image and instance.image.name:
        try:
            if default_storage.exists(instance.image.name):
                default_storage.delete(instance.image.name)
        except Exception:
            pass


@receiver([post_save, post_delete], sender=ProjectImage)
def invalidate_project_cache_on_image_change(sender, instance, **kwargs):
    """The cached project list carries prefetched gallery rows — refresh it."""
    cache.delete("all_projects")


@receiver([post_save, post_delete], sender=Skill)
def invalidate_skill_cache(sender, instance, **kwargs):
    """Invalidate skills cache when a Skill is created, updated, or deleted."""
    cache.delete("all_skills")


@receiver(pre_save, sender=Experience)
def cleanup_experience_logo_on_save(sender, instance, **kwargs):
    """Delete old company logo when it is changed or replaced."""
    if not instance.pk:
        return
    try:
        old = sender.objects.get(pk=instance.pk)
    except sender.DoesNotExist:
        return

    old_logo = old.company_logo.name if old.company_logo else None
    new_logo = instance.company_logo.name if instance.company_logo else None

    if old_logo and old_logo != new_logo:
        try:
            if default_storage.exists(old_logo):
                default_storage.delete(old_logo)
        except Exception:
            pass


@receiver(post_delete, sender=Experience)
def cleanup_experience_logo_on_delete(sender, instance, **kwargs):
    """Delete company logo file when Experience is deleted."""
    if instance.company_logo and instance.company_logo.name:
        try:
            if default_storage.exists(instance.company_logo.name):
                default_storage.delete(instance.company_logo.name)
        except Exception:
            pass


@receiver([post_save, post_delete], sender=Experience)
def invalidate_experience_cache(sender, instance, **kwargs):
    """Invalidate experience cache when an Experience is created, updated, or deleted."""
    cache.delete("all_experiences")


@receiver([post_save, post_delete], sender=ExperienceRole)
def invalidate_experience_role_cache(sender, instance, **kwargs):
    """Invalidate experience cache when a Role is created, updated, or deleted."""
    cache.delete("all_experiences")


@receiver(pre_save, sender=AboutMe)
def cleanup_aboutme_on_save(sender, instance, **kwargs):
    """Handle all file cleanup when AboutMe is saved.
    Combines bio media, profile image, hero image, and resume file cleanup
    into a single DB query instead of four separate ones."""
    if not instance.pk:
        return
    try:
        old = sender.objects.get(pk=instance.pk)
    except sender.DoesNotExist:
        return

    # Delete media files removed from bio
    old_media = _extract_media_paths_from_html(old.bio)
    new_media = _extract_media_paths_from_html(instance.bio)
    removed_media = old_media - new_media
    _delete_media_paths_if_unused(removed_media, exclude_aboutme_pk=instance.pk)

    # Delete old profile image if changed
    if old.profile_img and old.profile_img != instance.profile_img:
        old.profile_img.delete(save=False)

    # Delete old hero image if changed
    if old.hero_img and old.hero_img != instance.hero_img:
        old.hero_img.delete(save=False)

    # Delete old resume file if changed
    if old.resume_file and old.resume_file != instance.resume_file:
        old.resume_file.delete(save=False)


@receiver(post_delete, sender=AboutMe)
def delete_aboutme_bio_media_on_delete(sender, instance, **kwargs):
    """Delete media files from AboutMe.bio on object delete when no longer used."""
    removed_media = _extract_media_paths_from_html(instance.bio)
    _delete_media_paths_if_unused(removed_media)
    if instance.profile_img:
        instance.profile_img.delete(save=False)
    if instance.hero_img:
        instance.hero_img.delete(save=False)
    if instance.resume_file:
        instance.resume_file.delete(save=False)


@receiver([post_save, post_delete], sender=AboutMe)
def invalidate_aboutme_cache(sender, instance, **kwargs):
    """Invalidate cache when AboutMe is updated."""
    cache.delete("about_me_singleton")


# Custom storage for shared files
def get_shared_storage():
    return FileSystemStorage(
        location=settings.SHARED_ROOT, base_url=settings.SHARED_URL
    )


class SharedFile(models.Model):
    name = models.CharField(
        max_length=255, help_text="A friendly name or description for the file."
    )
    file = models.FileField(storage=get_shared_storage)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ["-uploaded_at"]
        verbose_name = "Shared File"
        verbose_name_plural = "Shared Files"


@receiver(pre_save, sender=SharedFile)
def cleanup_sharedfile_on_save(sender, instance, **kwargs):
    """Delete old file when SharedFile file is changed."""
    if not instance.pk:
        return
    try:
        old = sender.objects.get(pk=instance.pk)
    except sender.DoesNotExist:
        return

    old_file = old.file.name if old.file else None
    new_file = instance.file.name if instance.file else None

    if old_file and old_file != new_file:
        try:
            storage = get_shared_storage()
            if storage.exists(old_file):
                storage.delete(old_file)
        except Exception:
            pass


@receiver(post_delete, sender=SharedFile)
def cleanup_sharedfile_on_delete(sender, instance, **kwargs):
    """Delete the actual file when the SharedFile model instance is deleted."""
    if instance.file and instance.file.name:
        try:
            storage = get_shared_storage()
            if storage.exists(instance.file.name):
                storage.delete(instance.file.name)
        except Exception:
            pass



