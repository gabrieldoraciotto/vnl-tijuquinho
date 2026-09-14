import { put, list } from '@vercel/blob';

const BLOB_NAME = 'teams.json';
const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || 'tijuquinho2025';

async function readTeams() {
  const { blobs } = await list({ prefix: BLOB_NAME });
  const found = blobs.find((b) => b.pathname === BLOB_NAME);
  if (!found) return [];
  const r = await fetch(found.url, { cache: 'no-store' });
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j.teams) ? j.teams : [];
}

async function writeTeams(teams) {
  await put(BLOB_NAME, JSON.stringify({ teams, updatedAt: Date.now() }), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
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
    if (!hasBlob) return res.status(200).json({ teams: [], configured: false });
    try {
      const teams = await readTeams();
      return res.status(200).json({ teams, configured: true });
    } catch (e) {
      return res.status(200).json({ teams: [], configured: true, error: String(e) });
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
        const teams = await readTeams();
        if (teams.length >= 10) {
          return res.status(409).json({ ok: false, message: 'Maximo de 10 times atingido.' });
        }
        teams.push(t);
        await writeTeams(teams);
        return res.status(200).json({ ok: true, teams });
      } catch (e) {
        return res.status(500).json({ ok: false, message: 'Erro ao salvar.', error: String(e) });
      }
    }

    // ---- CAPTAINS ONLY: full save (edit + delete) ----
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
    try {
      await writeTeams(teams);
      return res.status(200).json({ ok: true, teams });
    } catch (e) {
      return res.status(500).json({ ok: false, message: 'Erro ao salvar.', error: String(e) });
    }
  }

  return res.status(405).json({ ok: false, message: 'Metodo nao permitido.' });
}
