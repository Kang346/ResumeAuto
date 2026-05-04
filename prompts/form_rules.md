# Form Filling Rules for Job Applications

> **For users**: Most of the section 1 / 2 defaults below need to be customized for your situation (work authorization, salary band, GPA, years of experience, etc.). Treat the values shipped here as placeholders — search for `# CUSTOMIZE` markers and replace.

## 1. Standard Defaults (Always apply unless overridden)

### Yes/No / Compliance Questions
| Question Pattern | Answer |
|---|---|
| Have you previously worked here / at this company? | No |
| Do you know anyone at [Company] / employee referral? | No |
| Are you related to any current employees? | No |
| Do you have any family members who are government officials? | No |
| Have you ever been convicted of a felony / crime? | No |
| Are you subject to any non-compete agreements? | No |
| Any other "do you know / are you related to" questions | No |

### Work Authorization (CUSTOMIZE for your situation)
The defaults below match a common case (international student on F-1 OPT requiring future H-1B sponsorship). Replace with your own values.

| Question Pattern | Answer |
|---|---|
| Authorized to work in the US? | Yes |
| Will you now or in the future require sponsorship? | Yes |
| Visa / work authorization type? | F1-OPT |
| OPT / CPT? | OPT |

### Location & Logistics
| Question Pattern | Answer |
|---|---|
| Willing to relocate? | Yes |
| Willing to work on-site / hybrid / in office? | Yes |
| Willing to travel? | Yes (up to 20%) |

---

## 2. Numeric / Date Fields (CUSTOMIZE)

- **Expected / Desired Salary**: 150,000 (or $150k). If range is required, use 130,000–160,000.
- **Start Date / Earliest Start Date**: Use the nearest Monday from today's date, or "2 weeks from today" if free text. If a dropdown, select the earliest available option.
- **Years of Experience**: Calculate from your resume. Round honestly.
- **GPA**: 3.8 (if asked) — replace with your own.

---

## 3. Open-Ended Questions

### 3.0 Universal voice rules (apply to ALL of 3a–3h)

These rules override anything below if there's a conflict.

- **Em-dash discipline**: at most ONE em-dash (—) per answer, and only when commas/periods genuinely don't work. The "clause — clause, but clause — punchline" pattern is the dead giveaway of LLM writing. Default to commas, periods, and short sentences. ZERO em-dashes is fine and often better.
- **Conversational, not literary**: write like the user is texting a friend in tech, not writing a personal essay. Short sentences are fine. Sentence fragments are fine when they sound natural.
- **Contractions expected**: `I'm`, `I've`, `don't`, `won't`, `it's`. Formal expansions read corporate.
- **Default to short**: most answers should be 40–80 words. Stretch toward the per-section cap (e.g. 150 in §3a) ONLY when the question explicitly asks for technical depth, scale, or context. The cap is a ceiling, not a target.
- **No softening throat-clearers**: skip `Honestly, ...`, `I would say ...`, `I think one of the things ...`, `So basically ...`. Just say the thing.
- **No LinkedIn-bro list openers**: avoid `A few things:`, `There's a couple reasons:`, `I'd love to share:`, `Some context:`. Start with the actual content.
- **No "in the X space" / "at scale" reflexes**: don't pad sentences with `in the AI space`, `at the cutting edge`, `at scale` unless they carry real meaning. They usually don't.

### 3a. "Why do you want to work here?" / "Why [Company]?" / "What excites you about this role?"

**Required process:**
1. **Search the web** for: `[Company] mission product culture`
2. Read what the company actually does — focus on their core product, recent launches, or stated mission.
3. Write a response that is:
   - **Casual and personal** — first person, conversational, not corporate-speak
   - **Under 150 words**
   - **Grounded in a genuine personal angle** — connect the company's product to the user's real life or interests. Examples of angles to use:
     - If it's an AI/automation company: "I spend a lot of time building and using AI agents in my own workflow, and what [Company] is doing with [product] is exactly the kind of thing I find myself wanting to exist."
     - If it's a consumer tech company: "I'm actually a user of [product] and have opinions about how it works — being able to work on something I use day to day is rare."
     - If it's infrastructure/dev tools: "I care a lot about the developer experience layer and [Company]'s approach to [X] is the direction I think the space is heading."
   - **Avoid**: generic phrases like "I'm passionate about innovation", "I admire your company culture", "I've always wanted to work at a fast-growing startup"

**Example output (illustrative):**
> "I've used [Product] for years and have opinions about how it works — getting to ship on something I actually rely on is rare. The thing that pulled me toward this role specifically is [team's stated focus]: [a one-sentence concrete reason it's interesting]. I want to work on a product I interact with in real life, where I can see the impact I'm having."

---

### 3b. "Tell us about yourself" / "Introduce yourself"
Pull from your resume summary. Keep it to 2–3 sentences: who you are (degree / current role), what you build, what kind of role-relevant area you're interested in.

### 3c. "What are your strengths?"
Pick 2–3 honest ones from your resume — examples: full-stack development, system design, fast learner, shipping end-to-end features, cross-stack flexibility.

### 3d. Cover Letter
- If **optional**: skip.
- If **required**: write 150–200 words using the same personal angle as 3a + 1 sentence on relevant technical background.

### 3e. "Where do you see yourself in 5 years?"
> "Honestly, building things that are actually used at scale. I'm more focused on the craft right now — shipping good software and understanding systems deeply — than on a specific title or path."

---

## 4. Fallback Rules

- **Unknown field / no clear mapping**: Leave blank, flag in output as `⚠️ UNFILLED: [field name]`
- **Dropdown with no matching option**: Select closest match, flag it
- **Essay question not covered above**: Generate a concise, honest answer based on JD context. Keep under 100 words.
- **Any legal / NDA / arbitration agreement checkbox**: Check (standard employment agreement, not unusual)
- **Salary negotiable?**: Yes

---

## 5. Fields to Never Fill / Always Skip
- SSN / Social Security Number → do not fill, flag as `🔒 STOP: requires SSN`
- Bank account / direct deposit → do not fill
- Background check authorization → leave for user to review
