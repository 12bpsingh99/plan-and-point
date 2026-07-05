const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Serve the app shell for invite links so direct visits and refreshes work.
app.get('/r/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const FIBONACCI = ['0', '½', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', '☕'];
const DISCONNECT_GRACE_MS = 5 * 60 * 1000; // 5 minutes, per AC-8/AC-10/AC-11

/* ---------------------------------------------------------
   In-memory session store.
   sessions: Map<sessionId, {
     id, name, hostClientId, createdAt,
     participants: Map<clientId, { clientId, name, socketId, status, joinedAt, disconnectTimer }>,
     currentStory: null | { storyId, storyTitle, revealed, votes: {clientId:label}, startedAt },
     storyHistory: [ { storyId, storyTitle, votes: {name:label}, revealedAt } ]
   }>
   Single-instance, in-memory by design — see README for the trade-off.
--------------------------------------------------------- */
const sessions = new Map();

function randomSessionId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function makeSession(sessionName, hostClientId) {
  let id = randomSessionId();
  while (sessions.has(id)) id = randomSessionId();
  const session = {
    id,
    name: sessionName.trim(),
    hostClientId,
    createdAt: Date.now(),
    participants: new Map(),
    currentStory: null,
    storyHistory: [],
  };
  sessions.set(id, session);
  return session;
}

function addParticipant(session, clientId, name, socketId) {
  const p = { clientId, name: name.trim(), socketId, status: 'waiting', joinedAt: Date.now(), disconnectTimer: null };
  session.participants.set(clientId, p);
  return p;
}

function nameTaken(session, name, excludeClientId) {
  const lower = name.trim().toLowerCase();
  for (const [cid, p] of session.participants) {
    if (cid === excludeClientId) continue;
    if (p.name.toLowerCase() === lower) return true;
  }
  return false;
}

function publicSession(session) {
  const participants = [...session.participants.values()].map(p => ({
    clientId: p.clientId, name: p.name, status: p.status, joinedAt: p.joinedAt,
  }));
  const currentStory = session.currentStory ? {
    storyId: session.currentStory.storyId,
    storyTitle: session.currentStory.storyTitle,
    revealed: session.currentStory.revealed,
    votes: session.currentStory.votes,
    startedAt: session.currentStory.startedAt,
  } : null;
  return {
    id: session.id,
    name: session.name,
    hostClientId: session.hostClientId,
    participants,
    currentStory,
    storyHistory: session.storyHistory,
  };
}

function broadcast(session) {
  io.to(session.id).emit('session-update', publicSession(session));
}

function earliestConnected(session, excludeClientId) {
  let best = null;
  for (const [cid, p] of session.participants) {
    if (cid === excludeClientId) continue;
    if (p.status === 'disconnected') continue;
    if (!best || p.joinedAt < best.joinedAt) best = p;
  }
  return best;
}

function scheduleRemoval(session, clientId) {
  const p = session.participants.get(clientId);
  if (!p) return;
  if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
  p.disconnectTimer = setTimeout(() => {
    const current = session.participants.get(clientId);
    if (!current || current.status !== 'disconnected') return; // they reconnected in the meantime
    const wasHost = session.hostClientId === clientId;
    session.participants.delete(clientId);
    if (wasHost) {
      const successor = earliestConnected(session, clientId); // AC-11
      if (successor) session.hostClientId = successor.clientId;
    }
    if (session.participants.size === 0) { sessions.delete(session.id); return; }
    broadcast(session);
  }, DISCONNECT_GRACE_MS);
}

