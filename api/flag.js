// POST /api/flag  { roomId }
// Records a flag. On 2nd flag: bans stream, suspends broadcaster, emails admin.

const SUPABASE_URL = 'https://bmhaihybdnaufprysjbw.supabase.co';
const RESEND_API_KEY = process.env.RESEND_API_KEY_SQUASH;
const FROM_EMAIL = 'noreply@squash.spage.site';
const ADMIN_EMAIL = 'squash.highlights@gmail.com';

// Simple Supabase REST helper - no Prefer header that can cause RLS issues
async function sbGet(path, key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

async function sbPost(path, body, key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      // No Prefer: return=representation — avoids RLS return permission issues
    },
    body: JSON.stringify(body)
  });
  // 201 = created, 200 = ok, 409 = conflict (already exists) — all acceptable
  if (r.status !== 201 && r.status !== 200 && r.status !== 409) {
    throw new Error(`POST ${path} → ${r.status}: ${await r.text()}`);
  }
}

async function sbDelete(path, key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  // 204 = deleted, 200 = ok — both fine
  if (r.status !== 204 && r.status !== 200) {
    throw new Error(`DELETE ${path} → ${r.status}: ${await r.text()}`);
  }
}

// Ban a user in Supabase Auth by email — prevents them logging in at all
async function banAuthUser(email, serviceKey) {
  // 1. Find the user's auth ID by listing admin users filtered by email
  const r = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=10`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!r.ok) throw new Error(`admin/users list → ${r.status}: ${await r.text()}`);
  const body = await r.json();
  const users = body.users || [];
  const user = users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`No auth user found for email: ${email}`);

  // 2. Ban them — 876600h ≈ 100 years (effectively permanent)
  const banRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ban_duration: '876600h' })
  });
  if (!banRes.ok) throw new Error(`ban user → ${banRes.status}: ${await banRes.text()}`);
  return user.id;
}

async function sendBanEmail(roomId, matchName, broadcasterEmail, flagCount) {
  const knownEmail = !!broadcasterEmail;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `🚨 Stream Banned${knownEmail ? ' + Host Suspended' : ''}: ${matchName}`,
      html: `<div style="font-family:sans-serif;max-width:520px;color:#333">
        <h2 style="color:#ff4d00">Stream Automatically Banned</h2>
        <p>A live stream received ${flagCount} viewer flags and has been terminated.</p>
        <table style="width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:0.9rem">
          <tr style="background:#f9f9f9"><td style="padding:0.6rem;color:#888;width:150px">Room</td><td style="padding:0.6rem;font-family:monospace;font-weight:600">${roomId}</td></tr>
          <tr><td style="padding:0.6rem;color:#888">Match</td><td style="padding:0.6rem;font-weight:600">${matchName}</td></tr>
          <tr style="background:#f9f9f9"><td style="padding:0.6rem;color:#888">Flags</td><td style="padding:0.6rem;font-weight:600">${flagCount}</td></tr>
          <tr><td style="padding:0.6rem;color:#888">Banned at</td><td style="padding:0.6rem;font-weight:600">${new Date().toUTCString()}</td></tr>
          ${knownEmail
            ? `<tr style="background:#fff3f3"><td style="padding:0.6rem;color:#888">Host email</td><td style="padding:0.6rem;color:#c00;font-weight:600">${broadcasterEmail}</td></tr>
               <tr style="background:#fff3f3"><td style="padding:0.6rem;color:#888">Host status</td><td style="padding:0.6rem;color:#c00;font-weight:600">⛔ Permanently banned — removed from broadcasters table and Supabase auth account suspended</td></tr>`
            : `<tr><td style="padding:0.6rem;color:#888">Host email</td><td style="padding:0.6rem;color:#888;font-style:italic">Unknown</td></tr>`
          }
        </table>
        ${knownEmail ? `<div style="background:#fff3f3;border:1px solid #fcc;border-radius:6px;padding:1rem;margin-bottom:1rem">
          <strong style="color:#c00">To reinstate after review:</strong><br><br>
          <code style="background:#f5f5f5;padding:0.3rem 0.6rem;border-radius:4px">insert into broadcasters (email) values ('${broadcasterEmail}');</code>
        </div>` : ''}
        <p style="color:#999;font-size:0.8rem">Review flags in your <a href="https://supabase.com/dashboard" style="color:#ff4d00">Supabase dashboard</a> → flags table.</p>
      </div>`
    })
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { roomId } = req.body || {};
  if (!roomId) return res.status(400).json({ error: 'Missing roomId' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set in Vercel environment variables');
    return res.status(500).json({ error: 'Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY' });
  }

  try {
    // 1. Check if already banned — return early so viewers see the ban immediately
    const existing = await sbGet(
      `/stream_bans?room_id=eq.${encodeURIComponent(roomId)}&select=id`,
      serviceKey
    );
    if (existing.length > 0) {
      return res.status(200).json({ flagCount: 2, banned: true, alreadyBanned: true });
    }

    // 2. Insert this flag
    await sbPost('/flags', { room_id: roomId }, serviceKey);

    // ── FIRST FLAG: BAN IMMEDIATELY ─────────────────────────────────────────────
    const flagCount = 1;

    // 4. Look up broadcaster email from live_streams
    let broadcasterEmail = null;
    try {
      const streams = await sbGet(
        `/live_streams?room_id=eq.${encodeURIComponent(roomId)}&select=broadcaster_email`,
        serviceKey
      );
      if (streams.length > 0) broadcasterEmail = streams[0].broadcaster_email;
    } catch(e) {
      console.warn('Could not look up live_streams:', e.message);
    }

    // 5. Insert ban record — use try/catch in case of race condition
    try {
      await sbPost('/stream_bans', {
        room_id: roomId,
        flag_count: flagCount,
        ...(broadcasterEmail ? { broadcaster_email: broadcasterEmail } : {})
      }, serviceKey);
    } catch(e) {
      // 409 conflict = already inserted by concurrent request — not an error
      console.log('stream_bans insert:', e.message);
    }

    // 6. Remove broadcaster from approved list AND ban their auth account
    if (broadcasterEmail) {
      // Remove from broadcasters table
      try {
        await sbDelete(
          `/broadcasters?email=eq.${encodeURIComponent(broadcasterEmail)}`,
          serviceKey
        );
        console.log('Broadcaster removed from approved list:', broadcasterEmail);
      } catch(e) {
        console.error('Failed to remove broadcaster from list:', e.message);
      }

      // Ban their Supabase auth account — prevents login entirely
      try {
        const bannedUserId = await banAuthUser(broadcasterEmail, serviceKey);
        console.log('Auth user banned:', bannedUserId, broadcasterEmail);
      } catch(e) {
        console.error('Failed to ban auth user:', e.message);
      }
    }

    // 7. Parse match name for the email
    const m = roomId.match(/^SQLV-(.+)-VS-(.+)-[A-Z0-9]{4}$/);
    const matchName = m
      ? `${m[1].replace(/-/g,' ')} vs ${m[2].replace(/-/g,' ')}`
      : roomId;

    // 8. Email admin (non-fatal if this fails)
    try {
      await sendBanEmail(roomId, matchName, broadcasterEmail, flagCount);
    } catch(e) {
      console.error('Resend email failed:', e.message);
    }

    return res.status(200).json({ flagCount, banned: true });

  } catch(e) {
    console.error('Flag handler error:', e);
    return res.status(500).json({ error: e.message });
  }
}
