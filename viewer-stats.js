// GET /api/stream-status?roomId=X
// Returns { banned: bool } — polled by broadcaster and viewers every 10s

const SUPABASE_URL = 'https://bmhaihybdnaufprysjbw.supabase.co';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { roomId } = req.query;
  if (!roomId) return res.status(400).json({ error: 'Missing roomId' });

  // Use anon key — stream_bans has public read RLS policy
  const anonKey = process.env.SUPABASE_ANON_KEY ||
    'sb_publishable_0QwuePBb2qNgaDR_5rI0Uw_DS_NpjSV';

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/stream_bans?room_id=eq.${encodeURIComponent(roomId)}&select=id`,
      {
        headers: {
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`
        }
      }
    );
    const data = await r.json();
    return res.status(200).json({ banned: Array.isArray(data) && data.length > 0 });
  } catch(e) {
    // On error, don't falsely ban — return not banned
    return res.status(200).json({ banned: false });
  }
}
