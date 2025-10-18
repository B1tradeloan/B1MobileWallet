# B1 Mobile Wallet — Backend (GitHub-ready)

This repository is GitHub-ready and intended for direct deployment to Render / Railway / Heroku.

## What it contains
- `server.js` — Express server with authentication, sessions, file upload and admin endpoints
- `db.js` — SQLite helpers and seeded admin account
- `uploads/` — (created at runtime) for receipt files
- `data/` — (created at runtime) for SQLite DB and session store

## Quick start (local)
1. Copy `.env.example` to `.env` and set a strong `SESSION_SECRET`.
2. Install:
   ```bash
   npm install
   ```
3. Start:
   ```bash
   npm start
   ```

## Deploying to Render
1. Create a new Web Service in Render, connect GitHub repo.
2. Build command: `npm install`
3. Start command: `npm start`
4. Set environment variable `SESSION_SECRET` in Render dashboard.
5. Make sure `data/` and `uploads/` are persisted (use a volume or object storage for production).

## Security notes
- Change the seeded admin password immediately after deployment.
- Use HTTPS and set secure cookies in production.
- Consider moving receipts to S3/GCS and database to a managed DB.
