# 阿里云 ECS 部署

本项目的 ECS 联机服务由 `server/index.js` 提供，Nginx 负责静态文件和 WebSocket 反向代理。页面与 WebSocket 使用同一域名，因此无需修改 `js/net.js`。

## 1. 准备目录和依赖

以下示例假设项目部署到 `/var/www/pokemon-splendor`，ECS 已安装 Node.js 18+、Nginx，并已将域名解析到 ECS。

```bash
cd /var/www/pokemon-splendor
npm ci
sudo mkdir -p /var/lib/pokemon-splendor/rooms
sudo chown -R nginx:nginx /var/lib/pokemon-splendor
```

先直接检查服务：

```bash
HOST=127.0.0.1 PORT=8787 npm start
curl http://127.0.0.1:8787/healthz
```

应返回类似 `{"ok":true,"rooms":0}`。服务只监听本机地址，不应直接暴露 8787 端口。

## 2. 配置 systemd

将 `deploy/systemd/pokemon-splendor.service` 复制到 `/etc/systemd/system/`。如果 `which node` 与服务文件中的路径不同，修改 `ExecStart` 使用实际路径：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pokemon-splendor
sudo systemctl status pokemon-splendor
```

查看日志：

```bash
journalctl -u pokemon-splendor -f
```

## 3. 配置 Nginx

复制 `deploy/nginx/pokemon-splendor.conf` 到 Nginx 配置目录，替换 `server_name` 和 `root`：

```bash
sudo cp deploy/nginx/pokemon-splendor.conf /etc/nginx/conf.d/pokemon-splendor.conf
sudo nginx -t
sudo systemctl reload nginx
```

配置 HTTPS 后，浏览器会自动把 WebSocket 连接升级为 `wss://`。阿里云安全组只需开放 `80`、`443`；不要开放 `8787`。

## 4. 验收

打开两个浏览器窗口创建并加入同一房间，确认可以开始游戏、轮流行动和刷新重连。房间快照位于 `/var/lib/pokemon-splendor/rooms/`，服务重启后会自动恢复。该版本适合单 ECS、单 Node 实例；多实例部署需要共享存储或 Redis/数据库。
