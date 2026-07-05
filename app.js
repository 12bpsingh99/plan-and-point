/* ============================= STATE ============================= */
const FIBONACCI = ['0','½','1','2','3','5','8','13','21','34','55','89','?','☕'];

function getOrCreateClientId(){
  let id = localStorage.getItem('pp_client_id');
  if(!id){ id = crypto.randomUUID(); localStorage.setItem('pp_client_id', id); }
  return id;
}
function parseSessionIdFromPath(){
  const m = window.location.pathname.match(/^\/r\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}
function parseSessionIdFromInput(input){
  const t = (input||'').trim();
  const m = t.match(/\/r\/([a-z0-9]+)/i);
  if(m) return m[1];
  return t.replace(/[^a-z0-9]/gi,'');
}

const S = {
  clientId: getOrCreateClientId(),
  sessionId: parseSessionIdFromPath(),
  myName: '',
  view: 'landing',        // landing | createSession | joinSession | room
  session: null,
  error: '',
  info: '',
  loading: false,
  storyFormOpen: false,
  viewingHistoryIndex: null,
};

const socket = io();

socket.on('connect', () => {
  if(S.sessionId){ attemptRejoin(); }
});

socket.on('session-update', (session) => {
  S.session = session;
  if(S.view !== 'room') S.view = 'room';
  render();
});

socket.on('session-closed', () => {
  S.error = 'This session was ended by the host.';
  S.session = null;
  S.sessionId = null;
  S.view = 'landing';
  history.replaceState(null, '', '/');
  render();
});

/* ============================= HELPERS ============================= */

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function inviteLink(){ return `${window.location.origin}/r/${S.sessionId}`; }
function isHost(){ return !!(S.session && S.session.hostClientId === S.clientId); }

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
    S.sessionId = res.sessionId;
    S.myName = hostName;
    history.pushState(null, '', `/r/${res.sessionId}`);
    S.view = 'room';
    render();
  });
}

function joinSession(name){
  S.loading = true; S.error=''; render();
  socket.emit('join-session', { sessionId: S.sessionId, name, clientId: S.clientId }, (res) => {
    S.loading = false;
    if(!res.ok){ S.error = res.error; render(); return; }
    S.myName = name;
    S.view = 'room';
    render();
  });
}

function submitVote(value){ socket.emit('submit-vote', { value }); }
function revealVotes(){ socket.emit('reveal-votes'); }
function startStory(storyId, storyTitle){ S.storyFormOpen = false; socket.emit('start-story', { storyId, storyTitle }); }
function nextStory(storyId, storyTitle){ S.storyFormOpen = false; socket.emit('next-story', { storyId, storyTitle }); }
function endSession(){ socket.emit('end-session'); }

function leaveSession(){
  S.session = null; S.sessionId = null; S.view = 'landing'; S.error='';
  history.replaceState(null, '', '/');
  render();
}

