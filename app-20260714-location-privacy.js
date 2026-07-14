const LEGACY_LOCAL_KEY = "slowpoke_records_v1";
const CONFIG_KEY = "slowpoke_supabase_config_v1";
const BUCKET_NAME = "slowpoke-photos";

const DB_NAME = "slowpoke_collector_db";
const DB_VERSION = 1;
const RECORD_STORE = "records";

let records = [];
let currentPhotoDataUrl = "";
let selectedRecordId = null;
let supabaseClient = null;
let databasePromise = null;
let locationWasEditedByUser = false;
let locationLookupSequence = 0;

const $ = (selector) => document.querySelector(selector);

const todayCountEl = $("#todayCount");
const totalCountEl = $("#totalCount");
const nextNumberEl = $("#nextNumber");
const galleryEl = $("#gallery");
const emptyStateEl = $("#emptyState");
const progressBarEl = $("#progressBar");
const todayMessageEl = $("#todayMessage");
const recordDialog = $("#recordDialog");
const detailDialog = $("#detailDialog");
const settingsDialog = $("#settingsDialog");
const recordForm = $("#recordForm");
const photoInput = $("#photoInput");
const photoPreview = $("#photoPreview");
const photoPlaceholder = $("#photoPlaceholder");
const locationInput = $("#locationInput");
const locationHint = $("#locationHint");
const messageInput = $("#messageInput");
const formStatus = $("#formStatus");
const locationStatus = $("#locationStatus");
const saveButton = $("#saveButton");
const detailLocationInput = $("#detailLocationInput");
const detailMessageInput = $("#detailMessageInput");
const saveRecordButton = $("#saveRecordButton");
const detailEditStatus = $("#detailEditStatus");

function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
  } catch {
    return {};
  }
}

function configureSupabase() {
  const config = getConfig();

  if (config.url && config.key && window.supabase) {
    supabaseClient = window.supabase.createClient(config.url, config.key);
  } else {
    supabaseClient = null;
  }
}

function openLocalDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(
      new Error("這個瀏覽器不支援 IndexedDB，請改用 Safari 或 Chrome。")
    );
  }

  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(RECORD_STORE)) {
        const store = database.createObjectStore(RECORD_STORE, {
          keyPath: "id",
        });

        store.createIndex("created_at", "created_at", {
          unique: false,
        });
      }
    };

    request.onsuccess = () => {
      const database = request.result;

      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };

      resolve(database);
    };

    request.onerror = () => {
      databasePromise = null;
      reject(
        request.error ||
          new Error("無法開啟本機圖鑑資料庫。")
      );
    };

    request.onblocked = () => {
      reject(
        new Error("資料庫正在被其他頁面使用，請關閉其他分頁後再試。")
      );
    };
  });

  return databasePromise;
}

function waitForTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ||
          new Error("本機資料庫操作失敗。")
      );
    transaction.onabort = () =>
      reject(
        transaction.error ||
          new Error("本機資料庫操作已取消。")
      );
  });
}

async function migrateLegacyLocalStorage() {
  const raw = localStorage.getItem(LEGACY_LOCAL_KEY);
  if (!raw) return;

  let oldRecords;

  try {
    oldRecords = JSON.parse(raw);
  } catch {
    return;
  }

  if (!Array.isArray(oldRecords)) return;

  if (oldRecords.length === 0) {
    localStorage.removeItem(LEGACY_LOCAL_KEY);
    return;
  }

  const database = await openLocalDatabase();
  const transaction = database.transaction(
    RECORD_STORE,
    "readwrite"
  );
  const store = transaction.objectStore(RECORD_STORE);

  for (const record of oldRecords) {
    if (record && record.id) {
      store.put(record);
    }
  }

  await waitForTransaction(transaction);

  // 確認搬移成功後才清掉舊資料，釋放 localStorage 空間。
  localStorage.removeItem(LEGACY_LOCAL_KEY);
}

function removePreciseCoordinates(record) {
  if (!record || typeof record !== "object") {
    return record;
  }

  const sanitized = { ...record };
  delete sanitized.latitude;
  delete sanitized.longitude;
  return sanitized;
}

