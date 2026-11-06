import { useState, useEffect, useMemo, Fragment } from 'react'
import { loadPage, loadLogs, savePage, SaveBar, AdjustLog, LoadError, Toast } from '../lib/pageSave'
import { wdOf, mdOf, todayIso, DEFAULT_MAIN, DEFAULT_SUB } from '../lib/flavors'

// ── 品項分類（庫存狀況、生產排程也從這裡拿）──
// 主產品以外的分類可以自己新增；「其他品項」是預設分類，不能刪
export const OTHER_CAT = '其他品項'
export const DEFAULT_CATS = [OTHER_CAT, '代工品']
export const catOf = r => (r.isMain ? '' : (r.cat || OTHER_CAT))
// main：主產品（計入銷售比、滿福合計）；sub：其他所有分類（照分類順序）；groups：各分類與品項
export function flavorGroups(saleData, cats) {
  if (Array.isArray(saleData) && saleData.length) {
    const main = saleData.filter(r => r.isMain).map(r => r.f)
    const order = [...new Set([OTHER_CAT, ...(cats || []), ...saleData.filter(r => !r.isMain).map(catOf)])]
    const groups = order.map(name => ({ name, items: saleData.filter(r => !r.isMain && catOf(r) === name).map(r => r.f) })).filter(g => g.items.length)
    const sub = groups.flatMap(g => g.items)
    return { main, sub, all: [...main, ...sub], groups }
  }
  return { main: DEFAULT_MAIN, sub: DEFAULT_SUB, all: [...DEFAULT_MAIN, ...DEFAULT_SUB], groups: [{ name: OTHER_CAT, items: DEFAULT_SUB }] }
}

// 預設值（同 Excel「1.銷售計劃」的口味與順序）；有存檔就以存檔為準
const INIT_SALE = [
  { f: '黃金', d: 83, m: 1716, isMain: true }, { f: '泡菜', d: 38, m: 638, isMain: true },
  { f: '咖哩', d: 11, m: 347, isMain: true },  { f: '素花', d: 60, m: 1194, isMain: true },
  { f: '新鮮', d: 41, m: 571, isMain: true },  { f: '剝皮', d: 53, m: 888, isMain: true },
  { f: '酸白', d: 28, m: 424, isMain: true },  { f: '原味', d: 44, m: 337, isMain: true },
  { f: '綠蔬', d: 25, m: 337, isMain: false },
  { f: '紅燒', d: 4,  m: 100, isMain: false }, { f: '藥膳', d: 1,  m: 30,  isMain: false },
  { f: '香羹', d: 6,  m: 100, isMain: false }, { f: '珍菇', d: 2,  m: 50,  isMain: false },
  { f: '猴菇', d: 1,  m: 50,  isMain: false }, { f: '油飯', d: 3,  m: 50,  isMain: false },
]

const INIT_EVENTS = [
  { id: 1, name: '農曆過年', start: '2027-01-15', end: '2027-02-05', mult: 1.8, items: [] },
  { id: 2, name: '中秋節',   start: '2026-09-15', end: '2026-09-29', mult: 1.5, items: [] },
]

let _cid = 0
const cid = () => `c${Date.now().toString(36)}${(_cid++).toString(36)}`

// 存檔前統一轉成數字，方便比對與存放
// cat：主產品以外的分類（其他品項／代工品／自訂）；cats：分類清單（「其他品項」固定在第一個）
const normCats = (cats, rows) => [...new Set([OTHER_CAT, ...(cats || []).map(c => String(c || '').trim()).filter(Boolean), ...rows.filter(r => !r.isMain).map(catOf)])]
const norm = (saleData, events, confirmed, cats) => {
  const rows = saleData.map(r => (r.isMain
    ? { f: r.f, d: Number(r.d) || 0, m: Number(r.m) || 0, isMain: true }
    : { f: r.f, d: Number(r.d) || 0, m: Number(r.m) || 0, isMain: false, cat: catOf(r) }))
  return { ...normRest(events, confirmed), saleData: rows, cats: normCats(cats, rows) }
}
const normRest = (events, confirmed) => ({
  events: events.map(e => ({ id: e.id, name: e.name || '', start: e.start || '', end: e.end || '', mult: Number(e.mult) || 0, items: e.items || [] })),
  confirmed: (confirmed || []).map(c => ({ id: c.id, date: c.date || '', f: c.f || '', qty: Number(c.qty) || 0, note: c.note || '' }))
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')),
})
const catLabel = r => (r.isMain ? '主產品' : catOf(r))

