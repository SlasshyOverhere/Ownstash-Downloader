## 2025-02-20 - use3DTilt Optimization
**Learning:** High-frequency animations like mouse tracking can cause performance issues if they trigger a React render cycle for every frame. `useState` causes the entire component to re-render.
**Action:** By bypassing React's render cycle using `useRef` to directly mutate the DOM element's `style.transform` property, performance is significantly improved during rapid state updates, effectively eliminating React rendering overhead.