async function loadLocalRecords() {
  await migrateLegacyLocalStorage();

  const database = await openLocalDatabase();
  const transaction = database.transaction(
    RECORD_STORE,
    "readonly"
  );
  const store = transaction.objectStore(RECORD_STORE);

  const result = await new Promise((resolve, reject) => {
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () =>
      reject(
        request.error ||
          new Error("無法讀取本機圖鑑。")
      );
  });

  await waitForTransaction(transaction);

  const sanitizedRecords =
    result.map(removePreciseCoordinates);

  const hadPreciseCoordinates =
    result.some(
      (record) =>
        record &&
        (
          record.latitude !== undefined ||
          record.longitude !== undefined
        )
    );

  if (hadPreciseCoordinates) {
    const database = await openLocalDatabase();
    const cleanupTransaction = database.transaction(
      RECORD_STORE,
      "readwrite"
    );
    const cleanupStore =
      cleanupTransaction.objectStore(RECORD_STORE);

    sanitizedRecords.forEach((record) => {
      cleanupStore.put(record);
    });

    await waitForTransaction(cleanupTransaction);
  }

  return sanitizedRecords.sort(
    (a, b) =>
      new Date(b.created_at).getTime() -
      new Date(a.created_at).getTime()
  );
}

async function saveLocalRecord(record) {
  const database = await openLocalDatabase();
  const transaction = database.transaction(
    RECORD_STORE,
    "readwrite"
  );

  transaction.objectStore(RECORD_STORE).put(record);
  await waitForTransaction(transaction);
}

async function deleteLocalRecord(id) {
  const database = await openLocalDatabase();
  const transaction = database.transaction(
    RECORD_STORE,
    "readwrite"
  );

  transaction.objectStore(RECORD_STORE).delete(id);
  await waitForTransaction(transaction);
}

function localDateKey(dateLike = new Date()) {
  const date = new Date(dateLike);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${value.year}-${value.month}-${value.day}`;
}

function prettyDate(value) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function coordinateText(latitude, longitude) {
  if (
    latitude === null ||
    latitude === undefined ||
    longitude === null ||
    longitude === undefined
  ) {
    return "";
  }

  return `GPS ${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`;
}

function recordLocationText(record) {
  return (
    record.location_name ||
    coordinateText(record.latitude, record.longitude) ||
    "沒有記錄地點"
  );
}

function getTodayRecords() {
  const today = localDateKey();

  return records.filter(
    (record) => localDateKey(record.created_at) === today
  );
}

async function loadRecords() {
  try {
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from("slowpoke_records")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      records = data || [];
    } else {
      records = await loadLocalRecords();
    }
  } catch (error) {
    console.error(error);
    records = [];
    alert(
      `圖鑑讀取失敗：${error.message || "請重新整理後再試"}`
    );
  }

  render();
}

function render() {
  const todayRecords = getTodayRecords();

  todayCountEl.textContent = todayRecords.length;
  totalCountEl.textContent = `總共 ${records.length} 隻`;
  nextNumberEl.textContent = todayRecords.length + 1;
  progressBarEl.style.width =
    `${Math.min(100, 8 + todayRecords.length * 14)}%`;

  const messages = [
    "第一隻呆呆獸正在等你。",
    "很好，今天已經開始慢下來了。",
    "發呆能量持續累積中。",
    "今天的呆呆獸會議正式成立。",
    "再找下去，你可能會被選為呆呆獸里長。",
  ];

  todayMessageEl.textContent =
    messages[Math.min(todayRecords.length, messages.length - 1)];

  const badges = document.querySelectorAll(".badge");
  let unlockedBadges = 0;

  badges.forEach((badge) => {
    const goal = Number(badge.dataset.goal || 0);
    const unlocked = records.length >= goal;
    badge.classList.toggle("unlocked", unlocked);

    if (unlocked) unlockedBadges += 1;
  });

  const badgeCountEl = $("#badgeCount");
  if (badgeCountEl) {
    badgeCountEl.textContent =
      `${unlockedBadges} / ${badges.length}`;
  }

  galleryEl.innerHTML = "";
  emptyStateEl.hidden = records.length > 0;

  records.forEach((record, index) => {
    const fragment =
      $("#cardTemplate").content.cloneNode(true);

    const button = fragment.querySelector(".record-card");
    const image = fragment.querySelector("img");
    const number = fragment.querySelector(".record-number");
    const title = fragment.querySelector("h3");
    const message = fragment.querySelector("p");
    const date = fragment.querySelector("small");

    image.src =
      record.photo_url ||
      placeholderImage(record.location_name);

    image.alt =
      record.location_name ||
      "呆呆獸水溝蓋照片";

    number.textContent = `NO. ${records.length - index}`;
    title.textContent = recordLocationText(record);

    message.textContent =
      record.message ||
      "今天什麼都沒說，只負責發呆。";

    date.textContent = prettyDate(record.created_at);

    button.addEventListener(
      "click",
      () => openDetail(record.id)
    );

    galleryEl.appendChild(fragment);
  });
}

function placeholderImage(seed = "slowpoke") {
  const safe = encodeURIComponent(seed || "slowpoke");

  return (
    `https://placehold.co/800x800/` +
    `f7c9d8/493f43?text=${safe}`
  );
}

