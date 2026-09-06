# OctaPM product design system

The single reference for how OctaPM looks and behaves. Components consume the
semantic tokens defined here; they never hard-code a hex value or reach for a
Tailwind palette colour.

**Where it lives**

| Concern | File |
| --- | --- |
| Colour, typography, radius, shadow tokens | `frontend/src/styles/theme.css` |
| Base element styling, motif utilities | `frontend/src/styles/index.css` |
| Semantic status system | `frontend/src/lib/status.ts` |
| Calendar-date formatting | `frontend/src/lib/dates.ts` |
| Brand mark | `frontend/src/components/brand/octa-logo.tsx` |

---

## 1. Brand character

OctaPM should read as a **serious enterprise construction-control platform** —
confident, precise, engineered. Not a consumer app, not a startup dashboard, not
a generic admin template.

The product should be recognisable as OctaPM with the logo hidden, through the
Midnight Indigo foundation, Royal Blue and Azure interaction, disciplined
semantic status colour, the octagonal structural language, and Space Grotesk.

## 2. Colour

### Brand palette

| Token | Value | Use |
| --- | --- | --- |
| `--octa-midnight-indigo` | `#0F1B64` | Shell, rails, primary actions, headings, hierarchy |
| `--octa-royal-blue` | `#325FEC` | Supporting primary actions, selected navigation, active data |
| `--octa-azure` | `#3388FF` | Links, interactive states, focus rings, informational |
| `--octa-turquoise` | `#13C1CE` | Accent: calls to action, active states, highlights, key data points |
| `--octa-charcoal` | `#121B21` | Body text and icons. Never pure black |
| `--octa-light-gray` | `#DCDEDD` | Dividers, section grounds, framing, negative space |

Every value above is the official one from the brand book.

**One derived token.** Light Gray at full strength behind every panel reads as
heavy in a product people look at for hours, so large working surfaces take
`--octa-light-gray-soft` (`#F4F6FA`) and full-strength Light Gray does the
dividing and framing. Both are declared together in `theme.css`.

### Semantic feedback

| Token | Value | Meaning |
| --- | --- | --- |
| `--success` | `#26AC7A` | Completed, approved, healthy |
| `--warning` | `#FDC047` | Review, pending, attention |
| `--error` | `#F2445C` | Blocked, failed, critical |
| `--info` | `#3388FF` | Information, active process |
| `--octa-purple` | `#7D50F0` | Feature tags and badges only. Never dominant |

Each has a `-soft` ground and a `-foreground` text weight. Amber cannot carry
small text at brand value, so `--warning-foreground` is a darker amber that
meets contrast — the identity is preserved, the presentation is adjusted, per
the accessibility rule.

### Balance

The brand book's ratio: **60 Midnight Indigo / 20 Royal Blue / 10 Azure / 5
neutral (Light Gray and Charcoal) / 5 Turquoise**, with the accent explicitly
budgeted at 5–10% so it never overwhelms the identity.

Read it as a **hierarchy principle, not a per-screen quota**. Content areas stay
light for readability; the shell, navigation, selected states and emphasis carry
the brand. A Gantt chart or a budget table is not made 60% indigo. The marketing
page is where the ratio is most literally visible, and
`e2e/09-landing-brand.spec.ts` asserts that Turquoise there stays under 5% of the
painted page.

## 3. Typography

**Space Grotesk** is the brand typeface — chosen for sitting between a neutral
sans and a technology-driven face. **Inter** carries dense operational data,
where it is measurably more legible at small sizes.

| Role | Face | Weight | Applied |
| --- | --- | --- | --- |
| Wordmark | Space Grotesk | Bold, `-0.02em` | `OctaLogo` |
| Page and section titles | Space Grotesk | Bold / Medium | `h1`–`h4`, `.font-display` |
| Card titles, KPI figures | Space Grotesk | Medium | `.font-display` |
| Body, labels, captions | Inter | Regular | `body` default |
| Tables, forms, financials | Inter | Regular / Medium | default |

This follows the brief's rule that display lettering must not be used for long
tables, forms or body text. Numeric columns use `.octa-numeric` or
`[data-numeric]` for tabular figures and right alignment.

