"""Create (or reuse) a test user and mint a real DB-backed session, printing the
session key. Used only by the Playwright E2E harness to authenticate without the
Google OAuth round-trip — the API uses session auth (`django_auth`), and the
email whitelist only gates OAuth signup, not session auth.

Run from the backend/ directory:
    DEBUG=true APP_ENV=local uv run python e2e_seed_session.py
"""
import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "budgeter.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.contrib.sessions.backends.db import SessionStore  # noqa: E402

User = get_user_model()

user, _ = User.objects.get_or_create(
    username="e2e-tester",
    defaults={"email": "e2e@example.com", "is_active": True},
)

# Mint a session the running server will accept (same SQLite session store).
session = SessionStore()
session["_auth_user_id"] = str(user.pk)
session["_auth_user_backend"] = "django.contrib.auth.backends.ModelBackend"
session["_auth_user_hash"] = user.get_session_auth_hash()
session.create()

print(session.session_key)
