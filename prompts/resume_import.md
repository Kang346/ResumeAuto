# Resume Import Prompt

One-shot import: take an existing resume (PDF or DOCX) and produce a populated `user_data/` plus an updated `templates/example.tex`. The user invokes this by saying something like *"import my resume from ~/Downloads/my_resume.pdf"*.

This prompt is the agent's runbook. Follow each step in order. Do not skip the validation step.

---

## Inputs

The user supplies a path to a resume file. Supported formats:

- `.pdf` — extracted with Claude Code's `Read` tool.
- `.docx` — extracted via `python tools/extract_resume_text.py <path>`.
- `.txt` / `.md` — Read directly.

**Out of scope** — report clearly and stop:

- `.doc` (legacy Word, pre-2007). Tell the user to "Save As .docx" first.
- Image-only / scanned PDFs (Read returns no text). Tell the user to re-export as a text PDF.
- Non-English resumes. Report "non-English resumes not supported in v1" and stop without writing.

---

## Step 1 — Extract text

Run the appropriate extractor for the file extension. Capture the full plain text into working memory. If the extracted text is empty or under ~200 characters, treat as an extraction failure and stop with a clear error.

For `.docx`, the helper flattens tables with `|` separators because some resumes use a 2-column header layout — the LLM disentangles structure from the flattened lines.

---

## Step 2 — Parse into intermediate JSON (in working memory)

Build a structured object with these fields. Validate each with regex where noted.

```json
{
  "name":        { "first": "...", "last": "..." },
  "email":       "...",        // RFC 5322 lite: [^@\s]+@[^@\s]+\.[^@\s]+
  "phone":       "...",        // digits only, length 10–15
  "location":    { "city": "...", "state": "..." },
  "linkedin":    "https://linkedin.com/in/...",
  "github":      "https://github.com/...",

  "education": [
    { "degree": "...", "major": "...", "school": "...", "location": "...",
      "start": "YYYY-MM", "end": "YYYY-MM or null", "gpa": "optional" }
  ],

  "work_experience": [
    { "title": "...", "company": "...", "location": "...",
      "start": "YYYY-MM", "end": "YYYY-MM or null",
      "current": false, "bullets": ["...", "..."] }
  ],

  "projects": [
    { "name": "...", "date": "...", "bullets": ["...", "..."] }
  ],

  "skills": ["...", "..."]
}
```

Rules:

- Preserve work-experience and project bullets **verbatim** as plain text — no LaTeX, no rewriting. Bullet rewriting happens in Step 5.
- Date normalization: convert "Sept 2024", "September 2024", "9/2024", "Sep'24" all to `2024-09`. Current/present → `null` and `current: true`.
- If the resume lists a degree without an explicit major (e.g. "B.S., MIT"), set `major` to `""` rather than guessing.
- If a section is absent (no Projects header, no Education), use an empty array — do not fabricate.

---

## Step 3 — Fill gaps via chat

Ask the user only the questions the resume cannot answer:

1. **Work authorization.** Default phrasing: *"F-1 OPT requiring future H-1B sponsorship"*. Default `requires_sponsorship: true`. Ask once; accept their answer.
2. **Projects fallback.** If Step 2 yielded fewer than 2 projects, ask the user for 2–3 project names + a one-line summary each. Write skeletons (name + summary + empty bullets) so Phase 2 tailoring still has selection room. Do **not** fabricate projects from work-experience bullets.
3. **Street address & ZIP.** If `location.line1` (street) and `location.zip` are missing — they almost always are — ask. Many ATS forms reject submissions without them.

Do **not** ask about: gender, race/ethnicity, veteran status, disability status. Those EEO fields stay blank by design.

---

## Step 4 — Confirm before writing

