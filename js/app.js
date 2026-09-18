// ============================================================
// app.js — screens, rendering and the host/client wiring.
// ============================================================

import { $, $$, el, toast, buzz, lsGet, lsSet, lsDel, keepAwake } from './util.js';
import { PRESETS, presetRoles, makeRole, validateRoles } from './roles.js';
import { Game } from './game.js';
import { HostNet, ClientNet } from './net.js';

const RESUME_TTL = 8 * 60 * 60 * 1000;   // 8h — long enough for a night of games

const S = {
  mode: null,          // 'host' | 'client'
  screen: 'home',
  game: null,          // Game — host only
  net: null,           // HostNet | ClientNet
  myId: null,
  code: null,
  state: null,         // public state (both modes)
  secret: null,        // my private payload
  lastRound: -1,
  holdMode: lsGet('ct:holdMode', 'hold'),
  create: {
    count: 5,
    hostPlays: true,
    preset: 'cheese',
    roles: presetRoles('cheese'),
    dice: { count: 1, sides: 6, self: true },
  },
};

// ------------------------------------------------------------
// screens
// ------------------------------------------------------------
function goto(name) {
  S.screen = name;
  $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
  window.scrollTo(0, 0);
}

function setHostBody(on) { document.body.classList.toggle('is-host', on); }

function netbar(kind, text) {
  const b = $('#netbar');
  if (!kind) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  b.classList.toggle('warn', kind === 'warn');
  b.textContent = text;
}

// ------------------------------------------------------------
// create screen — role editor
// ------------------------------------------------------------
function renderPresetSelect() {
  const sel = $('#preset-select');
  sel.innerHTML = '';
  for (const [k, p] of Object.entries(PRESETS)) sel.append(el('option', { value: k }, p.label));
  sel.value = S.create.preset;
}

function renderRoleEditor() {
  const c = S.create;
  const list = $('#role-list');
  list.innerHTML = '';

  for (const r of c.roles) {
    const count = r.filler
      ? el('div', { class: 'cnt' }, el('span', { class: 'auto', text: '自動' }))
      : el('div', { class: 'cnt' },
          el('button', { type: 'button', onclick: () => { r.count = Math.max(0, r.count - 1); refreshCreate(); } }, '−'),
          el('span', { text: String(r.count) }),
          el('button', { type: 'button', onclick: () => { r.count = Math.min(c.count, r.count + 1); refreshCreate(); } }, '+'),
        );

    list.append(el('div', { class: 'role-row' + (r.filler ? ' is-filler' : '') },
      el('input', {
        class: 'emoji-btn', type: 'text', maxlength: 2, value: r.emoji,
        'aria-label': '角色 emoji',
        oninput: (e) => { r.emoji = e.target.value.trim() || '❓'; },
      }),
      el('input', {
        class: 'role-name-in', type: 'text', maxlength: 8, value: r.name,
        'aria-label': '角色名',
        oninput: (e) => { r.name = e.target.value; },
      }),
      count,
      el('button', {
        class: 'del', type: 'button', 'aria-label': '刪除角色',
        onclick: () => {
          if (c.roles.length <= 2) { toast('最少要兩個角色'); return; }
          c.roles = c.roles.filter(x => x !== r);
          refreshCreate();
        },
      }, '✕'),
    ));
  }

  // which role soaks up the leftover seats
  const pick = el('select', {
    class: 'sel', 'aria-label': '自動填充角色',
    onchange: (e) => {
      for (const r of c.roles) r.filler = (r.id === e.target.value);
      refreshCreate();
    },
  },
    ...c.roles.map(r => el('option', { value: r.id }, `${r.emoji} ${r.name}`)),
    el('option', { value: '' }, '（唔自動填充）'),
  );
  pick.value = c.roles.find(r => r.filler)?.id ?? '';

  list.append(el('div', { class: 'filler-pick' },
    el('span', { class: 'field-label', text: '剩低嘅人數自動當' }), pick));
}

