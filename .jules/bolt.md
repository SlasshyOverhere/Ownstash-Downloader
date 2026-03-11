## 2025-03-11 - Optimize QuickStat with React.memo
**Learning:** React components containing heavy custom hooks (like `use3DTilt`) that receive simple props and are rendered dynamically in state-heavy parents (like `HomePage` rendering lists of `QuickStats`) suffer from significant redundant overhead during text input changes without memoization.
**Action:** Always wrap small interactive components containing complex hooks (like `use3DTilt`) in `React.memo` if they are rendered multiple times in parents with high-frequency state updates (e.g., text inputs).
