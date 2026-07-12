const LOCAL_KEY = "slowpoke_records_v1";
const CONFIG_KEY = "slowpoke_supabase_config_v1";
const BUCKET_NAME = "slowpoke-photos";

let records = [];
let currentPhotoDataUrl = "";
let currentCoords = null;
let selectedRecordId = null;
let supabaseClient = null;

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
const messageInput = $("#messageInput");
const formStatus = $("#formStatus");
const locationStatus = $("#locationStatus");
const saveButton = $("#saveButton");

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

function localDateKey(dateLike = new Date()) {
  const date = new Date(dateLike);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
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

function getTodayRecords() {
  const today = localDateKey();
  return records.filter((record) => localDateKey(record.created_at) === today);
}

async function loadRecords() {
  if (supabaseClient) {
    const { data, error } = await supabaseClient
      .from("slowpoke_records")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      alert("雲端資料讀取失敗，先改用本機紀錄。");
      records = loadLocalRecords();
    } else {
      records = data || [];
    }
  } else {
    records = loadLocalRecords();
  }
  render();
}

function loadLocalRecords() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalRecords() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(records));
}

function render() {
  const todayRecords = getTodayRecords();
  todayCountEl.textContent = todayRecords.length;
  totalCountEl.textContent = `總共 ${records.length} 隻`;
  nextNumberEl.textContent = todayRecords.length + 1;
  progressBarEl.style.width = `${Math.min(100, 8 + todayRecords.length * 14)}%`;

  const messages = [
    "第一隻呆呆獸正在等你。",
    "很好，今天已經開始慢下來了。",
    "發呆能量持續累積中。",
    "今天的呆呆獸會議正式成立。",
    "再找下去，你可能會被選為呆呆獸里長。",
  ];
  todayMessageEl.textContent = messages[Math.min(todayRecords.length, messages.length - 1)];

  galleryEl.innerHTML = "";
  emptyStateEl.hidden = records.length > 0;

  records.forEach((record, index) => {
    const fragment = $("#cardTemplate").content.cloneNode(true);
    const button = fragment.querySelector(".record-card");
    const image = fragment.querySelector("img");
    const number = fragment.querySelector(".record-number");
    const title = fragment.querySelector("h3");
    const message = fragment.querySelector("p");
    const date = fragment.querySelector("small");

    image.src = record.photo_url || placeholderImage(record.location_name);
    image.alt = record.location_name || "呆呆獸水溝蓋照片";
    number.textContent = `NO. ${records.length - index}`;
    title.textContent = record.location_name || "沒有寫地點的神秘呆呆獸";
    message.textContent = record.message || "今天什麼都沒說，只負責發呆。";
    date.textContent = prettyDate(record.created_at);
    button.addEventListener("click", () => openDetail(record.id));

    galleryEl.appendChild(fragment);
  });
}

function placeholderImage(seed = "slowpoke") {
  const safe = encodeURIComponent(seed || "slowpoke");
  return `https://placehold.co/800x800/f7c9d8/493f43?text=${safe}`;
}

function openRecordForm() {
  resetForm();
  nextNumberEl.textContent = getTodayRecords().length + 1;
  recordDialog.showModal();
}

function resetForm() {
  recordForm.reset();
  currentPhotoDataUrl = "";
  currentCoords = null;
  photoPreview.hidden = true;
  photoPreview.src = "";
  photoPlaceholder.hidden = false;
  formStatus.textContent = "";
  locationStatus.textContent = "";
  saveButton.disabled = false;
  saveButton.textContent = "收服這隻呆呆獸";
}

async function compressImage(file, maxWidth = 1800, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  currentPhotoDataUrl = await compressImage(file);
  photoPreview.src = currentPhotoDataUrl;
  photoPreview.hidden = false;
  photoPlaceholder.hidden = true;
});

