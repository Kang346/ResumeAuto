# Job Collection Prompt

You are helping the user collect job postings into a database (default: Notion) for later review and application. Use the rules in this document strictly. When in doubt, skip the job rather than add it.

> **For users**: This file ships with a placeholder candidate profile. **Edit the "Candidate profile" section below** to match your situation, and replace `<NOTION_DATA_SOURCE>` / `<NOTION_DB_NAME>` with your own values (or read them from `user_data/personal_info.json` if you've populated it).

---

## Notion database schema (default job source)

Configure these via environment variables (or your config file):

- `NOTION_DB_ID` — your database ID (UUID)
- `NOTION_DATA_SOURCE` — `collection://<uuid>`

Suggested field schema (use exactly these names, or adapt the prompts to your own):

| Field | Type | Notes |
|---|---|---|
| `Company Name` | title | e.g. `"NVIDIA"` — no `, Inc.` suffix |
| `Job Title` | text | Full title with seniority hint, e.g. `"Software Engineer (New Grad)"` |
| `Apply Link` | URL | External ATS URL (Greenhouse / Workday / Lever / Ashby / company careers) |
| `LinkedIn URL` | URL, optional | LinkedIn job URL if discovered there |
| `Base` | text | Location, e.g. `"San Francisco, CA"`, `"Remote (US)"` |
| `Salary` | text | e.g. `"$140K-$190K"` or `"Not disclosed"` |
| `Status` | select: `Backlog` / `Applied` | Default `Backlog`. Only Phase 3 changes to `Applied`. |
| `Note` | text | **User-only** — the agent must NEVER write here. |
| `Agent Note` | text | All agent output goes here, with emoji prefix. |
| `JD Summary` | text | 2–3 sentence summary; full JD lives in the page body. |
| `Dedup Key` | text | System-managed. Strongest available identifier (ATS job ID / req id / triple). Computed by [pipeline/dedup.py](../pipeline/dedup.py). Never edit by hand. |
| `Job Signature` | text | System-managed. Always-present `(company, title, location)` fingerprint, stored alongside `Dedup Key` so cross-source matches still work when one entry has an ATS-ID key and the other only the triple. Never edit by hand. |

The full JD lives in the page **body** (not a property), formatted per the structured-summary template at the end of this file.

To bootstrap the database, ask Claude Code to create it for you the first time using the schema above.

---

## Candidate profile (CUSTOMIZE — drives filtering)

| Fact                          | Value                                                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                          | <YOUR_NAME>                                                                                                                                                                                  |
| Education                     | <YOUR_DEGREE_AND_SCHOOL>                                                                                                                                                                     |
| Work authorization            | <e.g. F-1 OPT / US Citizen / Green Card / etc.>                                                                                                                                              |
| Requires sponsorship for H-1B | <YES / NO>                                                                                                                                                                                   |
| Years of experience           | <e.g. ~2 years (internships + projects). Entry-level / new grad.>                                                                                                                            |
| Currently in                  | <e.g. San Francisco, CA (open to Remote / NY / Seattle / etc.)>                                                                                                                              |
| Target roles                  | <e.g. SDE/SWE with AI focus, ML Engineer, Applied AI / Applied Scientist, AI Engineer, Research Engineer (non-PhD), Forward-Deployed Engineer at AI-first companies, LLM/agent engineering> |

## Goal

Find new postings that match the profile and write each one to the configured Notion database (`<NOTION_DB_NAME>`, data source: `<NOTION_DATA_SOURCE>`). Default `Status` = `Backlog`. Each job should be reviewable later by a downstream resume-tailoring agent.

---

## INCLUDE (target these roles — adapt to your profile)

- Software Engineer (New Grad / Entry / I / II)
- ML Engineer (any seniority where 0-3 years is plausible)
- Applied AI Engineer / Applied Scientist (Master's level, NOT PhD-required)
- AI Engineer / LLM Engineer / Agent Engineer
- Research Engineer (NON-PhD positions)
- Forward-Deployed Engineer at AI-first companies (Anthropic, OpenAI, Cohere, Scale, Hugging Face, Mistral, etc.)
- Full-Stack Engineer **at AI/ML-product companies** (where AI is the product, not a buzzword)

## EXCLUDE (skip without writing to DB)

**Hard immigration filters** — skip if the JD contains any of (REMOVE if you don't need sponsorship):
- "U.S. citizens or permanent residents only"
- "Must have unrestricted right to work in the U.S."
- "Sponsorship not available for this role" / "We do not sponsor visas"
- "Active security clearance required" / "TS/SCI" / "Public Trust"
- "ITAR" / "Export-controlled"
- "Must be a U.S. person"

**Hard education filter** — skip if (adapt to your degree):
- "Ph.D. required" or "Ph.D. in [field] required"
- "Ph.D. or equivalent industrial research experience" — borderline; SKIP unless the JD also explicitly accepts your degree level

**Hard experience filter** — skip if (adapt to your YoE):
- "5+ years required" / "7+ years required" / "10+ years"
- Title contains "Senior" / "Staff" / "Principal" / "Lead" / "Director" / "Manager"
- "Tech Lead" / "Engineering Manager"

**Role mismatch** — skip:
- DevOps / SRE / Platform Engineering (unless the JD explicitly mentions ML infrastructure)
- Data Engineer (unless ML/AI specific)
- Frontend-only roles
- Mobile-only roles
- Sales / Solutions Engineer / Customer-facing roles
- QA / Test Engineer
- Security / Penetration testing

**Other skip signals**:
- Pure consulting firms with bench staffing
- Companies with no apparent AI/ML product (unless the role is SWE NewGrad at a top-tier non-AI company like Stripe/Snowflake/Databricks where AI work is part of broader engineering)
- Re-postings of jobs already in the database (see validation rule #9 — uses [pipeline/dedup.py](../pipeline/dedup.py))

---

## Where to look

**Primary sources (use these first — DO NOT start from company homepages).** These aggregators surface fresh postings with date / applicant-count signals that company career pages hide.

1. **LinkedIn Jobs** — main discovery channel. Use filters: Experience level = `Internship / Entry / Associate`, **Date posted = `Past 24 hours` or `Past week`** (prefer 24h; expand to week only if 24h is dry), Location = `United States` or `Remote`. Search keywords like `"Software Engineer New Grad"`, `"Machine Learning Engineer"`, `"AI Engineer"`, `"Applied Scientist"`, `"LLM Engineer"`. From each LinkedIn posting, locate the **external** Apply link (Greenhouse / Workday / Lever / Ashby) — do not use Easy Apply.
2. **Greenhouse job board search** — `boards.greenhouse.io` and Greenhouse-hosted ATS pages. Search via Google with a freshness filter: append `&tbs=qdr:w` (past week) to the Google search URL, or use `site:boards.greenhouse.io "new grad" software engineer`. Always check the posting's own "Posted on" / "Updated" date before adding.
3. **Indeed** — `indeed.com/jobs?q=...&sort=date&fromage=3` (past 3 days). Expand `fromage=7` only if 3 days is dry. Click through to the company's external apply page.
4. **Lever / Ashby / Workday** boards surfaced via the above (don't crawl company homepages directly). Most Lever / Ashby pages show a "Posted X days ago" line — read it.

**Always apply the platform's date filter to the tightest window first** (24h on LinkedIn, 3 days on Indeed, past-week on Google). Only widen if the tight window returns nothing relevant.

**Secondary sources** (only if primary sources are dry):
- Y Combinator's Work at a Startup (`workatastartup.com`)
- Hacker News "Ask HN: Who's Hiring" monthly threads
- Levels.fyi job board

**Do NOT** start from a company's `/careers` homepage as the discovery method — those don't tell you posting age or applicant count, which are needed to prioritize fresh postings. Company ATS pages are fine as the **destination** (Apply Link), just not as the **source**.

DO NOT fabricate jobs. Every entry must come from a real, currently-open posting.

---

## Per-job validation checklist — STRICT, NO EXCEPTIONS

These rules are **non-negotiable**. Do not rationalize a borderline job into the database. When in doubt, skip. The user would rather see 5 great matches than 20 mediocre ones.

For each candidate posting, before writing to the database, ALL of the following must be true:

1. ✅ **Posting is currently open** — not "no longer accepting applications" / not closed / not expired
2. ✅ **Posting age ≤ 7 days** — read the "Posted X days/hours ago" indicator on the source platform.
   - **Preferred: ≤ 3 days old.** Strongly favor these.
   - **Acceptable: 4–7 days old.** OK to add if it's a strong fit.
   - **REJECT: > 7 days old.** Skip without writing, no exceptions.
   - **REJECT: > 30 days old.** Absolutely not — these are stale even if technically still "open".
   - If the platform doesn't show a posted date and you can't determine age from any source → SKIP (don't guess).
3. ✅ **Title matches an INCLUDE category** above (no Senior/Staff/Principal/Lead/Manager/Director)
4. ✅ **Sponsorship-friendly** (only if user requires sponsorship) — JD does NOT contain ANY of:
   - "U.S. citizens or permanent residents only"
   - "Must have unrestricted right to work in the U.S."
   - "We do not sponsor visas" / "Sponsorship not available"
   - "Active security clearance required" / "TS/SCI" / "Public Trust" / "ITAR" / "U.S. person"
   If sponsorship language is **silent**, the job IS allowed — note `"Sponsorship: silent"` in `Note`.
5. ✅ **Education match** — JD does NOT require a degree level higher than the user's (e.g. PhD-required for an MS candidate).
6. ✅ **YoE within range** — JD does NOT require more years than the user has. Acceptable ranges depend on the user; default for new-grad: "0-2 years", "1-3 years", "entry level", "new grad", "early career", or no YoE specified.
7. ✅ **Salary band**, if disclosed, isn't laughably low (skip < $90K base for US SWE, adapt for your market)
8. ✅ **Location is acceptable** (US or Remote-US for US-based candidates; adapt to your situation)
9.  ✅ **Not already in the database** — compute keys for this candidate by running:
    ```
    python -m pipeline.dedup compute --json '{"url":"<Apply Link>","company":"<Company Name>","title":"<Job Title>","location":"<Base>"}'
    ```
    From the JSON output, take both `dedup_key` and `job_signature` and check membership against the working set built in step 0.5. **If either is already present → SKIP** and report `dup of <existing entry>` in the round summary. Otherwise, when writing the new Notion page, set the `Dedup Key` field to the computed `dedup_key` AND the `Job Signature` field to the computed `job_signature`, then add both values to your working set so later candidates in the same round are also deduped.

**If ANY check fails → skip without creating the page.** Do not weaken or reinterpret these rules. Do not add a job "just in case" — the cost of a bad entry is the user's wasted time.

---

## Notion write rules

For each job that passes all checks, create a page in `<NOTION_DATA_SOURCE>` with these properties:

| Property         | Value                                               | Notes                                                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Company Name (title) | Company name only                               | e.g. `"NVIDIA"`, `"Anthropic"`. No suffixes like ", Inc."                                                                                                                                                                                                                |
| Job Title        | Full job title with seniority hint                  | e.g. `"Compiler Verification Engineer, NCG"`, `"Software Engineer (New Grad)"`. Append `[Easy Apply]` only if you couldn't find an external link (and you should generally skip those per rules above).                                                                  |
| Apply Link       | External ATS URL                                    | Greenhouse / Workday / Lever / Ashby / company careers. Leave blank if only LinkedIn Easy Apply available, but per rules you should skip that entirely.                                                                                                                  |
| LinkedIn URL     | LinkedIn job URL if you found it via LinkedIn       | Optional — useful for context but should NEVER be the only apply path                                                                                                                                                                                                    |
| Base             | Location                                            | e.g. `"San Francisco, CA"`, `"Remote (US)"`, `"New York, NY / Remote"`                                                                                                                                                                                                   |
| Salary           | Salary range as posted, or `"Not disclosed"`        | e.g. `"$140K-$190K"`, `"$150K base"`                                                                                                                                                                                                                                     |
| Status           | `"Backlog"`                                         | DEFAULT — never set to `Applied` from this prompt                                                                                                                                                                                                                        |
| JD Summary       | Brief 2-3 sentence summary of the role              | Short summary capturing key tech / product / team angle. The full JD summary lives in the page body (see below).                                                                                                                                                         |
| Note             | Short signal flags from the JD                      | e.g. `"Posted 1 day ago. Sponsorship: silent. 200+ applicants. New grad accepted."` Pick out: posting age, applicant count if visible, sponsorship language ("explicit yes" / "silent" / "no" — note "no" should have been filtered out already), any unusual fit signal |
| Agent Note       | LEAVE BLANK                                         | Reserved for downstream agent — do not write here                                                                                                                                                                                                                        |

### Page body — write a structured JD summary

After creating the page, write the following structured summary into the page body. This is the user's primary review surface, so make it scannable and faithful to the original JD (translate if needed, do not invent).

Use this template (English by default; replace with your preferred language if desired):

```markdown
## Responsibilities
- (Summarize the JD's "Responsibilities" / "What you'll do" / "About the role" — keep quantitative metrics and concrete tech stack)
- ...

## Qualifications
**Required (Must-have):**
- (Translate "Requirements" / "Qualifications" / "Must-have" — degree, YoE, must-have skills)
- ...

**Preferred (Nice-to-have):**
- (Translate "Preferred" / "Nice-to-have" / "Bonus")
- ...

## Tech stack / keywords
- (List specific technologies, frameworks, languages mentioned in the JD: Python, PyTorch, LLM, RAG, AWS, Kubernetes, etc.)

## Team / product context
- (1-3 sentences on what the company does, what the team owns, why this role exists — translate "About the team" / "About us" if present)

## Comp / logistics (if mentioned in JD)
- Salary: (fill if disclosed, otherwise "Not disclosed")
- Location: (Onsite / Hybrid / Remote, city)
- Other: (relocation, equity, visa sponsorship language, etc.)

## Application signals
- Posted: (e.g. "2 days ago")
- Applicants: (if LinkedIn shows it)
- Sponsorship: (explicit yes / silent / other)
- Notes: (anything else the user should be aware of)
```

**Rules for the summary:**
- Translate faithfully — do not embellish, do not insert opinions, do not skip sections that exist in the JD
- If a section doesn't exist in the JD, omit that header (don't write "N/A")
- Keep technical terms in English when there's no clean equivalent (e.g. `LLM`, `RAG`, `Transformer`, `Kubernetes`)
- Aim for ~200–500 words total — enough to evaluate fit without re-opening the JD, not a full copy-paste

---

## Working session protocol

When the user invokes this prompt, do the following in order:

0. **Process the saved queue first.** Read `user_data/pending_jobs.json`. For each entry:
   - **Classify the URL**:
     - If host contains `linkedin.com/jobs/` → treat as discovery URL. Navigate it, locate the external Apply link, set `Apply Link` = external URL and `LinkedIn URL` = saved URL. If only Easy Apply is available, leave `Apply Link` blank, set `LinkedIn URL` = saved URL, and tag the eventual PDF with `Apply via: LinkedIn Easy Apply` per [phase2_tailor.md](./phase2_tailor.md) rules.
     - Otherwise (Greenhouse / Workday / Lever / Ashby / company ATS) → set `Apply Link` = saved URL directly, leave `LinkedIn URL` blank.
   - Open the URL, extract company / job title / JD
   - Run the full Per-job validation checklist (all rules apply: date ≤ 7 days, sponsorship, education, YoE, etc.)
   - If it passes → write to the database using the same schema (page-body summary included)
   - If it fails → record `Saved → SKIP: <reason>` in the round summary
   - After processing each entry (pass or fail), POST its URL to `http://localhost:8765/clear-pending-jobs` (body: `{"urls": ["<url>"]}`) so it's removed from the queue
   - If `user_data/pending_jobs.json` is empty or the file doesn't exist, skip this step silently
   - **Note:** Saved-queue entries also flow through validation rule #9 (dedup) — compute the dedup key for each one before writing.
0.5. **Build the dedup index.** Query the Notion database for every existing page and read **both** `Dedup Key` and `Job Signature` into the same working set held in your context for this round. Reading both is what catches the cross-source case (existing entry stored an ATS job ID, new candidate only has the company+title+location triple) — see the schema notes above for why. Pages with both fields empty (legacy entries that haven't been backfilled) should be tracked separately by `(Company Name, Job Title, Base)` so step 3 can still warn on probable duplicates against them. Reuse this set for every candidate in step 3 and the saved queue in step 0 — do not re-query Notion per candidate.
1. **Ask the user how many jobs they want this round** (default: 10–15) so the session has a clear stopping point.
2. **Ask the user for any focus** for this round (e.g. "only Anthropic / OpenAI / etc.", "only remote", "only NYC", "only fresh-this-week"). Default: no focus, broad search.
3. **Search**, validate per checklist, write to the database.
4. **Report at the end**: a numbered summary of what was added, with company + title + apply link + a one-line "why this one fits". List **saved-queue results separately** from auto-discovered ones (so the user can see what their manual `📌 Save this job` clicks produced). Also mention any near-miss skips with the reason ("Stripe NewGrad SWE skipped: explicit no-sponsorship").

Process jobs ONE AT A TIME — don't batch-write. After each successful add, move to the next. Stop when you hit the round target or run out of qualifying postings, whichever comes first.

---

## Boundaries

- **Never apply to a job from this prompt.** This prompt is collection only. Application happens in a separate session via the Phase 2 (PDF generation) + Phase 3 (form fill) flow documented in [phase2_tailor.md](./phase2_tailor.md) and [phase3_apply.md](./phase3_apply.md).
- **Never modify existing entries** beyond writing new pages. If you find a duplicate, just skip — do not edit the original.
- **Don't write to LinkedIn**, send messages, or take any account action on linkedin.com. Read-only navigation for finding external apply links is OK.
- **Don't fabricate.** If you cannot verify a job is currently open, skip it. Don't guess company names, titles, or links.

---

## Failure modes / escalation

- If a board's Apply links 404 → log in the final report, don't add to the database.
- If you can't determine sponsorship status from the JD → INCLUDE the job (silent ≠ no), but in `Note` write `"Sponsorship: silent"` so the user can verify before applying.
- If you find <5 jobs after searching reasonably → tell the user the search field is dry today and stop, rather than padding with marginal fits.
- If you encounter CAPTCHA / login walls → skip that source, try another.
