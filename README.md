# 🔥 BurnChat

**Disposable chat rooms. Zero logs. No database. Gone.**

BurnChat is a self-hostable, ephemeral chat room service where messages exist only in server RAM. No database, no log files, no user accounts, no analytics. Create a room, share the link, chat, and hit the burn button — every message is wiped from memory in under 10 milliseconds.

**Live demo:** [burnchat.io](https://burnchat.io)

---

## Why?

Every major chat platform stores your messages permanently — even after you "delete" them:

- **Slack** keeps compliance exports your employer can download anytime
- **Teams** stores copies in a hidden Exchange folder called SubstrateHolds
- **Discord** files persist on their CDN after account deletion
- **WhatsApp** backups retain "deleted" messages; Meta keeps metadata forever

BurnChat takes the opposite approach: **we eliminated storage entirely.**

The most secure data is data that doesn't exist.

---

## Features

- 🔥 **Instant burn** — any participant can destroy the room in milliseconds
- 🔒 **Room passwords** — lock and unlock rooms on the fly
- 🔗 **Custom URLs** — `burnchat.io/your-room-name`
- 📷 **Image sharing** — compressed in browser, stored in RAM only
- ⚡ **Auto-burn** — room self-destructs when everyone leaves
- 🌓 **Day/night mode** — auto-detects by time of day
- 📊 **Admin panel** — aggregate stats only, zero PII

---

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/burnchat.git
cd burnchat
npm install
node server.js
```

Open `http://localhost:3000` in your browser. That's it.

### With a custom admin password and port:

```bash
ADMIN_PASS='your-secret' PORT=3001 node server.js
```

### With PM2 (production):

```bash
npm install -g pm2
ADMIN_PASS='your-secret' PORT=3001 pm2 start server.js --name burnchat
pm2 save
```

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Client                      │
│         Vanilla HTML/CSS/JS                  │
│         Socket.IO (polling)                  │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│               server.js                      │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │     const rooms = new Map()          │   │
│  │                                      │   │
│  │  Room {                              │   │
│  │    id, messages[], users Map,        │   │
│  │    password, autoburn, createdAt     │   │
│  │  }                                   │   │
│  │                                      │   │
│  │  ← Lives entirely in RAM             │   │
│  │  ← No disk writes                    │   │
│  │  ← No database driver installed      │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  Express + Socket.IO v4.5                    │
│  Node.js (v12+ compatible)                   │
└──────────────────────────────────────────────┘
```

### What happens when you hit burn:

1. Server sends `room-burned` signal to all connected users
2. Every socket connection is forcefully disconnected
3. All background timers (cleanup, expiry) are cancelled
4. Message array length set to zero — every reference removed
5. User map cleared — no record of who was in the room
6. Room deleted from the server registry
7. Garbage collector reclaims the freed memory

**Total time: under 10 milliseconds.**

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `ADMIN_PASS` | `changeme123` | Admin panel password |

### Internal limits (edit in `server.js`):

| Setting | Value |
|---------|-------|
| Max messages per room | 100 |
| Max message length | 2,000 chars |
| Max image size | 500 KB |
| Max username length | 24 chars |
| Max users per room | 50 |
| Room cleanup delay | 30 seconds |
| Room max age | 24 hours |

---

## Project Structure

```
burnchat/
├── server.js              # Entire backend (single file)
├── package.json
├── public/
│   ├── index.html         # Full SPA frontend
│   ├── admin.html         # Admin panel
│   ├── favicon.svg
│   ├── og-image.svg
│   ├── sitemap.xml
│   ├── robots.txt
│   └── blog/
│       ├── index.html
│       └── *.html         # Blog articles
└── deploy/
    ├── nginx-burnchat.conf
    └── burnchat.service
```

---

## Deployment

### Requirements

- Node.js 12+ (tested on 18 and 20)
- That's it. No database. No Redis. No build step.

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t burnchat .
docker run -p 3000:3000 -e ADMIN_PASS='your-secret' burnchat
```

### Reverse Proxy

See `deploy/nginx-burnchat.conf` for a ready-to-use Nginx configuration with WebSocket/polling support.

---

## API

### Public

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/burn-count` | GET | Total rooms burned |

### Admin (requires `?pw=ADMIN_PASS`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin-burnchat/api/stats` | GET | Full server statistics |
| `/admin-burnchat/api/reset` | POST | Reset all statistics |

---

## What BurnChat Doesn't Do

- **No E2E encryption (yet)** — messages pass through the server. We're zero-storage, not zero-knowledge.
- **Can't prevent screenshots** — we guarantee we don't keep data, not that every participant is trustworthy.
- **Not a Signal replacement** — BurnChat is for one-time conversations that should disappear.
- **Server operator trust** — self-host to eliminate the trust question entirely.

---

## Security

Found a security issue? See [SECURITY.md](SECURITY.md) for responsible disclosure.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE)

---

## Links

- **Website:** [burnchat.io](https://burnchat.io)
- **Blog:** [burnchat.io/blog](https://burnchat.io/blog)
- **Twitter/X:** [@burnchatio](https://x.com/burnchatio)

---

*The most secure data is data that doesn't exist.*
