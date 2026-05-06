# Backfill Dedup Keys (one-shot)

This is a **one-time** procedure to populate the `Dedup Key` field on every existing Notion page so that Phase 1's dedup index ([prompts/job_collection.md](./job_collection.md), step 0.5) is non-empty on day one.

The user invokes this by saying something like *"backfill the dedup keys"*. After it has run successfully once, do not run it again unless the dedup logic in [pipeline/dedup.py](../pipeline/dedup.py) changes.

---

## Prerequisites

1. The Notion database has BOTH a `Dedup Key` text property AND a `Job Signature` text property. If either is missing, ask the user to add it (Notion UI → properties → add text property with the exact name) before continuing.
2. `pipeline/dedup.py` is present and `python -m unittest pipeline.test_dedup` passes.

---

## Step 1 — Export

Pull every page from the Notion database (the one configured by `NOTION_DB_ID` / `NOTION_DATA_SOURCE`). For each page, capture:

- `page_id` (Notion page ID — needed for the write-back)
- `url` ← the `Apply Link` property
- `company` ← the `Company Name` title
- `title` ← the `Job Title` property
- `location` ← the `Base` property
- `existing_dedup_key` ← the current `Dedup Key` (likely empty)
- `existing_job_signature` ← the current `Job Signature` (likely empty)

Write these as a JSON list to a temp file `work/dedup_export.json`:

```json
[
  {"page_id": "...", "url": "...", "company": "...", "title": "...", "location": "...", "existing_dedup_key": "", "existing_job_signature": ""},
  ...
]
```

Do **not** skip pages with an empty `Apply Link` — they'll fall through to the L3 (company/title/location) key, which is still useful.

---

## Step 2 — Compute keys

Run the dedup helper in batch mode:

```
python -m pipeline.dedup batch < work/dedup_export.json > work/dedup_keyed.json
```

Each record in `dedup_keyed.json` is the original record with `dedup_key`, `job_signature`, and the normalized fields appended.

---

## Step 3 — Detect collisions (do not auto-merge)

Before writing anything back, scan `dedup_keyed.json` for collisions:

- Group records by `dedup_key`. Any group of size ≥ 2 is a **strong collision** — same job already in the DB twice.
- Group records by `job_signature`. Any group of size ≥ 2 that isn't already a strong collision is a **weak collision** — different ATS IDs but the same (company, title, location) triple. Often a re-posting.

Report both lists in the round summary, **page IDs and titles only** — do NOT delete or merge automatically. Resolution is the user's call.

---

## Step 4 — Write back

For every record in `dedup_keyed.json`, update its Notion page so that:

- `Dedup Key` ← computed `dedup_key`
- `Job Signature` ← computed `job_signature`

Skip the write for a property **only** if its current value already equals the computed one (no-op). It's fine to update just one property if the other is already correct.

Process pages one at a time so a partial failure doesn't corrupt the rest. If a write fails, log the page ID + reason and continue.

---

## Step 5 — Final report

Print:

- Total pages processed
- Total `Dedup Key` values written (vs. skipped no-ops)
- Total `Job Signature` values written (vs. skipped no-ops)
- Strong-collision groups (with page IDs + titles)
- Weak-collision groups (with page IDs + titles)
- Any write failures

Do not change `Status`, `Note`, or `Agent Note` — same global rule as every other phase ([CLAUDE.md](../CLAUDE.md) → "Cross-phase global rules").
