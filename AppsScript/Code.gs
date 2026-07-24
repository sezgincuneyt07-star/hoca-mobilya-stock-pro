/************************************************************
 * HOCA MOBİLYA STOK PRO
 * Code.gs
 * Sürüm: 15.0.0
 ************************************************************/


/************************************************************
 * UYGULAMA AYARLARI
 ************************************************************/

const APP_CONFIG = {

  APP_NAME: "HOCA MOBİLYA STOK PRO",

  APP_VERSION: "15.0.0",

  SPREADSHEET_ID_PROPERTY:
    "HOCA_MOBILYA_SPREADSHEET_ID",

  SESSION_PREFIX:
    "HOCA_STOK_SESSION_",

  SESSION_DURATION_SECONDS:
    21600,

  SHEETS: {

    PRODUCTS:
      "Urunler",

    MOVEMENTS:
      "Hareketler",

    PERSONNEL:
      "Personeller",

    BATCH_TRANSACTIONS:
      "TopluIslemler",

    STOCK_SUMMARY:
      "Stok Özeti",

    DOCUMENTS:
      "Belgeler"

  },

  CATEGORY_STOCK_SHEETS: [

    {
      type: "Yatak",
      sheetName: "Yatak Stok"
    },

    {
      type: "Baza",
      sheetName: "Baza Stok"
    },

    {
      type: "Ayak",
      sheetName: "Ayak Stok"
    },

    {
      type: "Başlık",
      sheetName: "Başlık Stok"
    }

  ],

  PRODUCT_HEADERS: [

    "Barkod",

    "Urun Kodu",

    "Tur",

    "Model",

    "Olcu",

    "Renk",

    "Stok",

    "Kritik Stok",

    "Aktif"

  ],

  MOVEMENT_HEADERS: [

    "Tarih",

    "Barkod",

    "Urun Kodu",

    "Tur",

    "Model",

    "Olcu",

    "Renk",

    "Islem",

    "Adet",

    "Onceki Stok",

    "Yeni Stok",

    "Personel",

    "Kaynak",

    "Aciklama"

  ],

  PERSONNEL_HEADERS: [

    "Personel",

    "PIN Hash",

    "Yetki",

    "Aktif",

    "Son Guncelleme"

  ],

  BATCH_TRANSACTION_HEADERS: [

    "Islem No",

    "Olusturma Tarihi",

    "Tamamlanma Tarihi",

    "Personel",

    "Durum",

    "Farkli Urun",

    "Toplam Adet",

    "Icerik Hash",

    "Sonuc JSON",

    "Hata"

  ],

  DOCUMENT_HEADERS: [

    "Belge No",

    "Belge Türü",

    "Tarih",

    "Müşteri",

    "Telefon",

    "Adres",

    "Toplam",

    "Düzenleyen",

    "Durum",

    "Belge JSON"

  ],

  PRODUCT_TYPES: [

    "Yatak",

    "Baza",

    "Başlık",

    "Ayak"

  ],

  ROLES: {

    ADMIN:
      "Yönetici",

    PERSONNEL:
      "Personel"

  },

  STATUS: {

    ACTIVE:
      "Evet",

    PASSIVE:
      "Hayır"

  },

  OPERATIONS: {

    STOCK_IN:
      "Giriş",

    STOCK_OUT:
      "Çıkış",

    ADJUSTMENT:
      "Düzeltme",

    NEW_PRODUCT:
      "Yeni Ürün"

  },

  SOURCES: {

    NORMAL:
      "Normal Stok İşlemi",

    QUICK:
      "Hızlı Stok Girişi",

    QUICK_BATCH:
      "Hızlı Kamera Toplu Onay",

    NEW_PRODUCT:
      "Yeni Ürün Kaydı",

    ADMIN:
      "Yönetici Düzeltmesi"

  }

};


/************************************************************
 * WEB UYGULAMASI
 ************************************************************/

function doGet(e) {

  /*
   * GitHub Pages üzerindeki hızlı kamera, barkod okunduğunda
   * stok işlemini JSONP üzerinden doğrudan bu güvenli uç noktaya gönderir.
   * Böylece mobil tarayıcı yeni sekme yerine aynı sekmeyi kullansa bile
   * uygulamanın giriş ekranına dönülmez ve kamera açık kalır.
   */
  if (
    e &&
    e.parameter &&
    cleanText_(e.parameter.cameraApi) === "1"
  ) {

    return handleCameraApiRequest_(e);

  }

  /*
   * Ürün türlerini Google E-Tablo üzerinde ayrı sekmelerde canlı tutar.
   * Ana veri kaynağı Urunler sayfasıdır; kategori sekmeleri formülle
   * otomatik güncellenir ve mevcut stok işlem akışını değiştirmez.
   */
  try {

    ensureCategoryStockSheets_();

  } catch (categorySheetError) {

    console.error(
      "Kategori stok sayfaları hazırlanamadı:",
      categorySheetError
    );

  }

  const template =
    HtmlService.createTemplateFromFile(
      "index"
    );

  const scannedBarcode =
    e &&
    e.parameter &&
    e.parameter.barcode
      ? normalizeBarcode_(
          e.parameter.barcode
        )
      : "";

  template.appName =
    APP_CONFIG.APP_NAME;

  template.appVersion =
    APP_CONFIG.APP_VERSION;

  template.scannedBarcodeJson =
    JSON.stringify(
      scannedBarcode
    );

  return template
    .evaluate()
    .setTitle(
      APP_CONFIG.APP_NAME
    )
    .setXFrameOptionsMode(
      HtmlService.XFrameOptionsMode.ALLOWALL
    )
    .addMetaTag(
      "viewport",
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
    );

}


/************************************************************
 * GITHUB KAMERA JSONP API - V16 GÜVENLİ MOD
 *
 * Eski doğrudan +1 stok API'si kapatılmıştır. Bu uç nokta
 * yalnızca barkod/ürün kontrolü yapar; stok değişikliği sadece
 * batchQuickStockIn ile son onaydan sonra yapılabilir.
 ************************************************************/

function handleCameraApiRequest_(e) {

  const parameters =
    e && e.parameter
      ? e.parameter
      : {};

  const callback =
    normalizeCameraCallback_(
      parameters.callback
    );

  let response;

  try {

    const action =
      cleanText_(
        parameters.action
      );

    if (action !== "lookupProduct") {

      throw new Error(
        "Doğrudan hızlı stok girişi V16 sürümünde kapatıldı. Stok yalnızca toplu son onay ile değiştirilebilir."
      );

    }

    const token =
      cleanText_(
        parameters.token
      );

    const barcode =
      normalizeBarcode_(
        parameters.barcode
      );

    authorize_(token);

    if (!barcode) {

      throw new Error(
        "Barkod girilmelidir."
      );

    }

    const product =
      findProductByBarcode_(
        barcode
      );

    if (!product) {

      response = {
        success: false,
        code: "PRODUCT_NOT_FOUND",
        barcode: barcode,
        message: "Bu barkoda ait ürün bulunamadı."
      };

    } else if (!isActiveValue_(product.active)) {

      response = {
        success: false,
        code: "PRODUCT_PASSIVE",
        barcode: barcode,
        message: "Bu ürün pasif durumdadır."
      };

    } else {

      response = {
        success: true,
        barcode: barcode,
        product: productToClient_(product),
        message: "Ürün kontrol edildi."
      };

    }

  } catch (error) {

    response = {
      success: false,
      code: "CAMERA_API_ERROR",
      message:
        error && error.message
          ? error.message
          : "Kamera ürün kontrolü tamamlanamadı."
    };

  }

  return ContentService
    .createTextOutput(
      callback + "(" + JSON.stringify(response) + ");"
    )
    .setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );

}


function normalizeCameraCallback_(value) {

  const callback =
    cleanText_(value);

  return /^[A-Za-z_$][A-Za-z0-9_$]{0,80}$/.test(callback)
    ? callback
    : "";

}


function createCameraScanCacheKey_(token, scanId) {

  const cleanScanId =
    cleanText_(scanId)
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 80);

  if (!cleanScanId) {

    return "";

  }

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      cleanText_(token) + "|" + cleanScanId,
      Utilities.Charset.UTF_8
    );

  return (
    "HOCA_CAMERA_SCAN_" +
    Utilities
      .base64EncodeWebSafe(digest)
      .replace(/=+$/g, "")
      .slice(0, 60)
  );

}


/************************************************************
 * HTML DOSYASI DAHİL ET
 ************************************************************/

function include(filename) {

  return HtmlService
    .createHtmlOutputFromFile(
      filename
    )
    .getContent();

}


/************************************************************
 * SİSTEMİ İLK KEZ KUR
 ************************************************************/

function setupSystem() {

  const spreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {

    throw new Error(
      "Bu Apps Script projesi bir Google E-Tablo dosyasına bağlı olmalıdır."
    );

  }

  PropertiesService
    .getScriptProperties()
    .setProperty(
      APP_CONFIG.SPREADSHEET_ID_PROPERTY,
      spreadsheet.getId()
    );

  const productsSheet =
    ensureSheet_(
      spreadsheet,
      APP_CONFIG.SHEETS.PRODUCTS,
      APP_CONFIG.PRODUCT_HEADERS
    );

  const movementsSheet =
    ensureSheet_(
      spreadsheet,
      APP_CONFIG.SHEETS.MOVEMENTS,
      APP_CONFIG.MOVEMENT_HEADERS
    );

  const personnelSheet =
    ensurePersonnelSheet_(
      spreadsheet
    );

  const batchTransactionsSheet =
    ensureBatchTransactionsSheet_(
      spreadsheet
    );

  formatProductsSheet_(
    productsSheet
  );

  formatMovementsSheet_(
    movementsSheet
  );

  formatPersonnelSheet_(
    personnelSheet
  );

  formatBatchTransactionsSheet_(
    batchTransactionsSheet
  );

  SpreadsheetApp.flush();

  return {

    success:
      true,

    message:
      "Sistem başarıyla hazırlandı.",

    spreadsheetId:
      spreadsheet.getId(),

    sheets: [

      APP_CONFIG.SHEETS.PRODUCTS,

      APP_CONFIG.SHEETS.MOVEMENTS,

      APP_CONFIG.SHEETS.PERSONNEL,

      APP_CONFIG.SHEETS.BATCH_TRANSACTIONS

    ],

    defaultAdmin: {

      personnel:
        "Cüneyt",

      pin:
        "1234",

      role:
        APP_CONFIG.ROLES.ADMIN

    }

  };

}


/************************************************************
 * AKTİF PERSONEL LİSTESİ
 *
 * PIN bilgisi gönderilmez.
 ************************************************************/

function getPersonnel() {

  const sheet =
    getSheet_(
      APP_CONFIG.SHEETS.PERSONNEL
    );

  const rows =
    getDataRows_(
      sheet,
      APP_CONFIG.PERSONNEL_HEADERS.length
    );

  return rows

    .filter(
      function (row) {

        return (
          cleanText_(row[0]) &&
          isActiveValue_(row[3])
        );

      }
    )

    .map(
      function (row) {

        return {

          personnel:
            cleanText_(row[0]),

          role:
            normalizeRole_(row[2])

        };

      }
    )

    .sort(
      function (a, b) {

        return compareTurkish_(
          a.personnel,
          b.personnel
        );

      }
    );

}


/************************************************************
 * PERSONEL GİRİŞİ
 ************************************************************/

function loginPersonnel(
  personnelName,
  pin
) {

  const name =
    cleanText_(
      personnelName
    );

  const cleanPin =
    normalizePin_(
      pin
    );

  if (!name) {

    throw new Error(
      "Personel seçimi yapılmalıdır."
    );

  }

  if (!cleanPin) {

    throw new Error(
      "PIN girilmelidir."
    );

  }

  const personnelRecord =
    findPersonnelByName_(
      name
    );

  if (!personnelRecord) {

    throw new Error(
      "Personel kaydı bulunamadı."
    );

  }

  if (
    !isActiveValue_(
      personnelRecord.active
    )
  ) {

    throw new Error(
      "Bu personel hesabı aktif değildir."
    );

  }

  const enteredPinHash =
    hashPin_(
      cleanPin
    );

  const storedPinValue =
    cleanText_(
      personnelRecord.pinHash
    );

  /*
   * Eski Personeller sayfasında PIN düz metin olarak kalmış olabilir.
   * Hem yeni SHA-256 hash değerini hem de eski düz metin PIN'i kabul eder.
   * Düz metin PIN ile başarılı giriş yapılırsa kayıt otomatik olarak
   * güvenli hash biçimine dönüştürülür.
   */
  const pinMatchesHash =
    enteredPinHash ===
    storedPinValue;

  const pinMatchesLegacyPlainText =
    cleanPin ===
    storedPinValue;

  if (
    !pinMatchesHash &&
    !pinMatchesLegacyPlainText
  ) {

    throw new Error(
      "PIN hatalıdır."
    );

  }

  if (pinMatchesLegacyPlainText) {

    const personnelSheet =
      getSheet_(
        APP_CONFIG.SHEETS.PERSONNEL
      );

    personnelSheet
      .getRange(
        personnelRecord.rowNumber,
        2
      )
      .setValue(
        enteredPinHash
      );

    personnelSheet
      .getRange(
        personnelRecord.rowNumber,
        5
      )
      .setValue(
        new Date()
      );

  }

  const token =
    Utilities.getUuid() +
    Utilities.getUuid();

  const session = {

    personnel:
      personnelRecord.personnel,

    role:
      personnelRecord.role,

    loginTime:
      new Date().toISOString()

  };

  CacheService
    .getScriptCache()
    .put(
      APP_CONFIG.SESSION_PREFIX +
      token,
      JSON.stringify(
        session
      ),
      APP_CONFIG.SESSION_DURATION_SECONDS
    );

  return {

    success:
      true,

    token:
      token,

    personnel:
      session.personnel,

    role:
      session.role,

    isAdmin:
      session.role ===
      APP_CONFIG.ROLES.ADMIN,

    expiresIn:
      APP_CONFIG.SESSION_DURATION_SECONDS

  };

}


/************************************************************
 * OTURUMU KAPAT
 ************************************************************/

function logoutSession(
  token
) {

  const cleanToken =
    cleanText_(
      token
    );

  if (cleanToken) {

    CacheService
      .getScriptCache()
      .remove(
        APP_CONFIG.SESSION_PREFIX +
        cleanToken
      );

  }

  return {

    success:
      true

  };

}


