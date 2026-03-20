## 2024-03-20 - Focus Ring Visibility on Dynamic Backgrounds
**Learning:** When custom tabs or filter buttons toggle their background from dark/transparent to solid white when active, standard focus rings (`focus-visible:ring-2 focus-visible:ring-primary`) can become invisible or have poor contrast.
**Action:** Always combine `focus-visible:ring-primary` with `focus-visible:ring-offset-2 focus-visible:ring-offset-background` on interactive elements to ensure the focus ring maintains contrast regardless of the element's dynamic background color.
