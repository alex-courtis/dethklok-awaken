# AGENTS.md — Maintaining `dethklok-awaken`

## Project Overview
`dethklok-awaken` is a lightweight **Manifest V3** Chrome extension designed for **ChromeOS / ChromeOS Flex** (tested on a Lenovo ThinkPad X1 Yoga Gen 5 in tablet and laptop modes). Its sole responsibility is to prevent display dimming and idle device sleep while configured sites (initially `music.youtube.com` and `www.youtube.com`, all removable) are open in a browser tab or a standalone PWA/app window (`type: "app"`), and to release the keep-awake hold as soon as all matching tabs/windows are closed.

- **Target Runtime:** Chrome / ChromeOS Flex (Manifest V3 event-driven service worker)
- **Permissions:** `"power"`, `"tabs"`, `"storage"`, `"scripting"` (plus `"optional_host_permissions"` for user-added sites)
- **Core Files:**
  - `manifest.json` — Extension manifest (MV3, permissions, background service worker, toolbar `action` icon, embedded options UI, content script & web-accessible icon match patterns)
  - `background.js` — Service worker handling tab/window/storage/permission events, URL matching, serialized state evaluation, the enabled/disabled toggle (page badge message and toolbar icon click), the dimmed toolbar icon, `chrome.power` transitions, and timestamped console logging
  - `content.js` — Content script rendering/removing the squircle indicator badge in matching pages (orange when active, dimmed grey when disabled) and sending the right-click toggle request
  - `options.html` / `options.js` — Minimal embedded options UI for adding/removing any configured hostname (including defaults)

## Core Architecture & Design Invariants
Preserve these invariants when making edits:

1. **Top-Level Synchronous Listener Registration:**
   All `chrome.runtime.*`, `chrome.tabs.*`, `chrome.windows.*`, `chrome.storage.*`, and `chrome.permissions.*` event listeners—as well as the initial `scheduleEvaluation("service_worker_init")` call—must be registered synchronously at the top level of `background.js`. Do not defer listener registration inside async callbacks.
2. **Serialized State Evaluations (`evaluationQueue`):**
   Tab, window, storage, and permission events frequently fire in bursts (for example, `windows.onCreated` followed by `tabs.onCreated` and multiple `tabs.onUpdated` events during PWA launch). Keep evaluations serialized through `evaluationQueue` so concurrent queries and state updates do not race.
3. **Supported Hostname Matching (Configured Hosts):**
   Match normalized configured hostnames (`http:` or `https:`) stored in `chrome.storage.sync` (seeded once with `music.youtube.com` and `www.youtube.com`, with any site removable) across all paths via `URL` parsing.
4. **Explicit Release & Idempotent Transitions:**
   - When `matchingTabs.length > 0`, request `"display"` keep-awake via `chrome.power.requestKeepAwake("display")` only if `currentWakeState !== "display"`.
   - When `matchingTabs.length === 0`, call `chrome.power.releaseKeepAwake()` and transition `currentWakeState` to `"released"` so sleep is never left stuck on.
   - Always check `chrome.runtime.lastError` after `chrome.power` calls and log errors rather than silently swallowing failures.
5. **Enabled / Disabled Toggle:**
   - The indicator has `pointer-events: none` so left clicks and all other input pass through to the page underneath. Right-clicks (or touch long-presses) are caught by a capture-phase `contextmenu` listener on `window` in `content.js` that hit-tests the badge's bounding box; a hit sends `DETHKLOK_TOGGLE_ENABLED` to the service worker, which flips `extensionEnabled` in `chrome.storage.local` (device-local, defaults to enabled, persists across restarts).
   - The toggle runs through `evaluationQueue` (via `enqueue`) so rapid clicks cannot race; the resulting `storage.onChanged` event triggers a normal serialized evaluation.
   - While disabled, `shouldHold` is always `false` (keep-awake is released), but the indicator stays visible on matching pages in a dimmed grey state so it can be right-clicked to re-enable. The service worker sends `{ active, enabled }` in `YTM_WAKE_STATE`; the content script shows the badge when `active || !enabled`.
   - Left-clicking the toolbar icon (`chrome.action.onClicked`) toggles the same state through `enqueue`. This relies on the action having no `default_popup`; adding a popup would stop `onClicked` firing and require a different trigger. Right-clicking the toolbar icon is left to Chrome's own menu (extensions cannot intercept it).
   - The toolbar icon mirrors the page indicator: the Nathan squircle with the same orange (`#ff6a00`) outline when enabled; grey outline, greyscale and 60% opacity when disabled. Both variants are rendered at runtime via `OffscreenCanvas` (16/24/32/48px, border at least 1px so it stays visible) and applied with `chrome.action.setIcon`; keep the colours in `background.js` in sync with `content.js`. The manifest `default_icon` is the plain PNG and only shows briefly until the service worker applies the rendered icon. `setIcon`/`setTitle` do not persist across browser restarts, so `applyToolbarState` runs from `evaluateAndApplyState`. The tooltip says whether the extension is enabled and what a click does.
