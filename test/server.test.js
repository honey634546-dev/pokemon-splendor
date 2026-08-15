/* ECS WebSocket adapter test — run: node test/server.test.js */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../server/index.js');

function client(url) {
  const queue = [];
  const waiters = [];
  const ws = new WebSocket(url);
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (err) { return; }
    const waiter = waiters.findIndex((w) => !w.predicate || w.predicate(msg));
    if (waiter >= 0) {
      const w = waiters.splice(waiter, 1)[0];
      clearTimeout(w.timer);
      w.resolve(msg);
    } else queue.push(msg);
  });
  return {
    ws,
    open: new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }),
    next(predicate, timeout = 3000) {
      const index = queue.findIndex((msg) => !predicate || predicate(msg));
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = waiters.findIndex((w) => w.timer === timer);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error('timed out waiting for WebSocket message'));
        }, timeout);
        waiters.push({ predicate, resolve, reject, timer });
      });
    },
    close() {
      return new Promise((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.once('close', resolve);
        ws.close();
      });
    },
  };
}

async function closeApp(app) {
  await new Promise((resolve) => app.stop(resolve));
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemon-splendor-rooms-'));
  const app = createServer({ host: '127.0.0.1', port: 0, dataDir });
  app.start();
  await new Promise((resolve) => app.server.once('listening', resolve));
  const port = app.server.address().port;
  const url = `ws://127.0.0.1:${port}/room/TEST1/ws`;
  const a = client(url), b = client(url);
  await Promise.all([a.open, b.open]);

  a.ws.send(JSON.stringify({ t: 'join', name: 'Alice', token: 'tA' }));
  b.ws.send(JSON.stringify({ t: 'join', name: 'Bob', token: 'tB' }));
  assert.strictEqual((await a.next((m) => m.t === 'welcome')).seat, 0);
  assert.strictEqual((await b.next((m) => m.t === 'welcome')).seat, 1);
  a.ws.send(JSON.stringify({ t: 'start', opts: {} }));
  const stateA = await a.next((m) => m.t === 'state');
  const stateB = await b.next((m) => m.t === 'state');
  assert.strictEqual(stateA.state.viewerId, 0);
  assert.strictEqual(stateB.state.viewerId, 1);
  assert.ok(stateA.state.decks.stage1.every((id) => id === null), 'deck order is redacted');
  const health = JSON.parse(await new Promise((resolve) => {
    const req = require('http').get(`http://127.0.0.1:${port}/healthz`, (res) => {
      let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve(body));
    });
    req.on('error', (err) => resolve(JSON.stringify({ error: err.message })));
  }));
  assert.strictEqual(health.ok, true);

  await Promise.all([a.close(), b.close()]);
  await closeApp(app);
  assert.ok(fs.existsSync(path.join(dataDir, 'TEST1.json')), 'room snapshot was written');

  const restored = createServer({ host: '127.0.0.1', port: 0, dataDir });
  restored.start();
  await new Promise((resolve) => restored.server.once('listening', resolve));
  const c = client(`ws://127.0.0.1:${restored.server.address().port}/room/TEST1/ws`);
  await c.open;
  c.ws.send(JSON.stringify({ t: 'join', name: 'Alice', token: 'tA' }));
  assert.strictEqual((await c.next((m) => m.t === 'welcome')).seat, 0);
  assert.strictEqual((await c.next((m) => m.t === 'state')).state.viewerId, 0);
  await c.close();
  await closeApp(restored);
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('ECS WebSocket adapter tests passed.');
})().catch((err) => {
  console.error(err.stack || err);
  process.exitCode = 1;
});
