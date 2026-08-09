import ipaddress
import time
from datetime import timedelta

from django.conf import settings
from django.contrib.admin.models import LogEntry
from django.core.cache import cache
from django.http import HttpResponse
from django.utils import timezone


class DevStaticNoCacheMiddleware:
    """Prevent stale browser cache for static/media files in local development."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if getattr(settings, "DEBUG", False) and request.path.startswith(
            ("/static/", "/media/", "/shared/")
        ):
            response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response["Pragma"] = "no-cache"
            response["Expires"] = "0"

        return response


class IpRateLimitMiddleware:
    """Simple global IP rate limit middleware backed by Django cache."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not getattr(settings, "GLOBAL_RATE_LIMIT_ENABLED", False):
            return self.get_response(request)

        if self._is_exempt_path(request.path):
            return self.get_response(request)

        ip = self._get_client_ip(request)
        if not ip:
            return self.get_response(request)

        max_requests = max(int(getattr(settings, "GLOBAL_RATE_LIMIT_REQUESTS", 120)), 1)
        window_seconds = max(
            int(getattr(settings, "GLOBAL_RATE_LIMIT_WINDOW_SECONDS", 60)), 1
        )
        block_seconds = max(
            int(getattr(settings, "GLOBAL_RATE_LIMIT_BLOCK_SECONDS", 120)), 1
        )

        blocked_key = f"global_rl:block:{ip}"
        blocked_until = cache.get(blocked_key)
        now_ts = int(time.time())
        if blocked_until and now_ts < int(blocked_until):
            retry_after = max(int(blocked_until) - now_ts, 1)
            response = HttpResponse(
                "Too many requests. Please try again later.",
                status=429,
                content_type="text/plain",
            )
            response["Retry-After"] = str(retry_after)
            return response

        window_key = f"global_rl:window:{ip}"
        try:
            req_count = cache.incr(window_key)
        except ValueError:
            cache.set(window_key, 1, timeout=window_seconds)
            req_count = 1

        if req_count > max_requests:
            blocked_until = now_ts + block_seconds
            cache.set(blocked_key, blocked_until, timeout=block_seconds)
            response = HttpResponse(
                "Too many requests. Please try again later.",
                status=429,
                content_type="text/plain",
            )
            response["Retry-After"] = str(block_seconds)
            return response

        return self.get_response(request)

    @staticmethod
    def _is_exempt_path(path):
        exempt_prefixes = getattr(
            settings,
            "GLOBAL_RATE_LIMIT_EXEMPT_PATH_PREFIXES",
            ["/_owner/", "/static/", "/media/"],
        )
        return any(path.startswith(prefix) for prefix in exempt_prefixes)

    @staticmethod
    def _get_client_ip(request):
        forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded_for:
            ip = forwarded_for.split(",")[0].strip()
        else:
            ip = request.META.get("REMOTE_ADDR", "").strip()

        if not ip:
            return ""

        try:
            ipaddress.ip_address(ip)
            return ip
        except ValueError:
            return ""


class AdminSessionTimeoutMiddleware:
    CLEANUP_LAST_RUN_CACHE_KEY = "admin_log_cleanup:last_run_ts"
    CLEANUP_LOCK_CACHE_KEY = "admin_log_cleanup:lock"
    CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60  # Log cleanup daily
    SESSION_CLEANUP_INTERVAL_SECONDS = (
        60 * 24 * 60 * 60
    )  # Session cleanup every 60 days
    SESSION_CLEANUP_LAST_RUN_KEY = "session_cleanup:last_run_ts"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/_owner/") and request.user.is_authenticated:
            request.session.set_expiry(settings.ADMIN_SESSION_TIMEOUT)
            self._cleanup_admin_log_if_needed()
            self._cleanup_sessions_if_needed()
        return self.get_response(request)

    def _cleanup_sessions_if_needed(self):
        """Automatically run clearsessions every 60 days."""
        now_ts = timezone.now().timestamp()
        last_run_ts = cache.get(self.SESSION_CLEANUP_LAST_RUN_KEY)

        if (
            last_run_ts
            and now_ts - float(last_run_ts) < self.SESSION_CLEANUP_INTERVAL_SECONDS
        ):
            return

        # Double check lock is not needed for a light operation like session cleanup
        # but we use a simple flag to avoid multiple runs in same process.
        from django.core.management import call_command

        try:
            call_command("clearsessions")
            cache.set(self.SESSION_CLEANUP_LAST_RUN_KEY, now_ts, timeout=None)
        except Exception:
            # Silent fail to not interrupt admin experience
            pass

    def _cleanup_admin_log_if_needed(self):
        if not getattr(settings, "ADMIN_LOG_RETENTION_ENABLED", True):
            return

        retention_days = max(int(getattr(settings, "ADMIN_LOG_RETENTION_DAYS", 90)), 1)
        now_ts = timezone.now().timestamp()
        last_run_ts = cache.get(self.CLEANUP_LAST_RUN_CACHE_KEY)
        if last_run_ts and now_ts - float(last_run_ts) < self.CLEANUP_INTERVAL_SECONDS:
            return

        # Use a short lock to avoid duplicate cleanup across concurrent requests.
        if not cache.add(self.CLEANUP_LOCK_CACHE_KEY, "1", timeout=60):
            return

        try:
            cutoff = timezone.now() - timedelta(days=retention_days)
            LogEntry.objects.filter(action_time__lt=cutoff).delete()
            cache.set(
                self.CLEANUP_LAST_RUN_CACHE_KEY,
                now_ts,
                timeout=self.CLEANUP_INTERVAL_SECONDS,
            )
        finally:
            cache.delete(self.CLEANUP_LOCK_CACHE_KEY)
