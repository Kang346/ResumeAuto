#!/usr/bin/env python3
"""
Resume Tailoring Agent — Phase 2
Reads Backlog jobs from Notion, tailors resume, generates PDF.
Designed to be called by Claude Code or run standalone.

Usage:
    python3 pipeline/agent.py                    # Process all Backlog jobs
    python3 pipeline/agent.py --test <page_id>   # Test with a single Notion page
    python3 pipeline/agent.py --dry-run          # Analyze JDs but don't update Notion
"""

import json
import subprocess
import os
import sys
import re
import shutil
from datetime import datetime
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────
# BASE_DIR is the project root (this file lives in pipeline/).
BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = BASE_DIR / "templates" / "example.tex"
USER_DATA_DIR = BASE_DIR / "user_data"
PROJECT_LIB_PATH = USER_DATA_DIR / "project_library.json"
PROMPT_RULES_PATH = BASE_DIR / "prompts" / "prompt_rules.md"
OUTPUT_DIR = BASE_DIR / "output"
LOGS_DIR = BASE_DIR / "logs"
WORK_DIR = BASE_DIR / "work"  # Temp dir for LaTeX compilation

USER_DATA_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)
WORK_DIR.mkdir(exist_ok=True)

# ── Notion Config ──────────────────────────────────────────────────────
# Set these via environment variables, or override in your fork.
# Run the Notion init prompt to create the database and get these IDs.
NOTION_DATA_SOURCE = os.environ.get("NOTION_DATA_SOURCE", "")  # e.g. "collection://<uuid>"
NOTION_DB_ID = os.environ.get("NOTION_DB_ID", "")              # e.g. "<uuid>"

# ── Load Static Resources ─────────────────────────────────────────────
def load_project_library():
    with open(PROJECT_LIB_PATH, "r") as f:
        data = json.load(f)
    return [p for p in data["projects"] if p["id"] != "placeholder"]

def load_template():
    with open(TEMPLATE_PATH, "r") as f:
        return f.read()

def load_prompt_rules():
    with open(PROMPT_RULES_PATH, "r") as f:
        return f.read()

# ── LaTeX Generation ───────────────────────────────────────────────────
def inject_into_template(template: str, projects_latex: str, skills_latex: str) -> str:
    """Replace placeholder sections in the LaTeX template."""
    # Replace projects (use string-based replace to avoid regex escape issues with \)
    proj_start = "%%% PROJECTS_PLACEHOLDER_START %%%"
    proj_end = "%%% PROJECTS_PLACEHOLDER_END %%%"
    skills_start = "%%% SKILLS_PLACEHOLDER_START %%%"
    skills_end = "%%% SKILLS_PLACEHOLDER_END %%%"

    # Replace projects section
    start_idx = template.index(proj_start) + len(proj_start)
    end_idx = template.index(proj_end)
    result = template[:start_idx] + "\n" + projects_latex + "\n" + template[end_idx:]

    # Replace skills section
    start_idx = result.index(skills_start) + len(skills_start)
    end_idx = result.index(skills_end)
    result = result[:start_idx] + "\n     " + skills_latex + "\n" + result[end_idx:]

    return result

def compile_latex(tex_content: str, output_name: str) -> dict:
    """Compile LaTeX to PDF. Returns dict with success, pages, pdf_path."""
    tex_path = WORK_DIR / "example.tex"
    with open(tex_path, "w") as f:
        f.write(tex_content)

    # Run pdflatex twice (for references)
    for _ in range(2):
        result = subprocess.run(
            ["pdflatex", "-interaction=nonstopmode", "-output-directory", str(WORK_DIR), str(tex_path)],
            capture_output=True, text=True, timeout=30
        )

    pdf_path = WORK_DIR / "example.pdf"
    if not pdf_path.exists():
        return {"success": False, "error": result.stderr[-500:] if result.stderr else "Unknown error", "pages": 0}

    # Check page count
    page_count = get_pdf_pages(pdf_path)

    # Copy to output
    final_path = OUTPUT_DIR / f"{output_name}.pdf"
    shutil.copy2(pdf_path, final_path)

    return {"success": True, "pages": page_count, "pdf_path": str(final_path)}

def get_pdf_pages(pdf_path) -> int:
    """Get page count of a PDF."""
    try:
        result = subprocess.run(
            ["pdfinfo", str(pdf_path)], capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.splitlines():
            if line.startswith("Pages:"):
                return int(line.split(":")[1].strip())
    except Exception:
        pass
    # Fallback: check pdflatex log
    log_path = pdf_path.with_suffix(".log")
    if log_path.exists():
        with open(log_path) as f:
            content = f.read()
            match = re.search(r"Output written on .+\((\d+) page", content)
            if match:
                return int(match.group(1))
    return 1

def sanitize_filename(s: str) -> str:
    """Make a string safe for use as a filename."""
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s]+', '_', s)
    return s[:50]

