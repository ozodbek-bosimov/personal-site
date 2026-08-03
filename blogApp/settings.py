import os
from pathlib import Path

from dotenv import load_dotenv

# Core Directories
BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables
_env_file_name = os.getenv("DJANGO_ENV_FILE", ".env")
load_dotenv(BASE_DIR / _env_file_name)


def _get_bool_env(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# Debug mode
DEBUG = _get_bool_env("DJANGO_DEBUG", False)

# Security: Secret Key
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "django-insecure-dummy-key-for-local-dev-only"
    else:
        from django.core.exceptions import ImproperlyConfigured

        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY environment variable must be set in production."
        )

# Asset Versioning
STATIC_ASSET_VERSION = os.getenv("APP_STATIC_ASSET_VERSION", "20260804_14")

# Allowed Hosts & CSRF
_allowed_hosts = os.getenv("DJANGO_ALLOWED_HOSTS")
if not (_allowed_hosts and _allowed_hosts.strip()):
    _allowed_hosts = "*" if DEBUG else "localhost,127.0.0.1,0.0.0.0,[::1],testserver"

ALLOWED_HOSTS = [host.strip() for host in _allowed_hosts.split(",") if host.strip()]

_csrf_trusted_origins = os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "")
CSRF_TRUSTED_ORIGINS = [
    origin.strip() for origin in _csrf_trusted_origins.split(",") if origin.strip()
]


# Applications
INSTALLED_APPS = [
    "django_ckeditor_5",
    "home.apps.HomeConfig",
    "django.contrib.sitemaps",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

# Middleware
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "blogApp.middleware.DevStaticNoCacheMiddleware",
    "blogApp.middleware.IpRateLimitMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "blogApp.middleware.AdminSessionTimeoutMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "blogApp.urls"

# Templates configuration
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "home.context_processors.used_tags",
                "home.context_processors.static_asset_version",
                "home.context_processors.about_me",
            ],
        },
    },
]

WSGI_APPLICATION = "blogApp.wsgi.application"

# Database
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

# Caching
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}

# Password Validators
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

# Internationalization
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Tashkent"
USE_I18N = False
USE_TZ = True

# Static & Media Files
STATIC_URL = "/static/"
MEDIA_URL = "/media/"
SHARED_URL = "/shared/"

MEDIA_ROOT = BASE_DIR / "media"
SHARED_ROOT = BASE_DIR / "shared"

STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"

if not DEBUG:
    STORAGES = {
        "default": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
        },
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
        },
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Production Security & Cookies
SESSION_COOKIE_SECURE = _get_bool_env("DJANGO_SESSION_COOKIE_SECURE", not DEBUG)
CSRF_COOKIE_SECURE = _get_bool_env("DJANGO_CSRF_COOKIE_SECURE", not DEBUG)
SECURE_SSL_REDIRECT = _get_bool_env("DJANGO_SECURE_SSL_REDIRECT", not DEBUG)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Rate Limiting
GLOBAL_RATE_LIMIT_ENABLED = _get_bool_env("GLOBAL_RATE_LIMIT_ENABLED", not DEBUG)
GLOBAL_RATE_LIMIT_REQUESTS = int(os.getenv("GLOBAL_RATE_LIMIT_REQUESTS", "120"))
GLOBAL_RATE_LIMIT_WINDOW_SECONDS = int(
    os.getenv("GLOBAL_RATE_LIMIT_WINDOW_SECONDS", "60")
)
GLOBAL_RATE_LIMIT_BLOCK_SECONDS = int(
    os.getenv("GLOBAL_RATE_LIMIT_BLOCK_SECONDS", "120")
)
_global_rl_exempt = os.getenv(
    "GLOBAL_RATE_LIMIT_EXEMPT_PATH_PREFIXES",
    "/_owner/,/static/,/media/,/shared/",
)
GLOBAL_RATE_LIMIT_EXEMPT_PATH_PREFIXES = [
    p.strip() for p in _global_rl_exempt.split(",") if p.strip()
]

# HTTP Headers
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_HSTS_SECONDS = (
    0 if DEBUG else int(os.getenv("DJANGO_SECURE_HSTS_SECONDS", "31536000"))
)
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG

# Admin Session & Logs
ADMIN_SESSION_TIMEOUT = int(os.getenv("ADMIN_SESSION_TIMEOUT", "1800"))
SESSION_COOKIE_AGE = 86400  # 1 day expiration
SESSION_SAVE_EVERY_REQUEST = False  # Save only when changed to prevent DB bloat

