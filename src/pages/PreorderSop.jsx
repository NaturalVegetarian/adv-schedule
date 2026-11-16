import { useEffect, useRef } from 'react'

// 預排客訂 SOP（快速上手）：客訂管理 →「預排客訂」分頁最上面的「📖 預排客訂 SOP」打開
// 截圖放在 public/sop/（網址 /sop/…）。流程或畫面有改：重拍截圖，並在 SOP_REVISIONS 最上面加一行，更新日期會跟著變
export const SOP_REVISIONS = [
  { date: '2026-11-16', note: '初版：新增、記一筆追蹤、確認訂單、未成交；代工的生產區間與約略數量' },
]
export const SOP_UPDATED = SOP_REVISIONS[0].date
export const sopDate = iso => String(iso || '').replace(/-/g, '/')

const C = { main: '#0e7490', dark: '#164e63', soft: '#ecfeff', line: '#a5f3fc', text: '#1e293b', sub: '#64748b' }

// 截圖：檔名 → 原始像素（2 倍圖，顯示寬度＝一半）
const IMG = {
  'preorder-01-overview.png': [1600, 1115],
  'preorder-02-form-top.png': [904, 632],
  'preorder-03-form-bottom.png': [888, 814],
  'preorder-04-card.png': [996, 638],
  'preorder-05-followup.png': [932, 696],
  'preorder-06-confirm.png': [840, 1050],
  'preorder-07-lost.png': [720, 718],
  'preorder-08-oem-card.png': [996, 732],
  'preorder-09-oem-list.png': [554, 212],
}

const SECTIONS = [
  ['sop-what', '流程'],
  ['sop-new', '1 新增'],
  ['sop-log', '2 追蹤'],
  ['sop-ok', '3 確認訂單'],
  ['sop-lost', '4 未成交'],
  ['sop-oem', '代工'],
  ['sop-faq', '常見問題'],
]

