const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

/* ---------------------------------------------------------
   In-memory room store.
   rooms: Map<roomCode, {
     hostId, hostName, pollName, pollType, options,
     round, revealed, voters: {socketId:{name}}, votes: {socketId:label}
   }>
   NOTE: This is in-memory only. If you deploy with more than one
   server instance/worker, rooms won't be shared across instances.
   For a small team tool this single-instance model is intentional
   and keeps things simple and free to run.
--------------------------------------------------------- */
const rooms = new Map();

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function publicRoom(room) {
  return {
    pollName: room.pollName,
    pollType: room.pollType,
    options: room.options,
    round: room.round,
    revealed: room.revealed,
    voters: room.voters,
    votes: room.votes,
    hostName: room.hostName,
  };
}

function broadcast(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit('room-update', publicRoom(room));
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ hostName, pollName, pollType, options }, cb) => {
    if (!pollName || !Array.isArray(options) || options.length < 2) {
      cb({ ok: false, error: 'Poll name and at least two options are required.' });
      return;
    }
    let code = randomCode();
    let tries = 0;
    while (rooms.has(code) && tries < 10) { code = randomCode(); tries++; }

    const room = {
      hostId: socket.id,
      hostName: (hostName || 'Host').trim(),
      pollName: pollName.trim(),
      pollType,
      options,
      round: 1,
      revealed: false,
      voters: {},
      votes: {},
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.isHost = true;
    cb({ ok: true, code, you: socket.id });
    broadcast(code);
  });

  socket.on('join-room', ({ roomCode, name }, cb) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) { cb({ ok: false, error: 'No room found with that code.' }); return; }
    room.voters[socket.id] = { name: (name || 'Voter').trim() || 'Voter' };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.isHost = false;
    cb({ ok: true, you: socket.id });
    broadcast(code);
  });

  socket.on('submit-vote', ({ value }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.revealed) return;
    if (!room.options.includes(value)) return;
    room.votes[socket.id] = value;
    broadcast(code);
  });

  socket.on('reveal', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    room.revealed = true;
    broadcast(code);
  });

  socket.on('new-round', ({ pollName }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    if (pollName && pollName.trim()) room.pollName = pollName.trim();
    room.round += 1;
    room.revealed = false;
    room.votes = {};
    broadcast(code);
  });

  socket.on('kick', ({ voterId }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    delete room.voters[voterId];
    delete room.votes[voterId];
    const target = io.sockets.sockets.get(voterId);
    if (target) target.emit('kicked');
    broadcast(code);
  });

  socket.on('end-session', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    io.to(code).emit('room-closed');
    rooms.delete(code);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (socket.id === room.hostId) {
      io.to(code).emit('room-closed');
      rooms.delete(code);
    } else {
      delete room.voters[socket.id];
      delete room.votes[socket.id];
      broadcast(code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Plan & Point listening on port ${PORT}`));
