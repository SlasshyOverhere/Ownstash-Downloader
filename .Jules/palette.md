## 2026-03-03 - Missing ARIA Roles on Custom Toggle Components
**Learning:** Custom interactive components, particularly toggles built from `div`s and `button`s without native `<input type="checkbox">` elements, often lack the essential `role="switch"` and `aria-checked` attributes. This completely hides their state and purpose from screen readers.
**Action:** Always verify that custom toggles and switches include `role="switch"` and dynamic `aria-checked` states, along with a descriptive `aria-label` or `aria-labelledby` reference.
