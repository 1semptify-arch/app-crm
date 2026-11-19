#!/usr/bin/env python3
"""inbox_endpoint.py — inbound-mail JSON endpoint for the app-crm "smart
brain" email plugin (src/services/smartBrainEmail.ts).

A tiny stdlib-only HTTP service that other tools (case-side email
monitors, triage scripts, smart-brain pipelines) can POST inbound mail
to, and that the CRM pulls from via VITE_CRM_INBOUND_MAIL_URL.

    POST /messages   {"from": "Jane <jane@x.com>", "subject": "...", "body": "...",
                      "date": "<ISO>", "id": "<stable-dedupe-key>"}
                     — accepts one object or an array; id defaults to a uuid,
                       date defaults to now. Duplicated ids are skipped.
    GET  /inbox      → JSON array  [{id, from, subject, body, date}, ...]
    GET  /health     → {"ok": true, "count": N}

Messages persist to a JSONL file (default ./inbox_messages.jsonl).

Auth: set INBOX_TOKEN to require `Authorization: Bearer <token>` (or
?token=) on every route. Unset = open (fine for loopback-only use).
CORS is open so the PWA can fetch the feed from any origin.

    python tools/inbox_endpoint.py --port 8788
    # app side: VITE_CRM_INBOUND_MAIL_URL=http://localhost:8788/inbox
"""
import argparse
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

STORE_LOCK = threading.Lock()


def load_messages(path):
    if not os.path.exists(path):
        return []
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out


def append_messages(path, msgs):
    existing = {m.get("id") for m in load_messages(path)}
    added = 0
    with STORE_LOCK, open(path, "a", encoding="utf-8") as f:
        for m in msgs:
            if m["id"] in existing:
                continue
            f.write(json.dumps(m, ensure_ascii=False) + "\n")
            existing.add(m["id"])
            added += 1
    return added


def normalize(raw):
    if not isinstance(raw, dict) or not raw.get("from"):
        return None
    return {
        "id": str(raw.get("id") or uuid.uuid4()),
        "from": str(raw["from"]),
        "subject": str(raw.get("subject") or ""),
        "body": str(raw.get("body") or ""),
        "date": str(raw.get("date") or datetime.now(timezone.utc).isoformat()),
    }


class Handler(BaseHTTPRequestHandler):
    store_path = "inbox_messages.jsonl"
    token = None

    def log_message(self, fmt, *args):  # keep stdout clean
        pass

    def _authorized(self):
        if not self.token:
            return True
        q = parse_qs(urlparse(self.path).query)
        return self.headers.get("Authorization") == f"Bearer {self.token}" or \
            (q.get("token") or [None])[0] == self.token

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if not self._authorized():
            return self._json(401, {"error": "unauthorized"})
        path = urlparse(self.path).path.rstrip("/")
        if path == "/health":
            return self._json(200, {"ok": True, "count": len(load_messages(self.store_path))})
        if path in ("/inbox", "/inbox.json", ""):
            return self._json(200, load_messages(self.store_path))
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._authorized():
            return self._json(401, {"error": "unauthorized"})
        path = urlparse(self.path).path.rstrip("/")
        if path != "/messages":
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = json.loads(self.rfile.read(n) or b"null")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "invalid JSON body"})
        items = raw if isinstance(raw, list) else [raw]
        msgs = [m for m in (normalize(i) for i in items) if m]
        if not msgs:
            return self._json(422, {"error": "no valid messages — 'from' is required"})
        added = append_messages(self.store_path, msgs)
        self._json(200, {"accepted": len(msgs), "added": added})


def main():
    ap = argparse.ArgumentParser(description="Inbound-mail JSON endpoint for app-crm")
    ap.add_argument("--port", type=int, default=8788)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--file", default="inbox_messages.jsonl", help="JSONL store path")
    ap.add_argument("--token", default=os.environ.get("INBOX_TOKEN"),
                    help="Bearer token required on all routes (env INBOX_TOKEN)")
    args = ap.parse_args()
    Handler.store_path = args.file
    Handler.token = args.token
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"inbox endpoint on http://{args.host}:{args.port} — feed at /inbox")
    srv.serve_forever()


if __name__ == "__main__":
    main()
