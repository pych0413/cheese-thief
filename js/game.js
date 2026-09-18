// ============================================================
// game.js — authoritative room state. Runs on the HOST only.
//
// Everything secret (who got which card, what each player rolled)
// lives here and is pushed down one channel at a time, so a player's
// phone literally never receives another player's card.
// ============================================================

import { uid, shuffle, rollDie, hhmm } from './util.js?v=202609190337';
import { buildDeck, validateRoles } from './roles.js?v=202609190337';

const MAX_LOG = 60;

export class Game {
  /**
   * @param {object} opts
   * @param {string} opts.code        room code
   * @param {string} opts.hostName
   * @param {number} opts.maxPlayers  how many people get a card
   * @param {boolean} opts.hostPlays  false => host is a moderator with no card
   * @param {Array}  opts.roles
   * @param {object} opts.dice        { count, sides, self }
   */
  constructor(opts) {
    this.code = opts.code;
    this.phase = 'lobby';
    this.round = 0;
    this.settings = {
      maxPlayers: opts.maxPlayers,
      hostPlays: opts.hostPlays,
      roles: opts.roles,
      dice: { count: opts.dice.count, sides: opts.dice.sides, self: opts.dice.self },
    };

    this.players = new Map();   // pid -> { id, name, token, isHost, isPlayer, connected, peerId, seenRole, seenDice }
    this.assign  = new Map();   // pid -> roleId   (SECRET)
    this.dice    = new Map();   // pid -> number[] (SECRET until revealed)
    this.revealRoles = false;
    this.revealDice  = false;
    this.diceUnlockSeq = 0;
    this.log = [];

    this.hostId = this.#addPlayer(opts.hostName, { isHost: true, isPlayer: opts.hostPlays });
    this.onChange = () => {};
    this.onSecret = () => {};   // (pid) => void  — that player's private payload changed

    this.note(`房間 ${this.code} 開咗`);
  }

