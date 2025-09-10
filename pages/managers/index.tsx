'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

/* ---------- Typy ---------- */
type Row = {
  id: string;
  date_iso: string;
  time: string | null;
  worker: string | null;
  client: string | null;
  address: string | null;
  note: string | null;
  group: string | null;
  sort_no?: number | null;
};
type DayInfo = { date_iso: string; header: string | null; published: boolean | null };

type GCalRow = {
  time: string | null;
  worker: string | null;
  client: string | null;
  address: string | null;
  note: string | null;
  group: string | null;
};
type GCalResp = { dateISO: string; rows: GCalRow[] };

/* ---------- Pomocné ---------- */
const fmtDateCZ = (iso: string) => {
  const d = new Date(iso);
  const dnames = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dnames[d.getDay()]} ${dd}.${mm}.${d.getFullYear()}`;
};
const todayPlus = (off: number) => {
  const d = new Date();
  d.setDate(d.getDate() + off);
  return d.toISOString().slice(0, 10);
};
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
};
const parseRange = (s: string | null) => {
  const m = (s || '').replace(/\s/g, '').match(/^(\d{1,2}:\d{2})[-–](\d{1,2}:\d{2})$/);
  if (!m) return null;
  const a = toMin(m[1]),
    b = toMin(m[2]);
  if (a == null || b == null) return null;
  return { s: a, e: b };
};
const fmtRange = (r: { s: number; e: number }) =>
  `${pad((r.s / 60) | 0)}:${pad(r.s % 60)}–${pad((r.e / 60) | 0)}:${pad(r.e % 60)}`;
const splitWorkers = (s: string | null) => (s || '').split(/[,;/\n]+/).map(x => x.trim()).filter(Boolean);

/* ---------- Komponenta ---------- */
export default function ManagersPage() {
  const [dateIso, setDateIso] = useState<string>(todayPlus(1));
  const [dayInfo, setDayInfo] = useState<DayInfo | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /* ----- Načtení dne + řádků ----- */
  useEffect(() => {
    loadDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateIso]);

  async function ensureDay(date: string) {
    await supabase.from('roster_days').upsert({ date_iso: date, header: 'Čas', published: true }).select().single();
  }

  async function loadFromGCal() {
    setLoading(true);
    try {
      const r = await fetch(`/api/gcal?date=${dateIso}`);
      if (!r.ok) throw new Error(`GCAL ${r.status}: ${await r.text()}`);
      const { rows: gRows } = (await r.json()) as GCalResp;

      await supabase.from('roster_days').upsert({ date_iso: dateIso, published: true }).select().single();
      await supabase.from('roster_rows').delete().eq('date_iso', dateIso);

      if (Array.isArray(gRows) && gRows.length) {
        const insertPayload = gRows.map((g, i) => ({
          date_iso: dateIso,
          time: g.time || null,
          worker: g.worker || null,
          client: g.client || null,
          address: g.address || null,
          note: g.note || null,
          group: g.group || null,
          sort_no: i,
        }));
        await supabase.from('roster_rows').insert(insertPayload);
      }
      await loadDay();
    } catch (e: any) {
      alert(e?.message || 'Import z Kalendáře selhal');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadDay() {
    setLoading(true);
    const d = await supabase.from('roster_days').select('date_iso, header, published').eq('date_iso', dateIso).maybeSingle();
    if (!d.error) setDayInfo(d.data as DayInfo);

    const r = await supabase
      .from('roster_rows')
      .select('*')
      .eq('date_iso', dateIso)
      .order('time', { ascending: true });
    if (!r.error && r.data) setRows(r.data as Row[]);
    setLoading(false);
  }

  /* ----- Realtime odběr ----- */
  useEffect(() => {
    if (!dateIso) return;
    const ch = supabase
      .channel(`mgr-rows-${dateIso}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'roster_rows', filter: `date_iso=eq.${dateIso}` },
        payload => {
          setRows(prev => {
            if (payload.eventType === 'INSERT') return [...prev, payload.new as Row];
            if (payload.eventType === 'UPDATE') return prev.map(r => (r.id === (payload.new as Row).id ? (payload.new as Row) : r));
            if (payload.eventType === 'DELETE') return prev.filter(r => r.id !== (payload.old as Row).id);
            return prev;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'roster_days', filter: `date_iso=eq.${dateIso}` },
        payload => setDayInfo(payload.new as DayInfo)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [dateIso]);

  /* ----- Mutace řádků ----- */
  function edit(id: string, key: keyof Row, val: string) {
    setRows(rs => rs.map(r => (r.id === id ? { ...r, [key]: val } : r)));
  }
  const sanitize = (r: Row) => {
    const v = (x: string | null | undefined) => (x && x.trim() !== '' ? x : null);
    return {
      id: r.id,
      date_iso: r.date_iso || dateIso,
      time: v(r.time),
      worker: v(r.worker),
      client: v(r.client),
      address: v(r.address),
      note: v(r.note),
      group: v(r.group),
    };
  };
  async function saveRow(id: string) {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    await supabase.from('roster_rows').update(sanitize(r)).eq('id', id);
  }
  async function addRow() {
    const { data, error } = await supabase
      .from('roster_rows')
      .insert({ date_iso: dateIso, time: null, worker: '', client: '', address: '', note: '', group: null })
      .select()
      .single();
    if (!error && data) setRows(rs => [...rs, data as Row]);
  }
  async function removeRow(id: string) {
    await supabase.from('roster_rows').delete().eq('id', id);
    setRows(rs => rs.filter(r => r.id !== id));
  }

  /* ----- Published ----- */
  const published = !!dayInfo?.published;
  async function togglePublished(next: boolean) {
    await ensureDay(dateIso);
    const { data, error } = await supabase.from('roster_days').update({ published: next }).eq('date_iso', dateIso).select().single();
    if (!error && data) setDayInfo(data as DayInfo);
  }

  /* ----- Export PNG/PDF ----- */
  async function exportPNG() {
    const el = containerRef.current;
    if (!el) return;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2 });
    const a = document.createElement('a');
    a.download = `Rozpis_${dateIso}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  }
  async function exportPDF() {
    const el = containerRef.current;
    if (!el) return;
    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');
    const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2 });
    const pdf = new jsPDF({ unit: 'px', format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height, undefined, 'FAST');
    pdf.save(`Rozpis_${dateIso}.pdf`);
  }

  /* ----- Počty objektů ----- */
  const counts = useMemo(() => {
    const res: Record<string, number> = {};
    const labels: Record<string, string> = {};
    const hide = /^\s*(uman|zásobování|brig|nerozděleno)\s*$/i;
    rows.forEach(r => {
      splitWorkers(r.worker).forEach(w => {
        if (hide.test(w)) return;
        const key = w.trim().toLowerCase();
        res[key] = (res[key] || 0) + 1;
        if (!labels[key] || w.length > labels[key].length) labels[key] = w;
      });
    });
    return Object.entries(res)
      .sort((a, b) => (labels[a[0]] || a[0]).localeCompare(labels[b[0]] || b[0], 'cs', { sensitivity: 'base' }))
      .map(([k, v]) => ({ name: labels[k] || k, count: v }));
  }, [rows]);

  /* ----- Volné kapacity ----- */
  const capacities = useMemo(() => {
    const WSTART = toMin('06:00')!,
      WNOON = toMin('12:00')!,
      WEND = toMin('19:00')!;
    const by: Record<string, { s: number; e: number }[]> = {};
    rows.forEach(r => {
      const rng = parseRange(r.time || '');
      const canceled = /(^|\s)zrušeno\b/i.test(r.client || '');
      if (!rng || canceled) return;
      splitWorkers(r.worker).forEach(w => {
        const key = w.replace(/\s+/g, ' ').trim();
        (by[key] ||= []).push({ s: Math.max(WSTART, rng.s - 90), e: Math.min(WEND, rng.e + 90) });
      });
    });
    const out: { name: string; am: string; pm: string }[] = [];
    Object.keys(by).forEach(name => {
      const busy = by[name].sort((a, b) => a.s - b.s);
      const merged: { s: number; e: number }[] = [];
      busy.forEach(b => {
        if (!merged.length || b.s > merged[merged.length - 1].e) merged.push({ ...b });
        else merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, b.e);
      });
      const free: { s: number; e: number }[] = [];
      let cur = WSTART;
      merged.forEach(b => {
        if (b.s > cur) free.push({ s: cur, e: b.s });
        cur = Math.max(cur, b.e);
      });
      if (cur < WEND) free.push({ s: cur, e: WEND });
      const am: string[] = [],
        pm: string[] = [];
      free.forEach(r => {
        if (r.e <= WNOON) am.push(fmtRange(r));
        else if (r.s >= WNOON) pm.push(fmtRange(r));
        else {
          am.push(fmtRange({ s: r.s, e: WNOON }));
          pm.push(fmtRange({ s: WNOON, e: r.e }));
        }
      });
      if (am.length || pm.length) out.push({ name, am: am.join(', ') || '—', pm: pm.join(', ') || '—' });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name, 'cs', { sensitivity: 'base' }));
  }, [rows]);

  /* ---------- UI ---------- */
  return (
    <div style={{ background: '#f7fafc', minHeight: '100vh', fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto' }}>
      {/* Header */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#ffffffcc',
          backdropFilter: 'blur(6px)',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <div style={{ maxWidth: 1600, margin: '0 auto', padding: 12, display: 'grid', gridTemplateColumns: '1fr 620px', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Rozpis práce</div>
            <div id="subtitle" style={{ color: '#28b485', fontWeight: 800, fontSize: 18 }}>
              {dayInfo?.date_iso ? fmtDateCZ(dayInfo.date_iso) : '—'}
            </div>
          </div>
          <div id="controls" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button onClick={loadFromGCal}>Import z Kalendáře</button>
            <button onClick={loadDay} style={btnPri}>
              Aktualizovat
            </button>
            <button onClick={exportPDF} style={btn}>
              Export to PDF
            </button>
            <button onClick={exportPNG} style={btn}>
              Export to PNG
            </button>
            <label style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={published} onChange={e => togglePublished(e.target.checked)} />
              Povolit zobrazení zaměstnancům
            </label>
            <Link href="/" style={btn}>
              Režim pro zaměstnance
            </Link>
          </div>
        </div>
      </div>

      {/* Main */}
      <div
        ref={containerRef}
        style={{ maxWidth: 1600, margin: '12px auto', padding: 12, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 350px', gap: 12 }}
      >
        {/* Tabulka */}
        <section style={card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={th(90)}>Čas</th>
                  <th style={th(140)}>Pracovník</th>
                  <th style={th(180)}>Klient/Objekt</th>
                  <th style={th(180)}>Adresa</th>
                  <th style={th()}>Poznámka</th>
                  <th style={th(1)} />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} style={{ padding: 12, color: '#64748b' }}>
                      Žádné řádky. Přidej nebo „Aktualizovat“.
                    </td>
                  </tr>
                )}
                {rows.map(r => (
                  <tr key={r.id} style={{ background: '#fff' }}>
                    <td style={td}>
                      <input style={inp} value={r.time || ''} onChange={e => edit(r.id, 'time', e.target.value)} onBlur={() => saveRow(r.id)} />
                    </td>
                    <td style={td}>
                      <input style={inp} value={r.worker || ''} onChange={e => edit(r.id, 'worker', e.target.value)} onBlur={() => saveRow(r.id)} />
                    </td>
                    <td style={td}>
                      <input style={inp} value={r.client || ''} onChange={e => edit(r.id, 'client', e.target.value)} onBlur={() => saveRow(r.id)} />
                    </td>
                    <td style={td}>
                      <input style={inp} value={r.address || ''} onChange={e => edit(r.id, 'address', e.target.value)} onBlur={() => saveRow(r.id)} />
                    </td>
                    <td style={td}>
                      <input style={inp} value={r.note || ''} onChange={e => edit(r.id, 'note', e.target.value)} onBlur={() => saveRow(r.id)} />
                    </td>
                    <td style={{ ...td, width: 1 }}>
                      <button onClick={() => removeRow(r.id)} style={smallDanger}>
                        Smazat
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: 8, borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
            <button onClick={addRow} style={btn}>
              Přidat řádek
            </button>
            <div style={{ marginLeft: 'auto', color: '#64748b' }}>{rows.length} položek {loading ? '• načítám…' : ''}</div>
          </div>
        </section>

        {/* Pravý panel */}
        <aside style={{ display: 'grid', gap: 12, alignSelf: 'start' }}>
          <div style={card}>
            <div style={cardTitle}>Počet objektů</div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {counts.map((c, i) => (
                <li
                  key={c.name + i}
                  style={{ padding: '6px 8px', background: i % 2 ? '#f9fbff' : undefined, display: 'flex', justifyContent: 'space-between' }}
                >
                  <span>{c.name}</span>
                  <strong>{c.count}</strong>
                </li>
              ))}
              {!counts.length && <li style={{ padding: 8, color: '#64748b' }}>Žádná data.</li>}
            </ul>
          </div>

          <div style={card}>
            <div style={{ ...cardTitle, color: '#28b485' }}>Volné kapacity</div>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={miniTh('40%')}>Pracovník</th>
                  <th style={miniTh()}>Dopoledne</th>
                  <th style={miniTh()}>Odpoledne</th>
                </tr>
              </thead>
              <tbody>
                {capacities.map((c, i) => (
                  <tr key={c.name + i} style={{ background: i % 2 ? '#f9fbff' : undefined }}>
                    <td style={miniTd}>{c.name}</td>
                    <td style={miniTd}>{c.am || '—'}</td>
                    <td style={miniTd}>{c.pm || '—'}</td>
                  </tr>
                ))}
                {!capacities.length && (
                  <tr>
                    <td colSpan={3} style={{ ...miniTd, color: '#64748b' }}>
                      Žádná data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </aside>
      </div>

      {/* Footer */}
      <div style={{
  position: 'sticky', bottom: 0, zIndex: 10, background: '#ffffffe6',
  backdropFilter: 'blur(6px)', borderTop: '1px solid #e5e7eb'
}}>
        <div style={{ maxWidth: 1600, margin: '0 auto', padding: 8, display: 'flex', gap: 8, alignItems: 'center', overflowX: 'auto' }}>
          {[1, 2, 3, 4].map(off => {
            const d = todayPlus(off);
            const active = d === dateIso;
            return (
              <button key={off} onClick={() => setDateIso(d)} style={tabBtn(active)}>
                {new Date(d).toLocaleDateString('cs-CZ', { weekday: 'short', day: '2-digit', month: '2-digit' })}
              </button>
            );
          })}
          <input type="date" value={dateIso} onChange={e => setDateIso(e.target.value)} style={tabBtn(false)} />
        </div>
      </div>
    </div>
  );
}

/* ---------- Styl pomůcky ---------- */
const card: CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  boxShadow: '0 1px 2px rgba(16,24,40,.04)',
  overflow: 'hidden',
};
const cardTitle: CSSProperties = {
  fontSize: 11,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: '#64748b',
  padding: '8px 10px',
  borderBottom: '1px solid #e5e7eb',
};
const th = (w?: number): CSSProperties => ({
  position: 'sticky',
  top: 0,
  background: '#fbfdff',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
  padding: '10px 8px',
  fontWeight: 700,
  verticalAlign: 'middle',
  width: w ? `${w}px` : 'auto',
});
const td: CSSProperties = { borderBottom: '1px solid #e5e7eb', padding: 6, verticalAlign: 'middle' };
const inp: CSSProperties = {
  width: '100%',
  border: '1px solid #e5e7eb',   // ← tady
  borderRadius: 8,
  padding: '6px 8px',
  font: 'inherit',
  background: '#fff',
  outline: '2px solid transparent',
};
const btn: CSSProperties = {
  padding: '7px 10px',
  borderRadius: 10,
  border: '1px solid #e5e7eb',
  background: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};
const btnPri: CSSProperties = { ...btn, background: '#2aa6ff', color: '#fff', borderColor: '#2aa6ff' };
const smallDanger: CSSProperties = { ...btn, padding: '6px 8px', background: '#fee2e2', borderColor: '#fecaca' };
const tabBtn = (active: boolean): CSSProperties => ({
  border: '1px solid #e5e7eb',
  background: active ? '#eef6ff' : '#fff',
  color: active ? '#0b5cab' : '#0f172a',
  padding: '6px 10px',
  borderRadius: 10,
  fontSize: 11,
  fontWeight: active ? 700 : 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
});
const miniTh = (w?: string): CSSProperties => ({ ...th(), position: 'static', width: w, padding: '6px 8px' });
const miniTd: CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'top' };