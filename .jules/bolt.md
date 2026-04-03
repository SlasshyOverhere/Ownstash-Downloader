## 2024-04-03 - Bypass React Render Cycle for High-Frequency Animations
**Learning:** High-frequency events like `onMouseMove` triggering `useState` cause excessive React re-renders, blocking the main thread and degrading performance, especially in list-heavy components.
**Action:** Use `useRef` to hold DOM elements and directly update properties imperatively (`style.transform`) to avoid React re-renders. Ensure the mutated property is excluded from the component`s `style` prop.
