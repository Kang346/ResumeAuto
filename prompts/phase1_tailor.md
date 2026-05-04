# Phase 1 — Resume Tailoring

For each `Backlog` job in the configured source: read the JD, pick the best 2 projects, rewrite their bullets to match JD keywords, compile a 1-page PDF, write the result back to `Agent Note`. Status stays `Backlog` (only Phase 2 changes Status).

## Inputs

- The job source (default: Notion — see [job_collection.md](./job_collection.md) for the schema). Filter `Status = "Backlog"`.
- [user_data/project_library.json](../user_data/project_library.json) — projects with `tags` and pre-formatted LaTeX `bullets`.
- [prompts/prompt_rules.md](./prompt_rules.md) — the LLM rule set (project selection, bullet rewriting, skills reordering, output schema).
- [pipeline/run_pipeline.py](../pipeline/run_pipeline.py) — JSON-in → 1-page PDF-out compiler.

## Per-job orchestration loop

For each `Backlog` row:

1. **Re-run check.** Read `Agent Note`. Skip silently if `✅`. Skip Phase 1 (proceed to Phase 2) if `📄`. Skip with no retry if `🔒` or `❌`. Re-process if `⏭️` and the underlying issue is now resolved.

2. **Validate.** JD body must be ≥ 50 chars. If shorter, mark `⏭️ SKIP: JD too short` and move on.

3. **Resolve Apply Link if needed.** If `Apply Link` is empty but `LinkedIn URL` is set, navigate the LinkedIn job page in the browser and look for the external "Apply" button (Greenhouse / Workday / Lever / Ashby / company ATS). Write the external URL back to `Apply Link`.
   - If only LinkedIn Easy Apply is available (no external link), **proceed to compile the PDF anyway**. Note `Apply via: LinkedIn Easy Apply` in `Agent Note` so Phase 2 knows the submission path. Do NOT skip Phase 1.
   - If the post is expired / "no longer accepting applications", mark `🔒 SKIP: Job expired` and move on.

4. **Generate the tailored JSON.** Read JD + `prompts/prompt_rules.md` + `user_data/project_library.json`. Produce JSON matching the schema below.

5. **Compile.** Pipe the JSON into the compile pipeline:
   ```bash
   python pipeline/run_pipeline.py --company "X" --title "Y" < response.json
   ```
   The pipeline injects `projects_latex` and `skills_latex` between the placeholder markers, runs `pdflatex` twice, page-checks, auto-shrinks (drops the last bullet per project, retries up to 3x) if > 1 page, writes the final PDF to `output/`.

6. **Write Agent Note.** On success: `📄 PDF Ready | Projects: <id1>, <id2> | PDF: <filename>.pdf`. Append `| Apply via: LinkedIn Easy Apply` if applicable. On failure: `❌ FAIL: <reason>`. Never touch `Note` or `Status`.

## LLM output schema

```json
{
  "selected_projects": ["project_id_1", "project_id_2"],
  "projects_latex": "...full LaTeX for both projects, ready to inject between PROJECTS_PLACEHOLDER markers...",
  "skills_latex": "\\textbf{Languages}{: Python, Go, ...} \\\\\n     \\textbf{Frameworks \\& Tools}{: React, Django, AWS, ...}",
  "reasoning": "Brief: why these projects, what JD keywords were injected"
}
```

`projects_latex` must contain two `\resumeProjectHeading{...}{...}` blocks each followed by `\resumeItemListStart` ... `\resumeItemListEnd`. `skills_latex` must contain exactly two lines (Languages / Frameworks & Tools). No markdown fences. No extra text.

See [prompt_rules.md](./prompt_rules.md) for the full bullet-rewriting rules (bold convention, line-length control, LaTeX escaping, frozen-section policy).

## LinkedIn navigation rules

Allowed in Phase 1: read-only navigation on linkedin.com to find an external apply URL.

NOT allowed: Easy Apply submissions (Phase 2 only), messages, follows, any other account action.

## Critical constraints

- **One-page hard requirement.** PDF must be exactly 1 page. The pipeline's auto-shrink handles overflow but can fail — if it does, mark `❌ FAIL: 1-page constraint not met` and move on.
- **Frozen sections.** Header, Education, Professional Experience are NEVER modified by Phase 1. Only Projects and Skills are dynamic. The LLM output should not contain LaTeX for frozen sections.
- **Skip, don't block.** Any failure → `Agent Note` with emoji prefix, move to next job. Never halt the loop on a single bad job.
- **Always tailor.** As long as the JD is readable and the post isn't expired, generate the PDF. The submission path (external ATS vs. LinkedIn Easy Apply) does not gate tailoring.
