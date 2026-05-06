#!/usr/bin/env python3
"""
Job-posting dedup keys — pure stdlib, no Notion, no network.

Computes a layered dedup key per posting so Phase 1 can skip duplicates
deterministically. Conservative on normalization: better to miss a dup
than to merge two distinct postings (e.g. "(New Grad)" vs "(Senior)").

Layers, strongest first — `dedup_key` is the first one that resolves:

    L1  ATS canonical job ID from the Apply Link URL.
        Format: <ats>:<slug>:<id>          e.g. gh:anthropic:4567890
                li:<id>                    (LinkedIn has no slug)
    L2  (company, req_id) when a req id (R-12345 / JR123456 / REQ-...)
        appears in the URL path or in the title.
        Format: <company_norm>:req:<REQ_ID_NORMALIZED>
    L3  (company_norm, title_norm, location_norm) triple. Always computed
        and also returned as `job_signature` (a parallel "human-shape"
        identity stored alongside `dedup_key`) so cross-source matches
        work even when one entry has an L1/L2 key and the other only L3.
        Format: <company>|<title>|<location>

Usage:
    python -m pipeline.dedup compute --json '{"url":"...","company":"...","title":"...","location":"..."}'
    python -m pipeline.dedup batch < jobs.json > keyed.json

`compute` prints one JSON object. `batch` reads a JSON list from stdin and
writes the same list back with the dedup fields merged into each record.
"""

import argparse
import json
import re
import sys
from typing import Optional, Tuple
from urllib.parse import parse_qs, urlparse


# ---------------------------------------------------------------- normalize --

_COMPANY_SUFFIXES = (
    ", inc.",
    ", inc",
    " inc.",
    " inc",
    ", llc",
    " llc",
    ", l.l.c.",
    ", corp.",
    ", corp",
    " corp.",
    " corp",
    ", co.",
    ", co",
    " co.",
    " co",
    ", ltd.",
    ", ltd",
    " ltd.",
    " ltd",
    ", limited",
    " limited",
)


def normalize_company(company: str) -> str:
    s = (company or "").strip().lower().rstrip(".")
    changed = True
    while changed:
        changed = False
        for suf in _COMPANY_SUFFIXES:
            if s.endswith(suf):
                s = s[: -len(suf)].rstrip(",. ")
                changed = True
                break
    return re.sub(r"\s+", " ", s).strip()


# Only abbreviations with strong industry consensus. Anything ambiguous
# (e.g. "Sr", "Jr", "Eng") is left alone — the cost of a wrong expansion
# is a missed dup, not a wrong merge.
_TITLE_EXPANSIONS = [
    (re.compile(r"\bswe\b"), "software engineer"),
    (re.compile(r"\bsde\b"), "software development engineer"),
    (re.compile(r"\bmle\b"), "machine learning engineer"),
]