/************************************************************
 * OTURUM BİLGİSİNİ AL
 ************************************************************/

function getSessionUser(
  token
) {

  const session =
    authorize_(
      token
    );

  return {

    success:
      true,

    personnel:
      session.personnel,

    role:
      session.role,

    isAdmin:
      session.role ===
      APP_CONFIG.ROLES.ADMIN

  };

}




/************************************************************
 * YENİ SCRIPT.HTML İLE UYUMLULUK KATMANI
 *
 * Yeni arayüz aşağıdaki fonksiyon adlarını çağırır:
 * - login
 * - validateSession
 * - logout
 *
 * Asıl işlemler mevcut güvenli fonksiyonlara yönlendirilir.
 ************************************************************/

/**
 * Yeni arayüz için giriş fonksiyonu.
 */
function login(personnelName, pin) {
  return loginPersonnel(personnelName, pin);
}


/**
 * Yeni arayüz için oturum doğrulama fonksiyonu.
 */
function validateSession(token) {
  const session = authorize_(token);

  return {
    success: true,
    valid: true,
    token: cleanText_(token),
    personnel: session.personnel,
    role: session.role,
    loggedIn: true,
    isAdmin:
      session.role === APP_CONFIG.ROLES.ADMIN
  };
}


/**
 * Yeni arayüz için çıkış fonksiyonu.
 */
function logout(token) {
  return logoutSession(token);
}


/************************************************************
 * BARKODLA ÜRÜN BUL
 ************************************************************/

function getProduct(
  barcode,
  token
) {

  authorize_(
    token
  );

  const cleanBarcode =
    normalizeBarcode_(
      barcode
    );

  if (!cleanBarcode) {

    throw new Error(
      "Barkod girilmelidir."
    );

  }

  const product =
    findProductByBarcode_(
      cleanBarcode
    );

  if (!product) {

    return null;

  }

  return productToClient_(
    product
  );

}


/************************************************************
 * ÜRÜN ARA
 ************************************************************/

function searchProduct(
  searchText,
  token
) {

  authorize_(
    token
  );

  const search =
    normalizeForSearch_(
      searchText
    );

  if (
    !search ||
    search.length < 2
  ) {

    return [];

  }

  const products =
    getAllProducts_();

  return products

    .filter(
      function (product) {

        if (
          !isActiveValue_(
            product.active
          )
        ) {

          return false;

        }

        const searchableText =
          normalizeForSearch_(
            [

              product.barcode,

              product.code,

              product.type,

              product.model,

              product.size,

              product.color

            ].join(" ")
          );

        return (
          searchableText.indexOf(
            search
          ) !== -1
        );

      }
    )

    .sort(
      sortProducts_
    )

    .slice(
      0,
      100
    )

    .map(
      productToClient_
    );

}




/************************************************************
 * YÖNETİCİ - KATEGORİ BAZLI ÜRÜN/STOK RAPORU
 ************************************************************/
function getProductStockReport(token) {
  const session = authorize_(token);
  if (session.role !== APP_CONFIG.ROLES.ADMIN) {
    throw new Error("Bu raporu yalnızca yöneticiler görüntüleyebilir.");
  }

  return getAllProducts_()
    .filter(function(product) {
      return isActiveValue_(product.active);
    })
    .sort(sortProducts_)
    .map(productToClient_);
}


/************************************************************
 * YENİ ÜRÜN EKLE
 ************************************************************/

function addProduct(
  productData,
  token
) {

  const session =
    authorize_(
      token
    );

  const product =
    validateAndNormalizeProduct_(
      productData
    );

  const lock =
    LockService.getScriptLock();

  lock.waitLock(
    30000
  );

  try {

    const existing =
      findProductByBarcode_(
        product.barcode
      );

    if (existing) {

      return {

        success:
          false,

        message:
          "Bu barkodla kayıtlı bir ürün zaten bulunmaktadır.",

        product:
          productToClient_(
            existing
          )

      };

    }

    const sheet =
      getSheet_(
        APP_CONFIG.SHEETS.PRODUCTS
      );

    sheet.appendRow([

      product.barcode,

      product.code,

      product.type,

      product.model,

      product.size,

      product.color,

      product.stock,

      product.critical,

      product.active

    ]);

    const createdProduct =
      findProductByBarcode_(
        product.barcode
      );

    appendMovement_({

      product:
        createdProduct,

      operation:
        APP_CONFIG.OPERATIONS.NEW_PRODUCT,

      quantity:
        product.stock,

      previousStock:
        0,

      newStock:
        product.stock,

      personnel:
        session.personnel,

      source:
        APP_CONFIG.SOURCES.NEW_PRODUCT,

      description:
        "Yeni ürün kaydı oluşturuldu."

    });

    return {

      success:
        true,

      message:
        "Yeni ürün başarıyla kaydedildi.",

      product:
        productToClient_(
          createdProduct
        )

    };

  } finally {

    lock.releaseLock();

  }

}


/************************************************************
 * NORMAL STOK GİRİŞİ
 ************************************************************/

function stockIn(
  barcode,
  quantity,
  token
) {

  return updateStock_({

    barcode:
      barcode,

    quantity:
      quantity,

    direction:
      1,

    token:
      token,

    source:
      APP_CONFIG.SOURCES.NORMAL

  });

}


/************************************************************
 * NORMAL STOK ÇIKIŞI
 ************************************************************/

function stockOut(
  barcode,
  quantity,
  token
) {

  return updateStock_({

    barcode:
      barcode,

    quantity:
      quantity,

    direction:
      -1,

    token:
      token,

    source:
      APP_CONFIG.SOURCES.NORMAL

  });

}


/************************************************************
 * ESKİ DOĞRUDAN HIZLI +1 İŞLEMİ
 *
 * V16 sürümünde güvenlik nedeniyle kapatılmıştır. Hızlı kamera
 * yalnızca geçici liste oluşturur; stok batchQuickStockIn ile
 * son personel onayından sonra değiştirilir.
 ************************************************************/

function quickStockIn(
  barcode,
  token
) {

  authorize_(
    token
  );

  throw new Error(
    "Doğrudan hızlı +1 stok girişi V16 sürümünde kapatıldı. Hızlı Kamera listesini kullanıp son onay verin."
  );

}


/************************************************************
 * HIZLI KAMERA - TOPLU STOK ONAYI V16
 *
 * Güvenlik kuralları:
 * - Stok yalnızca son onaydan sonra değişir.
 * - Her işlem kimliği TopluIslemler sayfasına kalıcı yazılır.
 * - Aynı işlem kimliği tekrar gönderilirse ikinci kez uygulanmaz.
 * - Aynı işlem kimliği farklı içerikle gönderilemez.
 * - Tüm ürünler doğrulanmadan hiçbir stok hücresi değiştirilmez.
 * - Yazma hatasında ürün stokları ve hareket satırları geri alınır.
 ************************************************************/

function batchQuickStockIn(
  items,
  requestId,
  token
) {

  const session =
    authorize_(
      token
    );

  const cleanRequestId =
    normalizeBatchRequestId_(
      requestId
    );

  const batchData =
    normalizeBatchItems_(
      items
    );

  const payloadHash =
    hashText_(
      JSON.stringify(
        batchData.canonicalItems
      )
    );

  const lock =
    LockService.getScriptLock();

  lock.waitLock(
    30000
  );

  try {

    const spreadsheet =
      getSpreadsheet_();

    const transactionSheet =
      ensureBatchTransactionsSheet_(
        spreadsheet
      );

    const existingTransaction =
      findBatchTransactionById_(
        transactionSheet,
        cleanRequestId
      );

    if (existingTransaction) {

      if (
        cleanText_(existingTransaction.payloadHash) !==
        payloadHash
      ) {

        throw new Error(
          "Bu işlem numarası daha önce farklı bir ürün listesiyle kullanılmış. Listeyi yeniden onaylayın."
        );

      }

      if (
        cleanText_(existingTransaction.status) ===
        "TAMAMLANDI"
      ) {

        const savedResult =
          safeJsonParse_(
            existingTransaction.resultJson
          );

        if (savedResult) {

          return Object.assign(
            {},
            savedResult,
            {
              duplicatePrevented: true
            }
          );

        }

        throw new Error(
          "İşlem daha önce tamamlandı ancak sonuç kaydı okunamadı. Yönetici hareket kayıtlarını kontrol etmelidir."
        );

      }

      if (
        cleanText_(existingTransaction.status) ===
        "ISLENIYOR"
      ) {

        const startedAt =
          existingTransaction.startedAt instanceof Date
            ? existingTransaction.startedAt.getTime()
            : new Date(existingTransaction.startedAt).getTime();

        const isStale =
          !startedAt ||
          Date.now() - startedAt > 120000;

        if (!isStale) {

          throw new Error(
            "Bu işlem şu anda işleniyor. Birkaç saniye bekleyip tekrar deneyin."
          );

        }

      }

      updateBatchTransactionRow_(
        transactionSheet,
        existingTransaction.rowNumber,
        {
          startedAt: new Date(),
          completedAt: "",
          personnel: session.personnel,
          status: "ISLENIYOR",
          productCount: batchData.barcodes.length,
          totalQuantity: batchData.totalQuantity,
          payloadHash: payloadHash,
          resultJson: "",
          error: ""
        }
      );

    } else {

      appendBatchTransaction_(
        transactionSheet,
        {
          requestId: cleanRequestId,
          startedAt: new Date(),
          completedAt: "",
          personnel: session.personnel,
          status: "ISLENIYOR",
          productCount: batchData.barcodes.length,
          totalQuantity: batchData.totalQuantity,
          payloadHash: payloadHash,
          resultJson: "",
          error: ""
        }
      );

    }

    const transaction =
      findBatchTransactionById_(
        transactionSheet,
        cleanRequestId
      );

    if (!transaction) {

      throw new Error(
        "Toplu işlem güvenlik kaydı oluşturulamadı."
      );

    }

    const products =
      getAllProducts_();

    const productMap = {};

    products.forEach(
      function (product) {

        productMap[
          normalizeBarcode_(
            product.barcode
          )
        ] = product;

      }
    );

    const validationErrors = [];
    const plans = [];

    batchData.barcodes.forEach(
      function (barcode) {

        const product =
          productMap[barcode];

        if (!product) {

          validationErrors.push({
            barcode: barcode,
            code: "PRODUCT_NOT_FOUND",
            message: "Bu barkoda ait ürün bulunamadı."
          });

          return;

        }

        if (!isActiveValue_(product.active)) {

          validationErrors.push({
            barcode: barcode,
            code: "PRODUCT_PASSIVE",
            message:
              "Ürün pasif durumda: " +
              cleanText_(product.model)
          });

          return;

        }

        const quantity =
          batchData.aggregated[barcode];

        const previousStock =
          toNonNegativeInteger_(
            product.stock
          );

        plans.push({
          product: product,
          quantity: quantity,
          previousStock: previousStock,
          newStock: previousStock + quantity
        });

      }
    );

    if (validationErrors.length) {

      const validationResult = {
        success: false,
        code: "BATCH_VALIDATION_FAILED",
        message: "Liste doğrulanamadı. Hatalı ürünleri düzeltip yeni bir onay işlemi başlatın.",
        requestId: cleanRequestId,
        errors: validationErrors
      };

      updateBatchTransactionRow_(
        transactionSheet,
        transaction.rowNumber,
        {
          completedAt: new Date(),
          status: "HATA",
          resultJson: JSON.stringify(validationResult),
          error: validationResult.message
        }
      );

      return validationResult;

    }

    const productsSheet =
      getSheet_(
        APP_CONFIG.SHEETS.PRODUCTS
      );

    const movementsSheet =
      getSheet_(
        APP_CONFIG.SHEETS.MOVEMENTS
      );

    const movementStartRow =
      movementsSheet.getLastRow() +
      1;

    const now =
      new Date();

    const appliedPlans = [];

    try {

      plans.forEach(
        function (plan) {

          productsSheet
            .getRange(
              plan.product.rowNumber,
              7
            )
            .setValue(
              plan.newStock
            );

          appliedPlans.push(
            plan
          );

        }
      );

      const movementRows =
        plans.map(
          function (plan) {

            return [
              now,
              plan.product.barcode,
              plan.product.code,
              plan.product.type,
              plan.product.model,
              plan.product.size,
              plan.product.color,
              APP_CONFIG.OPERATIONS.STOCK_IN,
              plan.quantity,
              plan.previousStock,
              plan.newStock,
              session.personnel,
              APP_CONFIG.SOURCES.QUICK_BATCH,
              "Toplu kamera onayı • İşlem No: " +
                cleanRequestId
            ];

          }
        );

      const requiredLastRow =
        movementStartRow +
        movementRows.length -
        1;

      if (
        requiredLastRow >
        movementsSheet.getMaxRows()
      ) {

        movementsSheet.insertRowsAfter(
          movementsSheet.getMaxRows(),
          requiredLastRow -
          movementsSheet.getMaxRows()
        );

      }

      movementsSheet
        .getRange(
          movementStartRow,
          1,
          movementRows.length,
          APP_CONFIG.MOVEMENT_HEADERS.length
        )
        .setValues(
          movementRows
        );

      SpreadsheetApp.flush();

    } catch (writeError) {

      appliedPlans.forEach(
        function (plan) {

          try {

            productsSheet
              .getRange(
                plan.product.rowNumber,
                7
              )
              .setValue(
                plan.previousStock
              );

          } catch (rollbackError) {}

        }
      );

      try {

        const currentLastRow =
          movementsSheet.getLastRow();

        if (
          currentLastRow >=
          movementStartRow
        ) {

          movementsSheet.deleteRows(
            movementStartRow,
            currentLastRow -
            movementStartRow +
            1
          );

        }

      } catch (movementRollbackError) {}

      SpreadsheetApp.flush();

      const safeMessage =
        "Toplu stok kaydı tamamlanamadı. Hiçbir ürün stoğa eklenmedi. " +
        cleanText_(
          writeError && writeError.message
        );

      updateBatchTransactionRow_(
        transactionSheet,
        transaction.rowNumber,
        {
          completedAt: new Date(),
          status: "HATA",
          resultJson: "",
          error: safeMessage
        }
      );

      throw new Error(
        safeMessage
      );

    }

    const result = {
      success: true,
      message:
        plans.length +
        " farklı ürün, toplam " +
        batchData.totalQuantity +
        " adet stoğa eklendi.",
      requestId: cleanRequestId,
      personnel: session.personnel,
      productCount: plans.length,
      totalQuantity: batchData.totalQuantity,
      duplicatePrevented: false,
      results:
        plans.map(
          function (plan) {

            return {
              barcode: plan.product.barcode,
              quantity: plan.quantity,
              previousStock: plan.previousStock,
              newStock: plan.newStock,
              product:
                productToClient_(
                  Object.assign(
                    {},
                    plan.product,
                    {
                      stock: plan.newStock
                    }
                  )
                )
            };

          }
        )
    };

    const compactResult = {
      success: true,
      message: result.message,
      requestId: cleanRequestId,
      personnel: session.personnel,
      productCount: plans.length,
      totalQuantity: batchData.totalQuantity,
      duplicatePrevented: false
    };

    updateBatchTransactionRow_(
      transactionSheet,
      transaction.rowNumber,
      {
        completedAt: new Date(),
        status: "TAMAMLANDI",
        resultJson: JSON.stringify(compactResult),
        error: ""
      }
    );

    SpreadsheetApp.flush();

    ensureCategoryStockSheets_();

    return result;

  } finally {

    lock.releaseLock();

  }

}


