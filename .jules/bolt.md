## 2024-03-07 - Frequent re-renders during progress updates
**Learning:** High-frequency progress updates trigger massive re-renders on list components.
**Action:** Always wrap `DownloadCard` (and similar components) with `React.memo` using default shallow comparison, and wrap handler functions with `useCallback` to maintain referential equality across renders.
