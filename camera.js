(() => {
  "use strict";

  const els = {
    video: document.getElementById("cameraVideo"),
    placeholder: document.getElementById("cameraPlaceholder"),
    start: document.getElementById("startButton"),
    stop: document.getElementById("stopButton"),
    switch: document.getElementById("switchButton"),
    result: document.getElementById("barcodeResult"),
    count: document.getElementById("scanCount"),
    secureBadge: document.getElementById("secureBadge"),
    https: document.getElementById("httpsStatus"),
    media: document.getElementById("mediaStatus"),
    zxing: document.getElementById("zxingStatus"),
    device: document.getElementById("deviceStatus"),
    error: document.getElementById("errorBox"),
    manual: document.getElementById("manualBarcode"),
    manualButton: document.getElementById("manualButton")
  };

  let reader = null;
  let controls = null;
  let videoDevices = [];
  let selectedDeviceIndex = 0;
  let scanCount = 0;
  let lastCode = "";
  let lastCodeAt = 0;

  function setError(message, error) {
    const details = [
      message,
      error?.name ? `Hata adı: ${error.name}` : "",
      error?.message ? `Açıklama: ${error.message}` : "",
      `Tarayıcı: ${navigator.userAgent}`
    ].filter(Boolean).join("\n");

    els.error.textContent = details;
    console.error(message, error || "");
  }

  function clearError() {
    els.error.textContent = "Hata yok.";
  }

  function vibrate() {
    if ("vibrate" in navigator) navigator.vibrate([100, 60, 100]);
  }

  function beep() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.07;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
      osc.onended = () => ctx.close();
    } catch (_) {}
  }

  function acceptBarcode(value) {
    const code = String(value || "").trim();
    if (!code) return;

    const now = Date.now();
    if (code === lastCode && now - lastCodeAt < 1800) return;

    lastCode = code;
    lastCodeAt = now;
    scanCount += 1;

    els.result.textContent = code;
    els.count.textContent = `${scanCount} okuma`;
    beep();
    vibrate();
  }

  function updateDiagnostics() {
    const secure = window.isSecureContext && location.protocol === "https:";
    els.https.textContent = secure ? "Uygun (HTTPS)" : "Uygun değil";
    els.secureBadge.textContent = secure ? "Güvenli bağlantı" : "HTTPS gerekli";
    els.secureBadge.style.color = secure ? "#86efac" : "#fecaca";

    const mediaSupported = Boolean(navigator.mediaDevices?.getUserMedia);
    els.media.textContent = mediaSupported ? "Destekleniyor" : "Desteklenmiyor";

    const zxingSupported = Boolean(window.ZXingBrowser?.BrowserMultiFormatReader);
    els.zxing.textContent = zxingSupported ? "Yüklendi" : "Yüklenemedi";
  }

  async function stopCamera() {
    try {
      if (controls) {
        controls.stop();
        controls = null;
      }

      const stream = els.video.srcObject;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        els.video.srcObject = null;
      }
    } catch (error) {
      setError("Kamera kapatılırken hata oluştu.", error);
    } finally {
      els.placeholder.hidden = false;
      els.start.disabled = false;
      els.stop.disabled = true;
      els.switch.disabled = videoDevices.length < 2;
      els.device.textContent = "-";
    }
  }

  async function loadDevices() {
    videoDevices = await window.ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
    els.switch.disabled = videoDevices.length < 2;
    return videoDevices;
  }

  function preferredDeviceIndex(devices) {
    const rearIndex = devices.findIndex(device =>
      /back|rear|environment|arka/i.test(device.label || "")
    );
    return rearIndex >= 0 ? rearIndex : Math.max(0, devices.length - 1);
  }

  async function startCamera(deviceId = null) {
    clearError();
    updateDiagnostics();

    if (!window.isSecureContext) {
      setError("Bu sayfa güvenli bağlantıda değil. Kamera yalnızca HTTPS üzerinde çalışır.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Bu tarayıcı kamera erişimini desteklemiyor.");
      return;
    }

    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
      setError("ZXing barkod kütüphanesi yüklenemedi. İnternet bağlantısını kontrol et.");
      return;
    }

    els.start.disabled = true;
    els.stop.disabled = false;
    els.placeholder.hidden = true;

    try {
      await stopCamera();
      els.start.disabled = true;
      els.stop.disabled = false;
      els.placeholder.hidden = true;

      if (!reader) {
        reader = new window.ZXingBrowser.BrowserMultiFormatReader();
      }

      if (!videoDevices.length) {
        try {
          await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false
          }).then(stream => stream.getTracks().forEach(track => track.stop()));
        } catch (_) {}

        await loadDevices();
        selectedDeviceIndex = preferredDeviceIndex(videoDevices);
      }

      const selected = deviceId
        ? videoDevices.find(device => device.deviceId === deviceId)
        : videoDevices[selectedDeviceIndex];

      const constraints = selected?.deviceId
        ? {
            video: {
              deviceId: { exact: selected.deviceId },
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

      els.device.textContent = selected?.label || "Arka kamera tercihi";

      controls = await reader.decodeFromConstraints(
        constraints,
        els.video,
        (result, error) => {
          if (result) acceptBarcode(result.getText());
          if (error && error.name !== "NotFoundException") {
            console.debug("Okuma bilgisi:", error);
          }
        }
      );

      els.switch.disabled = videoDevices.length < 2;
    } catch (error) {
      await stopCamera();

      const messages = {
        NotAllowedError: "Kamera izni reddedildi veya tarayıcı tarafından engellendi.",
        NotFoundError: "Cihazda kullanılabilir kamera bulunamadı.",
        NotReadableError: "Kamera başka bir uygulama tarafından kullanılıyor olabilir.",
        OverconstrainedError: "İstenen kamera ayarları cihaz tarafından desteklenmiyor.",
        SecurityError: "Tarayıcının güvenlik ayarı kamera erişimini engelledi.",
        AbortError: "Kamera başlatma işlemi yarıda kesildi."
      };

      setError(messages[error?.name] || "Kamera başlatılamadı.", error);
    }
  }

  async function switchCamera() {
    if (videoDevices.length < 2) return;
    selectedDeviceIndex = (selectedDeviceIndex + 1) % videoDevices.length;
    await startCamera(videoDevices[selectedDeviceIndex].deviceId);
  }

  els.start.addEventListener("click", () => startCamera());
  els.stop.addEventListener("click", stopCamera);
  els.switch.addEventListener("click", switchCamera);

  els.manualButton.addEventListener("click", () => {
    acceptBarcode(els.manual.value);
    els.manual.value = "";
    els.manual.focus();
  });

  els.manual.addEventListener("keydown", event => {
    if (event.key === "Enter") els.manualButton.click();
  });

  window.addEventListener("pagehide", stopCamera);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && controls) stopCamera();
  });

  updateDiagnostics();
})();
