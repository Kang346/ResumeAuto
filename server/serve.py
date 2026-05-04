#!/usr/bin/env python3
"""
Local HTTP server for the AutoResume Chrome extension.
Serves personal info, form rules, PDFs, and shared state.

Usage:
    python server/serve.py              # default port 8765
    python server/serve.py --port 9000  # custom port
"""

import json
import os
import re
import sys
import time
import argparse
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse, unquote

BASE_DIR = Path(__file__).parent.parent
USER_DATA_DIR = BASE_DIR / "user_data"
PERSONAL_INFO_PATH = USER_DATA_DIR / "personal_info.json"
FORM_RULES_PATH = BASE_DIR / "prompts" / "form_rules.md"
OUTPUT_DIR = BASE_DIR / "output"
STATE_PATH = USER_DATA_DIR / "autofill_state.json"
TABS_PATH = USER_DATA_DIR / "tab_tracker.json"
PENDING_JOBS_PATH = USER_DATA_DIR / "pending_jobs.json"
PENDING_QUESTIONS_PATH = USER_DATA_DIR / "pending_questions.json"
PENDING_ANSWERS_PATH = USER_DATA_DIR / "pending_answers.json"

USER_DATA_DIR.mkdir(exist_ok=True)

state_lock = Lock()
tabs_lock = Lock()
jobs_lock = Lock()
questions_lock = Lock()
answers_lock = Lock()

DEFAULT_TABS = {"max_tabs": 10, "pending_tabs": [], "completed_tabs": []}


def parse_form_rules(path: Path) -> dict:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")

    rules = {
        "yes_no_defaults": {},
        "work_auth": {},
        "location_logistics": {},
        "numeric": {},
        "never_fill": [],
        "stop_fields": [],
    }

    section = None
    for line in text.splitlines():
        line = line.strip()
        if "Yes/No" in line or "Compliance" in line:
            section = "yes_no"
        elif "Work Authorization" in line:
            section = "work_auth"
        elif "Location" in line and "Logistics" in line:
            section = "location"
        elif "Numeric" in line or "Date Fields" in line:
            section = "numeric"
        elif "Never Fill" in line or "Always Skip" in line:
            section = "never_fill"

        if line.startswith("|") and "---" not in line and "Question" not in line and "Answer" not in line:
            parts = [p.strip() for p in line.split("|") if p.strip()]
            if len(parts) >= 2:
                question = parts[0].lower()
                answer = parts[1]
                if section == "yes_no":
                    rules["yes_no_defaults"][question] = answer
                elif section == "work_auth":
                    rules["work_auth"][question] = answer
                elif section == "location":
                    rules["location_logistics"][question] = answer

        if section == "numeric" and line.startswith("- **"):
            match = re.match(r"- \*\*(.+?)\*\*:\s*(.+)", line)
            if match:
                key = match.group(1).lower().strip()
                val = match.group(2).strip().rstrip(".")
                rules["numeric"][key] = val

        if section == "never_fill" and line.startswith("- "):
            field = line.lstrip("- ").split("→")[0].split("/")[0].strip().lower()
            if "stop" in line.lower() or "review" in line.lower():
                rules["stop_fields"].append(field)
            else:
                rules["never_fill"].append(field)

    return rules


