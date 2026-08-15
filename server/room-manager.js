const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Room: RoomAuthority } = require('../js/room.js');
const DB = require('../data/cards.json');
const MEGA_DB = require('../data/megas.json');
const POKEMART_DB = require('../data/pokemart.json');

class SnapshotStore {
  constructor(dir) {
    this.dir = path.resolve(dir || path.join(process.cwd(), '.runtime', 'rooms'));
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  fileFor(code) {
    return path.join(this.dir, `${code}.json`);
  }

  load(code) {
    const file = this.fileFor(code);
    if (!fs.existsSync(file)) return null;
    try {
      const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
      return snap && typeof snap === 'object' ? snap : null;
    } catch (err) {
      console.error(`[rooms] ignoring unreadable snapshot ${file}: ${err.message}`);
      return null;
    }
  }

  save(code, snapshot) {
    const file = this.fileFor(code);
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
  }
}

class RoomManager {
  constructor({ dataDir, send, maxSeats = 4 } = {}) {
    this.store = new SnapshotStore(dataDir);
    this.send = send || (() => {});
    this.maxSeats = maxSeats;
    this.rooms = new Map();
  }

  get(code) {
    let entry = this.rooms.get(code);
    if (entry) return entry;

    entry = { code, connections: new Map(), authority: null };
    entry.authority = new RoomAuthority({
      cardDB: DB,
      megaDB: MEGA_DB,
      pokemartDB: POKEMART_DB,
      maxSeats: this.maxSeats,
      send: (connId, msg) => this.send(entry, connId, msg),
    });

    const snapshot = this.store.load(code);
    if (snapshot) entry.authority.restore(snapshot);
    this.rooms.set(code, entry);
    return entry;
  }

  persist(entry) {
    try {
      this.store.save(entry.code, entry.authority.snapshot());
    } catch (err) {
      console.error(`[rooms] failed to persist ${entry.code}: ${err.stack || err.message}`);
    }
  }

  persistAll() {
    for (const entry of this.rooms.values()) this.persist(entry);
  }

  handle(entry, connId, msg) {
    entry.authority.now = Date.now();
    entry.authority.onMessage(connId, msg);
    // All state-changing protocol messages are cheap to snapshot and must
    // survive an ECS process restart. sync/ping are read-only.
    if (['join', 'start', 'action', 'takeover'].includes(msg.t)) this.persist(entry);
  }

  disconnect(entry, connId) {
    entry.authority.now = Date.now();
    entry.authority.leave(connId);
    this.persist(entry);
  }
}

module.exports = { RoomManager, SnapshotStore };