function refreshCreate() {
  const c = S.create;
  $('#pc-value').textContent = c.count;
  renderRoleEditor();

  const v = validateRoles(c.roles, c.count);
  const box = $('#role-total');
  box.textContent = v.message;
  box.className = 'role-total ' + (v.ok ? 'good' : 'bad');
  $('#btn-create').disabled = !v.ok;
  $('#hostplay-warn').classList.toggle('hidden', !c.hostPlays);
}

// ------------------------------------------------------------
// lobby
// ------------------------------------------------------------
function renderLobby() {
  const st = S.state;
  if (!st) return;
  $('#lobby-code').textContent = st.code;

  const seated = st.players.filter(p => p.isPlayer);
  $('#lobby-count').textContent = `${seated.length} / ${st.settings.maxPlayers}`;

  const ul = $('#lobby-players');
  ul.innerHTML = '';
  if (!st.players.length) ul.append(el('li', { class: 'empty' }, '仲未有人…'));

  for (const p of st.players) {
    ul.append(el('li', {},
      el('span', { class: 'dot' + (p.connected ? '' : ' off') }),
      el('span', { class: 'nm', text: p.name + (p.id === S.myId ? '（你）' : '') }),
      p.isHost ? el('span', { class: 'tag host' }, p.isPlayer ? '房主' : '主持') : null,
      !p.isPlayer && !p.isHost ? el('span', { class: 'tag' }, '旁觀') : null,
      S.mode === 'host' && !p.isHost
        ? el('button', {
            class: 'del', type: 'button', 'aria-label': '踢走',
            onclick: () => { if (confirm(`踢走 ${p.name}？`)) S.game.kick(p.id); },
          }, '✕')
        : null,
    ));
  }

  const d = st.settings.dice;
  $('#lobby-setup-summary').innerHTML = '';
  $('#lobby-setup-summary').append(
    el('div', { class: 'setup-line' }, el('span', {}, '角色'),
      el('span', {}, st.settings.roles.map(r => `${r.emoji}${r.name}${r.filler ? '' : '×' + r.count}`).join('  '))),
    el('div', { class: 'setup-line' }, el('span', {}, '骰仔'),
      el('span', {}, `${d.count} × d${d.sides}`)),
    el('div', { class: 'setup-line' }, el('span', {}, '房主'),
      el('span', {}, st.settings.hostPlays ? '一齊玩' : '做主持（唔攞牌）')),
  );

  if (S.mode === 'host') {
    const can = S.game.canStart();
    $('#btn-start').disabled = !can.ok;
    $('#lobby-status').textContent = can.ok ? '夠人喇，開得！' : can.reason;
    $('#lobby-status').className = 'status' + (can.ok ? ' ok' : '');
  } else {
    $('#lobby-status').textContent = '等房主開始…';
    $('#lobby-status').className = 'status';
  }
}

// ------------------------------------------------------------
// game
// ------------------------------------------------------------
const PIPS = {
  1: ['c'], 2: ['tl', 'br'], 3: ['tl', 'c', 'br'],
  4: ['tl', 'tr', 'bl', 'br'], 5: ['tl', 'tr', 'c', 'bl', 'br'],
  6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
};
const PIP_POS = { tl: [1, 1], tr: [1, 3], ml: [2, 1], c: [2, 2], mr: [2, 3], bl: [3, 1], br: [3, 3] };

function dieEl(value, sides) {
  if (sides === 6 && PIPS[value]) {
    const d = el('div', { class: 'die pips' });
    for (const k of PIPS[value]) {
      const [r, c] = PIP_POS[k];
      const pip = el('span', { class: 'pip' });
      pip.style.gridRow = r; pip.style.gridColumn = c;
      d.append(pip);
    }
    return d;
  }
  return el('div', { class: 'die', text: String(value) });
}

function roleById(id) { return S.state?.settings.roles.find(r => r.id === id) ?? null; }

