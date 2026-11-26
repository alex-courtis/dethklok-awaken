const INDICATOR_ID = "dethklok-awaken-indicator";
const SQUIRCLE_RADIUS = "13.5px";
const ORANGE_OUTLINE = "#ff6a00";

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

function setWakeIndicatorVisible(visible) {
  const existing = document.getElementById(INDICATOR_ID);

  if (!visible) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  if (existing) {
    return;
  }

  const badge = createNathanSquircleBadge();
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
    setWakeIndicatorVisible(Boolean(message.active));
    sendResponse({ ok: true });
  }
});