/************************************************************
 * TOPLU İŞLEM GÜVENLİK YARDIMCILARI
 ************************************************************/

function normalizeBatchRequestId_(
  requestId
) {

  const value =
    cleanText_(
      requestId
    )
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 100);

  if (!value) {

    throw new Error(
      "Toplu işlem kimliği bulunamadı. Listeyi yeniden onaylayın."
    );

  }

  return value;

}


function normalizeBatchItems_(
  items
) {

  if (!Array.isArray(items) || !items.length) {

    throw new Error(
      "Stoğa eklenecek ürün listesi boş."
    );

  }

  if (items.length > 300) {

    throw new Error(
      "Tek seferde en fazla 300 farklı ürün işlenebilir."
    );

  }

  const aggregated = {};

  items.forEach(
    function (item) {

      const barcode =
        normalizeBarcode_(
          item && item.barcode
        );

      const quantity =
        toPositiveInteger_(
          item && item.quantity,
          "Ürün adedi"
        );

      if (!barcode) {

        throw new Error(
          "Listede barkodu boş bir ürün bulunuyor."
        );

      }

      aggregated[barcode] =
        (aggregated[barcode] || 0) +
        quantity;

    }
  );

  const barcodes =
    Object.keys(
      aggregated
    )
      .sort();

  const totalQuantity =
    barcodes.reduce(
      function (total, barcode) {

        return total +
          aggregated[barcode];

      },
      0
    );

  if (totalQuantity > 5000) {

    throw new Error(
      "Tek seferde toplam 5000 adetten fazla stok eklenemez."
    );

  }

  return {
    aggregated: aggregated,
    barcodes: barcodes,
    totalQuantity: totalQuantity,
    canonicalItems:
      barcodes.map(
        function (barcode) {

          return {
            barcode: barcode,
            quantity: aggregated[barcode]
          };

        }
      )
  };

}


function ensureBatchTransactionsSheet_(
  spreadsheet
) {

  const targetSpreadsheet =
    spreadsheet ||
    getSpreadsheet_();

  const sheet =
    ensureSheet_(
      targetSpreadsheet,
      APP_CONFIG.SHEETS.BATCH_TRANSACTIONS,
      APP_CONFIG.BATCH_TRANSACTION_HEADERS
    );

  formatBatchTransactionsSheet_(
    sheet
  );

  return sheet;

}


function formatBatchTransactionsSheet_(
  sheet
) {

  sheet.setFrozenRows(
    1
  );

  sheet
    .getRange(
      1,
      1,
      1,
      APP_CONFIG.BATCH_TRANSACTION_HEADERS.length
    )
    .setFontWeight(
      "bold"
    )
    .setBackground(
      "#b89245"
    )
    .setFontColor(
      "#ffffff"
    )
    .setHorizontalAlignment(
      "center"
    );

  const widths = [
    230,
    165,
    165,
    140,
    110,
    95,
    95,
    340,
    420,
    300
  ];

  widths.forEach(
    function (width, index) {

      sheet.setColumnWidth(
        index + 1,
        width
      );

    }
  );

  if (sheet.getMaxRows() > 1) {

    sheet
      .getRange(
        2,
        1,
        sheet.getMaxRows() - 1,
        1
      )
      .setNumberFormat(
        "@"
      );

    sheet
      .getRange(
        2,
        2,
        sheet.getMaxRows() - 1,
        2
      )
      .setNumberFormat(
        "dd.MM.yyyy HH:mm:ss"
      );

  }

}


function appendBatchTransaction_(
  sheet,
  data
) {

  sheet.appendRow([
    data.requestId,
    data.startedAt || new Date(),
    data.completedAt || "",
    data.personnel || "",
    data.status || "ISLENIYOR",
    Number(data.productCount) || 0,
    Number(data.totalQuantity) || 0,
    data.payloadHash || "",
    data.resultJson || "",
    data.error || ""
  ]);

}


function findBatchTransactionById_(
  sheet,
  requestId
) {

  const lastRow =
    sheet.getLastRow();

  if (lastRow < 2) {

    return null;

  }

  const match =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        1
      )
      .createTextFinder(
        requestId
      )
      .matchEntireCell(
        true
      )
      .findNext();

  if (!match) {

    return null;

  }

  const rowNumber =
    match.getRow();

  const row =
    sheet
      .getRange(
        rowNumber,
        1,
        1,
        APP_CONFIG.BATCH_TRANSACTION_HEADERS.length
      )
      .getValues()[0];

  return {
    rowNumber: rowNumber,
    requestId: cleanText_(row[0]),
    startedAt: row[1],
    completedAt: row[2],
    personnel: cleanText_(row[3]),
    status: cleanText_(row[4]),
    productCount: Number(row[5]) || 0,
    totalQuantity: Number(row[6]) || 0,
    payloadHash: cleanText_(row[7]),
    resultJson: cleanText_(row[8]),
    error: cleanText_(row[9])
  };

}


function updateBatchTransactionRow_(
  sheet,
  rowNumber,
  changes
) {

  const range =
    sheet.getRange(
      rowNumber,
      1,
      1,
      APP_CONFIG.BATCH_TRANSACTION_HEADERS.length
    );

  const row =
    range.getValues()[0];

  if (Object.prototype.hasOwnProperty.call(changes, "requestId")) row[0] = changes.requestId;
  if (Object.prototype.hasOwnProperty.call(changes, "startedAt")) row[1] = changes.startedAt;
  if (Object.prototype.hasOwnProperty.call(changes, "completedAt")) row[2] = changes.completedAt;
  if (Object.prototype.hasOwnProperty.call(changes, "personnel")) row[3] = changes.personnel;
  if (Object.prototype.hasOwnProperty.call(changes, "status")) row[4] = changes.status;
  if (Object.prototype.hasOwnProperty.call(changes, "productCount")) row[5] = changes.productCount;
  if (Object.prototype.hasOwnProperty.call(changes, "totalQuantity")) row[6] = changes.totalQuantity;
  if (Object.prototype.hasOwnProperty.call(changes, "payloadHash")) row[7] = changes.payloadHash;
  if (Object.prototype.hasOwnProperty.call(changes, "resultJson")) row[8] = changes.resultJson;
  if (Object.prototype.hasOwnProperty.call(changes, "error")) row[9] = changes.error;

  range.setValues([
    row
  ]);

}


function hashText_(
  value
) {

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(value || ""),
      Utilities.Charset.UTF_8
    );

  return digest
    .map(
      function (byte) {

        const normalized =
          byte < 0
            ? byte + 256
            : byte;

        return ("0" + normalized.toString(16)).slice(-2);

      }
    )
    .join("");

}


function safeJsonParse_(
  value
) {

  try {

    return JSON.parse(
      cleanText_(value)
    );

  } catch (error) {

    return null;

  }

}


/************************************************************
 * STOK GÜNCELLEME ORTAK FONKSİYONU
 ************************************************************/

function updateStock_(
  options
) {

  const session =
    authorize_(
      options.token
    );

  const barcode =
    normalizeBarcode_(
      options.barcode
    );

  const quantity =
    toPositiveInteger_(
      options.quantity,
      "İşlem adedi"
    );

  const direction =
    Number(
      options.direction
    );

  if (!barcode) {

    throw new Error(
      "Barkod girilmelidir."
    );

  }

  if (
    direction !== 1 &&
    direction !== -1
  ) {

    throw new Error(
      "Geçersiz stok işlem yönü."
    );

  }

  const lock =
    LockService.getScriptLock();

  lock.waitLock(
    30000
  );

  try {

    const product =
      findProductByBarcode_(
        barcode
      );

    if (!product) {

      return {

        success:
          false,

        code:
          "PRODUCT_NOT_FOUND",

        message:
          "Bu barkoda ait ürün bulunamadı.",

        barcode:
          barcode

      };

    }

    if (
      !isActiveValue_(
        product.active
      )
    ) {

      return {

        success:
          false,

        code:
          "PRODUCT_PASSIVE",

        message:
          "Bu ürün pasif durumdadır.",

        product:
          productToClient_(
            product
          )

      };

    }

    const previousStock =
      toNonNegativeInteger_(
        product.stock
      );

    const newStock =
      previousStock +
      (
        quantity *
        direction
      );

    if (newStock < 0) {

      return {

        success:
          false,

        code:
          "INSUFFICIENT_STOCK",

        message:
          "Yeterli stok bulunmamaktadır.",

        product:
          productToClient_(
            product
          )

      };

    }

    const sheet =
      getSheet_(
        APP_CONFIG.SHEETS.PRODUCTS
      );

    sheet
      .getRange(
        product.rowNumber,
        7
      )
      .setValue(
        newStock
      );

    const updatedProduct =
      Object.assign(
        {},
        product,
        {

          stock:
            newStock

        }
      );

    const operation =
      direction === 1
        ? APP_CONFIG.OPERATIONS.STOCK_IN
        : APP_CONFIG.OPERATIONS.STOCK_OUT;

    appendMovement_({

      product:
        updatedProduct,

      operation:
        operation,

      quantity:
        quantity,

      previousStock:
        previousStock,

      newStock:
        newStock,

      personnel:
        session.personnel,

      source:
        options.source ||
        APP_CONFIG.SOURCES.NORMAL,

      description:
        ""

    });

    return {

      success:
        true,

      message:
        direction === 1
          ? quantity +
            " adet stok girişi yapıldı."
          : quantity +
            " adet stok çıkışı yapıldı.",

      quantity:
        quantity,

      previousStock:
        previousStock,

      newStock:
        newStock,

      product:
        productToClient_(
          updatedProduct
        )

    };

  } finally {

    lock.releaseLock();

  }

}


/************************************************************
 * GÜNLÜK STOK GİRİŞ KONTROLÜ
 *
 * Normal personel sadece kendi işlemlerini görebilir.
 * Yönetici bütün personelleri görebilir.
 ************************************************************/

function getDailyStockEntries(
  filters,
  token
) {

  const session =
    authorize_(
      token
    );

  const options =
    filters || {};

  const selectedDate =
    cleanText_(
      options.date
    ) ||
    formatDateKey_(
      new Date()
    );

  let selectedPersonnel =
    cleanText_(
      options.personnel
    );

  const selectedType =
    normalizeProductTypeOptional_(
      options.type
    );

  const searchText =
    normalizeForSearch_(
      options.search
    );

  if (
    session.role !==
    APP_CONFIG.ROLES.ADMIN
  ) {

    selectedPersonnel =
      session.personnel;

  }

  const movements =
    getAllMovements_();

  const filtered =
    movements.filter(
      function (movement) {

        if (
          movement.operation !==
          APP_CONFIG.OPERATIONS.STOCK_IN
        ) {

          return false;

        }

        if (
          formatDateKey_(
            movement.date
          ) !==
          selectedDate
        ) {

          return false;

        }

        if (
          selectedPersonnel &&
          normalizeForSearch_(
            movement.personnel
          ) !==
          normalizeForSearch_(
            selectedPersonnel
          )
        ) {

          return false;

        }

        if (
          selectedType &&
          normalizeProductType_(
            movement.type
          ) !==
          selectedType
        ) {

          return false;

        }

        if (searchText) {

          const searchable =
            normalizeForSearch_(
              [

                movement.barcode,

                movement.code,

                movement.type,

                movement.model,

                movement.size,

                movement.color,

                movement.personnel,

                movement.source

              ].join(" ")
            );

          if (
            searchable.indexOf(
              searchText
            ) === -1
          ) {

            return false;

          }

        }

        return true;

      }
    );

  filtered.sort(
    function (a, b) {

      return (
        b.date.getTime() -
        a.date.getTime()
      );

    }
  );

  const detailRows =
    filtered.map(
      function (movement) {

        return {

          date:
            movement.date.toISOString(),

          dateText:
            formatDateTime_(
              movement.date
            ),

          barcode:
            movement.barcode,

          code:
            movement.code,

          type:
            movement.type,

          model:
            movement.model,

          size:
            movement.size,

          color:
            movement.color,

          quantity:
            movement.quantity,

          previousStock:
            movement.previousStock,

          newStock:
            movement.newStock,

          personnel:
            movement.personnel,

          source:
            movement.source

        };

      }
    );

  const summaryMap =
    {};

  filtered.forEach(
    function (movement) {

      const key =
        movement.barcode;

      if (!summaryMap[key]) {

        summaryMap[key] = {

          barcode:
            movement.barcode,

          code:
            movement.code,

          type:
            movement.type,

          model:
            movement.model,

          size:
            movement.size,

          color:
            movement.color,

          totalQuantity:
            0,

          scanCount:
            0

        };

      }

      summaryMap[key].totalQuantity +=
        movement.quantity;

      summaryMap[key].scanCount +=
        1;

    }
  );

  const summary =
    Object.keys(
      summaryMap
    )

      .map(
        function (key) {

          return summaryMap[key];

        }
      )

      .sort(
        function (a, b) {

          const modelCompare =
            compareTurkish_(
              a.model,
              b.model
            );

          if (modelCompare !== 0) {

            return modelCompare;

          }

          const sizeCompare =
            compareNatural_(
              a.size,
              b.size
            );

          if (sizeCompare !== 0) {

            return sizeCompare;

          }

          return compareTurkish_(
            a.color,
            b.color
          );

        }
      );

  const totalQuantity =
    filtered.reduce(
      function (total, movement) {

        return (
          total +
          movement.quantity
        );

      },
      0
    );

  return {

    success:
      true,

    date:
      selectedDate,

    selectedPersonnel:
      selectedPersonnel,

    isAdmin:
      session.role ===
      APP_CONFIG.ROLES.ADMIN,

    totalTransactions:
      filtered.length,

    totalQuantity:
      totalQuantity,

    details:
      detailRows,

    summary:
      summary

  };

}


