const LOCAL_COLLECTOR_NAME_KEY = "slowpoke_local_collector_name_v3";
const BACKUP_PROMPT_SEEN_KEY = "slowpoke_backup_prompt_seen_v2";
const OAUTH_INTENT_KEY = "slowpoke_oauth_intent_v2";
const OPEN_NAME_AFTER_BACKUP_KEY = "slowpoke_open_name_after_backup_v2";
const BUCKET_NAME = "slowpoke-photos";
const MAX_CLOUD_RECORDS = 18;

const DB_NAME = "slowpoke_collector_db";
const DB_VERSION = 2;
const RECORD_STORE = "records";

let records = [];
let dataMode = "local";
let currentUser = null;
let currentProfile = null;
let supabaseClient = null;
let backupMode = "unavailable";
let databasePromise = null;
let selectedRecordId = null;
let currentVariants = null;
let currentPreviewUrl = "";
let detailObjectUrl = "";
let galleryObjectUrls = [];
let locationWasEditedByUser = false;
let locationLookupSequence = 0;
let appBusy = false;

const $ = (selector) => document.querySelector(selector);
const todayCountEl = $("#todayCount");
const totalCountEl = $("#totalCount");
const nextNumberEl = $("#nextNumber");
const galleryEl = $("#gallery");
const emptyStateEl = $("#emptyState");
const progressBarEl = $("#progressBar");
const todayMessageEl = $("#todayMessage");
const collectorNameEl = $("#collectorName");
const collectorStatusEl = $("#collectorStatus");
const collectorActionButton = $("#collectorActionButton");
const cloudMeter = $("#cloudMeter");
const cloudCount = $("#cloudCount");
const cloudMeterBar = $("#cloudMeterBar");
const cloudNotice = $("#cloudNotice");
const openFormButton = $("#openFormButton");
const recordDialog = $("#recordDialog");
const recordForm = $("#recordForm");
const photoInput = $("#photoInput");
const photoPreview = $("#photoPreview");
const photoPlaceholder = $("#photoPlaceholder");
const photoSizeStatus = $("#photoSizeStatus");
const locationInput = $("#locationInput");
const locationHint = $("#locationHint");
const locationStatus = $("#locationStatus");
const messageInput = $("#messageInput");
const formStatus = $("#formStatus");
const saveButton = $("#saveButton");
const detailDialog = $("#detailDialog");
const detailImage = $("#detailImage");
const detailImageLoading = $("#detailImageLoading");
const detailLocationInput = $("#detailLocationInput");
const detailMessageInput = $("#detailMessageInput");
const detailEditStatus = $("#detailEditStatus");
const saveRecordButton = $("#saveRecordButton");
const loginDialog = $("#loginDialog");
const loginDialogTitle = $("#loginDialogTitle");
const loginDialogMessage = $("#loginDialogMessage");
const backupAvailabilityMessage = $("#backupAvailabilityMessage");
const loginStatus = $("#loginStatus");
const syncDialog = $("#syncDialog");
const syncMessage = $("#syncMessage");
const syncProgressBar = $("#syncProgressBar");
const syncCount = $("#syncCount");
const nameDialog = $("#nameDialog");
const nameForm = $("#nameForm");
const collectorNameInput = $("#collectorNameInput");
const nameStatus = $("#nameStatus");
const settingsDialog = $("#settingsDialog");
const settingsModeStatus = $("#settingsModeStatus");

const ANONYMOUS_COLLECTOR_NAMES = [
  "抱著烏龍麵的發呆研究員",
  "抱著粉紅泡泡的旅行觀察員",
  "抱著一朵雲的水溝蓋獵人",
  "抱著夕陽回家的慢慢探險家",
  "在月台上發呆的收藏家",
  "在雨裡慢慢走的探險家",
  "在水溝蓋旁等公車的研究員",
  "在海風吹來時睡著的旅行者",
  "被粉紅泡泡選中的收藏家",
  "被烏龍麵香氣召喚的探險家",
  "被呆呆獸盯上的旅行者",
  "被夕陽留下來的發呆研究員",
  "忘記趕路的慢慢收藏家",
  "忘記回家的水溝蓋研究員",
  "忘記撐傘的粉紅探險家",
  "忘記今天星期幾的旅行觀察員",
];

function secureRandomIndex(length) {
  if (
    window.crypto &&
    typeof window.crypto.getRandomValues === "function"
  ) {
    const randomValue = new Uint32Array(1);
    window.crypto.getRandomValues(randomValue);
    return randomValue[0] % length;
  }

  return Math.floor(Math.random() * length);
}

function generateCollectorName() {
  return ANONYMOUS_COLLECTOR_NAMES[
    secureRandomIndex(ANONYMOUS_COLLECTOR_NAMES.length)
  ];
}

