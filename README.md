# Django Blog & Portfolio

A personal blog and portfolio website built with **Django 6**, **Tailwind CSS**, **HTMX**, and **CKEditor 5**. Features a modern glassmorphism design, SPA-like navigation, a rich content toolkit, and production-ready security defaults.

## Key Features

- **Blog System** — Write and publish articles organized by topics. Auto-calculated reading time, auto-generated Table of Contents (h2/h3), and sanitized YouTube/Spotify embed support with lazy loading.
- **SPA-like Navigation** — HTMX-powered page transitions with active nav state tracking for a fast, app-like browsing experience without full page reloads.
- **Portfolio & Experience** — Showcase projects and work experience (timeline format) with skills — all manageable from the admin panel.
- **About Me (Singleton)** — A single-instance model for managing personal info, social links (GitHub, LinkedIn, Telegram, LeetCode, YouTube, Instagram — each individually togglable in the footer), and a downloadable resume.
- **Clean Resume URL** — Resume is served at `/resume/` (canonical) and `/resume/<filename>` with smart fallback: invalid filenames redirect to `/resume/` instead of showing a 404. Included in `sitemap.xml` for SEO.
- **Rich Text Editing** — CKEditor 5 integration with General HTML Support (allow-all mode) for formatted articles with inline images, videos, and custom content blocks.
- **Content Toolkit** — A library of paste-able HTML blocks (callouts, tabs, checklists, quizzes, flashcards, Google Forms, ratings, Spotify embeds) for CKEditor. Blocks survive CKEditor's save/reopen cycle, render without JavaScript, and load CSS/JS only on pages that use them. See [`tools/README.md`](tools/README.md) for full documentation.
- **Admin Toolkit Picker** — A searchable insert panel above each CKEditor instance for quickly inserting content toolkit blocks. Catalog is auto-generated via `manage.py build_tools_catalog`.
- **Shared Files** — Upload files, browse them, copy their public URL from admin, and share via `/shared/` links.
- **Auto WebP & Compression** — Uploaded images (including CKEditor uploads) are automatically compressed and converted to WebP format via Pillow.
- **Auto Cleanup (Signals)** — Orphaned images, unused CKEditor media, old resume files, and shared files are automatically removed from disk when objects are edited or deleted.
- **Auto Caching** — Pages and querysets are cached in memory (LocMemCache), automatically invalidated via Django signals on model changes.
- **SEO** — Auto-generated `sitemap.xml` (static pages, blog posts, topics, resume), `robots.txt`, and proper meta tags.
- **Search** — Full-text search across blog posts with highlighted results.
- **GitHub Contributions Calendar** — Proxied GitHub contribution graph embedded on the homepage.
- **LeetCode Stats** — Proxied LeetCode statistics displayed on the homepage.
- **Rate Limiting & Security** — IP-based request throttling middleware, plus CSRF, XSS, HSTS, and clickjacking protections. Static/media/shared/resume paths are exempt from rate limiting.
- **Admin Session & Log Pruning** — Configurable admin session timeout and automatic pruning of old admin action log entries via `manage.py prune_admin_log`.
- **File Logging** — Optional rotating file logging for production error tracking.
- **Custom 404 Page** — Themed error page consistent with the site design.

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Backend** | Django 6.x |
| **Database** | SQLite (portable, easy to migrate) |
| **Frontend** | Django Templates, Tailwind CSS, HTMX |
| **Rich Text Editor** | django-ckeditor-5 |
| **Image Processing** | Pillow (WebP conversion & resizing) |
| **Deployment** | Gunicorn, Nginx, WhiteNoise (static files) |
| **Environment** | python-dotenv |

---


## Local Development Setup

