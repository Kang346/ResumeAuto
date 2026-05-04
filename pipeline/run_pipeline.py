#!/usr/bin/env python3
"""
Resume compile pipeline — accepts LLM-tailored JSON, produces a 1-page PDF.

Usage:
    python pipeline/run_pipeline.py --company "Disney" --title "SWE I" < response.json
    python pipeline/run_pipeline.py --company "Disney" --title "SWE I" --json-file response.json
    python pipeline/run_pipeline.py --demo

Reads the LLM JSON (with selected_projects, projects_latex, skills_latex, reasoning),
injects into example.tex template, compiles with pdflatex, auto-shrinks if >1 page,
and outputs a result JSON to stdout.

The --demo flag runs a deterministic playback against the bundled sample JD —
no stdin, no LLM call, no user_data/. Useful as a post-install smoke test.

Exit codes:
    0 = success (1-page PDF generated)
    1 = failure (compile error or still >1 page after shrinking)
"""

import json
import sys
import argparse
import subprocess
import shutil
import re
from datetime import datetime
from pathlib import Path

# BASE_DIR is the project root (this file lives in pipeline/).
BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = BASE_DIR / "templates" / "example.tex"
OUTPUT_DIR = BASE_DIR / "output"
WORK_DIR = BASE_DIR / "work"

# MiKTeX path (user-local install on Windows)
MIKTEX_BIN = Path.home() / "AppData/Local/Programs/MiKTeX/miktex/bin/x64"
PDFLATEX = str(MIKTEX_BIN / "pdflatex.exe") if MIKTEX_BIN.exists() else "pdflatex"

OUTPUT_DIR.mkdir(exist_ok=True)
WORK_DIR.mkdir(exist_ok=True)

MAX_SHRINK_ATTEMPTS = 3


def load_template() -> str:
    with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
        return f.read()


def inject_into_template(template: str, projects_latex: str, skills_latex: str) -> str:
    proj_start = "%%% PROJECTS_PLACEHOLDER_START %%%"
    proj_end = "%%% PROJECTS_PLACEHOLDER_END %%%"
    skills_start = "%%% SKILLS_PLACEHOLDER_START %%%"
    skills_end = "%%% SKILLS_PLACEHOLDER_END %%%"

    start_idx = template.index(proj_start) + len(proj_start)
    end_idx = template.index(proj_end)
    result = template[:start_idx] + "\n" + projects_latex + "\n" + template[end_idx:]

    start_idx = result.index(skills_start) + len(skills_start)
    end_idx = result.index(skills_end)
    result = result[:start_idx] + "\n     " + skills_latex + "\n" + result[end_idx:]

    return result


def compile_latex(tex_content: str, output_name: str) -> dict:
    tex_path = WORK_DIR / "example.tex"
    with open(tex_path, "w", encoding="utf-8") as f:
        f.write(tex_content)

    for _ in range(2):
        result = subprocess.run(
            [PDFLATEX, "-interaction=nonstopmode",
             "-output-directory", str(WORK_DIR), str(tex_path)],
            capture_output=True, text=True, timeout=120
        )

    pdf_path = WORK_DIR / "example.pdf"
    if not pdf_path.exists():
        return {
            "success": False,
            "error": result.stderr[-500:] if result.stderr else "Unknown compile error",
            "pages": 0,
        }

    page_count = get_pdf_pages(pdf_path)
    final_path = OUTPUT_DIR / f"{output_name}.pdf"
    shutil.copy2(pdf_path, final_path)

    return {"success": True, "pages": page_count, "pdf_path": str(final_path)}