function openRecordForm() {
  resetForm();
  nextNumberEl.textContent =
    getTodayRecords().length + 1;

  recordDialog.showModal();
}

function resetForm() {
  recordForm.reset();
  currentPhotoDataUrl = "";
  locationWasEditedByUser = false;
  locationLookupSequence += 1;

  locationInput.classList.remove("user-edited");
  if (locationHint) {
    locationHint.textContent =
      "定位會先填入建議地點；按下收服前，可改成任何你想保存的文字。";
  }

  photoPreview.hidden = true;
  photoPreview.src = "";
  photoPlaceholder.hidden = false;

  formStatus.textContent = "";
  locationStatus.textContent = "";

  saveButton.disabled = false;
  saveButton.textContent = "收服這隻呆呆獸";
}

async function compressImage(
  file,
  maxWidth = 1400,
  quality = 0.76
) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, maxWidth / bitmap.width);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);

  const context = canvas.getContext("2d");
  context.drawImage(
    bitmap,
    0,
    0,
    canvas.width,
    canvas.height
  );

  bitmap.close?.();

  return canvas.toDataURL("image/jpeg", quality);
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  if (!file) return;

  try {
    photoPlaceholder.textContent = "正在整理照片…";
    currentPhotoDataUrl = await compressImage(file);

    photoPreview.src = currentPhotoDataUrl;
    photoPreview.hidden = false;
    photoPlaceholder.hidden = true;
  } catch (error) {
    console.error(error);
    currentPhotoDataUrl = "";
    photoPlaceholder.hidden = false;
    photoPlaceholder.innerHTML =
      "<b>📷</b>照片處理失敗，請重新選擇";
  }
});

function buildLocationName(address = {}, fallback = "") {
  const prefecture =
    address.state ||
    address.province ||
    address.region ||
    "";

  const city =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county ||
    "";

  const district =
    address.city_district ||
    address.suburb ||
    address.quarter ||
    address.neighbourhood ||
    "";

  const local =
    address.road ||
    address.pedestrian ||
    address.square ||
    address.attraction ||
    address.amenity ||
    address.building ||
    "";

  const parts = [
    prefecture,
    city,
    district,
    local,
  ].filter(
    (value, index, array) =>
      value && array.indexOf(value) === index
  );

  return parts.join(" ") || fallback;
}

async function reverseGeocode(latitude, longitude) {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "18",
    addressdetails: "1",
    "accept-language": "zh-TW,ja,en",
  });

  const response = await fetch(
    "https://nominatim.openstreetmap.org/reverse?" +
      params.toString(),
    {
      headers: {
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `地址查詢失敗 (${response.status})`
    );
  }

  const data = await response.json();

  return buildLocationName(
    data.address,
    data.display_name || ""
  );
}


locationInput.addEventListener("input", () => {
  locationWasEditedByUser = true;
  locationInput.classList.add("user-edited");

  if (locationHint) {
    locationHint.textContent =
      "會保存你現在輸入的文字；定位結果不會再把它覆蓋。";
  }
});

