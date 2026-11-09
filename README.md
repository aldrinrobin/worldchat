# 🌍 World Chat

A secure, real-time global chat room that anyone can join instantly. No signup, no passwords, no cost.

## Features

- **Instant Access**: Just enter a display name and start chatting
- **Real-Time**: Messages appear instantly for all connected users using WebSockets
- **Secure**: Built with security-first principles (XSS protection, rate limiting, input validation)
- **Zero Cost**: Runs entirely on free hosting tiers with in-memory storage
- **Mobile-First**: Responsive design with automatic dark mode support
- **Connection Resilience**: Automatic reconnection with status indicators
- **Message History**: New joiners see the last 50 messages
- **User Presence**: Live "who's online" list and join/leave notifications

## Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: Vanilla JavaScript (no frameworks, no build step)
- **Storage**: In-memory (no database required)
- **Security**: Helmet, rate limiting, input validation, CSP headers

## Local Setup

### Prerequisites

- Node.js 18+ installed
- npm or yarn

### Installation

1. Clone or download this repository

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

4. (Optional) Edit `.env` to customize settings

5. Start the server:
   ```bash
   npm start
   ```

6. Open your browser to `http://localhost:3000`

### Development Mode

For auto-restart on file changes:
```bash
npm run dev
```

### Running Tests

```bash
npm test
```

## Free Deployment

The app is designed to run on free hosting tiers. Here are step-by-step instructions for **Render** (recommended):

### Deploy to Render (Free Tier)