### 1. Clone and install dependencies
```bash
git clone https://github.com/ozodbek-bosimov/personal-site.git
cd personal-site
python3 -m venv env
source env/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 2. Create the `.env` file
```env
DJANGO_SECRET_KEY=your-local-secret-key
DJANGO_DEBUG=true
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
DJANGO_CSRF_TRUSTED_ORIGINS=http://127.0.0.1:8000,http://localhost:8000
ADMIN_SESSION_TIMEOUT=1800
ADMIN_LOG_RETENTION_ENABLED=true
ADMIN_LOG_RETENTION_DAYS=90
DJANGO_FILE_LOGGING=false
GLOBAL_RATE_LIMIT_ENABLED=false
```

### 3. Run migrations and start the server
```bash
python manage.py migrate
python manage.py createsuperuser
python manage.py build_tools_catalog
python manage.py runserver
```

> **Tip:** To watch Tailwind CSS changes in real time, open a separate terminal and run: `python manage.py tailwind start`

---

## Management Commands

| Command | Description |
| --- | --- |
| `manage.py build_tools_catalog` | Build the content toolkit JS catalog from `tools/snippets/` |
| `manage.py build_tools_catalog --check` | Validate snippets without writing (CI-friendly) |
| `manage.py prune_admin_log` | Delete admin log entries older than `ADMIN_LOG_RETENTION_DAYS` |
| `manage.py prune_admin_log --dry-run` | Preview how many entries would be pruned |
| `manage.py migrate_media_to_postimages` | One-time migration for media directory restructuring |

---

## Production Deployment

### 1. Environment Variables
Copy the provided example file and configure it for your server:
```bash
cp .env.example .env
```
See [`.env.example`](.env.example) for all available variables with descriptions.

### 2. Gunicorn (systemd) Service
Recommended `/etc/systemd/system/gunicorn.service`:

```ini
[Unit]
Description=gunicorn daemon for personal-site
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/personal-site
Environment="PATH=/var/www/personal-site/env/bin"
Environment="DJANGO_ENV_FILE=.env"
ExecStart=/var/www/personal-site/env/bin/gunicorn --workers 1 --bind unix:/run/gunicorn/gunicorn.sock blogApp.wsgi:application
RuntimeDirectory=gunicorn
RuntimeDirectoryMode=0755
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```
Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable gunicorn
sudo systemctl start gunicorn
```

### 3. Nginx Configuration
`/etc/nginx/sites-available/personal-site`

```nginx
upstream gunicorn {
    server unix:/run/gunicorn/gunicorn.sock fail_timeout=0;
}

server {
    server_name ozodbek.me www.ozodbek.me;
    client_max_body_size 20m;

    location /static/ {
        alias /var/www/personal-site/staticfiles/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /media/ {
        alias /var/www/personal-site/media/;
        expires 7d;
    }

    location /shared/ {
        alias /var/www/personal-site/shared/;
        expires 30d;
    }

    location / {
        proxy_pass http://gunicorn;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_redirect off;
    }

    listen 443 ssl http2;
    # ssl_certificate /path/to/fullchain.pem;
    # ssl_certificate_key /path/to/privkey.pem;
}

server {
    listen 80;
    server_name ozodbek.me www.ozodbek.me;
    return 301 https://$host$request_uri;
}
```
Verify and reload:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Deploy Checklist (Copy-Paste)

Pull latest changes and restart services:
```bash
cd /var/www/personal-site && \
git pull && \
source env/bin/activate && \
pip install -r requirements.txt && \
python manage.py migrate && \
python manage.py build_tools_catalog && \
python manage.py collectstatic --clear --noinput && \
sudo systemctl restart gunicorn && \
sudo systemctl reload nginx
```

---

## Running Tests

```bash
python manage.py test
```

All 66+ tests cover: models, views, URL routing, template tags, caching, signals, sitemap, resume serving, content toolkit validation, and the catalog build command.

---

## Useful Commands

```bash
python manage.py check --deploy          # Full security audit
python manage.py migrate                 # Apply database migrations
python manage.py collectstatic --noinput # Collect static files
python manage.py build_tools_catalog     # Rebuild content toolkit catalog
python manage.py prune_admin_log         # Prune old admin logs
sudo systemctl status gunicorn --no-pager -l
sudo journalctl -u gunicorn -n 120 --no-pager
sudo tail -n 120 /var/log/nginx/error.log
```

---

## Common Issues & Troubleshooting

1. **"Server Error (500)" on image/file upload, or images not displaying:**
   The Nginx/Gunicorn user (`www-data`) must have write permissions on writable directories:
   ```bash
   sudo chown -R www-data:www-data /var/www/personal-site/media /var/www/personal-site/shared /var/www/personal-site/logs
   sudo chown www-data:www-data /var/www/personal-site/db.sqlite3
   sudo chmod -R 775 /var/www/personal-site/media /var/www/personal-site/shared
   sudo chmod 664 /var/www/personal-site/db.sqlite3
   ```
2. **"413 Request Entity Too Large" when uploading files:**
   The `client_max_body_size` in Nginx must be ≥ Django's `DATA_UPLOAD_MAX_MEMORY_SIZE` (default `20m`). Reload Nginx after changing.
3. **"429 Too Many Requests" (IP blocked):**
   Rate limiting middleware has kicked in. Review `GLOBAL_RATE_LIMIT_ENABLED` and related settings in `.env`. Ensure `GLOBAL_RATE_LIMIT_EXEMPT_PATH_PREFIXES` includes `/_owner/,/static/,/media/,/shared/,/resume/`.
4. **Content toolkit blocks not rendering:**
   Run `python manage.py build_tools_catalog` after adding or modifying snippets in `tools/snippets/`. The runtime JS and CSS are loaded conditionally — only pages with `data-tk` markers in the content will load them.
