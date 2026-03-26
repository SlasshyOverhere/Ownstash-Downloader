## YYYY-MM-DD - [Keyboard Accessibility for Hover-Revealed Actions]
**Learning:** Found that using `opacity-0 group-hover:opacity-100` on action button containers hides them from keyboard users even when the buttons inside receive focus.
**Action:** Always add `focus-within:opacity-100` to the container so that it becomes visible when any of its child buttons receive focus. Also, ensure the buttons themselves have visible focus rings using `focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background` and `focus-visible:outline-none`.
