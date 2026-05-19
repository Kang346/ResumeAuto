# Phase 3 — Auto-Apply

For each job-source entry where `Agent Note` starts with `📄`: open the apply URL, let the Chrome extension auto-fill known fields, fill the rest yourself, **stop before final submit**, ask the user to confirm, then mark as `✅ Applied`.

This document is for any agent with browser control (Claude Code with Chrome MCP, computer use, browser agents).

## Prerequisites

1. **Local server running.** `python server/serve.py` (binds `127.0.0.1:8765`).
2. **Chrome extension loaded.** `chrome://extensions` → Developer mode → Load unpacked → select [extension/](../extension/).
3. **`location.line1` filled** in [user_data/personal_info.json](../user_data/personal_info.json) with the user's street address (replace any placeholder). Many ATS forms reject submissions without it.
4. Both server and extension must be running before starting auto-apply.

## What you need per job

1. [user_data/personal_info.json](../user_data/personal_info.json) — all personal data; also exposed at `http://127.0.0.1:8765/personal-info`.
2. **Agent Note** on the job-source entry — contains the PDF filename, e.g. `📄 PDF Ready | Projects: x, y | PDF: Company_xxx.pdf`.
3. **Tailored PDF** in `output/` — produced by Phase 2.
4. **Chrome extension** loaded — auto-fills known ATS fields and injects PDFs.
5. [form_rules.md](./form_rules.md) — yes/no defaults, work auth, salary, open-ended answers.

## How the extension works (no coding needed — know what it does)

- Auto-detects Workday and Greenhouse forms; fills fields automatically on page load.
- Shows a **status badge** (bottom-right) listing what was filled and what's unfilled.
- **Injects the PDF** into file upload inputs (bypasses the OS file dialog).
- For unknown ATS sites, use the popup → "Fill Page" button to try a generic fill.

You handle: navigation, unfilled fields, open-ended questions, final review.

## Step-by-step workflow (per job with `📄` in Agent Note)

1. **Check tab limit.** `curl http://127.0.0.1:8765/tabs` — if `pending_tabs >= 10`, pause and ask the user to clear some.

2. **Extract the PDF filename** from `Agent Note` (the substring after `PDF: `).

3. **Determine the submission path** from `Agent Note`:
   - Contains `Apply via: LinkedIn Easy Apply` → open the `LinkedIn URL`, use Easy Apply.
   - Otherwise → open the `Apply Link` (external ATS URL) in a new Chrome tab.

4. **Navigate to the application form.**
   - **External ATS path**: if the link goes to a job overview page, click "Apply" / "Apply Now" / "Submit Application".
   - **LinkedIn Easy Apply path**: click "Easy Apply". When prompted to upload a resume, **upload the tailored PDF** — do NOT use a saved/default LinkedIn resume. If the file picker is hard to drive, use the extension popup → select the correct PDF → "Inject PDF".
   - **Google SSO is pre-approved.** If "Sign in with Google" / "Continue with Google" is offered, click it without asking. This is true even when SSO auto-creates a new account on the ATS (Workday, Greenhouse, Lever) using the Google identity — that counts as SSO, not as account registration. The user is logged into Google, so consent screens for the standard Google SSO flow can be approved automatically.
   - **If the site requires creating a new account with email + password** (no SSO available) → STOP. Mark `🔒 SKIP: Requires account registration`. Move on.

5. **Wait 3–5 seconds** for the extension to auto-detect and fill.

6. **Read the status badge** (bottom-right) to see what was filled / unfilled. Or `curl http://127.0.0.1:8765/state` for structured data.

7. **Fill remaining unfilled fields yourself.**
   - Source: `user_data/personal_info.json` (or `http://127.0.0.1:8765/personal-info`).
   - Yes/no defaults, work auth, salary: see [form_rules.md](./form_rules.md).
   - Open-ended questions ("Why this company?"): follow [form_rules.md](./form_rules.md) §3. Search the web for company info before writing.
   - Unknown fields: make a reasonable choice, or leave blank and flag as `⚠️ UNFILLED: <field>`.

8. **Resume upload.** The extension should inject the PDF automatically. If not: extension popup → select the correct PDF → "Inject PDF".

9. **Multi-page forms** (Workday especially). After filling one page, click Next. The extension re-runs on each new page.

10. **STOP before final submit.** Take a screenshot. Wait for user confirmation. Do NOT click the final "Submit Application" button without explicit user approval.

11. **After user confirms submit.**
    - Click submit.
    - Update `Agent Note`: change `📄 PDF Ready` to `✅ Applied`.
    - Update `Status`: change `Backlog` → `Applied`. **This is the only place Status changes.**

12. **If you can't fully resolve a form**, leave the tab open, record the state in `Agent Note`, move to the next job.

## Error handling

| Symptom | Action |
|---|---|
| CAPTCHA appears | `🔒 SKIP: CAPTCHA required` |
| Form field type not recognized | Leave for user; record `⚠️ UNFILLED: [field]` |
| PDF upload fails after popup retry | `❌ FAIL: PDF upload failed` |
| Site requires account registration (no SSO) | `🔒 SKIP: Requires account registration` |
| Any other error | Record in `Agent Note`. Do NOT change `Status`. Move on. |

## Boundaries

- NEVER touch the user's `Note` field (only `Agent Note`).
- LinkedIn: read-only navigation in Phase 2 to find external apply URLs is fine. In Phase 3, Easy Apply is allowed as a submission path. NEVER message, follow, or take any other LinkedIn action.
- If pending unresolved tabs `>= 10`, pause and wait for the user to clear some.
- For open-ended questions, search the web for company info before writing — see [form_rules.md](./form_rules.md) §3.
- Process jobs one at a time, waiting for user confirmation before each submission.
