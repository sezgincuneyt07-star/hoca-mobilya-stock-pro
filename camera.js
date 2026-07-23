(() => {
  "use strict";

  const APP_URL = "https://script.google.com/macros/s/AKfycbzKW87lp7ZpwzvrJr0W36rj_VCScP2MCZJBOdUnU4NX_i2K0fJeUUsjzZapnsT1kjrc/exec";
  const APP_ORIGIN_PATTERN = /^https:\/\/(script\.google\.com|(?:[a-z0-9-]+-)?script\.googleusercontent\.com)$/i;
  const CAMERA_DEVICE_KEY = "hoca_mobilya_v13_camera_device";

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
  const unknownProductActions = document.getElementById("unknownProductActions");
  const unknownProductBarcode = document.getElementById("unknownProductBarcode");
  const retryUnknownBarcodeButton = document.getElementById("retryUnknownBarcodeButton");
  const addUnknownProductFromCameraButton = document.getElementById("addUnknownProductFromCameraButton");
  const batchPanel = document.getElementById("cameraBatchPanel");
  const batchList = document.getElementById("cameraBatchList");
  const batchEmpty = document.getElementById("cameraBatchEmpty");
  const batchProductCount = document.getElementById("batchProductCount");
  const batchQuantityCount = document.getElementById("batchQuantityCount");
  const clearBatchButton = document.getElementById("clearBatchButton");
  const submitBatchButton = document.getElementById("submitBatchButton");
  const confirmModal = document.getElementById("batchConfirmModal");
  const confirmProductCount = document.getElementById("confirmProductCount");
  const confirmQuantityCount = document.getElementById("confirmQuantityCount");
  const confirmPersonnel = document.getElementById("confirmPersonnel");
  const confirmMessage = document.getElementById("confirmMessage");
  const cancelBatchConfirmButton = document.getElementById("cancelBatchConfirmButton");
  const approveBatchButton = document.getElementById("approveBatchButton");

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
  let torchEnabled = false;
  let appFrameReady = false;
  let appMessageTarget = null;
  let currentPersonnel = "-";
  let pendingUnknownBarcode = "";
  let pendingUnknownScanId = "";
  let batchSubmitting = false;
  let confirmOpen = false;
  let suppressNextResume = false;

  const batchItems = new Map();

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

  function productLabel(product) {
    return [product.model, product.size, product.color]
      .filter(Boolean)
      .join(" • ") || product.barcode || "Ürün";
  }

  function totalBatchQuantity() {
    let total = 0;
    batchItems.forEach(item => {
      total += Number(item.quantity) || 0;
    });
    return total;
  }

  function renderBatch() {
    const entries = Array.from(batchItems.values());
    const totalQuantity = totalBatchQuantity();

    batchProductCount.textContent = String(entries.length);
    batchQuantityCount.textContent = String(totalQuantity);
    scanCounter.textContent = String(totalQuantity);
    submitBatchButton.disabled = !entries.length || batchSubmitting;
    clearBatchButton.disabled = !entries.length || batchSubmitting;

    if (!entries.length) {
      batchList.innerHTML = "";
      batchList.classList.add("hidden");
      batchEmpty.classList.remove("hidden");
      return;
    }

    batchEmpty.classList.add("hidden");
    batchList.classList.remove("hidden");
    batchList.innerHTML = "";

    entries.forEach(item => {
      const row = document.createElement("article");
      row.className = "camera-batch-row";
      row.dataset.barcode = item.product.barcode;

      const info = document.createElement("div");
      info.className = "camera-batch-info";
      info.innerHTML = `
        <strong>${escapeHtml(productLabel(item.product))}</strong>
        <span>${escapeHtml(item.product.type || "-")} • Barkod: ${escapeHtml(item.product.barcode)}</span>
        <small>Mevcut stok: ${Number(item.product.stock) || 0} → Onay sonrası: ${(Number(item.product.stock) || 0) + item.quantity}</small>
      `;

      const controlsBox = document.createElement("div");
      controlsBox.className = "camera-batch-quantity";
      controlsBox.innerHTML = `
        <button type="button" data-action="decrease" aria-label="Adedi azalt">−</button>
        <strong>${item.quantity}</strong>
        <button type="button" data-action="increase" aria-label="Adedi artır">+</button>
        <button type="button" class="remove-button" data-action="remove">Sil</button>
      `;

      row.appendChild(info);
      row.appendChild(controlsBox);
      batchList.appendChild(row);
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function addProductToBatch(product, quantity = 1) {
    if (!product || !product.barcode) return;
    const barcode = String(product.barcode).trim();
    const existing = batchItems.get(barcode);

    if (existing) {
      existing.quantity += Math.max(1, Number(quantity) || 1);
      existing.product = { ...existing.product, ...product };
    } else {
      batchItems.set(barcode, {
        product: { ...product },
        quantity: Math.max(1, Number(quantity) || 1)
      });
    }

    renderBatch();
  }

  function changeBatchQuantity(barcode, action) {
    const item = batchItems.get(barcode);
    if (!item || batchSubmitting) return;

    if (action === "increase") {
      item.quantity += 1;
    } else if (action === "decrease") {
      item.quantity -= 1;
      if (item.quantity <= 0) batchItems.delete(barcode);
    } else if (action === "remove") {
      batchItems.delete(barcode);
    }

    renderBatch();
  }

  function clearBatch() {
    if (!batchItems.size || batchSubmitting) return;
    const accepted = window.confirm("Okutulan ürün listesinin tamamı temizlensin mi?");
    if (!accepted) return;
    batchItems.clear();
    renderBatch();
    lastBarcode.textContent = "Henüz okutulmadı";
    stockResult.textContent = "Barkod bekleniyor";
    setMessage("Liste temizlendi. Yeni barkodları okutabilirsiniz.", "success");
  }

  function openBatchConfirm() {
    if (!batchItems.size || batchSubmitting) return;
    confirmOpen = true;
    confirmProductCount.textContent = String(batchItems.size);
    confirmQuantityCount.textContent = String(totalBatchQuantity());
    confirmPersonnel.textContent = currentPersonnel || "-";
    confirmMessage.textContent = "";
    confirmMessage.className = "batch-confirm-message";
    approveBatchButton.disabled = false;
    approveBatchButton.textContent = "Onayla ve Stoğa Ekle";
    confirmModal.classList.remove("hidden");
    confirmModal.setAttribute("aria-hidden", "false");
  }

  function closeBatchConfirm() {
    if (batchSubmitting) return;
    confirmOpen = false;
    confirmModal.classList.add("hidden");
    confirmModal.setAttribute("aria-hidden", "true");
    confirmMessage.textContent = "";
    confirmMessage.className = "batch-confirm-message";
  }

  function approveBatch() {
    if (!batchItems.size || batchSubmitting) return;

    batchSubmitting = true;
    waitingForResult = true;
    approveBatchButton.disabled = true;
    cancelBatchConfirmButton.disabled = true;
    approveBatchButton.textContent = "Stoğa Ekleniyor...";
    confirmMessage.textContent = "Liste doğrulanıyor ve toplu stok girişi yapılıyor...";
    confirmMessage.className = "batch-confirm-message";
    submitBatchButton.disabled = true;
    clearBatchButton.disabled = true;

    const requestId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const items = Array.from(batchItems.values()).map(item => ({
      barcode: item.product.barcode,
      quantity: item.quantity
    }));

    postToApp({
      source: "HOCA_MOBILYA_CAMERA",
      type: "CONFIRM_CAMERA_BATCH",
      requestId,
      items
    });
  }

  function showUnknownProductActions(barcode, scanId) {
    pendingUnknownBarcode = String(barcode || "").trim();
    pendingUnknownScanId = String(scanId || "").trim();
    unknownProductBarcode.textContent = pendingUnknownBarcode || "-";
    unknownProductActions.classList.remove("hidden");
  }

  function hideUnknownProductActions() {
    unknownProductActions.classList.add("hidden");
  }

  async function resumeScannerAfterUnknownProduct() {
    hideUnknownProductActions();
    pendingUnknownBarcode = "";
    pendingUnknownScanId = "";
    waitingForResult = false;
    lastAcceptedBarcode = "";
    lastAcceptedAt = 0;
    stockResult.textContent = "Yeni barkod bekleniyor";
    setMessage("Kamera tekrar hazır. Yeni barkodu okutabilirsiniz.", "success");

    if (stream && !controls) {
      try {
        await startScanner();
      } catch (error) {
        setMessage(error?.message || "Barkod okuyucu yeniden başlatılamadı.", "error");
      }
    }
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

    if (stream) stream.getTracks().forEach(item => item.stop());
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
          ? "Hazır. Barkodlar listeye eklenir; stok yalnızca son onaydan sonra değişir."
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
    cameraTitle.textContent = mode === "quick" ? "Hızlı Kamera — Liste ve Son Onay" : "Stok İşlemi Kamerası";
    waitingForResult = false;
    lastAcceptedBarcode = "";
    lastAcceptedAt = 0;
    lastBarcode.textContent = "Henüz okutulmadı";
    stockResult.textContent = mode === "quick" ? "Barkod bekleniyor" : "Ürün barkodu bekleniyor";
    batchPanel.classList.toggle("hidden", mode !== "quick");
    setMessage("Kamera hazırlanıyor...");
    renderBatch();

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

  async function closeCamera(notifyApp = true, resolvePendingUnknown = true) {
    if (resolvePendingUnknown && pendingUnknownBarcode) {
      suppressNextResume = Boolean(notifyApp);
      postToApp({
        source: "HOCA_MOBILYA_CAMERA",
        type: "SKIP_UNKNOWN_PRODUCT",
        scanId: pendingUnknownScanId,
        barcode: pendingUnknownBarcode
      });
    }

    hideUnknownProductActions();
    pendingUnknownBarcode = "";
    pendingUnknownScanId = "";
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
    if (!barcode || waitingForResult || batchSubmitting || confirmOpen) return;

    const now = Date.now();
    if (barcode === lastAcceptedBarcode && now - lastAcceptedAt < 1800) return;

    lastAcceptedBarcode = barcode;
    lastAcceptedAt = now;
    waitingForResult = true;
    lastBarcode.textContent = barcode;
    stockResult.textContent = mode === "quick" ? "Ürün kontrol ediliyor..." : "Barkod aktarılıyor...";
    setMessage(barcode + " işleniyor...");

    postToApp({
      source: "HOCA_MOBILYA_CAMERA",
      type: "BARCODE_SCANNED",
      mode,
      scanId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      barcode
    });
  }

  function handleItemResult(data) {
    waitingForResult = false;

    if (!data.success || !data.product) {
      stockResult.textContent = "Hata: " + (data.message || "Ürün kontrol edilemedi");
      setMessage(data.message || "Ürün kontrol edilemedi.", "error");
      beep(false);
      vibrate(false);
      return;
    }

    addProductToBatch(data.product, 1);
    const item = batchItems.get(data.product.barcode);
    stockResult.textContent = "Listeye eklendi • Adet: " + item.quantity;
    setMessage(`${productLabel(data.product)} listeye eklendi.`, "success");
    beep(true);
    vibrate(true);
  }

  function handleBatchResult(data) {
    waitingForResult = false;
    batchSubmitting = false;
    cancelBatchConfirmButton.disabled = false;
    approveBatchButton.disabled = false;
    approveBatchButton.textContent = "Onayla ve Stoğa Ekle";

    if (!data.success) {
      confirmMessage.textContent = data.message || "Toplu stok girişi tamamlanamadı.";
      confirmMessage.className = "batch-confirm-message error";
      setMessage(data.message || "Toplu stok girişi tamamlanamadı.", "error");
      renderBatch();
      beep(false);
      vibrate(false);
      return;
    }

    const total = Number(data.totalQuantity) || totalBatchQuantity();
    const productCount = Number(data.productCount) || batchItems.size;
    batchItems.clear();
    renderBatch();
    confirmOpen = false;
    confirmModal.classList.add("hidden");
    confirmModal.setAttribute("aria-hidden", "true");
    stockResult.textContent = `${productCount} ürün • ${total} adet stoğa eklendi`;
    setMessage(data.message || "Toplu stok girişi başarıyla tamamlandı.", "success");
    lastAcceptedBarcode = "";
    lastAcceptedAt = 0;
    beep(true);
    vibrate(true);
  }

  window.addEventListener("message", event => {
    if (!APP_ORIGIN_PATTERN.test(event.origin)) return;

    const data = event.data || {};
    if (data.source !== "HOCA_MOBILYA_APP") return;
    appMessageTarget = event.source;

    if (data.type === "OPEN_CAMERA") {
      currentPersonnel = data.personnel || currentPersonnel;
      openCamera(data.mode);
      return;
    }

    if (data.type === "APP_READY") {
      appFrameReady = true;
      currentPersonnel = data.personnel || currentPersonnel;
      return;
    }

    if (data.type === "SCAN_ACCEPTED") {
      waitingForResult = false;
      stockResult.textContent = "Barkod aktarıldı";
      setMessage("Barkod stok işlem ekranına aktarıldı.", "success");
      return;
    }

    if (data.type === "CAMERA_ITEM_RESULT") {
      handleItemResult(data);
      return;
    }

    if (data.type === "BATCH_STOCK_RESULT") {
      handleBatchResult(data);
      return;
    }

    if (data.type === "PRODUCT_REQUIRED") {
      waitingForResult = true;
      stopScanner();
      stockResult.textContent = "Ürün kayıtlı değil";
      setMessage(data.message || "Ürün kayıtlı değil. Bir işlem seçin.", "error");
      showUnknownProductActions(data.barcode, data.scanId);
      beep(false);
      vibrate(false);
      return;
    }

    if (data.type === "PRODUCT_ADDED_TO_BATCH") {
      if (data.product) addProductToBatch(data.product, 1);
      pendingUnknownBarcode = "";
      pendingUnknownScanId = "";
      hideUnknownProductActions();
      waitingForResult = false;
      stockResult.textContent = "Yeni ürün listeye eklendi";
      setMessage(data.message || "Yeni ürün listeye eklendi.", "success");
      beep(true);
      vibrate(true);
      window.setTimeout(() => openCamera("quick"), 350);
      return;
    }

    if (data.type === "SCAN_RESUME") {
      if (suppressNextResume) {
        suppressNextResume = false;
        return;
      }
      if (overlay.classList.contains("hidden")) {
        openCamera("quick");
      } else {
        resumeScannerAfterUnknownProduct();
      }
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

  retryUnknownBarcodeButton.addEventListener("click", () => {
    if (!pendingUnknownBarcode) return;
    postToApp({
      source: "HOCA_MOBILYA_CAMERA",
      type: "SKIP_UNKNOWN_PRODUCT",
      scanId: pendingUnknownScanId,
      barcode: pendingUnknownBarcode
    });
    stockResult.textContent = "Yeni barkod bekleniyor";
    setMessage("Barkod geçildi. Kamera hazırlanıyor...");
  });

  addUnknownProductFromCameraButton.addEventListener("click", () => {
    if (!pendingUnknownBarcode) return;
    postToApp({
      source: "HOCA_MOBILYA_CAMERA",
      type: "ADD_UNKNOWN_PRODUCT",
      scanId: pendingUnknownScanId,
      barcode: pendingUnknownBarcode
    });
    closeCamera(false, false);
  });

  batchList.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const row = button.closest(".camera-batch-row");
    if (!row) return;
    changeBatchQuantity(row.dataset.barcode, button.dataset.action);
  });

  clearBatchButton.addEventListener("click", clearBatch);
  submitBatchButton.addEventListener("click", openBatchConfirm);
  cancelBatchConfirmButton.addEventListener("click", closeBatchConfirm);
  approveBatchButton.addEventListener("click", approveBatch);
  confirmModal.addEventListener("click", event => {
    if (event.target === confirmModal) closeBatchConfirm();
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

  renderBatch();

  window.setTimeout(() => {
    if (!appFrameReady) {
      loader.querySelector("span").textContent = "Uygulama beklenenden uzun sürede açılıyor...";
    }
  }, 12000);
})();
