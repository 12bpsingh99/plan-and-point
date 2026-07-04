/* ============================= STATE ============================= */
const S = {
  view: 'landing',        // landing | hostSetup | hostDashboard | voterJoin | voterVote
  myId: null,             // set once socket connects
  myName: '',
  roomCode: '',
  isHost: false,
  room: null,             // last known room state from server
  loading: false,
  error: '',
  newRoundDraftOpen: false,
  _pollType: 'fibonacci',
  _customOpts: [],
};

const PRESETS = {
  fibonacci: { name: 'Fibonacci points', options: ['0','1','2','3','5','8','13','21','34','?','☕'] },
  tshirt:    { name: 'T-shirt sizes',   options: ['XS','S','M','L','XL','XXL','?'] },
  percent:   { name: 'Confidence %',    options: ['0%','25%','50%','75%','90%','100%'] },
  custom:    { name: 'Custom',          options: [] },
};

const socket = io();

socket.on('connect', () => { S.myId = socket.id; });

socket.on('room-update', (room) => {
  S.room = room;
  render();
});

socket.on('room-closed', () => {
  S.error = 'This room was closed by the host.';
  S.view = 'landing';
  S.room = null;
  S.roomCode = '';
  render();
});

socket.on('kicked', () => {
  S.error = 'You were removed from the room.';
  S.view = 'landing';
  S.room = null;
  S.roomCode = '';
  render();
});

/* ============================= HELPERS ============================= */

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function isNumericLabel(label){
  const t = label.trim();
  if(t.endsWith('%')) return /^\d+(\.\d+)?%$/.test(t);
  return /^\d+(\.\d+)?$/.test(t);
}
function numericValue(label){ return parseFloat(label.replace('%','')); }

function computeStats(room){
  const votes = room.votes || {};
  const labels = Object.values(votes);
  const counts = {};
  room.options.forEach(o => counts[o] = 0);
  labels.forEach(l => { counts[l] = (counts[l]||0) + 1; });

  const numericLabels = labels.filter(isNumericLabel);
  let avg = null;
  if(numericLabels.length){
    avg = numericLabels.reduce((a,l)=>a+numericValue(l),0) / numericLabels.length;
  }
  let mode = null, modeCount = 0;
  Object.entries(counts).forEach(([label,count])=>{
    if(count > modeCount){ mode = label; modeCount = count; }
  });
  const maxCount = Math.max(1, ...Object.values(counts));
  return { counts, avg, mode, modeCount, maxCount, totalVotes: labels.length };
}

/* ============================= ACTIONS ============================= */

function createRoom(pollName, pollType, options){
  S.loading = true; S.error=''; render();
  socket.emit('create-room', { hostName: S.myName, pollName, pollType, options }, (res) => {
    S.loading = false;
    if(!res.ok){ S.error = res.error || 'Could not create the room.'; render(); return; }
    S.roomCode = res.code;
    S.isHost = true;
    S.view = 'hostDashboard';
    render();
  });
}

function tryJoinRoom(code, name){
  S.loading = true; S.error=''; render();
  socket.emit('join-room', { roomCode: code, name }, (res) => {
    S.loading = false;
    if(!res.ok){ S.error = res.error || 'Could not join that room.'; render(); return; }
    S.roomCode = code.trim().toUpperCase();
    S.myName = name.trim() || 'Voter';
    S.isHost = false;
    S.view = 'voterVote';
    render();
  });
}

function submitVote(label){ socket.emit('submit-vote', { value: label }); }
function revealVotes(){ socket.emit('reveal'); }
function startNewRound(newPollName){
  S.newRoundDraftOpen = false;
  socket.emit('new-round', { pollName: newPollName });
}
function kickVoter(voterId){ socket.emit('kick', { voterId }); }
function endSession(){
  socket.emit('end-session');
  resetToLanding();
}
function leaveRoom(){
  socket.disconnect();
  socket.connect();
  resetToLanding();
}
function resetToLanding(){
  S.view = 'landing'; S.room = null; S.roomCode = ''; S.isHost = false; S.error = '';
  render();
}

/* ============================= VIEWS ============================= */

