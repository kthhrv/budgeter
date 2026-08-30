"""Thin Monzo API client for the FIRE tab's pot sync.

Docs: https://docs.monzo.com/ — personal-use API, OAuth2. The client must be
registered as CONFIDENTIAL at developers.monzo.com (public clients get no
refresh token, so the connection would die when the ~6h access token expires).
Two Monzo quirks worth knowing:

- After the OAuth redirect, Monzo requires the user to additionally approve
  the app inside the Monzo mobile app (Strong Customer Authentication).
  Until they do, API calls return 403 "insufficient permissions" — sync
  surfaces that as a friendly "approve in the Monzo app" message.
- Refresh tokens are single-use: every refresh returns a new pair, so the
  connection row is updated on every refresh.

Client id/secret come from MONZO_CLIENT_ID / MONZO_CLIENT_SECRET env vars
(vault-backed via envars.yml, like all secrets — add with `envars add`).
"""
import datetime
import os
from urllib.parse import urlencode

import requests
from django.utils import timezone

AUTH_BASE_URL = "https://auth.monzo.com/"
API_BASE_URL = "https://api.monzo.com"
REQUEST_TIMEOUT = 15  # seconds


class MonzoError(Exception):
    """A Monzo API problem with a message safe to show in a toast."""


def client_credentials():
    return os.environ.get("MONZO_CLIENT_ID", ""), os.environ.get("MONZO_CLIENT_SECRET", "")


def is_configured():
    client_id, client_secret = client_credentials()
    return bool(client_id and client_secret)


def authorize_url(redirect_uri, state):
    client_id, _ = client_credentials()
    query = urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "state": state,
    })
    return f"{AUTH_BASE_URL}?{query}"


def _token_request(payload):
    try:
        response = requests.post(f"{API_BASE_URL}/oauth2/token", data=payload, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as exc:
        raise MonzoError(f"Could not reach Monzo: {exc.__class__.__name__}") from exc
    if response.status_code != 200:
        raise MonzoError(f"Monzo token request failed ({response.status_code})")
    return response.json()


def exchange_code(code, redirect_uri):
    """Swap the OAuth authorization code for a token payload."""
    client_id, client_secret = client_credentials()
    return _token_request({
        "grant_type": "authorization_code",
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "code": code,
    })


def apply_token_payload(connection, payload):
    """Store a token response on the connection (refresh tokens are single-use)."""
    connection.access_token = payload["access_token"]
    connection.refresh_token = payload.get("refresh_token", connection.refresh_token)
    connection.monzo_user_id = payload.get("user_id", connection.monzo_user_id)
    expires_in = payload.get("expires_in")
    connection.token_expires_at = (
        timezone.now() + datetime.timedelta(seconds=int(expires_in)) if expires_in else None
    )
    connection.save()


def refresh_connection(connection):
    client_id, client_secret = client_credentials()
    if not connection.refresh_token:
        raise MonzoError("Monzo session expired and no refresh token is stored — reconnect (is the client confidential?)")
    payload = _token_request({
        "grant_type": "refresh_token",
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": connection.refresh_token,
    })
    apply_token_payload(connection, payload)


def _api_get(connection, path, params=None, _retried=False):
    try:
        response = requests.get(
            f"{API_BASE_URL}{path}",
            params=params,
            headers={"Authorization": f"Bearer {connection.access_token}"},
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise MonzoError(f"Could not reach Monzo: {exc.__class__.__name__}") from exc
    if response.status_code == 401 and not _retried:
        refresh_connection(connection)
        return _api_get(connection, path, params, _retried=True)
    if response.status_code == 403:
        raise MonzoError("Monzo says access isn't approved yet — open the Monzo app and approve Budgeter, then retry")
    if response.status_code != 200:
        raise MonzoError(f"Monzo API error ({response.status_code}) on {path}")
    return response.json()


def list_pots(connection):
    """Every non-deleted pot across the user's Monzo accounts.

    Returns [{id, name, balance, currency}] with balance in pounds (Monzo
    reports pence).
    """
    accounts = _api_get(connection, "/accounts").get("accounts", [])
    pots, seen = [], set()
    for account in accounts:
        if account.get("closed"):
            continue
        for pot in _api_get(connection, "/pots", {"current_account_id": account["id"]}).get("pots", []):
            if pot.get("deleted") or pot["id"] in seen:
                continue
            seen.add(pot["id"])
            pots.append({
                "id": pot["id"],
                "name": pot.get("name", ""),
                "balance": pot.get("balance", 0) / 100,
                "currency": pot.get("currency", "GBP"),
            })
    return pots