async function handleLocationRequest() {
  const lookupSequence = ++locationLookupSequence;
  locationWasEditedByUser = false;
  locationInput.classList.remove("user-edited");

  if (locationHint) {
    locationHint.textContent =
      "正在取得附近地名；出現文字後仍可自由修改。";
  }

  if (!locationStatus || !locationInput) {
    alert("定位欄位沒有正確載入，請重新整理頁面。");
    return;
  }

  if (!navigator.geolocation) {
    locationStatus.textContent =
      "這台裝置不支援定位，請直接輸入地點。";
    return;
  }

  locationStatus.textContent =
    "正在暫時取得位置，並轉換成附近地名…";

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      // 經緯度只存在這個函式執行期間，不放進全域狀態。
      const latitude =
        position.coords.latitude;
      const longitude =
        position.coords.longitude;

      try {
        const locationName = await reverseGeocode(
          latitude,
          longitude
        );

        if (lookupSequence !== locationLookupSequence) {
          return;
        }

        if (locationName) {
          if (!locationWasEditedByUser) {
            locationInput.value = locationName;
            locationStatus.textContent =
              "已填入附近地名。請確認或修改後再儲存。";

            if (locationHint) {
              locationHint.textContent =
                "只會保存地點欄中最後確認的文字，不保存精確座標。";
            }
          } else {
            locationStatus.textContent =
              "已取得附近地名；你已自行修改內容，將保存目前欄位中的文字。";
          }
        } else {
          locationStatus.textContent =
            "已暫時取得位置，但沒有查到附近地名。請直接輸入地點；精確位置不會保存。";
        }
      } catch (error) {
        console.error(error);
        locationStatus.textContent =
          locationWasEditedByUser
            ? "地名查詢未完成，將保存你自行輸入的文字；精確位置不會保存。"
            : "已暫時取得位置，但無法轉換成地名。請直接輸入地點；精確位置不會保存。";

        if (locationHint) {
          locationHint.textContent =
            "儲存時只會保存地點欄中最後確認的文字。";
        }
      }
      // 函式結束後，latitude / longitude 不再保留。
    },
    (error) => {
      const messages = {
        1:
          `沒有取得位置，沒關係，你仍可以直接輸入地點。
想使用自動填入時，再到 Safari 將位置權限設為「詢問」或「允許」。`,
        2:
          "目前無法取得位置，沒關係，你仍可以直接輸入地點。",
        3:
          "定位逾時，沒關係，你仍可以直接輸入地點；也可以稍後再試一次。",
      };

      locationStatus.textContent =
        messages[error.code] ||
        "沒有取得位置，沒關係，你仍可以直接輸入地點。";

      if (locationHint) {
        locationHint.textContent =
          "定位是選填功能；不開啟也能正常儲存紀錄。";
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    }
  );
}

// 使用事件代理，即使按鈕較晚才出現在畫面上也能正常觸發。
document.addEventListener("click", (event) => {
  const button = event.target.closest("#useLocationButton");
  if (!button) return;

  event.preventDefault();
  handleLocationRequest();
});

recordForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    if (!currentPhotoDataUrl) {
      formStatus.textContent =
        "先放一張照片，這隻呆呆獸才不會隱形。";
      return;
    }

    const finalLocationText =
      locationInput.value.trim();

    if (!finalLocationText) {
      formStatus.textContent =
        "請輸入想保存的地點名稱，或按「自動填入目前地點」。";
      locationInput.focus();
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "收服中…";
    formStatus.textContent = "";

    try {
      const record = {
        id: crypto.randomUUID(),
        // 只保存使用者最後確認的地點文字，不保存經緯度。
        location_name:
          finalLocationText,
        message:
          messageInput.value.trim(),
        created_at:
          new Date().toISOString(),
        photo_url:
          currentPhotoDataUrl,
      };

      if (supabaseClient) {
        record.photo_url =
          await uploadPhotoToSupabase(
            record.id,
            currentPhotoDataUrl
          );

        const { data, error } =
          await supabaseClient
            .from("slowpoke_records")
            .insert(record)
            .select()
            .single();

        if (error) throw error;
        records.unshift(data);
      } else {
        await saveLocalRecord(record);
        records.unshift(record);
      }

      render();
      recordDialog.close();
    } catch (error) {
      console.error(error);

      if (
        error?.name === "QuotaExceededError" ||
        /quota/i.test(error?.message || "")
      ) {
        formStatus.textContent =
          "儲存空間不足。請確認 iPhone 尚有可用空間，或設定 Supabase 雲端同步。";
      } else {
        formStatus.textContent =
          `儲存失敗：${error.message || "請稍後再試"}`;
      }
    } finally {
      saveButton.disabled = false;
      saveButton.textContent =
        "收服這隻呆呆獸";
    }
  }
);

