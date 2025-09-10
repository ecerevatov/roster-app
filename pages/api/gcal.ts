// pages/api/gcal.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';

function getEnv(name: string): string {
  let v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  if (name === 'GOOGLE_PRIVATE_KEY') v = v.replace(/\\n/g, '\n');
  return v;
}

type ApiRow = {
  time: string;
  worker: string;
  client: string;
  address: string;
  note: string;
  group: string;
};

const toHHMM = (s?: string): string =>
  s ? new Date(s).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const dateISO = (typeof req.query.date === 'string' && req.query.date) || new Date().toISOString().slice(0, 10);

    const start = new Date(`${dateISO}T00:00:00.000Z`);
    const end   = new Date(`${dateISO}T23:59:59.999Z`);

    const auth = new google.auth.JWT({
      email: getEnv('GOOGLE_CLIENT_EMAIL'),
      key:   getEnv('GOOGLE_PRIVATE_KEY'),
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    const calendar = google.calendar({ version: 'v3', auth });

    const resp = await calendar.events.list({
      calendarId: getEnv('GOOGLE_CALENDAR_ID'),
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const rows: ApiRow[] = (resp.data.items ?? []).map((ev: calendar_v3.Schema$Event): ApiRow => {
      const startStr = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : undefined);
      const endStr   = ev.end?.dateTime   || (ev.end?.date   ? `${ev.end.date}T23:59:59Z` : undefined);

      return {
        time:   startStr && endStr ? `${toHHMM(startStr)}–${toHHMM(endStr)}` : (toHHMM(startStr) || ''),
        worker:
          ev.organizer?.displayName ||
          ev.organizer?.email ||
          ev.attendees?.[0]?.displayName ||
          ev.attendees?.[0]?.email ||
          '',
        client:  ev.summary   || '',
        address: ev.location  || '',
        note:    ev.description || '',
        group:   '',
      };
    });

    res.status(200).json({ dateISO, rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'gcal error';
    console.error('gcal error:', e);
    res.status(500).json({ error: msg });
  }
}