function renderGame() {
  const st = S.state;
  if (!st) return;
  $('#game-round').textContent = st.round;
  $('#game-code').textContent = st.code;

  // --- my role ---
  const me = st.players.find(p => p.id === S.myId);
  const amPlayer = me?.isPlayer ?? false;
  $('#my-role-card').classList.toggle('hidden', !amPlayer);

  const role = roleById(S.secret?.roleId);
  $('#role-emoji').textContent = role?.emoji ?? '❔';
  $('#role-name').textContent  = role?.name ?? '未派牌';
  $('#role-desc').textContent  = role?.desc ?? '';

  // --- my dice ---
  const d = st.settings.dice;
  const row = $('#dice-row');
  row.innerHTML = '';
  const mine = S.secret?.dice;
  if (mine?.length) {
    for (const v of mine) row.append(dieEl(v, d.sides));
    $('#dice-sum').textContent = mine.length > 1 ? `總和 ${mine.reduce((a, b) => a + b, 0)}` : '';
  } else {
    row.append(el('div', { class: 'die', text: '–' }));
    $('#dice-sum').textContent = '未搖過';
  }
  const canSelfRoll = amPlayer && (d.self || S.mode === 'host');
  $('#btn-roll').classList.toggle('hidden', !canSelfRoll);
  $('#dice-card').classList.toggle('hidden', !amPlayer);

  // --- table ---
  $('#game-count').textContent = String(st.players.filter(p => p.isPlayer).length);
  const ul = $('#game-players');
  ul.innerHTML = '';
  for (const p of st.players) {
    const r = p.roleId ? roleById(p.roleId) : null;
    ul.append(el('li', {},
      el('span', { class: 'dot' + (p.connected ? '' : ' off') }),
      el('span', { class: 'nm', text: p.name + (p.id === S.myId ? '（你）' : '') }),
      p.isHost && !p.isPlayer ? el('span', { class: 'tag host' }, '主持') : null,
      r ? el('span', { class: 'tag role' }, `${r.emoji} ${r.name}`) : null,
      p.dice ? el('span', { class: 'tag dice' }, '🎲 ' + p.dice.join(' ')) : null,
      !r && p.isPlayer && p.seenRole ? el('span', { class: 'tag seen' }, '已睇牌') : null,
    ));
  }

  // --- log ---
  const lg = $('#game-log');
  lg.innerHTML = '';
  for (const l of st.log.slice(-25).reverse()) {
    lg.append(el('li', {}, el('span', { class: 't', text: l.t }), l.text));
  }
}

function render() {
  if (S.screen === 'lobby') renderLobby();
  if (S.screen === 'game') renderGame();
}

// ------------------------------------------------------------
// the "冚住" mechanic
// ------------------------------------------------------------
const covers = [];

function bindCover(node, what) {
  let open = false;
  const set = (v) => {
    if (open === v) return;
    open = v;
    node.classList.toggle('open', v);
    if (v) { buzz(12); sendSeen(what); }
  };

  node.addEventListener('pointerdown', (e) => {
    if (S.holdMode !== 'hold') return;
    e.preventDefault();
    // Capturing keeps the peek alive if the finger slides off the card.
    // It throws for pointers the browser no longer tracks — never let that
    // stop the reveal, or the card silently refuses to open.
    try { node.setPointerCapture(e.pointerId); } catch { /* peek still works */ }
    set(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    node.addEventListener(ev, () => { if (S.holdMode === 'hold') set(false); });
  }
  node.addEventListener('click', () => { if (S.holdMode === 'toggle') set(!open); });
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set(!open); }
  });

  const api = { close: () => set(false), shake: () => {
    node.classList.remove('shaking');
    void node.offsetWidth;            // restart the CSS animation
    node.classList.add('shaking');
  } };
  covers.push(api);
  return api;
}

function closeAllCovers() { covers.forEach(c => c.close()); }

// Never leave a card face-up when the phone gets put down or handed over.
document.addEventListener('visibilitychange', () => { if (document.hidden) closeAllCovers(); });
window.addEventListener('blur', closeAllCovers);
window.addEventListener('pagehide', closeAllCovers);

