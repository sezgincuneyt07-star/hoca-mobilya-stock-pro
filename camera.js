(() => {
  "use strict";

  const APP_URL = "https://script.google.com/macros/s/AKfycbzKW87lp7ZpwzvrJr0W36rj_VCScP2MCZJBOdUnU4NX_i2K0fJeUUsjzZapnsT1kjrc/exec";
  const APP_ORIGIN_PATTERN = /^https:\/\/(script\.google\.com|(?:[a-z0-9-]+-)?script\.googleusercontent\.com)$/i;
  const CAMERA_DEVICE_KEY = "hoca_mobilya_v11_camera_device";

  const frame = document.getElementById("stockAppFrame");
  const loader = document.getElementById("appLoader");
  const overlay = document.getElementById("cameraOverlay");
  const video = document.getElementById("cameraVideo");
  const cover = document.getElementById("cameraCover");
  const coverText = document.getElementById("cameraCoverText");
  const cameraTitle = document.getElementById("cameraTitle");
  const cameraEngine = document.getElementById("cameraEngine");
  const closeButton = document.getElementById("closeCameraButton");
  const startButton = document.getElementById("startCameraButton");
  const switchButton = document.getElementById("switchCameraButton");
  const torchButton = document.getElementById("torchButton");
  const lastBarcode = document.getElementById("lastBarcode");
  const stockResult = document.getElementById("stockResult");
  const scanCounter = document.getElementById("scanCounter");
  const cameraMessage = document.getElementById("cameraMessage");
  const manualBarcode = document.getElementById("manualBarcode");
  const manualButton = document.getElementById("manualBarcodeButton");

  let mode = "quick";
  let stream = null;
  let track = null;
  let cameras = [];
  let cameraIndex = 0;
  let reader = null;
  let controls = null;
  let waitingForResult = false;
  let lastAcceptedBarcode = "";
  let lastAcceptedAt = 0;
  let successfulScans = 0;
  let torchEnabled = false;
  let appFrameReady = false;
  let appMessageTarget = null;

  frame.src = APP_URL;
  frame.addEventListener("load", () => {
    appFrameReady = true;
    loader.classList.add("hidden");
  });

  function setMessage(text, type = "") {
    cameraMessage.textContent = text || "";
    cameraMessage.className = "camera-message " + type;
  }

  function postToApp(payload) {
    const target = appMessageTarget || frame.contentWindow;
    if (!target) return;
    target.postMessage(payload, "*");
  }

  function beep(success = true) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = success ? 880 : 230;
      gain.gain.value = 0.06;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + (success ? 0.09 : 0.18));
      oscillator.onended = () => context.close();
    } catch (_) {}
  }

  function vibrate(success = true) {
    if (!navigator.vibrate) return;
    navigator.vibrate(success ? [70, 45, 70] : [180]);
  }

  async function enumerateCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameras = devices.filter(device => device.kind === "videoinput");
    switchButton.disabled = cameras.length < 2;
  }

  function preferredCameraIndex() {
    const saved = localStorage.getItem(CAMERA_DEVICE_KEY) || "";
    const savedIndex = cameras.findIndex(camera => camera.deviceId === saved);
    if (savedIndex >= 0) return savedIndex;

    const rearIndex = cameras.findIndex(camera =>
      /back|rear|environment|arka/i.test(camera.label || "")
    );
    return rearIndex >= 0 ? rearIndex : Math.max(0, cameras.length - 1);
  }

  function updateTorchButton() {
    let supported = false;
    try {
      const capabilities = track?.getCapabilities?.() || {};
      supported = Boolean(capabilities.torch);
    } catch (_) {}
    torchButton.disabled = !supported;
    torchButton.textContent = torchEnabled ? "Feneri Kapat" : "Feneri Aç";
  }

  function stopScanner() {
    if (controls) {
      try { controls.stop(); } catch (_) {}
      controls = null;
    }
    if (reader) {
      try { reader.reset(); } catch (_) {}
      reader = null;
    }
  }

  async function stopCamera() {
    stopScanner();
    torchEnabled = false;
    updateTorchButton();

    if (stream) {
      stream.getTracks().forEach(item => item.stop());
    }
    stream = null;
    track = null;
    video.srcObject = null;
    cover.classList.remove("hidden");
    coverText.textContent = "Kamera kapalı.";
    startButton.disabled = false;
  }

  async function startScanner() {
    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
      throw new Error("Barkod okuyucu yüklenemedi. İnternet bağlantısını kontrol edin.");
    }

    reader = new window.ZXingBrowser.BrowserMultiFormatReader();
    cameraEngine.textContent = "ZXing aktif";

    controls = await reader.decodeFromVideoElement(video, result => {
      if (result) acceptBarcode(result.getText());
    });
  }

  async function startCamera(deviceId = "") {
    if (!window.isSecureContext || location.protocol !== "https:") {
      setMessage("Kamera yalnızca HTTPS bağlantısında çalışır.", "error");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Bu tarayıcı kamera kullanımını desteklemiyor.", "error");
      return;
    }

    startButton.disabled = true;
    cover.classList.remove("hidden");
    coverText.textContent = "Kamera izni ve görüntü bekleniyor...";
    setMessage("Kamera hazırlanıyor...");

    try {
      await stopCamera();
      const constraints = deviceId
        ? { video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
        : { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      track = stream.getVideoTracks()[0] || null;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      await enumerateCameras();

      const settings = track?.getSettings?.() || {};
      if (settings.deviceId) localStorage.setItem(CAMERA_DEVICE_KEY, settings.deviceId);

      cover.classList.add("hidden");
      startButton.disabled = true;
      updateTorchButton();
      await startScanner();
      setMessage(
        mode === "quick"
          ? "Hazır. Okunan her kayıtlı barkod stoku anında +1 artırır."
          : "Hazır. Barkod stok işlem ekranına aktarılacak.",
        "success"
      );
    } catch (error) {
      await stopCamera();
      startButton.disabled = false;

      let message = error?.message || "Kamera başlatılamadı.";
      if (error?.name === "NotAllowedError") {
        message = "Kamera izni verilmedi. Adres çubuğundaki site ayarlarından Kamera → İzin ver seçin.";
      } else if (error?.name === "NotFoundError") {
        message = "Kullanılabilir kamera bulunamadı.";
      } else if (error?.name === "NotReadableError") {
        message = "Kamera başka bir uygulama tarafından kullanılıyor olabilir.";
      }

      coverText.textContent = message;
      setMessage(message, "error");
    }
  }

  async function openCamera(requestedMode = "quick") {
    mode = requestedMode === "stock" ? "stock" : "quick";
    cameraTitle.textContent = mode === "quick" ? "Hızlı Kamera — Otomatik Stok +1" : "Stok İşlemi Kamerası";
    waitingForResult = false;
    lastAcceptedBarcode = "";
    lastAcceptedAt = 0;
    lastBarcode.textContent = "Henüz okutulmadı";
    stockResult.textContent = mode === "quick" ? "Barkod bekleniyor" : "Ürün barkodu bekleniyor";
    setMessage("Kamera hazırlanıyor...");

    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("camera-open");

    postToApp({ source: "HOCA_MOBILYA_CAMERA", type: "CAMERA_READY", mode });

    try {
      await enumerateCameras();
      cameraIndex = preferredCameraIndex();
      await startCamera(cameras[cameraIndex]?.deviceId || "");
    } catch (_) {
      await startCamera();
    }
  }

  async function closeCamera(notifyApp = true) {
    await stopCamera();
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("camera-open");
    waitingForResult = false;

    if (notifyApp) {
      postToApp({ source: "HOCA_MOBILYA_CAMERA", type: "CAMERA_CLOSED", mode });
    }
  }

  function acceptBarcode(value) {
    const barcode = String(value || "").trim();
    if (!barcode || waitingForResult) return;

    const now = Date.now();
    if (barcode === lastAcceptedBarcode && now - lastAcceptedAt < 1800) return;

    lastAcceptedBarcode = barcode;
    lastAcceptedAt = now;
    waitingForResult = true;
    lastBarcode.textContent = barcode;
    stockResult.textContent = mode === "quick" ? "Stok +1 kaydediliyor..." : "Barkod aktarılıyor...";
    setMessage(barcode + " işleniyor...");
    beep(true);
    vibrate(true);

    postToApp({
      source: "HOCA_MOBILYA_CAMERA",
      type: "BARCODE_SCANNED",
      mode,
      scanId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      barcode
    });
  }

  function handleStockResult(data) {
    waitingForResult = false;

    if (data.success) {
      successfulScans += 1;
      scanCounter.textContent = String(successfulScans);
      stockResult.textContent = mode === "quick"
        ? "Stok +1 • Yeni stok: " + data.newStock
        : "Barkod aktarıldı";
      setMessage(data.message || "İşlem başarıyla tamamlandı.", "success");
      beep(true);
      vibrate(true);
      return;
    }

    stockResult.textContent = "Hata: " + (data.message || "İşlem tamamlanamadı");
    setMessage(data.message || "İşlem tamamlanamadı.", "error");
    beep(false);
    vibrate(false);
  }

  window.addEventListener("message", event => {
    if (!APP_ORIGIN_PATTERN.test(event.origin)) return;

    const data = event.data || {};
    if (data.source !== "HOCA_MOBILYA_APP") return;
    appMessageTarget = event.source;

    if (data.type === "OPEN_CAMERA") {
      openCamera(data.mode);
      return;
    }

    if (data.type === "APP_READY") {
      appFrameReady = true;
      return;
    }

    if (data.type === "SCAN_ACCEPTED") {
      stockResult.textContent = "Barkod alındı";
      return;
    }

    if (data.type === "STOCK_RESULT") {
      handleStockResult(data);
      return;
    }

    if (data.type === "PRODUCT_REQUIRED") {
      waitingForResult = false;
      stockResult.textContent = "Ürün kayıtlı değil";
      setMessage(data.message || "Ürün kayıtlı değil. Ürün ekleme ekranı açıldı.", "error");
      beep(false);
      vibrate(false);
      window.setTimeout(() => closeCamera(false), 650);
      return;
    }

    if (data.type === "SCAN_RESUME") {
      waitingForResult = false;
      setMessage("Kamera tekrar hazır.", "success");
      return;
    }

    if (data.type === "CLOSE_CAMERA" || data.type === "SESSION_CLOSED") {
      closeCamera(false);
    }
  });

  startButton.addEventListener("click", async () => {
    try {
      await enumerateCameras();
      cameraIndex = preferredCameraIndex();
      await startCamera(cameras[cameraIndex]?.deviceId || "");
    } catch (_) {
      await startCamera();
    }
  });

  switchButton.addEventListener("click", async () => {
    await enumerateCameras();
    if (cameras.length < 2) return;
    cameraIndex = (cameraIndex + 1) % cameras.length;
    await startCamera(cameras[cameraIndex].deviceId);
  });

  torchButton.addEventListener("click", async () => {
    if (!track) return;
    try {
      torchEnabled = !torchEnabled;
      await track.applyConstraints({ advanced: [{ torch: torchEnabled }] });
      updateTorchButton();
    } catch (_) {
      torchEnabled = false;
      updateTorchButton();
      setMessage("Bu cihazda fener kullanılamıyor.", "error");
    }
  });

  closeButton.addEventListener("click", () => closeCamera(true));
  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeCamera(true);
  });

  manualButton.addEventListener("click", () => {
    acceptBarcode(manualBarcode.value);
    manualBarcode.value = "";
    manualBarcode.focus();
  });
  manualBarcode.addEventListener("keydown", event => {
    if (event.key === "Enter") manualButton.click();
  });

  window.addEventListener("pagehide", () => stopCamera());

  window.setTimeout(() => {
    if (!appFrameReady) {
      loader.querySelector("span").textContent = "Uygulama beklenenden uzun sürede açılıyor...";
    }
  }, 12000);
})();