function viewLanding(){
  return `
    <div class="brand">
      <div class="brand-name">Plan &amp; <em>Point</em></div>
      <div class="brand-sub">Live estimation for scrum teams</div>
    </div>
    <div class="card-panel">
      <div class="hero-title">Deal the round.<br>Reveal together.</div>
      <p class="hero-desc">Set the story, pick your point scale, and watch the table fill up as your team lays down their cards — all at once, no anchoring.</p>
      <div class="choice-row">
        <button class="choice-card" data-action="go-host">
          <span class="suit">♦</span>
          <span class="title">Host a room</span>
          <span class="desc">Name the poll, choose the scale, run the round.</span>
        </button>
        <button class="choice-card" data-action="go-join">
          <span class="suit">♠</span>
          <span class="title">Join a room</span>
          <span class="desc">Got a room code from your host? Take a seat.</span>
        </button>
      </div>
      ${S.error ? `<div class="error-text">${escapeHtml(S.error)}</div>` : ''}
    </div>
    <footer class="tiny-note">Rooms live on the server while at least one person's connected — closing the host's tab ends the session for everyone.</footer>
  `;
}

function viewHostSetup(){
  const typeCards = Object.entries(PRESETS).map(([key, p]) => `
    <button class="type-opt ${S._pollType===key?'selected':''}" data-action="pick-type" data-type="${key}">
      <span class="t-name">${p.name}</span>
      <span class="t-vals">${key==='custom' ? 'define your own' : p.options.join('  ')}</span>
    </button>
  `).join('');
  const showCustomField = S._pollType === 'custom';

  return `
    <div class="brand">
      <div class="brand-name">Plan &amp; <em>Point</em></div>
      <div class="brand-sub">Set up your room</div>
    </div>
    <div class="card-panel">
      <label class="field-label" for="hostName">Your name (shown to voters)</label>
      <input class="field-full" id="hostName" placeholder="e.g. Priya" value="${escapeHtml(S.myName)}" />

      <label class="field-label" for="pollName">What are you sizing up?</label>
      <input class="field-full" id="pollName" placeholder="e.g. Story: OAuth login flow" />

      <label class="field-label">Voting scale</label>
      <div class="type-grid">${typeCards}</div>

      ${showCustomField ? `
        <label class="field-label" for="customOpts">Custom options, comma-separated</label>
        <input class="field-full" id="customOpts" placeholder="e.g. Small, Medium, Large, Not sure" value="${escapeHtml((S._customOpts||[]).join(', '))}" />
      ` : ''}

      ${S.error ? `<div class="error-text">${escapeHtml(S.error)}</div>` : ''}

      <div class="btn-row">
        <button class="btn-primary" data-action="submit-create" ${S.loading?'disabled':''}>${S.loading ? 'Creating room…' : 'Create room'}</button>
        <button class="btn-secondary" data-action="go-landing">Back</button>
      </div>
    </div>
  `;
}

function viewVoterJoin(){
  return `
    <div class="brand">
      <div class="brand-name">Plan &amp; <em>Point</em></div>
      <div class="brand-sub">Join a room</div>
    </div>
    <div class="card-panel">
      <label class="field-label" for="joinCode">Room code</label>
      <input class="field-full" id="joinCode" placeholder="e.g. K7QXM" style="text-transform:uppercase; letter-spacing:0.1em; font-family:var(--font-mono);" maxlength="8" />

      <label class="field-label" for="joinName">Your name</label>
      <input class="field-full" id="joinName" placeholder="e.g. Sam" />

      ${S.error ? `<div class="error-text">${escapeHtml(S.error)}</div>` : ''}

      <div class="btn-row">
        <button class="btn-primary" data-action="submit-join" ${S.loading?'disabled':''}>${S.loading ? 'Joining…' : 'Join room'}</button>
        <button class="btn-secondary" data-action="go-landing">Back</button>
      </div>
    </div>
  `;
}