function exportFile(kind){
  const url = `/api/session/${S.sessionId}/export/${kind}?clientId=${encodeURIComponent(S.clientId)}`;
  window.open(url, '_blank');
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
          <span class="title">Create a session</span>
          <span class="desc">Name it, get an invite link, run the rounds.</span>
        </button>
        <button class="choice-card" data-action="go-join-manual">
          <span class="suit">♠</span>
          <span class="title">Join a session</span>
          <span class="desc">Paste the invite link or code your host sent.</span>
        </button>
      </div>
      ${S.error ? `<div class="error-text">${escapeHtml(S.error)}</div>` : ''}
    </div>
    <footer class="tiny-note">Sessions live on the server while at least one person's connected. Disconnected participants have a 5-minute grace period before they're removed.</footer>
  `;
}

function viewCreateSession(){
  return `
    <div class="brand">
      <div class="brand-name">Plan &amp; <em>Point</em></div>
      <div class="brand-sub">Create a session</div>
    </div>
    <div class="card-panel">
      <label class="field-label" for="sessionName">Session name</label>
      <input class="field-full" id="sessionName" placeholder="e.g. Sprint 42 Planning" />

      <label class="field-label" for="hostName">Your name</label>
      <input class="field-full" id="hostName" placeholder="e.g. Priya" />

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
      <input class="field-full" id="linkOrCode" placeholder="https://.../r/ab12cd3  or  ab12cd3" />
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

function statusLabel(status){
  if(status==='voted') return 'Voted';
  if(status==='disconnected') return 'Disconnected';
  return 'Waiting';
}

function renderResultsBlock(namedVotes, participants){
  const groups = groupByValue(namedVotes);
  const nv = nonVoters(namedVotes, participants);
  const groupsHtml = groups.map(g => `
    <div class="vote-group">
      <div class="vote-group-value">${escapeHtml(g.value)}</div>
      <div class="vote-group-names">${g.names.map(n=>`<span class="chip voted"><span class="dot"></span>${escapeHtml(n)}</span>`).join('')}</div>
    </div>
  `).join('');
  const nvHtml = nv.length ? `
    <div class="vote-group novote-group">
      <div class="vote-group-value">Didn't vote</div>
      <div class="vote-group-names">${nv.map(n=>`<span class="chip"><span class="dot"></span>${escapeHtml(n)}</span>`).join('')}</div>
    </div>
  ` : '';
  return `<div class="results-panel">${groupsHtml || '<div class="empty-table-note">No votes yet.</div>'}${nvHtml}</div>`;
}

function viewRoom(){
  const session = S.session;
  if(!session) return `<div class="loading-note">Loading session…</div>`;
  const host = isHost();
  const participants = session.participants;
  const cs = session.currentStory;

  const participantListHtml = participants.length ? participants.map(p => `
    <div class="participant-row">
      <span class="p-name">${escapeHtml(p.name)}${p.clientId===session.hostClientId?' <span class="host-tag">HOST</span>':''}${p.clientId===S.clientId?' (you)':''}</span>
      <span class="p-status status-${p.status}">${statusLabel(p.status)}</span>
    </div>
  `).join('') : `<div class="empty-table-note">Waiting for people to join…</div>`;

  let storyAreaHtml = '';
  if(!cs){
    storyAreaHtml = host ? `
      <div class="card-panel">
        <label class="field-label">Start the first story</label>
        ${storyStartForm(1)}
      </div>
    ` : `<div class="card-panel"><div class="waiting-note">Waiting for the host to start a story…</div></div>`;
  } else if(!cs.revealed){
    const myVote = cs.votes[S.clientId];
    const optionButtons = FIBONACCI.map(opt => `
      <button class="opt-btn ${myVote===opt?'picked':''}" data-action="vote" data-value="${escapeHtml(opt)}">${escapeHtml(opt)}</button>
    `).join('');
    storyAreaHtml = `
      <div class="card-panel">
        <div class="poll-name">${escapeHtml(cs.storyTitle)} <span class="round-tag">${escapeHtml(cs.storyId)}</span></div>
        <label class="field-label">Pick your estimate</label>
        <div class="option-grid">${optionButtons}</div>
        ${myVote ? `<div class="waiting-note">You picked ${escapeHtml(myVote)}. You can change it until the host reveals.</div>` : `<div class="waiting-note">Tap a card to lock in your estimate.</div>`}
        ${host ? `<div class="btn-row"><button class="btn-primary" data-action="reveal">Reveal cards</button></div>` : ''}
      </div>
    `;
  } else {
    const named = namedVotesFromCurrent(session);
    storyAreaHtml = `
      <div class="card-panel">
        <div class="poll-name">${escapeHtml(cs.storyTitle)} <span class="round-tag">${escapeHtml(cs.storyId)}</span></div>
        ${renderResultsBlock(named, participants)}
        ${host ? `
          <div class="btn-row">
            <button class="btn-secondary" data-action="open-story-form">Start next story</button>
          </div>
          ${S.storyFormOpen ? storyStartForm(session.storyHistory.length+2, true) : ''}
        ` : ''}
      </div>
    `;
  }

  const historyHtml = session.storyHistory.length ? session.storyHistory.map((h, idx) => `
    <button class="history-item" data-action="view-history" data-idx="${idx}">
      <span class="hi-title">${escapeHtml(h.storyTitle)}</span>
      <span class="hi-id">${escapeHtml(h.storyId)}</span>
    </button>
  `).join('') : `<div class="empty-table-note">No completed stories yet.</div>`;

  let historyModal = '';
  if(S.viewingHistoryIndex !== null && session.storyHistory[S.viewingHistoryIndex]){
    const h = session.storyHistory[S.viewingHistoryIndex];
    historyModal = `
      <div class="card-panel" style="margin-top:14px;">
        <div class="poll-name">${escapeHtml(h.storyTitle)} <span class="round-tag">${escapeHtml(h.storyId)}</span></div>
        ${renderResultsBlock(h.votes, participants)}
        <div class="btn-row"><button class="btn-secondary" data-action="close-history">Close</button></div>
      </div>
    `;
  }

  return `
    <div class="room-top">
      <div>
        <div class="poll-name">${escapeHtml(session.name)}</div>
        ${host ? `
          <div style="margin-top:8px;">
            <span class="room-code-tag">${escapeHtml(inviteLink())} <button class="link-inline-btn" data-action="copy-link">copy</button></span>
          </div>
        ` : ''}
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
        ${storyAreaHtml}
        <div class="card-panel" style="margin-top:16px;">
          <label class="field-label">Story timeline</label>
          <div class="history-list">${historyHtml}</div>
          ${historyModal}
        </div>
      </div>
      <div class="card-panel side-panel">
        <label class="field-label">At the table (${participants.length})</label>
        <div class="participant-list">${participantListHtml}</div>
      </div>
    </div>
  `;
}

function storyStartForm(suggestedNum, isNext){
  return `
    <div style="margin-top:${isNext?'14px':'0'};">
      <label class="field-label" for="storyTitle">Story title</label>
      <input class="field-full" id="storyTitle" placeholder="e.g. Story: OAuth login flow" />
      <label class="field-label" for="storyIdField">Story ID (optional)</label>
      <input class="field-full" id="storyIdField" placeholder="e.g. S${suggestedNum}" />
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
  else if(action === 'confirm-start-story'){
    const title = document.getElementById('storyTitle').value;
    const id = document.getElementById('storyIdField').value;
    startStory(id, title);
  }
  else if(action === 'open-story-form'){ S.storyFormOpen = true; render(); }
  else if(action === 'cancel-story-form'){ S.storyFormOpen = false; render(); }
  else if(action === 'confirm-next-story'){
    const title = document.getElementById('storyTitle').value;
    const id = document.getElementById('storyIdField').value;
    nextStory(id, title);
  }
  else if(action === 'view-history'){ S.viewingHistoryIndex = parseInt(el.dataset.idx,10); render(); }
  else if(action === 'close-history'){ S.viewingHistoryIndex = null; render(); }
  else if(action === 'end-session'){ endSession(); }
  else if(action === 'leave-room'){ leaveSession(); }
  else if(action === 'export-pdf'){ exportFile('pdf'); }
  else if(action === 'export-excel'){ exportFile('excel'); }
  else if(action === 'copy-link'){
    navigator.clipboard.writeText(inviteLink()).then(()=>{
      el.textContent = 'copied!';
      setTimeout(()=>{ el.textContent = 'copy'; }, 1500);
    }).catch(()=>{});
  }
});

/* ============================= INIT ============================= */

if(S.sessionId){ S.view = 'joinSession'; } // will be upgraded to 'room' on rejoin if identity is recognized
render();
