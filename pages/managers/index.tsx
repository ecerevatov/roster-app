'use client';
import { useEffect, useState } from 'react';
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
};

export default function ManagersPage() {
  const [dateIso, setDateIso] = useState<string>(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateIso]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('roster_rows')
      .select('*')
      .eq('date_iso', dateIso)
      .order('time', { ascending: true });

    if (!error && data) setRows(data as Row[]);
    setLoading(false);
  }

  async function addRow() {
    const { data, error } = await supabase
      .from('roster_rows')
      .insert({
        date_iso: dateIso,
        time: null,
        worker: '',
        client: '',
        address: '',
        note: '',
        group: null
      })
      .select()
      .single();

    if (!error && data) setRows((r) => [...r, data as Row]);
  }

  function sanitize(r: Row) {
    // převést prázdné stringy na null (ať se to dobře ukládá)
    const v = (x: string | null | undefined) => (x !== undefined && x !== null && x.trim() !== '' ? x : null);
    return {
      id: r.id,
      date_iso: r.date_iso || dateIso,
      time: v(r.time || ''),
      worker: v(r.worker || ''),
      client: v(r.client || ''),
      address: v(r.address || ''),
      note: v(r.note || ''),
      group: v(r.group || '')
    };
  }

  async function saveRowById(id: string) {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    const payload = sanitize(r);
    await supabase.from('roster_rows').update(payload).eq('id', id);
  }

  async function deleteRow(id: string) {
    await supabase.from('roster_rows').delete().eq('id', id);
    setRows((r) => r.filter((x) => x.id !== id));
  }

  function edit(id: string, key: keyof Row, val: string) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, [key]: val } : x)));
  }

  return (
    <div style={{ padding: 16, fontFamily: 'Inter, system-ui' }}>
      <h1>Rozpis práce • Manažeři</h1>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <input type="date" value={dateIso} onChange={(e) => setDateIso(e.target.value)} />
        <button onClick={load}>Načíst</button>
        <button onClick={addRow}>Přidat řádek</button>
        {loading && <span>Načítám…</span>}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 6 }}>Čas</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Pracovník</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Klient</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Adresa</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Poznámka</th>
            <th style={{ width: 1 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: 4 }}>
                <input
                  value={r.time || ''}
                  onChange={(e) => edit(r.id, 'time', e.target.value)}
                  onBlur={() => saveRowById(r.id)}
                />
              </td>
              <td style={{ padding: 4 }}>
                <input
                  value={r.worker || ''}
                  onChange={(e) => edit(r.id, 'worker', e.target.value)}
                  onBlur={() => saveRowById(r.id)}
                />
              </td>
              <td style={{ padding: 4 }}>
                <input
                  value={r.client || ''}
                  onChange={(e) => edit(r.id, 'client', e.target.value)}
                  onBlur={() => saveRowById(r.id)}
                />
              </td>
              <td style={{ padding: 4 }}>
                <input
                  value={r.address || ''}
                  onChange={(e) => edit(r.id, 'address', e.target.value)}
                  onBlur={() => saveRowById(r.id)}
                />
              </td>
              <td style={{ padding: 4 }}>
                <input
                  value={r.note || ''}
                  onChange={(e) => edit(r.id, 'note', e.target.value)}
                  onBlur={() => saveRowById(r.id)}
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