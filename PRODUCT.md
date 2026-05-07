# Product

## Register

product

## Users

Primary: Chinese international students in US/CAN universities (CS undergraduate or master's), applying to software engineering roles during the new-grad / internship recruiting season.

Context of use:

- Late evenings during application crunch, applying to 5 to 15 jobs per session
- Multitasking heavily: 3 to 8 ATS tabs open (Workday, Greenhouse, Lever, Ashby), Notion in another tab tracking job pipeline, Claude Code in a terminal, sometimes a Slack-style community in the background
- Cognitive overload is the default state. The user is anxious about deadlines, about visa sponsorship constraints, about whether each submission "looks right"
- Sessions are fragmented: 30 seconds to 2 minutes per ATS-tab interaction, then context-switch

Job to be done: produce one tailored 1-page PDF per job in under 10 seconds, auto-fill the application form correctly, draft reasonable answers to open-ended prompts ("Why this company?", cover-letter blocks), and track what was applied to.

Secondary user (acknowledged but not primary): English-speaking job seekers using the tool informally. The product is dual-language but the surface is designed for the primary user's context.

## Product Purpose

ResumeAuto automates the high-volume mechanical work of software-engineering job hunts. A senior CS student in a normal recruiting season applies to roughly 100 to 300 roles. Each manual application is 15 to 30 minutes of repetitive work: rewriting the same resume bullets to match different keywords, retyping the same personal info into different ATS shapes, drafting variations on the same open-ended answers. The tool removes the mechanical 80% so the user can spend their attention on the signal-bearing 20%: which roles to actually apply to, and what to say in the interview if it lands.

Success looks like:

- A user can apply to 8 or more jobs in a single hour-long session with custom-tailored resumes and minimal manual typing
- The user trusts the tool enough to use it on the application they care about most, not just the long-tail throwaway ones
- The user feels less drained at the end of the session, not more

Failure looks like:

- The user spends time double-checking the tool's output because they don't trust it
- The tool's UI adds visual or cognitive load on top of the already-loud ATS pages
- The user reverts to manual filling because the tool was slower than typing

## Brand Personality

Three words: **precise, restrained, fast**.

Voice: direct, technical, treats the user as a competent peer who knows what an ATS is. No hand-holding, no "Welcome to AutoResume!" greetings, no marketing copy.

Tone in UI strings: factual and compact. "8 of 10 fields filled, 2 skipped" beats "Great job! We've successfully filled most of your form." Status reads like a transaction log, not a chatbot.

Emotional goals:

- **Confidence** that the action did what it said it did (form was filled, PDF was uploaded, draft was queued)
- **Calm** so the tool doesn't compound the user's existing application-day anxiety
- **Focus** so the tool gets out of the way of the actual ATS form

## Anti-references

- **Generic SaaS dashboard.** Indigo or violet primary, Inter typography, hero-metric template (big number plus small label plus supporting stats plus gradient icon), card-grid landing pages. This is the dominant aesthetic in the productivity-tool space and would make the product visually invisible.
- **Friendly AI mascot.** Bright pastel gradients, illustrated robot/hand/sparkle icons, decorative emoji, bouncy spring micro-interactions, copy in the "How can I help you today?" register. Notion AI's empty states, ChatGPT's onboarding, most "AI assistant" Chrome extensions.
- **The host ATS pages themselves.** Workday and Greenhouse are corporate-light (white background, blue/gray accents, system fonts, dense forms). The tool overlays these surfaces and must not blend into them; it should read as visibly distinct from the ATS underneath, not as a continuation of it.
- **Terminal/hacker aesthetic.** Green-on-black, ASCII decoration, monospace everywhere. Already saturated in the AI-tool category, signals "developer toy" rather than "production tool you trust with your career."

## Design Principles

1. **Show state, never decorate state.** A status indicator is data, not art. Hero-metric layouts (big checkmark plus large field count plus supporting stats) are banned. Status reads as compact text or a small mono summary. The user already saw their form fill in real time; the popup confirms what happened, it doesn't celebrate.

2. **Get out of the way.** The tool's UI competes with the ATS form for the user's attention, and the form should win. Default to a minimal footprint: an edge-anchored pill (ink-toned surface, brand-mark accent only — never a mascot color block) that the user can pop open into a panel when they need it. The heavy UI lives behind the pill, not in front of the form. Surface UI only when the user asks for it or when there's something they must act on.

3. **Press once, do everything.** One primary action per state. The current "Fill Page + Inject PDF + Save Job" three-button row asks the user to make a routing decision they shouldn't have to make. Fill Page should also inject the PDF; Save Job lives in a corner accessory slot, not in the main flow.

4. **Concrete over generic.** UI strings name what they actually mean. "GREENHOUSE / cresta.greenhouse.io" beats "Form detected." "8 of 10 filled, 2 skipped: phone, linkedin" beats "Mostly successful!" Mono labels for technical data signal "this is read, not marketed."

5. **Calm under pressure.** The user is overloaded before they open the popup. No urgent reds or oranges except for genuine errors. No animation that draws the eye except for the success/error state change itself. Reduced-motion respected by default.

## Accessibility & Inclusion

- **WCAG 2.1 AA.** Contrast ≥4.5:1 for body text, ≥3:1 for large text and interactive elements
- **prefers-reduced-motion respected by default.** No decorative motion in the reduced-motion mode; status transitions still happen but as instant color/text swaps, not animated
- **Color is never the only channel.** Every status carries an icon and a text label in addition to color, so deuteranopic / protanopic users see the state from icon shape and copy
- **Keyboard navigation.** All interactive elements reachable via Tab. ESC closes the expanded badge. Focus rings visible (not removed for "cleanliness")
- **No emoji in UI strings.** Emoji render inconsistently across OS and font stacks, and screen readers vary in how they announce them. Use Lucide SVG icons with text labels instead
- **Bilingual surface.** UI strings should work in both English (primary in the codebase for now) and Chinese (target audience speaks Chinese). Avoid idioms that only work in one language; design layouts that survive a 1.5x string-length expansion when translating
