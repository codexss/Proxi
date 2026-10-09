const DEFAULTS = {
  mode: "system",
  proxySettings: {
    scheme: "http",
    host: "127.0.0.1",
    port: 7890,
    bypassList: ["localhost", "127.0.0.1", "<local>"]
  }
};

function validMode(mode) {
  return ["direct", "system", "global"].includes(mode) ? mode : DEFAULTS.mode;
}

function iconPaths(mode) {
  const name = validMode(mode);
  return Object.fromEntries([16, 32, 48, 128].map((s) => [s, `icons/${name}-${s}.png`]));
}

function proxyConfig(mode, proxySettings) {
  if (mode === "direct" || mode === "system") return { mode };

  return {
    mode: "fixed_servers",
    rules: {
      singleProxy: {
        scheme: proxySettings.scheme,
        host: proxySettings.host,
        port: Number(proxySettings.port)
      },
      bypassList: proxySettings.bypassList || []
    }
  };
}

async function applyMode(mode, proxySettings, persist = true) {
  mode = validMode(mode);
  await chrome.proxy.settings.set({
    value: proxyConfig(mode, proxySettings),
    scope: "regular"
  });

  const tasks = [chrome.action.setIcon({ path: iconPaths(mode) })];
  if (persist) tasks.push(chrome.storage.local.set({ mode, proxySettings }));
  await Promise.all(tasks);
}

async function initialize(persist) {
  const saved = await chrome.storage.local.get(DEFAULTS);
  await applyMode(saved.mode, saved.proxySettings, persist);
}

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  return initialize(false);
}

restore().catch(console.error);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  initialize(reason === "install").catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  restore().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "applyProxy") return false;

  applyMode(message.mode, message.proxySettings)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
