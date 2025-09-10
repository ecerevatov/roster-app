'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type Day = { date_iso: string; header: string | null };
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

export default function StaffPage() {
  const [days, setDays] = useState<Day[]>([]);
  const [dateIso, setDateIso] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  // --- loaders ---
  async function loadDays() {
    const { data, error } = await supabase
      .from('roster_days')
      .select('date_iso, header')
      .eq('published', true)
      .order('date_iso', { ascending: true });
    if (!error && data) {
      setDays(data as Day[]);
      if (!dateIso && data.length) setDateIso(data[data.length - 1].date_iso);
    }
  }

  async function loadRows(d = dateIso) {
    if (!d) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('roster_rows')
      .select('*')
      .eq('date_iso', d)
      .order('sort_no', { ascending: true })
      .order('time', { ascending: true, nullsFirst: true });
    if (!error) setRows((data || []) as Row[]);
    setLoading(false);
  }

  // --- init days ---
  useEffect(() => { loadDays(); }, []);

  // --- change day -> load rows ---
  useEffect(() => { if (dateIso) loadRows(dateIso); }, [dateIso]);

  // --- realtime subscribe ---
  useEffect(() => {
    const ch = supabase
      .channel('roster-live-staff')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'roster_rows' },
        (payload) => {
          const r: any = payload.new ?? payload.old;
          if (r?.date_iso === dateIso) loadRows(dateIso);
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'roster_days' },
        () => loadDays())
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [dateIso]);

  // --- group for view ---
  const groups = useMemo(() => {
    const by: Record<string, Row[]> = { 'Zásobování': [], 'Generální úklidy': [], 'Ostatní': [] };
    rows.forEach(r => {
      const g = (r.group || '').toLowerCase();
      const key = g === 'zas' ? 'Zásobování' : g === 'uman' ? 'Generální úklidy' : 'Ostatní';
      by[key].push(r);
    });
    Object.values(by).forEach(list =>
      list.sort((a, b) => (a.time || '').localeCompare(b.time || '', 'cs', { numeric: true }))
    );
    return by;
  }, [rows]);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16, maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Rozpis práce • Zaměstnanci</h1>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span>Datum:</span>
        <select value={dateIso} onChange={e => setDateIso(e.target.value)}>
          {days.map(d => (
            <option key={d.date_iso} value={d.date_iso}>
              {d.date_iso}{d.header ? ` • ${d.header}` : ''}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
          {rows.length} objektů {loading ? '• načítám…' : ''}
        </span>
      </div>

      {(['Zásobování', 'Generální úklidy', 'Ostatní'] as const).map(section => {
        const list = groups[section] || [];
        if (!list.length) return null;
        return (
          <section key={section} style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '6px 0' }}>
              {section} • {list.length}
            </h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {list.map(r => (
                <div key={r.id}
                  style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff' }}>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 800 }}>{r.client || ''}</div>
                    <div style={{ opacity: 0.7 }}>{r.time || ''}</div>
                  </div>
                  {r.address ? <div style={{ opacity: 0.8 }}>{r.address}</div> : null}
                  {r.note ? <div style={{ marginTop: 4 }}>{r.note}</div> : null}
                  {r.worker ? <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>Pracovník: {r.worker}</div> : null}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}