async function uploadPhotoToSupabase(id, dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const path =
    `${localDateKey()}/${id}.jpg`;

  const { error } = await supabaseClient.storage
    .from(BUCKET_NAME)
    .upload(path, blob, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabaseClient.storage
    .from(BUCKET_NAME)
    .getPublicUrl(path);

  return data.publicUrl;
}

function openDetail(id) {
  const record = records.find(
    (item) => String(item.id) === String(id)
  );

  if (!record) return;

  selectedRecordId = record.id;

  $("#detailImage").src =
    record.photo_url ||
    placeholderImage(record.location_name);

  $("#detailNumber").textContent =
    "SLOWPOKE RECORD";

  detailLocationInput.value =
    recordLocationText(record);

  detailMessageInput.value =
    record.message || "";

  detailEditStatus.textContent = "";

  $("#detailDate").textContent =
    prettyDate(record.created_at);

  detailDialog.showModal();
}


saveRecordButton.addEventListener(
  "click",
  async () => {
    if (!selectedRecordId) return;

    const newLocation =
      detailLocationInput.value.trim();

    const newMessage =
      detailMessageInput.value.trim();

    if (!newLocation) {
      detailEditStatus.textContent =
        "地點不能留白，可以輸入車站、城市或你自己的名稱。";
      detailLocationInput.focus();
      return;
    }

    const record = records.find(
      (item) =>
        String(item.id) ===
        String(selectedRecordId)
    );

    if (!record) {
      detailEditStatus.textContent =
        "找不到這筆紀錄，請重新開啟圖鑑卡片。";
      return;
    }

    const previousLocation =
      record.location_name;

    const previousMessage =
      record.message;

    saveRecordButton.disabled = true;
    saveRecordButton.textContent = "儲存中…";
    detailEditStatus.textContent = "";

    try {
      if (supabaseClient) {
        const { data, error } =
          await supabaseClient
            .from("slowpoke_records")
            .update({
              location_name: newLocation,
              message: newMessage,
              latitude: null,
              longitude: null,
            })
            .eq("id", selectedRecordId)
            .select()
            .single();

        if (error) throw error;

        Object.assign(record, data);
      } else {
        record.location_name = newLocation;
        record.message = newMessage;
        delete record.latitude;
        delete record.longitude;
        await saveLocalRecord(record);
      }

      detailLocationInput.value =
        record.location_name;

      detailMessageInput.value =
        record.message || "";

      detailEditStatus.textContent =
        "地點和一句話都已修改完成。";

      render();
    } catch (error) {
      record.location_name =
        previousLocation;

      record.message =
        previousMessage;

      console.error(error);

      detailEditStatus.textContent =
        `修改失敗：${error.message || "請稍後再試"}`;
    } finally {
      saveRecordButton.disabled = false;
      saveRecordButton.textContent =
        "儲存修改";
    }
  }
);

$("#deleteButton").addEventListener(
  "click",
  async () => {
    if (!selectedRecordId) return;

    const ok = confirm(
      "真的要刪除這筆呆呆獸紀錄嗎？"
    );

    if (!ok) return;

    try {
      if (supabaseClient) {
        const { error } = await supabaseClient
          .from("slowpoke_records")
          .delete()
          .eq("id", selectedRecordId);

        if (error) throw error;
      } else {
        await deleteLocalRecord(
          selectedRecordId
        );
      }

      records = records.filter(
        (item) =>
          String(item.id) !==
          String(selectedRecordId)
      );

      detailDialog.close();
      render();
    } catch (error) {
      alert(
        `刪除失敗：${error.message || "請稍後再試"}`
      );
    }
  }
);

$("#shareButton").addEventListener(
  "click",
  async () => {
    const count = getTodayRecords().length;
    const text =
      `今天收服了 ${count} 隻呆呆獸！` +
      "發呆進度非常優秀。";

    try {
      if (navigator.share) {
        await navigator.share({
          title: "今天的呆呆獸戰績",
          text,
        });
      } else {
        await navigator.clipboard.writeText(text);
        alert("戰績已複製！");
      }
    } catch {
      // 使用者取消分享時不顯示錯誤
    }
  }
);

$("#openFormButton").addEventListener(
  "click",
  openRecordForm
);

$("#settingsButton").addEventListener(
  "click",
  () => {
    const config = getConfig();

    $("#supabaseUrlInput").value =
      config.url || "";

    $("#supabaseKeyInput").value =
      config.key || "";

    $("#settingsStatus").textContent = "";
    settingsDialog.showModal();
  }
);

$("#settingsForm").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const url =
      $("#supabaseUrlInput").value.trim();

    const key =
      $("#supabaseKeyInput").value.trim();

    if ((url && !key) || (!url && key)) {
      $("#settingsStatus").textContent =
        "URL 和 anon key 要一起填，或一起留白。";
      return;
    }

    localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ url, key })
    );

    configureSupabase();

    $("#settingsStatus").textContent = url
      ? "已儲存，正在重新讀取雲端資料。"
      : "已切換成本機模式。";

    await loadRecords();

    setTimeout(
      () => settingsDialog.close(),
      700
    );
  }
);

$("#clearCloudButton").addEventListener(
  "click",
  async () => {
    localStorage.removeItem(CONFIG_KEY);

    $("#supabaseUrlInput").value = "";
    $("#supabaseKeyInput").value = "";

    configureSupabase();

    $("#settingsStatus").textContent =
      "已切換成本機模式。";

    await loadRecords();
  }
);

document
  .querySelectorAll("[data-close]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      document
        .getElementById(button.dataset.close)
        .close();
    });
  });

configureSupabase();
loadRecords();
