# Resume Tailoring Agent

## What this project does

Automated resume tailoring + auto-apply pipeline. Claude Code is both the orchestrator and the LLM — no extra API keys. The pipeline reads job postings from a configured source (default: Notion), tailors a 1-page PDF per job, and (optionally) auto-fills the application form. The user confirms every submission.

## How it runs

The pipeline has four phases. Each one has a dedicated prompt file under [prompts/](./prompts/).

| Phase | What happens | Prompt |
|-------|-------------|--------|
| 1     | Collect job postings into Notion (or local file) | [prompts/job_collection.md](./prompts/job_collection.md) |
| 2     | Tailor a 1-page PDF per job | [prompts/phase2_tailor.md](./prompts/phase2_tailor.md) |
| 2.5   | Drain queued open-ended questions into drafts | [prompts/phase25_drafts.md](./prompts/phase25_drafts.md) |
| 3     | Auto-fill ATS forms via the Chrome extension | [prompts/phase3_apply.md](./prompts/phase3_apply.md) |

For one-time setup: see [prompts/resume_import.md](./prompts/resume_import.md) to import an existing PDF/DOCX resume into `user_data/` and `templates/example.tex`.

## Key files

- [templates/example.tex](./templates/example.tex) — LaTeX template; the pipeline injects content between `%%% PROJECTS_PLACEHOLDER %%%` / `%%% SKILLS_PLACEHOLDER %%%` markers.
- [user_data/project_library.json](./user_data/project_library.json) — your projects with tags + LaTeX bullets.
- [user_data/personal_info.json](./user_data/personal_info.json) — personal data for Phase 3 form filling.
- [prompts/prompt_rules.md](./prompts/prompt_rules.md) — LLM rules for tailoring (project selection, bullet rewriting).
- [prompts/form_rules.md](./prompts/form_rules.md) — rules for Phase 3 form filling (yes/no defaults, work auth, open-ended answers).
- [pipeline/run_pipeline.py](./pipeline/run_pipeline.py) — compile pipeline (inject → pdflatex → page check → auto-shrink → save).

## Cross-phase global rules

Rules that apply to every phase — the ones you'd violate if you scanned only one phase doc:

- **Status field is sacred.** Phase 1 / 2 / 2.5 must NEVER change `Status`. Only Phase 3 changes `Backlog → Applied` after the user confirms a submit.
- **Note vs. Agent Note.** `Note` is the user's column; the agent must NEVER write to it. All agent output goes into `Agent Note`.
- **Skip, don't block.** Any failure → record the result in `Agent Note` with an emoji prefix and move to the next job. Never halt the loop on a single bad job.
- **PDF gets generated even for Easy Apply.** Phase 2 always produces a tailored PDF as long as the JD is readable and the post is not expired. The submission path doesn't gate tailoring.
- **No LinkedIn writes.** Read-only navigation on linkedin.com is allowed during Phase 2 to find an external apply URL. Easy Apply is allowed in Phase 3 only as a submission path. Never message, follow, or take any other LinkedIn action.

## Agent Note emoji format

- `📄 PDF Ready | Projects: x, y | PDF: filename.pdf` — Phase 2 success, awaiting submission
- `✅ Applied | Projects: x, y | PDF: filename.pdf` — Phase 3 success, submitted
- `⏭️ SKIP: reason` — skipped, re-process if issue resolved
- `🔒 SKIP: reason` — blocked, requires manual resolution
- `❌ FAIL: reason` — failed, requires manual resolution

## Re-run logic

- `✅` → already applied, skip silently
- `📄` → PDF ready, skip Phase 2, proceed to Phase 3
- `⏭️` → if issue resolved, re-process; else skip
- `🔒` or `❌` → skip (requires manual resolution)
