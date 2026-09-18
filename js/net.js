// ============================================================
// net.js — WebRTC transport over the public PeerJS cloud.
//
// Topology: star. The host's phone IS the server; every other phone
// opens one reliable DataChannel to it. No accounts, no backend.
//
// The room code doubles as the host's PeerJS id, so joining is just
// "connect to cheesethief-v1-<CODE>".
// ============================================================

import { makeRoomCode, sleep } from './util.js?v=202609190342';

const NS = 'cheesethief-v1-';
export const peerIdFor = (code) => NS + String(code);

// STUN gets us through most NATs; the free TURN relays rescue the
// carrier-grade NATs that mobile data loves to sit behind.
const ICE = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80',            username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443',           username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

class Emitter {
  #handlers = new Map();
  on(ev, fn) { (this.#handlers.get(ev) ?? this.#handlers.set(ev, []).get(ev)).push(fn); return this; }
  emit(ev, ...args) { for (const fn of this.#handlers.get(ev) ?? []) { try { fn(...args); } catch (e) { console.error(e); } } }
}

function newPeer(id) {
  return new Peer(id, { debug: 1, config: ICE });
}

/** Resolve once the peer is open, or reject with the PeerJS error. */
function peerReady(peer) {
  return new Promise((resolve, reject) => {
    const ok = (id) => { cleanup(); resolve(id); };
    const bad = (err) => { cleanup(); reject(err); };
    const cleanup = () => { peer.off('open', ok); peer.off('error', bad); };
    peer.on('open', ok);
    peer.on('error', bad);
  });
}

// ------------------------------------------------------------
// HOST
// ------------------------------------------------------------
export class HostNet extends Emitter {
  constructor() { super(); this.peer = null; this.code = null; this.conns = new Map(); }

  /**
   * Claim a room code on the signalling server.
   * @param {string|null} preferred reuse this code (host refreshed the page); null = pick a fresh one
   */
  async open(preferred = null) {
    const tries = preferred ? 6 : 14;   // only 1296 codes exist, so collisions are normal
    let lastErr = null;

    for (let i = 0; i < tries; i++) {
      const code = preferred ?? makeRoomCode();
      const peer = newPeer(peerIdFor(code));
      try {
        await peerReady(peer);
        this.peer = peer;
        this.code = code;
        this.#wire();
        return code;
      } catch (err) {
        lastErr = err;
        try { peer.destroy(); } catch { /* already dead */ }
        if (err?.type === 'unavailable-id') {
          // Reclaiming our own id: the server holds it for a few seconds
          // after a refresh, so wait it out instead of changing the code.
          if (preferred) { await sleep(1200 * (i + 1)); continue; }
          continue; // fresh room: just try another code
        }
        if (err?.type === 'network' || err?.type === 'server-error' || err?.type === 'socket-error') {
          await sleep(700 * (i + 1));
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error('開唔到房');
  }

  #wire() {
    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        this.emit('peer-open', conn.peer);
      });
      conn.on('data', (msg) => this.emit('message', conn.peer, msg));
      conn.on('close', () => { this.conns.delete(conn.peer); this.emit('peer-close', conn.peer); });
      conn.on('error', () => { this.conns.delete(conn.peer); this.emit('peer-close', conn.peer); });
    });

    this.peer.on('disconnected', () => {
      this.emit('status', 'reconnecting');
      if (!this.peer.destroyed) { try { this.peer.reconnect(); } catch { /* retried by watchdog */ } }
    });
    this.peer.on('open', () => this.emit('status', 'online'));
    this.peer.on('error', (err) => {
      // peer-unavailable just means one client vanished; not fatal for the room.
      if (err?.type === 'peer-unavailable') return;
      this.emit('status', 'error', err);
    });

    // Signalling sockets die silently when a phone sleeps. Nudge it back.
    clearInterval(this._watch);
    this._watch = setInterval(() => {
      if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
        try { this.peer.reconnect(); } catch { /* next tick */ }
      }
    }, 5000);
  }

  sendTo(peerId, msg) {
    const c = this.conns.get(peerId);
    if (c?.open) { try { c.send(msg); return true; } catch { /* dropped */ } }
    return false;
  }

  broadcast(msg) { for (const id of this.conns.keys()) this.sendTo(id, msg); }

  close() {
    clearInterval(this._watch);
    for (const c of this.conns.values()) { try { c.close(); } catch { /* ignore */ } }
    this.conns.clear();
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.peer = null;
  }
}

// ------------------------------------------------------------
// CLIENT
// ------------------------------------------------------------
export class ClientNet extends Emitter {
  constructor() { super(); this.peer = null; this.conn = null; this.code = null; this.dead = false; }

  async connect(code) {
    this.code = String(code);
    this.dead = false;
    this.peer = newPeer(undefined);
    await peerReady(this.peer);

    this.peer.on('disconnected', () => { if (!this.dead && !this.peer.destroyed) { try { this.peer.reconnect(); } catch { /* watchdog */ } } });
    this.peer.on('error', (err) => {
      if (err?.type === 'peer-unavailable') { this.emit('status', 'host-gone'); this.#scheduleRetry(); return; }
      this.emit('status', 'error', err);
    });

    await this.#dial();
  }

  #dial() {
    return new Promise((resolve, reject) => {
      const conn = this.peer.connect(peerIdFor(this.code), { reliable: true, serialization: 'json' });
      if (!conn) return reject(new Error('連唔到房主'));

      const timer = setTimeout(() => { try { conn.close(); } catch { /* ignore */ } reject(new Error('連線逾時')); }, 15000);

      conn.on('open', () => {
        clearTimeout(timer);
        this.conn = conn;
        this.retries = 0;
        this.emit('status', 'online');
        this.emit('open');
        resolve();
      });
      conn.on('data', (msg) => this.emit('message', msg));
      conn.on('close', () => { clearTimeout(timer); this.conn = null; this.emit('status', 'offline'); this.#scheduleRetry(); });
      conn.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  }

  #scheduleRetry() {
    if (this.dead || this._retryTimer) return;
    this.retries = (this.retries ?? 0) + 1;
    const wait = Math.min(1000 * this.retries, 6000);
    this.emit('status', 'reconnecting');
    this._retryTimer = setTimeout(async () => {
      this._retryTimer = null;
      if (this.dead || this.conn) return;
      try { await this.#dial(); } catch { this.#scheduleRetry(); }
    }, wait);
  }

  send(msg) {
    if (this.conn?.open) { try { this.conn.send(msg); return true; } catch { /* dropped */ } }
    return false;
  }

  close() {
    this.dead = true;
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conn = null; this.peer = null;
  }
}