// ------------------------------------------------------------
// host wiring
// ------------------------------------------------------------
let pushQueued = false;
function pushState() {
  if (pushQueued) return;
  pushQueued = true;
  queueMicrotask(() => {
    pushQueued = false;
    if (!S.game) return;
    S.state = S.game.publicState();
    S.net?.broadcast({ t: 'state', state: S.state });
    saveHostSnapshot();
    render();
  });
}

function pushSecret(pid) {
  const g = S.game;
  if (!g) return;
  const p = g.players.get(pid);
  if (!p) return;
  const payload = g.secretFor(pid);
  if (pid === g.hostId) { S.secret = payload; closeAllCovers(); render(); }
  else if (p.peerId) S.net.sendTo(p.peerId, { t: 'secret', secret: payload });
}

function wireGame(g) {
  g.onChange = pushState;
  g.onSecret = pushSecret;
  S.game = g;
  S.myId = g.hostId;
  S.code = g.code;
  S.mode = 'host';
  setHostBody(true);
  keepAwake(true);
}

function onHostMessage(peerId, msg) {
  const g = S.game;
  if (!g) return;

  switch (msg?.t) {
    case 'hello': {
      const res = g.join(peerId, msg.name, msg.token);
      if (!res.ok) { S.net.sendTo(peerId, { t: 'reject', reason: res.reason }); return; }
      S.net.sendTo(peerId, {
        t: 'welcome',
        you: { id: res.player.id, token: res.player.token, name: res.player.name },
        state: g.publicState(),
        secret: g.secretFor(res.player.id),
      });
      break;
    }
    case 'roll': {
      const p = g.byPeer(peerId);
      if (!p || !p.isPlayer) return;
      if (!g.settings.dice.self) return;
      g.rollOne(p.id);
      break;
    }
    case 'seen': {
      const p = g.byPeer(peerId);
      if (p) g.markSeen(p.id, msg.what);
      break;
    }
  }
}

function startHostNet(hostNet) {
  hostNet.on('message', onHostMessage);
  hostNet.on('peer-close', (peerId) => S.game?.disconnect(peerId));
  hostNet.on('status', (kind) => {
    if (kind === 'online') netbar(null);
    else if (kind === 'reconnecting') netbar('warn', '⚠️ 同 signalling server 斷咗，重連緊…');
    else netbar('err', '❌ 連線出咗問題，試下 refresh');
  });
}

function saveHostSnapshot() {
  if (S.mode !== 'host' || !S.game) return;
  lsSet('ct:host:' + S.game.code, S.game.snapshot());
  lsSet('ct:resume', { mode: 'host', code: S.game.code, savedAt: Date.now() });
}

// ------------------------------------------------------------
// client wiring
// ------------------------------------------------------------
function onClientMessage(msg) {
  switch (msg?.t) {
    case 'welcome':
      S.myId = msg.you.id;
      lsSet('ct:token:' + S.code, msg.you.token);
      lsSet('ct:resume', { mode: 'client', code: S.code, name: msg.you.name, savedAt: Date.now() });
      S.state = msg.state;
      S.secret = msg.secret;
      S.lastRound = msg.state.round;
      goto(msg.state.phase === 'lobby' ? 'lobby' : 'game');
      render();
      break;

    case 'state': {
      const prev = S.lastRound;
      S.state = msg.state;
      if (msg.state.round !== prev) { S.lastRound = msg.state.round; closeAllCovers(); }
      if (msg.state.phase === 'playing' && S.screen === 'lobby') goto('game');
      if (msg.state.phase === 'lobby' && S.screen === 'game') goto('lobby');
      render();
      break;
    }

    case 'secret':
      S.secret = msg.secret;
      closeAllCovers();
      render();
      break;

    case 'reject':
      $('#join-status').textContent = '❌ ' + msg.reason;
      $('#join-status').className = 'status err';
      lsDel('ct:token:' + S.code);
      S.net?.close(); S.net = null;
      goto('join');
      break;
  }
}

