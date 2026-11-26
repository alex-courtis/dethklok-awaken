const INDICATOR_ID = "dethklok-awaken-indicator";
const SQUIRCLE_RADIUS = "13.5px";
const ORANGE_OUTLINE = "#ff6a00";
const DISABLED_OUTLINE = "#6b6b75";
const TOGGLE_MESSAGE = "DETHKLOK_TOGGLE_ENABLED";

function requestToggle() {
  try {
    const pending = chrome.runtime.sendMessage({ type: TOGGLE_MESSAGE });
    if (pending && typeof pending.catch === "function") {
      pending.catch(() => {});
    }
  } catch {
    // Extension context invalidated (extension reloaded); nothing to do.
  }
}

function applyBadgeState(badge, enabled) {
  const img = badge.firstElementChild;
  badge.style.borderColor = enabled ? ORANGE_OUTLINE : DISABLED_OUTLINE;
  badge.style.opacity = enabled ? "1" : "0.6";
  if (img) {
    img.style.filter = enabled ? "none" : "grayscale(1)";
  }
}

// The badge itself ignores pointer events so left clicks (and everything else) reach the
// page underneath. Right-clicks are detected here instead, by hit-testing the badge's box.
function isInsideBadge(event) {
  const badge = document.getElementById(INDICATOR_ID);
  if (!badge) {
    return false;
  }
  const rect = badge.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

// Capture phase on window so this runs before page handlers; also covers touch long-press.
window.addEventListener(
  "contextmenu",
  (event) => {
    if (!isInsideBadge(event)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    requestToggle();
  },
  true
);

function createNathanSquircleBadge() {
  const badge = document.createElement("div");
  badge.id = INDICATOR_ID;
  badge.setAttribute("aria-hidden", "true");
  Object.assign(badge.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    width: "60px",
    height: "60px",
    borderRadius: SQUIRCLE_RADIUS,
    border: `2px solid ${ORANGE_OUTLINE}`,
    boxSizing: "border-box",
    overflow: "hidden",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.45)",
    pointerEvents: "none",
    zIndex: "2147483647",
    backgroundColor: "#121216"
  });

  const img = document.createElement("img");
  img.src = chrome.runtime.getURL("icons/nathan-squircle-120.png");
  img.alt = "Nathan Explosion";
  Object.assign(img.style, {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: "11px",
    pointerEvents: "none"
  });

  badge.appendChild(img);
  return badge;
}

function setWakeIndicatorVisible(visible, enabled) {
  const existing = document.getElementById(INDICATOR_ID);

  if (!visible) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  if (existing) {
    applyBadgeState(existing, enabled);
    return;
  }

  const badge = createNathanSquircleBadge();
  applyBadgeState(badge, enabled);
  (document.body || document.documentElement).appendChild(badge);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) {
    return;
  }

  if (message.type === "YTM_WAKE_PING") {
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "YTM_WAKE_STATE") {
    const enabled = message.enabled !== false;
    // Keep the badge visible while disabled so it can be right-clicked to re-enable.
    setWakeIndicatorVisible(Boolean(message.active) || !enabled, enabled);
    sendResponse({ ok: true });
  }
});