/************************************************************
 * TOPLU STOK KONTROLÜ
 *
 * Her çağrıda yalnızca tek ürün grubu döndürülür.
 * Yatak, Baza, Başlık ve Ayak birbirine karışmaz.
 ************************************************************/

function getBulkStock(
  productType,
  token
) {

  authorize_(
    token
  );

  const type =
    normalizeProductType_(
      productType
    );

  if (
    APP_CONFIG.PRODUCT_TYPES.indexOf(
      type
    ) === -1
  ) {

    throw new Error(
      "Geçerli bir ürün grubu seçilmelidir."
    );

  }

  const products =
    getAllProducts_()

      .filter(
        function (product) {

          return (
            isActiveValue_(
              product.active
            ) &&
            normalizeProductType_(
              product.type
            ) ===
            type
          );

        }
      )

      .sort(
        sortProducts_
      );

  const totalStock =
    products.reduce(
      function (total, product) {

        return (
          total +
          toNonNegativeInteger_(
            product.stock
          )
        );

      },
      0
    );

  return {

    success:
      true,

    type:
      type,

    productCount:
      products.length,

    totalStock:
      totalStock,

    products:
      products.map(
        function (product) {

          return {

            barcode:
              product.barcode,

            code:
              product.code,

            type:
              product.type,

            model:
              product.model,

            size:
              product.size,

            color:
              product.color,

            stock:
              toNonNegativeInteger_(
                product.stock
              ),

            critical:
              toNonNegativeInteger_(
                product.critical
              )

          };

        }
      )

  };

}


/************************************************************
 * TÜM TOPLU STOK GRUPLARININ ÖZETİ
 *
 * Ürün listelerini değil, grup toplamlarını döndürür.
 ************************************************************/

function getBulkStockSummary(
  token
) {

  authorize_(
    token
  );

  const products =
    getAllProducts_().filter(
      function (product) {

        return isActiveValue_(
          product.active
        );

      }
    );

  const summary = {

    yatak: {

      productCount:
        0,

      totalStock:
        0

    },

    baza: {

      productCount:
        0,

      totalStock:
        0

    },

    baslik: {

      productCount:
        0,

      totalStock:
        0

    },

    ayak: {

      productCount:
        0,

      totalStock:
        0

    }

  };

  products.forEach(
    function (product) {

      const key =
        productTypeKey_(
          product.type
        );

      if (!summary[key]) {

        return;

      }

      summary[key].productCount +=
        1;

      summary[key].totalStock +=
        toNonNegativeInteger_(
          product.stock
        );

    }
  );

  return {

    success:
      true,

    summary:
      summary

  };

}


/************************************************************
 * DASHBOARD
 ************************************************************/

function getDashboard(
  token
) {

  authorize_(
    token
  );

  const products =
    getAllProducts_().filter(
      function (product) {

        return isActiveValue_(
          product.active
        );

      }
    );

  const dashboard = {

    yatak:
      0,

    baza:
      0,

    baslik:
      0,

    ayak:
      0,

    totalProducts:
      products.length,

    totalStock:
      0,

    criticalCount:
      0,

    kritik:
      []

  };

  products.forEach(
    function (product) {

      const stock =
        toNonNegativeInteger_(
          product.stock
        );

      const critical =
        toNonNegativeInteger_(
          product.critical
        );

      const key =
        productTypeKey_(
          product.type
        );

      if (
        Object.prototype.hasOwnProperty.call(
          dashboard,
          key
        )
      ) {

        dashboard[key] +=
          stock;

      }

      dashboard.totalStock +=
        stock;

      if (stock <= critical) {

        dashboard.criticalCount +=
          1;

        dashboard.kritik.push({

          barkod:
            product.barcode,

          urunKodu:
            product.code,

          tur:
            product.type,

          model:
            product.model,

          olcu:
            product.size,

          renk:
            product.color,

          stok:
            stock,

          kritikStok:
            critical

        });

      }

    }
  );

  dashboard.kritik.sort(
    function (a, b) {

      const stockDifference =
        a.stok -
        b.stok;

      if (stockDifference !== 0) {

        return stockDifference;

      }

      return compareTurkish_(
        a.model,
        b.model
      );

    }
  );

  return dashboard;

}


/************************************************************
 * SON HAREKETLER
 ************************************************************/

function getRecentMovements(
  options,
  token
) {

  const session =
    authorize_(
      token
    );

  const filters =
    options || {};

  const requestedLimit =
    Number(
      filters.limit
    );

  const limit =
    Number.isFinite(
      requestedLimit
    )
      ? Math.min(
          Math.max(
            Math.floor(
              requestedLimit
            ),
            1
          ),
          500
        )
      : 50;

  let selectedPersonnel =
    cleanText_(
      filters.personnel
    );

  if (
    session.role !==
    APP_CONFIG.ROLES.ADMIN
  ) {

    selectedPersonnel =
      session.personnel;

  }

  const movements =
    getAllMovements_()

      .filter(
        function (movement) {

          if (
            selectedPersonnel &&
            normalizeForSearch_(
              movement.personnel
            ) !==
            normalizeForSearch_(
              selectedPersonnel
            )
          ) {

            return false;

          }

          return true;

        }
      )

      .sort(
        function (a, b) {

          return (
            b.date.getTime() -
            a.date.getTime()
          );

        }
      )

      .slice(
        0,
        limit
      );

  return movements.map(
    function (movement) {

      return {

        movementId:
          movement.sheetRow,

        undone:
          normalizeForSearch_(movement.description).indexOf("geri alindi") !== -1,

        date:
          movement.date.toISOString(),

        dateText:
          formatDateTime_(
            movement.date
          ),

        barcode:
          movement.barcode,

        code:
          movement.code,

        type:
          movement.type,

        model:
          movement.model,

        size:
          movement.size,

        color:
          movement.color,

        operation:
          movement.operation,

        quantity:
          movement.quantity,

        previousStock:
          movement.previousStock,

        newStock:
          movement.newStock,

        personnel:
          movement.personnel,

        source:
          movement.source,

        description:
          movement.description

      };

    }
  );

}



/************************************************************
 * YÖNETİCİ: HAREKETİ GERİ AL
 *
 * İşlem silinmez. Orijinal kayıt işaretlenir ve ters hareket
 * eklenir. Böylece denetim geçmişi korunur.
 ************************************************************/

function adminUndoMovement(
  movementId,
  token
) {

  const session =
    authorizeAdmin_(
      token
    );

  const rowNumber =
    Number(
      movementId
    );

  if (
    !Number.isInteger(rowNumber) ||
    rowNumber < 2
  ) {

    throw new Error(
      "Geçersiz hareket kaydı."
    );

  }

  const lock =
    LockService.getScriptLock();

  lock.waitLock(
    30000
  );

  try {

    const movementSheet =
      getSheet_(
        APP_CONFIG.SHEETS.MOVEMENTS
      );

    if (
      rowNumber > movementSheet.getLastRow()
    ) {

      throw new Error(
        "Hareket kaydı bulunamadı."
      );

    }

    const row =
      movementSheet
        .getRange(
          rowNumber,
          1,
          1,
          APP_CONFIG.MOVEMENT_HEADERS.length
        )
        .getValues()[0];

    const description =
      cleanText_(
        row[13]
      );

    if (
      normalizeForSearch_(description).indexOf("geri alindi") !== -1
    ) {

      throw new Error(
        "Bu işlem daha önce geri alınmış."
      );

    }

    const source =
      cleanText_(
        row[12]
      );

    if (
      normalizeForSearch_(source).indexOf("geri alma") !== -1
    ) {

      throw new Error(
        "Geri alma kaydı tekrar geri alınamaz."
      );

    }

    const barcode =
      normalizeBarcode_(
        row[1]
      );

    const product =
      findProductByBarcode_(
        barcode
      );

    if (!product) {

      throw new Error(
        "İşleme ait ürün bulunamadı."
      );

    }

    const previousStock =
      toNonNegativeInteger_(
        row[9]
      );

    const movementNewStock =
      toNonNegativeInteger_(
        row[10]
      );

    const stockDelta =
      movementNewStock - previousStock;

    if (stockDelta === 0) {

      throw new Error(
        "Bu hareket stok miktarını değiştirmediği için geri alınamaz."
      );

    }

    const currentStock =
      toNonNegativeInteger_(
        product.stock
      );

    const correctedStock =
      currentStock - stockDelta;

    if (correctedStock < 0) {

      throw new Error(
        "Geri alma işlemi stoğu negatife düşüreceği için uygulanamadı."
      );

    }

    const productsSheet =
      getSheet_(
        APP_CONFIG.SHEETS.PRODUCTS
      );

    productsSheet
      .getRange(
        product.rowNumber,
        7
      )
      .setValue(
        correctedStock
      );

    const undoDate =
      new Date();

    const undoNote =
      "[GERİ ALINDI: " +
      formatDateTime_(undoDate) +
      " - " +
      session.personnel +
      "]";

    movementSheet
      .getRange(
        rowNumber,
        14
      )
      .setValue(
        description
          ? description + " " + undoNote
          : undoNote
      );

    appendMovement_({

      product:
        Object.assign(
          {},
          product,
          {
            stock:
              correctedStock
          }
        ),

      operation:
        APP_CONFIG.OPERATIONS.ADJUSTMENT,

      quantity:
        Math.abs(
          stockDelta
        ),

      previousStock:
        currentStock,

      newStock:
        correctedStock,

      personnel:
        session.personnel,

      source:
        "Yönetici Geri Alma",

      description:
        "#" + rowNumber +
        " numaralı hareket geri alındı. Orijinal işlem: " +
        cleanText_(row[7]) +
        " " +
        (Number(row[8]) || 0) +
        " adet."

    });

    return {

      success:
        true,

      message:
        "İşlem başarıyla geri alındı.",

      barcode:
        barcode,

      previousStock:
        currentStock,

      newStock:
        correctedStock

    };

  } finally {

    lock.releaseLock();

  }

}


/************************************************************
 * YÖNETİCİ: PERSONEL LİSTESİ
 ************************************************************/

function adminGetPersonnel(
  token
) {

  authorizeAdmin_(
    token
  );

  const sheet =
    getSheet_(
      APP_CONFIG.SHEETS.PERSONNEL
    );

  const rows =
    getDataRows_(
      sheet,
      APP_CONFIG.PERSONNEL_HEADERS.length
    );

  return rows

    .filter(
      function (row) {

        return cleanText_(
          row[0]
        );

      }
    )

    .map(
      function (row, index) {

        return {

          rowNumber:
            index + 2,

          personnel:
            cleanText_(
              row[0]
            ),

          role:
            normalizeRole_(
              row[2]
            ),

          active:
            normalizeActiveValue_(
              row[3]
            ),

          updatedAt:
            row[4] instanceof Date
              ? row[4].toISOString()
              : cleanText_(row[4])

        };

      }
    )

    .sort(
      function (a, b) {

        return compareTurkish_(
          a.personnel,
          b.personnel
        );

      }
    );

}


/************************************************************
 * YÖNETİCİ: YENİ PERSONEL EKLE
 ************************************************************/

function adminAddPersonnel(
  personnelData,
  token
) {

  const adminSession =
    authorizeAdmin_(
      token
    );

  const data =
    personnelData || {};

  const personnel =
    cleanText_(
      data.personnel
    );

  const pin =
    normalizePin_(
      data.pin
    );

  const role =
    normalizeRole_(
      data.role
    );

  const active =
    normalizeActiveValue_(
      data.active
    );

  validatePersonnelData_(
    personnel,
    pin,
    role
  );

  const lock =
    LockService.getScriptLock();

  lock.waitLock(
    30000
  );

  try {

    if (
      findPersonnelByName_(
        personnel
      )
    ) {

      return {

        success:
          false,

        message:
          "Bu isimde bir personel zaten bulunmaktadır."

      };

    }

    const sheet =
      getSheet_(
        APP_CONFIG.SHEETS.PERSONNEL
      );

    sheet.appendRow([

      personnel,

      hashPin_(
        pin
      ),

      role,

      active,

      new Date()

    ]);

    return {

      success:
        true,

      message:
        personnel +
        " isimli personel eklendi.",

      createdBy:
        adminSession.personnel

    };

  } finally {

    lock.releaseLock();

  }

}


/************************************************************
 * YÖNETİCİ: PERSONEL BİLGİLERİNİ GÜNCELLE
 ************************************************************/

function adminUpdatePersonnel(
  personnelData,
  token
) {

  const adminSession =
    authorizeAdmin_(
      token
    );

  const data =
    personnelData || {};

  const originalPersonnel =
    cleanText_(
      data.originalPersonnel
    );

  const newPersonnel =
    cleanText_(
      data.personnel
    );

  const role =
    normalizeRole_(
      data.role
    );

  const active =
    normalizeActiveValue_(
      data.active
    );

  if (!originalPersonnel) {

    throw new Error(
      "Güncellenecek personel belirtilmelidir."
    );

  }

  if (!newPersonnel) {

    throw new Error(
      "Personel adı boş bırakılamaz."
    );

  }

  if (
    APP_CONFIG.ROLES.ADMIN !== role &&
    APP_CONFIG.ROLES.PERSONNEL !== role
  ) {

    throw new Error(
      "Geçerli bir yetki seçilmelidir."
    );

  }

  const lock =
    LockService.getScriptLock();

  lock.waitLock(
    30000
  );

  try {

    const record =
      findPersonnelByName_(
        originalPersonnel
      );

    if (!record) {

      throw new Error(
        "Personel kaydı bulunamadı."
      );

    }

    const duplicate =
      findPersonnelByName_(
        newPersonnel
      );

    if (
      duplicate &&
      duplicate.rowNumber !==
      record.rowNumber
    ) {

      throw new Error(
        "Bu isimde başka bir personel bulunmaktadır."
      );

    }

    if (
      normalizeForSearch_(
        originalPersonnel
      ) ===
      normalizeForSearch_(
        adminSession.personnel
      ) &&
      !isActiveValue_(
        active
      )
    ) {

      throw new Error(
        "Kendi yönetici hesabınızı pasif yapamazsınız."
      );

    }

    if (
      normalizeForSearch_(
        originalPersonnel
      ) ===
      normalizeForSearch_(
        adminSession.personnel
      ) &&
      role !==
      APP_CONFIG.ROLES.ADMIN
    ) {

      throw new Error(
        "Kendi yönetici yetkinizi kaldıramazsınız."
      );

    }

    const sheet =
      getSheet_(
        APP_CONFIG.SHEETS.PERSONNEL
      );

    sheet
      .getRange(
        record.rowNumber,
        1,
        1,
        5
      )
      .setValues([[

        newPersonnel,

        record.pinHash,

        role,

        active,

        new Date()

      ]]);

    return {

      success:
        true,

      message:
        "Personel bilgileri güncellendi."

    };

  } finally {

    lock.releaseLock();

  }

}