function viewHostDashboard(){
  const room = S.room;
  if(!room) return `<div class="loading-note">Loading room…</div>`;
  const voterEntries = Object.entries(room.voters || {});
  const stats = computeStats(room);

  const seats = voterEntries.length ? voterEntries.map(([vid, v]) => {
    const voted = room.votes.hasOwnProperty(vid);
    const label = room.votes[vid];
    return `
      <div class="seat">
        <div class="flip-card ${room.revealed ? 'revealed' : ''}">
          <div class="flip-inner">
            <div class="flip-face flip-back"><div class="diamond"></div></div>
            <div class="flip-face flip-front ${!voted ? 'novote' : ''}">${voted ? escapeHtml(label) : '—'}</div>
          </div>
        </div>
        <div class="seat-name">${escapeHtml(v.name)}<button class="kick-x" title="Remove ${escapeHtml(v.name)}" data-action="kick" data-vid="${vid}">✕</button></div>
        <div class="seat-status ${voted?'':'pending'}">${voted ? 'voted' : 'thinking…'}</div>
      </div>
    `;
  }).join('') : `<div class="empty-table-note">Share the room code below — voters will appear here as they join.</div>`;

  let resultsHtml = '';
  if(room.revealed){
    const barsHtml = room.options.map(opt => {
      const count = stats.counts[opt] || 0;
      const pct = Math.round((count / stats.maxCount) * 100);
      return `
        <div class="bar-row">
          <div class="bar-label">${escapeHtml(opt)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${count?pct:0}%"></div></div>
          <div class="bar-count">${count || ''}</div>
        </div>
      `;
    }).join('');

    resultsHtml = `
      <div class="results-panel">
        <div class="results-stats">
          ${stats.avg !== null ? `<div class="stat"><div class="stat-val">${stats.avg.toFixed(1)}</div><div class="stat-label">average</div></div>` : ''}
          <div class="stat"><div class="stat-val">${stats.mode !== null ? escapeHtml(stats.mode) : '—'}</div><div class="stat-label">most picked</div></div>
          <div class="stat"><div class="stat-val">${stats.totalVotes}/${voterEntries.length}</div><div class="stat-label">voted</div></div>
        </div>
        ${barsHtml}
      </div>
    `;
  }

  const newRoundForm = S.newRoundDraftOpen ? `
    <div style="margin-top:14px;">
      <label class="field-label" for="newPollName">New poll name (leave blank to keep current)</label>
      <input class="field-full" id="newPollName" placeholder="${escapeHtml(room.pollName)}" />
      <div class="btn-row">
        <button class="btn-primary" data-action="confirm-new-round">Start round ${room.round+1}</button>
        <button class="btn-secondary" data-action="cancel-new-round">Cancel</button>
      </div>
    </div>
  ` : '';

  return `
    <div class="room-top">
      <div>
        <span class="room-code-tag">ROOM ${S.roomCode} <button class="link-inline-btn" data-action="copy-code">copy</button></span>
        <div class="poll-name">${escapeHtml(room.pollName)}</div>
      </div>
      <div class="round-tag">Round ${room.round} · ${PRESETS[room.pollType] ? PRESETS[room.pollType].name : 'Custom'}</div>
    </div>

    <div class="table-oval">${seats}</div>

    <div class="controls-row">
      <button class="btn-primary" data-action="reveal" ${room.revealed?'disabled':''}>${room.revealed ? 'Revealed' : 'Reveal cards'}</button>
      <button class="btn-secondary" data-action="open-new-round">New round</button>
      <button class="btn-danger" data-action="end-session">End session</button>
    </div>
    ${newRoundForm}
    ${resultsHtml}
    <footer class="tiny-note">Voters join at this same page with room code <strong>${S.roomCode}</strong>.</footer>
  `;
}

function viewVoterVote(){
  const room = S.room;
  if(!room) return `<div class="loading-note">Loading room…</div>`;
  const myVote = room.votes ? room.votes[S.myId] : undefined;
  const voterEntries = Object.entries(room.voters || {});
  const stats = computeStats(room);

  const optionButtons = room.options.map(opt => `
    <button class="opt-btn ${myVote===opt?'picked':''}" data-action="vote" data-value="${escapeHtml(opt)}" ${room.revealed?'disabled':''}>${escapeHtml(opt)}</button>
  `).join('');

  let resultsHtml = '';
  if(room.revealed){
    const barsHtml = room.options.map(opt => {
      const count = stats.counts[opt] || 0;
      const pct = Math.round((count / stats.maxCount) * 100);
      return `
        <div class="bar-row">
          <div class="bar-label">${escapeHtml(opt)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${count?pct:0}%"></div></div>
          <div class="bar-count">${count || ''}</div>
        </div>
      `;
    }).join('');
    resultsHtml = `
      <div class="results-panel">
        <div class="results-stats">
          ${stats.avg !== null ? `<div class="stat"><div class="stat-val">${stats.avg.toFixed(1)}</div><div class="stat-label">average</div></div>` : ''}
          <div class="stat"><div class="stat-val">${stats.mode !== null ? escapeHtml(stats.mode) : '—'}</div><div class="stat-label">most picked</div></div>
        </div>
        ${barsHtml}
      </div>
    `;
  }

  const chips = voterEntries.map(([vid,v]) => {
    const voted = room.votes && room.votes.hasOwnProperty(vid);
    return `<span class="chip ${voted?'voted':''}"><span class="dot"></span>${escapeHtml(v.name)}${vid===S.myId?' (you)':''}</span>`;
  }).join('');

  return `
    <div class="room-top">
      <div>
        <span class="room-code-tag">ROOM ${S.roomCode}</span>
        <div class="poll-name">${escapeHtml(room.pollName)}</div>
      </div>
      <div class="round-tag">Round ${room.round}</div>
    </div>

    <div class="card-panel">
      <label class="field-label">Pick your estimate</label>
      <div class="option-grid">${optionButtons}</div>
      ${myVote && !room.revealed ? `<div class="waiting-note">You picked ${escapeHtml(myVote)}. Waiting for the host to reveal…</div>` : ''}
      ${!myVote && !room.revealed ? `<div class="waiting-note">Tap a card above to lock in your estimate.</div>` : ''}
      ${resultsHtml}
      <div class="voter-list-mini">
        <div class="vlabel">At the table</div>
        <div class="chip-row">${chips}</div>
      </div>
      <div class="btn-row">
        <button class="btn-secondary" data-action="leave-room">Leave room</button>
      </div>
    </div>
  `;
}