def get_pdf_pages(pdf_path: Path) -> int:
    # Try pdfinfo first
    try:
        result = subprocess.run(
            ["pdfinfo", str(pdf_path)], capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.splitlines():
            if line.startswith("Pages:"):
                return int(line.split(":")[1].strip())
    except Exception:
        pass
    # Fallback: parse pdflatex log
    log_path = pdf_path.with_suffix(".log")
    if log_path.exists():
        with open(log_path, encoding="utf-8", errors="ignore") as f:
            content = f.read()
            match = re.search(r"Output written on .+\((\d+) page", content)
            if match:
                return int(match.group(1))
    return 1


def shrink_bullets_in_latex(projects_latex: str) -> str:
    lines = projects_latex.split("\n")
    items_to_remove = []
    current_project_bullets = []

    for i, line in enumerate(lines):
        if "\\resumeItemListStart" in line:
            current_project_bullets = []
        elif "\\resumeItem{" in line:
            current_project_bullets.append(i)
        elif "\\resumeItemListEnd" in line:
            if len(current_project_bullets) > 2:
                items_to_remove.append(current_project_bullets[-1])
            current_project_bullets = []

    return "\n".join(line for i, line in enumerate(lines) if i not in items_to_remove)


def sanitize_filename(s: str) -> str:
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s]+', '_', s)
    return s[:50]


def main():
    parser = argparse.ArgumentParser(description="Compile tailored resume PDF")
    parser.add_argument("--company", help="Company name")
    parser.add_argument("--title", help="Job title")
    parser.add_argument("--json-file", help="Path to JSON file (default: read from stdin)")
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Run a deterministic demo with the bundled sample JD and tailored "
             "response. Skips stdin / --json-file / --company / --title.",
    )
    args = parser.parse_args()

    if args.demo:
        if args.company or args.title or args.json_file:
            parser.error(
                "--demo is mutually exclusive with --company / --title / --json-file"
            )
        demo_path = BASE_DIR / "examples" / "sample_tailored.json"
        with open(demo_path, "r", encoding="utf-8") as f:
            raw = f.read()
    else:
        if not args.company or not args.title:
            parser.error("--company and --title are required (or use --demo)")
        if args.json_file:
            with open(args.json_file, "r", encoding="utf-8") as f:
                raw = f.read()
        else:
            raw = sys.stdin.read()

    # Strip markdown fences if present
    raw = raw.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        result = {"success": False, "error": f"JSON parse error: {e}"}
        print(json.dumps(result))
        sys.exit(1)

    projects_latex = data.get("projects_latex", "")
    skills_latex = data.get("skills_latex", "")
    selected = data.get("selected_projects", [])
    reasoning = data.get("reasoning", "")

    if args.demo:
        args.company = data.get("company", "Demo")
        args.title = data.get("title", "Demo")

    if not projects_latex or not skills_latex:
        result = {"success": False, "error": "Missing projects_latex or skills_latex in JSON"}
        print(json.dumps(result))
        sys.exit(1)

    template = load_template()
    date_str = datetime.now().strftime("%Y-%m-%d")
    output_name = f"{sanitize_filename(args.company)}_{sanitize_filename(args.title)}_{date_str}"

    # Compile with auto-shrink retry
    current_projects = projects_latex
    attempts = []

    for attempt in range(MAX_SHRINK_ATTEMPTS):
        tex_content = inject_into_template(template, current_projects, skills_latex)
        compile_result = compile_latex(tex_content, output_name)

        if not compile_result["success"]:
            result = {
                "success": False,
                "error": compile_result.get("error", "unknown"),
                "attempts": attempts,
            }
            print(json.dumps(result))
            sys.exit(1)

        attempts.append({"attempt": attempt + 1, "pages": compile_result["pages"]})

        if compile_result["pages"] == 1:
            result = {
                "success": True,
                "pdf_path": compile_result["pdf_path"],
                "pdf_name": f"{output_name}.pdf",
                "selected_projects": selected,
                "reasoning": reasoning,
                "attempts": attempts,
            }
            print(json.dumps(result))
            sys.exit(0)

        # Shrink and retry
        current_projects = shrink_bullets_in_latex(current_projects)

    # Still >1 page
    result = {
        "success": False,
        "error": f"PDF still {compile_result['pages']} pages after {MAX_SHRINK_ATTEMPTS} shrink attempts",
        "pdf_name": f"{output_name}.pdf",
        "attempts": attempts,
    }
    print(json.dumps(result))
    sys.exit(1)


if __name__ == "__main__":
    main()
