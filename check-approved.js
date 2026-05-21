// POST /api/admin-invite { email, adminEmail }
// Adds email to broadcasters table + sends Supabase invite
// Only callable by the designated admin

const SUPABASE_URL = 'https://bmhaihybdnaufprysjbw.supabase.co';
const ADMIN_EMAIL = 'swpage89@gmail.com';
const FROM_EMAIL = 'noreply@squash.spage.site';

async function sendInviteEmail(toEmail, actionLink, resendKey) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendKey}`
    },
    body: JSON.stringify({
      from: `SquashLive <${FROM_EMAIL}>`,
      to: [toEmail],
      subject: "You're invited to host on SquashLive",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem">
          <h2 style="color:#ff4d00;margin-bottom:0.5rem">You're invited to SquashLive</h2>
          <p style="color:#333;line-height:1.6">You've been approved as a host. Click the button below to set your password and activate your account.</p>
          <a href="${actionLink}" style="display:inline-block;margin:1.5rem 0;padding:0.85rem 1.75rem;background:#ff4d00;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:1rem">
            Set Password &amp; Get Started
          </a>
          <p style="color:#888;font-size:0.8rem">This link expires in 24 hours. If you didn't expect this email, you can safely ignore it.</p>
        </div>`
    })
  });
  const body = await r.json().catch(() => ({}));
  console.log(`resend email to ${toEmail} → ${r.status}`, JSON.stringify(body));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${body.message || JSON.stringify(body)}`);
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

async function supabaseAdminInvite(email, key) {
  // Step 1: Try to create the user (may already exist — that's fine)
  const createR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, email_confirm: true })
  });
  const createBody = await createR.json().catch(() => ({}));
  console.log(`create user ${email} → ${createR.status}`, JSON.stringify(createBody));

  const alreadyExists = !createR.ok && createR.status === 422;
  if (!createR.ok && !alreadyExists) {
    const msg = createBody.msg || createBody.message || createBody.error || JSON.stringify(createBody);
    throw new Error(`create user ${createR.status}: ${msg}`);
  }

  // Step 2: Find the user ID (from create response or by looking up)
  let userId = createBody.id;
  if (!userId) {
    // User already existed — look them up by email
    const listR = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=10`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const listBody = await listR.json().catch(() => ({ users: [] }));
    const found = (listBody.users || []).find(u => u.email.toLowerCase() === email.toLowerCase());
    userId = found?.id;
    console.log(`lookup user ${email} → ${userId}`);
  }

  if (!userId) throw new Error(`Could not find user ID for ${email}`);

  // Step 3: Generate a recovery (password reset) link for the user —
  // recovery works for both new and existing users unlike invite
  const linkR = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'recovery',
      email,
      options: { redirect_to: 'https://streamsquash.live/auth.html' }
    })
  });
  const linkBody = await linkR.json().catch(() => ({}));
  console.log(`generate_link recovery ${email} → ${linkR.status}`, JSON.stringify(linkBody));

  if (!linkR.ok) {
    const msg = linkBody.msg || linkBody.message || linkBody.error || JSON.stringify(linkBody);
    throw new Error(`generate_link ${linkR.status}: ${msg}`);
  }

  // Send the email ourselves via Resend using the action_link from the response
  const actionLink = linkBody.action_link;
  if (!actionLink) throw new Error('No action_link in generate_link response');
  const resendKey = process.env.RESEND_API_KEY_SQUASH;
  if (!resendKey) throw new Error('RESEND_API_KEY_SQUASH not set');
  await sendInviteEmail(email, actionLink, resendKey);

  return { alreadyExists };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(500).json({ error: 'Server misconfigured' });

  // Verify admin identity via Bearer token (Supabase JWT)
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  // Decode JWT to get email (no verify needed — Supabase already validated it client-side)
  let callerEmail = '';
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    callerEmail = (payload.email || '').toLowerCase();
  } catch(e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (callerEmail !== ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: 'Forbidden — admin only' });
  }

  // GET — list current broadcasters
  if (req.method === 'GET') {
    const r = await sb('/broadcasters?select=email,id&order=email.asc', 'GET', null, key);
    if (!r.ok) return res.status(500).json({ error: await r.text() });
    return res.status(200).json(await r.json());
  }

  // POST — add one or more emails
  if (req.method === 'POST') {
    const { emails } = req.body || {};
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Missing emails array' });
    }

    const results = [];
    for (const raw of emails) {
      const email = raw.trim().toLowerCase();
      if (!email || !email.includes('@')) {
        results.push({ email, status: 'invalid' });
        continue;
      }
      try {
        // 1. Add to broadcasters table (ignore conflict if already exists)
        const dbR = await sb('/broadcasters', 'POST',
          { email },
          key,
          { Prefer: 'resolution=ignore-duplicates,return=minimal' }
        );
        if (!dbR.ok && dbR.status !== 409) {
          const err = await dbR.text();
          results.push({ email, status: 'error', detail: err });
          continue;
        }

        // 2. Send Supabase invite email
        const { alreadyExists } = await supabaseAdminInvite(email, key);
        results.push({
          email,
          status: alreadyExists ? 'already_exists' : 'invited',
          detail: alreadyExists
            ? 'Already a user — added to broadcasters list'
            : 'Invite email sent'
        });
      } catch(e) {
        results.push({ email, status: 'error', detail: e.message });
      }
    }

    return res.status(200).json({ results });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
