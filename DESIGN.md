# Design System — AI Interview

> Source of truth for every visual/UI decision. The values here mirror the live
> tokens in `app/globals.css` and the font setup in `app/layout.tsx`. Change
> tokens there and update this file in the same commit.

## Product Context
- **What this is:** A voice AI that runs a real, role-specific job interview from your CV + the job description, then hands you a scored report.
- **Who it's for:** Candidates practicing for a specific role; the owner views aggregate metrics at `/admin`.
- **Space/industry:** Interview prep / hiring tools.
- **Project type:** Web app (Next.js App Router) — task-focused, a few single-purpose screens (intake, voice interview, report, admin).

## Aesthetic Direction
- **Direction:** Warm, modern, editorial — modeled on hexa.com.
- **Decoration level:** Intentional. A pink→orange gradient does the heavy lifting; no blobs, no icon-in-circle grids, no decorative noise.
- **Mood (the memorable thing):** Premium & modern. In the first 3 seconds it should feel like a sharp, confident product worth trusting with your prep — not a generic SaaS template.
- **Reference:** https://www.hexa.com (hero gradient `linear-gradient(45deg, #ff9cdf, #fb8144)`, black pill buttons, bold grotesque type).

## Typography
Headings use a distinctive display face; body/UI stays on a clean neutral sans. This pairing is the main signal that the type is deliberate, not defaulted.
- **Display / headings:** Space Grotesk (weights 500/600/700), `letter-spacing: -0.02em`. Applied to every `h1` via a global rule. Chosen to echo Hexa's clean grotesque. (Note: it's a popular pick — kept deliberately; if it ever feels generic, candidates are General Sans, Cabinet Grotesk, or Fraunces.)
- **Body / UI:** Geist.
- **Data / tables:** Geist (use `font-variant-numeric: tabular-nums` for number columns).
- **Code:** Geist Mono.
- **Loading:** `next/font/google` in `app/layout.tsx`, exposed as `--font-space-grotesk`, `--font-geist-sans`, `--font-geist-mono`.
- **CSS variables:** `--font-display`, `--font-body`, `--font-mono`.
- **Scale (px):** hero 38 · screen title 28–30 · section 15–16 (600) · body 15–16 · eyebrow/label 12–13 uppercase. Headings tracking `-0.02em`; body line-height ~1.55.

## Color
Light theme only (`color-scheme: light`). The interview screen is its own warm gradient stage (see Surfaces of meaning).
- **Approach:** Restrained — warm neutrals + one coral accent. Primary actions are near-black pills, not colored buttons.
- **Surfaces:** `--bg #f4f2ee` · `--bg-tint #ece8e0` · `--surface #ffffff` · `--line #e8e3d9`
- **Text:** `--ink #1a1410` · `--muted #6d655c`
- **Accent (coral):** `--accent #fb6a3c` · `--accent-press #e2542a` · `--accent-soft #fff1ea` — links, focus rings, small highlights. Never the primary button fill.
- **Buttons:** `--btn #1a1014` (near-black pill, white text) · `--btn-press #000000`
- **Semantic:** `--danger #cf4040` · success/ok surface `--ok-soft #eef6ee`
- **Hero wash:** `--hero: radial-gradient(120% 85% at 50% -12%, #ffc9e6 0%, #ffd7c0 24%, var(--bg) 56%)` — home + admin gate backdrops.
- **Interview stage:** `linear-gradient(135deg, #ff9cdf 0%, #fb8144 100%)` with a soft white center glow; text in `#2a1622`; the orb is a glowing cream sphere (`#fff6ee → #ffd9c2 → #fbb38b`, brighter while the agent speaks).

## Spacing
- **Base unit:** 4px.
- **Density:** Comfortable.
- **Scale:** 4 · 8 · 12 · 14 · 16 · 18 · 24 · 32 · 48.
- **Page padding:** ~24px gutters; content columns ~540–920px max.

## Layout
- **Approach:** Hybrid — centered single-focus compositions for the action screens (intake card, interview stage), simple top-aligned columns for content (admin metrics, report).
- **Max content width:** intake 540 · report 760 · admin 920.
- **Border radius:** `--radius-sm 10` · `--radius 14` · `--radius-lg 24` · pills `999`.
- **Depth:** `--shadow-sm` for cards, `--shadow` for the elevated hero card.
- **Focus:** every interactive element gets `--ring: 0 0 0 3px rgba(251,106,60,.3)` via `:focus-visible` (never remove outlines without this).

## Components
- **Primary button:** near-black pill (`--btn`), white text, `border-radius: 999`, ~14×22px padding. Used for the main action on every screen ("Start interview", "Unlock", "Take another interview").
- **Ghost button:** `--surface` fill, `1px --line` border, pill — secondary actions ("Download PDF").
- **Card:** `--surface`, `1px --line`, `--radius`/`--radius-lg`, `--shadow-sm`/`--shadow`.
- **Input / textarea:** `#fcfcfb` fill, `1px --line`, `--radius-sm`, warm focus ring.
- **Eyebrow / label:** 0.75rem, 600, `letter-spacing .03em`, uppercase, `--muted`.
- **Orb (interview):** glowing cream sphere driven by the agent's audio level; the product's one "alive" element.

## Motion
- **Approach:** Minimal-functional. Buttons/inputs transition color + ring (~0.15s). The orb scales with live audio.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` disables animation/transition globally — keep it that way.

## Print (report → PDF)
`@media print` hides `.no-print` (the action bar) and forces a white background so the saved PDF is just the report.

## Anti-slop guardrails (this project must never)
- Purple/indigo or blue→purple gradients (we are warm pink→orange).
- 3-column icon-in-circle feature grids, decorative blobs, wavy dividers, emoji-as-decoration.
- `system-ui`/Arial/Inter as the primary font.
- Colored-left-border cards or colored primary buttons (primary = black pill).
- Generic copy ("Welcome to…", "Unlock the power of…"). Keep it specific and product-led.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-07 | Initial design system documented | Codifies the deployed Hexa-inspired theme (PRs #14–#18) as the source of truth. Mood: premium & modern. |
