import { put, list } from '@vercel/blob';

const BLOB_NAME = 'teams.json';
const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || 'tijuquinho2025';
// Private history password — owner only, NOT shared with captains.
// Must be set as an env var (the repo is public, so there is no code default).
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || '';
const LOG_MAX = 300; // keep the most recent N history entries

const DEFAULT_SETTINGS = {
  dateBig: '15/11 · 29/11',
  dateSub: 'a confirmar',
  timeBig: '13h — 20h',
  timeSub: 'sábado',
};

async function readData() {
  const { blobs } = await list({ prefix: BLOB_NAME });
  const found = blobs.find((b) => b.pathname === BLOB_NAME);
  if (!found) return { teams: [], settings: { ...DEFAULT_SETTINGS }, log: [] };
  // Cache-busting query so we never read a stale CDN copy after an overwrite.
  const bust = found.url + (found.url.includes('?') ? '&' : '?') + 'ts=' + Date.now();
  const r = await fetch(bust, { cache: 'no-store' });
  if (!r.ok) return { teams: [], settings: { ...DEFAULT_SETTINGS }, log: [] };
  const j = await r.json();
  const teams = Array.isArray(j.teams) ? j.teams : [];
  const settings = sanitizeSettings(j.settings);
  const log = Array.isArray(j.log) ? j.log : [];
  return { teams, settings, log };
}

async function writeData(teams, settings, log) {
  await put(
    BLOB_NAME,
    JSON.stringify({ teams, settings, log: (log || []).slice(0, LOG_MAX), updatedAt: Date.now() }),
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

/* ---------- device / history helpers ---------- */
function uaSummary(ua) {
  ua = String(ua || '');
  let os = '?';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';
  let br = '?';
  if (/SamsungBrowser/i.test(ua)) br = 'Samsung';
  else if (/Edg\//i.test(ua)) br = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) br = 'Opera';
  else if (/Firefox\//i.test(ua)) br = 'Firefox';
  else if (/Chrome\//i.test(ua)) br = 'Chrome';
  else if (/Safari\//i.test(ua)) br = 'Safari';
  return os + ' · ' + br;
}
function ipFrom(req) {
  const xf = String(req.headers['x-forwarded-for'] || '');
  return (xf.split(',')[0].trim() || String(req.headers['x-real-ip'] || '')).slice(0, 60);
}
function deviceFrom(req, body) {
  return {
    ua: uaSummary(req.headers['user-agent']),
    tag: String((body && body.deviceId) || '').replace(/[^a-z0-9]/gi, '').slice(0, 20),
    ip: ipFrom(req),
  };
}
function teamSig(t) {
  return (t.members || [])
    .map((m) => m.name + '|' + (m.isGirl ? '1' : '0') + '|' + (m.isExternal ? '1' : '0'))
    .join(',');
}
function logEntry(action, team, detail, dev) {
  return { ts: Date.now(), action, team: team || '', detail: detail || '', ...dev };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    // Public view never exposes the history.
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
    const dev = deviceFrom(req, body);

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
        const { teams, settings, log } = await readData();
        if (teams.length >= 10) {
          return res.status(409).json({ ok: false, message: 'Maximo de 10 times atingido.' });
        }
        teams.push(t);
        log.unshift(logEntry('create', t.name, t.members.length + ' integrantes', dev));
        await writeData(teams, settings, log);
        return res.status(200).json({ ok: true, teams, settings });
      } catch (e) {
        return res.status(500).json({ ok: false, message: 'Erro ao salvar.', error: String(e) });
      }
    }

    // ---- OWNER ONLY: read the history (separate private password) ----
    if (body.action === 'getlog') {
      if (!OWNER_PASSWORD) {
        return res.status(403).json({ ok: false, message: 'Historico protegido: configure OWNER_PASSWORD no Vercel.' });
      }
      if ((body.password || '') !== OWNER_PASSWORD) {
        return res.status(401).json({ ok: false, message: 'Senha incorreta.' });
      }
      if (!hasBlob) return res.status(200).json({ ok: true, log: [] });
      try {
        const { log } = await readData();
        return res.status(200).json({ ok: true, log });
      } catch (e) {
        return res.status(500).json({ ok: false, message: 'Erro ao ler o historico.', error: String(e) });
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
    try {
      const old = await readData();
      const settings = body.settings ? sanitizeSettings(body.settings) : old.settings;
      const log = old.log || [];

      // Build history entries by diffing the previous list against the new one.
      const oldByName = {}; old.teams.forEach((t) => { oldByName[t.name] = t; });
      const newByName = {}; teams.forEach((t) => { newByName[t.name] = t; });
      const entries = [];
      old.teams.forEach((t) => {
        if (!(t.name in newByName)) entries.push(logEntry('delete', t.name, (t.members || []).length + ' integrantes', dev));
      });
      teams.forEach((t) => {
        if (!(t.name in oldByName)) entries.push(logEntry('create', t.name, t.members.length + ' integrantes', dev));
        else if (teamSig(t) !== teamSig(oldByName[t.name])) entries.push(logEntry('edit', t.name, t.members.length + ' integrantes', dev));
      });
      if (JSON.stringify(settings) !== JSON.stringify(old.settings)) {
        entries.push(logEntry('settings', '', settings.dateBig + ' · ' + settings.timeBig, dev));
      }
      // newest first
      for (let i = entries.length - 1; i >= 0; i--) log.unshift(entries[i]);

      await writeData(teams, settings, log);
      return res.status(200).json({ ok: true, teams, settings });
    } catch (e) {
      return res.status(500).json({ ok: false, message: 'Erro ao salvar.', error: String(e) });
    }
  }

  return res.status(405).json({ ok: false, message: 'Metodo nao permitido.' });
}
