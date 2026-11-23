const FALLBACK = {
  mode: "system",
  proxySettings: { scheme: "http", host: "127.0.0.1", port: 7890, bypassList: ["localhost", "127.0.0.1", "<local>"] }
};

const form = document.querySelector("#proxyForm");
const editProxy = document.querySelector("#editProxy");
const statusLine = document.querySelector("#status");
const { scheme, host, port, bypassList } = form.elements;
const modeControls = document.querySelectorAll(".mode");
let state = FALLBACK;
let editing = false;

function messageFor(key) {
  return chrome.i18n.getMessage(key) || key;
}

function localize() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.querySelectorAll("[data-i18n],[data-i18n-title],[data-i18n-aria]").forEach((element) => {
    const { i18n, i18nTitle, i18nAria } = element.dataset;
    if (i18n) element.textContent = messageFor(i18n);
    if (i18nTitle) {
      const label = messageFor(i18nTitle);
      element.title = label;
      element.setAttribute("aria-label", label);
    }
    if (i18nAria) element.setAttribute("aria-label", messageFor(i18nAria));
  });
}

function setStatus(code) {
  statusLine.textContent = code ? messageFor(code) : "";
  statusLine.hidden = !code;
}

function render() {
  modeControls.forEach((control) => {
    const active = control.dataset.mode === state.mode;
    control.classList.toggle("active", active);
    control.setAttribute("aria-pressed", String(active));
  });
  form.classList.toggle("visible", editing);
  editProxy.setAttribute("aria-expanded", String(editing));
  editProxy.classList.toggle("saving", editing);
  editProxy.title = messageFor(editing ? "saveProxy" : "editProxy");
  editProxy.setAttribute("aria-label", editProxy.title);
}

function setFormValues(proxySettings) {
  scheme.value = proxySettings.scheme;
  host.value = proxySettings.host;
  port.value = proxySettings.port;
  bypassList.value = (proxySettings.bypassList || []).join(", ");
}

function readProxySettings() {
  return {
    scheme: scheme.value,
    host: host.value,
    port: Number(port.value),
    bypassList: bypassList.value.split(",").map((item) => item.trim()).filter(Boolean)
  };
}

async function request(type, payload) {
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (!result || !result.ok) {
    const error = new Error((result && result.error) || "applyFailed");
    error.code = error.message;
    throw error;
  }
  return result;
}

async function apply(mode, proxySettings = state.proxySettings) {
  const result = await request("applyMode", { mode, proxySettings });
  state = { mode: result.mode, proxySettings: result.proxySettings };
  if (!editing) setFormValues(result.proxySettings);
  setStatus("");
  render();
}

function report(error) {
  console.error(error);
  setStatus((error && error.code) || "applyFailed");
}

async function selectMode(mode) {
  try {
    await apply(mode);
  } catch (error) {
    report(error);
  }
}

modeControls.forEach((control) => {
  const activate = () => selectMode(control.dataset.mode);
  control.addEventListener("click", activate);
  if (control.tagName !== "BUTTON") control.addEventListener("keydown", (event) => {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      activate();
    }
  });
});

editProxy.addEventListener("click", (event) => {
  event.stopPropagation();
  if (editing) return form.requestSubmit();
  editing = true;
  render();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await apply("global", readProxySettings());
    editing = false;
    render();
  } catch (error) {
    report(error);
  }
});

(async () => {
  localize();
  try {
    const current = await request("getState");
    state = { mode: current.mode, proxySettings: current.proxySettings };
    if (current.locked) setStatus("proxyLocked");
  } catch (error) {
    console.error(error);
  }
  setFormValues(state.proxySettings);
  render();
})();