def normalize_title(title: str) -> str:
    s = (title or "").strip().lower()
    s = s.replace("–", "-").replace("—", "-")  # en/em dash → hyphen
    s = s.rstrip(".")
    for pat, repl in _TITLE_EXPANSIONS:
        s = pat.sub(repl, s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


_REMOTE_US_PATTERNS = [
    re.compile(r"^remote\s*[\-,]?\s*\(?\s*us\s*\)?$", re.I),
    re.compile(r"^us\s+remote$", re.I),
    re.compile(r"^remote\s*[\-,]?\s*united\s+states$", re.I),
    re.compile(r"^united\s+states\s*[\-,]?\s*remote$", re.I),
]


def normalize_location(location: str) -> str:
    s = (location or "").strip()
    if not s:
        return ""
    for pat in _REMOTE_US_PATTERNS:
        if pat.match(s):
            return "remote-us"
    s = s.lower()
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ------------------------------------------------------------------ req id --

# Lookbehind rejects letter/digit so we don't fire mid-token (e.g. "MyR-1234"
# or "12345R-67890"), but underscore/hyphen/path separator before the prefix
# is OK — that's the common Workday URL shape `..._R-12345`.
_REQ_ID_RE = re.compile(r"(?<![A-Za-z0-9])(R|JR|REQ)[-_]?(\d{4,})\b", re.I)


def _norm_req_id(prefix: str, digits: str) -> str:
    return f"{prefix.upper()}{digits}"


def extract_req_id(*texts: str) -> Optional[str]:
    for t in texts:
        if not t:
            continue
        m = _REQ_ID_RE.search(t)
        if m:
            return _norm_req_id(m.group(1), m.group(2))
    return None


# ---------------------------------------------------------------- ATS parse --


def parse_ats(url: str) -> Optional[Tuple[str, str, str]]:
    """Return (ats, slug, job_id) for known ATSes, or None.

    For LinkedIn the slug is empty by convention.
    """
    if not url:
        return None
    try:
        u = urlparse(url.strip())
    except Exception:
        return None
    host = (u.hostname or "").lower()
    path = u.path or ""

    # Greenhouse — classic and modern hosts
    if host in ("boards.greenhouse.io", "job-boards.greenhouse.io"):
        m = re.match(r"^/([^/]+)/jobs/(\d+)", path)
        if m:
            return ("gh", m.group(1).lower(), m.group(2))
        if path.startswith("/embed/job_app"):
            q = parse_qs(u.query or "")
            slug = (q.get("for") or [""])[0]
            tok = (q.get("token") or [""])[0]
            if slug and tok:
                return ("gh", slug.lower(), tok)

    if host == "jobs.lever.co":
        m = re.match(r"^/([^/]+)/([0-9a-fA-F-]{8,})", path)
        if m:
            return ("lever", m.group(1).lower(), m.group(2).lower())

    if host == "jobs.ashbyhq.com":
        m = re.match(r"^/([^/]+)/([0-9a-fA-F-]{8,})", path)
        if m:
            return ("ashby", m.group(1).lower(), m.group(2).lower())

    # Workday — tenant.wd{N}.myworkdayjobs.com, req id at end of path segment
    if re.search(r"\.wd\d+\.myworkdayjobs\.com$", host):
        tenant = host.split(".", 1)[0]
        m = re.search(r"_((?:R|JR|REQ)[-_]?\d{4,})(?=/|$|\?)", path, re.I)
        if m:
            mm = re.match(r"^(R|JR|REQ)[-_]?(\d+)$", m.group(1), re.I)
            req_norm = _norm_req_id(mm.group(1), mm.group(2)) if mm else m.group(1).upper()
            return ("wd", tenant.lower(), req_norm)

    if host.endswith("linkedin.com"):
        m = re.search(r"/jobs/view/(\d+)", path)
        if m:
            return ("li", "", m.group(1))

    return None


def _format_l1(ats: str, slug: str, job_id: str) -> str:
    if ats == "li":
        return f"li:{job_id}"
    return f"{ats}:{slug}:{job_id}"


# ----------------------------------------------------------------- compute --


def compute_keys(url: str, company: str, title: str, location: str) -> dict:
    company_norm = normalize_company(company)
    title_norm = normalize_title(title)
    location_norm = normalize_location(location)

    parsed = parse_ats(url)
    ats = parsed[0] if parsed else None
    ats_slug = parsed[1] if parsed else None
    ats_job_id = parsed[2] if parsed else None

    req_id = extract_req_id(url or "", title or "")
    # Workday encodes the req id directly as the job id — adopt it if we
    # didn't pick one up from the title.
    if ats == "wd" and ats_job_id and not req_id:
        req_id = ats_job_id

    l1 = _format_l1(ats, ats_slug or "", ats_job_id) if parsed else None
    l2 = f"{company_norm}:req:{req_id}" if (company_norm and req_id) else None
    l3 = f"{company_norm}|{title_norm}|{location_norm}"

    return {
        "company_norm": company_norm,
        "title_norm": title_norm,
        "location_norm": location_norm,
        "ats": ats,
        "ats_job_id": ats_job_id,
        "req_id": req_id,
        "dedup_key": l1 or l2 or l3,
        "job_signature": l3,
    }


# --------------------------------------------------------------------- CLI --


def _record_from(rec: dict) -> dict:
    return compute_keys(
        url=rec.get("url", ""),
        company=rec.get("company", ""),
        title=rec.get("title", ""),
        location=rec.get("location", ""),
    )


def _cli(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="pipeline.dedup",
        description="Compute job-posting dedup keys.",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_compute = sub.add_parser("compute", help="Compute keys for one record (--json '{...}')")
    p_compute.add_argument("--json", required=True, help='Single record JSON: {"url":..., "company":..., "title":..., "location":...}')

    sub.add_parser("batch", help="Read a JSON list from stdin, write enriched list to stdout.")

    args = parser.parse_args(argv)

    if args.cmd == "compute":
        try:
            rec = json.loads(args.json)
        except json.JSONDecodeError as e:
            print(f"invalid --json: {e}", file=sys.stderr)
            return 2
        json.dump(_record_from(rec), sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    if args.cmd == "batch":
        try:
            recs = json.load(sys.stdin)
        except json.JSONDecodeError as e:
            print(f"invalid stdin JSON: {e}", file=sys.stderr)
            return 2
        if not isinstance(recs, list):
            print("batch expects a JSON list on stdin", file=sys.stderr)
            return 2
        out = [{**r, **_record_from(r)} for r in recs]
        json.dump(out, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(_cli())