const H = ({ id, children }) => (
  <h3 id={id} style={{ scrollMarginTop: 118, fontSize: 19, fontWeight: 900, color: C.dark, margin: '30px 0 10px', paddingBottom: 6, borderBottom: `2px solid ${C.line}` }}>{children}</h3>
)
const P = ({ children, style }) => <p style={{ margin: '0 0 10px', lineHeight: 1.75, ...style }}>{children}</p>
const Ol = ({ items }) => (
  <ol style={{ margin: '0 0 12px', paddingLeft: 24, lineHeight: 1.75 }}>
    {items.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}
  </ol>
)
const Ul = ({ items }) => (
  <ul style={{ margin: '0 0 12px', paddingLeft: 22, lineHeight: 1.75 }}>
    {items.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}
  </ul>
)
const Shot = ({ src, alt, cap }) => {
  const [w, h] = IMG[src] || [800, 500]
  return (
    <figure style={{ margin: '8px 0 18px', textAlign: 'center' }}>
      {/* 點圖開新分頁看原尺寸（手機上圖太小時用） */}
      <a href={`/sop/${src}`} target="_blank" rel="noopener noreferrer" title="點圖放大">
        <img src={`/sop/${src}`} alt={alt} width={w} height={h} loading="lazy" style={{ width: '100%', maxWidth: Math.round(w / 2), height: 'auto', border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', cursor: 'zoom-in' }} />
      </a>
      <figcaption style={{ fontSize: 14, color: C.sub, marginTop: 6, lineHeight: 1.6 }}>{cap}</figcaption>
    </figure>
  )
}
const Table = ({ head, rows }) => (
  <div style={{ overflowX: 'auto', margin: '4px 0 14px' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14.5, lineHeight: 1.6 }}>
      <thead>
        <tr>{head.map(t => <th key={t} style={{ textAlign: 'left', background: C.soft, color: C.dark, padding: '8px 10px', borderBottom: `2px solid ${C.line}`, whiteSpace: 'nowrap' }}>{t}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0', verticalAlign: 'top', fontWeight: j === 0 ? 700 : 400 }}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  </div>
)

// 流程圖：電腦一列、手機直排
const Flow = () => (
  <div className="sop-flow" aria-label="預排客訂流程">
    <div className="sop-node">① 新增客訂<small>客戶一問就先建一筆</small></div>
    <div className="sop-arr" aria-hidden="true">→</div>
    <div className="sop-node">② 記一筆追蹤<small>每次聯絡都記，排下次追蹤日；還沒確定就再追</small></div>
    <div className="sop-arr" aria-hidden="true">→</div>
    <div className="sop-q">客戶確定了？</div>
    <div className="sop-arr" aria-hidden="true">→</div>
    <div className="sop-split">
      <div className="sop-node sop-yes"><span className="sop-tag">確定了</span>③ 確認訂單<small>轉到「等待排程」，生產排程科排生產</small></div>
      <div className="sop-node"><span className="sop-tag sop-tag-no">不要了</span>④ 未成交<small>收到最下面「未成交紀錄」，可恢復</small></div>
    </div>
  </div>
)

export default function PreorderSop({ onClose }) {
  const box = useRef(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close.current() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden' // 背後的客訂清單不要跟著捲
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [])
  const go = id => box.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div ref={box} className="sop-overlay" role="dialog" aria-modal="true" aria-label="預排客訂 SOP" onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(15,23,42,.55)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <style>{`
        .sop-flow { display: flex; align-items: center; gap: 6px; margin: 10px 0 18px; }
        .sop-node { flex: 1 1 0; min-width: 0; background: #fff; border: 1.5px solid #cbd5e1; border-radius: 12px; padding: 10px 8px; text-align: center; font-weight: 800; color: #1e293b; font-size: 15px; }
        .sop-node small { display: block; font-weight: 500; color: #64748b; font-size: 12.5px; margin-top: 3px; line-height: 1.45; }
        .sop-yes { border: 2px solid #0e7490; background: #ecfeff; }
        .sop-q { flex: 0 0 auto; padding: 9px 12px; border: 1.5px dashed #94a3b8; border-radius: 999px; font-weight: 800; color: #334155; font-size: 14px; white-space: nowrap; }
        .sop-arr { flex: 0 0 auto; color: #94a3b8; font-weight: 900; font-size: 18px; }
        .sop-split { flex: 1.35 1 0; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
        .sop-tag { display: inline-block; font-size: 11.5px; font-weight: 800; color: #fff; background: #0e7490; border-radius: 6px; padding: 0 6px; margin-right: 6px; vertical-align: 1px; }
        .sop-tag-no { background: #94a3b8; }
        .sop-chip { flex: 0 0 auto; padding: 5px 12px; border-radius: 20px; border: 1px solid #a5f3fc; background: #fff; color: #0e7490; font-weight: 800; font-size: 13.5px; cursor: pointer; font-family: inherit; white-space: nowrap; }
        .sop-chip:hover { background: #ecfeff; }
        @media (max-width: 640px) {
          .sop-flow { flex-direction: column; align-items: stretch; }
          .sop-arr { align-self: center; transform: rotate(90deg); line-height: 1; }
          .sop-q { align-self: center; }
        }
      `}</style>
      <div style={{ maxWidth: 860, margin: '0 auto', minHeight: '100%', background: '#fff', boxShadow: '0 0 40px rgba(0,0,0,.25)' }}>
        {/* 標題列（捲動時固定在上面） */}
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#fff', borderBottom: `1px solid ${C.line}`, padding: '12px 16px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: C.dark }}>📖 預排客訂 SOP・快速上手</div>
              <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>客戶服務科 · 更新日期 <b className="sop-updated" style={{ color: C.dark }}>{sopDate(SOP_UPDATED)}</b></div>
            </div>
            <button type="button" onClick={onClose} aria-label="關閉 SOP" style={{ flex: '0 0 auto', background: '#f1f5f9', border: 'none', borderRadius: 20, padding: '8px 14px', fontWeight: 800, color: '#475569', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>✕ 關閉</button>
          </div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 10, paddingBottom: 2 }}>
            {SECTIONS.map(([id, label]) => <button key={id} type="button" className="sop-chip" onClick={() => go(id)}>{label}</button>)}
          </div>
        </div>

        <div style={{ padding: '2px 18px 48px', color: C.text, fontSize: 15.5 }}>
          <H id="sop-what">預排客訂是什麼</H>
          <P>新接的單一律先放「預排客訂」，由客服追蹤到客戶確定；確定了按「確認訂單」，才會轉給生產排程科排生產。</P>
          <P>入口：公司入口點「生產排程」→ 上方「客訂管理」→ 第一個分頁「預排客訂」。從入口點進來會自動登入，負責人、追蹤紀錄都會記成你的名字。</P>
          <P style={{ marginBottom: 0 }}>客服在這裡只做四件事：</P>
          <Flow />
          <Shot src="preorder-01-overview.png" alt="預排客訂畫面" cap="① 新增客訂　② 預排客訂分頁（數字＝要處理的件數）　③ 今日提醒：待確認、今天要追蹤、追蹤逾期　④ 這份 SOP（右邊是更新日期）" />

          <H id="sop-new">步驟 1　新增一筆預排</H>
          <P>客戶一問就先建一筆；出貨日、生產日不知道都可以空著，之後再補。</P>
          <Ol items={[
            '按右上「新增客訂」。',
            '依序填：客戶名稱 → 品項規格 → 訂購數量。打品項名稱會自動帶入每袋重量、箱子、包材等固定規格。',
            '數量還不確定，就勾數量旁邊的「約（大概的量）」。',
            '特殊備註、併箱口味、理貨與裝箱、包材：有特殊需求才改，固定品項已經帶好。',
            '最下面的日期都可以空著；代工客戶有給生產區間，就填「客戶指定生產區間」（見「代工」）。',
            '按「確認儲存」，看一下確認視窗，再按「確認無誤，正式存檔」。',
          ]} />
          <Shot src="preorder-02-form-top.png" alt="新增客訂表單：上半" cap="① 客戶名稱　② 品項規格（打字搜尋）　③ 訂購數量　④ 約（大概的量）" />
          <Shot src="preorder-03-form-bottom.png" alt="新增客訂表單：下半" cap="① 客戶指定生產區間（代工才填）　② 確認儲存" />
          <P>存好後卡片會出現在「預排客訂」，負責人就是你。</P>

          <H id="sop-log">步驟 2　每次聯絡客戶，記一筆追蹤</H>
          <P>每張卡片都有「📞 客服追蹤」框；聯絡完就記一筆，並排好下次追蹤日。</P>
          <Shot src="preorder-04-card.png" alt="預排客訂卡片" cap="① 追蹤提醒　② 記一筆追蹤　③ 確認訂單　④ 未成交　⑤ 改單" />
          <Ol items={[
            '按卡片上的「＋ 記一筆追蹤」。',
            '寫這次的結果，例如：已報價，等客戶回覆。',
            '選下次追蹤日：直接點「明天／後天／3 天後／下週一」，或自己選日期。',
            '按「存追蹤紀錄」。',
          ]} />
          <Shot src="preorder-05-followup.png" alt="記一筆追蹤" cap="① 寫這次的結果　② 選下次追蹤日　③ 存追蹤紀錄" />
          <P>客服追蹤框裡的提醒：</P>
          <Table head={['框裡顯示', '意思', '要做什麼']} rows={[
            ['⚠ 追蹤逾期 N 天（紅）', '過了追蹤日還沒記錄', '今天就聯絡，記一筆'],
            ['🔔 今天要追蹤（橘）', '今天是排定的追蹤日', '今天聯絡，記一筆'],
            ['下次追蹤 M/D（藍）', '已經排好', '到那天再追'],
            ['還沒排下次追蹤日（灰）', '沒排日期', '記一筆，順便排日期'],
          ]} />
          <P>預計出貨日快到、還沒確認訂單，框裡會多一行紅字提醒。頁面上方「客戶服務科：今日提醒」可以看到今天要追幾件、逾期幾件；按卡片上的「紀錄（N）」看全部歷史。</P>

          <H id="sop-ok">步驟 3　客戶確定 → 按「確認訂單」</H>
          <P>客戶確定品項和數量，就按卡片右下「確認訂單 ›」；單會轉到「等待排程」，由生產排程科排生產日。</P>
          <Ol items={[
            '按「確認訂單 ›」。',
            <>視窗裡的欄位都是選填：
              <Ul items={[
                '付款日：要先付款才排生產的單才填；填了自動算交期（付款日後 20 個工作天）。',
                '併櫃：這批要跟別的貨一起上櫃才勾。',
                '預計出貨日：不知道就先空著。',
              ]} />
            </>,
            '按視窗下方的「確認 確認訂單」。',
          ]} />
          <Shot src="preorder-06-confirm.png" alt="確認訂單視窗" cap="① 付款日（選填，填了自動算交期）　② 確認 確認訂單" />
          <P>出貨日先空著的單：等生產排程科排好生產日，「預排客訂」上方會出現「🚚 已排好生產、等客服定出貨日」，按「🚚 定出貨日」補上就好。</P>

          <H id="sop-lost">步驟 4　沒成交 → 按「未成交」</H>
          <P>客戶不要了，按卡片下方「未成交」，選原因（價格／交期／數量／客戶取消／其他），可以補充說明，再按「確認未成交」。</P>
          <Shot src="preorder-07-lost.png" alt="標記未成交" cap="① 選原因　② 確認未成交" />
          <Ul items={[
            '單不會刪掉，會移到「預排客訂」最下面的「未成交紀錄」，之後可以恢復。',
            '未成交會算進每月的確認率（確認 ÷（確認＋未成交）），所以客戶沒要的單請按「未成交」，不要用 🗑 刪掉。',
          ]} />

          <H id="sop-oem">代工（里仁等）要多做的</H>
          <P>代工客戶常只給「生產區間」和大概的數量；建單時把這兩項填進欄位，生產排程科排程時就看得到。</P>
          <Ol items={[
            '「客戶指定生產區間」填開始～結束。只知道「下旬」就先填 21～30 日，之後再改窄；只有一天就兩格填一樣。',
            '數量還不確定就勾「約（大概的量）」，卡片會顯示「約 1440 袋」；量定了把數字改掉、取消勾選。',
            '卡片會顯示「🗓 生產區間 11/24～11/26」：快到了變橘色，過了還沒排變紅色。',
            '生產排程科在「生產排程」頁的「🏭 代工」清單看得到這張單；按「排入行程」時會先帶區間第一天，排到區間外會紅字警告。',
          ]} />
          <Shot src="preorder-08-oem-card.png" alt="代工卡片" cap="① 生產區間　② 約的數量" />
          <Shot src="preorder-09-oem-list.png" alt="生產排程頁的代工清單" cap="生產排程科在「生產排程」頁看到的「🏭 代工」清單：區間、排定的生產日、提醒" />
          <P style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '8px 12px', color: '#92400e', fontWeight: 700 }}>⚠ 區間不要只寫在追蹤紀錄的文字裡，系統讀不到。</P>

          <H id="sop-faq">常見問題</H>
          <Table head={['問題', '怎麼做']} rows={[
            ['負責人顯示「使用者」', '登入功能上線前建的舊單；之後新建、新記的都會是真名'],
            ['看到登入畫面', '從公司入口點「生產排程」進來會自動登入；直接開網址就用入口的帳號密碼'],
            ['要改數量、品項、日期', '按卡片上的 ✏️，改完存檔'],
            ['建錯單', '按 🗑 永久刪除（會先問你確定）；客戶沒要的單請用「未成交」'],
            ['未成交的單客戶又要了', '到最下面「未成交紀錄」恢復'],
            ['共用電腦、平板', '用完按右上角「登出」，下一個人才不會記成你的名字'],
          ]} />

          <H id="sop-rev">修訂紀錄</H>
          <Table head={['日期', '內容']} rows={SOP_REVISIONS.map(r => [sopDate(r.date), r.note])} />
        </div>
      </div>
    </div>
  )
}
