# Suggestions

## Provider Analytics Visualization
**Description:** Now that provider analytics data is exposed, we should surface richer visualizations (trend lines, response distribution) in the dashboard instead of raw counts.

**Tasks:**
- [ ] Design chart-ready API responses (e.g., daily buckets) for response stats in `service/internal/providers`.
- [ ] Add charts/cards to `frontend/src/app/features/provider-dashboard.page.*` to display trends and deltas.
- [ ] Document usage patterns in `docs/roles.md` so support can interpret the metrics consistently.

## Provider Search Enhancements
**Description:** Extend the new discovery experience with pagination, saved filters, and map-based discovery for larger result sets.

**Tasks:**
- [ ] Add cursor/offset pagination controls in `matching.page.ts` with UI affordances.
- [ ] Surface saved filter presets per user (requires API design).
- [ ] Integrate optional map view using aggregated service areas once geocoding is available.

## RFQ Workflow Polish
**Description:** The new RFQ module covers core flows, but needs UX and automation refinements before launch.

**Tasks:**
- [ ] Add provider/requester notifications (email/in-app) when quotes/messages post.
- [ ] Replace raw UUID inputs with searchable provider/listing selectors in `rfq-requests` UI.
- [ ] Schedule background job to mark expired quotes without requiring manual fetches.

## Studio Wall UX Enhancements
**Description:** Wall tooling is much richer now, but we should surface presets and context help so new users understand anchor modes and wall types.

**Tasks:**
- [ ] Add inline tooltip/legend explaining wall type colors and suggested usage.
- [ ] Persist last-used anchor per wall type and expose quick shortcuts (e.g., hotkeys).
- [ ] Capture analytics on thickness presets usage to refine default values.

## Manual Split UX Extensions
**Description:** Manual wall splitting now supports snapping and previews; we can layer on advanced workflows for precision editing.

**Tasks:**
- [ ] Support entering an exact offset value (mm/ft) before confirming a split.
- [ ] Allow multi-point splitting in one gesture so planners can subdivide walls rapidly.
- [ ] Add optional toggle to display split indicators even outside split mode for power users.

## Curve Wall Enhancements
**Description:** Initial curve tooling is live (three-point draw, straight conversion, live previews). We still need richer geometry controls and presets to satisfy the remaining checklist items.

**Tasks:**
- [ ] Provide post-creation editing handles to reposition the curve control point and adjust radius dynamically.
- [ ] Add quick presets for quarter/half/full-circle and elliptical walls (with parameter inputs).
- [ ] Display arc metadata (radius, sweep angle, arc length) in the wall tools panel and update door/window placement logic for curved segments.

## Room Templates & Detection
**Description:** The new room drafting flow supports freeform polygons, but we still owe guided templates and automatic detection to finish 5.3.1/5.3.2 work.

**Tasks:**
- [ ] Introduce preset flows (rectangle, square, L-shape, U-shape, circular) with simple parameter dialogs.
- [ ] Implement intelligent enclosed-space detection to highlight auto rooms after wall layouts change.
- [ ] Persist polygon footprints on `Room` entities and expose centroid/area labels for selection overlays.
