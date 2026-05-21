# SquashLive 🎾

Free, no-account live streaming for squash matches with real-time score overlays.

## Features

- **Live streaming** via WebRTC (peer-to-peer, no server costs)
- **Real-time score overlay** — PAR scoring, best of 3 or 5
- **Camera or screen share** — your choice
- **One-link sharing** — viewers join with a room code
- **Viewer score HUD** — small, autohiding score box
- **No accounts, no sign-ups, completely free**

## Pages

| Page | Description |
|------|-------------|
| `index.html` | Landing page — host or join |
| `broadcast.html` | Set up and run your broadcast + control scores |
| `watch.html` | View a stream (use `?room=MATCH-XXXXXX`) |

## How It Works

1. **Host** opens `broadcast.html`, enters player names, picks camera/screen
2. Click **Go Live** → gets a room code like `MATCH-AB3XYZ`
3. Share the watch link (auto-generated) with viewers
4. **Viewers** open the link or enter the code on the home page
5. Score updates in the broadcaster's sidebar appear live on all viewer screens

## Tech Stack

- Pure HTML/CSS/JS — no build step, no framework
- [PeerJS](https://peerjs.com/) for WebRTC signalling (free public server)
- Google STUN servers for NAT traversal
- Deployed as static files on Vercel

## Deploy to GitHub + Vercel

```bash
# 1. Create a new GitHub repo and push these files
git init
git add .
git commit -m "Initial SquashLive"
git remote add origin https://github.com/YOUR_USERNAME/squashlive.git
git push -u origin main

# 2. Go to vercel.com → New Project → Import from GitHub
# 3. Select your repo — Vercel auto-detects static HTML
# 4. Deploy! Your site will be live at https://squashlive.vercel.app
```

No environment variables or build settings needed — Vercel deploys static HTML automatically.

## Limitations

- WebRTC works best on the same local network or with good internet
- For very high viewer counts (50+), consider a dedicated streaming CDN
- PeerJS free server may have occasional downtime — for production use, self-host a PeerJS server
- Screen sharing requires HTTPS (Vercel provides this automatically)

## Squash Scoring

- **Points**: Tap +/− to adjust the current game score
- **Game Won**: Click "P1/P2 Wins Game" to log the game and advance to the next
- **Reset**: Reset current game points without affecting the overall match
- PAR scoring to 11 (winning by 2), best of 3 or 5 games
