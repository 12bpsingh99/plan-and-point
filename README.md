# Plan & Point

A real-time planning-poker tool for scrum estimation sessions. One host creates a
room, sets the poll name and voting scale (Fibonacci, T-shirt sizes, confidence %,
or a custom list), and the team votes live. Cards flip face-up together when the
host reveals — no anchoring bias.

Built with **Node.js + Express + Socket.io** (backend) and plain HTML/CSS/JS
(frontend, no build step needed).

## Run it locally

Requires Node.js 18+.

```bash
cd plan-and-point
npm install
npm start
```

Open **http://localhost:3000** in a few browser tabs to try host + voter flows.

## How it works

- The server keeps rooms in memory (`Map`) — no database needed for a small team tool.
- Each browser tab is a Socket.io connection; the server pushes a `room-update`
  event to everyone in a room the instant something changes (vote cast, reveal,
  new round, kick). This is genuinely real-time — no polling.
- A room is identified by a 5-character code (e.g. `K7QXM`).
- If the host disconnects, the room closes automatically for everyone in it.
  If a voter disconnects, they're just removed from that room's roster.
- **Limitation to know about:** state lives in the server's memory only. If you
  deploy to a host that runs multiple instances/workers of your app (auto-scaling,
  multiple dynos), rooms won't be visible across instances, since each instance
  has its own memory. Deploy as a **single instance** unless you add a shared
  store like Redis — for a scrum team's use case, one instance is normal and fine.

## Deploying it online

You need a host that keeps a persistent Node.js process running and supports
WebSockets (this rules out plain serverless platforms like Vercel/Netlify
functions, which don't hold long-lived connections). Good, simple options:

### Option A — Render.com (recommended, has a free tier)
1. Push this folder to a GitHub repo.
2. On [render.com](https://render.com), click **New → Web Service**, connect the repo.
3. Build command: `npm install`   Start command: `npm start`
4. Instance count: **1** (see limitation above).
5. Deploy — Render gives you a public `https://your-app.onrender.com` URL.

### Option B — Railway.app
1. Push to GitHub, then on [railway.app](https://railway.app) choose
   **New Project → Deploy from GitHub repo**.
2. Railway auto-detects Node and runs `npm install && npm start`.
3. Add a public domain from the service's **Settings → Networking** tab.

### Option C — Fly.io
1. Install the `flyctl` CLI, run `fly launch` in this folder (accept the Node
   defaults), then `fly deploy`.
2. Fly is a good fit if you want the app to live close to your team's region.

Whichever you choose, once deployed, share the URL with your team — anyone who
opens it can host or join a room from the same page.

## Project structure

```
plan-and-point/
├── package.json
├── server.js          # Express + Socket.io backend, room logic
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js          # frontend UI + Socket.io client logic
└── README.md
```

## Possible next steps

- Swap the in-memory room store for Redis if you need multiple server instances.
- Add a "spectator" role that can watch without voting.
- Persist round history per room for retro notes.
- Add simple auth so only your team can create rooms.