// 比對上次存檔與目前內容，產生「調整了什麼」的文字
function diffSales(prev, cur) {
  const out = []
  const pm = Object.fromEntries(prev.saleData.map(r => [r.f, r]))
  const cm = Object.fromEntries(cur.saleData.map(r => [r.f, r]))
  cur.saleData.forEach(r => {
    const o = pm[r.f]
    if (!o) { out.push(`新增口味「${r.f}」（${catLabel(r)}，每日預估 ${r.d}、最低庫存 ${r.m}）`); return }
    if (catLabel(o) !== catLabel(r)) out.push(`${r.f} 分類 ${catLabel(o)} → ${catLabel(r)}`)
    if (o.d !== r.d) out.push(`${r.f} 每日預估 ${o.d} → ${r.d}`)
    if (o.m !== r.m) out.push(`${r.f} 最低庫存 ${o.m} → ${r.m}`)
  })
  prev.saleData.forEach(r => { if (!cm[r.f]) out.push(`刪除口味「${r.f}」`) })
  const pCats = prev.cats || [], cCats = cur.cats || []
  cCats.forEach(c => { if (!pCats.includes(c)) out.push(`新增分類「${c}」`) })
  pCats.forEach(c => { if (!cCats.includes(c)) out.push(`刪除分類「${c}」`) })

  const evText = e => `${e.name || '（未命名）'}（${e.start || '?'}～${e.end || '?'}，×${e.mult}${e.items.length ? '，' + e.items.join('、') : ''}）`
  const sameEv = (a, b) => a.name === b.name && a.start === b.start && a.end === b.end && a.mult === b.mult && a.items.join('|') === b.items.join('|')
  const pe = Object.fromEntries(prev.events.map(e => [e.id, e]))
  const ce = Object.fromEntries(cur.events.map(e => [e.id, e]))
  cur.events.forEach(e => {
    const o = pe[e.id]
    if (!o) out.push(`新增活動 ${evText(e)}`)
    else if (!sameEv(o, e)) out.push(`修改活動 ${evText(o)} → ${evText(e)}`)
  })
  prev.events.forEach(e => { if (!ce[e.id]) out.push(`刪除活動「${e.name}」`) })

  const cText = c => `${c.date ? mdOf(c.date) : '?'} ${c.f || '?'} ${c.qty} 包${c.note ? `（${c.note}）` : ''}`
  const sameC = (a, b) => a.date === b.date && a.f === b.f && a.qty === b.qty && a.note === b.note
  const pc = Object.fromEntries((prev.confirmed || []).map(c => [c.id, c]))
  const cc = Object.fromEntries((cur.confirmed || []).map(c => [c.id, c]))
  ;(cur.confirmed || []).forEach(c => {
    const o = pc[c.id]
    if (!o) out.push(`新增已確定銷售 ${cText(c)}`)
    else if (!sameC(o, c)) out.push(`修改已確定銷售 ${cText(o)} → ${cText(c)}`)
  })
  ;(prev.confirmed || []).forEach(c => { if (!cc[c.id]) out.push(`刪除已確定銷售 ${cText(c)}`) })
  return out
}

