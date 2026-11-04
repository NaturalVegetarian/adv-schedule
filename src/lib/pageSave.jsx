// 銷售計畫、庫存狀況共用：存檔到 Supabase ＋ 記錄每次調整的日期與內容
// 資料表：adv_page_config（各頁目前數值）、adv_adjust_log（調整紀錄）
import { supabase } from './supabase'

export const fmtDT = iso => {
  if (!iso) return ''
  const d = new Date(iso), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export async function loadPage(id) {
  return supabase.from('adv_page_config').select('*').eq('id', id).maybeSingle()
}

export async function loadLogs(page, limit = 50) {
  const { data, error } = await supabase.from('adv_adjust_log').select('*').eq('page', page)
    .order('created_at', { ascending: false }).limit(limit)
  return { data: data || [], error }
}

// 存目前數值，並寫一筆調整紀錄（changes 為文字陣列）
export async function savePage(id, payload, changes) {
  const now = new Date().toISOString()
  const r1 = await supabase.from('adv_page_config').upsert({ id, data: payload, updated_at: now })
  if (r1.error) return { error: r1.error }
  const r2 = await supabase.from('adv_adjust_log').insert({ page: id, changes, created_at: now })
  if (r2.error) return { error: r2.error }
  return { error: null, savedAt: now }
}

// 存檔列：上次調整日期、未存檔提示、存檔按鈕
export function SaveBar({ lastSaved, dirty, saving, disabled, onSave }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: '#64748b', fontWeight: 400 }}>
        上次調整：{lastSaved ? <strong style={{ color: '#1e293b' }}>{fmtDT(lastSaved)}</strong> : '尚未存檔'}
      </span>
      {dirty && <span style={{ fontSize: 13, color: '#c2410c', fontWeight: 700 }}>● 有未存檔的修改</span>}
      <button onClick={onSave} disabled={saving || disabled}
        style={{ fontSize: 14, background: saving || disabled ? '#94a3b8' : '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: saving || disabled ? 'default' : 'pointer', fontWeight: 700, fontFamily: 'inherit' }}>
        {saving ? '存檔中...' : '💾 存檔'}
      </button>
    </div>
  )
}

// 調整紀錄清單
export function AdjustLog({ logs }) {
  if (!logs || logs.length === 0) return null
  return (
    <details style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
      <summary style={{ fontSize: 14, fontWeight: 700, color: '#475569', cursor: 'pointer', userSelect: 'none' }}>
        📋 調整紀錄（最近 {logs.length} 次）
      </summary>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {logs.map(l => (
          <div key={l.id} style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>{fmtDT(l.created_at)}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
              {(Array.isArray(l.changes) ? l.changes : []).map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </details>
  )
}

// 讀取失敗提示（多半是資料表還沒建立）
export function LoadError({ error }) {
  if (!error) return null
  return (
    <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 14, color: '#7c2d12' }}>
      <strong>存檔功能暫時無法使用：</strong>{error}（第一次使用請先在 Supabase 建立 adv_page_config、adv_adjust_log 資料表）
    </div>
  )
}

export function Toast({ msg }) {
  if (!msg) return null
  return (
    <div style={{ position: 'fixed', top: 80, left: 0, right: 0, zIndex: 100, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ background: '#059669', color: '#fff', padding: '10px 24px', borderRadius: 50, fontWeight: 700, fontSize: 14 }}>{msg}</div>
    </div>
  )
}
