# ResumeAuto

Automated resume tailoring + auto-apply pipeline for software-engineering job hunts. Driven by [Claude Code](https://docs.claude.com/en/docs/claude-code) as both the orchestrator and the LLM — no extra API keys to wire up.

## What it does

Three-phase workflow, with you in the loop at each handoff:

1. **Collect** — Claude Code searches LinkedIn / Greenhouse / Indeed for fresh postings that match your profile and writes qualifying jobs to a Notion database.
2. **Tailor** — For each job, Claude Code reads the JD, picks the best 2 projects from your library, rewrites bullets to match the JD keywords, and compiles a 1-page ATS-friendly PDF.
3. **Apply** — A Chrome extension auto-fills Workday / Greenhouse / Lever / Ashby forms and uploads the tailored PDF; Claude Code drives multi-page forms and drafts open-ended answers ("Why this company?", cover letters).

You confirm every submission. The pipeline stops before clicking final Submit.

## Requirements

- Python 3.9+
- A LaTeX distribution — [MiKTeX](https://miktex.org/) on Windows, [TeX Live](https://www.tug.org/texlive/) on Linux/macOS
- Chrome (for the Phase 2 extension)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed
- *(Optional)* Notion + an integration token, if you want to use Notion as the job source

## Quickstart

```bash
# 1. Clone and install Python deps
git clone <this-repo>
cd ResumeAuto
pip install -r requirements.txt

# 2. Import your existing resume (PDF or DOCX) — populates user_data/ +
#    templates/example.tex in one shot. Open Claude Code in the project
#    directory and ask:
#       "import my resume from ~/Downloads/my_resume.pdf"
#    See prompts/resume_import.md for the full flow.
#    (Or skip the import and copy from examples/ manually:
#       cp examples/personal_info.example.json   user_data/personal_info.json
#       cp examples/project_library.example.json user_data/project_library.json
#     then edit both files and templates/example.tex by hand.)

# 3. Start the local server (the Chrome extension talks to it)
python server/serve.py

# 4. In a second terminal, load the Chrome extension:
#    chrome://extensions → Developer mode → Load unpacked → select ./extension

# 5. Open Claude Code in the project directory. It auto-loads CLAUDE.md and
#    is ready to orchestrate. Try:
#       "tailor my resume for this job: <paste JD>"
```

## Project layout

```
ResumeAuto/
├── CLAUDE.md           # Orchestration spec — Claude Code auto-loads this
├── README.md           # You are here
├── pipeline/           # Resume compile pipeline (Python)
│   ├── run_pipeline.py # JSON in → 1-page PDF out
│   └── agent.py        # Helper functions for the orchestrator
├── templates/
│   └── example.tex     # LaTeX template with %%% PLACEHOLDER %%% markers
├── prompts/            # LLM instructions and agent prompts
│   ├── prompt_rules.md   # Rules for the resume-tailoring step
│   ├── form_rules.md     # Rules for Phase 2 form filling
│   └── job_collection.md # Prompt for the Phase 0 job-discovery agent
├── server/             # Local HTTP bridge between agent and Chrome extension
├── extension/          # Chrome extension (Phase 2 auto-fill)
├── examples/           # Reference templates — copy from here into user_data/
└── user_data/          # YOUR data — gitignored, never committed
```

## Configuring `user_data/`

`user_data/` is gitignored. Anything in there stays local — `git status` will not show it, and `git add .` will not pick it up.

Two files you maintain:

- **`user_data/personal_info.json`** — name, contact info, education, work history, work-authorization defaults. Read by the local server and used for Phase 2 form filling.
- **`user_data/project_library.json`** — your projects with `tags`, a one-line `summary`, and LaTeX-formatted `bullets`. The agent picks 2 projects per job based on tag overlap with the JD. Keep at least 3–5 projects so there's selection room.

Easiest path: run the resume import flow (Quickstart step 2). It populates both files and updates the template heading / Education / Experience sections from your existing PDF or DOCX.

Manual path: copy from `examples/`, then edit. Both example files have a `_instructions` field at the top with a quick guide.

The pipeline's runtime state files (`pending_jobs.json`, `pending_questions.json`, `pending_answers.json`, `autofill_state.json`, `tab_tracker.json`) also live in `user_data/`. The server creates them on first write — you don't need to seed them.

## Configuring the resume template

Edit `templates/example.tex`:

- Replace the **heading** (name, phone, email, LinkedIn, GitHub).
- Replace the **Education** section.
- Replace the **Professional Experience** section.
- **Do not touch** the `%%% PROJECTS_PLACEHOLDER_START/END %%%` and `%%% SKILLS_PLACEHOLDER_START/END %%%` markers. The pipeline injects tailored content between them on every run.

The template ships with an "Alex Doe" demo persona that compiles to a valid 1-page PDF as a sanity check.

## Optional: Notion as the job source

If you use Notion to track jobs, set these before invoking the agent:

```bash
export NOTION_DB_ID="<your database UUID>"
export NOTION_DATA_SOURCE="collection://<uuid>"
```

The expected Notion schema (field names, status options, JD page-body format) is documented in `prompts/job_collection.md`. The first time you run, you can ask Claude Code to create the database for you with the right schema.

If you don't want Notion, the easiest no-database alternative is a `user_data/jobs.md` file with one `## Company - Title` block per job; you'd then adapt `prompts/job_collection.md` to read from there. (A CSV/markdown source adapter is not yet built into the pipeline — contributions welcome.)

## Privacy

- Your `user_data/`, `output/`, `work/`, and `logs/` folders are gitignored. Audit `git status` before committing.
- The Chrome extension reads ATS form fields and `user_data/personal_info.json` over `localhost:8765`. It makes no outbound calls beyond that.
- Claude Code reads your JDs, project library, and personal info as part of the orchestration loop. If that's not OK with you, this tool is not the right fit.

## Caveats

- LaTeX is a heavy install. MiKTeX and TeX Live are multi-GB.
- The Chrome extension has dedicated adapters for Workday, Greenhouse, Lever, and Ashby. Other ATSes fall back to a best-effort generic fill.
- Phase 2 always stops before final submit; you click Submit yourself after reviewing.

## License

MIT. See [LICENSE](LICENSE) (TODO — add file before publishing).