function sendSeen(what) {
  if (S.mode === 'host') S.game?.markSeen(S.myId, what);
  else S.net?.send({ t: 'seen', what });
}

// ------------------------------------------------------------
// QR — pulled in on demand so it never sits on the load path
// ------------------------------------------------------------
const QR_CDN = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
let qrLoading = null;

function roomLink() { return location.origin + location.pathname + '?r=' + S.state.code; }

function loadQrLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  qrLoading ??= new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = QR_CDN;
    tag.onload = () => window.qrcode ? resolve(window.qrcode) : reject(new Error('qrcode global missing'));
    tag.onerror = () => { qrLoading = null; reject(new Error('QR CDN unreachable')); };
    document.head.append(tag);
  });
  return qrLoading;
}

// ------------------------------------------------------------
// actions
// ------------------------------------------------------------
async function doCreate() {
  const c = S.create;
  const name = ($('#home-name').value || '').trim().slice(0, 12) || '房主';
  lsSet('ct:name', name);

  $('#create-status').textContent = '開緊房…';
  $('#create-status').className = 'status';
  $('#btn-create').disabled = true;

  try {
    const net = new HostNet();
    const code = await net.open();
    S.net = net;
    startHostNet(net);

    wireGame(new Game({
      code, hostName: name,
      maxPlayers: c.count,
      hostPlays: c.hostPlays,
      roles: c.roles.map(r => ({ ...r })),
      dice: { ...c.dice },
    }));

    S.state = S.game.publicState();
    goto('lobby');
    render();
    saveHostSnapshot();
  } catch (err) {
    console.error(err);
    $('#create-status').textContent = '❌ 開唔到房：' + (err?.type || err?.message || '未知錯誤') + '。試下 refresh 或者換個網絡。';
    $('#create-status').className = 'status err';
  } finally {
    $('#btn-create').disabled = false;
  }
}

async function doJoin(codeIn, nameIn) {
  const code = (codeIn ?? $('#join-code').value).trim().toUpperCase();
  const name = (nameIn ?? $('#join-name').value).trim().slice(0, 12);
  if (code.length !== 4) { setJoinErr('房間號碼係 4 個字'); return; }
  if (!name) { setJoinErr('填返個名先'); return; }
  lsSet('ct:name', name);

  $('#join-status').textContent = '連緊…';
  $('#join-status').className = 'status';
  $('#btn-join').disabled = true;

  try {
    const net = new ClientNet();
    S.mode = 'client';
    S.code = code;
    setHostBody(false);
    net.on('message', onClientMessage);
    net.on('status', (kind) => {
      if (kind === 'online') netbar(null);
      else if (kind === 'reconnecting' || kind === 'offline') netbar('warn', '⚠️ 同房主斷咗，重連緊…');
      else if (kind === 'host-gone') netbar('err', '❌ 揾唔到房主 — 佢可能熄咗個頁面');
      else netbar('err', '❌ 連線出咗問題');
    });
    net.on('open', () => {
      net.send({ t: 'hello', name, token: lsGet('ct:token:' + code, null) });
    });

    await net.connect(code);
    S.net = net;
    keepAwake(true);
  } catch (err) {
    console.error(err);
    setJoinErr('入唔到房 — 睇下個號碼啱唔啱，房主係咪仲開緊個頁面。');
    S.net?.close(); S.net = null;
  } finally {
    $('#btn-join').disabled = false;
  }
}

function setJoinErr(m) {
  $('#join-status').textContent = '❌ ' + m;
  $('#join-status').className = 'status err';
}

function leaveRoom() {
  if (!confirm('真係要離開？')) return;
  if (S.mode === 'host' && S.game) lsDel('ct:host:' + S.game.code);
  lsDel('ct:resume');
  S.net?.close();
  Object.assign(S, { mode: null, game: null, net: null, myId: null, code: null, state: null, secret: null, lastRound: -1 });
  keepAwake(false);
  setHostBody(false);
  netbar(null);
  goto('home');
}

