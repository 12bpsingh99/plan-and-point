/* ============================= STATE ============================= */
const FIBONACCI = ['0','½','1','2','3','5','8','13','21','34','55','89','?','☕'];
const PALETTE = ['#C9973F','#7A9B7E','#6E8FC6','#B5654A','#9B7AC6','#5FA8A0','#C68F6E','#4C8BF5'];

function getOrCreateClientId(){
  let id = localStorage.getItem('pp_client_id');
  if(!id){ id = crypto.randomUUID(); localStorage.setItem('pp_client_id', id); }
  return id;
}
function parseSessionIdFromPath(){
  const m = window.location.pathname.match(/^\/r\/([a-z0-9-]+)/i);
  return m ? m[1] : null;
}
function parseSessionIdFromInput(input){
  const t = (input||'').trim();
  const m = t.match(/\/r\/([a-z0-9-]+)/i);
  if(m) return m[1];
  return t.toLowerCase().replace(/[^a-z0-9-]/g,'');
}

const S = {
  clientId: getOrCreateClientId(),
  sessionId: parseSessionIdFromPath(),
  myName: '',
  view: 'landing',        // landing | createSession | joinSession | joinManual | room
  session: null,
  error: '',
  loading: false,
  storyFormOpen: false,
  viewingHistoryIndex: null,
};

const socket = io();

socket.on('connect', () => { if(S.sessionId){ attemptRejoin(); } });

socket.on('session-update', (session) => {
  S.session = session;
  if(S.view !== 'room') S.view = 'room';
  render();
});

socket.on('session-closed', () => {
  S.error = 'This session was ended by the host.';
  S.session = null; S.sessionId = null; S.view = 'landing';
  history.replaceState(null, '', '/');
  render();
});

// Tick every second while a story is live and unrevealed, to keep the timer moving.
setInterval(() => {
  if(S.view === 'room' && S.session && S.session.currentStory && !S.session.currentStory.revealed){
    render();
  }
}, 1000);

/* ============================= HELPERS ============================= */

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function inviteLink(){ return `${window.location.origin}/r/${S.sessionId}`; }
function isHost(){ return !!(S.session && S.session.hostClientId === S.clientId); }

