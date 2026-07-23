(() => {
  "use strict";

  const video = document.getElementById("video");
  const cover = document.getElementById("cover");
  const startBtn = document.getElementById("startBtn");
  const switchBtn = document.getElementById("switchBtn");
  const stopBtn = document.getElementById("stopBtn");

  const barcodeValue = document.getElementById("barcodeValue");
  const scanCount = document.getElementById("scanCount");
  const httpsState = document.getElementById("httpsState");
  const cameraState = document.getElementById("cameraState");
  const videoState = document.getElementById("videoState");
  const videoSize = document.getElementById("videoSize");
  const deviceName = document.getElementById("deviceName");
  const zxingState = document.getElementById("zxingState");
  const scanState = document.getElementById("scanState");
  const logBox = document.getElementById("log");
  const manualBarcode = document.getElementById("manualBarcode");
  const manualBtn = document.getElementById("manualBtn");
  const appConnection = document.getElementById("appConnection");
  const returnBtn = document.getElementById("returnBtn");

  const params = new URLSearchParams(window.location.search);
  const privateParams = new URLSearchParams(
    String(window.location.hash || "").replace(/^#/, "")
  );

  const cameraMode = params.get("mode") === "stock" ? "stock" : "quick";
  const returnUrl = String(params.get("returnUrl") || "").trim();
  const configuredAppOrigin = String(params.get("appOrigin") || "").trim();
  const sessionToken = String(privateParams.get("sessionToken") || "").trim();
  const apiUrlCandidate = String(privateParams.get("apiUrl") || returnUrl || "").trim();
  const apiUrl = isAllowedApiUrl(apiUrlCandidate) ? apiUrlCandidate : "";

  /* Hassas token adres çubuğunda görünmesin. Değer bellekte tutulmaya devam eder. */
  if (window.location.hash) {
    try {
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + window.location.search
      );
    } catch (_) {}
  }

  let stream = null;
  let cameras = [];
  let cameraIndex = 0;
  let codeReader = null;
  let scanControls = null;
  let totalScans = 0;
  let lastBarcode = "";
  let lastBarcodeTime = 0;
  let waitingForStockResult = false;
  let activeScanId = "";
  let appReady = false;

  function isAllowedApiUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return (
        url.protocol === "https:" &&
        url.hostname === "script.google.com" &&
        /\/macros\/s\//.test(url.pathname)
      );
    } catch (_) {
      return false;
    }
  }

  function isAllowedAppOrigin(origin) {
    if (!origin) return false;
    if (configuredAppOrigin && origin === configuredAppOrigin) return true;
    return /^https:\/\/(script\.google\.com|[a-z0-9-]+-script\.googleusercontent\.com)$/i.test(origin);
  }

  function postToStockApp(payload) {
    const target = window.opener && !window.opener.closed ? window.opener : null;
    if (!target) return false;

    try {
      target.postMessage(payload, configuredAppOrigin || "*");
      return true;
    } catch (_) {
      return false;
    }
  }

  function notifyReady() {
    const sent = postToStockApp({
      source: "HOCA_MOBILYA_CAMERA",
      type: "CAMERA_READY",
      mode: cameraMode
    });

    if (cameraMode === "quick" && sessionToken && apiUrl) {
      appConnection.textContent = "Doğrudan stok bağlantısı hazır";
      return;
    }

    if (sent) {
      appConnection.textContent = appReady
        ? "Stok programına bağlı"
        : "Stok programı yanıtı bekleniyor";
    } else {
      appConnection.textContent = "Stok uygulamasına dönüş bağlantısı hazır";
    }
  }

  function returnToStockApp(barcode = "", cancelled = false) {
    if (!returnUrl) return;
    const url = new URL(returnUrl);
    if (barcode) url.searchParams.set("cameraBarcode", barcode);
    url.searchParams.set("cameraMode", cameraMode);
    if (cancelled) url.searchParams.set("cameraCancelled", "1");

    if (sessionToken) {
      const returnPrivateParams = new URLSearchParams();
      returnPrivateParams.set("cameraToken", sessionToken);
      url.hash = returnPrivateParams.toString();
    }

    window.location.assign(url.toString());
  }

  function callCameraApi(action, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!apiUrl || !sessionToken) {
        reject(new Error("Kamera oturumu bulunamadı. Kamerayı stok uygulamasından yeniden açın."));
        return;
      }

      const callbackName =
        `__hocaCameraApi_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const script = document.createElement("script");
      const url = new URL(apiUrl);
      let finished = false;

      const cleanup = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeoutId);
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      window[callbackName] = response => {
        cleanup();
        resolve(response || { success: false, message: "Sunucudan boş yanıt alındı." });
      };

      url.searchParams.set("cameraApi", "1");
      url.searchParams.set("action", action);
      url.searchParams.set("token", sessionToken);
      url.searchParams.set("callback", callbackName);
      url.searchParams.set("_", String(Date.now()));

      Object.entries(payload).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });

      script.async = true;
      script.src = url.toString();
      script.onerror = () => {
        cleanup();
        reject(new Error("Stok sunucusuna bağlanılamadı."));
      };

      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error("Stok sunucusu zaman aşımına uğradı."));
      }, 20000);

      document.head.appendChild(script);
    });
  }

  function applyStockResult(data, syncWithApp = false) {
    if (data.scanId && activeScanId && data.scanId !== activeScanId) return;

    waitingForStockResult = false;
    activeScanId = "";

    if (data.success) {
      barcodeValue.textContent =
        `${data.barcode || lastBarcode} • Yeni stok: ${data.newStock}`;
      scanState.textContent = "Stok kaydedildi";
      appConnection.textContent = data.message || "Doğrudan stok bağlantısı hazır";
      beep();
      vibrate();
      window.setTimeout(() => {
        if (stream) scanState.textContent = "Taranıyor";
      }, 500);
    } else {
      scanState.textContent =
        data.code === "PRODUCT_NOT_FOUND"
          ? "Ürün bulunamadı"
          : "Stok işlemi başarısız";
      appConnection.textContent = data.message || "Stok işlemi yapılamadı";
      window.setTimeout(() => {
        if (stream) scanState.textContent = "Taranıyor";
      }, 900);
    }

    if (syncWithApp) {
      postToStockApp({
        source: "HOCA_MOBILYA_CAMERA",
        type: "DIRECT_STOCK_RESULT",
        success: Boolean(data.success),
        barcode: data.barcode || lastBarcode,
        newStock: data.newStock,
        productName:
          data.product && data.product.model
            ? data.product.model
            : "Ürün",
        code: data.code || "",
        message: data.message || ""
      });
    }
  }

  async function sendBarcodeToStockApp(barcode) {
    activeScanId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    waitingForStockResult = true;
    scanState.textContent =
      cameraMode === "quick"
        ? "Stok +1 kaydediliyor"
        : "Barkod aktarılıyor";

    if (cameraMode === "quick") {
      try {
        const result = await callCameraApi("quickStockIn", {
          barcode,
          scanId: activeScanId
        });
        applyStockResult(result, true);
      } catch (error) {
        applyStockResult({
          success: false,
          barcode,
          code: "CONNECTION_ERROR",
          message: error && error.message
            ? error.message
            : "Stok sunucusuna bağlanılamadı."
        }, true);
      }
      return;
    }

    const sent = postToStockApp({
      source: "HOCA_MOBILYA_CAMERA",
      type: "BARCODE_SCANNED",
      scanId: activeScanId,
      barcode,
      mode: cameraMode
    });

    if (!sent) {
      window.setTimeout(() => returnToStockApp(barcode, false), 150);
    }
  }

  function log(message, error) {
    const lines = [message];

    if (error?.name) lines.push(`Hata adı: ${error.name}`);
    if (error?.message) lines.push(`Açıklama: ${error.message}`);

    lines.push(`readyState: ${video.readyState}`);
    lines.push(`paused: ${video.paused}`);
    lines.push(`videoWidth: ${video.videoWidth}`);
    lines.push(`videoHeight: ${video.videoHeight}`);

    logBox.textContent = lines.join("\n");
  }

  function updateVideoStatus() {
    const names = {
      0: "Veri yok",
      1: "Metadata yüklendi",
      2: "Kare hazır",
      3: "İleri veri var",
      4: "Oynatmaya hazır"
    };

    videoState.textContent = names[video.readyState] || String(video.readyState);
    videoSize.textContent = `${video.videoWidth || 0} × ${video.videoHeight || 0}`;
  }

  function beep() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.frequency.value = 880;
      gain.gain.value = 0.08;

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
      oscillator.onended = () => context.close();
    } catch (_) {}
  }

  function vibrate() {
    if ("vibrate" in navigator) {
      navigator.vibrate([100, 60, 100]);
    }
  }

  function acceptBarcode(value) {
    const barcode = String(value || "").trim();
    if (!barcode) return;

    const now = Date.now();

    if (waitingForStockResult) return;

    if (barcode === lastBarcode && now - lastBarcodeTime < 2200) {
      return;
    }

    lastBarcode = barcode;
    lastBarcodeTime = now;
    totalScans += 1;

    barcodeValue.textContent = barcode;
    scanCount.textContent = `${totalScans} okuma`;
    scanState.textContent = "Barkod bulundu";

    beep();
    vibrate();
    sendBarcodeToStockApp(barcode);
  }

  function prepareZxing() {
    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
      zxingState.textContent = "Yüklenemedi";
      scanState.textContent = "Okuyucu hazır değil";
      log("ZXing kütüphanesi yüklenemedi. İnternet bağlantısını kontrol et.");
      return false;
    }

    codeReader = new window.ZXingBrowser.BrowserMultiFormatReader();
    zxingState.textContent = "Hazır";
    return true;
  }

  async function startBarcodeScanning() {
    if (!codeReader && !prepareZxing()) return;

    stopBarcodeScanning();
    scanState.textContent = "Taranıyor";

    try {
      scanControls = await codeReader.decodeFromVideoElement(
        video,
        (result, error) => {
          if (result) {
            acceptBarcode(result.getText());
          }

          if (
            error &&
            error.name !== "NotFoundException" &&
            error.name !== "ChecksumException" &&
            error.name !== "FormatException"
          ) {
            console.debug("ZXing tarama bilgisi:", error);
          }
        }
      );
    } catch (error) {
      scanState.textContent = "Tarama başlatılamadı";
      log("ZXing barkod taraması başlatılamadı.", error);
    }
  }

  function stopBarcodeScanning() {
    if (scanControls) {
      try {
        scanControls.stop();
      } catch (_) {}
      scanControls = null;
    }

    scanState.textContent = "Bekliyor";
  }

  async function getCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameras = devices.filter(device => device.kind === "videoinput");
    switchBtn.disabled = cameras.length < 2;
  }

  function preferredIndex() {
    const index = cameras.findIndex(camera =>
      /back|rear|environment|arka/i.test(camera.label || "")
    );

    return index >= 0 ? index : Math.max(0, cameras.length - 1);
  }

  async function stopCamera() {
    stopBarcodeScanning();

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    if (video.srcObject) {
      video.srcObject = null;
    }

    video.pause();
    cover.classList.remove("hidden");
    cameraState.textContent = "Kapalı";
    deviceName.textContent = "-";
    startBtn.disabled = false;
    stopBtn.disabled = true;
    updateVideoStatus();
  }

  async function waitForFirstFrame() {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("İlk video karesi 10 saniye içinde gelmedi."));
      }, 10000);

      const finish = () => {
        window.clearTimeout(timeout);
        resolve();
      };

      if (video.readyState >= 2 && video.videoWidth > 0) {
        finish();
        return;
      }

      video.addEventListener("loadeddata", finish, { once: true });
    });
  }

  async function startCamera(deviceId) {
    await stopCamera();

    if (!window.isSecureContext || location.protocol !== "https:") {
      log("HTTPS olmadığı için kamera kullanılamaz.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      log("Tarayıcı getUserMedia desteği sunmuyor.");
      return;
    }

    startBtn.disabled = true;
    stopBtn.disabled = false;
    cameraState.textContent = "Bağlanıyor";
    log("Kamera izni ve görüntü bekleniyor...");

    try {
      const constraints = deviceId
        ? {
            video: {
              deviceId: { exact: deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          }
        : {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          };

      stream = await navigator.mediaDevices.getUserMedia(constraints);

      video.srcObject = stream;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;

      await video.play();
      await waitForFirstFrame();
      await getCameras();

      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() || {};

      deviceName.textContent = track?.label || "Kamera";
      cameraState.textContent = "Açık";
      cover.classList.add("hidden");

      updateVideoStatus();

      log(
        `Kamera görüntüsü başladı.\n` +
        `Çözünürlük: ${video.videoWidth || settings.width || 0} × ` +
        `${video.videoHeight || settings.height || 0}`
      );

      await startBarcodeScanning();
    } catch (error) {
      const messages = {
        NotAllowedError: "Kamera izni reddedildi.",
        NotFoundError: "Kamera bulunamadı.",
        NotReadableError: "Kamera başka bir uygulama tarafından kullanılıyor olabilir.",
        OverconstrainedError: "Seçilen kamera ayarı desteklenmiyor.",
        SecurityError: "Güvenlik ayarı kamerayı engelledi.",
        AbortError: "Kamera işlemi yarıda kesildi."
      };

      let message = messages[error?.name] || "Kamera görüntüsü başlatılamadı.";

      if (error?.name === "NotAllowedError") {
        message +=
          "\n\nBu hata koddan değil, tarayıcı/site izninden gelir." +
          "\nSite: " + window.location.origin +
          "\nChrome > Site ayarları > Kamera > İzin ver." +
          "\nAndroid 12+ kullanıyorsanız hızlı ayarlardaki Kamera erişimi de açık olmalıdır.";
      }

      await stopCamera();
      log(message, error);
    }
  }

  async function switchCamera() {
    await getCameras();

    if (cameras.length < 2) return;

    cameraIndex = (cameraIndex + 1) % cameras.length;
    await startCamera(cameras[cameraIndex].deviceId);
  }

  startBtn.addEventListener("click", async () => {
    try {
      await getCameras();
      cameraIndex = preferredIndex();
      const selected = cameras[cameraIndex];
      await startCamera(selected?.deviceId);
    } catch (_) {
      await startCamera();
    }
  });

  switchBtn.addEventListener("click", switchCamera);
  stopBtn.addEventListener("click", stopCamera);

  manualBtn.addEventListener("click", () => {
    acceptBarcode(manualBarcode.value);
    manualBarcode.value = "";
    manualBarcode.focus();
  });

  manualBarcode.addEventListener("keydown", event => {
    if (event.key === "Enter") manualBtn.click();
  });

  video.addEventListener("loadedmetadata", updateVideoStatus);
  video.addEventListener("loadeddata", updateVideoStatus);
  video.addEventListener("canplay", updateVideoStatus);

  video.addEventListener("playing", () => {
    cameraState.textContent = "Açık";
    cover.classList.add("hidden");
    updateVideoStatus();
  });

  video.addEventListener("error", () => {
    log("Video öğesinde hata oluştu.", video.error);
  });

  window.addEventListener("message", event => {
    if (!isAllowedAppOrigin(event.origin)) return;

    const data = event.data || {};
    if (data.source !== "HOCA_MOBILYA_APP") return;

    if (data.type === "APP_READY") {
      appReady = true;
      appConnection.textContent = "Stok programına bağlı";
      return;
    }

    if (data.type === "SCAN_ACCEPTED") {
      scanState.textContent = "Barkod alındı";
      return;
    }

    if (data.type === "STOCK_RESULT") {
      applyStockResult(data, false);
      return;
    }

    if (data.type === "PRODUCT_REQUIRED") {
      waitingForStockResult = false;
      activeScanId = "";
      scanState.textContent = "Ürün bulunamadı";
      appConnection.textContent = data.message || "Ürün stok programında kayıtlı değil";
      window.setTimeout(() => {
        if (stream) scanState.textContent = "Taranıyor";
      }, 900);
      return;
    }

    if (data.type === "SCAN_RESUME") {
      waitingForStockResult = false;
      activeScanId = "";
      scanState.textContent = stream ? "Taranıyor" : "Bekliyor";
      appConnection.textContent = "Stok programına bağlı";
      return;
    }

    if (data.type === "CLOSE_CAMERA" || data.type === "SESSION_CLOSED") {
      stopCamera();
      window.close();
    }
  });

  returnBtn.addEventListener("click", () => {
    if (window.opener && !window.opener.closed) {
      try { window.opener.focus(); } catch (_) {}
    } else {
      returnToStockApp("", true);
    }
  });

  window.addEventListener("pagehide", stopCamera);

  httpsState.textContent =
    window.isSecureContext && location.protocol === "https:"
      ? "Uygun"
      : "Uygun değil";

  updateVideoStatus();
  prepareZxing();
  notifyReady();
  window.setInterval(() => {
    if (!appReady) notifyReady();
  }, 1200);
})();
