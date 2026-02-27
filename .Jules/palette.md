# Palette's Journal

## 2024-05-22 - [Project Setup]
**Learning:** This is a Tauri + React app. It uses Tailwind CSS and Lucide icons.
**Action:** Look for icon-only buttons without ARIA labels, or inputs without labels.

## 2024-05-22 - [Accessibility Audit]
**Learning:** The `MediaInfoModal.tsx` and `SpotifyInfoModal.tsx` have several icon-only buttons (like Close, quality selection checks) that might be missing aria-labels.
**Action:** Verify if `X` (close) buttons have aria-labels.
**Learning:** The `AnimatedSidebar.tsx` has icon-only buttons for navigation when collapsed, but they seem to have `motion.span` for text which might be hidden but present in DOM? No, `display: none` is used in animation variants.
**Action:** Ensure collapsed sidebar buttons have `aria-label` or `title`.

## 2024-05-22 - [ESLint Missing]
**Learning:** The project is missing an `eslint.config.js` file, causing `npm run lint` to fail.
**Action:** Create a basic `eslint.config.js` to enable linting.

## 2024-05-22 - [Sidebar Accessibility]
**Learning:** In `AnimatedSidebar.tsx`, the collapse toggle button has an icon but the text "Collapse" is visually hidden or shown based on state.
**Action:** Add `aria-label` to the collapse/expand button to explicitly state its action (e.g., "Collapse sidebar" or "Expand sidebar").

## 2024-05-22 - [Modal Accessibility]
**Learning:** In `MediaInfoModal.tsx`, the close button (`X` icon) lacks an `aria-label`.
**Action:** Add `aria-label="Close"` to the close button.

## 2024-05-22 - [ESLint Setup]
**Learning:** Need to install `typescript-eslint` and related packages for `eslint.config.js` to work properly with the new flat config system.
**Action:** Install `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`.