function getOrCreateLocalCollectorName() {
  const existing =
    localStorage.getItem(LOCAL_COLLECTOR_NAME_KEY);

  if (existing) return existing;

  const generated = generateCollectorName();
  localStorage.setItem(
    LOCAL_COLLECTOR_NAME_KEY,
    generated
  );

  return generated;
}

function getEmbeddedConfig() {
  const config = window.SLOWPOKE_SUPABASE_CONFIG || {};
  const url = String(config.url || "").trim();
  const key = String(config.key || "").trim();
  if (!url || !key || /PASTE_|YOUR_/i.test(url) || /PASTE_|YOUR_/i.test(key)) return null;
  return { url, key };
}

function configureSupabase() {
  const config = getEmbeddedConfig();
  if (!config || !window.supabase) {
    supabaseClient = null;
    return false;
  }
  supabaseClient = window.supabase.createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
  return true;
}

function setBusy(value) {
  appBusy = value;
  document.body.classList.toggle("is-busy", value);
}

function openLocalDatabase() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("這個瀏覽器不支援本機收藏資料庫。"));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORD_STORE)) {
        const store = database.createObjectStore(RECORD_STORE, { keyPath: "id" });
        store.createIndex("created_at", "created_at", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("無法開啟本機收藏資料庫。"));
    request.onblocked = () => reject(new Error("資料庫正在被其他分頁使用，請關閉其他分頁再試。"));
  });
  return databasePromise;
}

function waitForTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("本機資料庫操作失敗。"));
    transaction.onabort = () => reject(transaction.error || new Error("本機資料庫操作已取消。"));
  });
}

async function saveLocalRecord(record) {
  const database = await openLocalDatabase();
  const transaction = database.transaction(RECORD_STORE, "readwrite");
  transaction.objectStore(RECORD_STORE).put(record);
  await waitForTransaction(transaction);
}

async function deleteLocalRecord(id) {
  const database = await openLocalDatabase();
  const transaction = database.transaction(RECORD_STORE, "readwrite");
  transaction.objectStore(RECORD_STORE).delete(id);
  await waitForTransaction(transaction);
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);/)?.[1] || "image/jpeg";
  const bytes = atob(body);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

async function getSourceBlobFromLegacyRecord(record) {
  if (record.display_blob instanceof Blob) return record.display_blob;
  if (typeof record.photo_url === "string" && record.photo_url.startsWith("data:")) return dataUrlToBlob(record.photo_url);
  if (typeof record.display_photo_url === "string" && record.display_photo_url.startsWith("data:")) return dataUrlToBlob(record.display_photo_url);
  return null;
}

async function loadLocalRecords() {
  const database = await openLocalDatabase();
  const transaction = database.transaction(RECORD_STORE, "readonly");
  const result = await new Promise((resolve, reject) => {
    const request = transaction.objectStore(RECORD_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("無法讀取本機圖鑑。"));
  });
  await waitForTransaction(transaction);

  const normalized = [];
  for (const raw of result) {
    const record = { ...raw };
    delete record.latitude;
    delete record.longitude;

    if (!(record.thumbnail_blob instanceof Blob) || !(record.display_blob instanceof Blob)) {
      const sourceBlob = await getSourceBlobFromLegacyRecord(record);
      if (sourceBlob) {
        try {
          const variants = await createImageVariants(sourceBlob);
          record.thumbnail_blob = variants.thumbnailBlob;
          record.display_blob = variants.displayBlob;
        } catch (error) {
          console.warn("舊照片轉換失敗", error);
        }
      }
    }

    delete record.photo_url;
    delete record.display_photo_url;
    delete record.photo_path;
    delete record.thumbnail_path;
    delete record.display_path;
    await saveLocalRecord(record);
    normalized.push(record);
  }

  return normalized.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("照片壓縮失敗。")), type, quality);
  });
}

async function loadImageBitmap(blob) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      return createImageBitmap(blob);
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("無法讀取照片。"));
    };
    image.src = url;
  });
}

async function encodeCanvasUnderLimit(canvas, maxBytes) {
  let low = 0.32;
  let high = 0.92;
  let best = null;
  for (let i = 0; i < 8; i += 1) {
    const quality = (low + high) / 2;
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (blob.size <= maxBytes) {
      best = blob;
      low = quality;
    } else {
      high = quality;
    }
  }
  return best || canvasToBlob(canvas, "image/jpeg", 0.30);
}

async function createVariant(bitmap, options) {
  const sourceWidth = bitmap.width || bitmap.naturalWidth;
  const sourceHeight = bitmap.height || bitmap.naturalHeight;
  let scale;
  if (options.fixedWidth) {
    scale = Math.min(1, options.fixedWidth / sourceWidth);
  } else {
    scale = Math.min(1, options.maxDimension / Math.max(sourceWidth, sourceHeight));
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await encodeCanvasUnderLimit(canvas, options.maxBytes);
    if (blob.size <= options.maxBytes || attempt === 4) return blob;
    scale *= 0.84;
  }
  throw new Error("照片壓縮失敗。" );
}