  // ---------- players ----------
  #addPlayer(name, { isHost = false, isPlayer = true, peerId = null } = {}) {
    const id = uid('p');
    this.players.set(id, {
      id, name, token: uid('t'), isHost, isPlayer,
      connected: isHost, peerId, seenRole: false, seenDice: false,
      roleLocked: false, diceLocked: false,
    });
    return id;
  }

  /** Seats that can hold a card. */
  seatsUsed() { return [...this.players.values()].filter(p => p.isPlayer).length; }
  seatsFree() { return this.settings.maxPlayers - this.seatsUsed(); }
  playerList() { return [...this.players.values()]; }
  byToken(token) { return this.playerList().find(p => p.token === token); }
  byPeer(peerId) { return this.playerList().find(p => p.peerId === peerId); }

  /**
   * A phone said hello.
   * @returns {{ok:true, player:object}|{ok:false, reason:string}}
   */
  join(peerId, name, token) {
    // Returning player (refresh, tunnel, phone woke up) — keep their card.
    if (token) {
      const p = this.byToken(token);
      if (p) {
        // Drop any stale connection sitting on the same identity.
        const old = p.peerId;
        p.peerId = peerId;
        p.connected = true;
        if (name) p.name = name;
        this.note(`${p.name} 返嚟咗`);
        this.onChange();
        return { ok: true, player: p, replaced: old && old !== peerId ? old : null };
      }
    }

    const clean = (name || '').trim().slice(0, 12) || '玩家';
    if (this.playerList().some(p => p.name === clean && p.connected)) {
      return { ok: false, reason: `已經有人叫「${clean}」，改個名啦` };
    }
    if (this.seatsFree() <= 0) return { ok: false, reason: '房滿咗' };

    const id = this.#addPlayer(clean, { peerId });
    const p = this.players.get(id);
    p.connected = true;
    this.note(`${clean} 入咗房`);
    this.onChange();
    return { ok: true, player: p };
  }

  disconnect(peerId) {
    const p = this.byPeer(peerId);
    if (!p) return;
    p.connected = false;
    // In the lobby nobody has a card yet, so free the seat outright.
    if (this.phase === 'lobby') {
      this.players.delete(p.id);
      this.note(`${p.name} 走咗`);
    } else {
      this.note(`${p.name} 斷咗線`);
    }
    this.onChange();
  }

  kick(pid) {
    const p = this.players.get(pid);
    if (!p || p.isHost) return;
    this.players.delete(pid);
    this.assign.delete(pid);
    this.dice.delete(pid);
    this.note(`${p.name} 被踢出房`);
    this.onChange();
  }

  // ---------- dealing ----------
  canStart() {
    const seated = this.seatsUsed();
    if (seated < 2) return { ok: false, reason: '最少要 2 個玩家' };
    if (seated !== this.settings.maxPlayers) {
      return { ok: false, reason: `仲爭 ${this.settings.maxPlayers - seated} 個人（${seated}/${this.settings.maxPlayers}）` };
    }
    const v = validateRoles(this.settings.roles, seated);
    if (!v.ok) return { ok: false, reason: v.message };
    return { ok: true };
  }

  deal({ nextRound = true } = {}) {
    const seated = this.playerList().filter(p => p.isPlayer);
    const deck = buildDeck(this.settings.roles, seated.length);
    const order = shuffle(seated.map(p => p.id));

    this.assign.clear();
    order.forEach((pid, i) => this.assign.set(pid, deck[i]));

    this.revealRoles = false;
    this.phase = 'playing';
    if (nextRound) this.round += 1;
    for (const p of this.players.values()) { p.seenRole = false; p.roleLocked = false; }

    this.note(`派咗牌（第 ${this.round} 回合）`);
    for (const pid of this.players.keys()) this.onSecret(pid);
    this.onChange();
  }

  // ---------- dice ----------
  rollFor(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    const { count, sides } = this.settings.dice;
    this.dice.set(pid, Array.from({ length: count }, () => rollDie(sides)));
    p.seenDice = false;
    p.diceLocked = false;
    this.revealDice = false;
    this.onSecret(pid);
  }

  rollOne(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    this.rollFor(pid);
    this.note(`${p.name} 搖咗骰`);
    this.onChange();
  }

  rollAll() {
    for (const p of this.players.values()) if (p.isPlayer) this.rollFor(p.id);
    this.note('全體搖骰 🎲');
    this.onChange();
  }

  markSeen(pid, what) {
    const p = this.players.get(pid);
    if (!p) return;
    if (what === 'role' && !p.seenRole) { p.seenRole = true; this.onChange(); }
    if (what === 'dice' && !p.seenDice) { p.seenDice = true; this.onChange(); }
  }

  // ---------- locks ----------
  // Two different locks. A role card latches shut so a friend grabbing your
  // phone and mashing the card sees nothing; the owner latches and unlatches
  // it. A dice lock freezes the roll instead — you keep looking at your own
  // number, you just cannot roll again until the host unlocks, so nobody
  // re-rolls for a better one.
  setLock(pid, what, on) {
    const p = this.players.get(pid);
    if (!p) return;
    if (what === 'role') {
      if (p.roleLocked === on) return;
      p.roleLocked = on;
      this.note(`${p.name} ${on ? '鎖咗' : '解鎖咗'}角色牌`);
    } else if (what === 'dice') {
      if (!on || p.diceLocked) return;   // players cannot self-unlock dice
      p.diceLocked = true;
      this.note(`${p.name} 鎖定咗點數`);
    }
    this.onChange();
  }

  unlockAllDice() {
    let any = false;
    for (const p of this.players.values()) {
      if (p.diceLocked) { p.diceLocked = false; any = true; }
    }
    if (!any) return false;
    // Bumping the sequence is how a phone tells "the host opened my cup"
    // apart from "the host never heard me lock it" and re-sends the lock.
    this.diceUnlockSeq += 1;
    this.note('🔓 主持解鎖咗所有骰盅，可以再搖');
    this.onChange();
    return true;
  }

  // ---------- reveal ----------
  revealAllRoles() {
    this.revealRoles = true;
    this.note('🔓 開晒角色！');
    for (const pid of this.players.keys()) this.onSecret(pid);
    this.onChange();
  }

  revealAllDice() {
    this.revealDice = true;
    this.note('👁 開晒啲骰');
    this.onChange();
  }

  // ---------- log ----------
  note(text) {
    this.log.push({ ts: Date.now(), text });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  // ---------- serialisation ----------
  /** Everything every phone is allowed to know. */
  publicState() {
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      settings: {
        maxPlayers: this.settings.maxPlayers,
        hostPlays: this.settings.hostPlays,
        dice: { ...this.settings.dice },
        roles: this.settings.roles.map(r => ({ id: r.id, name: r.name, emoji: r.emoji, desc: r.desc, count: r.count, filler: r.filler })),
      },
      revealRoles: this.revealRoles,
      revealDice: this.revealDice,
      diceUnlockSeq: this.diceUnlockSeq,
      players: this.playerList().map(p => ({
        id: p.id, name: p.name, isHost: p.isHost, isPlayer: p.isPlayer,
        connected: p.connected, seenRole: p.seenRole, seenDice: p.seenDice,
        roleLocked: p.roleLocked, diceLocked: p.diceLocked,
        hasDice: this.dice.has(p.id),
        roleId: this.revealRoles ? (this.assign.get(p.id) ?? null) : null,
        dice:   this.revealDice  ? (this.dice.get(p.id)   ?? null) : null,
      })),
      log: this.log.map(l => ({ t: hhmm(l.ts), text: l.text })),
    };
  }


  // ---------- persistence (host phone reloads the tab far too eagerly) ----------
  snapshot() {
    return {
      v: 1, savedAt: Date.now(),
      code: this.code, phase: this.phase, round: this.round,
      settings: this.settings, hostId: this.hostId,
      players: [...this.players.values()],
      assign: [...this.assign.entries()],
      dice: [...this.dice.entries()],
      revealRoles: this.revealRoles, revealDice: this.revealDice,
      diceUnlockSeq: this.diceUnlockSeq,
      log: this.log,
    };
  }

  static restore(snap) {
    const g = Object.create(Game.prototype);
    g.code = snap.code;
    g.phase = snap.phase;
    g.round = snap.round;
    g.settings = snap.settings;
    g.hostId = snap.hostId;
    g.players = new Map(snap.players.map(p => [p.id, {
      roleLocked: false, diceLocked: false, ...p, connected: p.isHost, peerId: null,
    }]));
    g.assign = new Map(snap.assign);
    g.dice = new Map(snap.dice);
    g.revealRoles = snap.revealRoles;
    g.revealDice = snap.revealDice;
    g.diceUnlockSeq = snap.diceUnlockSeq ?? 0;
    g.log = snap.log ?? [];
    g.onChange = () => {};
    g.onSecret = () => {};
    g.note('房主重新連線，房間恢復');
    return g;
  }

  /** Sent down exactly one channel — the owner's. */
  secretFor(pid) {
    return {
      roleId: this.assign.get(pid) ?? null,
      dice: this.dice.get(pid) ?? null,
      round: this.round,
    };
  }
}