## 4. Geometry, spacing, elevation

- **Radius** `--radius: 0.5rem` — restrained, enterprise, not consumer-rounded.
- **Spacing** the Tailwind 4px scale. Card padding 12–16px; dense table rows
  target ~40px so a full BOQ stays scannable.
- **Elevation** three levels only: `--shadow-card` (a hairline lift on resting
  cards), `--shadow-raised` (popovers, dropdowns), `--shadow-overlay` (modals).
  Cards are **bordered, not floated**.

## 5. The octagonal motif

The brand geometry, used as a signature and never as noise.

| Utility | Use |
| --- | --- |
| `.octa-hero` | Indigo → Royal Blue → Azure gradient. Login, onboarding, welcome, occasional banners |
| `.octa-pattern` | Tiled octagon texture. Only over `.octa-hero` or an empty state |
| `.octa-tess` | The brand book's tessellation: octagons packed edge to edge, the gaps forming diamonds. Whole marketing grounds |
| `.octa-tess-ink` | The same tessellation in indigo, for a light ground |
| `.octa-notch` | Two corners chamfered at 45° — the brand's card geometry |
| `.octa-notch-all` | All eight sides: chips, tiles, buttons |
| `.octa-clip` | Octagonal clip for brand marks and premium surfaces |

`clip-path` removes a border along with the corner, so a **framed** notched
panel is two nested elements — the outer filled with the border colour, the
inner one pixel inside it. `Panel` in `features/landing/components/primitives`
does this. A notched button therefore takes a flat tint rather than an outline.

The tile is drawn as a `::before` layer, so its scale and strength change with
the surface: **104px at 0.5** on `.octa-hero` (the motif is the point there),
and a small corner watermark at **5%** on `.octa-card` (a signature, not a
texture). `.octa-card-plain` opts a card out entirely — use it for anything
sitting on ground that already carries the pattern.

**Never** behind Gantt, Budget, BOQ, Change Orders, Procurement, RFIs or
Drawings. On operational screens, data clarity outranks decoration.

### Signed-out surfaces

Sign-in, sign-up, Terms and Privacy are the one place the brand speaks at full
volume, because they are all a prospect sees before there is any data to show.
The rule for them:

- The hero ground covers the whole viewport, edge to edge — not a band, not a
  panel.
- The form sits on a light `.octa-card-plain` surface. Inputs must read
  normally; do not put fields directly on the gradient.
- Left column carries the promise (logo, headline, one paragraph); it drops
  below `lg`, where the form is the only job and the logo moves above it.
- Legal documents reuse the same ground as a header band, then switch to the
  ordinary reading surface — long prose on a gradient is unreadable.

## 6. Logo

The mark is **eight octagons arranged in a ring**: the same eight-sided module
repeated, leaving a negative space at the centre that reads as the letter O.
"Octa" comes from the Latin for eight, and the eight modules are the point.

The wordmark is the brand's **custom octagonal lettering**, not a font. Its
letterforms are chamfered from the same octagon.

Both are the real vectors from the supplied Illustrator artwork, carried across
exactly and held as path data in
`frontend/src/components/brand/octa-logo.tsx`. Standalone copies live in
`frontend/public/images/` — `octapm-mark.svg`, `octapm-wordmark.svg`,
`octapm-lockup.svg` — for the favicon and anything outside React.

- Use `<OctaLogo />` for the lockup, `markOnly` for the collapsed rail,
  `<OctaMark />` where only the ring is wanted.
- `surface="dark"` on indigo grounds; everything paints with `currentColor`, so
  it is never recoloured arbitrarily.
- **Never redraw either by hand, and never set "octapm" in Space Grotesk as a
  substitute.** A text fallback loses the chamfered letterforms, which is most
  of the identity. `e2e/09-landing-brand.spec.ts` guards this.
- Never stretched, distorted, shadowed, or rebuilt from a normal font. Only the
  height varies.

## 7. Buttons