# ── LLM Call (via Anthropic API) ───────────────────────────────────────
def call_llm_for_tailoring(jd_text: str, projects: list, prompt_rules: str) -> dict:
    """
    Call Claude API to select projects and tailor bullets.
    This function is designed to be replaced with an actual API call.
    For now, it creates the prompt that Claude Code will use.
    """
    projects_json = json.dumps(projects, indent=2, ensure_ascii=False)

    prompt = f"""{prompt_rules}

## Job Description
{jd_text}

## Available Projects
{projects_json}

Now select the best 2 projects and tailor them. Return ONLY a JSON object as specified in the output format above."""

    # Write prompt to file for Claude Code to pick up
    prompt_path = WORK_DIR / "current_prompt.txt"
    with open(prompt_path, "w") as f:
        f.write(prompt)

    return {"prompt_path": str(prompt_path), "prompt": prompt}

# ── Result Processing ──────────────────────────────────────────────────
def process_llm_response(response_text: str) -> dict:
    """Parse the JSON response from the LLM."""
    # Strip potential markdown fences
    cleaned = response_text.strip()
    cleaned = re.sub(r'^```json\s*', '', cleaned)
    cleaned = re.sub(r'\s*```$', '', cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        return {"error": f"Failed to parse LLM response: {e}", "raw": response_text[:500]}

# ── Report Generation ──────────────────────────────────────────────────
def generate_report(results: list) -> str:
    """Generate a markdown run report."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    
    applied = [r for r in results if r["status"] == "success"]
    skipped = [r for r in results if r["status"] == "skipped"]
    failed = [r for r in results if r["status"] == "failed"]
    already = [r for r in results if r["status"] == "already_processed"]

    report = f"""# Agent Run Report — {now}

## Summary
| Result | Count |
|--------|-------|
| Successfully generated PDF | {len(applied)} |
| Skipped | {len(skipped)} |
| Failed | {len(failed)} |
| Already processed | {len(already)} |
| **Total in Backlog** | **{len(results)}** |

"""

    if applied:
        report += "## Generated PDFs\n"
        report += "| Company | Job Title | Projects Used | PDF |\n"
        report += "|---------|-----------|---------------|-----|\n"
        for r in applied:
            report += f"| {r['company']} | {r['job_title']} | {', '.join(r.get('projects', []))} | {r.get('pdf_name', 'N/A')} |\n"
        report += "\n"

    if skipped:
        report += "## Skipped\n"
        report += "| Company | Job Title | Reason |\n"
        report += "|---------|-----------|--------|\n"
        for r in skipped:
            report += f"| {r['company']} | {r['job_title']} | {r['reason']} |\n"
        report += "\n"

    if failed:
        report += "## Failed\n"
        report += "| Company | Job Title | Error | PDF Ready? |\n"
        report += "|---------|-----------|-------|------------|\n"
        for r in failed:
            pdf_ready = "Yes" if r.get("pdf_name") else "No"
            report += f"| {r['company']} | {r['job_title']} | {r['reason']} | {pdf_ready} |\n"
        report += "\n"

    return report

# ── Main Process for One Job ───────────────────────────────────────────
def process_single_job(page_id: str, company: str, job_title: str, 
                       apply_link: str, agent_note: str, jd_content: str,
                       projects: list, template: str, prompt_rules: str,
                       dry_run: bool = False) -> dict:
    """
    Process a single job posting. Returns a result dict.
    """
    result = {
        "page_id": page_id,
        "company": company,
        "job_title": job_title,
    }

    # ── Check if already processed ──
    if agent_note and agent_note.startswith("✅"):
        result["status"] = "already_processed"
        result["reason"] = "Already applied"
        return result

    # ── Check if PDF already generated (Phase 2 done, awaiting Phase 3) ──
    if agent_note and agent_note.startswith("📄"):
        result["status"] = "already_processed"
        result["reason"] = "PDF already generated, ready for Phase 3 submission"
        result["agent_note"] = agent_note  # preserve as-is, do not overwrite
        return result

    # ── Check if blocked ──
    if agent_note and (agent_note.startswith("🔒") or agent_note.startswith("❌")):
        result["status"] = "skipped"
        result["reason"] = f"Previously blocked: {agent_note[:80]}"
        return result

    # ── Validate apply link ──
    if not apply_link or apply_link.strip() == "":
        result["status"] = "skipped"
        result["reason"] = "No apply link"
        result["agent_note"] = "⏭️ SKIP: No apply link"
        return result

    # NOTE: Apply Link should already be resolved to an official ATS URL by the
    # orchestrator (Claude) before calling this function. If a LinkedIn URL
    # leaks through, that means orchestrator-side resolution failed —
    # fail loud rather than silently compile.
    if "linkedin.com" in apply_link.lower():
        result["status"] = "failed"
        result["reason"] = "Apply Link still points to LinkedIn — orchestrator must resolve to official URL first"
        result["agent_note"] = "❌ FAIL: Apply Link is a LinkedIn URL, resolve to official apply URL first"
        return result

    # ── Validate JD content ──
    if not jd_content or len(jd_content.strip()) < 50:
        result["status"] = "skipped"
        result["reason"] = "No JD content or too short"
        result["agent_note"] = "⏭️ SKIP: No JD content found"
        return result

    # ── Generate LLM prompt ──
    llm_input = call_llm_for_tailoring(jd_content, projects, prompt_rules)
    
    if dry_run:
        result["status"] = "dry_run"
        result["reason"] = "Dry run — prompt generated but not executed"
        result["prompt_path"] = llm_input["prompt_path"]
        return result

    # At this point, Claude Code takes over:
    # It will read the prompt, call the LLM, get the response,
    # then call finish_job() with the response.
    result["status"] = "pending_llm"
    result["prompt"] = llm_input["prompt"]
    return result

def shrink_bullets_in_latex(projects_latex: str) -> str:
    """Remove the last \\resumeItem in each project block to save space."""
    lines = projects_latex.split("\n")
    result = []
    # Find each resumeItemListEnd and remove the previous resumeItem
    items_to_remove = []
    in_project = False
    bullet_indices = []  # List of lists, one per project

    current_project_bullets = []
    for i, line in enumerate(lines):
        if "\\resumeItemListStart" in line:
            current_project_bullets = []
        elif "\\resumeItem{" in line:
            current_project_bullets.append(i)
        elif "\\resumeItemListEnd" in line:
            # Mark last bullet of this project for removal (if >2 bullets)
            if len(current_project_bullets) > 2:
                items_to_remove.append(current_project_bullets[-1])
            current_project_bullets = []

    for i, line in enumerate(lines):
        if i not in items_to_remove:
            result.append(line)

    return "\n".join(result)


def finish_job(result: dict, llm_response_text: str, template: str) -> dict:
    """
    After LLM returns tailored content, compile the PDF.
    Automatically retries with fewer bullets if PDF exceeds 1 page.
    """
    company = result["company"]
    job_title = result["job_title"]

    # Parse LLM response
    parsed = process_llm_response(llm_response_text)
    if "error" in parsed:
        result["status"] = "failed"
        result["reason"] = f"LLM response parse error: {parsed['error']}"
        result["agent_note"] = f"❌ FAIL: LLM response parse error"
        return result

    projects_latex = parsed.get("projects_latex", "")
    skills_latex = parsed.get("skills_latex", "")
    selected = parsed.get("selected_projects", [])
    reasoning = parsed.get("reasoning", "")

    if not projects_latex or not skills_latex:
        result["status"] = "failed"
        result["reason"] = "LLM returned empty projects or skills"
        result["agent_note"] = "❌ FAIL: LLM returned empty content"
        return result

    # Generate output name
    date_str = datetime.now().strftime("%Y-%m-%d")
    safe_company = sanitize_filename(company)
    safe_title = sanitize_filename(job_title)
    output_name = f"{safe_company}_{safe_title}_{date_str}"

    # Try compiling, shrink if needed
    attempts = []
    current_projects = projects_latex
    for attempt in range(3):
        tex_content = inject_into_template(template, current_projects, skills_latex)
        compile_result = compile_latex(tex_content, output_name)

        if not compile_result["success"]:
            result["status"] = "failed"
            result["reason"] = f"LaTeX compilation error: {compile_result.get('error', 'unknown')[:200]}"
            result["agent_note"] = "❌ FAIL: PDF compilation error"
            return result

        attempts.append({"attempt": attempt + 1, "pages": compile_result["pages"]})

        if compile_result["pages"] == 1:
            # Success
            result["status"] = "success"
            result["projects"] = selected
            result["reasoning"] = reasoning
            result["pdf_name"] = f"{output_name}.pdf"
            result["pdf_path"] = compile_result["pdf_path"]
            result["compile_attempts"] = attempts
            result["agent_note"] = f"📄 PDF Ready | Projects: {', '.join(selected)} | PDF: {output_name}.pdf"
            return result

        # Too long — shrink
        current_projects = shrink_bullets_in_latex(current_projects)

    # Still too long after 3 attempts
    result["status"] = "failed"
    result["reason"] = f"PDF exceeds 1 page after 3 shrink attempts (attempts: {attempts})"
    result["agent_note"] = f"❌ FAIL: PDF is {compile_result['pages']} pages after shrinking"
    result["pdf_name"] = f"{output_name}.pdf"
    return result

# ── Entry Point ────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Resume Tailoring Agent — Phase 2")
    print("This script provides helper functions for Claude Code to orchestrate.")
    print("")
    print("Available functions:")
    print("  load_project_library()     - Load projects from JSON")
    print("  load_template()            - Load LaTeX template")
    print("  load_prompt_rules()        - Load LLM prompt rules")
    print("  process_single_job(...)    - Validate and prepare a job for processing")
    print("  finish_job(...)            - Compile PDF after LLM response")
    print("  generate_report(...)       - Generate markdown run report")
    print("")
    print("Claude Code orchestrates the flow: Notion read → process_single_job → LLM call → finish_job → Notion update")
