const SUPABASE_URL = 'https://bmhaihybdnaufprysjbw.supabase.co';

function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function sb(path, method, body, key, extra) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: method || 'GET',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal', ...extra
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return r;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(500).json({ error: 'Server misconfigured' });

  // GET /api/highlights — public, returns approved only
  // GET /api/highlights?pending=1 — admin only, returns pending
  if (req.method === 'GET') {
    if (req.query.pending === '1') {
      // Verify admin
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Unauthorised' });
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if ((payload.email || '').toLowerCase() !== 'swpage89@gmail.com') {
          return res.status(403).json({ error: 'Forbidden' });
        }
      } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }

      const r = await sb('/highlights?status=eq.pending&order=submitted_at.asc', 'GET', null, key);
      if (!r.ok) return res.status(500).json({ error: await r.text() });
      return res.status(200).json(await r.json());
    }

    // ?all=1 — admin only, returns all highlights regardless of status
    if (req.query.all === '1') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Unauthorised' });
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if ((payload.email || '').toLowerCase() !== 'swpage89@gmail.com') {
          return res.status(403).json({ error: 'Forbidden' });
        }
      } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
      const r = await sb('/highlights?order=submitted_at.desc', 'GET', null, key);
      if (!r.ok) return res.status(200).json([]);
      return res.status(200).json(await r.json());
    }

    // Public approved highlights — user-submitted first, admin bulk below
    const r = await sb('/highlights?status=eq.approved&limit=50', 'GET', null, key);
    if (!r.ok) return res.status(200).json([]);
    const data = await r.json();
    // Sort JS-side: admin_inserted last, then newest first within each group.
    // Works even if the column doesn't exist yet (undefined is falsy → treated as user-submitted).
    data.sort((a, b) => {
      const ai = a.admin_inserted ? 1 : 0;
      const bi = b.admin_inserted ? 1 : 0;
      if (ai !== bi) return ai - bi;
      return new Date(b.submitted_at) - new Date(a.submitted_at);
    });
    return res.status(200).json(data);
  }

  // POST /api/highlights — bulk admin insert (urls array + admin token)
  if (req.method === 'POST' && Array.isArray(req.body?.urls)) {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorised' });
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      if ((payload.email || '').toLowerCase() !== 'swpage89@gmail.com')
        return res.status(403).json({ error: 'Forbidden' });
    } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }

    const results = [];
    for (const url of req.body.urls) {
      const youtube_id = extractYouTubeId(String(url).trim());
      if (!youtube_id) { results.push({ url, ok: false, error: 'Invalid URL' }); continue; }

      // Fetch title from YouTube oEmbed (no API key needed)
      let title = youtube_id;
      try {
        const oe = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${youtube_id}&format=json`);
        if (oe.ok) title = (await oe.json()).title || youtube_id;
      } catch(_) {}

      const r = await sb('/highlights', 'POST', {
        youtube_url: `https://www.youtube.com/watch?v=${youtube_id}`,
        youtube_id,
        title: String(title).substring(0, 100),
        match_desc: '',
        submitted_by: 'admin',
        status: 'approved',
        admin_inserted: true,
        submitted_at: new Date().toISOString(),
      }, key, { Prefer: 'return=representation' });

      results.push({ url, youtube_id, title, ok: r.ok, error: r.ok ? null : await r.text() });
    }
    return res.status(200).json(results);
  }

  // POST /api/highlights — submit a highlight (must be approved broadcaster)
  if (req.method === 'POST') {
    const { youtube_url, title, match_desc, broadcaster_email } = req.body || {};
    if (!youtube_url || !title) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const youtube_id = extractYouTubeId(youtube_url);
    if (!youtube_id) return res.status(400).json({ error: 'Invalid YouTube URL' });

    const r = await sb('/highlights', 'POST', {
      youtube_url, youtube_id,
      title: String(title).substring(0, 100),
      match_desc: String(match_desc || '').substring(0, 80),
      submitted_by: String(broadcaster_email || 'Anonymous').substring(0, 60),
      status: 'pending'
    }, key, { Prefer: 'return=representation' });

    if (!r.ok) return res.status(500).json({ error: await r.text() });
    return res.status(201).json({ ok: true });
  }

  // PATCH /api/highlights — approve or reject (admin only)
  if (req.method === 'PATCH') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorised' });
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      if ((payload.email || '').toLowerCase() !== 'swpage89@gmail.com') {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }

    // Bulk reject — ids array
    if (Array.isArray(req.body?.ids)) {
      const ids = req.body.ids.filter(i => typeof i === 'string' && i.length > 0);
      if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
      const r = await sb(
        `/highlights?id=in.(${ids.map(i => encodeURIComponent(i)).join(',')})`,
        'PATCH',
        { status: 'rejected', reviewed_at: new Date().toISOString() },
        key
      );
      if (!r.ok) return res.status(500).json({ error: await r.text() });
      return res.status(200).json({ ok: true, removed: ids.length });
    }

    const { id, action } = req.body || {};
    if (!id || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Missing id or action' });
    }

    const r = await sb(
      `/highlights?id=eq.${encodeURIComponent(id)}`,
      'PATCH',
      { status: action === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString() },
      key
    );
    if (!r.ok) return res.status(500).json({ error: await r.text() });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}