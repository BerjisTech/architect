# Suggestions

## Provider Analytics Visualization
**Description:** Now that provider analytics data is exposed, we should surface richer visualizations (trend lines, response distribution) in the dashboard instead of raw counts.

**Tasks:**
- [ ] Design chart-ready API responses (e.g., daily buckets) for response stats in `service/internal/providers`.
- [ ] Add charts/cards to `frontend/src/app/features/provider-dashboard.page.*` to display trends and deltas.
- [ ] Document usage patterns in `docs/roles.md` so support can interpret the metrics consistently.
