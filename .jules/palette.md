## 2024-03-20 - Toggle Switch Accessibility
**Learning:** Custom toggle UI elements built from divs/buttons lack native semantics. Without `role="switch"`, `aria-checked`, and visible focus rings, screen reader users cannot understand the element's state or purpose, and keyboard users cannot navigate properly.
**Action:** Always add `role="switch"`, dynamic `aria-checked={state}`, an appropriate `aria-label`, and `focus-visible:ring-2` to custom toggle components.
