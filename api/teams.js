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

    if ((body.password || '') !== EDIT_PASSWORD) {
      return res.status(401).json({ ok: false, message: 'Senha incorreta.' });
    }
    if (!hasBlob) {
      return res.status(503).json({ ok: false, message: 'Armazenamento ainda nao configurado.' });
    }
    const teams = Array.isArray(body.teams) ? body.teams : [];
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