/* ============================= MASTER RENDER ============================= */

function render(){
  const app = document.getElementById('app');
  switch(S.view){
    case 'hostSetup': app.innerHTML = viewHostSetup(); break;
    case 'hostDashboard': app.innerHTML = viewHostDashboard(); break;
    case 'voterJoin': app.innerHTML = viewVoterJoin(); break;
    case 'voterVote': app.innerHTML = viewVoterVote(); break;
    default: app.innerHTML = viewLanding(); break;
  }
}

/* ============================= EVENT DELEGATION ============================= */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if(!el) return;
  const action = el.dataset.action;

  if(action === 'go-host'){ S.view='hostSetup'; S.error=''; S._pollType='fibonacci'; render(); }
  else if(action === 'go-join'){ S.view='voterJoin'; S.error=''; render(); }
  else if(action === 'go-landing'){ resetToLanding(); }
  else if(action === 'pick-type'){ S._pollType = el.dataset.type; render(); }
  else if(action === 'submit-create'){
    const nameEl = document.getElementById('hostName');
    const pollEl = document.getElementById('pollName');
    S.myName = nameEl ? nameEl.value : '';
    const pollName = pollEl ? pollEl.value.trim() : '';
    if(!pollName){ S.error = "Give the poll a name so voters know what they're sizing."; render(); return; }
    let options;
    if(S._pollType === 'custom'){
      const customEl = document.getElementById('customOpts');
      options = (customEl ? customEl.value : '').split(',').map(s=>s.trim()).filter(Boolean);
      if(options.length < 2){ S.error = 'Add at least two custom options, separated by commas.'; render(); return; }
      S._customOpts = options;
    } else {
      options = PRESETS[S._pollType].options;
    }
    createRoom(pollName, S._pollType, options);
  }
  else if(action === 'submit-join'){
    const codeEl = document.getElementById('joinCode');
    const nameEl = document.getElementById('joinName');
    const code = codeEl ? codeEl.value : '';
    const name = nameEl ? nameEl.value : '';
    if(!code.trim()){ S.error = 'Enter the room code your host shared.'; render(); return; }
    if(!name.trim()){ S.error = "Tell us your name so the host can see who's voting."; render(); return; }
    tryJoinRoom(code, name);
  }
  else if(action === 'vote'){ submitVote(el.dataset.value); }
  else if(action === 'reveal'){ revealVotes(); }
  else if(action === 'open-new-round'){ S.newRoundDraftOpen = true; render(); }
  else if(action === 'cancel-new-round'){ S.newRoundDraftOpen = false; render(); }
  else if(action === 'confirm-new-round'){
    const el2 = document.getElementById('newPollName');
    startNewRound(el2 ? el2.value : '');
  }
  else if(action === 'kick'){ kickVoter(el.dataset.vid); }
  else if(action === 'end-session'){ endSession(); }
  else if(action === 'leave-room'){ leaveRoom(); }
  else if(action === 'copy-code'){
    navigator.clipboard.writeText(S.roomCode).then(() => {
      el.textContent = 'copied!';
      setTimeout(()=>{ el.textContent = 'copy'; }, 1500);
    }).catch(()=>{});
  }
});

render();
