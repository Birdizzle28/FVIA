// scripts/messages.js
const supabase = window.supabaseClient;

// ---------- DOM ----------
const hubToggle = document.getElementById('agent-hub-toggle');
const hubMenu   = document.getElementById('agent-hub-menu');

const roomsPanel   = document.getElementById('rooms-panel');
const toggleRooms  = document.getElementById('toggle-rooms');

const roomsList    = document.getElementById('rooms-list');
const peopleList   = document.getElementById('people-list');
const roomSearch   = document.getElementById('room-search');

const newRoomBtn   = document.getElementById('new-room-btn');
const scroller     = document.getElementById('messages-scroller');
const composer     = document.getElementById('composer');
const input        = document.getElementById('composer-input');
const roomNameEl   = document.getElementById('active-room-name');
const memberCount  = document.getElementById('member-count');

let me = null;
let myProfile = null;
let activeRoom = null;   // { id, name, is_dm, member_ids: [] }
let unsubscribe = null;  // realtime channel cleanup

// ---------- Session gate & header menu ----------
document.addEventListener('DOMContentLoaded', async () => {
  // Toggle dropdown (same UX as other pages)
  hubMenu.style.display = "none";
  hubToggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    hubMenu.style.display = hubMenu.style.display === "block" ? "none" : "block";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) hubMenu.style.display = "none";
  });

  // Require login
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  me = session.user;

  // Fetch my profile; hide admin link if not admin
  const { data: profile } = await supabase.from('agents').select('*').eq('id', me.id).single();
  myProfile = profile || {};
  if (!profile?.is_admin) {
    const adminLink = document.querySelector('.admin-only');
    if (adminLink) adminLink.style.display = 'none';
  }

  // Load initial lists and open default room
  await loadRoomsAndDMs();
  // Prefer a default “All Agents” room if exists, else first room or first DM
  const allAgents = _rooms.find(r => !r.is_dm && /all agents/i.test(r.name));
  if (allAgents) selectRoom(allAgents);
  else if (_rooms.length) selectRoom(_rooms[0]);
  else if (_peopleDMs.length) startDM(_peopleDMs[0].id); // fallback

  // Handlers
  toggleRooms?.addEventListener('click', () => roomsPanel.classList.toggle('open'));
  newRoomBtn?.addEventListener('click', promptNewGroup);
  roomSearch?.addEventListener('input', filterLists);
  composer?.addEventListener('submit', sendMessage);

  // Auto-grow textarea
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  });
});

// ---------- Data loading ----------
let _rooms = [];     // group rooms
let _people = [];    // all agents (for DM list)
let _peopleDMs = []; // dm candidates (exclude me)

async function loadRoomsAndDMs(){
  // Load rooms I belong to
  const { data: rooms } = await supabase
    .from('chat_rooms')
    .select('id,name,is_dm,chat_members!inner(agent_id)')
    .eq('chat_members.agent_id', me.id)
    .order('name', { ascending: true });

  _rooms = (rooms || []).map(r => ({
    id: r.id,
    name: r.name,
    is_dm: r.is_dm,
    // members will be fetched on select, we just need list presence here
  }));

  renderRoomsList();

  // Load agents for DM list (active only)
  const { data: agents } = await supabase
    .from('agents')
    .select('id, full_name, profile_picture_url, is_active')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  _people = (agents || []).filter(a => a.id !== me.id);
  _peopleDMs = _people.map(a => ({ id: a.id, name: a.full_name, avatar: a.profile_picture_url || '' }));
  renderPeopleList();
}

function renderRoomsList(list = _rooms) {
  roomsList.innerHTML = '';
  list.forEach(r => {
    const li = document.createElement('li');
    li.className = 'room-item';
    li.innerHTML = `
      <div class="room-main">
        <div class="room-name"># ${r.name}</div>
        <div class="room-last" data-last="${r.id}"></div>
      </div>
      <span class="badge" data-unread="${r.id}" style="display:none;">0</span>
    `;
    li.addEventListener('click', () => selectRoom(r));
    roomsList.appendChild(li);
  });
}

function renderPeopleList(list = _peopleDMs){
  peopleList.innerHTML = '';
  list.forEach(p => {
    const li = document.createElement('li');
    li.className = 'room-item';
    li.innerHTML = `
      <img src="${p.avatar || '../Pics/placeholder-user.png'}" class="avatar" alt="" />
      <div class="room-main">
        <div class="room-name">${p.name}</div>
        <div class="room-last" data-last="dm:${p.id}"></div>
      </div>
    `;
    li.addEventListener('click', () => startDM(p.id));
    peopleList.appendChild(li);
  });
}

