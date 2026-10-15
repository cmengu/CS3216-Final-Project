---
target: order
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:C:\\Nam-projects\\CS3216-Final-Project\\src\\components\\pages\\orders\\OrdersView.tsx"
target_fingerprint: "sha256:8e487f089a16ae24240eeeef27109538a3b3ce34a2da8f31988ee556674b1452"
target_path: "C:\\Nam-projects\\CS3216-Final-Project\\src\\components\\pages\\orders\\OrdersView.tsx"
timestamp: 2026-10-14T19-32-07Z
slug: src-components-pages-orders-ordersview-tsx
---
Method: dual-agent (A: c862b4a9-3b84-4dc4-82a3-5139e6d89ac4 · B: ab6f907a-5ef8-4ca5-a201-d0cd6d7cfa37)

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|:-----:|-----------|
| 1 | Visibility of System Status | 2 | Search query `q` in `OrdersView.tsx` hides rows via DOM `hidden` after grouping, leaving empty group headers, stale group counts, and no empty state |
| 2 | Match System / Real World | 3 | Strong B2B domain vocabulary, but `whyText()` and `summarise()` in `logic.ts` hardcode `"qty 4 → 6 on line 1"` and `"10:48"` for every exception order |
| 3 | User Control and Freedom | 2 | One-click state changes (`Mark delivered`, `Mark invoiced`, `Approve change`, `Discard` draft) execute immediately with no Undo (`pointer-events: none` on `.toast`) |
| 4 | Consistency and Standards | 2 | Dead `<span className="plus" title="Add label">+</span>`, fake `"Download Excel"` toast, inconsistent bulk selection clearing, and `.stepper` CSS collision in `globals.css` |
| 5 | Error Prevention | 1 | `"Dismiss"` and `"Fill and remember"` buttons in `OrderView.tsx` are enabled when dropdowns are empty (`value=""`); `14×14px` checkbox sits inside a full-row `<Link>` |
| 6 | Recognition Rather Than Recall | 2 | Row checkboxes (`.sel`) and quick actions (`.hov`) are hidden until pointer hover; `ReviewCard` references `"Line 1"` with no highlight on the table row below |
| 7 | Flexibility and Efficiency | 2 | No "Select All" / group checkbox for bulk delivery; keyboard cursor `cur` goes out of bounds on filter change; global `Enter` listener hijacks focused buttons |
| 8 | Aesthetic and Minimalist Design | 3 | Warm Sunlit Linen palette and `tabular-nums` work well, but `OrderView.tsx` repeats order status 4 times above the fold while dedicating `340px` to a static Customer Profile |
| 9 | Error Recovery | 1 | Submitting empty `ReviewCard` dropdowns or an empty comment fails silently (`if (!m) return`); clipboard errors in `DraftBox` are swallowed |
| 10 | Help and Documentation | 2 | `"Fill and remember"` and `"Keep 4, note it"` never explain whether rules apply per-customer or globally; hidden `"Confirm"` button when `!retainsRows` lacks explanation |
| **Total** | | **20/40** | **Acceptable (50% — Bottom of band; high-impact workflow & accessibility fixes needed)** |

### Design Specificity Verdict

**LLM assessment (unanchored):**
**Verdict: Hybrid — Authentic B2B wholesale domain mechanics trapped inside a B2C email-inbox shell and undercut by hardcoded prototype strings.**
- **What feels genuinely built for B2B wholesale operations**: The 5-stage lifecycle (`Read → Confirmed → Exported → Delivered → Invoiced`), role-gated pricing (`canPrice(u)` hiding unit prices/totals from warehouse staff while logging `viewPrices` audit events), channel-aware customer replies (`"Copy for WhatsApp, mark sent"` vs `"Send email"`), and structured PO exception cards (`ReviewCard` for quantity revisions and unmapped SKUs).
- **What feels category-interchangeable or brittle**: `OrdersView.tsx` clones a Superhuman/Linear email inbox (unread blue dot, hover-only action icons, Attio-style label strip with a non-functional `+` tag button) rather than an operations desk where warehouse leads and clerks can scan carton/line totals or batch-select a delivery run. Worse, `whyText()` and `summarise()` in `logic.ts` return hardcoded strings (`"qty 4 → 6 on line 1, unconfirmed"`, `"Revised PO received 10:48..."`) for *any* order in `needs_check` or `blocked` state.

