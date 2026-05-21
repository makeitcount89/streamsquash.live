// In-memory co-host registry
// Each entry: { peerId, roomId, slots, viewerCount, lastSeen }
const cohosts = new Map(); // key: peerId
const COHOST_TTL_MS = 45000; // expire if no heartbeat in 45s
const MAX_VIEWERS_PER_COHOST = 9;

function pruneExpired() {
  const now = Date.now();
  for (const [id, ch] of cohosts) {
    if (now - ch.lastSeen > COHOST_TTL_MS) cohosts.delete(id);
  }
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  pruneExpired();

  // GET /api/cohosts?roomId=X — return available co-hosts for a room
  if (req.method === 'GET') {
    const { roomId } = req.query;
    if (!roomId) return res.status(400).json({ error: 'Missing roomId' });

    const available = [...cohosts.values()]
      .filter(ch => ch.roomId === roomId)
      .map(ch => ({
        peerId: ch.peerId,
        slotsAvailable: MAX_VIEWERS_PER_COHOST - ch.viewerCount
      }))
      .filter(ch => ch.slotsAvailable > 0)
      .sort((a, b) => b.slotsAvailable - a.slotsAvailable); // most available first

    return res.status(200).json(available);
  }

  // POST /api/cohosts — register or heartbeat
  // Body: { peerId, roomId, viewerCount }
  if (req.method === 'POST') {
    const { peerId, roomId, viewerCount } = req.body || {};
    if (!peerId || !roomId) return res.status(400).json({ error: 'Missing fields' });

    const existing = cohosts.get(peerId);
    cohosts.set(peerId, {
      peerId,
      roomId,
      viewerCount: typeof viewerCount === 'number' ? viewerCount : 0,
      registeredAt: existing ? existing.registeredAt : Date.now(),
      lastSeen: Date.now()
    });
    return res.status(200).json({ ok: true, maxViewers: MAX_VIEWERS_PER_COHOST });
  }

  // DELETE /api/cohosts?peerId=X — co-host leaving
  if (req.method === 'DELETE') {
    const { peerId } = req.query;
    if (peerId) cohosts.delete(peerId);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
