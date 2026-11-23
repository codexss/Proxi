const MODES = ["direct", "system", "global"];
const SCHEMES = ["http", "https", "socks4", "socks5"];
const LOCKED = ["not_controllable", "controlled_by_other_extensions"];

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
  return MODES.includes(mode) ? mode : DEFAULTS.mode;
}

function iconPaths(mode) {
  const name = validMode(mode);
  return Object.fromEntries([16, 32, 48, 128].map((size) => [size, `icons/${name}-${size}.png`]));
}

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function sanitize(input) {
  const source = input && typeof input === "object" ? input : {};
  const port = Number(source.port);

  return {
    scheme: SCHEMES.includes(source.scheme) ? source.scheme : DEFAULTS.proxySettings.scheme,
    host: typeof source.host === "string" && source.host.trim() ? source.host.trim() : DEFAULTS.proxySettings.host,
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULTS.proxySettings.port,
    bypassList: Array.isArray(source.bypassList)
      ? source.bypassList.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : [...DEFAULTS.proxySettings.bypassList]
  };
}

function proxyConfig(mode, proxySettings) {
  if (mode !== "global") return { mode: validMode(mode) };

  return {
    mode: "fixed_servers",
    rules: {
      singleProxy: {
        scheme: proxySettings.scheme,
        host: proxySettings.host,
        port: Number(proxySettings.port)
      },
      bypassList: proxySettings.bypassList
    }
  };
}

function modeFromValue(value) {
  if (!value) return null;
  if (value.mode === "fixed_servers") return "global";
  return MODES.includes(value.mode) ? value.mode : null;
}

async function readCurrent() {
  try {
    return await chrome.proxy.settings.get({ incognito: false });
  } catch (error) {
    console.error(error);
    return { levelOfControl: "controllable_by_this_extension", value: null };
  }
}

// 写代理前先看权限：被别的扩展或系统策略接管时 set() 不会报错，只会静默失效
async function setProxy(mode, proxySettings) {
  const current = await readCurrent();
  if (LOCKED.includes(current.levelOfControl)) {
    console.warn("proxy levelOfControl:", current.levelOfControl);
    fail("proxyLocked");
  }

  // scope "regular" 会被无痕 profile 继承（ChromeSettingScope），一套规则同时覆盖普通与无痕窗口
  await chrome.proxy.settings.set({
    value: proxyConfig(mode, proxySettings),
    scope: "regular"
  });
}

let iconMode = null;
async function setIcon(mode) {
  const name = validMode(mode);
  if (iconMode === name) return;

  iconMode = name;
  try {
    await chrome.action.setIcon({ path: iconPaths(name) });
  } catch (error) {
    iconMode = null;
    console.error(error);
  }
}

// 所有写代理/读状态的任务串行执行，避免 SW 冷启动时的 restore 与用户点击互相覆盖
let queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function applyMode(mode, proxySettings, persist = true) {
  mode = validMode(mode);
  const settings = sanitize(proxySettings);

  await setProxy(mode, settings);
  if (persist) await chrome.storage.local.set({ mode, proxySettings: settings });
  await setIcon(mode);

  return { mode, proxySettings: settings };
}

async function initialize(persist) {
  const saved = await chrome.storage.local.get(DEFAULTS);
  return applyMode(saved.mode, saved.proxySettings, persist);
}

let restored = false;
async function restore() {
  if (restored) return;
  await initialize(false);
  restored = true;
}

async function getState() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  const current = await readCurrent();
  const value = current.value;
  const rules = (value && value.rules) || {};
  const single = value && value.mode === "fixed_servers" ? rules.singleProxy : null;

  return {
    mode: modeFromValue(value) || validMode(stored.mode),
    locked: LOCKED.includes(current.levelOfControl),
    proxySettings: single
      ? sanitize({
          scheme: single.scheme,
          host: single.host,
          port: single.port,
          bypassList: rules.bypassList || stored.proxySettings.bypassList
        })
      : sanitize(stored.proxySettings)
  };
}

enqueue(restore).catch(console.error);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  enqueue(() => initialize(reason === "install")).catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  enqueue(restore).catch(console.error);
});

// 代理被外部改动时（别的扩展、策略），让图标和 storage 跟着实际情况走，避免下次冷启动把旧值写回去
chrome.proxy.settings.onChange.addListener((details) => {
  const mode = modeFromValue(details && details.value);
  if (!mode) return;

  setIcon(mode).catch(console.error);
  chrome.storage.local.set({ mode }).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender || sender.id !== chrome.runtime.id) return false;

  let task;
  switch (message && message.type) {
    case "getState":
      task = getState;
      break;
    case "applyMode":
    case "applyProxy":
      task = () => applyMode(message.mode, message.proxySettings);
      break;
    default:
      return false;
  }

  enqueue(task).then(
    (data) => sendResponse({ ok: true, ...data }),
    (error) => sendResponse({ ok: false, error: (error && error.code) || "applyFailed" })
  );
  return true;
});