io.on('connection', (socket) => {

  socket.on('create-session', ({ sessionName, hostName, clientId }, cb) => {
    if (!sessionName || !sessionName.trim()) return cb({ ok: false, error: 'Session name is required.' });
    if (!hostName || !hostName.trim()) return cb({ ok: false, error: 'Your name is required.' });
    const cid = clientId || crypto.randomUUID();
    const session = makeSession(sessionName, cid);
    addParticipant(session, cid, hostName, socket.id);
    socket.join(session.id);
    socket.data.sessionId = session.id;
    socket.data.clientId = cid;
    cb({ ok: true, sessionId: session.id, clientId: cid });
    broadcast(session);
  });

  socket.on('join-session', ({ sessionId, name, clientId }, cb) => {
    const session = sessions.get((sessionId || '').trim());
    if (!session) return cb({ ok: false, error: 'This session link is invalid or has ended.' });
    if (!name || !name.trim()) return cb({ ok: false, error: 'Your name is required.' });
    const cid = clientId || crypto.randomUUID();
    if (nameTaken(session, name, cid)) return cb({ ok: false, error: 'That name is already taken in this session — try another.' });
    addParticipant(session, cid, name, socket.id);
    socket.join(session.id);
    socket.data.sessionId = session.id;
    socket.data.clientId = cid;
    cb({ ok: true, sessionId: session.id, clientId: cid });
    broadcast(session);
  });

  socket.on('rejoin-session', ({ sessionId, clientId }, cb) => {
    const session = sessions.get((sessionId || '').trim());
    if (!session) return cb({ ok: false, error: 'gone' });
    const p = session.participants.get(clientId);
    if (!p) return cb({ ok: false, error: 'gone' });
    if (p.disconnectTimer) { clearTimeout(p.disconnectTimer); p.disconnectTimer = null; } // AC-9
    p.socketId = socket.id;
    const hasVote = session.currentStory && session.currentStory.votes.hasOwnProperty(clientId);
    p.status = hasVote ? 'voted' : 'waiting';
    socket.join(session.id);
    socket.data.sessionId = session.id;
    socket.data.clientId = clientId;
    cb({ ok: true, name: p.name });
    broadcast(session);
  });

  socket.on('submit-vote', ({ value }) => {
    const { sessionId, clientId } = socket.data;
    const session = sessions.get(sessionId);
    if (!session || !session.currentStory || session.currentStory.revealed) return; // AC-19
    if (!FIBONACCI.includes(value)) return;
    const p = session.participants.get(clientId);
    if (!p) return;
    session.currentStory.votes[clientId] = value; // AC-17/AC-18
    p.status = 'voted';
    broadcast(session);
  });

  socket.on('start-story', ({ storyId, storyTitle }) => {
    const { sessionId, clientId } = socket.data;
    const session = sessions.get(sessionId);
    if (!session || session.hostClientId !== clientId) return; // AC-25
    if (session.currentStory && !session.currentStory.revealed) return;
    session.currentStory = {
      storyId: (storyId || '').trim() || `S${session.storyHistory.length + 1}`,
      storyTitle: (storyTitle || '').trim() || 'Untitled story',
      revealed: false,
      votes: {},
      startedAt: Date.now(),
    };
    for (const p of session.participants.values()) p.status = 'waiting';
    broadcast(session);
  });

  socket.on('reveal-votes', () => {
    const { sessionId, clientId } = socket.data;
    const session = sessions.get(sessionId);
    if (!session || session.hostClientId !== clientId || !session.currentStory) return; // AC-20
    session.currentStory.revealed = true;
    broadcast(session);
  });

  socket.on('next-story', ({ storyId, storyTitle }) => {
    const { sessionId, clientId } = socket.data;
    const session = sessions.get(sessionId);
    if (!session || session.hostClientId !== clientId) return;
    if (!session.currentStory || !session.currentStory.revealed) return;
    const cs = session.currentStory;
    const votesByName = {};
    for (const [cid, label] of Object.entries(cs.votes)) {
      const p = session.participants.get(cid);
      votesByName[p ? p.name : cid] = label;
    }
    session.storyHistory.push({ storyId: cs.storyId, storyTitle: cs.storyTitle, votes: votesByName, revealedAt: Date.now() }); // AC-13
    session.currentStory = {
      storyId: (storyId || '').trim() || `S${session.storyHistory.length + 1}`,
      storyTitle: (storyTitle || '').trim() || 'Untitled story',
      revealed: false,
      votes: {},
      startedAt: Date.now(),
    };
    for (const p of session.participants.values()) p.status = 'waiting';
    broadcast(session);
  });

  socket.on('end-session', () => {
    const { sessionId, clientId } = socket.data;
    const session = sessions.get(sessionId);
    if (!session || session.hostClientId !== clientId) return;
    io.to(sessionId).emit('session-closed');
    sessions.delete(sessionId);
  });

  socket.on('disconnect', () => {
    const { sessionId, clientId } = socket.data || {};
    if (!sessionId || !clientId) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    const p = session.participants.get(clientId);
    if (!p) return;
    p.status = 'disconnected'; // AC-8
    p.socketId = null;
    scheduleRemoval(session, clientId);
    broadcast(session);
  });
});

