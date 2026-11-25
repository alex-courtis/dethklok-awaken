# AGENTS.md — Maintaining `ytm-keep-awake`

## Project Overview
`ytm-keep-awake` is a lightweight **Manifest V3** Chrome extension designed for **ChromeOS / ChromeOS Flex** (tested on a Lenovo ThinkPad X1 Yoga Gen 5 in tablet and laptop modes). Its sole responsibility is to prevent display dimming and idle device sleep while **YouTube Music** (`music.youtube.com`) is open in a browser tab or a standalone PWA/app window (`type: "app"`), and to release the keep-awake hold as soon as all matching tabs/windows are closed.

- **Target Runtime:** Chrome / ChromeOS Flex (Manifest V3 event-driven service worker)
- **Permissions:** `"power"`, `"tabs"`
- **Core Files:**
  - `manifest.json` — Extension manifest (MV3, permissions, background service worker)
  - `background.js` — Service worker handling tab/window events, URL matching, serialized state evaluation, `chrome.power` transitions, and timestamped console logging

## Core Architecture & Design Invariants
Preserve these invariants when making edits:

1. **Top-Level Synchronous Listener Registration:**
   All `chrome.runtime.*`, `chrome.tabs.*`, and `chrome.windows.*` event listeners—as well as the initial `scheduleEvaluation("service_worker_init")` call—must be registered synchronously at the top level of `background.js`. Do not defer listener registration inside async callbacks.
2. **Serialized State Evaluations (`evaluationQueue`):**
   Tab and window events frequently fire in bursts (for example, `windows.onCreated` followed by `tabs.onCreated` and multiple `tabs.onUpdated` events during PWA launch). Keep evaluations serialized through `evaluationQueue` so concurrent queries and state updates do not race.
3. **Strict Hostname Matching (`music.youtube.com`):**
   Only match `music.youtube.com` (`http:` or `https:`) via `URL` parsing (`parsed.hostname === "music.youtube.com"`). Do **not** broaden matching to `www.youtube.com` unless explicitly requested, as normal video tabs should not block sleep.
4. **Explicit Release & Idempotent Transitions:**
   - When `matchingTabs.length > 0`, request `"display"` keep-awake via `chrome.power.requestKeepAwake("display")` only if `currentWakeState !== "display"`.
   - When `matchingTabs.length === 0`, call `chrome.power.releaseKeepAwake()` and transition `currentWakeState` to `"released"` so sleep is never left stuck on.
   - Always check `chrome.runtime.lastError` after `chrome.power` calls and log errors rather than silently swallowing failures.
5. **Preserve Console Logging:**
   Timestamped `console.log` statements with the `[YTM Keep Awake ...]` prefix are intentionally kept for observability and field debugging on ChromeOS Flex. Keep them clear, structured, and non-noisy.

## Common Gotchas & ChromeOS Flex Context
- **Stuck Wake Lock Risk:** In an earlier draft, calling `requestKeepAwake("display")` without disciplined release/state tracking caused the device to stay awake even after closing tabs and restarting. Always test both opening *and* closing tabs and PWA windows after modifying `background.js`.
- **PWA / Standalone App Windows:** Installing YouTube Music as a PWA opens a window with `type: "app"`. Both `chrome.windows.*` and `chrome.tabs.*` events fire and are queried across all windows (`chrome.tabs.query({})`), so keep multi-window/PWA behavior intact.
- **Android / ARC++ Apps vs. Web/PWA:** Browser extensions operate in the Chrome browser layer and do not directly observe Android container apps. Keep changes focused on Chrome tabs and PWA/app windows unless requirements explicitly change.
- **Hardware / Firmware Quirks:** `chrome.power` governs idle display dimming and idle suspend; it cannot override physical power-button faults or underlying ThinkPad ACPI/BIOS sleep issues.

## Testing & Verification Checklist
Because this is an unpacked extension without a complex build step, verify changes manually on ChromeOS Flex:

1. **Reload & Inspect:** Open `chrome://extensions`, click **Reload** on **YouTube Music Keep Awake**, confirm zero manifest or service worker errors, and open **Service worker** DevTools to view the **Console**.
2. **Browser Tab Flow:**
   - Open `https://music.youtube.com` in a normal browser tab.
   - Confirm logs show `STATE CHANGE -> DISPLAY AWAKE (requested)` and verify the display/device does not sleep while idle.
   - Close the tab and confirm logs show `STATE CHANGE -> RELEASED (normal sleep restored)` and normal sleep resumes.
3. **PWA / App Window Flow:**
   - Launch YouTube Music as an installed PWA/app window.
   - Confirm `DISPLAY AWAKE` activates without duplicate lock requests.
   - Close the PWA window and confirm `RELEASED` is logged and normal sleep resumes.

## Guidelines for Future Changes
- **Keep scope minimal:** Avoid adding unnecessary permissions, background polling loops, or complex UI unless asked.
- **Document behavior shifts:** If you add new triggers, configuration, or edge-case handling, update this `AGENTS.md` file alongside `manifest.json` and `background.js`.