# 呆呆獸收集器：本機先玩、登入才備份版

## 這一版的完整流程

1. 所有人打開網站後都能免費使用，不需要先登入。
2. 第一次開啟時，網站只在手機產生一個固定的隨機收藏家名稱。
3. 未登入時，照片與文字只存於這台手機的 IndexedDB。
4. 收集第 3 筆後，網站詢問要不要用 Google 或 Apple 登入備份。
5. 登入後才建立 Supabase 雲端收藏家，並備份本機收藏。
6. 每個雲端帳戶最多 18 筆。
7. 登入後可修改收藏家名稱。
8. 收藏牆只載入約 520 px 的縮圖；點開紀錄後才載入長邊最多 1600 px 的大圖。
9. 不保存手機原始照片，也不保存精確經緯度。

## 照片處理規格

網站會在手機瀏覽器內先壓縮，再保存或上傳：

- 收藏牆縮圖：寬度約 520 px，程式盡量壓在 80 KB 以下。
- 點開後大圖：長邊最多 1600 px，程式盡量壓在 450 KB 以下。
- 格式：JPEG。
- 原始照片只用於當次壓縮，不寫入 IndexedDB 或 Supabase。

實際大小會依照片內容略有不同；純色或簡單照片可能小於預期範圍。

---

## 一、先建立 Supabase 專案

1. 登入 Supabase。
2. 建立一個新的 Project。
3. 打開 **SQL Editor → New query**。
4. 將 `supabase-local-first-backup-setup.sql` 全部貼上並按 **Run**。

SQL 會建立：

- 收藏家資料表
- 每人最多 18 筆的收藏紀錄
- 私人照片 bucket
- 每人只能查看自己資料的 RLS
- 雲端容量開關

Supabase Storage 的私人 bucket 與資料表都透過 RLS 保護；網站前端只能使用 Publishable key。

## 二、設定 Google／Apple 登入

### URL Configuration

Supabase → Authentication → URL Configuration：

- Site URL：填完整 GitHub Pages 網址
- Redirect URLs：加入相同網址

例如：

`https://你的帳號.github.io/slowpoke/`

### Google

1. 在 Google Cloud 建立 OAuth Web Client。
2. Google Authorized redirect URI 使用 Supabase 顯示的 callback URL：
   `https://你的-project-ref.supabase.co/auth/v1/callback`
3. 將 Client ID 與 Client Secret 填入 Supabase 的 Google Provider。
4. 啟用 Google Provider。

### Apple

Apple 網頁登入需要 Apple Developer 帳戶、Services ID、Key 等設定。完成後，把資料填入 Supabase 的 Apple Provider。

Apple 尚未設定時，可以先只測試 Google；Apple 按鈕會顯示登入方式未啟用。

## 三、填入網站的公開連線設定

到 Supabase 找到：

- Project URL
- Publishable key（舊專案可能叫 anon public key）

打開 `supabase-config.js`，改成：

```js
window.SLOWPOKE_SUPABASE_CONFIG = {
  url: "你的 Project URL",
  key: "你的 Publishable key",
};
```

不要放入 secret key 或 service_role key。

## 四、上傳 GitHub

把以下四個網站檔案上傳到 GitHub repository：

- `index.html`
- `styles-20260714-local-first-backup.css`
- `app-20260714-local-first-backup.js`
- `supabase-config.js`

舊的 CSS／JS 不需要刪除，新版 `index.html` 不會再讀它們。

Commit changes 後，等待 GitHub Pages 約 1～2 分鐘，再關掉 Safari 舊分頁並重新打開。

## 五、測試順序

1. 用無痕分頁打開網站。
2. 確認沒有先跳登入。
3. 新增第 1～3 筆收藏，確認只存在手機。
4. 第 3 筆完成後應跳出備份詢問。
5. 選 Google 登入並備份。
6. 回到網站後，應顯示備份進度，再開啟修改收藏家名稱。
7. 到 Supabase 檢查：
   - Table Editor → `slowpoke_records`
   - Storage → `slowpoke-photos`
8. 用另一台裝置選「已經備份過？找回原本的圖鑑」，登入同一帳號。
9. 確認收藏牆先載入縮圖，點開後才載入大圖。

## 六、雲端容量控制

網站已支援三種狀態：

- `open`：新使用者可以開通；既有使用者可以新增。
- `new_users_paused`：暫停新使用者；既有使用者仍可補到 18 筆。
- `all_uploads_paused`：暫停所有新增照片；既有使用者仍可查看、修改文字與刪除。

建議：

- 0～70%：`open`
- 約 70%：`new_users_paused`
- 約 80%：`all_uploads_paused`

使用 Supabase Dashboard 的 Usage / Storage 查看實際容量，再執行 `雲端容量切換.sql` 中對應指令。

**目前容量百分比不會自動從 Supabase 讀取。**這個版本會嚴格遵守資料庫中的開關，但需要管理者依 Dashboard 用量手動切換。若之後希望完全自動化，需要再加入具管理權限的排程 Edge Function；不能把管理金鑰放進 GitHub Pages。

## 七、幾個重要行為

- 未登入時，清除 Safari 網站資料或換手機後，本機收藏無法找回。
- 登入備份後，雲端最多 18 筆；達上限需先刪除一筆才能新增。
- 「找回原本圖鑑」不會自動把新手機上的本機資料合併進舊帳戶。
- 「登入並備份」若登入的是已有圖鑑的帳戶，會在 18 筆上限內合併本機中尚未存在的收藏。
- 本機資料備份成功後仍會留在原手機，作為本機副本；登入狀態下網站以雲端圖鑑為主。
