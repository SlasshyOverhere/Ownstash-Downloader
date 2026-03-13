## 2024-05-24 - Initial Creation
**Learning:** Performance memory file created.
**Action:** Use this to store critical performance learnings.

## 2024-05-24 - Memoize components using use3DTilt
**Learning:** React components containing heavy interaction hooks (like `use3DTilt`) cause rapid, unmemoized re-renders and main thread blocking during frequent state updates like URL text inputs.
**Action:** Always wrap components utilizing `use3DTilt` (or similar heavy interactive UI hooks) with `React.memo` to prevent unnecessary re-renders when parent component state updates frequently.
