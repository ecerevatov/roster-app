'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

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

const DEBOUNCE_MS = 500;

export default function ManagersPage() {
  const [dateIso, setDateIso] = useState<string>(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const timersRef = useRef<Map<string, any>>(new Map());
  const savingRef = useRef<boolean>(false);
  const [, force] = useState(0); // pro refresh UI při změně savingRef

  // pomocné
  const isSaving = useMemo(() => savingRef.current, [/* eslint-disable-line */]);

  function setSaving(v: boolean) { savingRef.current = v; force(x => x + 1); }

  function sanitize(r: Partial<Row>): Partial<Row> {
    const v = (x: string | null | undefined) =>
      x !== undefined && x !== null && String(x).trim() !== '' ? String(x) : null;
    return {
      id: r.id as string,
      date_iso: r.date_iso || dateIso,
      time: v(r.time),
      worker: v(r.worker),
      client: v(r.client),
      address: v(r.address),
      note: v(r.note),
      group: v(r.group),
      sort_no: r.sort_no ?? null,
    };
  }

  async function ensureDay(d: string) {
    const { error } = await supabase
      .from('roster_days')
      .upsert({ date_iso: d, published: true }, { onConflict: 'date_iso' });
    if (error) throw error;
  }

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('roster_rows')
      .select('*')
      .eq('date_iso', dateIso)
      .order('sort_no', { ascending: true })
      .order('time', { ascending: true, nullsFirst: true });
    if (!error && data) setRows(data as Row[]);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dateIso]);

  async function addRow() {
    await ensureDay(dateIso);
    const { data, error } = await supabase
      .from('roster_rows')
      .insert({
        date_iso: dateIso,
        time: null,
        worker: '',
        client: '',
        address: '',
        note: '',
        group: null,
      })
      .select()
      .single();
    if (!error && data) {
      setRows(r =>
        [...r, data as Row].sort((a, b) =>
          (a.sort_no ?? 0) - (b.sort_no ?? 0) ||
          (a.time || '').localeCompare(b.time || '', 'cs', { numeric: true })
        )
      );
    }
  }

  // AUTOSAVE při psaní (debounce)
  function edit(id: string, key: keyof Row, val: string) {
    // lokální update
    setRows(r => r.map(x => (x.id === id ? ({ ...x, [key]: val }) : x)));

    // debounce klíč
    const tkey = `${id}:${String(key)}`;
    const timers = timersRef.current;
    clearTimeout(timers.get(tkey));
    timers.set(
      tkey,
      setTimeout(async () => {
        try {
          setSaving(true);
          const patch: Partial<Row> = sanitize({ id, date_iso: dateIso, [key]: val });
          await ensureDay(dateIso);
          const { data, error } = await supabase
            .from('roster_rows')
            .update(patch)
            .eq('id', id)
            .select()
            .single();
          if (!error && data) {
            // normalizace z DB
            setRows(arr => arr.map(r => (r.id === id ? (data as Row) : r)));
          }
        } finally {
          setSaving(false);
        }
      }, DEBOUNCE_MS)
    );
  }

  async function deleteRow(id: string) {
    await supabase.from('roster_rows').delete().eq('id', id);
    setRows(r => r.filter(x => x.id !== id));
  }

  // REALTIME: patchuj změněný řádek (bez full reloadu)
  useEffect(() => {
    const ch = supabase
      .channel('roster-live-managers')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'roster_rows' },
        (payload: any) => {
          const row = (payload.new ?? payload.old) as Row;
          if (!row || row.date_iso !== dateIso) return;

          if (payload.eventType === 'DELETE') {
            setRows(arr => arr.filter(r => r.id !== row.id));
          } else {
            setRows(arr => {
              const i = arr.findIndex(r => r.id === row.id);
              if (i === -1) {
                return [...arr, row].sort((a, b) =>
                  (a.sort_no ?? 0) - (b.sort_no ?? 0) ||
                  (a.time || '').localeCompare(b.time || '', 'cs', { numeric: true })
                );
              }
              const copy = [...arr];
              copy[i] = { ...copy[i], ...row };
              return copy;
            });
          }
        })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [dateIso]);

  return (
    <div style={{ padding: 16, fontFamily: 'Inter, system-ui' }}>
      <h1>Rozpis práce • Manažeři</h1>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <input type="date" value={dateIso} onChange={e => setDateIso(e.target.value)} />
        <button onClick={load}>Načíst</button>
        <button onClick={addRow}>Přidat řádek</button>
        {loading && <span>Načítám…</span>}
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>{isSaving ? 'Ukládám…' : ''}</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 6 }}>Čas</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Pracovník</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Klient</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Adresa</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Poznámka</th>
            <th style={{ width: 1 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={{ padding: 4 }}>
                <input
                  value={r.time || ''}
                  onChange={e => edit(r.id, 'time', e.target.value)}
                />
              </td>
              <td style={{ padding: 4 }}>
                <input
                  value={r.worker || ''}
                  onChange={e => edit(r.id, 'worker', e.target.value)}
                />
              </td>
              <td style={{ padding: 4 }}>
                <input
                  value={r.client || ''}
                  onChange={e => edit(r.id, 'client', e.target.value)}
                />
              </td>
              <td style={{ padding: 4 }}>
                <input
                  value={r.address || ''}
                  onChange={e => edit(r.id, 'address', e.target.value)}
                />
              </td>
              <td style={{ padding: 4 }}>
                <input
                  value={r.note || ''}
                  onChange={e => edit(r.id, 'note', e.target.value)}
                />
              </td>
              <td style={{ padding: 4 }}>
                <button onClick={() => deleteRow(r.id)}>Smazat</button>
              </td>
            </tr>
          ))}
          {!rows.length && !loading && (
            <tr>
              <td colSpan={6} style={{ padding: 10, color: '#6b7280' }}>
                Žádné řádky pro vybrané datum.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}