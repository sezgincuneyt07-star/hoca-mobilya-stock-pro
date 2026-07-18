(() => {
  "use strict";

  const elements = {
    video: document.getElementById("cameraVideo"),
    placeholder: document.getElementById("cameraPlaceholder"),
    startButton: document.getElementById("startButton"),
    stopButton: document.getElementById("stopButton"),
    switchButton: document.getElementById("switchButton"),
    barcodeResult: document.getElementById("barcodeResult"),
    scanCount: document.getElementById("scanCount"),
    secureBadge: document.getElementById("secureBadge"),
    httpsStatus: document.getElementById("httpsStatus"),
    mediaStatus: document.getElementById("mediaStatus"),
    zxingStatus: document.getElementById("zxingStatus"),
    deviceStatus: document.getElementById("deviceStatus"),
    videoStatus: document.getElementById("videoStatus"),
    videoSizeStatus: document.getElementById("videoSizeStatus"),
    errorBox: document.getElementById("errorBox"),
    manualBarcode: document.getElementById("manualBarcode"),
    manualButton: document.getElementById("manualButton")
  };

  let barcodeReader = null;
  let scanControls = null;
  let mediaStream = null;
  let videoDevices = [];
  let selectedDeviceIndex = 0;
  let totalScanCount = 0;
  let lastBarcode = "";
  let lastBarcodeTime = 0;

  function showError(message, error = null) {
    const details = [
      message,
      error?.name ? `Hata adı: ${error.name}` : "",
      error?.message ? `Açıklama: ${error.message}` : "",
      `Video readyState: ${elements.video.readyState}`,
      `Video paused: ${elements.video.paused}`,
      `Video size: ${elements.video.videoWidth}x${elements.video.videoHeight}`,
      `Tarayıcı: ${navigator.userAgent}`
    ].filter(Boolean);

    elements.errorBox.textContent = details.join("\n");
    console.error(message, error || "");
  }

  function clearError() {
    elements.errorBox.textContent = "Hata yok.";
  }

  function updateVideoInformation() {
    const readyStateNames = {
      0: "Veri yok",
      1: "Metadata var",
      2: "Mevcut kare var",
      3: "Gelecek kare var",
      4: "Oynatmaya hazır"
    };

    elements.videoStatus.textContent =
      readyStateNames[elements.video.readyState] || String(elements.video.readyState);

    elements.videoSizeStatus.textContent =
      `${elements.video.videoWidth || 0} × ${elements.video.videoHeight || 0}`;
  }

  function updateDiagnostics() {
    const secureConnection =
      window.isSecureContext && location.protocol === "https:";

    elements.httpsStatus.textContent =
      secureConnection ? "Uygun (HTTPS)" : "Uygun değil";

    elements.secureBadge.textContent =
      secureConnection ? "Güvenli bağlantı" : "HTTPS gerekli";

    elements.secureBadge.style.color =
      secureConnection ? "#86efac" : "#fecaca";

    elements.mediaStatus.textContent =
      navigator.mediaDevices?.getUserMedia
        ? "Destekleniyor"
        : "Desteklenmiyor";

    elements.zxingStatus.textContent =
      window.ZXingBrowser?.BrowserMultiFormatReader
        ? "Yüklendi"
        : "Yüklenemedi";

    updateVideoInformation();
  }

  function vibratePhone() {
    if ("vibrate" in navigator) {
      navigator.vibrate([100, 60, 100]);
    }
  }

  function playBeep() {
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      const audioContext = new AudioContextClass();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.frequency.value = 880;
      gain.gain.value = 0.07;

      oscillator.connect(gain);
      gain.connect(audioContext.destination);

      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.12);

      oscillator.onended = () => audioContext.close();
    } catch (error) {
      console.debug("Ses oluşturulamadı:", error);
    }
  }

  function acceptBarcode(value) {
    const barcode = String(value || "").trim();

    if (!barcode) {
      return;
    }

    const now = Date.now();

    if (barcode === lastBarcode && now - lastBarcodeTime < 1800) {
      return;
    }

    lastBarcode = barcode;
    lastBarcodeTime = now;
    totalScanCount += 1;

    elements.barcodeResult.textContent = barcode;
    elements.scanCount.textContent = `${totalScanCount} okuma`;

    playBeep();
    vibratePhone();
  }

  async function waitForVideoToPlay() {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Video görüntüsü 8 saniye içinde başlamadı."));
      }, 8000);

      const finish = async () => {
        try {
          await elements.video.play();
          window.clearTimeout(timeout);
          resolve();
        } catch (error) {
          window.clearTimeout(timeout);
          reject(error);
        }
      };

      if (
        elements.video.readyState >= 2 &&
        elements.video.videoWidth > 0
      ) {
        finish();
        return;
      }

      elements.video.addEventListener("loadedmetadata", finish, {
        once: true
      });
    });
  }

  async function listVideoDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();

    videoDevices = devices.filter(
      device => device.kind === "videoinput"
    );

    elements.switchButton.disabled = videoDevices.length < 2;

    return videoDevices;
  }

  function findPreferredCameraIndex(devices) {
    const rearCameraIndex = devices.findIndex(device =>
      /back|rear|environment|arka|camera 0/i.test(device.label || "")
    );

    if (rearCameraIndex >= 0) {
      return rearCameraIndex;
    }

    return Math.max(0, devices.length - 1);
  }

  async function stopCamera() {
    try {
      if (scanControls) {
        scanControls.stop();
        scanControls = null;
      }

      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
      }

      if (elements.video.srcObject) {
        elements.video.srcObject
          .getTracks()
          .forEach(track => track.stop());

        elements.video.srcObject = null;
      }

      elements.video.pause();
      elements.video.removeAttribute("src");
      elements.video.load();
    } catch (error) {
      showError("Kamera kapatılırken hata oluştu.", error);
    } finally {
      elements.placeholder.hidden = false;
      elements.startButton.disabled = false;
      elements.stopButton.disabled = true;
      elements.switchButton.disabled = videoDevices.length < 2;
      elements.deviceStatus.textContent = "-";
      updateVideoInformation();
    }
  }

  async function requestCameraPermission() {
    const permissionStream =
      await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });

    permissionStream.getTracks().forEach(track => track.stop());
  }

  async function startCamera(deviceId = null) {
    clearError();
    updateDiagnostics();

    if (!window.isSecureContext) {
      showError(
        "Bu sayfa güvenli bağlantıda değil. Kamera yalnızca HTTPS üzerinde çalışır."
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      showError("Bu tarayıcı kamera erişimini desteklemiyor.");
      return;
    }

    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
      showError(
        "ZXing barkod kütüphanesi yüklenemedi. İnternet bağlantısını kontrol et."
      );
      return;
    }

    await stopCamera();

    elements.startButton.disabled = true;
    elements.stopButton.disabled = false;
    elements.placeholder.hidden = true;
    elements.videoStatus.textContent = "Kamera hazırlanıyor";

    try {
      if (!videoDevices.length) {
        await requestCameraPermission();
        await listVideoDevices();
        selectedDeviceIndex = findPreferredCameraIndex(videoDevices);
      }

      const selectedDevice = deviceId
        ? videoDevices.find(device => device.deviceId === deviceId)
        : videoDevices[selectedDeviceIndex];

      const videoConstraints = selectedDevice?.deviceId
        ? {
            deviceId: { exact: selectedDevice.deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          }
        : {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          };

      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false
      });

      elements.video.srcObject = mediaStream;
      elements.video.muted = true;
      elements.video.autoplay = true;
      elements.video.playsInline = true;

      await waitForVideoToPlay();

      const activeTrack = mediaStream.getVideoTracks()[0];
      const activeSettings = activeTrack?.getSettings?.() || {};

      elements.deviceStatus.textContent =
        activeTrack?.label ||
        selectedDevice?.label ||
        "Kamera aktif";

      elements.videoStatus.textContent = "Görüntü oynuyor";
      elements.videoSizeStatus.textContent =
        `${elements.video.videoWidth || activeSettings.width || 0} × ` +
        `${elements.video.videoHeight || activeSettings.height || 0}`;

      barcodeReader =
        barcodeReader ||
        new window.ZXingBrowser.BrowserMultiFormatReader();

      scanControls = await barcodeReader.decodeFromStream(
        mediaStream,
        elements.video,
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
            console.debug("Barkod okuma bilgisi:", error);
          }
        }
      );

      elements.switchButton.disabled = videoDevices.length < 2;
      updateVideoInformation();
    } catch (error) {
      const errorMessages = {
        NotAllowedError:
          "Kamera izni reddedildi veya tarayıcı tarafından engellendi.",
        NotFoundError:
          "Cihazda kullanılabilir kamera bulunamadı.",
        NotReadableError:
          "Kamera başka bir uygulama tarafından kullanılıyor olabilir.",
        OverconstrainedError:
          "İstenen kamera ayarları cihaz tarafından desteklenmiyor.",
        SecurityError:
          "Tarayıcının güvenlik ayarı kamera erişimini engelledi.",
        AbortError:
          "Kamera başlatma işlemi yarıda kesildi."
      };

      const message =
        errorMessages[error?.name] ||
        "Kamera açıldı ancak görüntü başlatılamadı.";

      await stopCamera();
      showError(message, error);
    }
  }

  async function switchCamera() {
    if (videoDevices.length < 2) {
      return;
    }

    selectedDeviceIndex =
      (selectedDeviceIndex + 1) % videoDevices.length;

    await startCamera(
      videoDevices[selectedDeviceIndex].deviceId
    );
  }

  elements.video.addEventListener("loadedmetadata", updateVideoInformation);
  elements.video.addEventListener("canplay", updateVideoInformation);
  elements.video.addEventListener("playing", () => {
    elements.videoStatus.textContent = "Görüntü oynuyor";
    elements.placeholder.hidden = true;
    updateVideoInformation();
  });

  elements.video.addEventListener("stalled", () => {
    elements.videoStatus.textContent = "Video bekliyor";
  });

  elements.video.addEventListener("error", event => {
    showError(
      "Video öğesinde oynatma hatası oluştu.",
      event?.error || elements.video.error
    );
  });

  elements.startButton.addEventListener(
    "click",
    () => startCamera()
  );

  elements.stopButton.addEventListener(
    "click",
    stopCamera
  );

  elements.switchButton.addEventListener(
    "click",
    switchCamera
  );

  elements.manualButton.addEventListener("click", () => {
    acceptBarcode(elements.manualBarcode.value);
    elements.manualBarcode.value = "";
    elements.manualBarcode.focus();
  });

  elements.manualBarcode.addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        elements.manualButton.click();
      }
    }
  );

  window.addEventListener("pagehide", stopCamera);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mediaStream) {
      stopCamera();
    }
  });

  updateDiagnostics();
})();