// ------------------------------------------------------------
// resume
// ------------------------------------------------------------
async function resumeHost(code) {
  const snap = lsGet('ct:host:' + code, null);
  if (!snap) { toast('揾唔返上一局'); return; }
  try {
    const net = new HostNet();
    await net.open(code);
    S.net = net;
    startHostNet(net);
    wireGame(Game.restore(snap));
    S.secret = S.game.secretFor(S.game.hostId);
    S.state = S.game.publicState();
    S.lastRound = S.state.round;
    goto(S.state.phase === 'lobby' ? 'lobby' : 'game');
    render();
    toast('房間 ' + code + ' 恢復咗，叫朋友 refresh');
  } catch (err) {
    console.error(err);
    toast('恢復唔到：' + (err?.type || err?.message || '未知'), 3200);
  }
}

function renderResume() {
  const r = lsGet('ct:resume', null);
  const old = $('#resume-box');
  if (old) old.remove();
  if (!r || Date.now() - (r.savedAt ?? 0) > RESUME_TTL) return;

  const box = el('div', { class: 'card', id: 'resume-box' },
    el('div', { class: 'setup-line' },
      el('span', {}, r.mode === 'host' ? '你之前開緊房' : '你之前喺房'),
      el('strong', {}, r.code)),
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button',
      onclick: () => {
        if (r.mode === 'host') resumeHost(r.code);
        else { $('#join-code').value = r.code; $('#join-name').value = r.name || lsGet('ct:name', ''); goto('join'); doJoin(r.code, r.name || lsGet('ct:name', '')); }
      },
    }, '↩︎ 返去 ' + r.code),
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button',
      onclick: () => { lsDel('ct:resume'); renderResume(); },
    }, '✕ 唔要'),
  );
  $('[data-screen="home"] .stack').after(box);
}