/************************************************************
 * YÖNETİCİ: PERSONEL PIN DEĞİŞTİR
 ************************************************************/

function adminChangePersonnelPin(
  personnelName,
  newPin,
  token
) {

  authorizeAdmin_(
    token
  );

  const personnel =
    cleanText_(
      personnelName
    );

  const pin =
    normalizePin_(
      newPin
    );

  if (!personnel) {

    throw new Error(
      "Personel belirtilmelidir."
    );

  }

  validatePin_(
    pin
  );

  const lock =
    LockService.getScriptLock();

  lock.waitLock(
    30000
  );

  try {

    const record =
      findPersonnelByName_(
        personnel
      );

    if (!record) {

      throw new Error(
        "Personel kaydı bulunamadı."
      );

    }

    const sheet =
      getSheet_(
        APP_CONFIG.SHEETS.PERSONNEL
      );

    sheet
      .getRange(
        record.rowNumber,
        2
      )
      .setValue(
        hashPin_(
          pin
        )
      );

    sheet
      .getRange(
        record.rowNumber,
        5
      )
      .setValue(
        new Date()
      );

    return {

      success:
        true,

      message:
        personnel +
        " isimli personelin PIN'i değiştirildi."

    };

  } finally {

    lock.releaseLock();

  }

}




/************************************************************
 * ACİL DURUM: PERSONEL PIN'İNİ ELLE SIFIRLA
 *
 * Apps Script editöründen bu fonksiyonu seçip çalıştırabilirsiniz.
 * Aşağıdaki örnek Cüneyt kullanıcısının PIN'ini 1234 yapar:
 *
 * resetPersonnelPinManually("Cüneyt", "1234");
 ************************************************************/

function resetPersonnelPinManually(
  personnelName,
  newPin
) {

  const personnel =
    cleanText_(
      personnelName
    );

  const pin =
    normalizePin_(
      newPin
    );

  if (!personnel) {

    throw new Error(
      "Personel adı girilmelidir."
    );

  }

  validatePin_(
    pin
  );

  const record =
    findPersonnelByName_(
      personnel
    );

  if (!record) {

    throw new Error(
      "Personel kaydı bulunamadı."
    );

  }

  const sheet =
    getSheet_(
      APP_CONFIG.SHEETS.PERSONNEL
    );

  sheet
    .getRange(
      record.rowNumber,
      2
    )
    .setValue(
      hashPin_(
        pin
      )
    );

  sheet
    .getRange(
      record.rowNumber,
      5
    )
    .setValue(
      new Date()
    );

  return {
    success: true,
    message:
      personnel +
      " isimli personelin PIN'i güncellendi."
  };

}


/************************************************************
 * TEK TIKLA CÜNEYT PIN'İNİ 1234 YAP
 ************************************************************/

function resetCuneytPinTo1234() {

  return resetPersonnelPinManually(
    "Cüneyt",
    "1234"
  );

}


/************************************************************
 * PERSONEL: KENDİ PIN'İNİ DEĞİŞTİR
 ************************************************************/

function changeOwnPin(
  oldPin,
  newPin,
  token
) {

  const session =
    authorize_(
      token
    );

  const oldCleanPin =
    normalizePin_(
      oldPin
    );

  const newCleanPin =
    normalizePin_(
      newPin
    );

  validatePin_(
    oldCleanPin
  );

  validatePin_(
    newCleanPin
  );

  const record =
    findPersonnelByName_(
      session.personnel
    );

  if (!record) {

    throw new Error(
      "Personel kaydı bulunamadı."
    );

  }

  if (
    record.pinHash !==
    hashPin_(
      oldCleanPin
    )
  ) {

    throw new Error(
      "Mevcut PIN hatalıdır."
    );

  }

  const sheet =
    getSheet_(
      APP_CONFIG.SHEETS.PERSONNEL
    );

  sheet
    .getRange(
      record.rowNumber,
      2
    )
    .setValue(
      hashPin_(
        newCleanPin
      )
    );

  sheet
    .getRange(
      record.rowNumber,
      5
    )
    .setValue(
      new Date()
    );

  return {

    success:
      true,

    message:
      "PIN başarıyla değiştirildi."

  };

}


/************************************************************
 * YÖNETİCİ: STOK DÜZELTME
 *
 * Girilen değer ürünün yeni toplam stoku olur.
 ************************************************************/

function adminAdjustStock(
  barcode,
  newStockValue,
  description,
  token
) {

  const session =
    authorizeAdmin_(
      token
    );

  const cleanBarcode =
    normalizeBarcode_(
      barcode
    );

  const newStock =
    toNonNegativeIntegerStrict_(
      newStockValue,
      "Yeni stok"
    );

  const cleanDescription =
    cleanText_(
      description
    );

  if (!cleanBarcode) {

    throw new Error(
      "Barkod girilmelidir."
    );

  }

  if (!cleanDescription) {

    throw new Error(
      "Stok düzeltme açıklaması girilmelidir."
    );

  }

  const lock =
    LockService.getScriptLock();

  lock.waitLock(
    30000
  );

  try {

    const product =
      findProductByBarcode_(
        cleanBarcode
      );

    if (!product) {

      throw new Error(
        "Ürün bulunamadı."
      );

    }

    const previousStock =
      toNonNegativeInteger_(
        product.stock
      );

    const sheet =
      getSheet_(
        APP_CONFIG.SHEETS.PRODUCTS
      );

    sheet
      .getRange(
        product.rowNumber,
        7
      )
      .setValue(
        newStock
      );

    const updatedProduct =
      Object.assign(
        {},
        product,
        {

          stock:
            newStock

        }
      );

    appendMovement_({

      product:
        updatedProduct,

      operation:
        APP_CONFIG.OPERATIONS.ADJUSTMENT,

      quantity:
        newStock -
        previousStock,

      previousStock:
        previousStock,

      newStock:
        newStock,

      personnel:
        session.personnel,

      source:
        APP_CONFIG.SOURCES.ADMIN,

      description:
        cleanDescription

    });

    return {

      success:
        true,

      message:
        "Stok düzeltme işlemi kaydedildi.",

      previousStock:
        previousStock,

      newStock:
        newStock,

      product:
        productToClient_(
          updatedProduct
        )

    };

  } finally {

    lock.releaseLock();

  }

}


/************************************************************
 * YÖNETİCİ: ÜRÜN AKTİF/PASİF DURUMU
 ************************************************************/

function adminSetProductStatus(
  barcode,
  activeValue,
  token
) {

  authorizeAdmin_(
    token
  );

  const cleanBarcode =
    normalizeBarcode_(
      barcode
    );

  const active =
    normalizeActiveValue_(
      activeValue
    );

  const product =
    findProductByBarcode_(
      cleanBarcode
    );

  if (!product) {

    throw new Error(
      "Ürün bulunamadı."
    );

  }

  const sheet =
    getSheet_(
      APP_CONFIG.SHEETS.PRODUCTS
    );

  sheet
    .getRange(
      product.rowNumber,
      9
    )
    .setValue(
      active
    );

  ensureCategoryStockSheets_();

  return {

    success:
      true,

    message:
      "Ürün durumu güncellendi.",

    active:
      active

  };

}


/************************************************************
 * HAREKET KAYDI EKLE
 ************************************************************/

function appendMovement_(
  data
) {

  const product =
    data.product;

  if (!product) {

    throw new Error(
      "Hareket kaydı için ürün bilgisi bulunamadı."
    );

  }

  const sheet =
    getSheet_(
      APP_CONFIG.SHEETS.MOVEMENTS
    );

  sheet.appendRow([

    new Date(),

    product.barcode,

    product.code,

    product.type,

    product.model,

    product.size,

    product.color,

    data.operation,

    Number(
      data.quantity
    ) || 0,

    toNonNegativeInteger_(
      data.previousStock
    ),

    toNonNegativeInteger_(
      data.newStock
    ),

    cleanText_(
      data.personnel
    ),

    cleanText_(
      data.source
    ),

    cleanText_(
      data.description
    )

  ]);

  ensureCategoryStockSheets_();

}


/************************************************************
 * OTURUM YETKİ KONTROLÜ
 ************************************************************/