1. **Create a Render account** at [render.com](https://render.com) (free)

2. **Create a new Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub repository (or use "Public Git repository" with this repo URL)
   - Configure:
     - **Name**: `world-chat` (or your choice)
     - **Environment**: `Node`
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
     - **Instance Type**: `Free`

3. **Set environment variables** in Render dashboard:
   ```
   NODE_ENV=production
   ALLOWED_ORIGINS=https://your-app-name.onrender.com
   ```
   Replace `your-app-name` with your actual Render app URL.

4. **Deploy**: Click "Create Web Service"

5. **Wait 2-3 minutes** for the build and deployment to complete

6. **Visit your app** at `https://your-app-name.onrender.com`

**Note**: Render's free tier spins down after 15 minutes of inactivity, so the first request after idle time will take ~30 seconds to wake up.

### Alternative: Deploy to Railway (Free Tier)

1. Create account at [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Railway auto-detects Node.js and deploys
5. Add environment variables in the "Variables" tab:
   ```
   NODE_ENV=production
   ALLOWED_ORIGINS=https://${{RAILWAY_PUBLIC_DOMAIN}}
   ```
6. Your app will be live at the generated Railway domain

### Alternative: Deploy to Fly.io (Free Tier)

1. Install Fly CLI: [fly.io/docs/hands-on/install-flyctl](https://fly.io/docs/hands-on/install-flyctl/)
2. Sign up: `fly auth signup`
3. Launch app: `fly launch` (follow prompts, select free tier)
4. Set secrets:
   ```bash
   fly secrets set NODE_ENV=production
   fly secrets set ALLOWED_ORIGINS=https://your-app-name.fly.dev
   ```
5. Deploy: `fly deploy`

## Security Checklist

✅ **XSS Protection**:
- All user content rendered with `textContent` (never `innerHTML`)
- Strict Content-Security-Policy via Helmet
- Input validation on both client and server

✅ **Input Validation**:
- Names: 2-20 characters, alphanumeric + spaces/underscores/hyphens only
- Messages: 1-500 characters, no empty/whitespace-only
- Names must be unique among online users
- Payload size limit: 2KB per socket message

✅ **Rate Limiting**:
- Max 5 messages per 5 seconds per connection
- Automatic 30-second mute for violators
- Per-IP connection limits (max 5 simultaneous)

✅ **Secure Headers**:
- Helmet middleware with HSTS, CSP, X-Frame-Options
- CORS restricted to allowed origins
- Socket.IO origin validation

✅ **Server-Side Authority**:
- Server decides sender name from session state
- Clients cannot impersonate other users
- All validation happens server-side

✅ **Abuse Protection**:
- Configurable bad-word filter
- Report button for flagging inappropriate content
- Connection limits per IP address

✅ **Privacy**:
- No user data stored beyond in-memory buffer
- No cookies or tracking
- No IP logging (only used transiently for connection limits)
- No authentication = no password breaches

✅ **Dependencies**:
- Minimal dependency footprint
- `npm audit` shows 0 vulnerabilities
- All dependencies from trusted sources

✅ **Error Handling**:
- Try-catch blocks around all socket handlers
- Invalid input never crashes the server
- Graceful handling of malformed payloads

## Configuration

Environment variables (`.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins |
| `RATE_LIMIT_MAX` | `5` | Max messages per window |
| `RATE_LIMIT_WINDOW_MS` | `5000` | Rate limit window (ms) |
| `RATE_LIMIT_MUTE_MS` | `30000` | Mute duration for spammers (ms) |
| `MAX_CONNECTIONS_PER_IP` | `5` | Max simultaneous connections per IP |
| `MAX_SOCKET_PAYLOAD` | `2048` | Max socket message size (bytes) |

## Project Structure

```
world-chat/
├── server.js              # Express + Socket.IO server
├── public/
│   ├── index.html        # Single-page UI
│   ├── style.css         # Responsive styles with dark mode
│   └── app.js            # Client-side Socket.IO logic
├── test/
│   ├── validation.test.js # Input validation tests
│   └── rateLimit.test.js  # Rate limiter tests
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## How It Works

1. **Client connects** → Socket.IO establishes WebSocket connection
2. **User enters name** → Server validates, checks uniqueness, registers user
3. **Join success** → Server sends last 50 messages, broadcasts join notification
4. **User sends message** → Server validates, rate-checks, broadcasts to all
5. **User disconnects** → Server broadcasts leave notification, updates user list

All state is in-memory:
- `messageHistory`: Array of last 50 messages
- `users`: Map of socketId → user data
- `rateLimitMap`: Map of socketId → rate limit counters
- `ipConnections`: Map of IP → Set of socket IDs

## Future Improvements

These features could be added but are **not implemented** to keep the initial version simple:

- **Multiple Rooms**: Let users create/join different chat channels
- **Moderation Tools**: Admin roles, kick/ban, message deletion
- **Persistent Storage**: Optional integration with free Supabase/Postgres tier for message history
- **User Avatars**: Auto-generated avatar images or emoji selection
- **Message Reactions**: Emoji reactions to messages
- **Typing Indicators**: Show when someone is typing
- **Direct Messages**: Private 1-on-1 conversations
- **File Sharing**: Image uploads via free CDN (Cloudinary free tier)
- **Read Receipts**: Show who has seen messages
- **Internationalization**: Multi-language UI support

## Testing the Security

### Test XSS Protection

1. Try entering `<script>alert(1)</script>` as your name → Rejected by validation
2. Try sending `<img src=x onerror=alert(1)>` as a message → Renders as harmless text

### Test Rate Limiting

1. Send 6+ messages rapidly → You'll be muted for 30 seconds
2. System shows warning toast notification

### Test Duplicate Names

1. Open app in two browser tabs
2. Join with the same name in both → Second attempt is rejected

### Test Input Validation

1. Name with `<` or `>` → Rejected
2. Name with only 1 character → Rejected
3. Empty message → Send button does nothing
4. 501+ character message → Rejected by validation

## Troubleshooting

**Port already in use**:
```bash
# Change PORT in .env or kill the process using port 3000
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux:
lsof -ti:3000 | xargs kill -9
```

**Socket.IO connection fails**:
- Check that `ALLOWED_ORIGINS` includes your domain
- Verify firewall isn't blocking WebSocket connections
- Check browser console for CORS errors

**Deployment issues**:
- Ensure `NODE_ENV=production` is set
- Verify `ALLOWED_ORIGINS` matches your deployment URL (including https://)
- Check hosting platform logs for errors

## License

MIT - Free to use, modify, and deploy.

---

Built with ❤️ for secure, accessible real-time communication.