/* ---------------------------------------------------------
   Exports (AC-27 / AC-28). Host-only, checked via clientId query param.
   Note: this is a lightweight check suitable for a small team tool,
   not a full auth system.
--------------------------------------------------------- */

function requireHost(req, res) {
  const session = sessions.get(req.params.sessionId);
  if (!session) { res.status(404).send('Session not found.'); return null; }
  if (session.hostClientId !== req.query.clientId) { res.status(403).send('Only the host can export.'); return null; }
  return session;
}

function allStoriesFor(session) {
  const list = [...session.storyHistory];
  if (session.currentStory) {
    const votesByName = {};
    for (const [cid, label] of Object.entries(session.currentStory.votes)) {
      const p = session.participants.get(cid);
      votesByName[p ? p.name : cid] = label;
    }
    list.push({
      storyId: session.currentStory.storyId,
      storyTitle: session.currentStory.storyTitle + (session.currentStory.revealed ? '' : ' (in progress)'),
      votes: votesByName,
    });
  }
  return list;
}

app.get('/api/session/:sessionId/export/pdf', (req, res) => {
  const session = requireHost(req, res);
  if (!session) return;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${session.name.replace(/[^a-z0-9]+/gi, '-')}.pdf"`);

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);

  doc.fontSize(20).text(session.name, { underline: true });
  doc.fontSize(10).fillColor('#555').text(new Date().toLocaleString());
  doc.moveDown();

  doc.fontSize(13).fillColor('#000').text('Participants');
  [...session.participants.values()].forEach(p => doc.fontSize(10).text(`•  ${p.name}`));

  allStoriesFor(session).forEach(story => {
    doc.moveDown();
    doc.fontSize(13).fillColor('#000').text(`${story.storyId} — ${story.storyTitle}`);
    const votedNames = Object.keys(story.votes);
    Object.entries(story.votes).forEach(([name, label]) => doc.fontSize(10).fillColor('#333').text(`   ${name}: ${label}`));
    const nonVoters = [...session.participants.values()].map(p => p.name).filter(n => !votedNames.includes(n));
    if (nonVoters.length) doc.fontSize(10).fillColor('#999').text(`   Didn't vote: ${nonVoters.join(', ')}`);
  });

  doc.end();
});

app.get('/api/session/:sessionId/export/excel', async (req, res) => {
  const session = requireHost(req, res);
  if (!session) return;

  const wb = new ExcelJS.Workbook();
  const infoSheet = wb.addWorksheet('Session');
  infoSheet.addRow(['Session Name', session.name]);
  infoSheet.addRow(['Date', new Date().toLocaleString()]);
  infoSheet.addRow([]);
  infoSheet.addRow(['Participants']);
  [...session.participants.values()].forEach(p => infoSheet.addRow([p.name]));

  const storySheet = wb.addWorksheet('Stories & Votes');
  storySheet.addRow(['Story ID', 'Story Title', 'Participant', 'Vote']);
  allStoriesFor(session).forEach(story => {
    const votedNames = Object.keys(story.votes);
    Object.entries(story.votes).forEach(([name, label]) => storySheet.addRow([story.storyId, story.storyTitle, name, label]));
    const nonVoters = [...session.participants.values()].map(p => p.name).filter(n => !votedNames.includes(n));
    nonVoters.forEach(name => storySheet.addRow([story.storyId, story.storyTitle, name, "Didn't vote"]));
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${session.name.replace(/[^a-z0-9]+/gi, '-')}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Plan & Point listening on port ${PORT}`));
