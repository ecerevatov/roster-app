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
  const [err, setErr] = useState<string | null>(null);

  // 1) Načti publikované dny
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('roster_days')
        .select('date_iso, header')
        .eq('published', true)
        .order('date_iso', { ascending: true });

      if (error) {
        if (alive) setErr(error.message);
        return;
      }
      if (alive && data) {
        setDays(data as Day[]);
        const last = data[data.length - 1]?.date_iso;
        if (last) setDateIso(last);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 2) Načti řádky pro vybraný den
  useEffect(() => {
    if (!dateIso) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      const { data, error } = await supabase
        .from('roster_rows')
        .select('*')
        .eq('date_iso', dateIso)
        .order('sort_no', { ascending: true })
        .order('time', { ascending: true, nullsFirst: false });

      if (alive) {
        if (error) setErr(error.message);
        setRows((data || []) as Row[]);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dateIso]);

  // 3) Realtime odběr změn pro vybraný den
  useEffect(() => {
    if (!dateIso) return;
    const channelName = `rows-${dateIso}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'roster_rows', filter: `date_iso=eq.${dateIso}` },
        (payload) => {
          setRows((prev) => {
            if (payload.eventType === 'INSERT') return [...prev, payload.new as Row];
            if (payload.eventType === 'UPDATE')
              return prev.map((r) => (r.id === (payload.new as Row).id ? (payload.new as Row) : r));
            if (payload.eventType === 'DELETE')
              return prev.filter((r) => r.id !== (payload.old as Row).id);
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dateIso]);

  // 4) Seskupení pro zobrazení
  const groups = useMemo(() => {
    const by: Record<'Zásobování' | 'Generální úklidy' | 'Ostatní', Row[]> = {
      'Zásobování': [],
      'Generální úklidy': [],
      'Ostatní': [],
    };

    rows.forEach((r) => {
      const g = (r.group || '').toLowerCase();
      const key = g === 'zas' ? 'Zásobování' : g === 'uman' ? 'Generální úklidy' : 'Ostatní';
      by[key].push(r);
    });

    // vizuální řazení uvnitř skupin (čas → klient)
    Object.values(by).forEach((list) =>
      list.sort((a, b) => {
        const ta = a.time || '99:99';
        const tb = b.time || '99:99';
        const tcmp = ta.localeCompare(tb, 'cs', { numeric: true });
        if (tcmp !== 0) return tcmp;
        return (a.client || '').localeCompare(b.client || '', 'cs', { sensitivity: 'base' });
      })
    );

    return by;
  }, [rows]);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16, maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Rozpis práce • Zaměstnanci</h1>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span>Datum:</span>
        <select value={dateIso} onChange={(e) => setDateIso(e.target.value)}>
          {days.map((d) => (
            <option key={d.date_iso} value={d.date_iso}>
              {d.date_iso}
              {d.header ? ` • ${d.header}` : ''}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
          {rows.length} objektů {loading ? '• načítám…' : ''}
        </span>
      </div>

      {err && (
        <div style={{ margin: '8px 0', padding: 10, border: '1px solid #fecaca', background: '#fee2e2', borderRadius: 8 }}>
          {err}
        </div>
      )}

      {(['Zásobování', 'Generální úklidy', 'Ostatní'] as const).map((section) => {
        const list = groups[section];
        if (!list.length) return null;
        return (
          <section key={section} style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '6px 0' }}>
              {section} • {list.length}
            </h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {list.map((r) => (
                <div key={r.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff' }}>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 800 }}>{r.client || ''}</div>
                    <div style={{ opacity: 0.7 }}>{r.time || ''}</div>
                  </div>
                  {r.address ? <div style={{ opacity: 0.8 }}>{r.address}</div> : null}
                  {r.note ? <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{r.note}</div> : null}
                  {r.worker ? <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>Pracovník: {r.worker}</div> : null}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {!loading && !rows.length && (
        <div style={{ marginTop: 12, opacity: 0.7 }}>Pro vybraný den zatím žádná data.</div>
      )}
    </div>
  );
}