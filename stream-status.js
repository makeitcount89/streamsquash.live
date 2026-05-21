const SUPABASE_URL = 'https://bmhaihybdnaufprysjbw.supabase.co';
const ROOM_TTL_SECONDS = 10;

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  try {

    // ── GET ────────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      if (req.query.past === '1') {
        const r = await sb('/past_matches?winner_name=neq.Incomplete&order=completed_at.desc&limit=50', 'GET', null, key);
        if (!r.ok) return res.status(200).json([]);
        const rows = await r.json();
        return res.status(200).json(rows.map(m => ({
          id: m.id, p1: m.p1, p2: m.p2, bestOf: m.best_of,
          p1games: m.p1_games, p2games: m.p2_games,
          winner: m.winner, winnerName: m.winner_name,
          gameHistory: m.game_history || [],
          completedAt: new Date(m.completed_at).getTime()
        })));
      }

      const cutoff = new Date(Date.now() - ROOM_TTL_SECONDS * 1000).toISOString();
      const r = await sb(
        `/live_rooms?last_seen=gte.${cutoff}&select=id,p1,p2,best_of,score,started_at`,
        'GET', null, key
      );
      if (!r.ok) { const t = await r.text(); console.error('GET live_rooms:', r.status, t); return res.status(200).json([]); }
      const rows = await r.json();
      return res.status(200).json(rows.map(room => ({
        id: room.id, p1: room.p1, p2: room.p2,
        bestOf: room.best_of, score: room.score || null,
        startedAt: new Date(room.started_at).getTime()
      })));
    }

    // ── POST ───────────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { id, p1, p2, bestOf, score, completed, summary } = req.body || {};
      if (!id || !p1 || !p2) return res.status(400).json({ error: 'Missing fields' });

      if (completed && summary) {
        // Delete from live rooms
        await sb(`/live_rooms?id=eq.${encodeURIComponent(id)}`, 'DELETE', null, key);

        // Insert into past_matches — on conflict do nothing (idempotent)
        const r = await sb('/past_matches', 'POST', {
          id,
          p1: String(p1).substring(0, 30),
          p2: String(p2).substring(0, 30),
          best_of: bestOf || 5,
          p1_games: summary.p1games,
          p2_games: summary.p2games,
          winner: summary.winner || 0,
          winner_name: String(summary.winnerName || 'Incomplete').substring(0, 30),
          game_history: Array.isArray(summary.gameHistory) ? summary.gameHistory : [],
          max_viewers: summary.maxViewers || 0,
          total_viewer_joins: summary.totalViewerJoins || 0,
          completed_at: new Date().toISOString()
        }, key, { Prefer: 'resolution=ignore-duplicates,return=minimal' });

        if (!r.ok) {
          const err = await r.text();
          console.error('past_matches insert:', r.status, err);
          return res.status(200).json({ ok: true, warning: err });
        }
        return res.status(200).json({ ok: true, archived: true });
      }

      const { currentViewers, peakViewers, totalViewerJoins } = req.body || {};

      // Heartbeat / register — upsert into live_rooms
      const r = await sb('/live_rooms', 'POST', {
        id,
        p1: String(p1).substring(0, 30),
        p2: String(p2).substring(0, 30),
        best_of: bestOf || 5,
        score: score || null,
        current_viewers: currentViewers || 0,
        peak_viewers: peakViewers || 0,
        total_viewer_joins: totalViewerJoins || 0,
        last_seen: new Date().toISOString()
      }, key, { Prefer: 'resolution=merge-duplicates,return=minimal' });

      if (!r.ok) {
        const err = await r.text();
        console.error('live_rooms upsert:', r.status, err);
        return res.status(200).json({ ok: true, warning: err });
      }
      return res.status(200).json({ ok: true });
    }

    // ── DELETE ─────────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const id = req.query.id;

      // Admin deleting a past match
      if (req.query.past === '1' && id) {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        try {
          const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
          if ((payload.email || '').toLowerCase() !== 'swpage89@gmail.com')
            return res.status(403).json({ error: 'Forbidden' });
        } catch(e) { return res.status(401).json({ error: 'Unauthorised' }); }
        await sb(`/past_matches?id=eq.${encodeURIComponent(id)}`, 'DELETE', null, key);
        return res.status(200).json({ ok: true });
      }

      // Broadcaster ending stream
      if (id) await sb(`/live_rooms?id=eq.${encodeURIComponent(id)}`, 'DELETE', null, key);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch(e) {
    console.error('rooms handler error:', e);
    return res.status(500).json({ error: e.message });
  }
}