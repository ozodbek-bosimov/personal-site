# Django Blog & Portfolio

A personal blog and portfolio website built with **Django 6**, **Tailwind CSS**, **HTMX**, and **CKEditor 5**. Features a modern design, a convenient admin panel, robust security defaults, and optimized performance out of the box.

## Key Features

- **Blog System** — Write and publish articles, organize them by topics, auto-calculate reading time, and embed YouTube videos with sanitized iframes.
- **SPA-like Navigation** — Uses HTMX for seamless page transitions without full page reloads, providing a faster, app-like user experience.
- **Portfolio & Experience** — Showcase projects, work experience (displayed in a timeline format), and skills — all fully manageable from the admin panel.
- **About Me (Singleton)** — A single-instance model for managing personal info, social links, and a downloadable CV on the homepage.
- **Rich Text Editing** — CKEditor 5 integration for beautifully formatted articles and bio sections with inline images and videos.
- **Shared Files** — Upload large files, browse them, copy their public URL directly from the admin panel, and share via `/shared/` links.
- **Auto Caching** — Pages and querysets are cached in memory (LocMemCache). Caches are automatically invalidated through Django signals whenever a model changes.
- **Auto WebP & Compression** — Uploaded images are automatically compressed (preserving quality) and converted to WebP format.
- **Auto Cleanup (Signals)** — When an object is edited or deleted, its orphaned images and unused CKEditor media files are automatically removed from disk.
- **Rate Limiting & Security** — IP-based request throttling middleware to mitigate DDoS and bot abuse, plus built-in CSRF, XSS, and other attack protections.
- **Admin Session & Log Pruning** — Configurable admin session timeout and automatic (or manual) pruning of old admin action log entries.

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Backend** | Django 6.x |
| **Database** | SQLite (default — portable and easy to migrate) |
| **Frontend** | Django Templates, Tailwind CSS, HTMX |
| **Rich Text Editor** | django-ckeditor-5 |
| **Deployment** | Gunicorn, Nginx, WhiteNoise (static files) |
| **Image Processing** | Pillow (WebP conversion & resizing) |

---

## Local Development Setup

### 1. Clone the repository and install dependencies
```bash
git clone https://github.com/ozodbek-bosimov/personal-site.git
cd personal-site
python3 -m venv env
source env/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 2. Create the `.env` file
Create a `.env` file in the project root with the following contents:
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
python manage.py makemigrations
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

> **Tip:** To watch Tailwind CSS changes in real time, open a separate terminal and run: `python manage.py tailwind start`

---

## Production Deployment

### 1. Environment Variables
Copy the provided example file and adjust it for your server:
```bash
cp .env.example .env
```
Edit the variables inside to match your domain names. Security settings and rate limiting should generally be enabled in production.

### 2. Gunicorn (systemd) Service
Recommended `/etc/systemd/system/gunicorn.service` configuration:

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
Enable and start the service:
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
After making changes, verify and reload:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Deploy Checklist (Copy-Paste)

A one-liner to pull the latest changes and restart services:
```bash
cd /var/www/personal-site && \
git pull && \
source env/bin/activate && \
pip install -r requirements.txt && \
python manage.py migrate && \
python manage.py collectstatic --clear --noinput && \
sudo systemctl restart gunicorn && \
sudo systemctl reload nginx
```

---

## Useful Commands

```bash
python manage.py check --deploy          # Full security audit
python manage.py migrate                 # Apply database migrations
python manage.py collectstatic --noinput # Collect static files
sudo systemctl status gunicorn --no-pager -l
sudo journalctl -u gunicorn -n 120 --no-pager
sudo tail -n 120 /var/log/nginx/error.log
```



## Common Issues & Troubleshooting

1. **"Server Error (500)" on image/file upload, or images not displaying:**
   The Nginx/Gunicorn user (`www-data`) must have write permissions on the `media`, `shared`, `logs` directories and the `db.sqlite3` file.
   ```bash
   sudo chown -R www-data:www-data /var/www/personal-site/media /var/www/personal-site/shared /var/www/personal-site/logs
   sudo chown www-data:www-data /var/www/personal-site/db.sqlite3
   sudo chmod -R 775 /var/www/personal-site/media /var/www/personal-site/shared
   sudo chmod 664 /var/www/personal-site/db.sqlite3
   ```
2. **"413 Request Entity Too Large" when uploading large files (e.g. via Shared Files):**
   The `client_max_body_size` value in your Nginx config must be equal to or greater than Django's `DATA_UPLOAD_MAX_MEMORY_SIZE` (e.g. `20m;`). Reload Nginx after making the change.
3. **"429 Too Many Requests" (IP blocked) during heavy browsing:**
   The rate limiting middleware has kicked in to protect against DDoS and aggressive bots. Review `GLOBAL_RATE_LIMIT_ENABLED` and related settings in your `.env`. Make sure static assets are exempted by verifying that `GLOBAL_RATE_LIMIT_EXEMPT_PATH_PREFIXES` includes `/static/,/media/,/shared/`.
