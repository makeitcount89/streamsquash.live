const SUPABASE_URL = 'https://bmhaihybdnaufprysjbw.supabase.co';
const MAX_PER_HOST = 2;
const TTL_DAYS = 2;

async function sb(path, method, body, key, extra) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: method || 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
      ...extra
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return r;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(500).json({ error: 'Missing service key' });

  // Get host email from Supabase auth JWT
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  let hostEmail;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    hostEmail = payload.email;
    if (!hostEmail) throw new Error('No email in token');
  } catch(e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const cutoff = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    // ── GET — fetch incomplete matches for this host ──────────────────────────
    if (req.method === 'GET') {
      const r = await sb(
        `/incomplete_matches?host_email=eq.${encodeURIComponent(hostEmail)}&updated_at=gte.${cutoff}&order=updated_at.desc&limit=${MAX_PER_HOST}`,
        'GET', null, key
      );
      if (!r.ok) return res.status(200).json([]);
      const rows = await r.json();
      return res.status(200).json(rows.map(m => ({
        id: m.id,
        p1: m.p1, p2: m.p2,
        bestOf: m.best_of,
        scoreState: m.score_state,
        startedAt: m.started_at,
        updatedAt: m.updated_at
      })));
    }

    // ── POST — upsert incomplete match state ──────────────────────────────────
    if (req.method === 'POST') {
      const { id, p1, p2, bestOf, scoreState, startedAt } = req.body || {};
      if (!id || !p1 || !p2) return res.status(400).json({ error: 'Missing fields' });

      // First, clean up expired rows for this host
      await sb(
        `/incomplete_matches?host_email=eq.${encodeURIComponent(hostEmail)}&updated_at=lt.${cutoff}`,
        'DELETE', null, key
      );

      // Check how many this host currently has
      const countR = await sb(
        `/incomplete_matches?host_email=eq.${encodeURIComponent(hostEmail)}&select=id,updated_at&order=updated_at.asc`,
        'GET', null, key
      );
      if (countR.ok) {
        const existing = await countR.json();
        // If already at max and this is a NEW id, delete the oldest to make room
        const ids = existing.map(r => r.id);
        if (existing.length >= MAX_PER_HOST && !ids.includes(id)) {
          const oldest = existing[0].id;
          await sb(`/incomplete_matches?id=eq.${encodeURIComponent(oldest)}&host_email=eq.${encodeURIComponent(hostEmail)}`, 'DELETE', null, key);
        }
      }

      // Upsert the current match state
      const r = await sb('/incomplete_matches', 'POST', {
        id,
        host_email: hostEmail,
        p1: String(p1).substring(0, 30),
        p2: String(p2).substring(0, 30),
        best_of: bestOf || 5,
        score_state: scoreState,
        started_at: startedAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, key, { Prefer: 'resolution=merge-duplicates,return=minimal' });

      if (!r.ok) {
        const err = await r.text();
        console.error('incomplete_matches upsert:', r.status, err);
        return res.status(500).json({ error: err });
      }
      return res.status(200).json({ ok: true });
    }

    // ── DELETE — remove a match (completed or dismissed) ─────────────────────
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sb(
        `/incomplete_matches?id=eq.${encodeURIComponent(id)}&host_email=eq.${encodeURIComponent(hostEmail)}`,
        'DELETE', null, key
      );
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch(e) {
    console.error('incomplete-matches error:', e);
    return res.status(500).json({ error: e.message });
  }
}
