# DineFlow API

Render deploy target for the DineFlow backend.

Required environment variables:

- `DATABASE_URL` - Neon PostgreSQL connection string
- `FRONTEND_ORIGIN` - Vercel frontend URL, e.g. `https://your-app.vercel.app`
- `PORT` - supplied by Render automatically

Local run:

```bash
cd server
npm install
npm run dev
```