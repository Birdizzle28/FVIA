let qrCode = null;

const input = document.getElementById("qr-input");
const qrContainer = document.getElementById("qr-code");
const generateBtn = document.getElementById("generate-btn");
const downloadBtn = document.getElementById("download-btn");
const clearBtn = document.getElementById("clear-btn");
const statusEl = document.getElementById("status");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "crimson" : "#444";
}

function generateQRCode() {
  const value = input.value.trim();

  if (!value) {
    setStatus("Please enter text or a URL first.", true);
    return;
  }

  qrContainer.innerHTML = "";

  qrCode = new QRCodeStyling({
    width: 240,
    height: 240,
    type: "canvas",
    data: value,
    margin: 10,
    qrOptions: {
      errorCorrectionLevel: "H"
    },
    dotsOptions: {
      type: "rounded",
      color: "#000000"
    },
    backgroundOptions: {
      color: "#ffffff"
    }
  });

  qrCode.append(qrContainer);
  setStatus("QR code generated.");
}

function downloadQRCode() {
  if (!qrCode) {
    setStatus("Generate a QR code first.", true);
    return;
  }

  qrCode.download({
    name: "qr-code",
    extension: "png"
  });

  setStatus("Download started.");
}

function clearQRCode() {
  input.value = "";
  qrContainer.innerHTML = "";
  qrCode = null;
  setStatus("Cleared.");
}

generateBtn.addEventListener("click", generateQRCode);
downloadBtn.addEventListener("click", downloadQRCode);
clearBtn.addEventListener("click", clearQRCode);

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    generateQRCode();
  }
});
