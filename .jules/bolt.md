## 2025-02-15 - Bypass React Render Cycle for High-Frequency Animations
**Learning:** High-frequency events like mouse movement can cause excessive React re-renders when updating state, leading to performance bottlenecks.
**Action:** Use a `useRef` to hold the DOM element and directly mutate its `style.transform` property to bypass the React render cycle, avoiding expensive re-renders.
