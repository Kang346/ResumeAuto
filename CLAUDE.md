# Resume Tailoring Agent

## What this project does
Automated resume tailoring pipeline: reads job postings from a configured source (default: Notion), selects the best 2 projects from `user_data/project_library.json`, rewrites bullets to match JD keywords, compiles a 1-page ATS-friendly PDF.

## How it runs
Claude Code is the orchestrator AND the LLM. No external API calls needed. The workflow per job:
1. Read the job source (default: Notion database — see "Notion database" below), filter `Status = "Backlog"`
2. For each job: validate (JD ≥ 50 chars, Agent Note re-run check). If `Apply Link` is empty but a `LinkedIn URL` is set, the orchestrator navigates the LinkedIn job page in the browser and tries to find the official external Apply URL (the "Apply" button that links out to Greenhouse/Workday/Lever/etc.) and writes it back to `Apply Link`. If only LinkedIn Easy Apply is available (no external URL), **still proceed to generate the PDF** — note `Apply via: LinkedIn Easy Apply` in `Agent Note` so Phase 2 knows the submission path, but do NOT skip Phase 1. Only skip Phase 1 if the post is expired (`🔒 SKIP: Job expired`).
3. Claude Code reads JD + `prompts/prompt_rules.md` + `user_data/project_library.json`, generates tailored JSON
4. Pipe JSON into: `python pipeline/run_pipeline.py --company "X" --title "Y" < response.json`
5. Update the source's `Agent Note` field with the result (never touch `Note` or `Status`)

## Key files
- `templates/example.tex` — LaTeX template with `%%% PLACEHOLDER %%%` markers. Edit the heading / education / professional experience sections to be your own; leave the project & skills placeholders alone.
- `user_data/project_library.json` — your projects with tags and LaTeX bullets (the tailoring agent picks 2 per job)
- `prompts/prompt_rules.md` — LLM instructions for project selection, bullet rewriting, skills reordering
- `pipeline/run_pipeline.py` — compile pipeline: inject → pdflatex → page check → auto-shrink → save
- `pipeline/agent.py` — original helper functions (run_pipeline.py supersedes for compilation)
- `user_data/personal_info.json` — personal data for Phase 2 form filling

## Critical rules
- **FROZEN sections**: Professional Experience, Education, Header are NEVER modified. Only Projects and Skills are dynamic.
- **One-page hard constraint**: PDF must be exactly 1 page. Auto-shrink removes last bullet per project, retries up to 3 times.
- **Bold convention**: Bold opening action phrase (`\textbf{Architected a 6-stage pipeline}`), key technical terms matching JD, and quantitative metrics.
- **Bullet length**: Each bullet fills 1 or 2 full lines (~100-110 chars/line). No dangling 3-5 word last lines.
- **Agent Note field only**: Never write to the user's `Note` field. Use `Agent Note` for all agent output.
- **Status stays Backlog**: In Phase 1, never change `Status`. Only Phase 2 (future) changes it to `Applied`.
- **Skip, don't block**: If anything fails (unresolvable Apply Link, expired post, compile error), record in Agent Note with emoji prefix (⏭️/🔒/❌) and move to next job.
- **Always generate the PDF in Phase 1**: Phase 1 is JD-driven and produces a tailored resume. The submission path (external ATS vs. LinkedIn Easy Apply) does NOT affect whether we tailor a resume — we always do, as long as the JD is readable and the post isn't expired. If only LinkedIn Easy Apply is available, generate the PDF and mark `📄 PDF Ready | ... | Apply via: LinkedIn Easy Apply | PDF: filename.pdf` so Phase 2 knows to upload via LinkedIn instead of an ATS form.
- **LinkedIn navigation is allowed for URL resolution only**: The orchestrator MAY open a LinkedIn job page in browser to read the JD and locate any external "Apply" link that points out to a company ATS (Greenhouse, Workday, Lever, Ashby, etc.). The orchestrator MUST NOT submit applications via LinkedIn Easy Apply during Phase 1 collection/tailoring, send LinkedIn messages, follow companies, or take any other LinkedIn actions. (Phase 2 may use Easy Apply as a submission path when no external link exists — see Phase 2 section.)
- **Expired posts**: If LinkedIn (or any source) shows the post has expired / been removed / "no longer accepting applications", mark `🔒 SKIP: Job expired` and move on. Do not attempt to compile a PDF for expired jobs.

