const INITIAL_DEFAULT_HOSTS = ["music.youtube.com", "www.youtube.com"];
const STORAGE_KEY_HOSTS = "configuredHosts";
const STORAGE_KEY_INITIALIZED = "hostsInitialized";

const formEl = document.getElementById("add-form");
const inputEl = document.getElementById("host-input");
const listEl = document.getElementById("site-list");
const statusEl = document.getElementById("status");

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function normalizeHost(raw) {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url.hostname || null;
  } catch {
    return null;
  }
}

function hostPatterns(host) {
  return [`https://${host}/*`, `http://${host}/*`];
}

async function getConfiguredHosts() {
  const data = await chrome.storage.sync.get({
    [STORAGE_KEY_HOSTS]: [],
    [STORAGE_KEY_INITIALIZED]: false
  });
  if (data[STORAGE_KEY_INITIALIZED]) {
    return Array.isArray(data[STORAGE_KEY_HOSTS])
      ? Array.from(new Set(data[STORAGE_KEY_HOSTS].map(normalizeHost).filter(Boolean)))
      : [];
  }
  const defaults = [...INITIAL_DEFAULT_HOSTS];
  await chrome.storage.sync.set({
    [STORAGE_KEY_HOSTS]: defaults,
    [STORAGE_KEY_INITIALIZED]: true
  });
  return defaults;
}

async function saveConfiguredHosts(hosts) {
  await chrome.storage.sync.set({
    [STORAGE_KEY_HOSTS]: hosts,
    [STORAGE_KEY_INITIALIZED]: true
  });
}

function renderList(hosts) {
  listEl.innerHTML = "";

  for (const host of hosts) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = host;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Remove";
    btn.addEventListener("click", async () => {
      const next = hosts.filter((item) => item !== host);
      await saveConfiguredHosts(next);
      try {
        await chrome.permissions.remove({ origins: hostPatterns(host) });
      } catch {
        // Ignore if not an optional runtime origin permission.
      }
      setStatus(`Removed ${host}`);
      await refresh();
    });
    li.append(span, btn);
    listEl.appendChild(li);
  }
}

async function refresh() {
  const hosts = await getConfiguredHosts();
  renderList(hosts);
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  const host = normalizeHost(inputEl.value);
  if (!host) {
    setStatus("Enter a valid hostname or URL (e.g. twitch.tv)");
    return;
  }

  const current = await getConfiguredHosts();
  if (current.includes(host)) {
    setStatus(`${host} is already in the list`);
    return;
  }

  const granted = await chrome.permissions.request({ origins: hostPatterns(host) });
  if (!granted) {
    setStatus("Host permission was not granted");
    return;
  }

  const next = [...current, host];
  await saveConfiguredHosts(next);
  inputEl.value = "";
  setStatus(`Added ${host}`);
  await refresh();
});

void refresh();
