# SalesMate UI/UX Redesign — Design

**Date:** 2026-06-26
**Status:** Approved direction (dark-primary, clean fonts, emerald accent, startup-minimal)
**Goal:** Redesign the whole app to look like a clean modern SaaS startup (Linear/Vercel/Stripe vibe) — minimal but not over-styled, easy for non-technical sellers to use — on branch `feat/ui-redesign`, no production deploy yet.

---

## 1. Design Principles
- **Minimal, not flashy** — lots of whitespace, calm neutrals, one accent. Restraint over decoration.
- **One consistent system** — every screen uses the same primitives (Button, Card, Input, Badge, Toggle, Tabs, EmptyState, Modal). No one-off styles.
- **Hairline over heavy** — thin borders define surfaces; shadows used sparingly and softly.
- **Readable first** — clear hierarchy, generous line-height, legible Thai + Latin.
- **Subtle motion** — gentle fades/slides via framer-motion; never bouncy or distracting.
- **Mobile-friendly** — layouts collapse cleanly; touch targets ≥ 40px.

## 2. Visual Identity (locked)
- **Theme:** **dark-primary** (default) + a polished light mode via the existing class toggle. Default to dark when no stored preference.
- **Fonts:** `Inter` (Latin/numerals) + `IBM Plex Sans Thai` (Thai) via `next/font/google`. Stack: `Inter, "IBM Plex Sans Thai", system-ui, sans-serif` (Latin renders Inter; Thai glyphs fall back to Plex Thai). Clean, neutral — no display/geometric fonts.
- **Accent:** emerald (brand). `emerald-400 #34D399` on dark, `emerald-600 #059669` on light. Used only for primary actions + key numbers.

## 3. Color Tokens (CSS variables, flip on `.dark`)
Defined in `app/globals.css` and surfaced to Tailwind as semantic colors (`bg-app`, `bg-surface`, `bg-surface2`, `border-line`, `text-base`, `text-muted`, `accent`).

**Dark (default):**
| token | value | use |
|---|---|---|
| `--app` | `#0B0E12` | page background |
| `--surface` | `#14181D` | cards / panels |
| `--surface-2` | `#1B2127` | raised / hover |
| `--line` | `#232A31` | hairline borders |
| `--text` | `#E6E9ED` | primary text |
| `--text-muted` | `#9AA4B2` | secondary text |
| `--accent` | `#34D399` | accent / primary |
| `--accent-contrast` | `#04140D` | text on accent |

**Light:**
| token | value |
|---|---|
| `--app` | `#F7F8FA` |
| `--surface` | `#FFFFFF` |
| `--surface-2` | `#F1F3F5` |
| `--line` | `#E6E8EB` |
| `--text` | `#0F172A` |
| `--text-muted` | `#64748B` |
| `--accent` | `#059669` |
| `--accent-contrast` | `#FFFFFF` |

Radius scale: `rounded-lg` (8px) inputs, `rounded-xl` (12px) cards/buttons, `rounded-2xl` (16px) modals. Spacing: 4px base; sections use 16/20/24.

## 4. Component Primitives (`components/ui/`)
Small, focused, reusable — each one file:
- `Button.tsx` — variants `primary` (accent), `secondary` (surface+line), `ghost`, `danger`; sizes `sm`/`md`; loading state.
- `Card.tsx` — surface + hairline + padding; optional header.
- `Input.tsx` / `Textarea.tsx` — consistent field styling + focus ring (accent).
- `Field.tsx` — label + control + hint/error wrapper.
- `Badge.tsx` — neutral / accent / warn / danger pills.
- `Toggle.tsx` — replaces the ad-hoc `EnableToggle`.
- `Tabs.tsx` — segmented control for view switching where useful.
- `EmptyState.tsx` — icon + title + hint, used across empty lists.
- `Modal.tsx` — overlay + panel + close; reused by mock settings etc.
- `Stat.tsx` — label + big value + hint (used by the metrics tiles).

These wrap Tailwind semantic classes so a token change restyles the whole app.

## 5. Layout / Shell
- **Sidebar:** keep the hover-expand rail, restyle to the token system — logo top, nav items with icon+label, clear active state (accent left-bar + tint), account/logout at bottom. Cleaner icons.
- **Main:** consistent page container (max-width per view), a light page header (title + primary action) where it helps.
- **Inbox** (highest-traffic): cleaner 3-pane feel — app list / conversation list / chat thread; calmer message bubbles; AI controls grouped and clearer; tidy empty/loading states.

## 6. Scope & Phasing
Build the foundation first, then migrate screens (each phase independently reviewable):
- **Phase 1 — Foundation:** fonts, color tokens, Tailwind semantic colors, globals, default-dark; the `components/ui/` primitives.
- **Phase 2 — Shell:** layout container + Sidebar restyle; mount primitives.
- **Phase 3 — Inbox** (flagship daily screen).
- **Phase 4 — Catalog + Settings + metrics tiles + Mock modal.**
- **Phase 5 — Admin console + Auth pages polish** (login/signup/forgot already on-brand; align to tokens).

## 7. Constraints
- **No behavior/logic changes** — this is visual only; all existing flows, props, and API calls stay identical. (If a component must be restructured, keep the same inputs/outputs.)
- **No production deploy** — work on `feat/ui-redesign`; review via Vercel **Preview** (the user is cross-machine, so localhost isn't viewable — a preview URL is how they'll see it).
- **Keep it lint-clean** (`next build` runs ESLint) and type-safe; `npm run build` must pass each phase.
- Don't touch technical identifiers (cookie/env names). Keep Thai feature wording ("ขายพ่วง/คู่พ่วง").

## 8. Out of Scope
- New features or screens (redesign only).
- Marketing/landing site.
- Removing the light theme (kept, just secondary).
