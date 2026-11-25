const YTM_URL_PATTERNS = [
  "https://music.youtube.com/*",
  "http://music.youtube.com/*"
];

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

function isYouTubeMusicUrl(rawUrl) {
  if (!rawUrl) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.hostname === "music.youtube.com"
    );
  } catch {
    return false;
  }
}

async function getMatchingYouTubeMusicTabs() {
  const matchedById = new Map();

  const patternTabs = await chrome.tabs.query({ url: YTM_URL_PATTERNS });
  if (Array.isArray(patternTabs)) {
    for (const tab of patternTabs) {
      if (isYouTubeMusicUrl(tab.url) && typeof tab.id === "number") {
        matchedById.set(tab.id, tab.url);
      }
    }
  }

  const allTabs = await chrome.tabs.query({});
  if (Array.isArray(allTabs)) {
    for (const tab of allTabs) {
      const candidateUrl = isYouTubeMusicUrl(tab.url)
        ? tab.url
        : isYouTubeMusicUrl(tab.pendingUrl)
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
      logEvent("Confirmed no YouTube Music tabs open; state is 'released'");
    }
  }
}

async function evaluateAndApplyState(triggerReason) {
  const matchingTabs = await getMatchingYouTubeMusicTabs();
  const shouldHold = matchingTabs.length > 0;
  logEvent(`Evaluated trigger: ${triggerReason}`, {
    shouldHold,
    activeTabCount: matchingTabs.length
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