async function createImageVariants(sourceBlob) {
  const bitmap = await loadImageBitmap(sourceBlob);
  try {
    const [thumbnailBlob, displayBlob] = await Promise.all([
      createVariant(bitmap, { fixedWidth: 520, maxBytes: 80 * 1024 }),
      createVariant(bitmap, { maxDimension: 1600, maxBytes: 450 * 1024 }),
    ]);
    return { thumbnailBlob, displayBlob };
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

function formatKB(bytes) {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function localDateKey(dateLike = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(dateLike));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function prettyDate(value) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function getTodayRecords() {
  const today = localDateKey();
  return records.filter((record) => localDateKey(record.created_at) === today);
}

function placeholderImage(seed = "slowpoke") {
  return `https://placehold.co/800x800/f7c9d8/493f43?text=${encodeURIComponent(seed || "slowpoke")}`;
}

function clearGalleryObjectUrls() {
  galleryObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  galleryObjectUrls = [];
}

function thumbnailSource(record) {
  if (dataMode === "cloud") return record.thumbnail_url || placeholderImage(record.location_name);
  if (record.thumbnail_blob instanceof Blob) {
    const url = URL.createObjectURL(record.thumbnail_blob);
    galleryObjectUrls.push(url);
    return url;
  }
  return placeholderImage(record.location_name);
}

function renderCollector() {
  const localName = getOrCreateLocalCollectorName();
  if (dataMode === "cloud" && currentProfile) {
    collectorNameEl.textContent = currentProfile.collector_name;
    collectorStatusEl.textContent = `已備份到雲端 · ${records.length} / ${MAX_CLOUD_RECORDS} 筆`;
    collectorActionButton.textContent = "更改名稱";
    cloudMeter.hidden = false;
    cloudCount.textContent = `${records.length} / ${MAX_CLOUD_RECORDS}`;
    cloudMeterBar.style.width = `${Math.min(100, records.length / MAX_CLOUD_RECORDS * 100)}%`;
  } else {
    collectorNameEl.textContent = localName;
    collectorStatusEl.textContent = `本機收藏中 · ${records.length} 筆只存在這台手機`;
    collectorActionButton.textContent = "登入備份與改名稱";
    cloudMeter.hidden = true;
  }
}

function renderCloudNotice() {
  cloudNotice.hidden = true;
  cloudNotice.className = "cloud-notice";
  if (backupMode === "new_users_paused" && dataMode === "local") {
    cloudNotice.textContent = "目前暫停開放新的雲端備份；你仍可免費在這台手機上繼續收藏。已備份過的收藏家仍可登入找回。";
    cloudNotice.hidden = false;
  }
  if (backupMode === "all_uploads_paused") {
    cloudNotice.textContent = dataMode === "cloud"
      ? "目前雲端空間暫停新增照片；你仍可查看、修改文字與刪除原有收藏。"
      : "目前雲端空間暫停新增備份；你仍可免費在這台手機上繼續收藏。已備份過的收藏家仍可查看與刪除。";
    cloudNotice.hidden = false;
  }
}

function render() {
  const todayRecords = getTodayRecords();
  todayCountEl.textContent = todayRecords.length;
  totalCountEl.textContent = `總共 ${records.length} 隻`;
  nextNumberEl.textContent = todayRecords.length + 1;
  progressBarEl.style.width = `${Math.min(100, 8 + todayRecords.length * 14)}%`;
  const messages = [
    "第一隻呆呆獸正在等你。", "很好，今天已經開始慢下來了。", "發呆能量持續累積中。",
    "今天的呆呆獸會議正式成立。", "再找下去，你可能會被選為呆呆獸里長。",
  ];
  todayMessageEl.textContent = messages[Math.min(todayRecords.length, messages.length - 1)];

  let unlocked = 0;
  const badges = document.querySelectorAll(".badge");
  badges.forEach((badge) => {
    const isUnlocked = records.length >= Number(badge.dataset.goal || 0);
    badge.classList.toggle("unlocked", isUnlocked);
    if (isUnlocked) unlocked += 1;
  });
  $("#badgeCount").textContent = `${unlocked} / ${badges.length}`;

  renderCollector();
  renderCloudNotice();
  clearGalleryObjectUrls();
  galleryEl.innerHTML = "";
  emptyStateEl.hidden = records.length > 0;

  records.forEach((record, index) => {
    const fragment = $("#cardTemplate").content.cloneNode(true);
    const button = fragment.querySelector(".record-card");
    const image = fragment.querySelector("img");
    image.src = thumbnailSource(record);
    image.alt = record.location_name || "呆呆獸水溝蓋照片";
    fragment.querySelector(".record-number").textContent = `NO. ${records.length - index}`;
    fragment.querySelector("h3").textContent = record.location_name || "沒有記錄地點";
    fragment.querySelector("p").textContent = record.message || "今天什麼都沒說，只負責發呆。";
    fragment.querySelector("small").textContent = prettyDate(record.created_at);
    button.addEventListener("click", () => openDetail(record.id));
    galleryEl.appendChild(fragment);
  });

  openFormButton.disabled = dataMode === "cloud" && (records.length >= MAX_CLOUD_RECORDS || backupMode === "all_uploads_paused");
  openFormButton.title = records.length >= MAX_CLOUD_RECORDS ? "雲端收藏已達 18 筆" : "";
}

async function loadBackupMode() {
  if (!supabaseClient) {
    backupMode = "unavailable";
    return backupMode;
  }
  const { data, error } = await supabaseClient
    .from("backup_system_settings")
    .select("backup_mode")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) {
    console.warn("無法讀取雲端狀態", error);
    backupMode = "unavailable";
  } else {
    backupMode = data.backup_mode;
  }
  return backupMode;
}

async function getProfile(userId) {
  const { data, error } = await supabaseClient
    .from("collector_profiles")
    .select("user_id, collector_name, is_custom, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function createBackupProfile() {
  const { error } = await supabaseClient.rpc("start_cloud_backup", {
    p_collector_name: getOrCreateLocalCollectorName(),
  });
  if (error) throw error;
  currentProfile = await getProfile(currentUser.id);
}

async function signedThumbnail(record) {
  const { data, error } = await supabaseClient.storage
    .from(BUCKET_NAME)
    .createSignedUrl(record.thumbnail_path, 60 * 60);
  return { ...record, thumbnail_url: error ? "" : data?.signedUrl || "" };
}

async function loadCloudRecords() {
  const { data, error } = await supabaseClient
    .from("slowpoke_records")
    .select("id, user_id, location_name, message, thumbnail_path, display_path, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return Promise.all((data || []).map(signedThumbnail));
}

function cleanOAuthUrl() {
  if (!/[?#](code|error|error_description)=/.test(window.location.href)) return;
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  window.history.replaceState({}, document.title, url.toString());
}

function friendlyCloudError(error) {
  const message = String(error?.message || error || "");
  if (/NEW_BACKUPS_PAUSED/i.test(message)) return "目前暫停開放新的雲端備份；你仍可留在這台手機收藏。";
  if (/ALL_UPLOADS_PAUSED/i.test(message)) return "目前雲端空間暫停新增照片。";
  if (/CLOUD_LIMIT_REACHED/i.test(message)) return "雲端收藏已達每人 18 筆上限。";
  if (/provider.*not enabled|unsupported provider/i.test(message)) return "這個登入方式尚未在 Supabase 啟用。";
  return message || "操作沒有完成，請稍後再試。";
}

async function initializeApp() {
  setBusy(true);
  try {
    records = await loadLocalRecords();
    dataMode = "local";
    configureSupabase();
    if (supabaseClient) {
      await loadBackupMode();
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (data.session?.user) {
        currentUser = data.session.user;
        const intent = localStorage.getItem(OAUTH_INTENT_KEY) || "";
        currentProfile = await getProfile(currentUser.id);

        if (!currentProfile && intent === "backup") {
          await createBackupProfile();
        } else if (!currentProfile && intent === "recover") {
          localStorage.removeItem(OAUTH_INTENT_KEY);
          await supabaseClient.auth.signOut();
          currentUser = null;
          window.alert("這個帳號還沒有呆呆獸雲端圖鑑，已回到本機收藏。" );
        } else if (!currentProfile) {
          await supabaseClient.auth.signOut();
          currentUser = null;
        }

        if (currentProfile) {
          dataMode = "cloud";
          if (intent === "backup") {
            await backupLocalCollection();
          }
          records = await loadCloudRecords();
          if (localStorage.getItem(OPEN_NAME_AFTER_BACKUP_KEY) === "1") {
            localStorage.removeItem(OPEN_NAME_AFTER_BACKUP_KEY);
            window.setTimeout(openNameDialog, 350);
          }
        }
        localStorage.removeItem(OAUTH_INTENT_KEY);
      }
    }
    cleanOAuthUrl();
    render();
  } catch (error) {
    console.error(error);
    const message = friendlyCloudError(error);
    window.alert(`雲端初始化沒有完成：${message}\n本機收藏仍然保留。`);
    if (supabaseClient && currentUser && !currentProfile) {
      try { await supabaseClient.auth.signOut(); } catch {}
    }
    localStorage.removeItem(OAUTH_INTENT_KEY);
    dataMode = "local";
    currentUser = null;
    currentProfile = null;
    records = await loadLocalRecords();
    render();
  } finally {
    setBusy(false);
  }
}

function resetForm() {
  recordForm.reset();
  currentVariants = null;
  if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
  currentPreviewUrl = "";
  photoPreview.hidden = true;
  photoPreview.removeAttribute("src");
  photoPlaceholder.hidden = false;
  photoPlaceholder.innerHTML = "<b>📷</b>拍照或選擇照片";
  photoSizeStatus.textContent = "";
  formStatus.textContent = "";
  locationStatus.textContent = "";
  locationWasEditedByUser = false;
  locationLookupSequence += 1;
  locationInput.classList.remove("user-edited");
  locationHint.textContent = "定位會先填入建議地點；按下收服前，可改成任何你想保存的文字。";
  saveButton.disabled = false;
  saveButton.textContent = "收服這隻呆呆獸";
}

function openRecordForm() {
  if (dataMode === "cloud" && records.length >= MAX_CLOUD_RECORDS) {
    window.alert("雲端收藏已達 18 筆。請先刪除一筆，再新增新的收藏。" );
    return;
  }
  if (dataMode === "cloud" && backupMode === "all_uploads_paused") {
    window.alert("目前雲端空間暫停新增照片；原有收藏仍可查看與刪除。" );
    return;
  }
  resetForm();
  nextNumberEl.textContent = getTodayRecords().length + 1;
  recordDialog.showModal();
}

function buildLocationName(address = {}, fallback = "") {
  const prefecture = address.state || address.province || address.region || "";
  const city = address.city || address.town || address.village || address.municipality || address.county || "";
  const district = address.city_district || address.suburb || address.quarter || address.neighbourhood || "";
  const local = address.road || address.pedestrian || address.square || address.attraction || address.amenity || address.building || "";
  return [prefecture, city, district, local].filter((value, index, array) => value && array.indexOf(value) === index).join(" ") || fallback;
}

async function reverseGeocode(latitude, longitude) {
  const params = new URLSearchParams({
    format: "jsonv2", lat: String(latitude), lon: String(longitude), zoom: "18", addressdetails: "1",
    "accept-language": "zh-TW,ja,en",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`地址查詢失敗 (${response.status})`);
  const data = await response.json();
  return buildLocationName(data.address, data.display_name || "");
}

async function handleLocationRequest() {
  const sequence = ++locationLookupSequence;
  locationWasEditedByUser = false;
  locationInput.classList.remove("user-edited");
  locationHint.textContent = "正在取得附近地名；出現文字後仍可自由修改。";
  if (!navigator.geolocation) {
    locationStatus.textContent = "這台裝置不支援定位，請直接輸入地點。";
    return;
  }
  locationStatus.textContent = "正在暫時取得位置，並轉換成附近地名…";
  navigator.geolocation.getCurrentPosition(async (position) => {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    try {
      const locationName = await reverseGeocode(latitude, longitude);
      if (sequence !== locationLookupSequence) return;
      if (locationName && !locationWasEditedByUser) {
        locationInput.value = locationName;
        locationStatus.textContent = "已填入附近地名。請確認或修改後再儲存。";
        locationHint.textContent = "只會保存地點欄中最後確認的文字，不保存精確座標。";
      } else if (locationWasEditedByUser) {
        locationStatus.textContent = "已取得附近地名；你已自行修改內容，將保存目前欄位中的文字。";
      } else {
        locationStatus.textContent = "沒有查到附近地名，請直接輸入；精確位置不會保存。";
      }
    } catch (error) {
      console.error(error);
      locationStatus.textContent = "無法轉換成地名，請直接輸入；精確位置不會保存。";
    }
  }, (error) => {
    const messages = {
      1: `沒有取得位置，沒關係，你仍可以直接輸入地點。\n想使用自動填入時，再到 Safari 將位置權限設為「詢問」或「允許」。`,
      2: "目前無法取得位置，沒關係，你仍可以直接輸入地點。",
      3: "定位逾時，沒關係，你仍可以直接輸入地點；也可以稍後再試一次。",
    };
    locationStatus.textContent = messages[error.code] || "沒有取得位置，沒關係，你仍可以直接輸入地點。";
    locationHint.textContent = "定位是選填功能；不開啟也能正常儲存紀錄。";
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

async function uploadCloudBlobs(recordId, variants) {
  const basePath = `${currentUser.id}/${recordId}`;
  const thumbnailPath = `${basePath}/thumbnail.jpg`;
  const displayPath = `${basePath}/display.jpg`;
  const uploaded = [];
  try {
    let result = await supabaseClient.storage.from(BUCKET_NAME).upload(thumbnailPath, variants.thumbnailBlob, {
      contentType: "image/jpeg", upsert: false, cacheControl: "3600",
    });
    if (result.error) throw result.error;
    uploaded.push(thumbnailPath);
    result = await supabaseClient.storage.from(BUCKET_NAME).upload(displayPath, variants.displayBlob, {
      contentType: "image/jpeg", upsert: false, cacheControl: "3600",
    });
    if (result.error) throw result.error;
    uploaded.push(displayPath);
    return { thumbnailPath, displayPath };
  } catch (error) {
    if (uploaded.length) await supabaseClient.storage.from(BUCKET_NAME).remove(uploaded);
    throw error;
  }
}

async function createCloudRecord(record, variants) {
  if (backupMode === "all_uploads_paused") throw new Error("ALL_UPLOADS_PAUSED");
  const paths = await uploadCloudBlobs(record.id, variants);
  const { data, error } = await supabaseClient
    .from("slowpoke_records")
    .insert({
      id: record.id,
      user_id: currentUser.id,
      location_name: record.location_name,
      message: record.message,
      thumbnail_path: paths.thumbnailPath,
      display_path: paths.displayPath,
      created_at: record.created_at,
    })
    .select("id, user_id, location_name, message, thumbnail_path, display_path, created_at")
    .single();
  if (error) {
    await supabaseClient.storage.from(BUCKET_NAME).remove([paths.thumbnailPath, paths.displayPath]);
    throw error;
  }
  return signedThumbnail(data);
}

function showSyncProgress(done, total, message) {
  syncMessage.textContent = message;
  syncCount.textContent = `${done} / ${total}`;
  syncProgressBar.style.width = `${total ? done / total * 100 : 0}%`;
}

async function backupLocalCollection() {
  const localRecords = await loadLocalRecords();
  const { data: existingRows, error } = await supabaseClient.from("slowpoke_records").select("id");
  if (error) throw error;
  const existingIds = new Set((existingRows || []).map((row) => row.id));
  const available = Math.max(0, MAX_CLOUD_RECORDS - existingIds.size);
  const candidates = localRecords
    .filter((record) => !existingIds.has(record.id) && record.thumbnail_blob instanceof Blob && record.display_blob instanceof Blob)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(0, available);

  if (!candidates.length) return;
  if (backupMode === "all_uploads_paused") throw new Error("ALL_UPLOADS_PAUSED");

  syncDialog.showModal();
  showSyncProgress(0, candidates.length, "準備上傳縮圖與大圖…");
  try {
    let done = 0;
    for (const record of candidates) {
      showSyncProgress(done, candidates.length, `正在備份：${record.location_name || "呆呆獸收藏"}`);
      await createCloudRecord(record, {
        thumbnailBlob: record.thumbnail_blob,
        displayBlob: record.display_blob,
      });
      done += 1;
      showSyncProgress(done, candidates.length, "備份進行中…");
    }
    showSyncProgress(candidates.length, candidates.length, "備份完成！");
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  } finally {
    syncDialog.close();
  }
}

function maybePromptBackupAfterThree() {
  if (dataMode !== "local" || records.length < 3) return;
  if (localStorage.getItem(BACKUP_PROMPT_SEEN_KEY) === "1") return;
  localStorage.setItem(BACKUP_PROMPT_SEEN_KEY, "1");
  window.setTimeout(() => openLoginDialog("third"), 350);
}

async function openLoginDialog(reason = "manual") {
  await loadBackupMode();
  loginStatus.textContent = "";
  loginDialogTitle.textContent = reason === "third" ? "你已經收藏 3 隻了！" : "備份目前的圖鑑";
  loginDialogMessage.textContent = reason === "third"
    ? "要不要登入，把這台手機上的收藏備份到雲端？換手機後也能找回。"
    : "登入後，會把這台手機上的收藏備份到雲端；每人最多 18 筆。";

  backupAvailabilityMessage.className = "backup-availability";
  const backupButtons = [$("#backupGoogleButton"), $("#backupAppleButton")];
  const backupAvailable = !!supabaseClient && backupMode === "open";
  backupButtons.forEach((button) => { button.disabled = !backupAvailable; });

  if (!supabaseClient) {
    backupAvailabilityMessage.textContent = "網站管理者尚未完成雲端設定；目前仍可在手機上正常收藏。";
    backupAvailabilityMessage.classList.add("closed");
  } else if (backupMode === "open") {
    backupAvailabilityMessage.textContent = `登入後會備份目前收藏；雲端最多 ${MAX_CLOUD_RECORDS} 筆。原始照片不會上傳。`;
  } else if (backupMode === "new_users_paused") {
    backupAvailabilityMessage.textContent = "目前暫停開放新的雲端備份；已備份過的收藏家仍可從下方找回圖鑑。";
    backupAvailabilityMessage.classList.add("warning");
  } else if (backupMode === "all_uploads_paused") {
    backupAvailabilityMessage.textContent = "目前雲端空間暫停新增照片；已備份過的收藏家仍可登入查看與刪除。";
    backupAvailabilityMessage.classList.add("closed");
  } else {
    backupAvailabilityMessage.textContent = "暫時無法確認雲端狀態，請稍後再試。";
    backupAvailabilityMessage.classList.add("closed");
  }
  loginDialog.showModal();
}

function oauthRedirectUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function startOAuth(provider, intent) {
  if (!supabaseClient) {
    loginStatus.textContent = "網站尚未完成雲端設定。";
    return;
  }
  if (intent === "backup" && backupMode !== "open") {
    loginStatus.textContent = "目前暫停開放新的備份；你仍可留在這台手機收藏。";
    return;
  }
  loginStatus.textContent = "正在前往登入頁面…";
  localStorage.setItem(OAUTH_INTENT_KEY, intent);
  if (intent === "backup") localStorage.setItem(OPEN_NAME_AFTER_BACKUP_KEY, "1");
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider,
    options: { redirectTo: oauthRedirectUrl() },
  });
  if (error) {
    localStorage.removeItem(OAUTH_INTENT_KEY);
    loginStatus.textContent = friendlyCloudError(error);
  }
}

function openNameDialog() {
  if (!currentProfile || dataMode !== "cloud") return;
  collectorNameInput.value = currentProfile.collector_name;
  nameStatus.textContent = "";
  nameDialog.showModal();
}

async function openDetail(id) {
  const record = records.find((item) => String(item.id) === String(id));
  if (!record) return;
  selectedRecordId = record.id;
  detailLocationInput.value = record.location_name || "";
  detailMessageInput.value = record.message || "";
  detailEditStatus.textContent = "";
  $("#detailNumber").textContent = "SLOWPOKE RECORD";
  $("#detailDate").textContent = prettyDate(record.created_at);
  if (detailObjectUrl) URL.revokeObjectURL(detailObjectUrl);
  detailObjectUrl = "";
  detailImage.removeAttribute("src");
  detailImageLoading.hidden = false;
  detailDialog.showModal();

  try {
    if (dataMode === "local" && record.display_blob instanceof Blob) {
      detailObjectUrl = URL.createObjectURL(record.display_blob);
      detailImage.src = detailObjectUrl;
    } else if (dataMode === "cloud" && record.display_path) {
      const { data, error } = await supabaseClient.storage.from(BUCKET_NAME).createSignedUrl(record.display_path, 60 * 60);
      if (error) throw error;
      detailImage.src = data.signedUrl;
    } else {
      detailImage.src = placeholderImage(record.location_name);
    }
  } catch (error) {
    console.error(error);
    detailImage.src = placeholderImage(record.location_name);
  } finally {
    detailImageLoading.hidden = true;
  }
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  photoPlaceholder.hidden = false;
  photoPlaceholder.textContent = "正在製作縮圖與大圖…";
  photoPreview.hidden = true;
  photoSizeStatus.textContent = "";
  try {
    currentVariants = await createImageVariants(file);
    if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = URL.createObjectURL(currentVariants.displayBlob);
    photoPreview.src = currentPreviewUrl;
    photoPreview.hidden = false;
    photoPlaceholder.hidden = true;
    photoSizeStatus.textContent = `收藏牆縮圖 ${formatKB(currentVariants.thumbnailBlob.size)} · 點開大圖 ${formatKB(currentVariants.displayBlob.size)} · 原始照片不保存`;
  } catch (error) {
    console.error(error);
    currentVariants = null;
    photoPlaceholder.innerHTML = "<b>📷</b>照片處理失敗，請重新選擇";
    photoSizeStatus.textContent = "";
  }
});

locationInput.addEventListener("input", () => {
  locationWasEditedByUser = true;
  locationInput.classList.add("user-edited");
  locationHint.textContent = "會保存你現在輸入的文字；定位結果不會再覆蓋。";
});

document.addEventListener("click", (event) => {
  if (event.target.closest("#useLocationButton")) {
    event.preventDefault();
    handleLocationRequest();
  }
});

recordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentVariants) {
    formStatus.textContent = "先放一張照片，這隻呆呆獸才不會隱形。";
    return;
  }
  const locationName = locationInput.value.trim();
  if (!locationName) {
    formStatus.textContent = "請輸入想保存的地點名稱，或使用自動填入。";
    locationInput.focus();
    return;
  }
  saveButton.disabled = true;
  saveButton.textContent = "收服中…";
  formStatus.textContent = "";
  const record = {
    id: crypto.randomUUID(),
    location_name: locationName,
    message: messageInput.value.trim(),
    created_at: new Date().toISOString(),
  };
  try {
    if (dataMode === "cloud") {
      const cloudRecord = await createCloudRecord(record, currentVariants);
      records.unshift(cloudRecord);
    } else {
      const localRecord = {
        ...record,
        thumbnail_blob: currentVariants.thumbnailBlob,
        display_blob: currentVariants.displayBlob,
      };
      await saveLocalRecord(localRecord);
      records.unshift(localRecord);
    }
    render();
    recordDialog.close();
    photoInput.value = "";
    currentVariants = null;
    if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = "";
    maybePromptBackupAfterThree();
  } catch (error) {
    console.error(error);
    formStatus.textContent = `儲存失敗：${friendlyCloudError(error)}`;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "收服這隻呆呆獸";
  }
});

saveRecordButton.addEventListener("click", async () => {
  const record = records.find((item) => String(item.id) === String(selectedRecordId));
  if (!record) return;
  const locationName = detailLocationInput.value.trim();
  const message = detailMessageInput.value.trim();
  if (!locationName) {
    detailEditStatus.textContent = "地點不能留白。";
    return;
  }
  saveRecordButton.disabled = true;
  saveRecordButton.textContent = "儲存中…";
  try {
    if (dataMode === "cloud") {
      const { data, error } = await supabaseClient
        .from("slowpoke_records")
        .update({ location_name: locationName, message })
        .eq("id", record.id)
        .select("id, user_id, location_name, message, thumbnail_path, display_path, created_at")
        .single();
      if (error) throw error;
      Object.assign(record, { ...data, thumbnail_url: record.thumbnail_url });
    } else {
      record.location_name = locationName;
      record.message = message;
      await saveLocalRecord(record);
    }
    detailEditStatus.textContent = "地點和一句話都已修改完成。";
    render();
  } catch (error) {
    detailEditStatus.textContent = `修改失敗：${friendlyCloudError(error)}`;
  } finally {
    saveRecordButton.disabled = false;
    saveRecordButton.textContent = "儲存修改";
  }
});

$("#deleteButton").addEventListener("click", async () => {
  const record = records.find((item) => String(item.id) === String(selectedRecordId));
  if (!record || !window.confirm("真的要刪除這筆呆呆獸紀錄嗎？")) return;
  try {
    if (dataMode === "cloud") {
      const { error } = await supabaseClient.from("slowpoke_records").delete().eq("id", record.id);
      if (error) throw error;
      await supabaseClient.storage.from(BUCKET_NAME).remove([record.thumbnail_path, record.display_path].filter(Boolean));
    } else {
      await deleteLocalRecord(record.id);
    }
    records = records.filter((item) => item.id !== record.id);
    detailDialog.close();
    render();
  } catch (error) {
    window.alert(`刪除失敗：${friendlyCloudError(error)}`);
  }
});

nameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = collectorNameInput.value.trim();
  if (!name) {
    nameStatus.textContent = "請輸入收藏家名稱。";
    return;
  }
  const { data, error } = await supabaseClient
    .from("collector_profiles")
    .update({ collector_name: name, is_custom: true, updated_at: new Date().toISOString() })
    .eq("user_id", currentUser.id)
    .select("user_id, collector_name, is_custom, created_at, updated_at")
    .single();
  if (error) {
    nameStatus.textContent = `儲存失敗：${friendlyCloudError(error)}`;
    return;
  }
  currentProfile = data;
  renderCollector();
  nameStatus.textContent = "收藏家名稱已更新。";
  window.setTimeout(() => nameDialog.close(), 600);
});

collectorActionButton.addEventListener("click", () => {
  if (dataMode === "cloud") openNameDialog();
  else openLoginDialog("manual");
});

$("#backupGoogleButton").addEventListener("click", () => startOAuth("google", "backup"));
$("#backupAppleButton").addEventListener("click", () => startOAuth("apple", "backup"));
$("#recoverGoogleButton").addEventListener("click", () => startOAuth("google", "recover"));
$("#recoverAppleButton").addEventListener("click", () => startOAuth("apple", "recover"));
$("#continueLocalButton").addEventListener("click", () => loginDialog.close());
openFormButton.addEventListener("click", openRecordForm);

$("#shareButton").addEventListener("click", async () => {
  const text = `今天收服了 ${getTodayRecords().length} 隻呆呆獸，累積 ${records.length} 隻！`;
  try {
    if (navigator.share) await navigator.share({ title: "呆呆獸收集戰績", text });
    else {
      await navigator.clipboard.writeText(text);
      window.alert("戰績已複製！");
    }
  } catch {
    // 使用者取消分享時不顯示錯誤。
  }
});

$("#settingsButton").addEventListener("click", () => {
  const modeText = {
    open: "雲端備份目前開放中。",
    new_users_paused: "目前暫停開放新的雲端備份。",
    all_uploads_paused: "目前暫停所有新增雲端照片。",
    unavailable: "目前未連接雲端，仍可使用本機收藏。",
  }[backupMode] || "目前無法確認雲端狀態。";
  settingsModeStatus.textContent = `${dataMode === "cloud" ? `目前已登入，雲端 ${records.length}/${MAX_CLOUD_RECORDS} 筆。` : "目前使用本機收藏。"} ${modeText}`;
  settingsDialog.showModal();
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => {
    const dialog = document.getElementById(button.dataset.close);
    if (dialog?.open) dialog.close();
  });
});

detailDialog.addEventListener("close", () => {
  if (detailObjectUrl) URL.revokeObjectURL(detailObjectUrl);
  detailObjectUrl = "";
});

window.addEventListener("beforeunload", () => {
  clearGalleryObjectUrls();
  if (detailObjectUrl) URL.revokeObjectURL(detailObjectUrl);
  if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
});

initializeApp();