ADMIN_LOG_RETENTION_ENABLED = _get_bool_env("ADMIN_LOG_RETENTION_ENABLED", True)
ADMIN_LOG_RETENTION_DAYS = int(os.getenv("ADMIN_LOG_RETENTION_DAYS", "90"))

# Upload Limits (Max 10 MB)
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

# CKEditor 5 Configuration
CKEDITOR_5_CONFIGS = {
    "default": {
        "toolbar": [
            "heading",
            "|",
            "fontSize",
            "fontFamily",
            "fontColor",
            "fontBackgroundColor",
            "highlight",
            "-",
            "bold",
            "italic",
            "underline",
            "strikethrough",
            "subscript",
            "superscript",
            "code",
            "removeFormat",
            "-",
            "link",
            "bulletedList",
            "numberedList",
            "todoList",
            "outdent",
            "indent",
            "alignment",
            "-",
            "imageUpload",
            "insertTable",
            "mediaEmbed",
            "blockQuote",
            "codeBlock",
            "horizontalLine",
            "specialCharacters",
            "-",
            "sourceEditing",
            "|",
            "undo",
            "redo",
        ],
        "list": {"properties": {"styles": True, "startIndex": True, "reversed": True}},
        "heading": {
            "options": [
                {
                    "model": "paragraph",
                    "title": "Paragraph",
                    "class": "ck-heading_paragraph",
                },
                {
                    "model": "heading1",
                    "view": "h1",
                    "title": "Heading 1",
                    "class": "ck-heading_heading1",
                },
                {
                    "model": "heading2",
                    "view": "h2",
                    "title": "Heading 2",
                    "class": "ck-heading_heading2",
                },
                {
                    "model": "heading3",
                    "view": "h3",
                    "title": "Heading 3",
                    "class": "ck-heading_heading3",
                },
                {
                    "model": "heading4",
                    "view": "h4",
                    "title": "Heading 4",
                    "class": "ck-heading_heading4",
                },
            ]
        },
        "height": "400px",
        "width": "100%",
        "placeholder": "Write your content here...",
        "image": {
            "toolbar": [
                "imageTextAlternative",
                "imageStyle:alignLeft",
                "imageStyle:alignCenter",
                "imageStyle:alignRight",
                "toggleImageCaption",
                "linkImage",
            ],
        },
        "table": {
            "contentToolbar": [
                "tableColumn",
                "tableRow",
                "mergeTableCells",
                "tableProperties",
                "tableCellProperties",
            ]
        },
        "htmlSupport": {
            "allow": [
                {"name": "/.*/", "attributes": True, "classes": True, "styles": True}
            ]
        },
        "mediaEmbed": {"previewsInData": True},
        "link": {"addTargetToExternalLinks": True, "defaultProtocol": "https://"},
        "removePlugins": ["Markdown", "Style"],
    },
}

# CKEditor Storage & Custom CSS
CKEDITOR_5_CUSTOM_CSS = "css/ckeditor_admin_fix.css?v=18"
CKEDITOR_5_UPLOAD_FILE_TYPES = ["jpeg", "jpg", "png", "gif", "bmp", "webp", "svg"]
CKEDITOR_5_ALLOW_ALL_FILE_TYPES = False
CKEDITOR_5_FILE_STORAGE = "home.storage.CKEditor5Storage"
CKEDITOR_5_FILE_UPLOAD_PERMISSION = "staff"

# Basic File Logging
LOG_DIR = BASE_DIR / "logs"
_file_logging_enabled = _get_bool_env("DJANGO_FILE_LOGGING", False)
if _file_logging_enabled:
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
    except PermissionError:
        _file_logging_enabled = False

_log_dir_writable = os.access(LOG_DIR, os.W_OK)
if _file_logging_enabled and _log_dir_writable:
    LOGGING = {
        "version": 1,
        "disable_existing_loggers": False,
        "handlers": {
            "file": {
                "level": "ERROR",
                "class": "logging.handlers.RotatingFileHandler",
                "filename": LOG_DIR / "django.log",
                "maxBytes": 10 * 1024 * 1024,
                "backupCount": 5,
                "encoding": "utf-8",
            },
        },
        "loggers": {
            "django": {
                "handlers": ["file"],
                "level": "ERROR",
                "propagate": True,
            },
        },
    }
