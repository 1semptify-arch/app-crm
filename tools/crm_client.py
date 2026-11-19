"""Reference PostgREST client for app-crm data (see docs/INTEGRATION.md).

Stdlib-only so any Semptify module or script can import it without adding
dependencies. Talks to the CRM's Supabase project over the documented
user-JWT path — row-level security scopes every call to the signed-in user.

Usage::

    from crm_client import CrmClient

    crm = CrmClient(supabase_url, anon_key)
    crm.sign_in("brad@example.com", "password")
    contact = crm.create_contact("Jane Doe", email="jane@example.com")
    crm.log_interaction(contact["id"], "call", notes="Left voicemail")

Environment fallback: SUPABASE_URL / SUPABASE_ANON_KEY are read from the
environment when not passed to the constructor. Never commit keys.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class CrmError(Exception):
    """Raised on any non-2xx PostgREST/auth response."""

    def __init__(self, status: int, code: str | None, message: str):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.code = code  # Postgres error code when present (e.g. "23P01")


class CrmConflictError(CrmError):
    """Appointment overlap — Postgres 23P01 from the exclusion constraint.

    `conflicts` holds the clashing appointment rows, fetched via the same
    overlap rule the DB enforces.
    """

    def __init__(self, message: str, conflicts: list[dict[str, Any]]):
        super().__init__(409, "23P01", message)
        self.conflicts = conflicts


class CrmClient:
    def __init__(self, supabase_url: str | None = None, anon_key: str | None = None):
        self.url = (supabase_url or os.environ.get("SUPABASE_URL") or "").rstrip("/")
        self.anon_key = anon_key or os.environ.get("SUPABASE_ANON_KEY") or ""
        if not self.url or not self.anon_key:
            raise ValueError("supabase_url and anon_key are required")
        self.jwt: str | None = None

    # ------------------------------------------------------------------ auth

    def sign_in(self, email: str, password: str) -> None:
        """Password grant → stores the user JWT for subsequent calls."""
        body = json.dumps({"email": email, "password": password}).encode()
        data = self._request(
            "POST",
            f"{self.url}/auth/v1/token?grant_type=password",
            body,
            auth=False,
        )
        token = data.get("access_token")
        if not token:
            raise CrmError(0, None, "auth response had no access_token")
        self.jwt = token

    def sign_out(self) -> None:
        self.jwt = None

    # ------------------------------------------------------------- contacts

    def create_contact(
        self,
        name: str,
        phone: str | None = None,
        email: str | None = None,
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        return self._insert(
            "contacts",
            {"name": name, "phone": phone, "email": email, "tags": tags or []},
        )

    def list_contacts(self) -> list[dict[str, Any]]:
        return self._get("contacts", {"select": "*", "order": "name.asc"})

    # --------------------------------------------------------- appointments

    def create_appointment(
        self,
        starts_at: str,
        ends_at: str,
        title: str | None = None,
        contact_id: str | None = None,
        status: str = "scheduled",
    ) -> dict[str, Any]:
        """Insert an appointment. Raises CrmConflictError on overlap (23P01)."""
        row = {
            "contact_id": contact_id,
            "title": title,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "status": status,
        }
        try:
            return self._insert("appointments", row)
        except CrmError as e:
            if e.code == "23P01":
                raise CrmConflictError(
                    "appointment overlaps an existing booking",
                    self.find_conflicts(starts_at, ends_at),
                ) from e
            raise

    def list_appointments(
        self, window_from: str | None = None, window_to: str | None = None
    ) -> list[dict[str, Any]]:
        """List appointments, optionally those overlapping [from, to)."""
        params: dict[str, str] = {"select": "*", "order": "starts_at.asc"}
        if window_from and window_to:
            params["starts_at"] = f"lt.{window_to}"
            params["ends_at"] = f"gt.{window_from}"
        return self._get("appointments", params)

    def find_conflicts(self, starts_at: str, ends_at: str) -> list[dict[str, Any]]:
        """Non-canceled appointments overlapping [starts_at, ends_at)."""
        return self._get(
            "appointments",
            {
                "select": "*",
                "status": "neq.canceled",
                "starts_at": f"lt.{ends_at}",
                "ends_at": f"gt.{starts_at}",
                "order": "starts_at.asc",
            },
        )

    # --------------------------------------------------------- interactions

    def log_interaction(
        self,
        contact_id: str | None,
        type: str,
        subject_outline: str | None = None,
        notes: str | None = None,
        duration_sec: int | None = None,
        outcome: str | None = None,
        occurred_at: str | None = None,
        appointment_id: str | None = None,
        plugin_data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Log a call/note/email. `type` must be call | note | email."""
        if type not in ("call", "note", "email"):
            raise ValueError("type must be 'call', 'note', or 'email'")
        row: dict[str, Any] = {
            "contact_id": contact_id,
            "appointment_id": appointment_id,
            "type": type,
            "subject_outline": subject_outline,
            "notes": notes,
            "duration_sec": duration_sec,
            "outcome": outcome,
            "plugin_data": plugin_data or {},
        }
        if occurred_at:
            row["occurred_at"] = occurred_at
        return self._insert("interactions", row)

    def list_interactions(self, contact_id: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, str] = {"select": "*", "order": "occurred_at.desc"}
        if contact_id:
            params["contact_id"] = f"eq.{contact_id}"
        return self._get("interactions", params)

    # ------------------------------------------------------------ internals

    def _get(self, table: str, params: dict[str, str]) -> Any:
        qs = urllib.parse.urlencode(params)
        return self._request("GET", f"{self.url}/rest/v1/{table}?{qs}", None)

    def _insert(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        clean = {k: v for k, v in row.items() if v is not None}
        data = self._request(
            "POST",
            f"{self.url}/rest/v1/{table}",
            json.dumps(clean).encode(),
            extra_headers={"Prefer": "return=representation"},
        )
        return data[0] if isinstance(data, list) else data

    def _request(
        self,
        method: str,
        url: str,
        body: bytes | None,
        auth: bool = True,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        headers = {
            "apikey": self.anon_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if auth:
            if not self.jwt:
                raise CrmError(0, None, "not signed in — call sign_in first")
            headers["Authorization"] = f"Bearer {self.jwt}"
        if extra_headers:
            headers.update(extra_headers)
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read() or b"null")
        except urllib.error.HTTPError as e:
            payload: dict[str, Any] = {}
            try:
                payload = json.loads(e.read() or b"{}")
            except json.JSONDecodeError:
                pass
            raise CrmError(
                e.code,
                payload.get("code"),
                payload.get("message") or payload.get("msg") or e.reason,
            ) from e


if __name__ == "__main__":
    # Smoke check: sign in, list contacts. Requires SUPABASE_URL,
    # SUPABASE_ANON_KEY, CRM_USER_EMAIL, CRM_USER_PASSWORD in env.
    client = CrmClient()
    client.sign_in(os.environ["CRM_USER_EMAIL"], os.environ["CRM_USER_PASSWORD"])
    for c in client.list_contacts():
        print(f"{c['id']}  {c['name']}  {c.get('email') or ''}")
