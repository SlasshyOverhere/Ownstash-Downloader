## 2024-03-10 - Memoizing heavy hook interactions in UI cards
**Learning:** In interactive dashboards (like `HomePage`), UI components that attach heavy event listeners or computations (e.g., `use3DTilt`) will be rapidly re-rendered and re-evaluated during frequent state updates like text input (`url` state), causing main thread blocking.
**Action:** Always wrap components containing heavy interaction hooks with `React.memo` if they depend on stable props, and memoize callback props (e.g., navigation functions) passed down from parent components to prevent cascading unmemoized re-renders.