Render the parsed structure as a brief summary in chat (name, contact, # education entries, # work entries with one-line each, # projects). Ask the user to confirm.

If `user_data/personal_info.json` already exists with non-placeholder data (i.e. not the "Alex Doe" demo):

- Walk the user field by field for any field where parsed data **disagrees** with existing data. For each: show old → new, ask which to keep. Do not auto-merge.
- Fields that match exactly: no prompt needed.

If `user_data/project_library.json` already exists with non-placeholder data:

- Ask: append (add new projects to existing list), replace (drop existing), or skip (keep existing, ignore new).

---

## Step 5 — Write user_data

Write `user_data/personal_info.json` to match the schema in `examples/personal_info.example.json`. Drop the `_instructions` key. Carry over confirmed values from Steps 2–4.

Write `user_data/project_library.json` to match `examples/project_library.example.json`. For each project:

- `id` — slug derived from name: lowercase, alphanumeric, dashes (e.g. `"task-flow"`).
- `tags` — invent from bullet content: languages, frameworks, and domain keywords mentioned (e.g. `["python", "fastapi", "postgres", "ml"]`). Aim for 6–12 tags so the Phase 2 tag-overlap scorer has signal.
- `summary` — one sentence (≤ 25 words) capturing what the project is.
- `bullets` — convert each plain-text bullet to LaTeX following the bold convention from [prompt_rules.md](./prompt_rules.md):
  - Bold the opening action phrase (verb + object): `\textbf{Architected a 6-stage pipeline}`
  - Bold key technical terms: `\textbf{Django, React, AWS}`
  - Bold quantitative metrics: `\textbf{85.2\% accuracy}`, `\textbf{1.2M ops/s}`
  - Escape LaTeX specials: `%` → `\%`, `&` → `\&`, `~` → `$\sim$`, `#` → `\#`
- Preserve the original bullet content; do not invent metrics.

If projects came from the Step 3 fallback (skeletons), still write them with `bullets: []` — the user will fill them later.

---

## Step 6 — Update example.tex

The template ships with marker pairs around the editable sections. Use them as string delimiters for surgical find-and-replace.

1. **Backup**: copy `templates/example.tex` to `templates/example.tex.bak`. Use the Bash tool: `cp templates/example.tex templates/example.tex.bak` (PowerShell: `Copy-Item templates/example.tex templates/example.tex.bak`).

2. **Replace the heading block** between `%%% HEADING_START %%%` and `%%% HEADING_END %%%` with a fresh `\begin{center}...\end{center}` containing name, location, phone, email, LinkedIn, GitHub. Match the existing format (see Alex Doe sample). Omit any line for which the user has no value (e.g. no GitHub → drop that `\href{}` and the trailing `$|$` separator).

3. **Replace the Education block** between `%%% EDUCATION_START %%%` and `%%% EDUCATION_END %%%` with `\resumeSubHeadingListStart` ... `\resumeSubHeadingListEnd` wrapping one `\resumeSubheading{school}{location}{degree, major}{start -- end}` per entry. Format dates as `Sep. 2023 -- Dec. 2024` (or `-- Present` for current).

4. **Replace the Professional Experience block** between `%%% EXPERIENCE_START %%%` and `%%% EXPERIENCE_END %%%`. For each work entry, emit:
   ```latex
       \resumeSubheading
         {Title}{Start -- End}
         {Company}{Location}
         \resumeItemListStart
           \resumeItem{bullet 1 verbatim, with LaTeX escapes applied}
           \resumeItem{bullet 2 ...}
         \resumeItemListEnd
   ```
   Wrap the whole list in `\resumeSubHeadingListStart` ... `\resumeSubHeadingListEnd`. Keep work-experience bullets as plain prose with LaTeX escapes only — **do not** add `\textbf{}` here. The header / Education / Experience sections are FROZEN by design (per [prompt_rules.md](./prompt_rules.md)) and bolding bullets in those sections clutters the static parts of the resume.

5. **Do not touch** the Projects or Skills sections. Their `%%% PROJECTS_PLACEHOLDER_START/END %%%` and `%%% SKILLS_PLACEHOLDER_START/END %%%` markers must remain intact for [pipeline/run_pipeline.py](../pipeline/run_pipeline.py) to inject tailored content on every Phase 2 run.

---

## Step 7 — Validate

Run `pdflatex` twice (matching [pipeline/run_pipeline.py:70-75](../pipeline/run_pipeline.py)'s pattern, needed for cross-references):

```bash
pdflatex -interaction=nonstopmode -output-directory work templates/example.tex
pdflatex -interaction=nonstopmode -output-directory work templates/example.tex
```

(PowerShell uses the same command.) Ensure `work/` exists first; create it if missing.

- **Success** = `work/example.pdf` exists. Report the path. Delete `templates/example.tex.bak`.
- **Failure** = no PDF produced. Restore the backup over the broken template (`mv templates/example.tex.bak templates/example.tex`), print the last 30 lines of pdflatex stderr / log, and stop. Do **not** delete the backup on failure.
- **`pdflatex` not on PATH** = report the missing dependency, leave `user_data/` files in place (JSON population should not block on a LaTeX install), restore the `.tex` backup, stop.

---

## Step 8 — Final report

Print a concise summary:

- ✅ Extracted: name, email, phone, N education entries, N work entries, N projects, N skills.
- 🟡 Defaulted: work_authorization (if user took the default).
- ⬜ Left blank: gender, race_ethnicity, veteran_status, disability_status (EEO — never auto-filled).
- 📄 PDF: `work/example.pdf` compiled successfully (or the failure mode if not).
- ➡️ Next steps:
  - Review `user_data/project_library.json` — refine `tags` and `bullets` so the Phase 2 tailoring agent has good selection material.
  - If any project has empty bullets (Step 3 fallback), fill them in.
  - Run a smoke test: `python pipeline/run_pipeline.py --company "Test" --title "Test" < some_response.json` to confirm injection still works end-to-end.

---

## Failure modes (quick reference)

| Symptom | Action |
|---|---|
| Image-only / scanned PDF (Read returns no text) | Stop. Suggest re-export as text PDF. |
| `.doc` legacy Word | Stop. Suggest "Save As .docx". |
| Two-column PDF with text-flow ambiguity | Trust the LLM to disentangle; flag low-confidence fields in the final report. |
| No Education or Work Experience section | Write empty arrays; warn the user. Skeletons in `example.tex` will be empty — user must edit. |
| Non-English resume | Stop. Report "not supported in v1". |
| `pdflatex` not on PATH | JSON files stay; `.tex` backup restored; stop with clear error. |
| Existing `user_data/` with real data | Field-by-field confirm in Step 4 — never silently overwrite. |
