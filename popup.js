const DEFAULTS = {
  mode: "system",
  proxySettings: { scheme: "http", host: "127.0.0.1", port: 7890, bypassList: ["localhost", "127.0.0.1", "<local>"] }
};

const form = document.querySelector("#proxyForm");
const editProxy = document.querySelector("#editProxy");
const { scheme, host, port, bypassList } = form.elements;
const modeControls = document.querySelectorAll(".mode");
let state = DEFAULTS;
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

async function apply(mode, proxySettings = state.proxySettings) {
  const result = await chrome.runtime.sendMessage({ type: "applyProxy", mode, proxySettings });
  if (!result?.ok) throw new Error(result?.error || "设置失败");
  state = { mode, proxySettings };
}

async function selectMode(mode) {
  try {
    await apply(mode);
    render();
  } catch (error) { console.error(error); }
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
  } catch (error) { console.error(error); }
});

(async () => {
  localize();
  state = await chrome.storage.local.get(DEFAULTS);
  setFormValues(state.proxySettings);
  render();
})().catch(console.error);