function saveStoreDocument(documentData, token) {
  const session = authorize_(token);
  const data = documentData && typeof documentData === "object" ? documentData : {};
  const types = { TEKLIF: "Teklif", SATIS: "Satış", TESLIMAT: "Teslimat" };
  const typeKey = cleanText_(data.type).toUpperCase();
  if (!types[typeKey]) throw new Error("Geçerli bir belge türü seçiniz.");

  const customerName = cleanText_(data.customerName);
  if (!customerName) throw new Error("Müşteri adı girilmelidir.");

  const items = (Array.isArray(data.items) ? data.items : []).slice(0, 50).map(function (item) {
    return {
      code: cleanText_(item && item.code).slice(0, 80),
      description: cleanText_(item && item.description).slice(0, 250),
      size: cleanText_(item && item.size).slice(0, 100),
      color: cleanText_(item && item.color).slice(0, 120),
      quantity: Math.max(1, toNonNegativeInteger_(item && item.quantity)),
      unitPrice: Math.max(0, Number(item && item.unitPrice) || 0)
    };
  }).filter(function (item) { return Boolean(item.description); });

  if (!items.length) throw new Error("Belgeye en az bir ürün ekleyiniz.");

  const total = items.reduce(function (sum, item) {
    return sum + item.quantity * item.unitPrice;
  }, 0);
  const now = new Date();
  const prefixes = { TEKLIF: "TKL", SATIS: "SAT", TESLIMAT: "TES" };
  const documentNumber = prefixes[typeKey] + "-" +
    Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd-HHmmss") + "-" +
    Utilities.getUuid().replace(/-/g, "").slice(0, 4).toUpperCase();

  const savedDocument = {
    documentNumber: documentNumber,
    type: typeKey,
    typeLabel: types[typeKey],
    date: now.toISOString(),
    displayDate: Utilities.formatDate(now, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm"),
    customerName: customerName,
    phone: cleanText_(data.phone).slice(0, 50),
    orderReference: cleanText_(data.orderReference).slice(0, 80),
    taxId: cleanText_(data.taxId).slice(0, 30),
    address: cleanText_(data.address).slice(0, 500),
    notes: cleanText_(data.notes).slice(0, 1000),
    payment: cleanText_(data.payment).slice(0, 250),
    paidAmount: Math.max(0, Number(data.paidAmount) || 0),
    balance: Math.max(0, total - (Number(data.paidAmount) || 0)),
    deliveryMethod: cleanText_(data.deliveryMethod).slice(0, 250),
    deliveryDate: cleanText_(data.deliveryDate).slice(0, 50),
    items: items,
    total: total,
    personnel: session.personnel,
    status: "Aktif"
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ensureDocumentsSheet_();
    sheet.appendRow([
      savedDocument.documentNumber, savedDocument.typeLabel, now,
      savedDocument.customerName, savedDocument.phone, savedDocument.address,
      savedDocument.total, savedDocument.personnel, savedDocument.status,
      JSON.stringify(savedDocument)
    ]);
  } finally {
    lock.releaseLock();
  }

  return {
    success: true,
    message: savedDocument.typeLabel + " belgesi kaydedildi.",
    document: savedDocument
  };
}


function listStoreDocuments(filters, token) {
  authorize_(token);
  const sheet = ensureDocumentsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const cleanFilters = filters && typeof filters === "object" ? filters : {};
  const query = cleanText_(cleanFilters.query).toLocaleLowerCase("tr-TR");
  const type = cleanText_(cleanFilters.type).toLocaleLowerCase("tr-TR");

  return sheet.getRange(2, 1, lastRow - 1, APP_CONFIG.DOCUMENT_HEADERS.length)
    .getValues()
    .map(function (row) {
      return {
        documentNumber: cleanText_(row[0]),
        typeLabel: cleanText_(row[1]),
        date: row[2] instanceof Date
          ? Utilities.formatDate(row[2], Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm")
          : cleanText_(row[2]),
        customerName: cleanText_(row[3]),
        phone: cleanText_(row[4]),
        total: Number(row[6]) || 0,
        personnel: cleanText_(row[7]),
        status: cleanText_(row[8])
      };
    })
    .filter(function (record) {
      const searchable = (
        record.documentNumber + " " + record.customerName + " " +
        record.phone + " " + record.personnel
      ).toLocaleLowerCase("tr-TR");
      return (!query || searchable.indexOf(query) >= 0) &&
        (!type || record.typeLabel.toLocaleLowerCase("tr-TR") === type);
    })
    .reverse()
    .slice(0, 300);
}


function getStoreDocument(documentNumber, token) {
  authorize_(token);
  const cleanNumber = cleanText_(documentNumber);
  const sheet = ensureDocumentsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error("Belge bulunamadı.");

  const rows = sheet.getRange(2, 1, lastRow - 1, APP_CONFIG.DOCUMENT_HEADERS.length).getValues();
  for (let index = 0; index < rows.length; index += 1) {
    if (cleanText_(rows[index][0]) === cleanNumber) {
      try {
        return JSON.parse(cleanText_(rows[index][9]));
      } catch (parseError) {
        throw new Error("Belge içeriği okunamadı.");
      }
    }
  }
  throw new Error("Belge bulunamadı.");
}


function ensureDocumentsSheet_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = ensureSheet_(
    spreadsheet,
    APP_CONFIG.SHEETS.DOCUMENTS,
    APP_CONFIG.DOCUMENT_HEADERS
  );
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
  sheet.setTabColor("#4f7c86");
  sheet.getRange(1, 1, 1, APP_CONFIG.DOCUMENT_HEADERS.length)
    .setBackground("#dfeaec")
    .setFontColor("#28474e")
    .setFontWeight("bold");
  sheet.hideColumns(10);
  return sheet;
}


function authorize_(
  token
) {

  const cleanToken =
    cleanText_(
      token
    );

  if (!cleanToken) {

    throw new Error(
      "Oturum bulunamadı. Lütfen yeniden giriş yapınız."
    );

  }

  const cache =
    CacheService.getScriptCache();

  const key =
    APP_CONFIG.SESSION_PREFIX +
    cleanToken;

  const rawSession =
    cache.get(
      key
    );

  if (!rawSession) {

    throw new Error(
      "Oturum süresi doldu. Lütfen yeniden giriş yapınız."
    );

  }

  let session;

  try {

    session =
      JSON.parse(
        rawSession
      );

  } catch (error) {

    cache.remove(
      key
    );

    throw new Error(
      "Oturum bilgisi geçersizdir. Lütfen yeniden giriş yapınız."
    );

  }

  const personnel =
    findPersonnelByName_(
      session.personnel
    );

  if (
    !personnel ||
    !isActiveValue_(
      personnel.active
    )
  ) {

    cache.remove(
      key
    );

    throw new Error(
      "Personel hesabı aktif değildir."
    );

  }

  session.role =
    personnel.role;

  cache.put(
    key,
    JSON.stringify(
      session
    ),
    APP_CONFIG.SESSION_DURATION_SECONDS
  );

  return session;

}


/************************************************************
 * YÖNETİCİ YETKİ KONTROLÜ
 ************************************************************/

function authorizeAdmin_(
  token
) {

  const session =
    authorize_(
      token
    );

  if (
    session.role !==
    APP_CONFIG.ROLES.ADMIN
  ) {

    throw new Error(
      "Bu işlem yalnızca yönetici tarafından yapılabilir."
    );

  }

  return session;

}


/************************************************************
 * GOOGLE E-TABLO DOSYASINI AL
 ************************************************************/

/**
 * Yatak, baza, ayak ve başlık stoklarını Google E-Tablo üzerinde
 * ayrı ve canlı sekmelerde gösterir.
 *
 * Bu sayfalar Urunler tablosundan QUERY formülüyle beslenir.
 * Böylece uygulamadaki her stok hareketi kategori sekmelerine de
 * anında yansır ve aynı stok iki farklı yerde bağımsız tutulmaz.
 */
function ensureCategoryStockSheets_() {

  const spreadsheet =
    getSpreadsheet_();

  const sourceSheet =
    spreadsheet.getSheetByName(
      APP_CONFIG.SHEETS.PRODUCTS
    );

  if (!sourceSheet) {

    throw new Error(
      "Urunler sayfası bulunamadı."
    );

  }

  const sourceRowCount =
    sourceSheet.getLastRow();

  const sourceRows =
    sourceRowCount > 1
      ? sourceSheet
          .getRange(
            2,
            1,
            sourceRowCount - 1,
            APP_CONFIG.PRODUCT_HEADERS.length
          )
          .getValues()
      : [];

  APP_CONFIG.CATEGORY_STOCK_SHEETS.forEach(
    function (categoryConfig) {

      let categorySheet =
        spreadsheet.getSheetByName(
          categoryConfig.sheetName
        );

      if (!categorySheet) {

        categorySheet =
          spreadsheet.insertSheet(
            categoryConfig.sheetName
          );

      }

      const categoryRows =
        sourceRows.filter(
          function (row) {

            return normalizeProductType_(
              row[2]
            ) ===
            categoryConfig.type;

          }
        );

      categorySheet.getBandings().forEach(
        function (banding) {

          banding.remove();

        }
      );

      categorySheet
        .getRange(
          1,
          1,
          2,
          APP_CONFIG.PRODUCT_HEADERS.length
        )
        .breakApart();

      categorySheet.clear();

      categorySheet
        .getRange(
          1,
          1,
          1,
          APP_CONFIG.PRODUCT_HEADERS.length
        )
        .merge()
        .setValue(
          categoryConfig.type.toUpperCase() +
          " STOK LİSTESİ"
        )
        .setBackground(
          "#315b66"
        )
        .setFontColor(
          "#ffffff"
        )
        .setFontSize(
          16
        )
        .setFontWeight(
          "bold"
        )
        .setHorizontalAlignment(
          "left"
        );

      categorySheet
        .getRange(
          2,
          1,
          1,
          APP_CONFIG.PRODUCT_HEADERS.length
        )
        .merge()
        .setValue(
          categoryRows.length +
          " ürün çeşidi • Toplam stok: " +
          categoryRows.reduce(
            function (total, row) {

              return total +
                toNonNegativeInteger_(
                  row[6]
                );

            },
            0
          ) +
          " • Son güncelleme: " +
          Utilities.formatDate(
            new Date(),
            Session.getScriptTimeZone(),
            "dd.MM.yyyy HH:mm"
          )
        )
        .setBackground(
          "#eef4f5"
        )
        .setFontColor(
          "#45636a"
        )
        .setFontSize(
          10
        );

      categorySheet
        .getRange(
          4,
          1,
          1,
          APP_CONFIG.PRODUCT_HEADERS.length
        )
        .setValues([
          APP_CONFIG.PRODUCT_HEADERS
        ]);

      if (categoryRows.length) {

        categorySheet
          .getRange(
            5,
            1,
            categoryRows.length,
            APP_CONFIG.PRODUCT_HEADERS.length
          )
          .setValues(
            categoryRows
          );

      }

      categorySheet.setFrozenRows(
        4
      );

      categorySheet
        .getRange(
          4,
          1,
          1,
          APP_CONFIG.PRODUCT_HEADERS.length
        )
        .setBackground(
          "#dfeaec"
        )
        .setFontColor(
          "#28474e"
        )
        .setFontWeight(
          "bold"
        )
        .setHorizontalAlignment(
          "center"
        );

      categorySheet.setHiddenGridlines(
        true
      );

      categorySheet.setTabColor(
        "#5f8f98"
      );

      if (categoryRows.length) {

        const dataRange =
          categorySheet.getRange(
            5,
            1,
            categoryRows.length,
            APP_CONFIG.PRODUCT_HEADERS.length
          );

        dataRange
          .setVerticalAlignment(
            "middle"
          )
          .setFontSize(
            10
          );

        dataRange
          .applyRowBanding(
            SpreadsheetApp.BandingTheme.LIGHT_GREY
          );

        categorySheet
          .getRange(
            5,
            7,
            categoryRows.length,
            2
          )
          .setNumberFormat(
            "0"
          )
          .setHorizontalAlignment(
            "center"
          )
          .setFontWeight(
            "bold"
          );

        const stockRange =
          categorySheet.getRange(
            5,
            7,
            categoryRows.length,
            1
          );

        categorySheet.setConditionalFormatRules([
          SpreadsheetApp
            .newConditionalFormatRule()
            .whenNumberEqualTo(
              0
            )
            .setBackground(
              "#fde8e8"
            )
            .setFontColor(
              "#b42318"
            )
            .setBold(
              true
            )
            .setRanges([
              stockRange
            ])
            .build(),
          SpreadsheetApp
            .newConditionalFormatRule()
            .whenFormulaSatisfied(
              "=$G5<=$H5"
            )
            .setBackground(
              "#fff3cd"
            )
            .setFontColor(
              "#8a5a00"
            )
            .setRanges([
              stockRange
            ])
            .build(),
          SpreadsheetApp
            .newConditionalFormatRule()
            .whenFormulaSatisfied(
              "=$G5>$H5"
            )
            .setBackground(
              "#e7f6ec"
            )
            .setFontColor(
              "#137333"
            )
            .setRanges([
              stockRange
            ])
            .build()
        ]);

      } else {

        categorySheet.setConditionalFormatRules(
          []
        );

      }

      categorySheet.setRowHeight(
        1,
        36
      );
      categorySheet.setRowHeight(
        2,
        28
      );
      categorySheet.setRowHeight(
        4,
        32
      );

      categorySheet.setColumnWidth(
        1,
        150
      );
      categorySheet.setColumnWidth(
        2,
        120
      );
      categorySheet.setColumnWidth(
        3,
        100
      );
      categorySheet.setColumnWidth(
        4,
        220
      );
      categorySheet.setColumnWidth(
        5,
        110
      );
      categorySheet.setColumnWidth(
        6,
        120
      );
      categorySheet.setColumnWidth(
        7,
        90
      );
      categorySheet.setColumnWidth(
        8,
        100
      );
      categorySheet.setColumnWidth(
        9,
        80
      );

    }
  );

  refreshStockSummarySheet_(
    spreadsheet,
    sourceRows
  );

  formatCoreSheets_(
    spreadsheet
  );

}


function refreshStockSummarySheet_(
  spreadsheet,
  sourceRows
) {

  let summarySheet =
    spreadsheet.getSheetByName(
      APP_CONFIG.SHEETS.STOCK_SUMMARY
    );

  if (!summarySheet) {

    summarySheet =
      spreadsheet.insertSheet(
        APP_CONFIG.SHEETS.STOCK_SUMMARY
      );

  }

  const summaryRows =
    APP_CONFIG.CATEGORY_STOCK_SHEETS.map(
      function (categoryConfig) {

        const categoryRows =
          sourceRows.filter(
            function (row) {

              return normalizeProductType_(
                row[2]
              ) ===
              categoryConfig.type;

            }
          );

        const totalStock =
          categoryRows.reduce(
            function (total, row) {

              return total +
                toNonNegativeInteger_(
                  row[6]
                );

            },
            0
          );

        const criticalCount =
          categoryRows.filter(
            function (row) {

              const stock =
                toNonNegativeInteger_(
                  row[6]
                );

              const critical =
                toNonNegativeInteger_(
                  row[7]
                );

              return stock > 0 &&
                stock <= critical;

            }
          ).length;

        const outOfStockCount =
          categoryRows.filter(
            function (row) {

              return toNonNegativeInteger_(
                row[6]
              ) === 0;

            }
          ).length;

        return [
          categoryConfig.type,
          categoryRows.length,
          totalStock,
          criticalCount,
          outOfStockCount
        ];

      }
    );

  summarySheet.getBandings().forEach(
    function (banding) {

      banding.remove();

    }
  );

  summarySheet
    .getRange(
      "A1:E2"
    )
    .breakApart();

  summarySheet.clear();
  summarySheet.setHiddenGridlines(
    true
  );
  summarySheet.setTabColor(
    "#315b66"
  );
  summarySheet.setFrozenRows(
    5
  );

  summarySheet
    .getRange(
      "A1:E1"
    )
    .merge()
    .setValue(
      "HOCA MOBİLYA • STOK ÖZETİ"
    )
    .setBackground(
      "#315b66"
    )
    .setFontColor(
      "#ffffff"
    )
    .setFontSize(
      18
    )
    .setFontWeight(
      "bold"
    );

  summarySheet
    .getRange(
      "A2:E2"
    )
    .merge()
    .setValue(
      "Son güncelleme: " +
      Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        "dd.MM.yyyy HH:mm"
      )
    )
    .setBackground(
      "#eef4f5"
    )
    .setFontColor(
      "#45636a"
    );

  summarySheet
    .getRange(
      5,
      1,
      1,
      5
    )
    .setValues([[
      "Kategori",
      "Ürün Çeşidi",
      "Toplam Stok",
      "Kritik Ürün",
      "Tükenen Ürün"
    ]])
    .setBackground(
      "#dfeaec"
    )
    .setFontColor(
      "#28474e"
    )
    .setFontWeight(
      "bold"
    )
    .setHorizontalAlignment(
      "center"
    );

  summarySheet
    .getRange(
      6,
      1,
      summaryRows.length,
      5
    )
    .setValues(
      summaryRows
    )
    .setVerticalAlignment(
      "middle"
    );

  summarySheet
    .getRange(
      6,
      2,
      summaryRows.length,
      4
    )
    .setNumberFormat(
      "0"
    )
    .setHorizontalAlignment(
      "center"
    )
    .setFontWeight(
      "bold"
    );

  summarySheet
    .getRange(
      6,
      1,
      summaryRows.length,
      5
    )
    .applyRowBanding(
      SpreadsheetApp.BandingTheme.LIGHT_GREY
    );

  summarySheet.setColumnWidth(
    1,
    180
  );
  summarySheet.setColumnWidths(
    2,
    4,
    125
  );
  summarySheet.setRowHeight(
    1,
    42
  );
  summarySheet.setRowHeight(
    2,
    28
  );
  summarySheet.setRowHeight(
    5,
    34
  );

}


