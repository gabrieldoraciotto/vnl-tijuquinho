import { put, list } from '@vercel/blob';

const BLOB_NAME = 'teams.json';
const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || 'tijuquinho2025';

const DEFAULT_SETTINGS = {
  dateBig: '15/11 · 29/11',
  dateSub: 'a confirmar',
  timeBig: '13h — 20h',
  timeSub: 'sábado',
};

async function readData() {
  const { blobs } = await list({ prefix: BLOB_NAME });
  const found = blobs.find((b) => b.pathname === BLOB_NAME);
  if (!found) return { teams: [], settings: { ...DEFAULT_SETTINGS } };
  // Cache-busting query so we never read a stale CDN copy after an overwrite.
  const bust = found.url + (found.url.includes('?') ? '&' : '?') + 'ts=' + Date.now();
  const r = await fetch(bust, { cache: 'no-store' });
  if (!r.ok) return { teams: [], settings: { ...DEFAULT_SETTINGS } };
  const j = await r.json();
  const teams = Array.isArray(j.teams) ? j.teams : [];
  const settings = sanitizeSettings(j.settings);
  return { teams, settings };
}

async function writeData(teams, settings) {
  await put(
    BLOB_NAME,
    JSON.stringify({ teams, settings, updatedAt: Date.now() }),
    {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0, // don't let the CDN cache the data file
    }
  );
}

function sanitizeSettings(s) {
  s = s || {};
  const clip = (v, fallback) => {
    const str = String(v == null ? '' : v).trim().slice(0, 80);
    return str || fallback;
  };
  return {
    dateBig: clip(s.dateBig, DEFAULT_SETTINGS.dateBig),
    dateSub: clip(s.dateSub, DEFAULT_SETTINGS.dateSub),
    timeBig: clip(s.timeBig, DEFAULT_SETTINGS.timeBig),
    timeSub: clip(s.timeSub, DEFAULT_SETTINGS.timeSub),
  };
}

function sanitizeTeam(t) {
  t = t || {};
  const members = (Array.isArray(t.members) ? t.members : [])
    .map((m) => ({
      name: String((m && m.name) || '').trim(),
      isGirl: !!(m && m.isGirl),
      isExternal: !!(m && m.isExternal),
    }))
    .filter((m) => m.name);
  return { name: String(t.name || '').trim(), members };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    if (!hasBlob) {
      return res.status(200).json({ teams: [], settings: { ...DEFAULT_SETTINGS }, configured: false });
    }
    try {
      const { teams, settings } = await readData();
      return res.status(200).json({ teams, settings, configured: true });
    } catch (e) {
      return res.status(200).json({ teams: [], settings: { ...DEFAULT_SETTINGS }, configured: true, error: String(e) });
    }
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch { body = {}; }
    }
    body = body || {};

    // ---- PUBLIC: create a single team (no password needed) ----
    if (body.action === 'create') {
      if (!hasBlob) {
        return res.status(503).json({ ok: false, message: 'Armazenamento ainda nao configurado.' });
      }
      const t = sanitizeTeam(body.team);
      if (!t.name) return res.status(400).json({ ok: false, message: 'De um nome ao time.' });
      if (!t.members.length) return res.status(400).json({ ok: false, message: 'Adicione ao menos 1 integrante.' });
      if (t.members.length > 6) return res.status(400).json({ ok: false, message: 'Maximo de 6 integrantes.' });
      if (t.members.filter((m) => m.isExternal).length > 2) {
        return res.status(400).json({ ok: false, message: 'Maximo de 2 externos.' });
      }
      try {
        const { teams, settings } = await readData();
        if (teams.length >= 10) {
          return res.status(409).json({ ok: false, message: 'Maximo de 10 times atingido.' });
        }
        teams.push(t);
        await writeData(teams, settings);
        return res.status(200).json({ ok: true, teams, settings });
      } catch (e) {
        return res.status(500).json({ ok: false, message: 'Erro ao salvar.', error: String(e) });
      }
    }

    // ---- CAPTAINS ONLY: full save (edit + delete teams and settings) ----
    if ((body.password || '') !== EDIT_PASSWORD) {
      return res.status(401).json({ ok: false, message: 'Senha incorreta.' });
    }
    if (!hasBlob) {
      return res.status(503).json({ ok: false, message: 'Armazenamento ainda nao configurado.' });
    }
    const teams = (Array.isArray(body.teams) ? body.teams : []).map(sanitizeTeam);
    if (teams.length > 10) {
      return res.status(400).json({ ok: false, message: 'Maximo de 10 times.' });
    }
    // Settings are optional: if the client sends them, save them; otherwise keep what's stored.
    let settings;
    if (body.settings) {
      settings = sanitizeSettings(body.settings);
    } else {
      try {
        settings = (await readData()).settings;
      } catch {
        settings = { ...DEFAULT_SETTINGS };
      }
    }
    try {
      await writeData(teams, settings);
      return res.status(200).json({ ok: true, teams, settings });
    } catch (e) {
      return res.status(500).json({ ok: false, message: 'Erro ao salvar.', error: String(e) });
    }
  }

  return res.status(405).json({ ok: false, message: 'Metodo nao permitido.' });
}