## Agent Note emoji format
- `📄 PDF Ready | Projects: x, y | PDF: filename.pdf` — Phase 1 success, PDF generated, awaiting submission
- `✅ Applied | Projects: x, y | PDF: filename.pdf` — Phase 2 success, actually submitted
- `⏭️ SKIP: reason` — skipped, re-process if issue resolved
- `🔒 SKIP: reason` — blocked, requires manual resolution
- `❌ FAIL: reason` — failed, requires manual resolution

## Re-run logic
- `✅` → already applied, skip silently
- `📄` → PDF ready, skip Phase 1, proceed to Phase 2 (submit)
- `⏭️` → if issue resolved, re-process; else skip
- `🔒` or `❌` → skip (requires manual resolution)

## LLM output schema
The tailored JSON must match:
```json
{
  "selected_projects": ["project_id_1", "project_id_2"],
  "projects_latex": "...full LaTeX for both projects...",
  "skills_latex": "\\textbf{Languages}{: ...} \\\\\n     \\textbf{Frameworks \\& Tools}{: ...}",
  "reasoning": "Why these projects, what keywords injected"
}
```

## Notion database (default job source)
Configure these via environment variables (or your config file):
- `NOTION_DB_ID` — your database ID (UUID)
- `NOTION_DATA_SOURCE` — `collection://<uuid>`

Suggested field schema (use exactly these names, or adapt the prompts to your own):
- `Company Name` (title)
- `Job Title` (text)
- `Apply Link` (URL)
- `LinkedIn URL` (URL, optional)
- `Status` (select: Backlog / Applied)
- `Note` (user-only — agent must never write here)
- `Agent Note` (text — all agent output goes here)
- The full JD lives in the page body.

To bootstrap the database, run the Notion init prompt (see `prompts/job_collection.md`) or have Claude Code create the schema for you the first time.

---

## Phase 1.5: Open-ended answer drafting (drain the question queue)

While filling a Phase 2 application in the browser, the user can right-click a "Why this company?" / "Tell us about yourself" / cover-letter prompt and pick **"Ask agent to draft an answer"**. The Chrome extension queues that question to `user_data/pending_questions.json` (via `POST /queue-question`). When the user later says any of:

- "drain the question queue"
- "answer queue"
- "process pending questions"

…the agent must run the following protocol. **Do NOT call HTTP endpoints — write JSON files directly.** The extension reads via the local server, which reads the same files.

1. Read `user_data/pending_questions.json`. If empty or missing, report "queue empty" and stop.
2. For each entry `{id, question, company, job_title, page_url, target_selector, queued_at}`:
   - Find the matching job-source entry (by `company` + `job_title`). Read its JD summary if present.
   - Read `user_data/project_library.json` and pick the 2 projects most relevant to the company/role using the same rules as `prompts/prompt_rules.md`.
   - Read `user_data/personal_info.json` for work history and work-auth context.
   - Read `prompts/form_rules.md` §3 for style rules (≤150 words, first-person, casual, real personal angle, no banned phrases).
   - Draft the answer obeying every constraint in §3a.
3. Append each drafted answer to `user_data/pending_answers.json` (preserve any existing unconsumed entries; if `id` already has an entry, replace it):
   ```json
   [
     {"id": "<original id>", "answer": "<draft>", "answered_at": "<iso 8601>"}
   ]
   ```
4. Clear `user_data/pending_questions.json` (set its content to `[]`).
5. Report `N processed` with a one-line summary per draft.

The user then switches back to the ATS tab, opens the extension popup, and clicks **Fill answers in this tab** to insert the draft into the matching textarea.

---

## Phase 2: Auto-Apply (for any browser-control agent)

This section is for any agent with browser control (computer use, browser agents, etc.) that needs to submit job applications.

### Prerequisites
1. **Start local server**: `python server/serve.py` (runs on localhost:8765)
2. **Load Chrome extension**: chrome://extensions → Developer mode → Load unpacked → select `extension/` folder
3. **Fill `location.line1`** in `user_data/personal_info.json` with the user's street address (replace any placeholder). Many ATS forms reject submissions without it.
4. Both server and extension must be running before starting auto-apply

### What you need
1. **`user_data/personal_info.json`** — all personal data for form filling
2. **Agent Note** on the job-source entry — contains the PDF filename (e.g., `📄 PDF Ready | ... | PDF: Company_xxx.pdf`)
3. **PDF file** in `output/` directory — the tailored resume to upload
4. **Chrome extension** loaded — auto-fills known ATS fields and injects PDFs
5. **`prompts/form_rules.md`** — rules for yes/no questions, work auth, open-ended answers