function formatCoreSheets_(
  spreadsheet
) {

  const designVersion =
    "SHEETS_DESIGN_V2_SOFT";

  const properties =
    PropertiesService.getScriptProperties();

  if (
    properties.getProperty(
      "HOCA_SHEETS_DESIGN_VERSION"
    ) === designVersion
  ) {

    return;

  }

  const sheetStyles = [
    {
      name: APP_CONFIG.SHEETS.PRODUCTS,
      tabColor: "#4f7c86",
      widths: [150, 120, 100, 220, 110, 120, 90, 100, 80]
    },
    {
      name: APP_CONFIG.SHEETS.MOVEMENTS,
      tabColor: "#6f8796",
      widths: [145, 145, 115, 95, 210, 105, 110, 105, 80, 100, 100, 125, 155, 260]
    },
    {
      name: APP_CONFIG.SHEETS.PERSONNEL,
      tabColor: "#7a6f9b",
      widths: [180, 220, 110, 90, 155]
    },
    {
      name: APP_CONFIG.SHEETS.BATCH_TRANSACTIONS,
      tabColor: "#9a7a57",
      widths: [210, 150, 150, 135, 115, 100, 100, 210, 250, 250]
    },
    {
      name: APP_CONFIG.SHEETS.DOCUMENTS,
      tabColor: "#4f7c86",
      widths: [190, 100, 145, 180, 125, 250, 110, 135, 90, 250]
    }
  ];

  sheetStyles.forEach(
    function (style) {

      const sheet =
        spreadsheet.getSheetByName(
          style.name
        );

      if (!sheet) {

        return;

      }

      const lastRow =
        Math.max(
          sheet.getLastRow(),
          1
        );

      const lastColumn =
        Math.max(
          sheet.getLastColumn(),
          style.widths.length
        );

      sheet.setHiddenGridlines(
        true
      );
      sheet.setFrozenRows(
        1
      );
      sheet.setTabColor(
        style.tabColor
      );

      sheet
        .getRange(
          1,
          1,
          1,
          lastColumn
        )
        .setBackground(
          "#dfeaec"
        )
        .setFontColor(
          "#28474e"
        )
        .setFontWeight(
          "bold"
        )
        .setFontSize(
          10
        )
        .setHorizontalAlignment(
          "center"
        )
        .setVerticalAlignment(
          "middle"
        );

      sheet.setRowHeight(
        1,
        34
      );

      sheet.getBandings().forEach(
        function (banding) {

          banding.remove();

        }
      );

      if (lastRow > 1) {

        sheet
          .getRange(
            2,
            1,
            lastRow - 1,
            lastColumn
          )
          .setFontColor(
            "#334155"
          )
          .setFontSize(
            10
          )
          .setVerticalAlignment(
            "middle"
          )
          .applyRowBanding(
            SpreadsheetApp.BandingTheme.LIGHT_GREY
          );

      }

      style.widths.forEach(
        function (width, index) {

          sheet.setColumnWidth(
            index + 1,
            width
          );

        }
      );

      if (
        !sheet.getFilter() &&
        lastRow > 1
      ) {

        sheet
          .getRange(
            1,
            1,
            lastRow,
            lastColumn
          )
          .createFilter();

      }

    }
  );

  const productsSheet =
    spreadsheet.getSheetByName(
      APP_CONFIG.SHEETS.PRODUCTS
    );

  if (
    productsSheet &&
    productsSheet.getLastRow() > 1
  ) {

    productsSheet
      .getRange(
        2,
        7,
        productsSheet.getLastRow() - 1,
        2
      )
      .setNumberFormat(
        "0"
      )
      .setHorizontalAlignment(
        "center"
      )
      .setFontWeight(
        "bold"
      );

  }

  const movementsSheet =
    spreadsheet.getSheetByName(
      APP_CONFIG.SHEETS.MOVEMENTS
    );

  if (
    movementsSheet &&
    movementsSheet.getLastRow() > 1
  ) {

    movementsSheet
      .getRange(
        2,
        1,
        movementsSheet.getLastRow() - 1,
        1
      )
      .setNumberFormat(
        "dd.MM.yyyy HH:mm"
      );

  }

  const personnelSheet =
    spreadsheet.getSheetByName(
      APP_CONFIG.SHEETS.PERSONNEL
    );

  if (personnelSheet) {

    personnelSheet.hideColumns(
      2
    );

  }

  properties.setProperty(
    "HOCA_SHEETS_DESIGN_VERSION",
    designVersion
  );

}


function getSpreadsheet_() {

  const spreadsheetId =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        APP_CONFIG.SPREADSHEET_ID_PROPERTY
      );

  if (spreadsheetId) {

    return SpreadsheetApp.openById(
      spreadsheetId
    );

  }

  const activeSpreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  if (activeSpreadsheet) {

    return activeSpreadsheet;

  }

  throw new Error(
    "Google E-Tablo bağlantısı bulunamadı. setupSystem fonksiyonunu çalıştırınız."
  );

}


/************************************************************
 * SAYFAYI AL
 ************************************************************/

function getSheet_(
  sheetName
) {

  const spreadsheet =
    getSpreadsheet_();

  const sheet =
    spreadsheet.getSheetByName(
      sheetName
    );

  if (!sheet) {

    throw new Error(
      sheetName +
      " sayfası bulunamadı. setupSystem fonksiyonunu çalıştırınız."
    );

  }

  return sheet;

}


/************************************************************
 * SAYFA OLUŞTUR VE BAŞLIKLARI HAZIRLA
 ************************************************************/

function ensureSheet_(
  spreadsheet,
  sheetName,
  headers
) {

  let sheet =
    spreadsheet.getSheetByName(
      sheetName
    );

  if (!sheet) {

    sheet =
      spreadsheet.insertSheet(
        sheetName
      );

  }

  if (
    sheet.getMaxColumns() <
    headers.length
  ) {

    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headers.length -
      sheet.getMaxColumns()
    );

  }

  sheet
    .getRange(
      1,
      1,
      1,
      headers.length
    )
    .setValues([
      headers
    ]);

  return sheet;

}


/************************************************************
 * PERSONELLER SAYFASINI HAZIRLA VE ESKİ YAPIYI DÖNÜŞTÜR
 ************************************************************/

function ensurePersonnelSheet_(
  spreadsheet
) {

  let sheet =
    spreadsheet.getSheetByName(
      APP_CONFIG.SHEETS.PERSONNEL
    );

  if (!sheet) {

    sheet =
      spreadsheet.insertSheet(
        APP_CONFIG.SHEETS.PERSONNEL
      );

  }

  const existingData =
    sheet.getLastRow() > 0
      ? sheet
          .getDataRange()
          .getValues()
      : [];

  const existingHeaders =
    existingData.length
      ? existingData[0].map(
          cleanText_
        )
      : [];

  const nameIndex =
    findHeaderIndex_(
      existingHeaders,
      [
        "Personel"
      ]
    );

  const pinHashIndex =
    findHeaderIndex_(
      existingHeaders,
      [
        "PIN Hash",
        "Pin Hash"
      ]
    );

  const pinIndex =
    findHeaderIndex_(
      existingHeaders,
      [
        "PIN",
        "Pin"
      ]
    );

  const roleIndex =
    findHeaderIndex_(
      existingHeaders,
      [
        "Yetki",
        "Rol"
      ]
    );

  const activeIndex =
    findHeaderIndex_(
      existingHeaders,
      [
        "Aktif",
        "Durum"
      ]
    );

  const updatedIndex =
    findHeaderIndex_(
      existingHeaders,
      [
        "Son Guncelleme",
        "Son Güncelleme"
      ]
    );

  const personnelRows =
    [];

  for (
    let rowIndex = 1;
    rowIndex < existingData.length;
    rowIndex++
  ) {

    const oldRow =
      existingData[rowIndex];

    const personnel =
      nameIndex >= 0
        ? cleanText_(
            oldRow[nameIndex]
          )
        : cleanText_(
            oldRow[0]
          );

    if (!personnel) {

      continue;

    }

    let pinHash =
      "";

    if (
      pinHashIndex >= 0 &&
      cleanText_(
        oldRow[pinHashIndex]
      )
    ) {

      pinHash =
        cleanText_(
          oldRow[pinHashIndex]
        );

    } else if (
      pinIndex >= 0 &&
      cleanText_(
        oldRow[pinIndex]
      )
    ) {

      pinHash =
        hashPin_(
          normalizePin_(
            oldRow[pinIndex]
          )
        );

    } else {

      pinHash =
        hashPin_(
          "1234"
        );

    }

    let role =
      roleIndex >= 0
        ? normalizeRole_(
            oldRow[roleIndex]
          )
        : APP_CONFIG.ROLES.PERSONNEL;

    const active =
      activeIndex >= 0
        ? normalizeActiveValue_(
            oldRow[activeIndex]
          )
        : APP_CONFIG.STATUS.ACTIVE;

    const updatedAt =
      updatedIndex >= 0 &&
      oldRow[updatedIndex]
        ? oldRow[updatedIndex]
        : new Date();

    personnelRows.push([

      personnel,

      pinHash,

      role,

      active,

      updatedAt

    ]);

  }

  if (
    personnelRows.length === 0
  ) {

    personnelRows.push([

      "Cüneyt",

      hashPin_(
        "1234"
      ),

      APP_CONFIG.ROLES.ADMIN,

      APP_CONFIG.STATUS.ACTIVE,

      new Date()

    ]);

  }

  const hasAdmin =
    personnelRows.some(
      function (row) {

        return (
          normalizeRole_(
            row[2]
          ) ===
          APP_CONFIG.ROLES.ADMIN
        );

      }
    );

  if (!hasAdmin) {

    personnelRows[0][2] =
      APP_CONFIG.ROLES.ADMIN;

  }

  if (
    sheet.getMaxColumns() <
    APP_CONFIG.PERSONNEL_HEADERS.length
  ) {

    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      APP_CONFIG.PERSONNEL_HEADERS.length -
      sheet.getMaxColumns()
    );

  }

  sheet.clearContents();

  sheet
    .getRange(
      1,
      1,
      1,
      APP_CONFIG.PERSONNEL_HEADERS.length
    )
    .setValues([
      APP_CONFIG.PERSONNEL_HEADERS
    ]);

  if (personnelRows.length) {

    sheet
      .getRange(
        2,
        1,
        personnelRows.length,
        APP_CONFIG.PERSONNEL_HEADERS.length
      )
      .setValues(
        personnelRows
      );

  }

  return sheet;

}


/************************************************************
 * ÜRÜNLER SAYFASI BİÇİMLENDİRME
 ************************************************************/

function formatProductsSheet_(
  sheet
) {

  sheet.setFrozenRows(
    1
  );

  sheet
    .getRange(
      1,
      1,
      1,
      APP_CONFIG.PRODUCT_HEADERS.length
    )
    .setFontWeight(
      "bold"
    )
    .setBackground(
      "#f47c20"
    )
    .setFontColor(
      "#ffffff"
    )
    .setHorizontalAlignment(
      "center"
    );

  sheet.setColumnWidth(
    1,
    160
  );

  sheet.setColumnWidth(
    2,
    120
  );

  sheet.setColumnWidth(
    3,
    100
  );

  sheet.setColumnWidth(
    4,
    180
  );

  sheet.setColumnWidth(
    5,
    100
  );

  sheet.setColumnWidth(
    6,
    120
  );

  sheet.setColumnWidth(
    7,
    80
  );

  sheet.setColumnWidth(
    8,
    95
  );

  sheet.setColumnWidth(
    9,
    80
  );

  if (
    sheet.getMaxRows() > 1
  ) {

    sheet
      .getRange(
        2,
        1,
        sheet.getMaxRows() - 1,
        2
      )
      .setNumberFormat(
        "@"
      );

    sheet
      .getRange(
        2,
        7,
        sheet.getMaxRows() - 1,
        2
      )
      .setNumberFormat(
        "0"
      );

  }

}


/************************************************************
 * HAREKETLER SAYFASI BİÇİMLENDİRME
 ************************************************************/

function formatMovementsSheet_(
  sheet
) {

  sheet.setFrozenRows(
    1
  );

  sheet
    .getRange(
      1,
      1,
      1,
      APP_CONFIG.MOVEMENT_HEADERS.length
    )
    .setFontWeight(
      "bold"
    )
    .setBackground(
      "#2f3542"
    )
    .setFontColor(
      "#ffffff"
    )
    .setHorizontalAlignment(
      "center"
    );

  sheet.setColumnWidth(
    1,
    160
  );

  sheet.setColumnWidth(
    2,
    150
  );

  sheet.setColumnWidth(
    3,
    120
  );

  sheet.setColumnWidth(
    4,
    100
  );

  sheet.setColumnWidth(
    5,
    180
  );

  sheet.setColumnWidth(
    6,
    100
  );

  sheet.setColumnWidth(
    7,
    110
  );

  sheet.setColumnWidth(
    8,
    110
  );

  sheet.setColumnWidth(
    9,
    75
  );

  sheet.setColumnWidth(
    10,
    100
  );

  sheet.setColumnWidth(
    11,
    100
  );

  sheet.setColumnWidth(
    12,
    130
  );

  sheet.setColumnWidth(
    13,
    170
  );

  sheet.setColumnWidth(
    14,
    240
  );

  if (
    sheet.getMaxRows() > 1
  ) {

    sheet
      .getRange(
        2,
        1,
        sheet.getMaxRows() - 1,
        1
      )
      .setNumberFormat(
        "dd.MM.yyyy HH:mm:ss"
      );

    sheet
      .getRange(
        2,
        2,
        sheet.getMaxRows() - 1,
        2
      )
      .setNumberFormat(
        "@"
      );

  }

}


/************************************************************
 * PERSONELLER SAYFASI BİÇİMLENDİRME
 ************************************************************/

function formatPersonnelSheet_(
  sheet
) {

  sheet.setFrozenRows(
    1
  );

  sheet
    .getRange(
      1,
      1,
      1,
      APP_CONFIG.PERSONNEL_HEADERS.length
    )
    .setFontWeight(
      "bold"
    )
    .setBackground(
      "#218c4f"
    )
    .setFontColor(
      "#ffffff"
    )
    .setHorizontalAlignment(
      "center"
    );

  sheet.setColumnWidth(
    1,
    180
  );

  sheet.setColumnWidth(
    2,
    330
  );

  sheet.setColumnWidth(
    3,
    110
  );

  sheet.setColumnWidth(
    4,
    90
  );

  sheet.setColumnWidth(
    5,
    170
  );

  if (
    sheet.getMaxRows() > 1
  ) {

    sheet
      .getRange(
        2,
        2,
        sheet.getMaxRows() - 1,
        1
      )
      .setNumberFormat(
        "@"
      );

    sheet
      .getRange(
        2,
        5,
        sheet.getMaxRows() - 1,
        1
      )
      .setNumberFormat(
        "dd.MM.yyyy HH:mm:ss"
      );

  }

}


/************************************************************
 * TÜM ÜRÜNLERİ AL
 ************************************************************/

function getAllProducts_() {

  const sheet =
    getSheet_(
      APP_CONFIG.SHEETS.PRODUCTS
    );

  const rows =
    getDataRows_(
      sheet,
      APP_CONFIG.PRODUCT_HEADERS.length
    );

  return rows

    .map(
      function (row, index) {

        return productFromRow_(
          row,
          index + 2
        );

      }
    )

    .filter(
      function (product) {

        return Boolean(
          product.barcode
        );

      }
    );

}


/************************************************************
 * BARKODLA ÜRÜN KAYDI BUL
 ************************************************************/

function findProductByBarcode_(
  barcode
) {

  const cleanBarcode =
    normalizeBarcode_(
      barcode
    );

  if (!cleanBarcode) {

    return null;

  }

  const products =
    getAllProducts_();

  for (
    let index = 0;
    index < products.length;
    index++
  ) {

    if (
      normalizeBarcode_(
        products[index].barcode
      ) ===
      cleanBarcode
    ) {

      return products[index];

    }

  }

  return null;

}