**Deterministic scan (`impeccable detect`):**
- Direct scan of `src/components/pages/orders`, `src/app/(shell)/orders`, and `src/app/styles/orders.css`: **0 findings**.
- Scan of shared styling/layout (`src/app/globals.css`, `src/app/layout.tsx`) inherited by Orders: **5 findings** (4 warnings, 1 advisory):
  - `overused-font` (`src/app/layout.tsx:22`, `src/app/globals.css:14`): Genuine match (`Geist` / `Geist Mono` used across the app).
  - `side-tab` (`src/app/globals.css:188`, `.log .msg`): False positive — a neutral `2px` blockquote indent line in the `OrderView.tsx` activity timeline, not a rounded card with a thick side-tab accent (though `.review` at line 189 uses a similar `2px` left border for exception callouts).
  - `border-accent-on-rounded` (`src/app/globals.css:68`, `.sec::after`), `gradient-text` (`src/app/globals.css:298`, `.thinking span`), and `bounce-easing` (`src/app/globals.css:276`, `.sprout .leaf`): False positives / outside the Orders surface (CSS caret triangle and Assistant panel loading/empty states).
- **Additional code-level defect caught during verification**: `.stepper` is declared twice in `src/app/globals.css` (line 382 for `OrderView.tsx` lifecycle stepper and line 566 for the Settings wizard), causing `.stepper span { margin-left: 8px }` and `gap: 5px` to leak onto the Order detail lifecycle bar.

**Visual overlays:**
No reliable user-visible overlay is available (`No browser automation tool is exposed in this harness; skipped live server and detect.js overlay injection`).

### Overall Impression
The Orders experience nails the core commercial tension of a Singapore wholesale distributor—separating warehouse picking views from finance pricing, bridging WhatsApp/email customer acknowledgements, and surfacing PO quantity diffs and missing SKUs. However, beneath the warm Sunlit Linen surface, interactive fragility (`<input>` and `<button>` nested inside `<Link>`, broken search filtering, hijacked keyboard shortcuts, and hardcoded exception strings) makes the queue unreliable the moment a user steps off the scripted happy path.

### What's Working
1. **Role-Scoped Commercial Visibility & Audit Trail (`OrderView.tsx:150-157, 300-348`, `logic.ts:167-168`)**: Warehouse staff (`Dennis`) see a clean 6-column picking table (`#`, `SKU`, `Item`, `Qty`, `Unit`, `Outlet`), while Finance/Owner roles see `Unit price`, line `Total`, and `Total, before GST`, with automatic `viewPrices` audit logging.
2. **Channel-Aware Exception & Reply Workflows (`OrderView.tsx:55-143`, `logic.ts:94-99`)**: `ReviewCard` turns PO discrepancies into concrete decisions (`"Approve change"`, `"Keep 4, note it"`, `"Fill and remember"`), and `DraftBox` tailors the primary action to the order's channel (`"Copy for WhatsApp, mark sent"` vs `"Send email"`).
3. **Sunlit Linen Palette & Tabular Numeric Discipline (`globals.css:8-24, 41-42, 170-178`)**: The warm paper tokens (`--bg: #FAF5EE`, `--panel: #FFFDF9`, `--accent: #B84A27`) and strict `tabular-nums` / `Geist Mono` alignment keep SKUs, quantities, and prices crisp.

### Priority Issues

