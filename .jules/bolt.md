## 2024-05-18 - Bypassing React render cycle for high-frequency animations
**Learning:** High-frequency events (like `mousemove` used in `use3DTilt`) that update React state via `useState` trigger excessive and expensive component re-renders, especially on list-heavy pages like HistoryPage and DownloadsPage.
**Action:** Use a `useRef` to access the DOM element directly and imperatively mutate its `style.transform` property, bypassing React's render cycle completely for smoother high-frequency animations.