/************************************************************
 * SATIRDAN ÜRÜN NESNESİ OLUŞTUR
 ************************************************************/

function productFromRow_(
  row,
  rowNumber
) {

  return {

    rowNumber:
      rowNumber,

    barcode:
      normalizeBarcode_(
        row[0]
      ),

    code:
      cleanText_(
        row[1]
      ),

    type:
      normalizeProductType_(
        row[2]
      ),

    model:
      cleanText_(
        row[3]
      ),

    size:
      cleanText_(
        row[4]
      ),

    color:
      cleanText_(
        row[5]
      ),

    stock:
      toNonNegativeInteger_(
        row[6]
      ),

    critical:
      toNonNegativeInteger_(
        row[7]
      ),

    active:
      normalizeActiveValue_(
        row[8]
      )

  };

}


/************************************************************
 * ÜRÜNÜ İSTEMCİYE UYGUN HALE GETİR
 ************************************************************/

function productToClient_(
  product
) {

  if (!product) {

    return null;

  }

  return {

    barcode:
      product.barcode,

    code:
      product.code,

    type:
      product.type,

    model:
      product.model,

    size:
      product.size,

    color:
      product.color,

    stock:
      toNonNegativeInteger_(
        product.stock
      ),

    critical:
      toNonNegativeInteger_(
        product.critical
      ),

    active:
      normalizeActiveValue_(
        product.active
      )

  };

}


/************************************************************
 * TÜM HAREKETLERİ AL
 ************************************************************/

function getAllMovements_() {

  const sheet =
    getSheet_(
      APP_CONFIG.SHEETS.MOVEMENTS
    );

  const rows =
    getDataRows_(
      sheet,
      APP_CONFIG.MOVEMENT_HEADERS.length
    );

  return rows

    .map(
      function (row, index) {

        const date =
          row[0] instanceof Date
            ? row[0]
            : new Date(
                row[0]
              );

        return {

          sheetRow:
            index + 2,

          date:
            isNaN(
              date.getTime()
            )
              ? new Date(0)
              : date,

          barcode:
            normalizeBarcode_(
              row[1]
            ),

          code:
            cleanText_(
              row[2]
            ),

          type:
            normalizeProductType_(
              row[3]
            ),

          model:
            cleanText_(
              row[4]
            ),

          size:
            cleanText_(
              row[5]
            ),

          color:
            cleanText_(
              row[6]
            ),

          operation:
            cleanText_(
              row[7]
            ),

          quantity:
            Number(
              row[8]
            ) || 0,

          previousStock:
            toNonNegativeInteger_(
              row[9]
            ),

          newStock:
            toNonNegativeInteger_(
              row[10]
            ),

          personnel:
            cleanText_(
              row[11]
            ),

          source:
            cleanText_(
              row[12]
            ),

          description:
            cleanText_(
              row[13]
            )

        };

      }
    )

    .filter(
      function (movement) {

        return movement.date.getTime() > 0;

      }
    );

}


/************************************************************
 * PERSONEL KAYDI BUL
 ************************************************************/

function findPersonnelByName_(
  personnelName
) {

  const searchName =
    normalizeForSearch_(
      personnelName
    );

  if (!searchName) {

    return null;

  }

  const sheet =
    getSheet_(
      APP_CONFIG.SHEETS.PERSONNEL
    );

  const rows =
    getDataRows_(
      sheet,
      APP_CONFIG.PERSONNEL_HEADERS.length
    );

  for (
    let index = 0;
    index < rows.length;
    index++
  ) {

    const row =
      rows[index];

    const name =
      cleanText_(
        row[0]
      );

    if (
      normalizeForSearch_(
        name
      ) ===
      searchName
    ) {

      return {

        rowNumber:
          index + 2,

        personnel:
          name,

        pinHash:
          cleanText_(
            row[1]
          ),

        role:
          normalizeRole_(
            row[2]
          ),

        active:
          normalizeActiveValue_(
            row[3]
          ),

        updatedAt:
          row[4]

      };

    }

  }

  return null;

}


/************************************************************
 * VERİ SATIRLARINI AL
 ************************************************************/

function getDataRows_(
  sheet,
  columnCount
) {

  const lastRow =
    sheet.getLastRow();

  if (lastRow < 2) {

    return [];

  }

  return sheet
    .getRange(
      2,
      1,
      lastRow - 1,
      columnCount
    )
    .getValues();

}


/************************************************************
 * YENİ ÜRÜN VERİSİNİ KONTROL ET
 ************************************************************/

function validateAndNormalizeProduct_(
  productData
) {

  const data =
    productData || {};

  const product = {

    barcode:
      normalizeBarcode_(
        data.barcode
      ),

    code:
      cleanText_(
        data.code
      ),

    type:
      normalizeProductType_(
        data.type
      ),

    model:
      cleanText_(
        data.model
      ),

    size:
      cleanText_(
        data.size
      ),

    color:
      cleanText_(
        data.color
      ),

    stock:
      toNonNegativeIntegerStrict_(
        data.stock,
        "Başlangıç stoku"
      ),

    critical:
      toNonNegativeIntegerStrict_(
        data.critical,
        "Kritik stok"
      ),

    active:
      normalizeActiveValue_(
        data.active
      )

  };

  if (!product.barcode) {

    throw new Error(
      "Barkod girilmelidir."
    );

  }

  if (
    APP_CONFIG.PRODUCT_TYPES.indexOf(
      product.type
    ) === -1
  ) {

    throw new Error(
      "Ürün türü Yatak, Baza, Başlık veya Ayak olmalıdır."
    );

  }

  if (!product.model) {

    throw new Error(
      "Ürün modeli girilmelidir."
    );

  }

  /*
   * Ayak ürünlerinde ölçü veya renk bulunmuyorsa
   * çizgi işareti kullanılır.
   */

  if (!product.size) {

    product.size =
      "-";

  }

  if (!product.color) {

    product.color =
      "-";

  }

  return product;

}


/************************************************************
 * PERSONEL VERİSİNİ KONTROL ET
 ************************************************************/

function validatePersonnelData_(
  personnel,
  pin,
  role
) {

  if (!personnel) {

    throw new Error(
      "Personel adı girilmelidir."
    );

  }

  validatePin_(
    pin
  );

  if (
    role !==
      APP_CONFIG.ROLES.ADMIN &&
    role !==
      APP_CONFIG.ROLES.PERSONNEL
  ) {

    throw new Error(
      "Yetki Yönetici veya Personel olmalıdır."
    );

  }

}


/************************************************************
 * PIN KONTROLÜ
 ************************************************************/

function validatePin_(
  pin
) {

  if (
    !/^\d{4,8}$/.test(
      pin
    )
  ) {

    throw new Error(
      "PIN yalnızca rakamlardan oluşmalı ve 4-8 haneli olmalıdır."
    );

  }

}


/************************************************************
 * PIN HASH OLUŞTUR
 ************************************************************/

function hashPin_(
  pin
) {

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(
        pin
      ),
      Utilities.Charset.UTF_8
    );

  return Utilities.base64Encode(
    digest
  );

}


/************************************************************
 * PIN TEMİZLE
 ************************************************************/

function normalizePin_(
  pin
) {

  return String(
    pin === null ||
    typeof pin === "undefined"
      ? ""
      : pin
  )
    .trim()
    .replace(
      /\s+/g,
      ""
    );

}


/************************************************************
 * ÜRÜN TÜRÜNÜ NORMALLEŞTİR
 ************************************************************/

function normalizeProductType_(
  value
) {

  const normalized =
    normalizeForSearch_(
      value
    );

  if (
    normalized ===
    "yatak"
  ) {

    return "Yatak";

  }

  if (
    normalized ===
    "baza"
  ) {

    return "Baza";

  }

  if (
    normalized ===
      "baslik" ||
    normalized ===
      "başlık"
  ) {

    return "Başlık";

  }

  if (
    normalized ===
    "ayak"
  ) {

    return "Ayak";

  }

  return cleanText_(
    value
  );

}


/************************************************************
 * OPSİYONEL ÜRÜN TÜRÜ
 ************************************************************/

function normalizeProductTypeOptional_(
  value
) {

  const cleanValue =
    cleanText_(
      value
    );

  if (!cleanValue) {

    return "";

  }

  const type =
    normalizeProductType_(
      cleanValue
    );

  return APP_CONFIG.PRODUCT_TYPES.indexOf(
    type
  ) !== -1
    ? type
    : "";

}


/************************************************************
 * ÜRÜN TÜRÜ ANAHTARI
 ************************************************************/

function productTypeKey_(
  productType
) {

  const type =
    normalizeProductType_(
      productType
    );

  if (type === "Yatak") {

    return "yatak";

  }

  if (type === "Baza") {

    return "baza";

  }

  if (type === "Başlık") {

    return "baslik";

  }

  if (type === "Ayak") {

    return "ayak";

  }

  return "";

}


/************************************************************
 * YETKİYİ NORMALLEŞTİR
 ************************************************************/

function normalizeRole_(
  value
) {

  const normalized =
    normalizeForSearch_(
      value
    );

  if (
    normalized ===
      "yonetici" ||
    normalized ===
      "admin"
  ) {

    return APP_CONFIG.ROLES.ADMIN;

  }

  return APP_CONFIG.ROLES.PERSONNEL;

}


/************************************************************
 * AKTİF/PASİF DEĞERİNİ NORMALLEŞTİR
 ************************************************************/

function normalizeActiveValue_(
  value
) {

  return isActiveValue_(
    value
  )
    ? APP_CONFIG.STATUS.ACTIVE
    : APP_CONFIG.STATUS.PASSIVE;

}


/************************************************************
 * AKTİF DEĞER KONTROLÜ
 ************************************************************/

function isActiveValue_(
  value
) {

  if (value === true) {

    return true;

  }

  const normalized =
    normalizeForSearch_(
      value
    );

  return [

    "evet",

    "aktif",

    "true",

    "1",

    "yes"

  ].indexOf(
    normalized
  ) !== -1;

}


/************************************************************
 * BARKODU NORMALLEŞTİR
 ************************************************************/

function normalizeBarcode_(
  value
) {

  return String(
    value === null ||
    typeof value === "undefined"
      ? ""
      : value
  )
    .trim()
    .replace(
      /\s+/g,
      ""
    );

}


/************************************************************
 * ARAMA METNİNİ NORMALLEŞTİR
 ************************************************************/

function normalizeForSearch_(
  value
) {

  return cleanText_(
    value
  )
    .toLocaleLowerCase(
      "tr-TR"
    )
    .replace(
      /ı/g,
      "i"
    )
    .replace(
      /ğ/g,
      "g"
    )
    .replace(
      /ü/g,
      "u"
    )
    .replace(
      /ş/g,
      "s"
    )
    .replace(
      /ö/g,
      "o"
    )
    .replace(
      /ç/g,
      "c"
    );

}


/************************************************************
 * METİN TEMİZLE
 ************************************************************/

function cleanText_(
  value
) {

  if (
    value === null ||
    typeof value ===
      "undefined"
  ) {

    return "";

  }

  return String(
    value
  ).trim();

}


/************************************************************
 * POZİTİF TAM SAYI
 ************************************************************/

function toPositiveInteger_(
  value,
  fieldName
) {

  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    ) ||
    !Number.isInteger(
      number
    ) ||
    number < 1
  ) {

    throw new Error(
      fieldName +
      " 1 veya daha büyük tam sayı olmalıdır."
    );

  }

  return number;

}


/************************************************************
 * NEGATİF OLMAYAN TAM SAYI
 ************************************************************/

function toNonNegativeIntegerStrict_(
  value,
  fieldName
) {

  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    ) ||
    !Number.isInteger(
      number
    ) ||
    number < 0
  ) {

    throw new Error(
      fieldName +
      " 0 veya daha büyük tam sayı olmalıdır."
    );

  }

  return number;

}


/************************************************************
 * GÜVENLİ NEGATİF OLMAYAN TAM SAYI
 ************************************************************/

function toNonNegativeInteger_(
  value
) {

  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    ) ||
    number < 0
  ) {

    return 0;

  }

  return Math.floor(
    number
  );

}


/************************************************************
 * ÜRÜNLERİ SIRALA
 *
 * Önce model, sonra ölçü, sonra renk.
 ************************************************************/

function sortProducts_(
  a,
  b
) {

  const modelCompare =
    compareTurkish_(
      a.model,
      b.model
    );

  if (modelCompare !== 0) {

    return modelCompare;

  }

  const sizeCompare =
    compareNatural_(
      a.size,
      b.size
    );

  if (sizeCompare !== 0) {

    return sizeCompare;

  }

  const colorCompare =
    compareTurkish_(
      a.color,
      b.color
    );

  if (colorCompare !== 0) {

    return colorCompare;

  }

  return compareTurkish_(
    a.barcode,
    b.barcode
  );

}


/************************************************************
 * TÜRKÇE METİN KARŞILAŞTIR
 ************************************************************/

function compareTurkish_(
  a,
  b
) {

  return cleanText_(
    a
  ).localeCompare(
    cleanText_(
      b
    ),
    "tr",
    {

      sensitivity:
        "base"

    }
  );

}


/************************************************************
 * DOĞAL ÖLÇÜ SIRALAMASI
 ************************************************************/

function compareNatural_(
  a,
  b
) {

  const aText =
    cleanText_(
      a
    );

  const bText =
    cleanText_(
      b
    );

  return aText.localeCompare(
    bText,
    "tr",
    {

      numeric:
        true,

      sensitivity:
        "base"

    }
  );

}


/************************************************************
 * TARİH ANAHTARI
 ************************************************************/

function formatDateKey_(
  date
) {

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );

}


/************************************************************
 * TARİH VE SAAT METNİ
 ************************************************************/

function formatDateTime_(
  date
) {

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "dd.MM.yyyy HH:mm:ss"
  );

}


/************************************************************
 * BAŞLIK İNDEKSİ BUL
 ************************************************************/

function findHeaderIndex_(
  headers,
  possibleNames
) {

  const normalizedHeaders =
    headers.map(
      normalizeForSearch_
    );

  for (
    let nameIndex = 0;
    nameIndex < possibleNames.length;
    nameIndex++
  ) {

    const normalizedName =
      normalizeForSearch_(
        possibleNames[nameIndex]
      );

    const foundIndex =
      normalizedHeaders.indexOf(
        normalizedName
      );

    if (foundIndex !== -1) {

      return foundIndex;

    }

  }

  return -1;

}
