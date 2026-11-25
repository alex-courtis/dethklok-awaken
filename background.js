const DEFAULT_HOSTNAMES = [
  "music.youtube.com",
  "www.youtube.com"
];

const STORAGE_KEY_CUSTOM_HOSTS = "customHosts";

// "display" = active wake lock held by this extension; "released" = lock released/inactive.
let currentWakeState = "released";
let evaluationQueue = Promise.resolve();

function logEvent(message, details = null) {
  const stamp = new Date().toISOString();
  if (details !== null) {
    console.log(`[YTM Keep Awake ${stamp}] ${message}`, details);
  } else {
    console.log(`[YTM Keep Awake ${stamp}] ${message}`);
  }
}

function normalizeHostname(input) {
  if (!input || typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  try {
    const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

async function getConfiguredHostnames() {
  const hosts = new Set(DEFAULT_HOSTNAMES);
  try {
    const stored = await chrome.storage.sync.get({ [STORAGE_KEY_CUSTOM_HOSTS]: [] });
    const list = Array.isArray(stored[STORAGE_KEY_CUSTOM_HOSTS])
      ? stored[STORAGE_KEY_CUSTOM_HOSTS]
      : [];
    for (const raw of list) {
      const host = normalizeHostname(raw);
      if (host) {
        hosts.add(host);
      }
    }
  } catch (err) {
    logEvent("ERROR reading custom hosts from storage", String(err));
  }
  return hosts;
}

function isSupportedUrl(rawUrl, allowedHosts) {
  if (!rawUrl) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      allowedHosts.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function hostToOriginPatterns(host) {
  return [`https://${host}/*`, `http://${host}/*`];
}

async function ensureContentScriptForTab(tabId) {
  if (typeof tabId !== "number") {
    return false;
  }
  try {
    await chrome.tabs.sendMessage(tabId, { type: "YTM_WAKE_PING" });
    return true;
  } catch {
    // Not yet injected; attempt programmatic injection if host permission is granted.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return true;
  } catch {
    return false;
  }
}

async function getMatchingTabs(allowedHosts) {
  const matchedById = new Map();
  const patterns = [];
  for (const host of allowedHosts) {
    patterns.push(...hostToOriginPatterns(host));
  }

  if (patterns.length > 0) {
    try {
      const patternTabs = await chrome.tabs.query({ url: patterns });
      if (Array.isArray(patternTabs)) {
        for (const tab of patternTabs) {
          if (isSupportedUrl(tab.url, allowedHosts) && typeof tab.id === "number") {
            matchedById.set(tab.id, tab.url);
          }
        }
      }
    } catch {
      // Fallback to chrome.tabs.query({}) below if a dynamic pattern is not granted.
    }
  }

  const allTabs = await chrome.tabs.query({});
  if (Array.isArray(allTabs)) {
    for (const tab of allTabs) {
      const candidateUrl = isSupportedUrl(tab.url, allowedHosts)
        ? tab.url
        : isSupportedUrl(tab.pendingUrl, allowedHosts)
          ? tab.pendingUrl
          : null;
      if (candidateUrl && typeof tab.id === "number" && !matchedById.has(tab.id)) {
        matchedById.set(tab.id, candidateUrl);
      }
    }
  }

  return Array.from(matchedById.entries()).map(([id, url]) => ({ id, url }));
}

async function syncIndicatorsToTabs(matchingTabs, isActive) {
  for (const tab of matchingTabs) {
    if (isActive) {
      await ensureContentScriptForTab(tab.id);
    }
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "YTM_WAKE_STATE",
        active: isActive
      });
    } catch {
      // Content script may not be ready yet if the tab is still spinning up;
      // tabs.onUpdated with status === "complete" will re-sync.
    }
  }
}

async function setDisplayWakeLock(shouldHold, matchingTabs) {
  if (shouldHold) {
    if (currentWakeState !== "display") {
      chrome.power.requestKeepAwake("display");
      if (chrome.runtime.lastError) {
        logEvent("ERROR requesting keep-awake ('display')", chrome.runtime.lastError.message);
        return;
      }

      currentWakeState = "display";
      logEvent("STATE CHANGE -> DISPLAY AWAKE (requested)", {
        activeTabCount: matchingTabs.length,
        tabs: matchingTabs
      });
    } else {
      logEvent("Keep-awake ('display') already active", {
        activeTabCount: matchingTabs.length
      });
    }

    await syncIndicatorsToTabs(matchingTabs, true);
  } else {
    chrome.power.releaseKeepAwake();
    if (chrome.runtime.lastError) {
      logEvent("ERROR releasing keep-awake", chrome.runtime.lastError.message);
      return;
    }

    if (currentWakeState !== "released") {
      currentWakeState = "released";
      logEvent("STATE CHANGE -> RELEASED (normal sleep restored)");
    } else {
      logEvent("Confirmed no matching tabs open; state is 'released'");
    }
  }
}

async function evaluateAndApplyState(triggerReason) {
  const allowedHosts = await getConfiguredHostnames();
  const matchingTabs = await getMatchingTabs(allowedHosts);
  const shouldHold = matchingTabs.length > 0;
  logEvent(`Evaluated trigger: ${triggerReason}`, {
    shouldHold,
    activeTabCount: matchingTabs.length,
    hosts: Array.from(allowedHosts)
  });
  await setDisplayWakeLock(shouldHold, matchingTabs);
}

function scheduleEvaluation(triggerReason) {
  evaluationQueue = evaluationQueue
    .catch((err) => {
      logEvent("Recovered queue from previous error", String(err));
    })
    .then(async () => {
      await evaluateAndApplyState(triggerReason);
    });
  return evaluationQueue;
}

// Register all listeners synchronously at the top level for Manifest V3 service workers.
chrome.runtime.onInstalled.addListener((details) => {
  void scheduleEvaluation(`runtime.onInstalled (${details.reason})`);
});

chrome.runtime.onStartup.addListener(() => {
  void scheduleEvaluation("runtime.onStartup");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[STORAGE_KEY_CUSTOM_HOSTS]) {
    void scheduleEvaluation("storage.onChanged (customHosts)");
  }
});

chrome.permissions.onAdded.addListener(() => {
  void scheduleEvaluation("permissions.onAdded");
});

chrome.permissions.onRemoved.addListener(() => {
  void scheduleEvaluation("permissions.onRemoved");
});

chrome.tabs.onCreated.addListener((tab) => {
  void scheduleEvaluation(`tabs.onCreated (tabId=${tab.id})`);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url !== undefined || changeInfo.status === "complete") {
    void scheduleEvaluation(
      `tabs.onUpdated (tabId=${tabId}, status=${changeInfo.status ?? "n/a"}, urlChanged=${changeInfo.url !== undefined})`
    );
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void scheduleEvaluation(`tabs.onRemoved (tabId=${tabId})`);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void scheduleEvaluation(`tabs.onReplaced (added=${addedTabId}, removed=${removedTabId})`);
});

chrome.windows.onCreated.addListener((win) => {
  void scheduleEvaluation(`windows.onCreated (windowId=${win.id}, type=${win.type})`);
});

chrome.windows.onRemoved.addListener((windowId) => {
  void scheduleEvaluation(`windows.onRemoved (windowId=${windowId})`);
});

// Initial evaluation on service worker spin-up so pre-existing tabs/PWAs are detected.
void scheduleEvaluation("service_worker_init");