| Variant | Treatment | Use |
| --- | --- | --- |
| Primary | Midnight Indigo fill, white text | The one main action per view |
| Secondary | White surface, brand border and text | Supporting actions |
| Ghost / tertiary | No fill, Charcoal text | Low-emphasis, table row actions |
| Destructive | Error Red fill | Delete, void, reject |
| Success | Success Green fill | Only where semantics demand it — approve, certify |

Not every action is a filled primary. A view with five filled buttons has no
hierarchy.

## 8. Status

Semantics are fixed product-wide and applied through `lib/status.ts`:

```ts
statusBadge(tone)   // soft ground + accessible text + hairline
statusStripe(tone)  // 3px leading edge on a card or row
statusIcon(tone)    // icon or dot only
toneForStatus(str)  // maps backend status strings to a tone
```

Status is carried by **icon, badge and a small accent** — never by flooding a
card background. The Setup Readiness cards are the reference implementation: a
3px stripe on the leading edge, a badge top-right, and a neutral card surface.

## 9. Cards and tables

**Cards** — 1px border, `--shadow-card`, `--radius`, no gradient, no heavy
shadow, no oversized radius.

**Tables** are critical to this product. Consistent across BOQ, Budget, Change
Orders, Procurement, RFIs, Submittals, Cost, Bids and Reports:

- Charcoal data on white; brand colour only for interactive and selected states
- Sticky headers on long registers
- Right-aligned monetary values with tabular figures and thousand separators
- Hover: `--accent` at low opacity. Selected: `--selected` with a Royal Blue
  leading indicator
- Row actions right-aligned, ghost buttons
- Status via badge, never a full-row colour wash

## 10. Financial presentation

- Right-align money; use `.octa-numeric` so digits align
- Strong totals; subtle variance colour
- **Never colour alone** — pair with a sign, an arrow or a label, so meaning
  survives for a colour-blind reader and in print. `varianceTone()` gives the
  tone; the component supplies the sign

## 11. Navigation

**Application shell** — top navbar, light surface, brand mark at the leading
edge, Azure focus rings. The nav scrolls within itself rather than pushing the
page sideways.

**Project Modules, expanded** — light card surface, Charcoal labels, Midnight
Indigo category heading, a 3px Royal Blue leading indicator plus a tinted row
for the active item. Identifiable without an oversized dark block.

**Project Modules, collapsed (Focus Mode)** — a Midnight Indigo rail, white
icons, an Azure leading indicator on the active item, tooltips on hover. This is
where the shell asserts the brand hardest, and it buys back working width for
Gantt, Budget, BOQ, Cost, Procurement, Reports, BIM and Drawings.

Both collapse states persist per browser in `localStorage`
(`octa.project.nav.collapsed`, `octa.project.readiness.collapsed`).

## 12. Collapsible panels

Setup Readiness demonstrates the pattern:

- **Expanded** full step cards, gate badges, progress bar, next action
- **Collapsed** one compact status bar — title, gate badges, `5/10 complete`,
  blockers in red, warnings in amber, a chevron. No excessive pills

## 13. Responsive

| Breakpoint | Behaviour |
| --- | --- |
| Desktop ≥1280px | Full nav; Focus Mode optional |
| Laptop 1024–1280px | Same; Focus Mode recommended for Gantt and Budget |
| Tablet 768–1024px | Module nav above content; top nav scrolls within itself |
| Mobile <768px | Branded drawer; single column; page never scrolls sideways |

The page body must never scroll horizontally. Wide content — tables, Gantt,
diagrams — scrolls inside its own `overflow-x-auto` container.

## 14. Accessibility

- Brand colours are never altered to reach contrast. Adjust the background,
  text colour, size, weight or border instead — as `--warning-foreground` does
- Every interactive element has a visible focus ring (`--ring`, Azure)
- Status is never colour alone: icon plus text always accompany it
- Respect `prefers-reduced-motion`

## 15. Adding to the system

1. Never write a hex value in a component. Add a token here first.
2. Never use a Tailwind palette colour (`emerald-500`, `slate-300`). Use a
   semantic token.
3. New status? Map it in `toneForStatus`, do not invent a colour.
4. New module? It uses the same tokens, tables, cards and navigation as every
   other. OctaPM is one system, not a suite of separate applications.
