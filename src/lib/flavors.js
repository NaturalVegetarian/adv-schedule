// 品項主檔：三頁共用（銷售計畫、庫存狀況、生產排程）
// 以「銷售計畫」為準：銷售計畫有存檔就用它的口味、順序與主/其他分類；沒有才用下面的預設
// 主產品＝計入銷售比與滿福合計（同 Excel 的 黃金～原味）

export const DEFAULT_MAIN = ['黃金', '泡菜', '咖哩', '素花', '新鮮', '剝皮', '酸白', '原味']
export const DEFAULT_SUB  = ['綠蔬', '紅燒', '藥膳', '香羹', '珍菇', '猴菇', '油飯']

// 各品項產量資訊（每桶幾包）— 同 Excel「4.各品項產量資訊表」
export const DEFAULT_PPB = {
  黃金: 240, 泡菜: 240, 咖哩: 240, 素花: 230, 新鮮: 320, 剝皮: 330, 酸白: 330, 原味: 400,
  綠蔬: 300, 紅燒: 87, 藥膳: 79, 珍菇: 77, 香羹: 105, 猴菇: 100, 油飯: 70,
}

export const DEFAULT_MAX_CAP = 12000 // 滿福產品最高庫容量（包）

export function flavorLists(saleData) {
  if (Array.isArray(saleData) && saleData.length) {
    const main = saleData.filter(r => r.isMain).map(r => r.f)
    const sub = saleData.filter(r => !r.isMain).map(r => r.f)
    return { main, sub, all: [...main, ...sub] }
  }
  return { main: DEFAULT_MAIN, sub: DEFAULT_SUB, all: [...DEFAULT_MAIN, ...DEFAULT_SUB] }
}

// 日期小工具（本機時間，格式 YYYY-MM-DD）
const pad = n => String(n).padStart(2, '0')
export const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseIso = s => { const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null }
export const addDays = (iso, n) => { const d = parseIso(iso); if (!d) return ''; d.setDate(d.getDate() + n); return isoOf(d) }
export const WD = ['日', '一', '二', '三', '四', '五', '六']
export const wdOf = iso => { const d = parseIso(iso); return d ? `週${WD[d.getDay()]}` : '' }
export const mdOf = iso => { const d = parseIso(iso); return d ? `${d.getMonth() + 1}/${d.getDate()}` : '' }
export const todayIso = () => isoOf(new Date())

// 舊資料的 M/D、YYYY/MM/DD 轉成 YYYY-MM-DD（M/D 自動判斷年份：距今超過半年視為跨年）
export function toIso(s) {
  const str = String(s || '').trim()
  if (!str) return ''
  let m = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return isoOf(new Date(+m[1], +m[2] - 1, +m[3]))
  m = str.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (m) {
    const now = new Date()
    let d = new Date(now.getFullYear(), +m[1] - 1, +m[2])
    const diff = (d - now) / 86400000
    if (diff < -183) d = new Date(now.getFullYear() + 1, +m[1] - 1, +m[2])
    else if (diff > 183) d = new Date(now.getFullYear() - 1, +m[1] - 1, +m[2])
    return isoOf(d)
  }
  return ''
}