1. **[P0] Search Query Hides DOM Nodes Without Filtering Groups, Breaking Counts, Empty State, and Keyboard Index**
   - **Why it matters**: In `OrdersView.tsx:56-60, 158-240` and `orders.css:5`, `groupOrders()` runs before search filtering, and non-matching rows are hidden with `hidden={!shown(o)}`. Typing in `#q` leaves empty group headers (`.gh`) visible with unfiltered badge counts (`g.items.length`), never triggers the `"No orders here."` empty state (`line 239`), and leaves the keyboard index `cur` out of bounds.
   - **Fix**: Filter by `q` before or inside `groupOrders()` in `logic.ts:59-61` so empty groups are removed and group counts reflect matches; delete `hidden={!shown(o)}` in `OrdersView.tsx:172` and `#olist .orow[hidden]` in `orders.css:5`; reset `cur` to `-1` when `q`, `f`, `fc`, or `sort` changes.
   - **Suggested command**: `/impeccable harden`

2. **[P0] Invalid Nested Controls Inside `<Link>`, Hover-Only Actions, and Hijacked `Enter` Key Break Keyboard, Touch, and Screen Readers**
   - **Why it matters**: `OrdersView.tsx:172-233` nests a `14×14px` `<input type="checkbox" className="sel">` (`visibility: hidden` until hover) and up to 3 `<button className="ib">` elements (`display: none` until hover) inside an `<a className="row orow">`. Worse, the global `window` `keydown` handler (`OrdersView.tsx:72, 79-84`, missing a dependency array) intercepts `Enter` whenever `cur >= 0`, hijacking `Enter` presses on focused buttons like `"Mark delivered"` in `#bulk`.
   - **Fix**: Replace the outer `<Link>` with a `<div className={cls}>` using a stretched primary `<Link>` for the order title/ref and sibling interactive controls; replace `visibility: hidden` / `display: none` with `:focus-within` / `:focus-visible` reveal and `≥24×24px` hit targets; add descriptive `aria-label`s containing `ref(o)`; and skip the global `keydown` handler when `e.target` is inside `a, button, input, select, textarea`.
   - **Suggested command**: `/impeccable audit`

3. **[P1] Hardcoded Prototype Strings in `logic.ts` Falsify Order Exception Summaries**
   - **Why it matters**: `whyText(o)` (`logic.ts:84-88`) and `summarise(o, ev)` (`logic.ts:117-118`) return hardcoded `"qty 4 → 6 on line 1, unconfirmed"` and `"Revised PO received 10:48..."` for *any* `needs_check` order, and `"1 cell has no SKU"` for *any* `blocked` order. Unconfirming another order or inspecting a different exception displays fabricated data.
   - **Fix**: Derive `whyText(o, toCheck)` and `summarise(o, ev, toCheck)` dynamically from the order's actual `ToCheck` records (`s.toCheck.filter(t => t.order === o.id)`) and line items (`o.lines`), with a truthful fallback (`"Unconfirmed — awaiting review"`) when no revision diff is attached.
   - **Suggested command**: `/impeccable clarify`

4. **[P1] Unguarded Exception Submissions and One-Click State Transitions Without Undo**
   - **Why it matters**: In `OrderView.tsx:82-90, 101-111`, `"Dismiss"` and `"Fill and remember"` can be clicked while their `<select>` is still on the placeholder (`value=""`). Furthermore, `"Mark delivered"`, `"Mark invoiced"`, and `"Discard"` draft execute in one click with no Undo action (`.toast` has `pointer-events: none`).
   - **Fix**: Add `disabled={!pick}` to `"Dismiss"` (`OrderView.tsx:88`) and `"Fill and remember"` (`OrderView.tsx:109`), `disabled={!msg.trim()}` to `"Post"` (`OrderView.tsx:378`), and support an interactive `"Undo"` action in `.toast` (or reversal actions in `OrderView.tsx:234`).
   - **Suggested command**: `/impeccable harden`

