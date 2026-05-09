-- ============================================================
-- 生產排程整合系統 (adv_) 資料表
-- 在 Supabase SQL Editor 執行此檔案
-- ============================================================

-- 客訂訂單
CREATE TABLE IF NOT EXISTS adv_orders (
  id          text PRIMARY KEY,
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES profiles(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- 客訂欄位
  customer_name    text,
  item_name        text,
  quantity         integer DEFAULT 0,
  unit             text DEFAULT '袋',
  pieces_per_unit  numeric DEFAULT 250,
  logistics        text,
  box_type         text,
  items_per_box    integer DEFAULT 0,
  shipping_mark    boolean DEFAULT false,
  is_mixed_box     boolean DEFAULT false,
  target_date      text,
  scheduled_date   text,
  notes            text,

  -- 相容舊欄位名（camelCase）
  "customerName"   text GENERATED ALWAYS AS (customer_name) STORED,
  "itemName"       text GENERATED ALWAYS AS (item_name) STORED,
  "targetDate"     text GENERATED ALWAYS AS (target_date) STORED,
  "scheduledDate"  text GENERATED ALWAYS AS (scheduled_date) STORED,
  "piecesPerUnit"  numeric GENERATED ALWAYS AS (pieces_per_unit) STORED,
  "itemsPerBox"    integer GENERATED ALWAYS AS (items_per_box) STORED,
  "shippingMark"   boolean GENERATED ALWAYS AS (shipping_mark) STORED,
  "isMixedBox"     boolean GENERATED ALWAYS AS (is_mixed_box) STORED
);

-- 口味基準設定
CREATE TABLE IF NOT EXISTS adv_flavor_config (
  id          text PRIMARY KEY DEFAULT 'default',
  status      text DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES profiles(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  configs     jsonb DEFAULT '{}',
  items       jsonb DEFAULT '[]'
);

-- 排程資料
CREATE TABLE IF NOT EXISTS adv_schedule (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status      text DEFAULT 'draft',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES profiles(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  week_date   text,
  items       jsonb DEFAULT '[]'
);

-- 銷售計畫
CREATE TABLE IF NOT EXISTS adv_sales_plan (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status      text DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES profiles(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  plan_date   text,
  flavor      text,
  daily_est   numeric DEFAULT 0,
  min_stock   numeric DEFAULT 0,
  note        text
);

-- 菜價記錄
CREATE TABLE IF NOT EXISTS adv_veg_prices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status      text DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES profiles(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  record_date text,
  veg_name    text,
  price       numeric DEFAULT 0,
  threshold   numeric DEFAULT 50
);

-- 排程規則
CREATE TABLE IF NOT EXISTS adv_schedule_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status      text DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES profiles(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  sort_order  integer DEFAULT 0,
  rule_text   text
);

-- ============================================================
-- RLS 政策（允許已登入用戶讀寫）
-- ============================================================
ALTER TABLE adv_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_flavor_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_sales_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_veg_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_schedule_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can do all" ON adv_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated users can do all" ON adv_flavor_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated users can do all" ON adv_schedule FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated users can do all" ON adv_sales_plan FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated users can do all" ON adv_veg_prices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated users can do all" ON adv_schedule_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);
