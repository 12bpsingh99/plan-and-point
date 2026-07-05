# Plan & Point (v1.2)

A real-time planning-poker tool for scrum estimation sessions. A host creates a
session and gets a shareable invite link; teammates open the link, enter their
name, and vote live. Cards flip face-up together when the host reveals.

Built with **Node.js + Express + Socket.io** (backend) and plain HTML/CSS/JS
(frontend, no build step).

## What's new in v1.2

- **Invite links** instead of manually shared room codes — visiting `/r/<sessionId>`
  only asks for your name (create/join code flow is still available from the
  landing page as a fallback).
- **Live participant states**: Waiting / Voted / Disconnected, updating without a refresh.
- **Reconnect grace period**: if someone's connection drops (or they refresh the
  page), they have 5 minutes to reconnect and keep their identity, name, and vote.
  After 5 minutes they're removed from the session.
- **Automatic host transfer**: if the host disconnects for more than 5 minutes,
  host controls pass to the earliest-joined remaining participant.
- **Story history**: the host starts a story, reveals it, then starts the next
  one without ending the session. Past stories appear in a timeline; click one
  to see its results again.
- **Results grouped by vote value** (e.g. "8 points — Bhanu, Rahul, Neha"),
  sorted by how many people picked each value, plus a separate "Didn't vote"
  list. Average/mode/highest/lowest stats have been removed.
- **Fibonacci scale** now includes ½, 55, and 89 alongside 0–34, ?, and ☕.
- **PDF and Excel export** (host-only) — a full record of the session:
  participants, every story, every vote, and non-voters.
- Refreshing the page no longer removes you from the session.

## Run it locally

Requires Node.js 18+.

```bash
cd plan-and-point
npm install
npm start
```

Open **http://localhost:3000** in a few browser tabs to try host + participant flows.

## How it works

- Sessions live in the server's memory (`Map`) — no database.
- Each browser gets a random `clientId` saved in `localStorage`, separate from
  the Socket.io connection ID. This is what makes refresh-without-losing-your-seat
  and reconnect-within-5-minutes possible — your identity survives even if your
  socket connection doesn't.
- The server pushes a `session-update` event to everyone in a session the
  instant something changes (vote cast, reveal, new story, join/leave). This is
  genuinely real-time — no polling.
- **Still a single-instance app.** If you deploy with multiple instances/workers,
  sessions won't be visible across instances, since each instance has its own
  memory. Keep it at 1 instance unless you add a shared store like Redis.

## Deploying it online

You need a host that keeps a persistent Node.js process running and supports
WebSockets. See the two write-ups below for step-by-step instructions:

- **Render.com** — easiest dashboard-based setup, has a $7/month always-on tier.
- **Fly.io** — free tier that doesn't sleep, but is CLI-based.

(Both were covered in detail in earlier conversation — ask again if you need
the full walkthrough repeated.)

## Updating your live site after making changes

Once you've already deployed, getting new changes live depends on where you deployed:

**If you're on Render:**
1. Re-upload the changed files to your GitHub repo (or use `git push` if you're
   using Git locally) — overwrite the old versions of `server.js`, `package.json`,
   and everything in `public/`.
2. Render automatically detects the change on your `main` branch and redeploys
   within a minute or two. Watch the **Logs** tab on your Render dashboard to
   confirm it finishes with "Plan & Point listening on port...".

**If you're on Fly.io:**
1. Save the changed files into your local project folder (same names/paths).
2. From that folder, run:
   ```bash
   flyctl deploy
   ```
3. Fly rebuilds and redeploys — no GitHub push required.

Either way, **existing live sessions will be dropped** the moment the server
restarts (remember, everything lives in memory) — so redeploy between sessions,
not mid-standup.

## Project structure

```
plan-and-point/
├── package.json
├── server.js          # Express + Socket.io backend, session & story logic, exports
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js          # frontend UI + Socket.io client logic
└── README.md
```

## Known limitations / possible next steps

- In-memory only — swap for Redis if you need multiple server instances or
  session persistence across restarts.
- Export authorization checks `clientId` in the URL, which is adequate for a
  small trusted team but not a substitute for real auth if you open this to
  the public internet.
- No "spectator" role yet — everyone who joins can vote.
- No automated load testing was run; it's built to comfortably handle a normal
  scrum team's size (a handful to a few dozen people).
