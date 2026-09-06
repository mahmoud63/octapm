# OctaPM UI brand audit

**Date** 2026-09-06 · **Scope** the React application, audited after installing
the brand token system and rebuilding the Project Modules navigation and Setup
Readiness panel.

Classification: ✅ brand aligned · 🟡 minor inconsistency ·
🟠 significant inconsistency · 🔴 requires redesign

---

## Measured drift

Counted across `frontend/src`, not estimated:

| Measure | Count |
| --- | ---: |
| Files using Tailwind palette colours (`emerald-500`, `slate-300`, …) | **48** |
| Total palette-colour occurrences | **351** |
| Hard-coded hex values in components | **161** |
| Files migrated to semantic tokens in this pass | 5 |

Before this pass the theme was the **stock shadcn admin palette** — a generic
neutral ramp with no relationship to OctaPM. That is now replaced, so every
component that already used semantic tokens (`bg-primary`, `text-muted-
foreground`, `border`) inherited the brand for free. The 351 occurrences above
are the components that bypassed the token layer and still need migrating.

## Area by area

| Area | Status | Notes |
| --- | --- | --- |
| Design tokens | ✅ | Brand, semantic, status, shell and chart tokens in `theme.css`; three layers, one source of truth |
| Typography | ✅ | Space Grotesk for brand and headings, Inter for dense data |
| Logo | ✅ | Octagonal mark asset + `OctaLogo`; used in top navbar, mobile drawer, sidebar title |
| Setup Readiness | ✅ | Semantic tones, stripe-and-badge treatment, collapsible status bar |
| Project Modules nav | ✅ | Light expanded surface, Midnight Indigo Focus Mode rail, Azure indicator, persisted |
| Application shell / top nav | 🟡 | Brand mark and tokens correct; nav now scrolls within itself. Could carry more Midnight Indigo |
| Buttons | 🟡 | Inherit brand tokens correctly, but variants are not yet consistently chosen — filled primaries are overused in places |
| Cards | ✅ | Bordered, hairline shadow, restrained radius |
| Budget / cost tables | 🟡 | Dense and readable, right-aligned tabular figures; some hardcoded status colours remain |
| Change Order register | 🟠 | 24 palette-colour occurrences; status treatment not yet on `lib/status.ts` |
| Risk register | 🟠 | 25 occurrences; severity colours invented locally |
| Long-lead table | 🟠 | 14 occurrences |
| Activity / project status badges | 🟠 | 28 occurrences across two badge components — these define status colour for much of the product and should be the first migration |
| Schedule dashboard | 🔴 | 63 occurrences, the single largest concentration. A dense analytics screen with its own colour vocabulary |
| Gantt chart | 🔴 | 19 occurrences, plus bar colours chosen independently of the chart ramp |
| EV dashboard / EV report | 🟠 | 23 across both; KPI colours not from tokens |
| Workspace dashboard | 🟠 | 12 occurrences; KPI cards otherwise strong — each cites its source and cutoff |
| Dark mode | 🟡 | Fully redefined for the brand, but only spot-checked visually |
| Responsive | ✅ | Tablet and mobile verified with no horizontal overflow |
| Octagonal motif | 🟡 | Utilities exist (`.octa-hero`, `.octa-pattern`, `.octa-clip`); applied to the mark, not yet to login or empty states |

## Recommendations

### P0 — usability and accessibility

1. **Migrate the two status-badge components** (`activity-status-badge`,
   `project-status-badge`, 28 occurrences). They set the status vocabulary the
   rest of the product copies; fixing them propagates furthest.
2. **Audit contrast on migrated surfaces.** `--warning-foreground` was already
   darkened because brand amber cannot carry small text. Other soft grounds
   need the same check.
3. **Financial colour must never stand alone.** `varianceTone()` exists; the
   consuming components must add the sign or arrow alongside it.

### P1 — major product consistency

4. **Schedule dashboard and Gantt** (82 occurrences). The largest visual
   divergence, and the screens a planner lives in. Move bar and status colours
   onto `--chart-*` and `lib/status.ts`.
5. **Change Order, Risk and Long-lead registers** (63 occurrences). Commercial
   screens where status colour carries contractual meaning.
6. **Standardise button hierarchy.** One filled primary per view.
7. **Adopt a shared table shell** so BOQ, Budget, Change Orders, Procurement,
   RFIs, Submittals and Bids share sticky headers, hover, selected state,
   numeric alignment and row actions.

### P2 — visual refinement

8. Retire the remaining 161 hard-coded hex values.
9. Apply `.octa-hero` and `.octa-pattern` to login, onboarding and empty states
   — currently the motif appears only in the mark.
10. Bring more Midnight Indigo into the application shell so the brand reads
    before the logo does.
11. Review dark mode screen by screen; it has been redefined but not walked.

### P3 — optional polish

12. ~~Replace the leftover template favicons with OctaPM assets.~~ **Done.**
    The favicon, the two PWA icons and the maskable icon are now the brand
    book's app icon — the eight-octagon ring in white on the Midnight Indigo to
    Turquoise gradient. Because that tile carries its own ground, the separate
    inverted `favicon_light.*` pair was removed rather than redrawn.
    The `shadcn-admin.png` social preview is still the template's.
13. Consider Space Grotesk Light for long-form body copy, per the brand
    material, where density allows.
14. Motion: a short, consistent transition on collapse and selection.

## What must not regress

The brief is explicit that branding must not cost function. Verified in this
pass:

- The budget table stays dense and readable; Focus Mode **increases** working
  width rather than reducing it
- Status still communicates through icon **and** text, not colour alone
- No page scrolls horizontally at tablet or mobile
- Navigation speed is unchanged; collapse state is remembered so a planner is
  not re-expanded on every visit

## Method note

This audit deliberately does **not** redesign every screen. The token layer was
installed first, which moved every component already using semantic tokens onto
the brand at no cost. What remains is the enumerated list above — real files,
real counts, prioritised by how far each fix propagates.
