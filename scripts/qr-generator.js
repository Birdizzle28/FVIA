let qrInstance = null;

function slugifyPart(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function buildAgentPageUrl({ firstName = "", lastName = "", npn = "", baseUrl = "" } = {}) {
  const first = slugifyPart(firstName);
  const last = slugifyPart(lastName);
  const id = String(npn).trim();

  let cleanedBase = String(baseUrl || "").trim();
  if (!cleanedBase) cleanedBase = "https://familyvaluesgroup.com/a/";
  if (!cleanedBase.endsWith("/")) cleanedBase += "/";

  const pieces = [first, last, id].filter(Boolean);
  return cleanedBase + pieces.join("-");
}

function getEl(id) {
  return document.getElementById(id);
}

function setStatus(message, isError = false) {
  const el = getEl("status-message");
  if (!el) return;
  el.textContent = message || "";
  el.style.color = isError ? "#b91c1c" : "#353468";
}

function getFormValues() {
  return {
    directUrl: getEl("qr-url")?.value.trim() || "",
    firstName: getEl("first-name")?.value.trim() || "",
    lastName: getEl("last-name")?.value.trim() || "",
    npn: getEl("npn")?.value.trim() || "",
    baseUrl: getEl("base-url")?.value.trim() || "https://familyvaluesgroup.com/a/",
    frameText: getEl("frame-text")?.value.trim() || "Scan to Save My Contact",
    logoUrl: getEl("logo-url")?.value.trim() || "",
    size: parseInt(getEl("qr-size")?.value || "300", 10),
    safeMode: !!getEl("safe-mode")?.checked,
    downloadName: getEl("download-name")?.value.trim() || "agent-qr"
  };
}

function getFinalUrl() {
  const values = getFormValues();

  if (values.directUrl) return values.directUrl;

  return buildAgentPageUrl({
    firstName: values.firstName,
    lastName: values.lastName,
    npn: values.npn,
    baseUrl: values.baseUrl
  });
}

function updateDisplayedUrl(url) {
  const display = getEl("final-url-display");
  if (display) {
    display.textContent = url || "No URL generated yet.";
  }
}

function updateFrameText(text) {
  const frameTitle = getEl("qr-frame-title");
  if (frameTitle) {
    frameTitle.textContent = text || "Scan to Save My Contact";
  }
}

function clearQrMount() {
  const mount = getEl("qr-code-inner");
  if (mount) mount.innerHTML = "";
}

function createAgentQRCode({
  elementId = "qr-code-inner",
  url,
  size = 300,
  logo = "",
  safeMode = true
} = {}) {
  const mountEl = getEl(elementId);

  if (!mountEl) {
    setStatus(`QR mount element #${elementId} was not found.`, true);
    return null;
  }

  if (!url || typeof url !== "string") {
    setStatus("A valid URL is required to generate the QR code.", true);
    return null;
  }

  mountEl.innerHTML = "";

  const qr = new QRCodeStyling({
    width: size,
    height: size,
    type: "canvas",
    data: url,
    margin: safeMode ? 16 : 6,
    qrOptions: {
      typeNumber: 0,
      mode: "Byte",
      errorCorrectionLevel: safeMode ? "H" : "Q"
    },
    image: logo || "",
    imageOptions: {
      crossOrigin: "anonymous",
      hideBackgroundDots: true,
      margin: safeMode ? 8 : 3,
      imageSize: safeMode ? 0.22 : 0.28
    },
    dotsOptions: {
      type: "rounded",
      color: "#353468"
    },
    cornersSquareOptions: {
      type: "extra-rounded",
      color: "#545454"
    },
    cornersDotOptions: {
      type: "dot",
      color: "#ed9ea5"
    },
    backgroundOptions: {
      color: "#ffffff"
    }
  });

  qr.append(mountEl);
  qrInstance = qr;
  return qr;
}

function generateQrFromForm() {
  const values = getFormValues();
  const finalUrl = getFinalUrl();

  if (!finalUrl || !/^https?:\/\//i.test(finalUrl)) {
    setStatus("Please enter a full URL or build one with a valid base URL.", true);
    updateDisplayedUrl("");
    clearQrMount();
    return;
  }

  updateFrameText(values.frameText);
  updateDisplayedUrl(finalUrl);

  createAgentQRCode({
    elementId: "qr-code-inner",
    url: finalUrl,
    size: values.size,
    logo: values.logoUrl,
    safeMode: values.safeMode
  });

  setStatus("QR code generated.");
}

async function copyFinalUrl() {
  const url = getFinalUrl();

  if (!url) {
    setStatus("There is no URL to copy yet.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    updateDisplayedUrl(url);
    setStatus("URL copied.");
  } catch (err) {
    console.error(err);
    setStatus("Could not copy the URL on this device/browser.", true);
  }
}

function buildUrlIntoField() {
  const built = getFinalUrl();
  const directUrlInput = getEl("qr-url");

  if (directUrlInput) {
    directUrlInput.value = built;
  }

  updateDisplayedUrl(built);
  setStatus("Agent URL built.");
}

function downloadQr() {
  const values = getFormValues();

  if (!qrInstance) {
    setStatus("Generate the QR code first.", true);
    return;
  }

  qrInstance.download({
    name: values.downloadName || "agent-qr",
    extension: "png"
  });

  setStatus("Download started.");
}

function resetForm() {
  const defaults = {
    qrUrl: "",
    firstName: "",
    lastName: "",
    npn: "",
    baseUrl: "https://familyvaluesgroup.com/a/",
    frameText: "Scan to Save My Contact",
    logoUrl: "/Pics/img6.png",
    qrSize: "300",
    safeMode: true,
    downloadName: "agent-qr"
  };

  getEl("qr-url").value = defaults.qrUrl;
  getEl("first-name").value = defaults.firstName;
  getEl("last-name").value = defaults.lastName;
  getEl("npn").value = defaults.npn;
  getEl("base-url").value = defaults.baseUrl;
  getEl("frame-text").value = defaults.frameText;
  getEl("logo-url").value = defaults.logoUrl;
  getEl("qr-size").value = defaults.qrSize;
  getEl("safe-mode").checked = defaults.safeMode;
  getEl("download-name").value = defaults.downloadName;

  updateFrameText(defaults.frameText);
  updateDisplayedUrl("");
  clearQrMount();
  qrInstance = null;
  setStatus("Form reset.");
}

function hydrateFromQueryParams() {
  const params = new URLSearchParams(window.location.search);

  const mappings = [
    ["url", "qr-url"],
    ["first", "first-name"],
    ["last", "last-name"],
    ["npn", "npn"],
    ["base", "base-url"],
    ["frame", "frame-text"],
    ["logo", "logo-url"],
    ["download", "download-name"]
  ];

  mappings.forEach(([param, fieldId]) => {
    const value = params.get(param);
    if (value && getEl(fieldId)) {
      getEl(fieldId).value = value;
    }
  });

  const size = params.get("size");
  if (size && getEl("qr-size")) {
    getEl("qr-size").value = size;
  }

  const safe = params.get("safe");
  if (safe !== null && getEl("safe-mode")) {
    getEl("safe-mode").checked = safe !== "false";
  }
}

function bindLivePreview() {
  const ids = [
    "qr-url",
    "first-name",
    "last-name",
    "npn",
    "base-url",
    "frame-text",
    "logo-url",
    "qr-size",
    "safe-mode",
    "download-name"
  ];

  ids.forEach((id) => {
    const el = getEl(id);
    if (!el) return;

    const eventName = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(eventName, () => {
      if (id === "frame-text") {
        updateFrameText(el.value.trim() || "Scan to Save My Contact");
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  hydrateFromQueryParams();
  bindLivePreview();

  getEl("build-url-btn")?.addEventListener("click", buildUrlIntoField);
  getEl("copy-url-btn")?.addEventListener("click", copyFinalUrl);
  getEl("generate-qr-btn")?.addEventListener("click", generateQrFromForm);
  getEl("download-qr-btn")?.addEventListener("click", downloadQr);
  getEl("reset-form-btn")?.addEventListener("click", resetForm);

  updateFrameText(getEl("frame-text")?.value || "Scan to Save My Contact");

  const hasPresetData =
    getEl("qr-url")?.value.trim() ||
    getEl("first-name")?.value.trim() ||
    getEl("last-name")?.value.trim() ||
    getEl("npn")?.value.trim();

  if (hasPresetData) {
    generateQrFromForm();
  } else {
    setStatus("Ready to generate.");
  }
});
