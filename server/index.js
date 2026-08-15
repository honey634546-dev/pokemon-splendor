const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { RoomManager } = require('./room-manager.js');

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const MAX_CONNECTIONS_PER_ROOM = 16;
const MAX_MESSAGE_BYTES = 8192;

function rejectUpgrade(socket, status, message) {
  const body = `${message}\n`;
  socket.write(
    `HTTP/1.1 ${status} Error\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  );
  socket.destroy();
}

function createServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? DEFAULT_PORT);
  const host = options.host || process.env.HOST || DEFAULT_HOST;
  const maxConnections = Number(options.maxConnections ?? process.env.MAX_CONNECTIONS_PER_ROOM ?? MAX_CONNECTIONS_PER_ROOM);
  const maxMessageBytes = Number(options.maxMessageBytes ?? process.env.MAX_MESSAGE_BYTES ?? MAX_MESSAGE_BYTES);
  const roomManager = options.roomManager || new RoomManager({
    dataDir: options.dataDir || process.env.ROOM_DATA_DIR,
    maxSeats: 4,
    send: (entry, connId, msg) => {
      const ws = entry.connections.get(connId);
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    },
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxMessageBytes });
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      const body = JSON.stringify({ ok: true, rooms: roomManager.rooms.size });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found\n');
  });

  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    } catch (err) {
      rejectUpgrade(socket, 400, 'Bad request');
      return;
    }
    const match = pathname.match(/^\/room\/([A-Za-z0-9_-]{1,32})\/ws$/);
    if (!match) {
      rejectUpgrade(socket, 404, 'WebSocket endpoint not found');
      return;
    }

    const code = match[1].toUpperCase();
    const entry = roomManager.get(code);
    if (entry.connections.size >= maxConnections) {
      rejectUpgrade(socket, 503, 'Room is full');
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const connId = crypto.randomUUID();
      let detached = false;
      entry.connections.set(connId, ws);

      const detach = () => {
        if (detached) return;
        detached = true;
        try { roomManager.disconnect(entry, connId); } catch (err) { console.error(`[rooms] disconnect ${code}:`, err); }
        entry.connections.delete(connId);
      };

      ws.on('message', (data) => {
        const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
        if (raw.length > maxMessageBytes) return;
        let msg;
        try { msg = JSON.parse(raw.toString('utf8')); } catch (err) { return; }
        if (!msg || typeof msg.t !== 'string') return;
        if (msg.t === 'ping') {
          if (ws.readyState === 1) ws.send('{"t":"pong"}');
          return;
        }
        try {
          roomManager.handle(entry, connId, msg);
        } catch (err) {
          console.error(`[rooms] message ${code}:`, err);
          if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'reject', reason: '服务器处理失败' }));
        }
      });
      ws.on('close', detach);
      ws.on('error', detach);
    });
  });

  return {
    server,
    wss,
    roomManager,
    start(callback) { server.listen(port, host, callback); },
    stop(callback) {
      roomManager.persistAll();
      for (const ws of wss.clients) ws.close(1001, 'server shutdown');
      wss.close(() => server.close(callback));
    },
  };
}

if (require.main === module) {
  const app = createServer();
  app.start(() => {
    const address = app.server.address();
    console.log(`[server] WebSocket listening on ${address.address}:${address.port}`);
    console.log(`[server] health check: http://${address.address}:${address.port}/healthz`);
  });
  const shutdown = (signal) => {
    console.log(`[server] ${signal}, saving rooms and shutting down`);
    app.stop(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { createServer };
