# InvoiceTracker design system

The design system for the InvoiceTracker redesign: three core features in one workspace, with no sidebar.

**Source of truth.** Only the **Home** page and the **Customers** pages (the directory and the customer page) are trusted. Everything below is read from their code and the components they use.

Those pages are parked while the app is cut back. Their files are:

- `src/_parked/app/styles/home.css`
- `src/_parked/app/styles/customers.css`
- `src/_parked/components/pages/HomeView.tsx`
- `src/_parked/components/pages/customers/CustomersView.tsx` and `CustomerView.tsx`
- `src/components/shell/Header.tsx`
- `src/components/bits.tsx` (`CustomerIcon`)
- `src/components/icons.tsx`
- the tokens in `src/app/globals.css`

Other screens differ in many places; those differences are listed under [Deviations — do not adopt](#deviations--do-not-adopt).

Values are given as they are in the code. A **Proposed** note marks where a value should change to meet the palette rule (neutrals plus exactly three accents). No new colours are introduced.

---

## 1. Colour

All tokens are CSS custom properties on `:root` in `src/app/globals.css`, plus two hard-coded surfaces in the Home and Customers stylesheets. Contrast ratios are WCAG 2.x against the background named.

### 1.1 Neutrals (light theme)

| Token | Hex | Role | Where Home/Customers use it |
|---|---|---|---|
| `--bg` | `#FAF5EE` | Cream app background | Behind the page frame; body background. |
| *(hard-coded)* `--hm-bg` / `--cu-bg` | `#FFFFFF` | White page surface and card background | Main content area, header bar, every section card, due cards, search input, pressed segment, note input. |
| `--panel` | `#FFFDF9` | Off-white surface (global) | Base of the sticky header before Home/Customers override it. Dark-theme surface. |
| *(hard-coded)* `--cu-tint` | `#FAF7F2` | Light warm tint | Customer page side panel; segmented-control track. |
| `--panel2` | `#F2E9DC` | Warm grey fill | Neutral count pill and neutral status pill background; delivery-destination tags. |
| `--hover` | `#F5EDE2` | Hover fill | Row, due-card, ghost-button and segment hover. |
| `--sel` | `#EBE0D1` | Selected fill | Active sidebar item (sidebar is parked). |
| `--railbg` | `#F3ECE1` | Sidebar tint | Sidebar background (parked). |
| `--line` | `#E6DBD0` | Warm-grey border and divider | 1px card borders, table row dividers, panel group dividers, search border, segmented border. |
| `--line2` | `#D4C5B6` | Stronger warm grey | Timeline connector, chart bars, hovered card border. |
| `--ink` | `#2A1C15` | Primary text | Headings, body, names, values. 16.5:1 on white. |
| `--ink2` | `#665247` | Muted text and icons | Labels, sub-lines, column headers, empty states, every grey line icon. 7.3:1 on white, 6.1:1 on `--panel2`. |
| `--ink3` | `#947E72` | Faint | **Not for text** (3.8:1 on white fails AA). Home/Customers use it once: the latest-week bar in the orders-per-week chart. |

**Proposed:**

- `#FFFDF9` (`--panel`) and `#FFFFFF` are near-identical whites. Collapse them into one surface token, `#FFFFFF`, which is the white the trusted pages actually use.
- `#FAF7F2` is a one-off tint. Collapse it into `--bg` `#FAF5EE`.
- `--band` (`#F5EDE2`) is identical to `--hover`. Keep `--hover` only.

### 1.2 Accent 1: terracotta (actions, links, focus)

| Token | Hex | Role | Where used |
|---|---|---|---|
| `--accent` | `#B84A27` | Primary actions, text links, text actions, focus ring | Filled "Upload invoice" button; "Review →", "Resolve →", "View order →", "View all activity →", "All n orders →"; "Copy contact"; Add-note button text; breadcrumb and link hover; 2px focus ring. 5.2:1 on white. |
| `--accent-fg` | `#FFFDF9` | Text and icons on a terracotta fill | Label of the filled "Upload invoice" button. |

The approved design mockups draw terracotta as `#A8481F`; the code uses `#B84A27`.

**Proposed:** keep `#B84A27` (it is in the code and passes AA). Treat `#A8481F` as a mockup approximation, not a second shade.

### 1.3 Accent 2: amber (attention, discrepancies)

| Token | Hex | Role | Where used |
|---|---|---|---|
| `--warn` | `#9A5B0A` | Amber text, dot and pill text | "Awaiting review" and "Needs attention" count pills; "Needs check", "Blocked" and "Overdue" status pills; the amber dot and text of the attention line. 5.4:1 on white, 4.6:1 on `--warn-soft`. |
| `--warn-soft` | `#F9EBD2` | Amber pill tint | Background of amber pills. |

### 1.4 Accent 3: green (success, matched, resolved)

| Token | Hex | Role | Where used |
|---|---|---|---|
| `--good` | `#2D6A3E` | Green text and check icon | "Confirmed" status pill text; the ✓ in "No issues on open orders". 5.6:1 on `--good-soft`. |
| `--good-soft` | `#E3F2E7` | Green pill tint | Background of green pills. |

### 1.5 Pill tints at a glance

| Pill | Background | Text |
|---|---|---|
| Neutral (counts, Delivered, Draft) | `--panel2` `#F2E9DC` | `--ink2` `#665247` |
| Amber (attention) | `--warn-soft` `#F9EBD2` | `--warn` `#9A5B0A` |
| Green (success) | `--good-soft` `#E3F2E7` | `--good` `#2D6A3E` |

### 1.6 Other hues in the code: flag and collapse

None of these appear on Home or Customers.

| Token / source | Hex | Used on | Proposed |
|---|---|---|---|
| `--bad` / `--bad-soft` | `#A82020` / `#FBE6E6` | Red "Blocked" and "Overdue" labels, alerts, Invoices and Orders | Collapse into **amber** (`--warn` / `--warn-soft`): these are attention states. |
| `--info` / `--info-soft` | `#2B5B84` / `#E4EEF7` | **Global focus ring**, "Draft" label, unread dots, Invoices | Focus ring becomes **terracotta**. Labels and dots become **neutral** (`--ink2` / `--panel2`). |
| `--purple` / `--purple-soft` | `#62479E` / `#ECE6F3` | Invoices | Collapse into **neutral**. |
| `--flag` / `--flag-ink` | `#FED7AA` / `#9A3412` | Flagged cells (Orders and Invoices) | Collapse into **amber** (`--warn-soft` / `--warn`). |
| `--leaf1` | `#6FB583` | Assistant seedling animation (parked) | Collapse into **green** `--good`. |
| `--leaf2` | `#2D6A3E` | Same | Identical to `--good`. Drop it. |
| Customer brand colours in `src/sample/customers.ts` (`#2563EB`, `#7C3AED`, `#059669`, `#D97706`, `#DB2777`) | — | Tinted customer marks on Orders and the order page | Do not use. Customer icons are plain grey line icons (`--ink2`). |
| Dark theme (`:root[data-theme="dark"]`) | `--accent: #10B981` | Whole app in dark mode | Its accent is **green**, so actions and success share a hue and terracotta disappears. The trusted pages were designed in light mode only. Dark mode needs its own pass before it is part of the system. |

---

## 2. Typography

### 2.1 Families and loading

- **Sans:** `Geist`. Token `--sans`: `"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.
- **Mono:** `Geist Mono`. Token `--mono`: `"Geist Mono", ui-monospace, Menlo, Consolas, monospace`. Used for IDs such as the customer ID.
- **Loading:** a Google Fonts CSS `<link>` in `src/app/layout.tsx`, deliberately not `next/font`. The comment there explains that `next/font`'s metric-adjusted Arial fallback changes how glyphs Geist lacks (→, ⌘) are drawn. The link is:

  ```
  https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap
  ```

- **Loaded weights:** Geist **400, 500, 600** and Geist Mono **400, 500**. Weight 700 is not loaded; see [Inconsistencies](#7-inconsistencies-inside-homecustomers).
- **Global body:** `13px / 1.45`, `letter-spacing: -.005em`, antialiased. Home and Customers raise their content to **14px**.

### 2.2 Type scale used by Home/Customers

| Role | Size / weight / line height | Extra | Example |
|---|---|---|---|
| Page title (H1) | **30px** / 600 / 1.15 | `letter-spacing: -.02em`. **26px** at ≤760px. | "Welcome back, May", "Customers", "Harbour Hotel" |
| Big number | **26px** / 600 / 1.2 on Home due cards; **22px** / 700 in Customers stats | `-.02em` / `-.01em`, tabular numbers | Due-card counts, "Last 30 days" stats |
| Section heading (H2) | **18px** / 600 | `letter-spacing: -.01em` | "Awaiting review", "Open orders" |
| Panel group heading (H3) | **17px** / 700 | — | "Contact", "Delivery", "Billing" |
| Header bar title | **15px** / 500 (Home) or 600 (Customers, mobile) | — | Date on Home; page name on mobile |
| Body | **14px** / 400, line height 1.45 (inherited) | — | Table cells, issue text, facts |
| Emphasis in body | 14px / **600** | — | Customer names, order refs |
| Text action / link | 14px / **600**, `--accent` | Arrow icon after | "Review →" |
| Small / muted | **12.5–13px** / 400, `--ink2` | — | Order refs under names, sub-lines, timestamps |
| Label | **12.5–13px** / 400, `--ink2` | — | Column headers, stat labels, card labels |
| Pill | **12.5px** / **600** | tabular numbers | Count and status pills |
| Chart axis label | **12px** / 400, `--ink2` | — | Week labels |

---

## 3. Spacing, radii, borders, shadows

### 3.1 Spacing

There is no spacing token. These values recur:

| Use | Desktop | ≤760px |
|---|---|---|
| Page padding | **32px** | **16px** sides (Home: `20px 16px 32px`; Customers: `16px 16px 32px`) |
| Gap between the two columns | **24px** | stacked, **16px** |
| Gap between section cards | **20px** | **16px** |
| Card padding | **20px 24px** (Home tables: `20px 24px 8px`) | **16px** |
| Due card padding | **18px 20px** | `14px 16px` |
| Table row padding | **12px** vertical (directory rows: `14px 12px`) | `12–14px` vertical |
| Card heading to content | **8–10px** | same |
| Icon to text | **12–14px** | same |
| Small gaps | 2, 4, 6, 8, 10px | — |

The effective scale is 2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 32.

### 3.2 Radii

| Radius | Used for |
|---|---|
| **12px** | Section cards, due cards, the side panel |
| **10px** | Search input, segmented-control track, filled primary button |
| **8px** | Segment buttons, ghost header buttons, note input and Add button, directory row hover |
| **6px** | Delivery tags; focus-ring corners |
| **999px** | Pills |
| **4px** | Chart bars |
| **50%** | Amber attention dot |

### 3.3 Borders and dividers

- Everything is **1px solid `--line`** (`#E6DBD0`): card borders, row dividers, panel group dividers, input borders.
- The timeline connector and chart bars use `--line2` (`#D4C5B6`).
- Hovered due cards darken their border to `--line2`. A focused search box turns its border `--accent`.

### 3.4 Shadows

**None.** Home and Customers are flat. Separation comes from 1px borders and white-on-cream only. (Other screens use `--shadow` and coloured drop shadows; see Deviations.)

### 3.5 Focus

- `outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px` on every link, button and input.
- It is scoped to the Home and Customers pages. The global default is blue; see Deviations.

### 3.6 Touch targets and breakpoint

- Every interactive element is at least **44px** tall on mobile. The only exceptions are desktop table sort buttons (32px) and segments (34–38px), which grow to 44px on mobile.
- There is **one** breakpoint: `max-width: 760px`.

---

## 4. Icons

- **Library:** in-house, `src/components/icons.tsx`, ported path for path from the approved prototype's icon set. There is no external icon package.
- **Drawing:**
  - 24×24 `viewBox`, `fill: none`, `stroke: currentColor`.
  - **stroke-width 1.6**, round caps and joins.
  - `aria-hidden="true"`; class `i`.
  - Default size **16px**.
- **Sizes on Home/Customers:**
  - 22px for customer icons and calendar icons.
  - 20px for next-action icons and timeline icons. The 20px timeline slot holds an 18px glyph.
  - 18px for header and side-panel fact icons.
  - 16px for arrows and chevrons.
  - The chevron is always drawn at 10px by the `Icon` component.
  - Arrows (→) use **stroke-width 2**.
- **Colour:** plain grey, `--ink2`, with **no** tinted background. Icons inside terracotta text actions inherit `--accent`.
- **Customer icons:** each customer's own line drawing from the data (`customer.logo`, 24×24 SVG paths), drawn by `CustomerIcon` in `src/components/bits.tsx` in `--ink2` at stroke 1.6. The fallback is the `building` icon.
- **Accessibility:** icons beside visible text are decorative. Side-panel fact icons carry `role="img"` and an `aria-label` ("Contact", "Payment terms" and so on).

---

## 5. Component inventory (Home and Customers)

Paths are where the code lives now. Home and Customers are parked; see `src/_parked/README.md`.

### Buttons and actions

| Variant | Class / file | Spec |
|---|---|---|
| **Primary (filled)** | `.pa-up`: `src/_parked/components/shell/PageActions.tsx`, `customers.css` | `--accent` fill, `--accent-fg` text, 600 weight, 40px tall, padding `0 16px`, radius 10px, leading icon. On mobile: icon only, 44×44, with `aria-label`. |
| **Ghost (header)** | `.hm-hand` (Home), `.pa-hand` / `.pa-ask` (Customers) | Transparent, `--ink` text, 500 weight, 44px tall, padding `0 10px`, radius 8px, `--hover` on hover, leading icon. |
| **Text action** | `.hm-go`, `.cu-go` | `--accent`, 600 weight, 44px tall, trailing → (16px, stroke 2), underline on hover. "Review", "Resolve", "View order", "View all activity", "All n orders". |
| **Text button** | `.cu-copy` | Same as the text action, with a leading icon ("Copy contact"). |
| **Secondary (outlined)** | `.cu-note button` | White fill, 1px `--line` border, radius 8px, 44px, `--accent` 600 text ("Add"). |
| **Sort header** | `.cu-sort` | Column label plus a chevron in `--ink2`; a faded chevron when not active; `aria-sort` on the column header. |

### Inputs

| Component | Class / file | Spec |
|---|---|---|
| **Search** | `.cu-search`: `CustomersView.tsx` | 44px, 1px `--line`, radius 10px, white, 18px search icon in `--ink2`, `type="search"`, visually hidden `<label>` text. The border turns `--accent` on focus-within. Max width 420px; full width on mobile. |
| **Text input + button** | `.cu-note`: `CustomerView.tsx` | 44px input, 1px `--line`, radius 8px, visually hidden label, Enter submits; outlined Add button beside it. |

### Segmented toggle

`.cu-seg` (directory "All n / Needs attention n") and `.cu-seg.sm` (Activity filter) in the Customers views.

- **Track:** padding 3px, 1px `--line`, radius 10px, `--cu-tint` fill.
- **Segments:**
  - Transparent buttons, radius 8px, 38px tall (34px for `.sm`; 44px on mobile).
  - The pressed segment gets a white fill, a 1px `--line` border and weight 600.
  - `aria-pressed`, inside `role="group"` with an `aria-label`.
- **Counts:** muted `--ink2` text, or an amber pill for the attention count.

### Pills

`.hm-pill` and `.cu-pill`: identical rules in two files.

- **Shape:** 12.5px / 600, padding `2px 10px`, radius 999px, tabular numbers, no icon.
- **Count pill:** neutral or amber, beside a section heading. Carries visually hidden text so it reads "2 orders".
- **Status pill:** text only. Green "Confirmed"; amber "Needs check", "Blocked", "Overdue"; neutral "Delivered", "Draft". Labels come from the data model.

### Attention line

`.cu-issue` (directory cell) and `.cu-issues` (under the Open orders table):

- an 8px amber dot (`--warn`, radius 50%);
- the real issue text in `--warn` at 13px, for example "Missing SKU on line 2" or "Quantity changed from 4 to 6";
- under the open-orders table, a terracotta "Review →" or "Resolve →" action.

The calm counterpart is `.cu-ok`: a green ✓ and "No issues on open orders" in `--ink2`.

### Section cards

`.hm-card` and `.cu-card`:

- **Card:** white, 1px `--line`, radius 12px, padding `20px 24px`, no shadow.
- **Header row** (`.hm-ch` / `.cu-ch`): H2 (18px / 600), then an optional pill, then an optional right-aligned action (text link or segmented control).

### Due cards (Home)

`.hm-dc`. Each card is a whole-card link:

- **Layout:** 22px calendar icon on the left (`--ink2`); then a label (13px `--ink2`), a big count (26px / 600) and customer names (13px `--ink2`, ellipsis).
- **Grid:** `repeat(auto-fit, minmax(180px, 1fr))`, gap 12px; a single column on mobile.

### Stats strip and chart (customer page)

- **Stats strip** (`.cu-stats`, a `<dl>`):
  - 4–5 equal columns with 1px `--line` dividers and no icons.
  - Label 13px `--ink2`; value 22px / 700.
  - Two per row on mobile.
- **Bar chart** (`.cu-bars`):
  - Six weekly bars, 48px tall, radius 4px; `--line2` with the latest week in `--ink3`.
  - Labels 12px `--ink2`.
  - `role="img"` with a full-sentence `aria-label`, plus a `title` per bar.

### Tables and rows

All of these are CSS grid rows built with ARIA table roles (`role="table" / "row" / "columnheader" / "cell"`), not `<table>`.

| Table | Class | Columns (desktop) | Mobile |
|---|---|---|---|
| Home "Awaiting review" and "Going out" | `.hm-tr` | `minmax(0,1.2fr) minmax(0,1.5fr) 128px` | Header hidden visually. Areas `"who act" / "det act"`; the detail indents 36px under the name. |
| Customers directory | `.cu-dr` (the row is an `<a>`) | `minmax(0,2fr) 110px minmax(0,1fr) minmax(0,1fr) 24px` | Icon, then name, amber issue line and muted "n open · next · contact" meta, then chevron. |
| Customer orders | `.cu-or` (open: `<div>` with an action link; past: the row is an `<a>`) | `84px 104px minmax(0,1.5fr) 44px 72px minmax(96px,1fr) 108px` (Amount column dropped for roles without prices) | Areas `"ord st act" / "sum sum act" / "date date act"`; the summary line reads "destinations · n lines · amount"; a 44px chevron link with an `aria-label`. |
| Last prices | `.cu-pr` | `minmax(0,2fr) minmax(0,1fr) 80px`, price right-aligned and tabular | Item over order, price on the right. |

Shared rules for all four:

- Header row: 12.5–13px `--ink2`, no top border.
- Body rows: 1px `--line` top divider, 12–14px vertical padding.
- Link rows get the `--hover` fill.
- The customer cell is a 22px grey icon, then the name (600) with the ref (12.5px `--ink2`) below it.

### Side panel with icon-led facts

`.cu-panel` (customer page):

- **Panel:** `--cu-tint` fill, 1px `--line`, radius 12px, padding `20px 24px`.
- **Groups** (`.grp`):
  - Split by 1px `--line` dividers with 16px padding.
  - Heading H3 17px / 700.
- **Fact** (`.cu-fact`):
  - A 20px icon slot (`--ink2`, labelled).
  - The value (14px).
  - An optional sub-line (13px `--ink2`).
  - The value column lines up at 32px; tags, Copy contact and sub-notes indent to match.
- **Tags** (`.cu-tags`): `--panel2` fill, `--ink2` text, 13px / 500, padding `3px 10px`, radius 6px.

### Next actions list (Home)

`.hm-acts`:

- **Rows:** links 56px tall, divided by 1px `--line`.
- **Content:** 20px grey icon, title (500), an optional amber count pill, then a grey chevron.
- **Hover:** the title turns `--accent`.

### Timeline / activity list

`.hm-tl` (Home "Recent activity") and `.cu-feed` (customer page "Activity"):

- **Layout:** a 20px icon column, gap 14px.
- **Connector:** 1px `--line2`, from 26px below the top of each icon to the next entry; it **stops at the last entry**.
- **Entry text:** the actor (600, on the customer page) and the event in sentence case.
- **Meta line:** "ref · time" at 12.5px `--ink2`. On the customer page the ref links to its order.

### Empty and missing states

| Class | Where | Spec |
|---|---|---|
| `.hm-empty` | Home sections | `--ink2`, **left-aligned**, padding `8px 0 16px`. |
| `.cu-empty` | Customers sections | `--ink2`, **centred**, padding `16px 0`. |
| `.cu-none` | Missing contact, delivery or billing field | Inline `--ink2` text, for example "No contact on file". |

Copy is one plain sentence: "Nothing is waiting for review.", "No open orders.", "No customers match “x”."

### Page header and breadcrumb

- **Header** (`src/components/shell/Header.tsx`):
  - Sticky, 56px tall (52px on mobile), 1px `--line` bottom border.
  - Left: an optional page icon (`--ink2`) and title. Pass `title="div"` when the page has its own H1.
  - Right: actions.
  - Home and Customers set it white with no backdrop blur.
- **Breadcrumb** (`.cu-crumb`):
  - 14px `--ink2`, links underline in `--accent` on hover.
  - "/" separator (`aria-hidden`).
  - The current page is `--ink` with `aria-current="page"`.

### Customer icon

`CustomerIcon` in `src/components/bits.tsx`: see [Icons](#4-icons).

---

## 6. Layout patterns

- **Content background:** white (`#FFFFFF`) on the page surface; cream (`--bg`) only behind the frame.
- **Two columns:** a main column (`flex: 999 1 560px`) beside a side column (`flex: 1 1 300–320px`), gap 24px, wrapping to one column when narrow.
  - Home's side column holds Next actions and Recent activity.
  - The customer page's side column is the tinted panel.
- **Directory:** a single column, max width about 1240px.
- **Mobile (≤760px):**
  - Columns stack, with the side content after the main column.
  - Tables become stacked rows.
  - Header actions collapse to icons.
  - Tap targets are 44px.

---

## 7. Inconsistencies inside Home/Customers

1. **Two white surface variables.** `--hm-bg` and `--cu-bg` are both hard-coded `#FFFFFF`, separate from `--panel` `#FFFDF9`. *Standardise:* one `--surface: #FFFFFF` token.
2. **Hard-coded panel tint.** `#FAF7F2` (`--cu-tint`) is a one-off. *Standardise:* use `--bg` `#FAF5EE`.
3. **Weight 700 is not loaded.** It is used for the stats values and the panel H3 headings, but Google Fonts loads Geist 400/500/600 only, so the browser synthesises the bold. *Standardise:* use 600 everywhere, or add 700 to the font link.
4. **Two big-number styles.** Home due cards use 26px / 600; Customers stats use 22px / 700. *Standardise:* one "big number" style.
5. **Two heading sizes for groups.** H2 is 18px / 600; the panel H3 is 17px / 700. *Standardise:* keep 18/600 for sections and make the panel heading 16px / 600 (or 18/600).
6. **Muted text at three sizes** (12.5px, 13px, 13.5px) for the same "small / muted" role. *Standardise:* one 13px small style.
7. **Duplicate components across two stylesheets.**
   - Pills: `.hm-pill` / `.cu-pill` (identical).
   - Cards: `.hm-card` / `.cu-card`.
   - Text actions: `.hm-go` / `.cu-go`.
   - Timelines: `.hm-tl` / `.cu-feed`.
   - Header buttons: `.hm-hand` / `.pa-hand`.
   - The `Arrow` icon is defined twice in TSX.

   *Standardise:* one shared component each.
8. **Empty-state alignment.** Left on Home, centred on Customers. *Standardise:* pick one (left reads better inside tables).
9. **Card bottom padding.** Home table cards use `20px 24px 8px`; Customers use `20px 24px`. *Standardise:* `20px 24px`, letting rows supply their own spacing.
10. **Focus ring is scoped per page.** It is redeclared in `home.css` and `customers.css` instead of replacing the global blue ring. *Standardise:* set it once globally.
11. **Tables are hand-built grids per page,** with different column templates and two different mobile restacking schemes. *Standardise:* one row component with named slots (primary, detail, status/action).
12. **Attention text colour differs.** Home's "Awaiting review" issue text is plain `--ink`; the Customers attention line is `--warn`. *Standardise:* amber dot plus `--warn` text wherever an issue is named.

---

## 8. Guidance from the repo

- **AGENTS.md** holds only a framework rule: this is a newer Next.js with breaking changes, so read `node_modules/next/dist/docs/` before writing code. It has no design rules.
- **PRODUCT.md (brand commitments):**
  - Product name **Invoice Checker**.
  - Writing is plain and literal: short declarative sentences, no jargon, and the reason always stated.
  - Error copy says what happened and what the person can do.
  - Principles: never guess; "Clear" must be safe to pay; spend attention only where needed (matching lines recede, flagged lines lead); show the source; be honest about the mode (fixture answers are always labelled).
- **Impeccable critiques (`.impeccable/critique/`, 14 Oct 2026):**
  - `--ink3` text fails AA (about 3.5–4.1:1). Do not use it for text.
  - Hover-only actions and controls nested inside links break keyboard use. Use real `<a>` / `<button>`, never nested.
  - Statuses shown by colour or tint alone fail. Always pair the colour with a text label.
  - The detector flagged Geist as an "overused font". This is noted, not acted on; the brief keeps the existing fonts.
  - The global `.review` style uses a left-border accent; the side-tab pattern is to be avoided.
- **`src/app/globals.css` header** says the tokens were ported from the approved "Version 16" prototype and should change only with it. **PRODUCT.md** records as an **open decision** whether Version 16 still binds the Invoice Checker screens. Resolve that before changing tokens.

---

## Deviations — do not adopt

Seen on other screens (Invoices, Orders, Settings, History, the sidebar and the global stylesheet). They are not part of the system.

| Deviation | Where | Use instead |
|---|---|---|
| **Blue focus ring** (`outline: 2px solid var(--info)`) | `globals.css` (global default) | Terracotta ring (section 3.5). |
| **Red, blue and purple labels** (`.l-bad`, `.l-info`, `.l-purple`, `.l-over`) | `globals.css`, Orders, Invoices | Amber, green or neutral pills only. |
| **Labels with leading icons**, 6px radius (`.lbl` + `Icon`) | `bits.tsx` `Lbl`, Orders, order page | Text-only pills, radius 999px. |
| **Tinted customer marks** (`.avc`, `.logo`, from `customer.color`) | `bits.tsx` `CustomerMark`, Orders, order page `Profile` | Grey `CustomerIcon`. |
| **Drop shadows** (`--shadow`, coloured `color-mix` shadows, `rgba(42,28,21,.16)`) | Popovers, Orders, palette | Flat cards with 1px borders. |
| **Off-scale font sizes** (10.5, 11, 11.5, 16, 23, 24, 28px) | Invoices, Orders, Settings, sidebar | The scale in section 2.2. |
| **Base text at 13px with `--ink3` greys** (`.hint`, `.kpi .k`, `.row .sub`, `.gh`) | `globals.css`, Orders, History | 14px body; `--ink2` for muted text. |
| **Uppercase group headers and dense ledger tables** (`<table class="o-ledger">`) | Orders, Invoices | Section-card tables (section 5). |
| **Small primary button** (`.btn.p`: 12.5px, padding `6px 12px`, radius 8px) | `globals.css`, Invoices upload | Primary button in section 5 (40px, radius 10px). |
| **Hard-coded `#FFFDF9`** | `invoices.css`, `orders.css` | The surface token. |
| **Radii 1.5, 2, 3 and 5px** | Invoices, Orders, Settings | 4, 6, 8, 10 or 12px. |
| **Duty-mode tab switchers** ("Order Ledger / Resolve Exceptions / Dispatch Queue", "Invoice Ledger / Audit Queue / Ready to Pay") with coloured dots | Orders, Invoices | The segmented toggle. |
| **Left-border accent callouts** (`.review`) | `globals.css`, order page | Attention line (amber dot + text). |
| **Green accent in dark mode** | `globals.css` dark theme | Light theme only until dark is redesigned. |
| **Key-hint bar, sidebar, assistant panel, ⌘K palette** | Parked | Not part of the workspace redesign. |