// ------------------------------------------------------------
// boot
// ------------------------------------------------------------
function boot() {
  // ---- home ----
  const savedName = lsGet('ct:name', '');
  $('#home-name').value = savedName;
  $('#join-name').value = savedName;

  $('#btn-goto-create').onclick = () => {
    if (!$('#home-name').value.trim()) { toast('填返個名先'); $('#home-name').focus(); return; }
    lsSet('ct:name', $('#home-name').value.trim());
    goto('create');
    refreshCreate();
  };
  $('#btn-goto-join').onclick = () => {
    $('#join-name').value = $('#home-name').value || savedName;
    goto('join');
  };
  $$('[data-back]').forEach(b => { b.onclick = () => goto(b.dataset.back); });

  // ---- create ----
  renderPresetSelect();
  $('#preset-select').onchange = (e) => {
    S.create.preset = e.target.value;
    S.create.roles = presetRoles(e.target.value);
    refreshCreate();
  };
  $('#pc-minus').onclick = () => { S.create.count = Math.max(2, S.create.count - 1); refreshCreate(); };
  $('#pc-plus').onclick  = () => { S.create.count = Math.min(16, S.create.count + 1); refreshCreate(); };
  $('#host-plays').onchange = (e) => { S.create.hostPlays = e.target.checked; refreshCreate(); };
  $('#btn-add-role').onclick = () => { S.create.roles.splice(S.create.roles.length - 1, 0, makeRole({ name: '新角色', count: 1 })); refreshCreate(); };

  const dc = $('#dice-count');
  for (let i = 1; i <= 5; i++) dc.append(el('option', { value: i }, i + ' 粒'));
  dc.value = 1;
  dc.onchange = (e) => { S.create.dice.count = +e.target.value; };

  const ds = $('#dice-sides');
  for (const n of [4, 6, 8, 10, 12, 20]) ds.append(el('option', { value: n }, 'd' + n));
  ds.value = 6;
  ds.onchange = (e) => { S.create.dice.sides = +e.target.value; };

  $('#dice-self').onchange = (e) => { S.create.dice.self = e.target.checked; };
  $('#btn-create').onclick = doCreate;

  // ---- join ----
  $('#join-code').oninput = (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''); };
  $('#join-code').onkeydown = (e) => { if (e.key === 'Enter') doJoin(); };
  $('#join-name').onkeydown = (e) => { if (e.key === 'Enter') doJoin(); };
  $('#btn-join').onclick = () => doJoin();

  // ---- lobby ----
  $('#btn-leave-lobby').onclick = leaveRoom;
  $('#btn-start').onclick = () => {
    const can = S.game.canStart();
    if (!can.ok) { toast(can.reason, 2600); return; }
    S.game.deal();
    S.lastRound = S.game.round;
    goto('game');
    render();
  };
  $('#btn-copy-link').onclick = async () => {
    const url = roomLink();
    try { await navigator.clipboard.writeText(url); toast('連結已複製'); }
    catch { prompt('複製呢條連結：', url); }
  };
  $('#btn-toggle-qr').onclick = async () => {
    const wrap = $('#qr-wrap');
    wrap.classList.toggle('hidden');
    if (wrap.classList.contains('hidden')) return;
    const box = $('#qr-canvas');
    try {
      const qrcode = await loadQrLib();
      const qr = qrcode(0, 'M');
      qr.addData(roomLink());
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 1, scalable: true });
    } catch {
      box.innerHTML = '';
      box.append(el('div', { class: 'qr-fail', text: '載入唔到 QR — 用「複製連結」啦' }));
    }
  };

  // ---- game ----
  bindCover($('#role-cover'), 'role');
  const diceCover = bindCover($('#dice-cover'), 'dice');

  $('#toggle-mode').checked = S.holdMode === 'toggle';
  $('#toggle-mode').onchange = (e) => {
    S.holdMode = e.target.checked ? 'toggle' : 'hold';
    lsSet('ct:holdMode', S.holdMode);
    closeAllCovers();
    const t = S.holdMode === 'hold' ? '㩒住先睇到，放手即刻冚返' : '㩒一下開，再㩒一下冚';
    $('#my-role-card .hint').textContent = t;
    $('#dice-hint').textContent = S.holdMode === 'hold' ? '㩒住掀起個盅' : '㩒一下掀起個盅';
  };

  $('#btn-roll').onclick = () => {
    diceCover.shake();
    buzz([12, 40, 12]);
    if (S.mode === 'host') S.game.rollOne(S.myId);
    else S.net?.send({ t: 'roll' });
  };
  $('#btn-leave-game').onclick = leaveRoom;
  $('#btn-deal').onclick = () => { if (confirm('重新派牌（唔加回合數）？')) S.game.deal({ nextRound: false }); };
  $('#btn-next-round').onclick = () => { S.game.deal(); };
  $('#btn-roll-all').onclick = () => { diceCover.shake(); S.game.rollAll(); };
  $('#btn-reveal-dice').onclick = () => { if (confirm('公開所有人嘅骰？')) S.game.revealAllDice(); };
  $('#btn-reveal-roles').onclick = () => { if (confirm('開晒所有角色？呢個回合就完喇。')) S.game.revealAllRoles(); };

  // ---- deep link ?r=CODE ----
  const code = new URLSearchParams(location.search).get('r');
  if (code && /^[0-9A-Za-z]{4}$/.test(code)) {
    $('#join-code').value = code.toUpperCase();
    goto('join');
    if (savedName) { $('#join-name').value = savedName; }
  } else {
    goto('home');
    renderResume();
  }

  refreshCreate();

  // Wake locks are dropped when the tab goes to the background; re-arm on return.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.net) keepAwake(true);
  });

  window.addEventListener('beforeunload', (e) => {
    if (S.mode === 'host' && S.state?.phase === 'playing') {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

if (!window.Peer) {
  document.body.innerHTML =
    '<div style="padding:40px;text-align:center;color:#f4ecd8;font-family:sans-serif">' +
    '載入唔到 PeerJS。<br>檢查下網絡再 refresh。</div>';
} else {
  boot();
}
