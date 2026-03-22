## 2024-05-18 - Avoid useState in use3DTilt for high-frequency animations
**Learning:** In `use3DTilt`, relying on `useState` for rapid updates like mouse movement triggers excessive React re-renders on the components using the hook (like `HomePage` quick stats and download cards). This creates main thread blocking during frequent events.
**Action:** Replace `useState` with direct DOM manipulation. Maintain state in a `useRef` to skip the React render cycle entirely, calling `ref.current.style.transform` directly within the `requestAnimationFrame` callback.