function initials(name){
  return (name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]?w[0].toUpperCase():'').join('') || '?';
}
function avatarColor(name){
  let hash = 0;
  for(let i=0;i<(name||'').length;i++) hash = (hash*31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
function formatElapsed(ms){
  const total = Math.max(0, Math.floor(ms/1000));
  const h = Math.floor(total/3600), m = Math.floor((total%3600)/60), s = total%60;
  const pad = n => String(n).padStart(2,'0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function namedVotesFromCurrent(session){
  const out = {};
  if(!session.currentStory) return out;
  Object.entries(session.currentStory.votes).forEach(([cid, label]) => {
    const p = session.participants.find(pp => pp.clientId === cid);
    out[p ? p.name : cid] = label;
  });
  return out;
}
function groupByValue(namedVotes){
  const groups = {};
  Object.entries(namedVotes).forEach(([name,label]) => {
    if(!groups[label]) groups[label] = [];
    groups[label].push(name);
  });
  return Object.entries(groups).map(([value,names]) => ({value,names})).sort((a,b)=>b.names.length-a.names.length);
}
function nonVoters(namedVotes, participants){
  const voted = new Set(Object.keys(namedVotes));
  return participants.map(p=>p.name).filter(n => !voted.has(n));
}

/* ============================= ACTIONS ============================= */

function attemptRejoin(){
  socket.emit('rejoin-session', { sessionId: S.sessionId, clientId: S.clientId }, (res) => {
    if(res.ok){ S.myName = res.name; S.view = 'room'; render(); }
    else { S.view = 'joinSession'; render(); }
  });
}
function createSession(sessionName, hostName){
  S.loading = true; S.error=''; render();
  socket.emit('create-session', { sessionName, hostName, clientId: S.clientId }, (res) => {
    S.loading = false;
    if(!res.ok){ S.error = res.error; render(); return; }
    S.sessionId = res.sessionId; S.myName = hostName;
    history.pushState(null, '', `/r/${res.sessionId}`);
    S.view = 'room'; render();
  });
}
function joinSession(name){
  S.loading = true; S.error=''; render();
  socket.emit('join-session', { sessionId: S.sessionId, name, clientId: S.clientId }, (res) => {
    S.loading = false;
    if(!res.ok){ S.error = res.error; render(); return; }
    S.myName = name; S.view = 'room'; render();
  });
}
function submitVote(value){ socket.emit('submit-vote', { value }); }
function revealVotes(){ socket.emit('reveal-votes'); }
function resetTimer(){ socket.emit('reset-timer'); }
function clearVotes(){ socket.emit('clear-votes'); }
function skipStory(){ socket.emit('skip-story'); }
function startStory(storyId){ S.storyFormOpen = false; socket.emit('start-story', { storyId }); }
function nextStory(storyId){ S.storyFormOpen = false; socket.emit('next-story', { storyId }); }
function endSession(){ socket.emit('end-session'); }
function leaveSession(){
  S.session = null; S.sessionId = null; S.view = 'landing'; S.error='';
  history.replaceState(null, '', '/');
  render();
}
function exportFile(kind){
  window.open(`/api/session/${S.sessionId}/export/${kind}?clientId=${encodeURIComponent(S.clientId)}`, '_blank');
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
      <p class="hero-desc">Create a session, share the invite link, and watch the table fill up as your team lays down their cards — all at once, no anchoring.</p>
      <div class="choice-row">
        <button class="choice-card" data-action="go-create">
          <span class="suit">♦</span>
          <span class="title">Host a session</span>
          <span class="desc">Name it, get an invite link, run the rounds. You moderate — you don't vote.</span>
        </button>
        <button class="choice-card" data-action="go-join-manual">
          <span class="suit">♠</span>
          <span class="title">Join a session</span>
          <span class="desc">Paste the invite link or code your host sent.</span>
        </button>
      </div>
      ${S.error ? `<div class="error-text">${escapeHtml(S.error)}</div>` : ''}
    </div>
    <footer class="tiny-note">Sessions stay open as long as the host keeps it running. If your connection drops, just come back — you can rejoin anytime while the session is still active.</footer>
  `;
}

function viewCreateSession(){
  return `
    <div class="brand">
      <div class="brand-name">Plan &amp; <em>Point</em></div>
      <div class="brand-sub">Host a session</div>
    </div>
    <div class="card-panel">
      <label class="field-label" for="sessionName">Session name</label>
      <input class="field-full" id="sessionName" placeholder="e.g. Sprint 42 Planning" />
      <label class="field-label" for="hostName">Your name</label>
      <input class="field-full" id="hostName" placeholder="e.g. Priya" />
      <div class="hint-text">As host, you'll moderate the session and won't cast votes yourself.</div>
      ${S.error ? `<div class="error-text">${escapeHtml(S.error)}</div>` : ''}
      <div class="btn-row">
        <button class="btn-primary" data-action="submit-create" ${S.loading?'disabled':''}>${S.loading ? 'Creating…' : 'Create session'}</button>
        <button class="btn-secondary" data-action="go-landing">Back</button>
      </div>
    </div>
  `;
}

function viewJoinManual(){
  return `
    <div class="brand">
      <div class="brand-name">Plan &amp; <em>Point</em></div>
      <div class="brand-sub">Join a session</div>
    </div>
    <div class="card-panel">
      <label class="field-label" for="linkOrCode">Invite link or code</label>
      <input class="field-full" id="linkOrCode" placeholder="e.g. bdfkm" />
      ${S.error ? `<div class="error-text">${escapeHtml(S.error)}</div>` : ''}
      <div class="btn-row">
        <button class="btn-primary" data-action="submit-goto-join">Continue</button>
        <button class="btn-secondary" data-action="go-landing">Back</button>
      </div>
    </div>
  `;
}

function viewJoinSession(){
  return `
    <div class="brand">
      <div class="brand-name">Plan &amp; <em>Point</em></div>
      <div class="brand-sub">Join session</div>
    </div>
    <div class="card-panel">
      <label class="field-label" for="joinName">Your name</label>
      <input class="field-full" id="joinName" placeholder="e.g. Sam" />
      ${S.error ? `<div class="error-text">${escapeHtml(S.error)}</div>` : ''}
      <div class="btn-row">
        <button class="btn-primary" data-action="submit-join" ${S.loading?'disabled':''}>${S.loading ? 'Joining…' : 'Join session'}</button>
        <button class="btn-secondary" data-action="go-landing">Back</button>
      </div>
    </div>
  `;
}

function waitingBanner(cs, participants){
  if(!cs) return '';
  if(cs.revealed) return `<div class="status-banner done">Cards revealed</div>`;
  const votedCount = Object.keys(cs.votes).length;
  const remaining = participants.length - votedCount;
  if(participants.length > 0 && remaining <= 0) return `<div class="status-banner ready">All players voted</div>`;
  return `<div class="status-banner waiting">Waiting on ${remaining} player${remaining===1?'':'s'} to vote</div>`;
}

function renderDonutResults(groups, totalVotes){
  let cum = 0;
  const stops = groups.map((g,i) => {
    const pct = totalVotes ? (g.names.length/totalVotes*100) : 0;
    const start = cum; cum += pct;
    return `${PALETTE[i%PALETTE.length]} ${start}% ${cum}%`;
  }).join(', ');
  const legend = groups.map((g,i) => {
    const pct = totalVotes ? Math.round(g.names.length/totalVotes*100) : 0;
    return `
      <div class="legend-row">
        <span class="legend-dot" style="background:${PALETTE[i%PALETTE.length]}"></span>
        <span class="legend-value">${escapeHtml(g.value)}</span>
        <span class="legend-pct">${pct}%</span>
        <span class="legend-names">${g.names.map(escapeHtml).join(', ')}</span>
      </div>
    `;
  }).join('');
  return `
    <div class="donut-wrap">
      <div class="donut" style="background:conic-gradient(${stops || 'var(--ink-3) 0% 100%'})">
        <div class="donut-hole"><div class="donut-num">${totalVotes}</div><div class="donut-label">voted</div></div>
      </div>
      <div class="donut-legend">${legend || '<div class="empty-table-note">No votes yet.</div>'}</div>
    </div>
  `;
}

function renderResultsBlock(namedVotes, participants){
  const groups = groupByValue(namedVotes);
  const nv = nonVoters(namedVotes, participants);
  const totalVotes = Object.keys(namedVotes).length;
  const nvHtml = nv.length ? `
    <div class="vote-group novote-group">
      <div class="vote-group-value">Didn't vote</div>
      <div class="vote-group-names">${nv.map(n=>`<span class="chip"><span class="dot"></span>${escapeHtml(n)}</span>`).join('')}</div>
    </div>
  ` : '';
  return `<div class="results-panel">${renderDonutResults(groups, totalVotes)}${nvHtml}</div>`;
}

function pokerCard(opt, picked){
  return `
    <button class="opt-btn poker-card ${picked?'picked':''}" data-action="vote" data-value="${escapeHtml(opt)}">
      <span class="corner corner-tl">${escapeHtml(opt)}</span>
      <span class="card-main">${escapeHtml(opt)}</span>
      <span class="corner corner-br">${escapeHtml(opt)}</span>
    </button>
  `;
}

function playerRow(p, cs, isHostRow){
  const voted = cs && cs.votes.hasOwnProperty(p.clientId);
  let metaHtml;
  if(!cs){
    metaHtml = `<span class="player-dot ${p.status==='disconnected'?'off':''}"></span>`;
  } else if(cs.revealed){
    metaHtml = voted ? `<span class="player-vote">${escapeHtml(cs.votes[p.clientId])}</span>` : `<span class="player-novote">—</span>`;
  } else if(voted){
    metaHtml = `<span class="player-check">✓</span>`;
  } else if(p.status === 'disconnected'){
    metaHtml = `<span class="player-status-tag off">disconnected</span>`;
  } else {
    metaHtml = `<span class="player-status-tag">thinking…</span>`;
  }
  return `
    <div class="player-row">
      <span class="avatar" style="background:${avatarColor(p.name)}">${initials(p.name)}</span>
      <span class="player-name">${escapeHtml(p.name)}${p.clientId===S.clientId?' (you)':''}</span>
      <span class="player-meta">${metaHtml}</span>
    </div>
  `;
}

function viewRoom(){
  const session = S.session;
  if(!session) return `<div class="loading-note">Loading session…</div>`;
  const host = isHost();
  const participants = session.participants;
  const cs = session.currentStory;

  /* ---- main column: voting / results / timeline ---- */
  let mainHtml = '';
  if(!cs){
    mainHtml = host ? `
      <div class="card-panel">
        <label class="field-label">Start the first story</label>
        ${storyStartForm(1)}
      </div>
    ` : `<div class="card-panel"><div class="waiting-note">Waiting for the host to start a story…</div></div>`;
  } else if(!cs.revealed){
    if(host){
      const votedCount = Object.keys(cs.votes).length;
      mainHtml = `
        <div class="card-panel">
          <div class="poll-name">Story <span class="round-tag">${escapeHtml(cs.storyId)}</span></div>
          <div class="timer-line">⏱ ${formatElapsed(Date.now() - cs.startedAt)} elapsed · ${votedCount} of ${participants.length} voted</div>
          <div class="btn-row"><button class="btn-primary" data-action="reveal">Reveal cards</button></div>
        </div>
      `;
    } else {
      const myVote = cs.votes[S.clientId];
      mainHtml = `
        <div class="card-panel">
          <div class="poll-name">Story <span class="round-tag">${escapeHtml(cs.storyId)}</span></div>
          <label class="field-label">Pick your estimate</label>
          <div class="option-grid poker-grid">${FIBONACCI.map(o=>pokerCard(o, myVote===o)).join('')}</div>
          ${myVote ? `<div class="waiting-note">You picked ${escapeHtml(myVote)}. You can change it until the host reveals.</div>` : `<div class="waiting-note">Tap a card to lock in your estimate.</div>`}
        </div>
      `;
    }
  } else {
    const named = namedVotesFromCurrent(session);
    mainHtml = `
      <div class="card-panel">
        <div class="poll-name">Story <span class="round-tag">${escapeHtml(cs.storyId)}</span></div>
        ${renderResultsBlock(named, participants)}
        ${host ? `
          <div class="btn-row"><button class="btn-secondary" data-action="open-story-form">Start next story</button></div>
          ${S.storyFormOpen ? storyStartForm(session.storyHistory.length+2, true) : ''}
        ` : ''}
      </div>
    `;
  }

  const historyHtml = session.storyHistory.length ? session.storyHistory.map((h, idx) => `
    <button class="history-item" data-action="view-history" data-idx="${idx}"><span class="hi-id">Story ${escapeHtml(h.storyId)}</span></button>
  `).join('') : `<div class="empty-table-note">No completed stories yet.</div>`;

  let historyModal = '';
  if(S.viewingHistoryIndex !== null && session.storyHistory[S.viewingHistoryIndex]){
    const h = session.storyHistory[S.viewingHistoryIndex];
    historyModal = `
      <div class="card-panel" style="margin-top:14px;">
        <div class="poll-name">Story <span class="round-tag">${escapeHtml(h.storyId)}</span></div>
        ${renderResultsBlock(h.votes, participants)}
        <div class="btn-row"><button class="btn-secondary" data-action="close-history">Close</button></div>
      </div>
    `;
  }

  /* ---- sidebar: banner, players, host controls, invite ---- */
  const playersHtml = participants.length
    ? participants.map(p => playerRow(p, cs, host)).join('')
    : `<div class="empty-table-note">Waiting for people to join…</div>`;

  const hostActionsHtml = host ? `
    <div class="side-actions">
      <button class="btn-secondary sm" data-action="reset-timer" ${!cs||cs.revealed?'disabled':''}>Reset timer</button>
      <button class="btn-secondary sm" data-action="clear-votes" ${!cs?'disabled':''}>Clear votes</button>
      <button class="btn-secondary sm" data-action="skip-story" ${!cs?'disabled':''}>Skip story</button>
    </div>
  ` : '';

  const inviteHtml = host ? `
    <div class="invite-box">
      <label class="field-label">Invite a team mate</label>
      <div class="invite-row">
        <input class="field-full" readonly value="${escapeHtml(inviteLink())}" onclick="this.select()" />
        <button class="btn-secondary sm" data-action="copy-link">Copy</button>
      </div>
    </div>
  ` : '';

  return `
    <div class="room-top">
      <div>
        <div class="poll-name">${escapeHtml(session.name)}</div>
        <div class="hint-text" style="margin-top:4px;">Hosted by ${escapeHtml(session.hostName)}${!session.hostConnected ? ' <span style="color:#C97D64;">(reconnecting…)</span>' : ''}</div>
      </div>
      <div class="btn-row" style="margin-top:0;">
        ${host ? `
          <button class="btn-secondary" data-action="export-pdf">Export PDF</button>
          <button class="btn-secondary" data-action="export-excel">Export Excel</button>
          <button class="btn-danger" data-action="end-session">End session</button>
        ` : `<button class="btn-secondary" data-action="leave-room">Leave</button>`}
      </div>
    </div>

    <div class="two-col">
      <div>
        ${mainHtml}
        <div class="card-panel" style="margin-top:16px;">
          <label class="field-label">Story timeline</label>
          <div class="history-list">${historyHtml}</div>
          ${historyModal}
        </div>
      </div>
      <div class="card-panel side-panel">
        ${waitingBanner(cs, participants)}
        <label class="field-label" style="margin-top:${cs?'16px':'0'};">At the table (${participants.length})</label>
        <div class="participant-list">${playersHtml}</div>
        ${hostActionsHtml}
        ${inviteHtml}
      </div>
    </div>
  `;
}

function storyStartForm(suggestedNum, isNext){
  return `
    <div style="margin-top:${isNext?'14px':'0'};">
      <label class="field-label" for="storyIdField">Story ID</label>
      <input class="field-full" id="storyIdField" placeholder="e.g. JIRA-${suggestedNum}" />
      <div class="btn-row">
        <button class="btn-primary" data-action="${isNext?'confirm-next-story':'confirm-start-story'}">${isNext?'Start next round':'Start voting'}</button>
        ${isNext ? `<button class="btn-secondary" data-action="cancel-story-form">Cancel</button>` : ''}
      </div>
    </div>
  `;
}

/* ============================= MASTER RENDER ============================= */

function render(){
  const app = document.getElementById('app');
  switch(S.view){
    case 'createSession': app.innerHTML = viewCreateSession(); break;
    case 'joinSession': app.innerHTML = viewJoinSession(); break;
    case 'joinManual': app.innerHTML = viewJoinManual(); break;
    case 'room': app.innerHTML = viewRoom(); break;
    default: app.innerHTML = viewLanding(); break;
  }
}

/* ============================= EVENT DELEGATION ============================= */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if(!el) return;
  const action = el.dataset.action;

  if(action === 'go-create'){ S.view='createSession'; S.error=''; render(); }
  else if(action === 'go-join-manual'){ S.view='joinManual'; S.error=''; render(); }
  else if(action === 'go-landing'){ S.view='landing'; S.error=''; render(); }
  else if(action === 'submit-create'){
    const n = document.getElementById('sessionName').value.trim();
    const h = document.getElementById('hostName').value.trim();
    if(!n){ S.error='Give the session a name.'; render(); return; }
    if(!h){ S.error='Enter your name.'; render(); return; }
    createSession(n, h);
  }
  else if(action === 'submit-goto-join'){
    const raw = document.getElementById('linkOrCode').value;
    const id = parseSessionIdFromInput(raw);
    if(!id){ S.error='Enter a valid invite link or code.'; render(); return; }
    S.sessionId = id;
    history.pushState(null, '', `/r/${id}`);
    S.view = 'joinSession'; S.error='';
    render();
  }
  else if(action === 'submit-join'){
    const n = document.getElementById('joinName').value.trim();
    if(!n){ S.error='Enter your name.'; render(); return; }
    joinSession(n);
  }
  else if(action === 'vote'){ submitVote(el.dataset.value); }
  else if(action === 'reveal'){ revealVotes(); }
  else if(action === 'reset-timer'){ resetTimer(); }
  else if(action === 'clear-votes'){ clearVotes(); }
  else if(action === 'skip-story'){ skipStory(); }
  else if(action === 'confirm-start-story'){
    const id = document.getElementById('storyIdField').value.trim();
    if(!id){ S.error='Enter a Story ID.'; render(); return; }
    startStory(id);
  }
  else if(action === 'open-story-form'){ S.storyFormOpen = true; render(); }
  else if(action === 'cancel-story-form'){ S.storyFormOpen = false; render(); }
  else if(action === 'confirm-next-story'){
    const id = document.getElementById('storyIdField').value.trim();
    if(!id){ S.error='Enter a Story ID.'; render(); return; }
    nextStory(id);
  }
  else if(action === 'view-history'){ S.viewingHistoryIndex = parseInt(el.dataset.idx,10); render(); }
  else if(action === 'close-history'){ S.viewingHistoryIndex = null; render(); }
  else if(action === 'end-session'){ endSession(); }
  else if(action === 'leave-room'){ leaveSession(); }
  else if(action === 'export-pdf'){ exportFile('pdf'); }
  else if(action === 'export-excel'){ exportFile('excel'); }
  else if(action === 'copy-link'){
    navigator.clipboard.writeText(inviteLink()).then(()=>{
      el.textContent = 'Copied!';
      setTimeout(()=>{ el.textContent = 'Copy'; }, 1500);
    }).catch(()=>{});
  }
});

/* ============================= INIT ============================= */

if(S.sessionId){ S.view = 'joinSession'; }
render();