### How the extension works (you don't need to code — just know what it does)
- The extension **auto-detects** Workday and Greenhouse forms and fills fields automatically on page load
- It shows a **status badge** (bottom-right corner) telling you what it filled and what's unfilled
- It **injects the PDF** into file upload inputs (bypassing the OS file dialog)
- For unknown ATS sites, use the extension popup "Fill Page" button to try generic fill
- You handle: navigation between pages, unfilled fields, open-ended questions, final review

### Step-by-step workflow
For each job-source entry where Agent Note starts with `📄`:

1. **Check tab limit**: `curl http://localhost:8765/tabs` — if `pending_tabs >= 10`, pause
2. **Extract PDF filename** from the Agent Note (after "PDF: ")
3. **Determine submission path** from the Agent Note:
   - If Agent Note contains `Apply via: LinkedIn Easy Apply` → open the `LinkedIn URL` and use Easy Apply (the tailored PDF still gets uploaded — LinkedIn Easy Apply accepts a custom resume)
   - Otherwise → open the `Apply Link` (external ATS URL) in a new Chrome tab

4. **Navigate to the application form**
   - **External ATS path**: If the link goes to a job overview page, find and click "Apply" / "Apply Now" / "Submit Application"
   - **LinkedIn Easy Apply path**: Click "Easy Apply" on the LinkedIn job page. When prompted to upload a resume, **upload the tailored PDF** (do NOT use a saved/default LinkedIn resume). Use the extension popup → select the correct PDF → "Inject PDF" if the file picker is hard to drive directly.
   - **Google SSO is pre-approved**: if "Sign in with Google" / "Continue with Google" is offered, click it without asking. This is true even when the SSO flow auto-creates a new account on the ATS (Workday, Greenhouse, Lever, etc.) using the Google identity — that counts as SSO, not as account registration. The user is logged into Google, so consent screens for the standard Google SSO flow can be approved automatically.
   - If the site requires creating a new account with email + password (no SSO available), STOP — mark as `🔒 SKIP: Requires account registration` and move on

5. **Wait 3-5 seconds** for the extension to auto-detect and fill
6. **Read the status badge** (bottom-right corner) to see what was filled/unfilled
   - Or check `curl http://localhost:8765/state` for structured data

7. **Fill remaining unfilled fields** yourself:
   - Use `user_data/personal_info.json` data (available at `http://localhost:8765/personal-info`)
   - Use `prompts/form_rules.md` rules for yes/no defaults, work auth, salary
   - For open-ended questions ("Why this company?"), follow the rules in `prompts/form_rules.md` section 3
   - For unknown fields, make a reasonable choice or leave blank and flag

8. **Resume upload**: The extension should inject the PDF automatically. If not:
   - Open extension popup → select the correct PDF → click "Inject PDF"

9. **Multi-page forms** (e.g., Workday): After filling one page, click Next. The extension will re-run on each new page.

10. **STOP before final submit** — take a screenshot and wait for user confirmation
    - Do NOT click the final "Submit Application" button without user approval

11. **After user confirms submit**:
    - Click submit
    - Update Agent Note: change `📄 PDF Ready` to `✅ Applied`
    - Update `Status`: change from `Backlog` to `Applied`

12. **If you can't fully resolve a form**: leave the tab open, record it, move to next job

### Error handling
- CAPTCHA appears → `🔒 SKIP: CAPTCHA required`
- Form field type not recognized → leave for user, record as `⚠️ UNFILLED: [field]`
- Upload fails → try extension popup "Inject PDF" button; if still fails → `❌ FAIL: PDF upload failed`
- Site requires account registration → `🔒 SKIP: Requires account registration`
- Any error → record in Agent Note, do NOT change `Status`, move to next job

### Important
- NEVER touch the user's `Note` field
- LinkedIn: read-only navigation is allowed during Phase 1 to locate external apply URLs. NEVER submit applications, send messages, follow, or take any other action on linkedin.com
- If pending unresolved tabs >= 10, pause and wait for user to clear some
- For open-ended questions, search the web for company info before writing (see `prompts/form_rules.md` section 3)
- Process jobs one at a time, waiting for user confirmation before each submission
