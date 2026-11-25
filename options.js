const DEFAULT_HOSTS = ["music.youtube.com", "www.youtube.com"];
const STORAGE_KEY_CUSTOM_HOSTS = "customHosts";

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

async function getCustomHosts() {
  const data = await chrome.storage.sync.get({ [STORAGE_KEY_CUSTOM_HOSTS]: [] });
  return Array.isArray(data[STORAGE_KEY_CUSTOM_HOSTS]) ? data[STORAGE_KEY_CUSTOM_HOSTS] : [];
}

async function saveCustomHosts(hosts) {
  await chrome.storage.sync.set({ [STORAGE_KEY_CUSTOM_HOSTS]: hosts });
}

function renderList(customHosts) {
  listEl.innerHTML = "";

  for (const host of DEFAULT_HOSTS) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = host;
    const tag = document.createElement("span");
    tag.className = "muted";
    tag.textContent = "default";
    li.append(span, tag);
    listEl.appendChild(li);
  }

  for (const host of customHosts) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = host;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Remove";
    btn.addEventListener("click", async () => {
      const next = customHosts.filter((item) => item !== host);
      await saveCustomHosts(next);
      try {
        await chrome.permissions.remove({ origins: hostPatterns(host) });
      } catch {
        // Ignore if already removed.
      }
      setStatus(`Removed ${host}`);
      await refresh();
    });
    li.append(span, btn);
    listEl.appendChild(li);
  }
}

async function refresh() {
  const customHosts = await getCustomHosts();
  renderList(customHosts);
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  const host = normalizeHost(inputEl.value);
  if (!host) {
    setStatus("Enter a valid hostname or URL (e.g. twitch.tv)");
    return;
  }

  const current = await getCustomHosts();
  if (DEFAULT_HOSTS.includes(host) || current.includes(host)) {
    setStatus(`${host} is already in the list`);
    return;
  }

  const granted = await chrome.permissions.request({ origins: hostPatterns(host) });
  if (!granted) {
    setStatus("Host permission was not granted");
    return;
  }

  const next = [...current, host];
  await saveCustomHosts(next);
  inputEl.value = "";
  setStatus(`Added ${host}`);
  await refresh();
});

void refresh();