5. **[P2] Quadruple Status Redundancy, Detached Line Diffs, and Global `.stepper` CSS Collision on `OrderView`**
   - **Why it matters**: `OrderView.tsx:254-289` repeats the order's status 4 times vertically above the fold while `ReviewCard` sits detached above an unhighlighted `.tbl` (`lines 291-350`), forcing the clerk to mentally map `"Line 1"` to the table below. Meanwhile, `globals.css:566` redefines `.stepper` globally, leaking Settings wizard styles into `OrderView`.
   - **Fix**: Scope `globals.css:566` to `.setpane .stepper`; remove the dead `<span className="plus">+</span>` (`OrderView.tsx:266`) and redundant status pill in `.labels`; highlight affected rows inline inside `.tbl` (`OrderView.tsx:312`) with a status badge/diff; and allow the `340px` Customer `SidePane` to collapse cleanly on narrower viewports.
   - **Suggested command**: `/impeccable distill`

### Persona Red Flags

**Alex (Impatient Power User)**:
- Pressing `Enter` on focused `"Mark delivered"` in `#bulk` (`OrdersView.tsx:247`) after using `j`/`k`/`x` is hijacked by `OrdersView.tsx:79-84` and navigates away to `rows[cur].id`.
- Filtering with `#q` after moving `cur` leaves `cur` out of bounds (`OrdersView.tsx:34, 60`).
- No "Select all in group / Select all visible" checkbox to batch-deliver a day's run (`OrdersView.tsx:161-164`), and zero keyboard shortcuts inside `OrderView.tsx`.

**Sam (Accessibility-Dependent User)**:
- Checkboxes (`.sel`) and row action buttons (`.hov`) are nested inside `<Link className="row orow">` (`OrdersView.tsx:172-233`) and hidden via `visibility: hidden` / `display: none` (`globals.css:136, 394`), making them unreachable by keyboard `Tab` and broken for screen readers.
- Checkboxes have generic `aria-label="Select"` (`OrdersView.tsx:176`) with a `14×14px` hit target (failing WCAG 2.2 SC 2.5.8 `24×24px` minimum), `.tabs` (`OrdersView.tsx:142`) lacks `role="tablist"` / `aria-current`, and `.stepper` (`OrderView.tsx:270`) has no screen-reader state labels.

**Riley (Deliberate Stress Tester)**:
- Clicking `"Dismiss"` or `"Fill and remember"` (`OrderView.tsx:88, 109`) with no dropdown option selected (`value=""`) triggers the action anyway.
- Clicking `"Unconfirm"` (`OrderView.tsx:235`) on any confirmed order fabricates `"Revised PO received 10:48. Line 1 qty 4 → 6, unconfirmed"`.
- Clicking `+` (`OrderView.tsx:266`, dead `<span>`) or `"Post"` on an empty comment (`line 378`) does nothing; resizing below `760px` (`globals.css:459`) hides `.filt` and `.orow .sel` completely with no mobile fallback.

### Minor Observations
- **Split filter persistence (`OrdersView.tsx:20-21, 29, 32`)**: Customer (`keptFc`) and sort (`keptSort`) persist in module-scoped variables, `state` lives in `?state=`, and `q` resets on unmount; clicking the `"Orders"` breadcrumb (`OrderView.tsx:245`) drops the active `?state=` tab.
- **Unscoped `.stepper` collision (`globals.css:382` vs `566`)**: Settings wizard `.stepper` rules override gap, font-size, and span margins on the Order detail lifecycle bar.
- **Array index keys (`OrderView.tsx:312, 404`)**: Dynamic line rows and activity log items use array index `i` as their React `key`.

### Questions to Consider
- "What if the affected line in `.tbl` highlighted and resolved the diff inline, instead of making the clerk cross-reference `ReviewCard` against an unmarked table?"
- "Does the Customer Profile need `340px` of permanent screen width on every order, or should the line items and exception resolution own the canvas?"
- "What would `/orders` look like if it were designed for a warehouse & sales operations desk (visible line/carton counts, batch-select by delivery slot) rather than an unread email inbox?"
