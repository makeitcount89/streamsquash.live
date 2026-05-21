const SUPABASE_URL = 'https://bmhaihybdnaufprysjbw.supabase.co';
const ADMIN_EMAIL = 'swpage89@gmail.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    if ((p.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase())
      return res.status(403).json({ error: 'Forbidden' });
  } catch(e) { return res.status(401).json({ error: 'Unauthorised' }); }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(500).json({ error: 'Server misconfigured' });

  try {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // ── Live rooms (currently active) ──────────────────────────────────────────
    const cutoff = new Date(Date.now() - 70000).toISOString();
    const liveR = await fetch(
      `${SUPABASE_URL}/rest/v1/live_rooms?last_seen=gte.${cutoff}&select=id,current_viewers,peak_viewers,total_viewer_joins`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const liveRooms = liveR.ok ? await liveR.json() : [];
    const liveNow = liveRooms.reduce((s, r) => s + (r.current_viewers || 0), 0);
    const liveJoins = liveRooms.reduce((s, r) => s + (r.total_viewer_joins || 0), 0);

    // ── Past matches ────────────────────────────────────────────────────────────
    const matchR = await fetch(
      `${SUPABASE_URL}/rest/v1/past_matches?select=id,p1,p2,max_viewers,total_viewer_joins,completed_at&order=max_viewers.desc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const matches = matchR.ok ? await matchR.json() : [];

    // Total viewer joins = past matches + currently live rooms
    const pastTotal = matches.reduce((s, m) => s + (m.total_viewer_joins || m.max_viewers || 0), 0);
    const allTimeTotal = pastTotal + liveJoins;

    const todayTotal = matches
      .filter(m => new Date(m.completed_at) >= todayStart)
      .reduce((s, m) => s + (m.total_viewer_joins || m.max_viewers || 0), 0);
    const weekTotal = matches
      .filter(m => new Date(m.completed_at) >= weekStart)
      .reduce((s, m) => s + (m.total_viewer_joins || m.max_viewers || 0), 0);
    const monthTotal = matches
      .filter(m => new Date(m.completed_at) >= monthStart)
      .reduce((s, m) => s + (m.total_viewer_joins || m.max_viewers || 0), 0);

    // Add live room joins to today/week/month since they're happening now
    const todayFinal = todayTotal + liveJoins;
    const weekFinal = weekTotal + liveJoins;
    const monthFinal = monthTotal + liveJoins;

    // Top matches by total viewers
    const topMatches = matches
      .filter(m => (m.total_viewer_joins || m.max_viewers) > 0)
      .slice(0, 5)
      .map(m => ({ p1: m.p1, p2: m.p2, viewers: m.total_viewer_joins || m.max_viewers }));

    // ── Ad stats ────────────────────────────────────────────────────────────────
    const adR = await fetch(
      `${SUPABASE_URL}/rest/v1/ad_videos?select=name,partial_plays,full_plays&order=position.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const ads = adR.ok ? await adR.json() : [];

    return res.status(200).json({
      liveNow,
      today: todayFinal,
      week: weekFinal,
      month: monthFinal,
      total: allTimeTotal,
      totalMatches: matches.length,
      adBreakdown: ads,
      topMatches
    });
  } catch(e) {
    console.error('viewer-stats error:', e);
    return res.status(500).json({ error: e.message });
  }
}