export default function SalesPage() {
  const [saleData, setSaleData] = useState(INIT_SALE)
  const [newFlavor, setNewFlavor] = useState('')
  const [newCat, setNewCat] = useState('main') // 新增口味要放的分類：'main'＝主產品
  const [cats, setCats] = useState(DEFAULT_CATS) // 主產品以外的分類
  const [addingCat, setAddingCat] = useState(false)
  const [catDraft, setCatDraft] = useState('')
  const [renaming, setRenaming] = useState(null) // { from, to }
  const [events, setEvents] = useState(INIT_EVENTS)
  const [editEvt, setEditEvt] = useState(null)
  const [confirmed, setConfirmed] = useState([])

  // 存檔相關
  const [saved, setSaved] = useState(() => norm(INIT_SALE, INIT_EVENTS, [], DEFAULT_CATS))
  const [lastSaved, setLastSaved] = useState(null)
  const [logs, setLogs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const flash = m => { setToast(m); setTimeout(() => setToast(null), 2500) }

  useEffect(() => {
    (async () => {
      const { data, error } = await loadPage('sales')
      if (error) { setLoadError(error.message); return }
      if (data?.data) {
        // 舊資料沒有分類清單 → 用預設（其他品項、代工品），不算修改
        const n = norm(data.data.saleData || INIT_SALE, data.data.events || INIT_EVENTS, data.data.confirmed || [], data.data.cats || DEFAULT_CATS)
        setSaleData(n.saleData); setEvents(n.events); setConfirmed(n.confirmed); setCats(n.cats); setSaved(n); setLastSaved(data.updated_at)
      }
      const lg = await loadLogs('sales')
      setLogs(lg.data)
      setLoaded(true)
    })()
  }, [])

  const current = useMemo(() => norm(saleData, events, confirmed, cats), [saleData, events, confirmed, cats])
  const changes = useMemo(() => diffSales(saved, current), [saved, current])
  const dirty = loaded && changes.length > 0

  const onSave = async () => {
    if (!loaded) return
    if (changes.length === 0 && lastSaved) { flash('沒有需要存檔的變更'); return }
    const ch = changes.length ? changes : ['首次存檔（沿用預設數值）']
    setSaving(true)
    const r = await savePage('sales', current, ch)
    setSaving(false)
    if (r.error) { alert('存檔失敗：' + r.error.message); return }
    setSaved(current); setLastSaved(r.savedAt); setConfirmed(current.confirmed); setCats(current.cats)
    setLogs(l => [{ id: 'new-' + r.savedAt, created_at: r.savedAt, changes: ch }, ...l].slice(0, 50))
    flash('已存檔 ✅')
  }
  const saveBar = <SaveBar lastSaved={lastSaved} dirty={dirty} saving={saving} disabled={!loaded} onSave={onSave} />

  const allFlavors = saleData.map(r => r.f)
  // 每列帶著自己在 saleData 的原始位置 i，新增口味後主/副產品才不會對錯列（改到紅燒、刪錯列）
  const rowsWithIdx = saleData.map((r, i) => ({ ...r, i }))
  const mainRows = rowsWithIdx.filter(r => r.isMain)
  const catRows = c => rowsWithIdx.filter(r => !r.isMain && catOf(r) === c)

  const update = (i, k, v) => setSaleData(d => { const n = [...d]; n[i] = { ...n[i], [k]: v }; return n })
  const addFlavor = () => {
    const name = newFlavor.trim()
    if (!name) return
    if (saleData.some(r => r.f === name)) { alert(`「${name}」已經在清單裡了`); return }
    const isMain = newCat === 'main'
    setSaleData(d => {
      // 主產品插在最後一個主產品後面，其他分類放最後，維持「主產品在前」的順序
      const row = isMain ? { f: name, d: 0, m: 0, isMain: true } : { f: name, d: 0, m: 0, isMain: false, cat: newCat }
      if (!isMain) return [...d, row]
      const last = d.map(r => r.isMain).lastIndexOf(true)
      return [...d.slice(0, last + 1), row, ...d.slice(last + 1)]
    })
    setNewFlavor('')
  }

  // ── 分類：新增／改名／刪除；每個口味可以換分類 ──
  const addCat = () => {
    const name = catDraft.trim()
    if (!name) return
    if (name === '主產品' || cats.includes(name)) { alert(`「${name}」這個分類已經有了`); return }
    setCats(cs => [...cs, name]); setNewCat(name); setAddingCat(false); setCatDraft('')
  }
  const renameCat = () => {
    const { from } = renaming, to = renaming.to.trim()
    if (!to || to === from) { setRenaming(null); return }
    if (to === '主產品' || cats.includes(to)) { alert(`「${to}」這個分類已經有了`); return }
    setCats(cs => cs.map(c => (c === from ? to : c)))
    setSaleData(d => d.map(r => (!r.isMain && catOf(r) === from ? { ...r, cat: to } : r)))
    if (newCat === from) setNewCat(to)
    setRenaming(null)
  }
  const delCat = c => {
    const n = catRows(c).length
    if (n && !confirm(`「${c}」裡還有 ${n} 個品項，刪除分類後會移到「${OTHER_CAT}」。確定刪除？`)) return
    setSaleData(d => d.map(r => (!r.isMain && catOf(r) === c ? { ...r, cat: OTHER_CAT } : r)))
    setCats(cs => cs.filter(x => x !== c))
    if (newCat === c) setNewCat('main')
  }
  const setRowCat = (i, v) => {
    const r = saleData[i]
    if ((v === 'main') !== !!r.isMain) {
      const msg = v === 'main'
        ? `「${r.f}」改成主產品：會計入銷售比和滿福合計，其他主產品的庫存上限也會跟著變。確定？`
        : `「${r.f}」改成「${v}」：不再計入銷售比和滿福合計，庫存上限要到「庫存狀況」手動填。確定？`
      if (!confirm(msg)) return
    }
    setSaleData(d => d.map((x, j) => (j !== i ? x : v === 'main' ? { f: x.f, d: x.d, m: x.m, isMain: true } : { ...x, isMain: false, cat: v })))
  }

  const updConf = (id, k, v) => setConfirmed(cs => cs.map(c => c.id === id ? { ...c, [k]: v } : c))
  const today = todayIso()
  const confTotal = confirmed.filter(c => c.date >= today).reduce((s, c) => s + (Number(c.qty) || 0), 0)

  // 注意：用 {SaleRows({...})} 呼叫，不要寫成 <SaleRows/>，否則每打一個字整列重建、游標跳掉
  const SaleRows = ({ rows, title, cat }) => (
    <>
      <tr><td colSpan={5} className="sec-head">
        {renaming?.from === cat ? (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="inp" autoFocus value={renaming.to} onChange={e => setRenaming(x => ({ ...x, to: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') renameCat(); if (e.key === 'Escape') setRenaming(null) }}
              style={{ width: 150, fontSize: 14 }} aria-label="分類新名稱" />
            <button className="btn btn-dark btn-sm" onClick={renameCat} style={{ fontSize: 12 }}>確定</button>
            <button className="btn btn-sm" onClick={() => setRenaming(null)} style={{ fontSize: 12 }}>取消</button>
          </span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {title}<span style={{ fontWeight: 400 }}>（{rows.length}）</span>
            {cat !== 'main' && cat !== OTHER_CAT && (
              <>
                <button className="sa-cat-btn" onClick={() => setRenaming({ from: cat, to: cat })}>改名</button>
                <button className="sa-cat-btn sa-cat-del" onClick={() => delCat(cat)}>刪除分類</button>
              </>
            )}
          </span>
        )}
      </td></tr>
      {rows.length === 0 && (
        <tr><td colSpan={5} style={{ fontSize: 13, color: '#94a3b8', padding: '8px 12px' }}>還沒有品項：下面新增口味時選「{title}」，或把現有口味的分類改成「{title}」。</td></tr>
      )}
      {rows.map(r => {
        const i = r.i
        return (
          <tr key={r.f}>
            <td style={{ fontWeight: 700, fontSize: 16 }}>{r.f}</td>
            <td>
              <select className="inp" value={r.isMain ? 'main' : catOf(r)} onChange={e => setRowCat(i, e.target.value)}
                style={{ width: 110, fontSize: 13 }} aria-label={`${r.f} 分類`}>
                <option value="main">主產品</option>
                {cats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </td>
            <td style={{ textAlign: 'right' }}>
              <input
                type="number" step="0.001" value={r.d}
                onChange={e => update(i, 'd', e.target.value)}
                className="inp" style={{ width: 90, textAlign: 'right', fontSize: 16 }}
              />
              <span style={{ fontSize: 14, color: '#94a3b8', marginLeft: 4 }}>包</span>
            </td>
            <td style={{ textAlign: 'right' }}>
              <input
                type="number" step="1" value={r.m}
                onChange={e => update(i, 'm', e.target.value)}
                className="inp" style={{ width: 90, textAlign: 'right', fontSize: 16 }}
              />
              <span style={{ fontSize: 14, color: '#94a3b8', marginLeft: 4 }}>包</span>
            </td>
            <td style={{ textAlign: 'center' }}>
              <button className="btn btn-sm btn-red" onClick={() => setSaleData(d => d.filter((_, j) => j !== i))}>刪</button>
            </td>
          </tr>
        )
      })}
    </>
  )

  return (
    <div>
      <style>{`
        .sa-cat-btn { font-size: 12px; font-weight: 700; color: #475569; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 2px 8px; cursor: pointer; font-family: inherit; letter-spacing: 0; }
        .sa-cat-btn:hover { background: #f1f5f9; }
        .sa-cat-del { color: #b91c1c; border-color: #fecaca; }
        .sa-cat-del:hover { background: #fef2f2; }
      `}</style>
      <Toast msg={toast} />
      <LoadError error={loadError} />

      {/* 每日預估 + 最低庫存 */}
      <div className="card">
        <div className="card-title" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span>每日預估銷售量 ／ 最低庫存量 <span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 400 }}>銷貨科填寫 · 單位：包</span></span>
          {saveBar}
        </div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8, lineHeight: 1.7 }}>
          每日預估＝生產排程每天扣掉的量；最低庫存＝生產排程低於這個數字會亮紅燈。主產品會計入「銷售比」與「滿福合計」；其他分類（其他品項、代工品、自己新增的）不計入。
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th style={{ fontSize: 14 }}>口味</th>
              <th style={{ fontSize: 14 }}>分類</th>
              <th style={{ textAlign: 'right', fontSize: 14 }}>每日預估（包）</th>
              <th style={{ textAlign: 'right', fontSize: 14 }}>最低庫存（包）</th>
              <th style={{ width: 55, textAlign: 'center', fontSize: 14 }}>操作</th>
            </tr></thead>
            <tbody>
              {SaleRows({ rows: mainRows, title: '主產品（水餃・餡餅・湯包）', cat: 'main' })}
              {cats.map(c => <Fragment key={c}>{SaleRows({ rows: catRows(c), title: c, cat: c })}</Fragment>)}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
          <input type="text" value={newFlavor} onChange={e => setNewFlavor(e.target.value)}
            placeholder="新增口味名稱（新品直接輸入）" className="inp"
            style={{ flex: 1, minWidth: 180, fontSize: 15 }} onKeyDown={e => e.key === 'Enter' && addFlavor()} />
          <select className="inp" value={addingCat ? '__new' : newCat} aria-label="新口味的分類"
            onChange={e => { if (e.target.value === '__new') { setAddingCat(true); setCatDraft('') } else { setNewCat(e.target.value); setAddingCat(false) } }}
            style={{ fontSize: 14, width: 170 }}>
            <option value="main">主產品（計入銷售比）</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
            <option value="__new">＋ 新增分類…</option>
          </select>
          <button className="btn btn-dark btn-sm" onClick={addFlavor} style={{ fontSize: 14 }}>新增口味</button>
          {addingCat && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', width: '100%', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, padding: '8px 10px' }}>
              <span style={{ fontSize: 13, color: '#475569', fontWeight: 700 }}>新增分類</span>
              <input className="inp" autoFocus value={catDraft} onChange={e => setCatDraft(e.target.value)} placeholder="分類名稱（例：外銷品）"
                onKeyDown={e => { if (e.key === 'Enter') addCat(); if (e.key === 'Escape') setAddingCat(false) }} style={{ width: 180, fontSize: 14 }} aria-label="新分類名稱" />
              <button className="btn btn-dark btn-sm" onClick={addCat} style={{ fontSize: 13 }}>新增分類</button>
              <button className="btn btn-sm" onClick={() => setAddingCat(false)} style={{ fontSize: 13 }}>取消</button>
              <span style={{ fontSize: 12, color: '#94a3b8', width: '100%' }}>主產品以外的分類都不計入銷售比，庫存上限在「庫存狀況」手動填。記得按 💾 存檔。</span>
            </div>
          )}
        </div>
        <AdjustLog logs={logs} />
      </div>

      {/* 已確定的銷售量（同 Excel） */}
      <div className="card">
        <div className="card-title" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span>已確定的銷售量 <span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 400 }}>客戶已訂貨 · 單位：包</span></span>
          {saveBar}
        </div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8, lineHeight: 1.7 }}>
          生產排程會在出貨日當天，<strong>除了每日預估之外再扣掉</strong>這裡的數量（同 Excel 公式）。只要填會超出平常銷量的訂單，避免重複扣。
          {confTotal > 0 && <> 今天以後合計 <strong style={{ color: '#1e293b' }}>{confTotal.toLocaleString()} 包</strong>。</>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th style={{ fontSize: 14 }}>出貨日期</th>
              <th style={{ fontSize: 14 }}>口味</th>
              <th style={{ textAlign: 'right', fontSize: 14 }}>數量（包）</th>
              <th style={{ fontSize: 14 }}>客戶／備註</th>
              <th style={{ width: 55, textAlign: 'center', fontSize: 14 }}>操作</th>
            </tr></thead>
            <tbody>
              {confirmed.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: 16 }}>目前沒有已確定的銷售量</td></tr>
              )}
              {confirmed.map(c => {
                const past = c.date && c.date < today
                return (
                  <tr key={c.id} style={{ opacity: past ? 0.5 : 1 }}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <input type="date" className="inp" value={c.date} onChange={e => updConf(c.id, 'date', e.target.value)} style={{ width: 150, fontSize: 14 }} />
                      <span style={{ fontSize: 13, color: '#94a3b8', marginLeft: 6 }}>{wdOf(c.date)}{past ? ' · 已過' : ''}</span>
                    </td>
                    <td>
                      <select className="inp" value={c.f} onChange={e => updConf(c.id, 'f', e.target.value)} style={{ width: 110, fontSize: 14 }}>
                        <option value="">選擇口味</option>
                        {allFlavors.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input type="number" step="1" className="inp" value={c.qty} onChange={e => updConf(c.id, 'qty', e.target.value)} style={{ width: 90, textAlign: 'right', fontSize: 15 }} />
                    </td>
                    <td>
                      <input type="text" className="inp" value={c.note} onChange={e => updConf(c.id, 'note', e.target.value)} placeholder="例：麗合 11月大單" style={{ width: '100%', minWidth: 140, fontSize: 14 }} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-sm btn-red" onClick={() => setConfirmed(cs => cs.filter(x => x.id !== c.id))}>刪</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button className="btn btn-sm" onClick={() => setConfirmed(cs => [...cs, { id: cid(), date: '', f: '', qty: '', note: '' }])}
          style={{ marginTop: 10, borderStyle: 'dashed', width: '100%', fontSize: 14 }}>+ 新增一筆已確定銷售</button>
      </div>

      {/* 節日加乘 */}
      <div className="card">
        <div className="card-title" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span>節日 ／ 活動加乘設定 <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 400 }}>活動期間每日預估 × 倍率</span></span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {saveBar}
            <button className="btn btn-dark btn-sm" style={{ fontSize: 14 }}
              onClick={() => setEditEvt({ id: Date.now(), name: '', start: '', end: '', mult: 1.5, items: [] })}>
              + 新增活動
            </button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th style={{ fontSize: 14 }}>活動名稱</th>
              <th style={{ fontSize: 14 }}>開始</th>
              <th style={{ fontSize: 14 }}>結束</th>
              <th style={{ fontSize: 14 }}>加乘</th>
              <th style={{ fontSize: 14 }}>影響口味</th>
              <th style={{ width: 80 }}>操作</th>
            </tr></thead>
            <tbody>
              {events.map((ev, i) => (
                <tr key={ev.id}>
                  <td style={{ fontWeight: 700, fontSize: 16 }}>{ev.name}</td>
                  <td style={{ fontSize: 15, color: '#64748b' }}>{ev.start}</td>
                  <td style={{ fontSize: 15, color: '#64748b' }}>{ev.end}</td>
                  <td><span className="bdg" style={{ background: '#fef3c7', color: '#92400e', fontSize: 14 }}>×{ev.mult}</span></td>
                  <td style={{ fontSize: 15, color: '#64748b' }}>{ev.items.length === 0 ? '全品項' : ev.items.join('、')}</td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm" style={{ fontSize: 13 }} onClick={() => setEditEvt({ ...ev })}>編輯</button>
                    <button className="btn btn-sm btn-red" style={{ fontSize: 13 }} onClick={() => setEvents(e => e.filter((_, j) => j !== i))}>刪</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 活動編輯 Modal */}
      {editEvt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 18 }}>活動設定</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[{ label: '活動名稱', key: 'name', type: 'text' }, { label: '開始日期', key: 'start', type: 'date' }, { label: '結束日期', key: 'end', type: 'date' }, { label: '加乘倍率', key: 'mult', type: 'number' }].map(f => (
                <div key={f.key}>
                  <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4, fontWeight: 700 }}>{f.label}</div>
                  <input type={f.type} step={f.type === 'number' ? '0.1' : undefined} value={editEvt[f.key]}
                    onChange={e => setEditEvt(ev => ({ ...ev, [f.key]: f.type === 'number' ? +e.target.value : e.target.value }))}
                    className="inp" style={{ fontSize: 15 }} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6, fontWeight: 700 }}>影響口味（不選 = 全品項）</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {allFlavors.map(f => {
                    const sel = editEvt.items.includes(f)
                    return (
                      <button key={f} onClick={() => setEditEvt(ev => ({ ...ev, items: sel ? ev.items.filter(x => x !== f) : [...ev.items, f] }))}
                        style={{ fontSize: 13, padding: '4px 12px', borderRadius: 20, border: '1px solid', background: sel ? '#1e293b' : '#fff', color: sel ? '#fff' : '#475569', borderColor: sel ? '#1e293b' : '#e2e8f0', cursor: 'pointer' }}>
                        {f}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn" style={{ flex: 1, fontSize: 15 }} onClick={() => setEditEvt(null)}>取消</button>
              <button className="btn btn-dark" style={{ flex: 2, fontSize: 15 }} onClick={() => {
                setEvents(ev => { const idx = ev.findIndex(e => e.id === editEvt.id); if (idx >= 0) { const n = [...ev]; n[idx] = editEvt; return n } return [...ev, editEvt] })
                setEditEvt(null)
              }}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
