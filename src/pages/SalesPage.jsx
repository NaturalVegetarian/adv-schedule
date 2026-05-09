import { useState } from 'react'

const INIT_SALE = [
  { f: '黃金', d: 83, m: 1716, isMain: true }, { f: '泡菜', d: 38, m: 638, isMain: true },
  { f: '咖哩', d: 11, m: 347, isMain: true },  { f: '素花', d: 60, m: 1194, isMain: true },
  { f: '新鮮', d: 41, m: 571, isMain: true },  { f: '剝皮', d: 53, m: 888, isMain: true },
  { f: '酸白', d: 28, m: 424, isMain: true },  { f: '原味', d: 44, m: 337, isMain: true },
  { f: '紅燒', d: 4,  m: 100, isMain: false }, { f: '藥膳', d: 1,  m: 30,  isMain: false },
  { f: '珍菇', d: 2,  m: 50,  isMain: false }, { f: '香薑', d: 6,  m: 100, isMain: false },
  { f: '猴菇', d: 1,  m: 50,  isMain: false }, { f: '油飯', d: 3,  m: 50,  isMain: false },
]

const INIT_EVENTS = [
  { id: 1, name: '農曆過年', start: '2027-01-15', end: '2027-02-05', mult: 1.8, items: [] },
  { id: 2, name: '中秋節',   start: '2026-09-15', end: '2026-09-29', mult: 1.5, items: [] },
]

export default function SalesPage() {
  const [saleData, setSaleData] = useState(INIT_SALE)
  const [newFlavor, setNewFlavor] = useState('')
  const [events, setEvents] = useState(INIT_EVENTS)
  const [editEvt, setEditEvt] = useState(null)

  const allFlavors = saleData.map(r => r.f)
  const mainRows = saleData.filter(r => r.isMain)
  const subRows = saleData.filter(r => !r.isMain)

  const update = (i, k, v) => {
    const n = [...saleData]
    n[i] = { ...n[i], [k]: v }
    setSaleData(n)
  }
  const addFlavor = () => {
    if (!newFlavor.trim()) return
    setSaleData(d => [...d, { f: newFlavor.trim(), d: 0, m: 0, isMain: true }])
    setNewFlavor('')
  }

  const SaleRows = ({ rows, startIdx, title }) => (
    <>
      <tr><td colSpan={4} className="sec-head">{title}</td></tr>
      {rows.map((r, ri) => {
        const i = startIdx + ri
        return (
          <tr key={r.f}>
            <td style={{ fontWeight: 700, fontSize: 16 }}>{r.f}</td>
            <td style={{ textAlign: 'right' }}>
              <input
                type="number" step="0.001" value={r.d}
                onChange={e => update(i, 'd', parseFloat(e.target.value) || 0)}
                className="inp" style={{ width: 90, textAlign: 'right', fontSize: 16 }}
              />
              <span style={{ fontSize: 14, color: '#94a3b8', marginLeft: 4 }}>包</span>
            </td>
            <td style={{ textAlign: 'right' }}>
              <input
                type="number" step="1" value={r.m}
                onChange={e => update(i, 'm', parseFloat(e.target.value) || 0)}
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
      {/* 每日預估 + 最低庫存 */}
      <div className="card">
        <div className="card-title">
          每日預估銷售量 ／ 最低庫存量
          <span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 400 }}>行銷科填寫 · 單位：包</span>
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
              <SaleRows rows={mainRows} startIdx={0} title="主產品（水餃・餡餅・湯包）" />
              <SaleRows rows={subRows} startIdx={mainRows.length} title="副產品" />
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
          <input type="text" value={newFlavor} onChange={e => setNewFlavor(e.target.value)}
            placeholder="新增口味名稱（新品直接輸入）" className="inp"
            style={{ flex: 1, fontSize: 15 }} onKeyDown={e => e.key === 'Enter' && addFlavor()} />
          <button className="btn btn-dark btn-sm" onClick={addFlavor} style={{ fontSize: 14 }}>新增口味</button>
        </div>
      </div>

      {/* 節日加乘 */}
      <div className="card">
        <div className="card-title">
          節日 ／ 活動加乘設定
          <button className="btn btn-dark btn-sm" style={{ fontSize: 14 }}
            onClick={() => setEditEvt({ id: Date.now(), name: '', start: '', end: '', mult: 1.5, items: [] })}>
            + 新增活動
          </button>
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
