
## 2026-03-06 - Optimize List Renders with React.memo
**Learning:** In complex, list-heavy components like `DownloadsPage` and `HistoryPage` that receive frequent updates (such as progress bars or real-time state changes), not memoizing the individual list item components (`DownloadCard`, `DownloadHistoryCard`, `SearchHistoryCard`) leads to significant, unnecessary re-renders. This can result in high CPU usage and janky UI.
**Action:** Always wrap heavy list item components with `React.memo` using default shallow comparisons, and memoize the event handlers passed to them using `useCallback` to ensure the optimizations are effective.
