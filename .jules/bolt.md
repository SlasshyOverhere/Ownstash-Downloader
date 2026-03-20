
## 2024-05-18 - Prevent Unnecessary Re-renders on Input Change
**Learning:** React state updates (like typing in an input field) in parent components can trigger unmemoized expensive child components to re-render, blocking the main thread.
**Action:** Wrap presentational components inside React components where state is changing rapidly with `React.memo` (and use `useCallback` for props) to prevent unnecessary re-renders.
