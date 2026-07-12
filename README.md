# 呆呆獸收集器

這是一個可以直接放到 GitHub Pages 的小網站。

## 已經完成的功能

- 顯示今天找到第幾隻
- 上傳或拍攝照片
- 輸入地點與一句話
- 選擇性保存 GPS 座標
- 收藏照片牆
- 查看與刪除紀錄
- 分享今天的收集戰績
- 支援 NFC 直接打開網站
- 本機模式：不設定任何後端即可使用
- 雲端模式：接上 Supabase 後可跨裝置同步

## 最快開始方式：先用本機模式

1. 把整個資料夾上傳到 GitHub repository。
2. 到 `Settings → Pages`。
3. Source 選 `Deploy from a branch`。
4. Branch 選 `main`，資料夾選 `/root`。
5. 等 GitHub Pages 網址出現。
6. 把這個網址寫進 NFC。

本機模式的紀錄會存在目前瀏覽器裡。

注意：清除 Safari 網站資料、換手機或換瀏覽器後，本機紀錄不會跟過去。

## 雲端同步：Supabase

1. 建立 Supabase project。
2. 打開 SQL Editor。
3. 執行 `supabase-schema.sql`。
4. 到 Storage 建立 `slowpoke-photos` bucket，設為 Public。
5. 到 `Project Settings → API` 複製：
   - Project URL
   - anon public key
6. 打開網站右上角齒輪。
7. 貼上 URL 與 anon key。

## 安全提醒

目前 SQL 是旅行自用的簡易版，持有網站與 anon key 的人可以新增或刪除資料。

若網站會公開分享，建議之後加入 Supabase Auth，再用登入帳號限制資料權限。

## NFC

把 GitHub Pages 網址寫入 NFC，例如：

`https://你的帳號.github.io/slowpoke-collector/`

iPhone 可使用 NFC Tools 寫入網址。

## 檔案

- `index.html`：頁面結構
- `styles.css`：外觀
- `app.js`：功能與資料儲存
- `supabase-schema.sql`：Supabase 資料表與權限
