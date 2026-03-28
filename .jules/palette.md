## 2024-03-22 - Missing ARIA Context on Interactive Elements
**Learning:** Found that custom filter buttons, dynamic action buttons, and main form inputs (like URL and search fields) lacked sufficient context for screen readers in the main application flow, making them unclear when traversed sequentially.
**Action:** Always include `aria-label` on bare `<input>` fields that don't have linked `<label>`s, and use `aria-pressed` for custom toggle/filter groups built with standard `<button>` elements to communicate state properly to assistive tech.