6. **Preserve Console Logging:**
   Timestamped `console.log` statements with the `[Dethklok Awaken ...]` prefix are intentionally kept for observability and field debugging on ChromeOS Flex. Keep them clear, structured, and non-noisy.

## Common Gotchas & ChromeOS Flex Context
- **Stuck Wake Lock Risk:** In an earlier draft, calling `requestKeepAwake("display")` without disciplined release/state tracking caused the device to stay awake even after closing tabs and restarting. Always test both opening *and* closing tabs and PWA windows after modifying `background.js`.
- **PWA / Standalone App Windows:** Installing YouTube Music, YouTube, or a custom site as a PWA opens a window with `type: "app"`. Both `chrome.windows.*` and `chrome.tabs.*` events fire and are queried across all windows (`chrome.tabs.query({})`), so keep multi-window/PWA behavior intact.
- **Android / ARC++ Apps vs. Web/PWA:** Browser extensions operate in the Chrome browser layer and do not directly observe Android container apps. Keep changes focused on Chrome tabs and PWA/app windows unless requirements explicitly change.
- **Hardware / Firmware Quirks:** `chrome.power` governs idle display dimming and idle suspend; it cannot override physical power-button faults or underlying ThinkPad ACPI/BIOS sleep issues.

## Testing & Verification Checklist
Because this is an unpacked extension without a complex build step, verify changes manually on ChromeOS Flex:

1. **Reload & Inspect:** Open `chrome://extensions`, click **Reload** on **Dethklok Awaken**, confirm zero manifest or service worker errors, and open **Service worker** DevTools to view the **Console**.
2. **Browser Tab Flow:**
   - Open `https://music.youtube.com`, any `https://www.youtube.com` page, or a user-added host in a normal browser tab.
   - Confirm logs show `STATE CHANGE -> DISPLAY AWAKE (requested)` and verify the display/device does not sleep while idle.
   - Close all matching tabs and confirm logs show `STATE CHANGE -> RELEASED (normal sleep restored)` and normal sleep resumes.
3. **PWA / App Window Flow:**
   - Launch YouTube Music, YouTube, or a custom site as an installed PWA/app window.
   - Confirm `DISPLAY AWAKE` activates without duplicate lock requests.
   - Close the PWA window (and any remaining matching tabs) and confirm `RELEASED` is logged and normal sleep resumes.

4. **Enable / Disable Toggle Flow:**
   - With a matching tab open and `DISPLAY AWAKE` active, right-click the indicator badge and confirm no browser context menu appears, the badge turns dimmed grey, and logs show `STATE CHANGE -> DISABLED` followed by `STATE CHANGE -> RELEASED (normal sleep restored)`.
   - Right-click the dimmed badge and confirm logs show `STATE CHANGE -> ENABLED` and `STATE CHANGE -> DISPLAY AWAKE (requested)` with the orange badge restored.
   - While disabled, close all matching tabs/windows and reload the extension; confirm the disabled state persists and sleep is not held.

5. **Toolbar Icon Toggle:**
   - Confirm the toolbar icon shows the squircle with an orange outline when enabled.
   - Left-click the toolbar icon and confirm it turns grey/dim with a grey outline, the tooltip reads `disabled (click to enable)`, the page badge dims, and logs show `STATE CHANGE -> DISABLED (toggled from toolbar icon)` then `RELEASED`.
   - Left-click again and confirm the icon, badge and `DISPLAY AWAKE` return.
   - Toggle from the page badge and confirm the toolbar icon follows; reload the extension while disabled and confirm the icon stays dim.

## Guidelines for Future Changes
- **Keep scope minimal:** Avoid adding unnecessary permissions, background polling loops, or complex UI unless asked.
- **Document behavior shifts:** If you add new triggers, configuration, or edge-case handling, update this `AGENTS.md` file alongside `manifest.json`, `background.js`, `content.js`, and `options.html`/`options.js`.
