## 2024-03-20 - Accessible Hover-Revealed Actions
**Learning:** Hiding action buttons with `opacity-0` and only revealing them on `group-hover` creates an accessibility barrier for keyboard users, as the focused elements remain invisible.
**Action:** When using hover-revealed elements (like action button groups in lists), always add `focus-within:opacity-100` to the container so it becomes visible when children receive keyboard focus, and ensure the buttons themselves have clear `focus-visible` ring indicators.