function filterLists(){
  const q = (roomSearch.value || '').toLowerCase();
  const r = _rooms.filter(x => x.name.toLowerCase().includes(q));
  const p = _peopleDMs.filter(x => x.name.toLowerCase().includes(q));
  renderRoomsList(r);
  renderPeopleList(p);
}

// ---------- Room & DM selection ----------
async function selectRoom(room){
  if (!room) return;
  // Close realtime from previous room
  if (unsubscribe) { try { await unsubscribe.unsubscribe(); } catch {} unsubscribe = null; }

  activeRoom = room;
  roomNameEl.textContent = room.is_dm ? 'Direct Message' : room.name;
  input.placeholder = room.is_dm ? 'Message (DM)…' : `Message #${room.name}…`;

  // Fetch members & last seen
  const { data: members } = await supabase
    .from('chat_members')
    .select('agent_id, agents!inner(full_name, profile_picture_url)')
    .eq('room_id', room.id);

  const count = (members || []).length;
  memberCount.textContent = room.is_dm ? '' : `${count} member${count === 1 ? '' : 's'}`;

  // Load last 100 messages
  scroller.innerHTML = '';
  const { data: messages } = await supabase
    .from('chat_messages')
    .select('id, room_id, sender_id, body, created_at, agents!sender_id(full_name, profile_picture_url)')
    .eq('room_id', room.id)
    .order('created_at', { ascending: true })
    .limit(100);

  (messages || []).forEach(renderMessage);
  scroller.scrollTop = scroller.scrollHeight;

  // Subscribe to new messages in this room
  unsubscribe = supabase
    .channel(`room:${room.id}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${room.id}` },
      payload => {
        renderMessage(payload.new, true);
        scroller.scrollTop = scroller.scrollHeight;
      }
    )
    .subscribe();
}

async function startDM(otherAgentId){
  // Create or find a 1:1 room with me + other agent
  const { data: existing } = await supabase
    .rpc('ensure_dm_room', { a: me.id, b: otherAgentId }); // see RPC below
  // existing returns { room_id, name }
  const room = { id: existing.room_id, name: existing.name, is_dm: true };
  await selectRoom(room);
}

// ---------- Send ----------
async function sendMessage(e){
  e.preventDefault();
  const text = (input.value || '').trim();
  if (!text || !activeRoom) return;

  input.value = '';
  input.style.height = '42px';

  await supabase.from('chat_messages').insert({
    room_id: activeRoom.id,
    sender_id: me.id,
    body: text
  });
}

// ---------- Render ----------
function renderMessage(m){
  // m may be joined row or payload.new; normalize
  const mine = m.sender_id === me.id;
  const name = m.agents?.full_name || (m.sender_name ?? '');
  const avatar = m.agents?.profile_picture_url || '../Pics/placeholder-user.png';
  const when = new Date(m.created_at).toLocaleString();

  const wrap = document.createElement('div');
  wrap.className = `msg ${mine ? 'mine' : ''}`;
  wrap.innerHTML = `
    ${mine ? '' : `<img class="avatar" src="${avatar}" alt="" />`}
    <div class="bubble">
      <div class="meta">${name || (mine ? 'You' : '')} • ${when}</div>
      <div class="text">${escapeHtml(m.body || '')}</div>
    </div>
    ${mine ? `<img class="avatar" src="${avatar}" alt="" style="visibility:hidden;" />` : '' }
  `;
  scroller.appendChild(wrap);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

// ---------- New group ----------
async function promptNewGroup(){
  const name = prompt('New group name:');
  if (!name) return;
  // Create room
  const { data: room, error } = await supabase
    .from('chat_rooms')
    .insert({ name, is_dm:false, created_by: me.id })
    .select('*').single();
  if (error) return alert('Failed to create room.');
  // Add creator as member
  await supabase.from('chat_members').insert({ room_id: room.id, agent_id: me.id });
  // Optional: ask to add others (by quick name search)
  alert('Group created! Open the group to add members from the “Add members” command later.');
  // Refresh & select
  await loadRoomsAndDMs();
  selectRoom(room);
}
