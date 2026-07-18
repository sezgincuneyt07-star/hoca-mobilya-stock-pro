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

  let stream = null;
  let cameras = [];
  let cameraIndex = 0;
  let codeReader = null;
  let scanControls = null;
  let totalScans = 0;
  let lastBarcode = "";
  let lastBarcodeTime = 0;

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

    if (barcode === lastBarcode && now - lastBarcodeTime < 2000) {
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

    window.setTimeout(() => {
      if (stream) scanState.textContent = "Taranıyor";
    }, 1200);
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

      const message = messages[error?.name] || "Kamera görüntüsü başlatılamadı.";

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

  window.addEventListener("pagehide", stopCamera);

  httpsState.textContent =
    window.isSecureContext && location.protocol === "https:"
      ? "Uygun"
      : "Uygun değil";

  updateVideoStatus();
  prepareZxing();
})();
