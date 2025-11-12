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
