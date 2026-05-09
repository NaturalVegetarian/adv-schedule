# 生產排程整合系統 (adv-schedule)

## 技術架構
- React + Vite
- Supabase（共用 nature-veg-system 專案，adv_ 前綴資料表）
- 部署在 Vercel

## 部署步驟

### 1. 建立 Supabase 資料表
到 Supabase Dashboard → SQL Editor，貼上 `supabase_setup.sql` 內容執行。

### 2. 上傳到 GitHub
把這個資料夾整個上傳到你的 GitHub 新 repository。

### 3. 部署到 Vercel
1. 到 vercel.com，Import 你的 GitHub repository
2. 在 Environment Variables 設定：
   - `VITE_SUPABASE_URL` = `https://gxpcnasitosnjgcxemcm.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `eyJhbGci...（完整的 anon key）`
3. Deploy！

### 4. 設定入口網站角色
部署完成後，把網址給入口管理員，在後台勾選允許使用此系統的角色：
- 管理員、主管、生產、銷貨、倉儲、採購

## 允許角色
管理員 / 主管 / 生產 / 銷貨 / 倉儲 / 採購

## 資料表
| 資料表 | 說明 |
|--------|------|
| adv_orders | 客訂訂單 |
| adv_flavor_config | 口味基準設定 |
| adv_schedule | 排程資料 |
| adv_sales_plan | 銷售計畫 |
| adv_veg_prices | 菜價記錄 |
| adv_schedule_rules | 排程規則 |
