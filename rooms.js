// POST /api/register-stream  { roomId, broadcasterEmail }
// Records which email is hosting a given room — used by flag.js on ban.
// Non-fatal: if the DB write fails, streaming still works fine.

const SUPABASE_URL = 'https://bmhaihybdnaufprysjbw.supabase.co';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { roomId, broadcasterEmail } = req.body || {};
  if (!roomId || !broadcasterEmail) {
    return res.status(400).json({ error: 'Missing roomId or broadcasterEmail' });
  }

  // Requires SUPABASE_SERVICE_ROLE_KEY in Vercel env vars.
  // Without it we log a warning but return 200 so the broadcast isn't blocked.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.warn('register-stream: SUPABASE_SERVICE_ROLE_KEY not set — skipping DB write. ' +
      'Add it in Vercel → Settings → Environment Variables to enable ban/suspend features.');
    return res.status(200).json({ ok: true, warning: 'service key not configured' });
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/live_streams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        room_id: roomId,
        broadcaster_email: broadcasterEmail.trim().toLowerCase(),
        started_at: new Date().toISOString()
      })
    });

    if (!r.ok) {
      const err = await r.text();
      // Log but don't fail — streaming works without this
      console.error('register-stream DB error:', r.status, err);
      return res.status(200).json({ ok: true, warning: 'DB write failed: ' + err });
    }

    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('register-stream error:', e.message);
    // Still return 200 — this is non-fatal
    return res.status(200).json({ ok: true, warning: e.message });
  }
}
