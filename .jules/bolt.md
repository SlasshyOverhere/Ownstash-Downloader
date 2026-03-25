## 2024-05-24 - High-frequency DOM mutation in React Hooks
**Learning:** High-frequency event handlers like mouse movements tracking in React hooks (e.g. `use3DTilt`) cause major performance bottlenecks when using `useState`, as every frame triggers a full component re-render.
**Action:** Use `useRef` to directly mutate the DOM element's style (e.g. `ref.current.style.transform`) and omit the mutated property from the React `style` prop to prevent React from overriding it during unrelated renders.
