# Phase 2.5 — Drain the Question Queue

While filling a Phase 3 application in the browser, the user can right-click a "Why this company?" / "Tell us about yourself" / cover-letter prompt and pick **"Ask agent to draft an answer"**. The Chrome extension queues that question to [user_data/pending_questions.json](../user_data/pending_questions.json) (via `POST /queue-question` to the local server).

When the user later says any of:

- *"drain the question queue"*
- *"answer queue"*
- *"process pending questions"*

…run this protocol.

## Protocol

1. **Read the queue.** Load `user_data/pending_questions.json`. If empty or missing, report "queue empty" and stop.

2. **For each entry** `{id, question, company, job_title, page_url, target_selector, queued_at}`:
   - Find the matching job-source entry by `company` + `job_title`. Read its JD summary if present.
   - Read [user_data/project_library.json](../user_data/project_library.json) and pick the 2 projects most relevant to the company / role using the same selection rules as [prompt_rules.md](./prompt_rules.md).
   - Read [user_data/personal_info.json](../user_data/personal_info.json) for work history and work-auth context.
   - Read [form_rules.md](./form_rules.md) §3 for style rules (≤ 150 words, first-person, casual, real personal angle, no banned phrases).
   - Draft the answer obeying every constraint in §3a.

3. **Append each draft** to `user_data/pending_answers.json`. Preserve any existing unconsumed entries; if `id` already has an entry, replace it.
   ```json
   [
     {"id": "<original id>", "answer": "<draft>", "answered_at": "<iso 8601>"}
   ]
   ```

4. **Clear** `user_data/pending_questions.json` — set its content to `[]`.

5. **Report** `N processed` with a one-line summary per draft.

The user then switches to the ATS tab, opens the extension popup, and clicks **Fill answers in this tab** to insert the draft into the matching textarea.

## Why direct-write JSON, not HTTP

The local server reads from and writes to the same JSON files the agent edits. Going through HTTP adds a hop with no benefit and races against the extension's polling. Always edit the files directly.