def read_json_file(path: Path, default=None):
    if not path.exists():
        return default if default is not None else {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default if default is not None else {}


def write_json_file(path: Path, data, lock: Lock):
    with lock:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


class Handler(BaseHTTPRequestHandler):
    form_rules_cache = None

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path, content_type: str):
        if not path.exists():
            self.send_json({"error": "not found"}, 404)
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/status":
            self.send_json({"ok": True, "version": "1.0.0"})

        elif path == "/personal-info":
            self.send_json(read_json_file(PERSONAL_INFO_PATH))

        elif path == "/form-rules":
            if Handler.form_rules_cache is None:
                Handler.form_rules_cache = parse_form_rules(FORM_RULES_PATH)
            self.send_json(Handler.form_rules_cache)

        elif path == "/pdf-list":
            pdfs = []
            if OUTPUT_DIR.exists():
                pdfs = sorted(
                    [f.name for f in OUTPUT_DIR.iterdir() if f.suffix == ".pdf"],
                    key=lambda n: os.path.getmtime(OUTPUT_DIR / n),
                    reverse=True,
                )
            self.send_json({"pdfs": pdfs})

        elif path.startswith("/pdf/"):
            filename = unquote(path[5:])
            if ".." in filename or "/" in filename:
                self.send_json({"error": "invalid filename"}, 400)
                return
            self.send_file(OUTPUT_DIR / filename, "application/pdf")

        elif path == "/state":
            self.send_json(read_json_file(STATE_PATH, {}))

        elif path == "/tabs":
            self.send_json(read_json_file(TABS_PATH, DEFAULT_TABS))

        elif path == "/pending-jobs":
            self.send_json({"jobs": read_json_file(PENDING_JOBS_PATH, [])})

        elif path == "/pending-questions":
            self.send_json({"questions": read_json_file(PENDING_QUESTIONS_PATH, [])})

        elif path == "/pending-answers":
            self.send_json({"answers": read_json_file(PENDING_ANSWERS_PATH, [])})

        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = json.loads(self.read_body())
        except (json.JSONDecodeError, ValueError):
            self.send_json({"error": "invalid JSON"}, 400)
            return

        if path == "/state":
            write_json_file(STATE_PATH, body, state_lock)
            self.send_json({"ok": True})

        elif path == "/tabs":
            write_json_file(TABS_PATH, body, tabs_lock)
            self.send_json({"ok": True})

        elif path == "/save-job":
            url = (body.get("url") or "").strip()
            title = (body.get("title") or "").strip()
            if not url:
                self.send_json({"error": "url required"}, 400)
                return
            with jobs_lock:
                jobs = read_json_file(PENDING_JOBS_PATH, [])
                if not isinstance(jobs, list):
                    jobs = []
                if not any(j.get("url") == url for j in jobs):
                    jobs.append({
                        "url": url,
                        "title": title,
                        "saved_at": datetime.now(timezone.utc).isoformat(),
                    })
                    PENDING_JOBS_PATH.write_text(
                        json.dumps(jobs, indent=2, ensure_ascii=False),
                        encoding="utf-8",
                    )
                count = len(jobs)
            self.send_json({"ok": True, "count": count})

        elif path == "/queue-question":
            question = (body.get("question") or "").strip()
            if not question:
                self.send_json({"error": "question required"}, 400)
                return
            entry = {
                "id": str(time.time_ns()),
                "question": question,
                "company": (body.get("company") or "").strip(),
                "job_title": (body.get("job_title") or "").strip(),
                "page_url": (body.get("page_url") or "").strip(),
                "target_selector": (body.get("target_selector") or "").strip(),
                "queued_at": datetime.now(timezone.utc).isoformat(),
            }
            with questions_lock:
                questions = read_json_file(PENDING_QUESTIONS_PATH, [])
                if not isinstance(questions, list):
                    questions = []
                questions.append(entry)
                PENDING_QUESTIONS_PATH.write_text(
                    json.dumps(questions, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
                count = len(questions)
            self.send_json({"ok": True, "id": entry["id"], "count": count})

        elif path == "/answer-question":
            qid = (body.get("id") or "").strip()
            answer = body.get("answer")
            if not qid or answer is None:
                self.send_json({"error": "id and answer required"}, 400)
                return
            answer_entry = {
                "id": qid,
                "answer": answer,
                "answered_at": datetime.now(timezone.utc).isoformat(),
            }
            with answers_lock:
                answers = read_json_file(PENDING_ANSWERS_PATH, [])
                if not isinstance(answers, list):
                    answers = []
                answers = [a for a in answers if a.get("id") != qid]
                answers.append(answer_entry)
                PENDING_ANSWERS_PATH.write_text(
                    json.dumps(answers, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
            with questions_lock:
                questions = read_json_file(PENDING_QUESTIONS_PATH, [])
                if not isinstance(questions, list):
                    questions = []
                questions = [q for q in questions if q.get("id") != qid]
                PENDING_QUESTIONS_PATH.write_text(
                    json.dumps(questions, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
            self.send_json({"ok": True})

        elif path == "/consume-answer":
            qid = (body.get("id") or "").strip()
            if not qid:
                self.send_json({"error": "id required"}, 400)
                return
            with answers_lock:
                answers = read_json_file(PENDING_ANSWERS_PATH, [])
                if not isinstance(answers, list):
                    answers = []
                answers = [a for a in answers if a.get("id") != qid]
                PENDING_ANSWERS_PATH.write_text(
                    json.dumps(answers, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
            self.send_json({"ok": True})

        elif path == "/clear-pending-jobs":
            urls = body.get("urls") or []
            if not isinstance(urls, list):
                self.send_json({"error": "urls must be a list"}, 400)
                return
            remove = set(urls)
            with jobs_lock:
                jobs = read_json_file(PENDING_JOBS_PATH, [])
                if not isinstance(jobs, list):
                    jobs = []
                jobs = [j for j in jobs if j.get("url") not in remove]
                PENDING_JOBS_PATH.write_text(
                    json.dumps(jobs, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
                count = len(jobs)
            self.send_json({"ok": True, "count": count})

        else:
            self.send_json({"error": "not found"}, 404)

    def log_message(self, format, *args):
        print(f"[server] {args[0]}")


def main():
    parser = argparse.ArgumentParser(description="AutoResume local server")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    server = HTTPServer(("127.0.0.1", args.port), Handler)
    print(f"AutoResume server running on http://127.0.0.1:{args.port}")
    print(f"  Base dir: {BASE_DIR}")
    print(f"  PDFs:     {OUTPUT_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
