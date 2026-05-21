// Handles ad videos and sponsor logos
// POST /api/media/upload — upload file to Supabase Storage, save record
// GET  /api/media/ads — get active ads in rotation order
// GET  /api/media/sponsors — get active sponsors
// POST /api/media/ad-play — record partial or full play
// POST /api/media/sponsor-click — record sponsor click
// PATCH /api/media/ads — update ad (active toggle, reorder)
// PATCH /api/media/sponsors — update sponsor
// DELETE /api/media/ads?id=X — remove ad
// DELETE /api/media/sponsors?id=X — remove sponsor

const SUPABASE_URL = 'https://bmhaihybdnaufprysjbw.supabase.co';
const ADMIN_EMAIL = 'swpage89@gmail.com';
const BUCKET = 'media';

function getKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY; }

async function sbRest(path, method, body, key, extra) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: method || 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', 'Prefer': 'return=representation', ...extra },
    body: body ? JSON.stringify(body) : undefined
  });
  return r;
}

async function uploadToStorage(buffer, path, mimeType, key) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': mimeType, 'x-upsert': 'true' },
    body: buffer
  });
  if (!r.ok) throw new Error(`Storage upload failed: ${r.status} ${await r.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

function isAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return (payload.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
  } catch(e) { return false; }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '30mb',   // base64 inflates ~33%, so 20MB file ≈ 27MB body
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = getKey();
  if (!key) return res.status(500).json({ error: 'Server misconfigured' });

  const path = req.query.type || '';

  // ── PUBLIC ENDPOINTS ────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === 'ads') {
    const r = await sbRest('/ad_videos?active=eq.true&order=position.asc', 'GET', null, key);
    return res.status(200).json(r.ok ? await r.json() : []);
  }

  if (req.method === 'GET' && path === 'sponsors') {
    const r = await sbRest('/sponsors?active=eq.true&order=tier.desc,created_at.asc', 'GET', null, key);
    return res.status(200).json(r.ok ? await r.json() : []);
  }

  // Returns the most recently uploaded game-won sound
  if (req.method === 'GET' && path === 'game-sound') {
    const r = await sbRest('/game_sounds?order=created_at.desc&limit=1', 'GET', null, key);
    if (!r.ok) return res.status(200).json({});
    const rows = await r.json();
    return res.status(200).json(rows[0] || {});
  }

  // Track ad play (partial or full)
  // sendBeacon sends text/plain so we handle both content types
  if (req.method === 'POST' && path === 'ad-play') {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) { body = {}; }
    }
    const { id, full } = body;
    if (!id) return res.status(200).end(); // sendBeacon ignores response anyway
    const field = full ? 'full_plays' : 'partial_plays';
    const cur = await sbRest(`/ad_videos?id=eq.${encodeURIComponent(id)}&select=${field}`, 'GET', null, key);
    const rows = cur.ok ? await cur.json() : [];
    if (rows.length) {
      await sbRest(`/ad_videos?id=eq.${encodeURIComponent(id)}`, 'PATCH',
        { [field]: (rows[0][field] || 0) + 1 }, key);
    }
    return res.status(200).end();
  }

  // Track sponsor click
  if (req.method === 'POST' && path === 'sponsor-click') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const cur = await sbRest(`/sponsors?id=eq.${id}&select=clicks`, 'GET', null, key);
    const rows = cur.ok ? await cur.json() : [];
    if (rows.length) {
      await sbRest(`/sponsors?id=eq.${id}`, 'PATCH', { clicks: (rows[0].clicks || 0) + 1 }, key);
    }
    return res.status(200).json({ ok: true });
  }

  // ── ADMIN ONLY BELOW ────────────────────────────────────────────────────────
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  // GET all ads or sponsors (including inactive) for admin
  if (req.method === 'GET' && path === 'all-ads') {
    const r = await sbRest('/ad_videos?order=position.asc', 'GET', null, key);
    return res.status(200).json(r.ok ? await r.json() : []);
  }
  if (req.method === 'GET' && path === 'all-sponsors') {
    const r = await sbRest('/sponsors?order=tier.desc,created_at.asc', 'GET', null, key);
    return res.status(200).json(r.ok ? await r.json() : []);
  }
  if (req.method === 'GET' && path === 'all-game-sounds') {
    const r = await sbRest('/game_sounds?order=created_at.desc', 'GET', null, key);
    return res.status(200).json(r.ok ? await r.json() : []);
  }

  // GET ?type=sign-upload — returns a signed Supabase Storage URL so the browser
  // can upload the file directly, bypassing Vercel's 4.5MB body limit entirely.
  if (req.method === 'GET' && path === 'sign-upload') {
    const { name, mimeType, uploadType } = req.query;
    if (!name || !mimeType || !uploadType) return res.status(400).json({ error: 'Missing params' });
    const ext = mimeType.split('/')[1]?.replace('jpeg','jpg') || 'bin';
    const filePath = `${uploadType}s/${Date.now()}-${name.replace(/[^a-z0-9]/gi,'-').toLowerCase()}.${ext}`;
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${filePath}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 })
    });
    if (!r.ok) return res.status(500).json({ error: `Could not create signed URL: ${await r.text()}` });
    const { signedURL, token } = await r.json();
    return res.status(200).json({
      signedURL: `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${filePath}?token=${token}`,
      filePath,
      fileUrl: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filePath}`
    });
  }

  // POST ?type=save-record — saves DB record after browser has uploaded file directly
  if (req.method === 'POST' && path === 'save-record') {
    const { name, filePath, fileUrl, mimeType, uploadType, tier, websiteUrl, durationSeconds } = req.body || {};
    if (!name || !filePath || !fileUrl || !uploadType) return res.status(400).json({ error: 'Missing fields' });

    if (uploadType === 'ad') {
      const existing = await sbRest('/ad_videos?order=position.desc&limit=1&select=position', 'GET', null, key);
      const rows = existing.ok ? await existing.json() : [];
      const pos = rows.length ? (rows[0].position + 1) : 1;
      if (pos > 4) return res.status(400).json({ error: 'Maximum 4 ads allowed' });
      const r = await sbRest('/ad_videos', 'POST', {
        name, file_path: filePath, file_url: fileUrl, position: pos, active: true,
        duration_seconds: durationSeconds ? parseFloat(durationSeconds) : null
      }, key);
      return res.status(r.ok ? 201 : 500).json(r.ok ? { ok: true } : { error: await r.text() });
    }

    if (uploadType === 'sponsor') {
      const r = await sbRest('/sponsors', 'POST', {
        name, file_path: filePath, file_url: fileUrl,
        website_url: websiteUrl ? (websiteUrl.startsWith('http') ? websiteUrl : 'https://' + websiteUrl) : null,
        tier: tier || 'community', active: true
      }, key);
      return res.status(r.ok ? 201 : 500).json(r.ok ? { ok: true } : { error: await r.text() });
    }

    if (uploadType === 'game-sound') {
      const r = await sbRest('/game_sounds', 'POST', {
        name, file_path: filePath, file_url: fileUrl
      }, key, { Prefer: 'return=representation' });
      return res.status(r.ok ? 201 : 500).json(r.ok ? { ok: true } : { error: await r.text() });
    }
    return res.status(400).json({ error: 'Invalid uploadType' });
  }

  // Upload file — expects multipart base64 body
  // { name, fileBase64, mimeType, type: 'ad'|'sponsor', position?, tier?, websiteUrl? }
  if (req.method === 'POST' && path === 'upload') {
    const { name, fileBase64, mimeType, uploadType, position, tier, websiteUrl, durationSeconds } = req.body || {};
    if (!name || !fileBase64 || !mimeType || !uploadType) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    const ext = mimeType.split('/')[1]?.replace('jpeg','jpg') || 'bin';
    const filePath = `${uploadType}s/${Date.now()}-${name.replace(/[^a-z0-9]/gi,'-').toLowerCase()}.${ext}`;

    let fileUrl;
    try { fileUrl = await uploadToStorage(buffer, filePath, mimeType, key); }
    catch(e) { return res.status(500).json({ error: e.message }); }

    if (uploadType === 'ad') {
      let pos = parseInt(position) || null;
      if (!pos) {
        const existing = await sbRest('/ad_videos?order=position.desc&limit=1&select=position', 'GET', null, key);
        const rows = existing.ok ? await existing.json() : [];
        pos = rows.length ? (rows[0].position + 1) : 1;
      }
      if (pos > 4) return res.status(400).json({ error: 'Maximum 4 ads allowed' });
      const r = await sbRest('/ad_videos', 'POST', {
        name, file_path: filePath, file_url: fileUrl, position: pos, active: true, duration_seconds: durationSeconds ? parseFloat(durationSeconds) : null
      }, key);
      return res.status(r.ok ? 201 : 500).json(r.ok ? { ok: true } : { error: await r.text() });
    }

    if (uploadType === 'sponsor') {
      const r = await sbRest('/sponsors', 'POST', {
        name, file_path: filePath, file_url: fileUrl,
        website_url: websiteUrl ? (websiteUrl.startsWith('http') ? websiteUrl : 'https://' + websiteUrl) : null,
        tier: tier || 'community', active: true
      }, key);
      return res.status(r.ok ? 201 : 500).json(r.ok ? { ok: true } : { error: await r.text() });
    }
    return res.status(400).json({ error: 'Invalid uploadType' });
  }

  // Toggle active / update position
  if (req.method === 'PATCH' && path === 'ads') {
    const { id, active, position } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const update = {};
    if (active !== undefined) update.active = active;
    if (position !== undefined) update.position = position;
    const r = await sbRest(`/ad_videos?id=eq.${id}`, 'PATCH', update, key);
    return res.status(r.ok ? 200 : 500).json(r.ok ? { ok: true } : { error: await r.text() });
  }

  if (req.method === 'PATCH' && path === 'sponsors') {
    const { id, active, websiteUrl, name } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const update = {};
    if (active !== undefined) update.active = active;
    if (websiteUrl !== undefined) update.website_url = websiteUrl;
    if (name !== undefined) update.name = name;
    const r = await sbRest(`/sponsors?id=eq.${id}`, 'PATCH', update, key);
    return res.status(r.ok ? 200 : 500).json(r.ok ? { ok: true } : { error: await r.text() });
  }

  // Delete
  if (req.method === 'DELETE' && path === 'ads') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const r = await sbRest(`/ad_videos?id=eq.${id}`, 'DELETE', null, key);
    return res.status(r.ok ? 200 : 500).json(r.ok ? { ok: true } : { error: await r.text() });
  }

  if (req.method === 'DELETE' && path === 'sponsors') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const r = await sbRest(`/sponsors?id=eq.${id}`, 'DELETE', null, key);
    return res.status(r.ok ? 200 : 500).json(r.ok ? { ok: true } : { error: await r.text() });
  }

  if (req.method === 'DELETE' && path === 'game-sounds') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const r = await sbRest(`/game_sounds?id=eq.${id}`, 'DELETE', null, key);
    return res.status(r.ok ? 200 : 500).json(r.ok ? { ok: true } : { error: await r.text() });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}