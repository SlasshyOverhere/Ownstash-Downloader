## 2024-05-18 - Memoizing components with heavy hooks
**Learning:** Components wrapping custom interaction hooks (like `use3DTilt`) that internally schedule `requestAnimationFrame` and maintain ref states can cause unnecessary processing or visual artifacts when re-rendered rapidly by a parent component (e.g. typing in an input field triggering `setState`).
**Action:** Wrap these components in `React.memo` to skip re-renders when their props haven't changed, especially when they are nested inside forms or input-heavy parents.
