*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: #1e293b;
  background: #f1f5f9;
  min-height: 100vh;
  -webkit-tap-highlight-color: transparent;
}

input, select, textarea, button {
  font-family: inherit;
}

input:focus, select:focus, textarea:focus { outline: none; }

/* 滾動條隱藏 */
.scrollbar-hide::-webkit-scrollbar { display: none; }
.scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }

/* 頁簽 */
.main-tabs {
  display: flex;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  overflow-x: auto;
  position: sticky;
  top: 46px;
  z-index: 40;
}
.main-tabs::-webkit-scrollbar { display: none; }
.main-tab {
  padding: 12px 18px;
  font-size: 13px;
  font-weight: 700;
  color: #94a3b8;
  border-bottom: 3px solid transparent;
  white-space: nowrap;
  cursor: pointer;
  transition: all .15s;
  flex-shrink: 0;
  user-select: none;
}
.main-tab.active { color: #1e293b; border-bottom-color: #1e293b; }
.main-tab:hover:not(.active) { color: #475569; background: #f8fafc; }

/* 通用卡片 */
.card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
}
.card-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
}

/* 輸入 */
.inp {
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  width: 100%;
  background: #fff;
  color: #1e293b;
  transition: border-color .15s;
}
.inp:focus { border-color: #94a3b8; }
select.inp { appearance: none; cursor: pointer; }
textarea.inp { resize: vertical; min-height: 52px; line-height: 1.5; }

/* 按鈕 */
.btn {
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
  cursor: pointer;
  font-weight: 700;
  transition: all .12s;
}
.btn:hover { background: #f8fafc; }
.btn-dark { background: #1e293b; color: #fff; border-color: #1e293b; }
.btn-dark:hover { background: #334155; }
.btn-sm { font-size: 11px; padding: 3px 9px; }
.btn-red { color: #ef4444; border-color: #fecaca; }
.btn-red:hover { background: #fef2f2; }
.btn-dashed { border-style: dashed; }

/* Badge */
.bdg {
  display: inline-flex;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 20px;
  font-weight: 700;
  white-space: nowrap;
}

/* 表格 */
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th {
  font-size: 10px; font-weight: 700; color: #64748b;
  padding: 6px 8px; border-bottom: 1px solid #f1f5f9;
  white-space: nowrap; background: #f8fafc; text-align: left;
}
.tbl td { padding: 6px 8px; border-bottom: 1px solid #f8fafc; vertical-align: middle; }
.tbl tr:last-child td { border-bottom: none; }
.tbl tbody tr:hover td { background: #f8fafc; }

/* section 標題 */
.sec-head {
  font-size: 10px; font-weight: 700; color: #94a3b8;
  letter-spacing: .05em; padding: 6px 8px;
  background: #fafafa; border-bottom: 1px solid #f1f5f9;
}

/* 庫存顏色 */
.c-full { background: #f0fdf4; } .c-full .cn { color: #166534; } .c-full .bf { background: #4ade80; }
.c-ok   { background: #f0fdf4; } .c-ok   .cn { color: #166534; } .c-ok   .bf { background: #86efac; }
.c-low  { background: #fefce8; } .c-low  .cn { color: #713f12; } .c-low  .bf { background: #fde047; }
.c-warn { background: #fff7ed; } .c-warn .cn { color: #7c2d12; } .c-warn .bf { background: #fb923c; }
.c-red  { background: #fef2f2; } .c-red  .cn { color: #7f1d1d; } .c-red  .bf { background: #f87171; }
.c-gray { background: #f8fafc; } .c-gray .cn { color: #475569; } .c-gray .bf { background: #cbd5e1; }

/* 排程表 */
.it { border-collapse: collapse; font-size: 11px; width: 100%; }
.it th {
  font-size: 10px; font-weight: 700; color: #64748b;
  padding: 4px 2px; border: 1px solid #e2e8f0;
  white-space: nowrap; text-align: center;
  background: #f8fafc; position: sticky; top: 0; z-index: 3;
}
.it th.hs { font-weight: 800; color: #1e293b; }
.dc {
  text-align: left; font-size: 10px; padding: 3px 6px;
  border: 1px solid #e2e8f0; white-space: nowrap;
  background: #f8fafc; position: sticky; left: 0; z-index: 2;
  min-width: 76px; color: #94a3b8;
}
.dc.sp { background: #f0fdf4; font-weight: 700; color: #166534; }
.dc.we { opacity: .4; }
.ic { padding: 3px 3px; border: 1px solid #e2e8f0; vertical-align: middle; min-width: 50px; }
.ci { display: flex; flex-direction: column; gap: 2px; align-items: flex-end; }
.cn { font-size: 11px; font-weight: 700; line-height: 1; }
.bw { width: 100%; height: 3px; border-radius: 2px; background: #f1f5f9; overflow: hidden; }
.bf { height: 100%; border-radius: 2px; }
.hp { outline: 2.5px solid #1e293b; outline-offset: -2px; border-radius: 1px; }
.msep td { border-top: 2.5px solid #94a3b8 !important; }

/* 領料 */
.pick-block {
  border: 1px solid #e2e8f0; border-radius: 10px;
  overflow: hidden; margin-bottom: 8px;
}
.pick-head {
  background: #f8fafc; padding: 9px 14px;
  display: flex; justify-content: space-between; align-items: center;
  border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; gap: 6px;
}
.big-date { font-size: 22px; font-weight: 700; line-height: 1.1; letter-spacing: -.5px; }
.big-sub { font-size: 11px; color: #94a3b8; margin-top: 3px; }
.erp-pill {
  font-family: monospace; font-size: 11px; color: #2563eb;
  background: #f8fafc; padding: 6px 10px; border-radius: 8px;
  word-break: break-all; margin-top: 5px;
}

/* AI */
.ag { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 7px; margin-top: 7px; }
.stl {
  font-size: 10px; font-weight: 700; color: #64748b;
  letter-spacing: .04em; margin: 10px 0 5px;
  padding-bottom: 3px; border-bottom: 1px solid #f1f5f9;
}

details summary {
  cursor: pointer; user-select: none; font-size: 11px;
  font-weight: 700; color: #64748b; padding: 5px 0; list-style: none;
}
details summary::-webkit-details-marker { display: none; }
details summary::before { content: '▶  '; font-size: 9px; color: #94a3b8; }
details[open] summary::before { content: '▼  '; }

.veg-row {
  display: grid; grid-template-columns: 1fr 78px 78px 50px 28px;
  gap: 5px; align-items: center; padding: 4px 0;
  border-bottom: 1px solid #f8fafc;
}
.veg-row:last-child { border-bottom: none; }

/* 頁面容器 */
.page-wrap { max-width: 1100px; margin: 0 auto; padding: 16px; }

/* 載入 */
.loader {
  border: 4px solid #f3f3f3; border-top: 4px solid #64748b;
  border-radius: 50%; width: 36px; height: 36px;
  animation: spin 1s linear infinite;
}
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