$("#useLocationButton").addEventListener("click", () => {
  if (!navigator.geolocation) {
    locationStatus.textContent = "這台裝置不支援定位。";
    return;
  }

  locationStatus.textContent = "正在找你的位置…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      currentCoords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      locationStatus.textContent = "位置已記錄。";
    },
    () => {
      locationStatus.textContent = "沒有取得位置，沒關係，仍然可以儲存。";
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

recordForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentPhotoDataUrl) {
    formStatus.textContent = "先放一張照片，這隻呆呆獸才不會隱形。";
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "收服中…";
  formStatus.textContent = "";

  try {
    const record = {
      id: crypto.randomUUID(),
      location_name: locationInput.value.trim(),
      message: messageInput.value.trim(),
      latitude: currentCoords?.latitude ?? null,
      longitude: currentCoords?.longitude ?? null,
      created_at: new Date().toISOString(),
      photo_url: currentPhotoDataUrl,
    };

    if (supabaseClient) {
      record.photo_url = await uploadPhotoToSupabase(record.id, currentPhotoDataUrl);
      const { data, error } = await supabaseClient
        .from("slowpoke_records")
        .insert(record)
        .select()
        .single();

      if (error) throw error;
      records.unshift(data);
    } else {
      records.unshift(record);
      saveLocalRecords();
    }

    render();
    recordDialog.close();
  } catch (error) {
    console.error(error);
    formStatus.textContent = `儲存失敗：${error.message || "請稍後再試"}`;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "收服這隻呆呆獸";
  }
});

async function uploadPhotoToSupabase(id, dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const path = `${localDateKey()}/${id}.jpg`;

  const { error } = await supabaseClient.storage
    .from(BUCKET_NAME)
    .upload(path, blob, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabaseClient.storage.from(BUCKET_NAME).getPublicUrl(path);
  return data.publicUrl;
}

function openDetail(id) {
  const record = records.find((item) => String(item.id) === String(id));
  if (!record) return;

  selectedRecordId = record.id;
  $("#detailImage").src = record.photo_url || placeholderImage(record.location_name);
  $("#detailNumber").textContent = `SLOWPOKE RECORD`;
  $("#detailLocation").textContent = record.location_name || "神秘地點";
  $("#detailMessage").textContent = record.message || "今天什麼都沒說，只負責發呆。";
  $("#detailDate").textContent = prettyDate(record.created_at);
  detailDialog.showModal();
}

$("#deleteButton").addEventListener("click", async () => {
  if (!selectedRecordId) return;
  const ok = confirm("真的要刪除這筆呆呆獸紀錄嗎？");
  if (!ok) return;

  if (supabaseClient) {
    const { error } = await supabaseClient
      .from("slowpoke_records")
      .delete()
      .eq("id", selectedRecordId);
    if (error) {
      alert(`刪除失敗：${error.message}`);
      return;
    }
  }

  records = records.filter((item) => String(item.id) !== String(selectedRecordId));
  if (!supabaseClient) saveLocalRecords();
  detailDialog.close();
  render();
});

$("#shareButton").addEventListener("click", async () => {
  const count = getTodayRecords().length;
  const text = `今天收服了 ${count} 隻呆呆獸！發呆進度非常優秀。`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "今天的呆呆獸戰績", text });
    } else {
      await navigator.clipboard.writeText(text);
      alert("戰績已複製！");
    }
  } catch {
    // 使用者取消分享時不顯示錯誤
  }
});

$("#openFormButton").addEventListener("click", openRecordForm);
$("#settingsButton").addEventListener("click", () => {
  const config = getConfig();
  $("#supabaseUrlInput").value = config.url || "";
  $("#supabaseKeyInput").value = config.key || "";
  $("#settingsStatus").textContent = "";
  settingsDialog.showModal();
});

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = $("#supabaseUrlInput").value.trim();
  const key = $("#supabaseKeyInput").value.trim();

  if ((url && !key) || (!url && key)) {
    $("#settingsStatus").textContent = "URL 和 anon key 要一起填，或一起留白。";
    return;
  }

  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, key }));
  configureSupabase();
  $("#settingsStatus").textContent = url ? "已儲存，正在重新讀取雲端資料。" : "已切換成本機模式。";
  await loadRecords();
  setTimeout(() => settingsDialog.close(), 700);
});

$("#clearCloudButton").addEventListener("click", async () => {
  localStorage.removeItem(CONFIG_KEY);
  $("#supabaseUrlInput").value = "";
  $("#supabaseKeyInput").value = "";
  configureSupabase();
  $("#settingsStatus").textContent = "已切換成本機模式。";
  await loadRecords();
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => {
    document.getElementById(button.dataset.close).close();
  });
});

configureSupabase();
loadRecords();
