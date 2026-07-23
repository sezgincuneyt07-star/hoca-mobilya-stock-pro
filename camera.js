(() => {
  "use strict";

  const VERSION = "16.0.0";
  const APP_URL = "https://script.google.com/macros/s/AKfycbzKW87lp7ZpwzvrJr0W36rj_VCScP2MCZJBOdUnU4NX_i2K0fJeUUsjzZapnsT1kjrc/exec";
  const APP_ORIGIN_PATTERN = /^https:\/\/(script\.google\.com|(?:[a-z0-9-]+-)?script\.googleusercontent\.com)$/i;
  const CAMERA_DEVICE_KEY = "hoca_mobilya_camera_device";
  const BATCH_DRAFT_KEY = "hoca_mobilya_v16_batch_draft";
  const LEGACY_BATCH_DRAFT_KEYS = ["hoca_mobilya_v15_batch_draft"];
  const REARM_DELAY_MS = 1600;
  const REARM_CHECK_INTERVAL_MS = 120;

  const $ = id => document.getElementById(id);
  const frame = $("stockAppFrame");
  const loader = $("appLoader");
  const overlay = $("cameraOverlay");
  const video = $("cameraVideo");
  const cover = $("cameraCover");
  const coverText = $("cameraCoverText");
  const cameraTitle = $("cameraTitle");
  const cameraEngine = $("cameraEngine");
  const closeButton = $("closeCameraButton");
  const startButton = $("startCameraButton");
  const switchButton = $("switchCameraButton");
  const torchButton = $("torchButton");
  const lastBarcode = $("lastBarcode");
  const stockResult = $("stockResult");
  const scanCounter = $("scanCounter");
  const cameraMessage = $("cameraMessage");
  const connectionBadge = $("connectionBadge");
  const manualBarcode = $("manualBarcode");
  const manualButton = $("manualBarcodeButton");
  const unknownProductActions = $("unknownProductActions");
  const unknownProductBarcode = $("unknownProductBarcode");
  const retryUnknownBarcodeButton = $("retryUnknownBarcodeButton");
  const addUnknownProductFromCameraButton = $("addUnknownProductFromCameraButton");
  const batchPanel = $("cameraBatchPanel");
  const batchList = $("cameraBatchList");
  const batchEmpty = $("cameraBatchEmpty");
  const batchProductCount = $("batchProductCount");
  const batchQuantityCount = $("batchQuantityCount");
  const clearBatchButton = $("clearBatchButton");
  const submitBatchButton = $("submitBatchButton");
  const confirmModal = $("batchConfirmModal");
  const confirmProductCount = $("confirmProductCount");
  const confirmQuantityCount = $("confirmQuantityCount");
  const confirmPersonnel = $("confirmPersonnel");
  const confirmRequestId = $("confirmRequestId");
  const confirmProductList = $("confirmProductList");
  const confirmMessage = $("confirmMessage");
  const cancelBatchConfirmButton = $("cancelBatchConfirmButton");
  const approveBatchButton = $("approveBatchButton");
  const draftRestoreModal = $("draftRestoreModal");
  const draftRestoreText = $("draftRestoreText");
  const draftProductCount = $("draftProductCount");
  const draftQuantityCount = $("draftQuantityCount");
  const draftPersonnel = $("draftPersonnel");
  const draftSavedAt = $("draftSavedAt");
  const deleteDraftButton = $("deleteDraftButton");
  const restoreDraftButton = $("restoreDraftButton");

  let mode = "quick";
  let stream = null;
  let track = null;
  let cameras = [];
  let cameraIndex = 0;
  let reader = null;
  let controls = null;
  let waitingForResult = false;
  let torchEnabled = false;
  let appFrameReady = false;
  let appMessageTarget = null;
  let currentPersonnel = "-";
  let pendingUnknownBarcode = "";
  let pendingUnknownScanId = "";
  let batchSubmitting = false;
  let confirmOpen = false;
  let suppressNextResume = false;
  let batchRequestId = "";
  let savedDraftCandidate = null;
  let recoveryRequired = false;
  let scanLockedBarcode = "";
  let scanArmed = true;
  let lastDetectionAt = 0;
  let rearmMonitor = null;

  const batchItems = new Map();

  frame.src = APP_URL;
  frame.addEventListener("load", () => {
    appFrameReady = true;
    loader.classList.add("hidden");
  });

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setMessage(text, type = "") {
    cameraMessage.textContent = text || "";
    cameraMessage.className = "camera-message " + type;
  }

  function setConnectionState() {
    const online = navigator.onLine && appFrameReady;
    connectionBadge.textContent = online ? "Sistem bağlı" : "Bağlantı bekleniyor";
    connectionBadge.className = "connection-badge " + (online ? "online" : "offline");
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

  function totalBatchQuantity(map = batchItems) {
    let total = 0;
    map.forEach(item => { total += Number(item.quantity) || 0; });
    return total;
  }

  function createOperationId() {
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("");
    const time = [String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0"), String(now.getSeconds()).padStart(2, "0")].join("");
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `HK-${date}-${time}-${random}`;
  }

  function invalidateRequestId() {
    batchRequestId = "";
  }

  function serializeBatch() {
    return Array.from(batchItems.values()).map(item => ({
      product: { ...item.product },
      quantity: Number(item.quantity) || 1
    }));
  }

  function persistDraft() {
    try {
      if (!batchItems.size) {
        localStorage.removeItem(BATCH_DRAFT_KEY);
        return;
      }
      localStorage.setItem(BATCH_DRAFT_KEY, JSON.stringify({
        version: VERSION,
        savedAt: new Date().toISOString(),
        personnel: currentPersonnel || "-",
        requestId: batchRequestId || "",
        recoveryRequired: Boolean(recoveryRequired),
        items: serializeBatch()
      }));
    } catch (_) {}
  }

  function readDraft() {
    try {
      const keys = [BATCH_DRAFT_KEY, ...LEGACY_BATCH_DRAFT_KEYS];
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) continue;
        if (key !== BATCH_DRAFT_KEY) {
          localStorage.setItem(BATCH_DRAFT_KEY, raw);
          localStorage.removeItem(key);
        }
        return parsed;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function deleteSavedDraft() {
    localStorage.removeItem(BATCH_DRAFT_KEY);
    LEGACY_BATCH_DRAFT_KEYS.forEach(key => localStorage.removeItem(key));
    savedDraftCandidate = null;
    draftRestoreModal.classList.add("hidden");
    draftRestoreModal.setAttribute("aria-hidden", "true");
  }

  function showDraftRestoreIfNeeded() {
    if (!savedDraftCandidate || batchItems.size || currentPersonnel === "-") return;
    const map = new Map();
    savedDraftCandidate.items.forEach(item => {
      if (!item?.product?.barcode) return;
      map.set(String(item.product.barcode), item);
    });
    draftProductCount.textContent = String(map.size);
    draftQuantityCount.textContent = String(totalBatchQuantity(map));
    draftPersonnel.textContent = savedDraftCandidate.personnel || "-";
    draftSavedAt.textContent = savedDraftCandidate.savedAt
      ? new Date(savedDraftCandidate.savedAt).toLocaleString("tr-TR")
      : "-";
    draftRestoreText.textContent = savedDraftCandidate.personnel && savedDraftCandidate.personnel !== currentPersonnel
      ? `Taslak ${savedDraftCandidate.personnel} tarafından oluşturuldu. Geri yüklenirse son onayı ${currentPersonnel} verecek.`
      : "Daha önce okutulan ürün listesi bu cihazda güvenle saklandı.";
    draftRestoreModal.classList.remove("hidden");
    draftRestoreModal.setAttribute("aria-hidden", "false");
  }

  function restoreSavedDraft() {
    if (!savedDraftCandidate) return;
    batchItems.clear();
    savedDraftCandidate.items.forEach(item => {
      const barcode = String(item?.product?.barcode || "").trim();
      if (!barcode) return;
      batchItems.set(barcode, {
        product: { ...item.product },
        quantity: Math.max(1, Number(item.quantity) || 1)
      });
    });
    batchRequestId = String(savedDraftCandidate.requestId || "");
    recoveryRequired = Boolean(savedDraftCandidate.recoveryRequired && batchRequestId);
    draftRestoreModal.classList.add("hidden");
    draftRestoreModal.setAttribute("aria-hidden", "true");
    savedDraftCandidate = null;
    renderBatch(false);
    setMessage(
      recoveryRequired
        ? "Taslak geri yüklendi. Önce aynı işlem numarasıyla tekrar onay vererek önceki işlemin sonucunu doğrulayın."
        : "Kaydedilmiş stok taslağı geri yüklendi.",
      recoveryRequired ? "error" : "success"
    );
  }

  function renderBatch(shouldPersist = true) {
    const entries = Array.from(batchItems.values());
    const totalQuantity = totalBatchQuantity();

    batchProductCount.textContent = String(entries.length);
    batchQuantityCount.textContent = String(totalQuantity);
    scanCounter.textContent = String(totalQuantity);
    submitBatchButton.disabled = !entries.length || batchSubmitting || !navigator.onLine;
    clearBatchButton.disabled = !entries.length || batchSubmitting || recoveryRequired;

    if (!entries.length) {
      batchList.innerHTML = "";
      batchList.classList.add("hidden");
      batchEmpty.classList.remove("hidden");
    } else {
      batchEmpty.classList.add("hidden");
      batchList.classList.remove("hidden");
      batchList.innerHTML = "";

      entries.forEach(item => {
        const currentStock = Number(item.product.stock) || 0;
        const row = document.createElement("article");
        row.className = "camera-batch-row";
        row.dataset.barcode = item.product.barcode;
        row.innerHTML = `
          <div class="camera-batch-info">
            <strong>${escapeHtml(productLabel(item.product))}</strong>
            <span>${escapeHtml(item.product.type || "-")} • Barkod: ${escapeHtml(item.product.barcode)}</span>
            <small>Mevcut stok: ${currentStock} → Onay sonrası: ${currentStock + item.quantity}</small>
          </div>
          <div class="camera-batch-quantity">
            <button type="button" data-action="decrease" aria-label="Adedi azalt" ${recoveryRequired ? "disabled" : ""}>−</button>
            <strong>${item.quantity}</strong>
            <button type="button" data-action="increase" aria-label="Adedi artır" ${recoveryRequired ? "disabled" : ""}>+</button>
            <button type="button" class="remove-button" data-action="remove" ${recoveryRequired ? "disabled" : ""}>Sil</button>
          </div>`;
        batchList.appendChild(row);
      });
    }

    if (shouldPersist) persistDraft();
  }

  function addProductToBatch(product, quantity = 1) {
    if (!product?.barcode) return;
    if (recoveryRequired) {
      setMessage("Önce sonuç bekleyen işlemi aynı işlem numarasıyla tekrar onaylayın.", "error");
      return;
    }
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
    invalidateRequestId();
    renderBatch();
  }

  function changeBatchQuantity(barcode, action) {
    if (recoveryRequired) {
      setMessage("İşlem sonucu doğrulanmadan liste değiştirilemez. Önce tekrar onaylayın.", "error");
      return;
    }
    const item = batchItems.get(barcode);
    if (!item || batchSubmitting) return;
    if (action === "increase") item.quantity += 1;
    if (action === "decrease") {
      item.quantity -= 1;
      if (item.quantity <= 0) batchItems.delete(barcode);
    }
    if (action === "remove") batchItems.delete(barcode);
    invalidateRequestId();
    renderBatch();
  }

  function clearBatch() {
    if (!batchItems.size || batchSubmitting) return;
    if (recoveryRequired) {
      setMessage("İşlem sonucu doğrulanmadan liste silinemez. Önce aynı işlem numarasıyla tekrar onaylayın.", "error");
      return;
    }
    if (!window.confirm("Okutulan ürün listesinin tamamı temizlensin mi?")) return;
    batchItems.clear();
    batchRequestId = "";
    recoveryRequired = false;
    renderBatch();
    lastBarcode.textContent = "Henüz okutulmadı";
    stockResult.textContent = "Barkod bekleniyor";
    setMessage("Liste temizlendi. Yeni barkodları okutabilirsiniz.", "success");
  }

  function renderConfirmProducts() {
    confirmProductList.innerHTML = "";
    Array.from(batchItems.values()).forEach(item => {
      const currentStock = Number(item.product.stock) || 0;
      const row = document.createElement("article");
      row.className = "confirm-product-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(productLabel(item.product))}</strong>
          <span>${escapeHtml(item.product.type || "-")} • ${escapeHtml(item.product.barcode)}</span>
        </div>
        <div class="confirm-product-numbers">
          <b>${item.quantity} adet</b>
          <small>${currentStock} → ${currentStock + item.quantity}</small>
        </div>`;
      confirmProductList.appendChild(row);
    });
  }

  function openBatchConfirm() {
    if (!batchItems.size || batchSubmitting) return;
    if (!navigator.onLine) {
      setMessage("İnternet bağlantısı yok. Liste cihazda kayıtlıdır; bağlantı gelince onaylayabilirsiniz.", "error");
      return;
    }
    confirmOpen = true;
    confirmProductCount.textContent = String(batchItems.size);
    confirmQuantityCount.textContent = String(totalBatchQuantity());
    confirmPersonnel.textContent = currentPersonnel || "-";
    confirmRequestId.textContent = batchRequestId || "Onayda oluşturulacak";
    renderConfirmProducts();
    confirmMessage.textContent = "";
    confirmMessage.className = "batch-confirm-message";
    approveBatchButton.disabled = false;
    approveBatchButton.textContent = "Onayla ve Stoğa Ekle";
    confirmModal.classList.remove("hidden");
    confirmModal.setAttribute("aria-hidden", "false");
  }

  function closeBatchConfirm() {
    if (batchSubmitting) return;
    if (recoveryRequired) {
      confirmMessage.textContent = "Bu işlemin sonucu belirsiz. Çift stok riskini önlemek için aynı işlem numarasıyla tekrar onaylayın.";
      confirmMessage.className = "batch-confirm-message error";
      return;
    }
    confirmOpen = false;
    confirmModal.classList.add("hidden");
    confirmModal.setAttribute("aria-hidden", "true");
    confirmMessage.textContent = "";
    confirmMessage.className = "batch-confirm-message";
  }

  function approveBatch() {
    if (!batchItems.size || batchSubmitting) return;
    if (!navigator.onLine) {
      confirmMessage.textContent = "İnternet bağlantısı yok. Liste cihazda korunuyor.";
      confirmMessage.className = "batch-confirm-message error";
      return;
    }

    if (!batchRequestId) batchRequestId = createOperationId();
    persistDraft();
    confirmRequestId.textContent = batchRequestId;
    batchSubmitting = true;
    recoveryRequired = false;
    waitingForResult = true;
    approveBatchButton.disabled = true;
    cancelBatchConfirmButton.disabled = true;
    approveBatchButton.textContent = "Stoğa Ekleniyor...";
    confirmMessage.textContent = "Liste sunucuda yeniden doğrulanıyor ve tek işlem olarak kaydediliyor...";
    confirmMessage.className = "batch-confirm-message";
    submitBatchButton.disabled = true;
    clearBatchButton.disabled = true;

    const items = Array.from(batchItems.values()).map(item => ({
      barcode: item.product.barcode,
      quantity: item.quantity
    }));

    postToApp({
      source: "HOCA_MOBILYA_CAMERA",
      type: "CONFIRM_CAMERA_BATCH",
      requestId: batchRequestId,
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

  function resetScanGate() {
    scanLockedBarcode = "";
    scanArmed = true;
    lastDetectionAt = 0;
  }

  function checkScanRearm() {
    if (scanArmed || !scanLockedBarcode || !lastDetectionAt) return;
    if (Date.now() - lastDetectionAt < REARM_DELAY_MS) return;
    scanArmed = true;
    stockResult.textContent = "Aynı ürün yeniden okutulabilir";
    setMessage("Bekleme süresi tamamlandı. Aynı barkod yeniden okunabilir.", "success");
  }

  function startRearmMonitor() {
    if (rearmMonitor) window.clearInterval(rearmMonitor);
    rearmMonitor = window.setInterval(checkScanRearm, REARM_CHECK_INTERVAL_MS);
  }

  function stopRearmMonitor() {
    if (!rearmMonitor) return;
    window.clearInterval(rearmMonitor);
    rearmMonitor = null;
  }

  function canAcceptBarcode(barcode) {
    if (!scanLockedBarcode || barcode !== scanLockedBarcode) return true;
    return scanArmed;
  }

  function lockAcceptedBarcode(barcode) {
    scanLockedBarcode = barcode;
    scanArmed = false;
    lastDetectionAt = Date.now();
  }

  async function resumeScannerAfterUnknownProduct() {
    hideUnknownProductActions();
    pendingUnknownBarcode = "";
    pendingUnknownScanId = "";
    waitingForResult = false;
    resetScanGate();
    stockResult.textContent = "Yeni barkod bekleniyor";
    setMessage("Kamera tekrar hazır. Yeni barkodu okutabilirsiniz.", "success");
    if (stream && !controls) await startScanner();
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
    const rearIndex = cameras.findIndex(camera => /back|rear|environment|arka/i.test(camera.label || ""));
    return rearIndex >= 0 ? rearIndex : Math.max(0, cameras.length - 1);
  }

  function updateTorchButton() {
    let supported = false;
    try { supported = Boolean(track?.getCapabilities?.().torch); } catch (_) {}
    torchButton.disabled = !supported;
    torchButton.textContent = torchEnabled ? "Feneri Kapat" : "Feneri Aç";
  }

  function stopScanner() {
    stopRearmMonitor();
    if (controls) { try { controls.stop(); } catch (_) {} controls = null; }
    if (reader) { try { reader.reset(); } catch (_) {} reader = null; }
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
    resetScanGate();
  }

  async function startScanner() {
    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
      throw new Error("Barkod okuyucu yüklenemedi. İnternet bağlantısını kontrol edin.");
    }
    reader = new window.ZXingBrowser.BrowserMultiFormatReader();
    cameraEngine.textContent = "ZXing aktif • Kadraj çıkışı algılanıyor";
    startRearmMonitor();
    controls = await reader.decodeFromVideoElement(video, (result, error) => {
      if (result) {
        const barcode = String(result.getText() || "").trim();
        if (!barcode) return;
        /*
         * Barkod kadrajda kaldığı sürece ZXing aynı sonucu tekrar üretir.
         * Bu nedenle son görülme zamanı her gerçek sonuçta güncellenir.
         * Sonuçlar REARM_DELAY_MS boyunca kesildiğinde monitor yeniden okuma izni verir.
         */
        if (canAcceptBarcode(barcode)) acceptBarcode(barcode);
      } else if (error) {
        checkScanRearm();
      }
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
      setMessage(mode === "quick"
        ? "Hazır. Aynı ürün tekrar okutulabilir; barkodu kadrajdan çıkarıp yeniden gösterin. Stok son onayda değişir."
        : "Hazır. Barkod stok işlem ekranına aktarılacak.", "success");
    } catch (error) {
      await stopCamera();
      startButton.disabled = false;
      let message = error?.message || "Kamera başlatılamadı.";
      if (error?.name === "NotAllowedError") message = "Kamera izni verilmedi. Site ayarlarından Kamera → İzin ver seçin.";
      if (error?.name === "NotFoundError") message = "Kullanılabilir kamera bulunamadı.";
      if (error?.name === "NotReadableError") message = "Kamera başka bir uygulama tarafından kullanılıyor olabilir.";
      coverText.textContent = message;
      setMessage(message, "error");
    }
  }

  async function openCamera(requestedMode = "quick") {
    mode = requestedMode === "stock" ? "stock" : "quick";
    cameraTitle.textContent = mode === "quick" ? "Hızlı Kamera — Liste ve Son Onay" : "Stok İşlemi Kamerası";
    waitingForResult = false;
    resetScanGate();
    lastBarcode.textContent = "Henüz okutulmadı";
    stockResult.textContent = mode === "quick" ? "Barkod bekleniyor" : "Ürün barkodu bekleniyor";
    batchPanel.classList.toggle("hidden", mode !== "quick");
    setMessage("Kamera hazırlanıyor...");
    renderBatch(false);
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
      postToApp({ source: "HOCA_MOBILYA_CAMERA", type: "SKIP_UNKNOWN_PRODUCT", scanId: pendingUnknownScanId, barcode: pendingUnknownBarcode });
    }
    persistDraft();
    hideUnknownProductActions();
    pendingUnknownBarcode = "";
    pendingUnknownScanId = "";
    await stopCamera();
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("camera-open");
    waitingForResult = false;
    if (notifyApp) postToApp({ source: "HOCA_MOBILYA_CAMERA", type: "CAMERA_CLOSED", mode });
  }

  function acceptBarcode(value, force = false) {
    const barcode = String(value || "").trim();
    if (!barcode || waitingForResult || batchSubmitting || confirmOpen) return;
    if (!force && !canAcceptBarcode(barcode)) return;
    lockAcceptedBarcode(barcode);
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
      beep(false); vibrate(false); return;
    }
    addProductToBatch(data.product, 1);
    const item = batchItems.get(data.product.barcode);
    stockResult.textContent = "Listeye eklendi • Adet: " + item.quantity;
    setMessage(`${productLabel(data.product)} listeye eklendi. Aynı barkod yaklaşık 1,6 saniye sonra yeniden okunabilir.`, "success");
    beep(true); vibrate(true);
  }

  function handleBatchResult(data) {
    waitingForResult = false;
    batchSubmitting = false;
    cancelBatchConfirmButton.disabled = false;
    approveBatchButton.disabled = false;
    approveBatchButton.textContent = "Onayla ve Stoğa Ekle";

    if (!data.success) {
      const validationFailure = data.code === "BATCH_VALIDATION_FAILED";
      recoveryRequired = !validationFailure && Boolean(batchRequestId);
      confirmMessage.textContent = recoveryRequired
        ? (data.message || "İşlem sonucu doğrulanamadı.") + " Çift kayıt riskini önlemek için listeyi değiştirmeden aynı işlem numarasıyla tekrar onaylayın."
        : (data.message || "Toplu stok girişi tamamlanamadı.");
      confirmMessage.className = "batch-confirm-message error";
      setMessage(
        recoveryRequired
          ? "İşlem sonucu belirsiz. Liste kilitlendi; aynı işlem numarasıyla tekrar onaylayın."
          : (data.message || "Toplu stok girişi tamamlanamadı. Liste cihazda korunuyor."),
        "error"
      );
      renderBatch();
      beep(false); vibrate(false); return;
    }

    const total = Number(data.totalQuantity) || totalBatchQuantity();
    const productCount = Number(data.productCount) || batchItems.size;
    batchItems.clear();
    batchRequestId = "";
    localStorage.removeItem(BATCH_DRAFT_KEY);
    renderBatch(false);
    confirmOpen = false;
    confirmModal.classList.add("hidden");
    confirmModal.setAttribute("aria-hidden", "true");
    stockResult.textContent = `${productCount} ürün • ${total} adet stoğa eklendi`;
    setMessage((data.duplicatePrevented ? "Çift kayıt engellendi; önceki başarılı sonuç gösterildi. " : "") + (data.message || "Toplu stok girişi başarıyla tamamlandı."), "success");
    resetScanGate();
    beep(true); vibrate(true);
  }

  window.addEventListener("message", event => {
    if (!APP_ORIGIN_PATTERN.test(event.origin)) return;
    const data = event.data || {};
    if (data.source !== "HOCA_MOBILYA_APP") return;
    appMessageTarget = event.source;
    appFrameReady = true;
    setConnectionState();

    if (data.type === "OPEN_CAMERA") {
      currentPersonnel = data.personnel || currentPersonnel;
      showDraftRestoreIfNeeded();
      openCamera(data.mode);
      return;
    }
    if (data.type === "APP_READY") {
      currentPersonnel = data.personnel || currentPersonnel;
      showDraftRestoreIfNeeded();
      return;
    }
    if (data.type === "ADD_PRODUCT_TO_BATCH") {
      if (data.product) addProductToBatch(data.product, Number(data.quantity) || 1);
      openCamera("quick");
      return;
    }
    if (data.type === "SCAN_ACCEPTED") {
      waitingForResult = false;
      stockResult.textContent = "Barkod aktarıldı";
      setMessage("Barkod stok işlem ekranına aktarıldı.", "success");
      return;
    }
    if (data.type === "CAMERA_ITEM_RESULT") { handleItemResult(data); return; }
    if (data.type === "BATCH_STOCK_RESULT") { handleBatchResult(data); return; }
    if (data.type === "PRODUCT_REQUIRED") {
      waitingForResult = true;
      stopScanner();
      stockResult.textContent = "Ürün kayıtlı değil";
      setMessage(data.message || "Ürün kayıtlı değil. Bir işlem seçin.", "error");
      showUnknownProductActions(data.barcode, data.scanId);
      beep(false); vibrate(false); return;
    }
    if (data.type === "PRODUCT_ADDED_TO_BATCH") {
      if (data.product) addProductToBatch(data.product, 1);
      pendingUnknownBarcode = "";
      pendingUnknownScanId = "";
      hideUnknownProductActions();
      waitingForResult = false;
      resetScanGate();
      stockResult.textContent = "Yeni ürün listeye eklendi";
      setMessage(data.message || "Yeni ürün listeye eklendi.", "success");
      beep(true); vibrate(true);
      window.setTimeout(() => openCamera("quick"), 350);
      return;
    }
    if (data.type === "SCAN_RESUME") {
      if (suppressNextResume) { suppressNextResume = false; return; }
      if (overlay.classList.contains("hidden")) openCamera("quick");
      else resumeScannerAfterUnknownProduct();
      return;
    }
    if (data.type === "CLOSE_CAMERA" || data.type === "SESSION_CLOSED") closeCamera(false);
  });

  startButton.addEventListener("click", async () => {
    try { await enumerateCameras(); cameraIndex = preferredCameraIndex(); await startCamera(cameras[cameraIndex]?.deviceId || ""); }
    catch (_) { await startCamera(); }
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
    postToApp({ source: "HOCA_MOBILYA_CAMERA", type: "SKIP_UNKNOWN_PRODUCT", scanId: pendingUnknownScanId, barcode: pendingUnknownBarcode });
    stockResult.textContent = "Yeni barkod bekleniyor";
    setMessage("Barkod geçildi. Kamera hazırlanıyor...");
  });
  addUnknownProductFromCameraButton.addEventListener("click", () => {
    if (!pendingUnknownBarcode) return;
    postToApp({ source: "HOCA_MOBILYA_CAMERA", type: "ADD_UNKNOWN_PRODUCT", scanId: pendingUnknownScanId, barcode: pendingUnknownBarcode });
    closeCamera(false, false);
  });
  batchList.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    const row = button?.closest(".camera-batch-row");
    if (button && row) changeBatchQuantity(row.dataset.barcode, button.dataset.action);
  });
  clearBatchButton.addEventListener("click", clearBatch);
  submitBatchButton.addEventListener("click", openBatchConfirm);
  cancelBatchConfirmButton.addEventListener("click", closeBatchConfirm);
  approveBatchButton.addEventListener("click", approveBatch);
  confirmModal.addEventListener("click", event => { if (event.target === confirmModal) closeBatchConfirm(); });
  deleteDraftButton.addEventListener("click", () => {
    if (window.confirm("Kaydedilmiş stok taslağı silinsin mi?")) deleteSavedDraft();
  });
  restoreDraftButton.addEventListener("click", restoreSavedDraft);
  closeButton.addEventListener("click", () => closeCamera(true));
  overlay.addEventListener("click", event => { if (event.target === overlay) closeCamera(true); });
  manualButton.addEventListener("click", () => {
    acceptBarcode(manualBarcode.value, true);
    manualBarcode.value = "";
    manualBarcode.focus();
  });
  manualBarcode.addEventListener("keydown", event => { if (event.key === "Enter") manualButton.click(); });
  window.addEventListener("online", () => { setConnectionState(); renderBatch(false); setMessage("İnternet bağlantısı geri geldi. Listeyi onaylayabilirsiniz.", "success"); });
  window.addEventListener("offline", () => { setConnectionState(); renderBatch(false); setMessage("İnternet bağlantısı kesildi. Liste cihazda korunuyor.", "error"); });
  window.addEventListener("beforeunload", event => {
    persistDraft();
    if (batchItems.size || batchSubmitting) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => { persistDraft(); stopCamera(); });

  savedDraftCandidate = readDraft();
  renderBatch(false);
  setConnectionState();
  window.setTimeout(() => {
    if (!appFrameReady) loader.querySelector("span").textContent = "Uygulama beklenenden uzun sürede açılıyor...";
  }, 12000);
})();
