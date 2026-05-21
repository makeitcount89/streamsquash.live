// POST /api/check-approved  { email }
// Checks the `broadcasters` table in Supabase.
// Uses the anon key — broadcasters table has public SELECT RLS policy.

const SUPABASE_URL = 'https://bmhaihybdnaufprysjbw.supabase.co';
// Use service role if available, otherwise anon key (both work — see RLS note below)
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'sb_publishable_0QwuePBb2qNgaDR_5rI0Uw_DS_NpjSV';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const normalised = email.trim().toLowerCase();

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/broadcasters?email=eq.${encodeURIComponent(normalised)}&select=id`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    if (!r.ok) {
      const err = await r.text();
      console.error('Supabase error:', r.status, err);
      return res.status(500).json({ error: 'Database error: ' + err });
    }

    const data = await r.json();
    console.log('check-approved:', normalised, '→ rows:', data.length);
    return res.status(200).json({ approved: data.length > 0 });

  } catch(e) {
    console.error('check-approved fetch error:', e);
    return res.status(500).json({ error: e.message });
  }
}
