// Online co-op over WebRTC using PeerJS. No game server of our own is needed:
// the free public PeerJS broker only introduces players, then data flows peer-to-peer.
// The host's browser is authoritative for creatures and seabed items.
const PREFIX = 'ddx-ocean-';

function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class Net {
  constructor() {
    this.peer = null;
    this.conns = new Map(); // host: peerId -> conn ; guest: 'host' -> conn
    this.isHost = false;
    this.code = null;
    this.onMessage = () => {};
    this.onJoin = () => {};
    this.onLeave = () => {};
    this.onDisconnect = () => {};
  }

  get available() { return typeof window.Peer === 'function'; }
  get myId() { return this.peer ? this.peer.id : 'local'; }

  host() {
    return new Promise((resolve, reject) => {
      if (!this.available) return reject(new Error('Online play library failed to load (check your internet).'));
      const attempt = (tries) => {
        const code = randomCode();
        const peer = new window.Peer(PREFIX + code, { debug: 0 });
        peer.on('open', () => { this.peer = peer; this.code = code; this.isHost = true; resolve(code); });
        peer.on('error', (err) => {
          if (err.type === 'unavailable-id' && tries < 4) { peer.destroy(); attempt(tries + 1); }
          else if (!this.peer) reject(err);
        });
        peer.on('connection', (conn) => {
          conn.on('open', () => {
            if (this.conns.size >= 3) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
            this.conns.set(conn.peer, conn);
            this.onJoin(conn.peer);
          });
          conn.on('data', (msg) => this.onMessage(msg, conn.peer));
          conn.on('close', () => { if (this.conns.delete(conn.peer)) this.onLeave(conn.peer); });
          conn.on('error', () => { if (this.conns.delete(conn.peer)) this.onLeave(conn.peer); });
        });
        peer.on('disconnected', () => peer.reconnect && !peer.destroyed && peer.reconnect());
      };
      attempt(0);
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      if (!this.available) return reject(new Error('Online play library failed to load (check your internet).'));
      const peer = new window.Peer({ debug: 0 });
      const timer = setTimeout(() => { reject(new Error('Could not reach that room. Check the code.')); peer.destroy(); }, 12000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true });
        conn.on('open', () => {
          clearTimeout(timer);
          this.peer = peer; this.code = code.trim().toUpperCase(); this.isHost = false;
          this.conns.set('host', conn);
          resolve();
        });
        conn.on('data', (msg) => this.onMessage(msg, 'host'));
        conn.on('close', () => this.onDisconnect());
        conn.on('error', () => this.onDisconnect());
      });
      peer.on('error', (err) => { clearTimeout(timer); reject(new Error(err.type === 'peer-unavailable' ? 'Room not found. Check the code.' : err.message || String(err))); });
    });
  }

  // Host: send to one guest (to) or everyone (except `except`). Guest: send to host.
  send(msg, to = null, except = null) {
    if (to) { const c = this.conns.get(to); if (c && c.open) c.send(msg); return; }
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
  }

  close() {
    for (const c of this.conns.values()) try { c.close(); } catch {}
    this.conns.clear();
    if (this.peer) try { this.peer.destroy(); } catch {}
    this.peer = null; this.isHost = false; this.code = null;
  }
}
