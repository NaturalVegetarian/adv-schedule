import { useState, useEffect, useMemo } from 'react'
import { loadPage, loadLogs, savePage, SaveBar, AdjustLog, LoadError, Toast } from '../lib/pageSave'
import { wdOf, mdOf, todayIso } from '../lib/flavors'

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
const norm = (saleData, events, confirmed) => ({
  saleData: saleData.map(r => ({ f: r.f, d: Number(r.d) || 0, m: Number(r.m) || 0, isMain: !!r.isMain })),
  events: events.map(e => ({ id: e.id, name: e.name || '', start: e.start || '', end: e.end || '', mult: Number(e.mult) || 0, items: e.items || [] })),
  confirmed: (confirmed || []).map(c => ({ id: c.id, date: c.date || '', f: c.f || '', qty: Number(c.qty) || 0, note: c.note || '' }))
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')),
})

// 比對上次存檔與目前內容，產生「調整了什麼」的文字
function diffSales(prev, cur) {
  const out = []
  const pm = Object.fromEntries(prev.saleData.map(r => [r.f, r]))
  const cm = Object.fromEntries(cur.saleData.map(r => [r.f, r]))
  cur.saleData.forEach(r => {
    const o = pm[r.f]
    if (!o) { out.push(`新增口味「${r.f}」（${r.isMain ? '主產品' : '其他'}，每日預估 ${r.d}、最低庫存 ${r.m}）`); return }
    if (o.d !== r.d) out.push(`${r.f} 每日預估 ${o.d} → ${r.d}`)
    if (o.m !== r.m) out.push(`${r.f} 最低庫存 ${o.m} → ${r.m}`)
  })
  prev.saleData.forEach(r => { if (!cm[r.f]) out.push(`刪除口味「${r.f}」`) })

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
  const [newIsMain, setNewIsMain] = useState(true)
  const [events, setEvents] = useState(INIT_EVENTS)
  const [editEvt, setEditEvt] = useState(null)
  const [confirmed, setConfirmed] = useState([])

  // 存檔相關
  const [saved, setSaved] = useState(() => norm(INIT_SALE, INIT_EVENTS, []))
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
        const n = norm(data.data.saleData || INIT_SALE, data.data.events || INIT_EVENTS, data.data.confirmed || [])
        setSaleData(n.saleData); setEvents(n.events); setConfirmed(n.confirmed); setSaved(n); setLastSaved(data.updated_at)
      }
      const lg = await loadLogs('sales')
      setLogs(lg.data)
      setLoaded(true)
    })()
  }, [])

  const current = useMemo(() => norm(saleData, events, confirmed), [saleData, events, confirmed])
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
    setSaved(current); setLastSaved(r.savedAt); setConfirmed(current.confirmed)
    setLogs(l => [{ id: 'new-' + r.savedAt, created_at: r.savedAt, changes: ch }, ...l].slice(0, 50))
    flash('已存檔 ✅')
  }
  const saveBar = <SaveBar lastSaved={lastSaved} dirty={dirty} saving={saving} disabled={!loaded} onSave={onSave} />

  const allFlavors = saleData.map(r => r.f)
  // 每列帶著自己在 saleData 的原始位置 i，新增口味後主/副產品才不會對錯列（改到紅燒、刪錯列）
  const rowsWithIdx = saleData.map((r, i) => ({ ...r, i }))
  const mainRows = rowsWithIdx.filter(r => r.isMain)
  const subRows = rowsWithIdx.filter(r => !r.isMain)

  const update = (i, k, v) => setSaleData(d => { const n = [...d]; n[i] = { ...n[i], [k]: v }; return n })
  const addFlavor = () => {
    const name = newFlavor.trim()
    if (!name) return
    if (saleData.some(r => r.f === name)) { alert(`「${name}」已經在清單裡了`); return }
    setSaleData(d => {
      // 主產品插在最後一個主產品後面，其他品項放最後，維持「主產品在前」的順序
      const row = { f: name, d: 0, m: 0, isMain: newIsMain }
      if (!newIsMain) return [...d, row]
      const last = d.map(r => r.isMain).lastIndexOf(true)
      return [...d.slice(0, last + 1), row, ...d.slice(last + 1)]
    })
    setNewFlavor('')
  }

  const updConf = (id, k, v) => setConfirmed(cs => cs.map(c => c.id === id ? { ...c, [k]: v } : c))
  const today = todayIso()
  const confTotal = confirmed.filter(c => c.date >= today).reduce((s, c) => s + (Number(c.qty) || 0), 0)

  // 注意：用 {SaleRows({...})} 呼叫，不要寫成 <SaleRows/>，否則每打一個字整列重建、游標跳掉
  const SaleRows = ({ rows, title }) => (
    <>
      <tr><td colSpan={4} className="sec-head">{title}</td></tr>
      {rows.map(r => {
        const i = r.i
        return (
          <tr key={r.f}>
            <td style={{ fontWeight: 700, fontSize: 16 }}>{r.f}</td>
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
      <Toast msg={toast} />
      <LoadError error={loadError} />

      {/* 每日預估 + 最低庫存 */}
      <div className="card">
        <div className="card-title" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span>每日預估銷售量 ／ 最低庫存量 <span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 400 }}>銷貨科填寫 · 單位：包</span></span>
          {saveBar}
        </div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8, lineHeight: 1.7 }}>
          每日預估＝生產排程每天扣掉的量；最低庫存＝生產排程低於這個數字會亮紅燈。主產品會計入「銷售比」與「滿福合計」。
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th style={{ fontSize: 14 }}>口味</th>
              <th style={{ textAlign: 'right', fontSize: 14 }}>每日預估（包）</th>
              <th style={{ textAlign: 'right', fontSize: 14 }}>最低庫存（包）</th>
              <th style={{ width: 55, textAlign: 'center', fontSize: 14 }}>操作</th>
            </tr></thead>
            <tbody>
              {SaleRows({ rows: mainRows, title: '主產品（水餃・餡餅・湯包）' })}
              {SaleRows({ rows: subRows, title: '其他品項' })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
          <input type="text" value={newFlavor} onChange={e => setNewFlavor(e.target.value)}
            placeholder="新增口味名稱（新品直接輸入）" className="inp"
            style={{ flex: 1, minWidth: 180, fontSize: 15 }} onKeyDown={e => e.key === 'Enter' && addFlavor()} />
          <select className="inp" value={newIsMain ? 'main' : 'sub'} onChange={e => setNewIsMain(e.target.value === 'main')} style={{ fontSize: 14, width: 150 }}>
            <option value="main">主產品（計入銷售比）</option>
            <option value="sub">其他品項</option>
          </select>
          <button className="btn btn-dark btn-sm" onClick={addFlavor} style={{ fontSize: 14 }}>新增口味</button>
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
