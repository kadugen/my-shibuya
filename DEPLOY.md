# Deploying My Shibuya to shibuya.asherdesign.com

This guide takes the app from your laptop to a public URL your friends can use,
each connecting their own Spotify account. Your domain stays at Hostinger; the
app runs on a free Node host (Render) and you point a subdomain at it.

There are three parties involved:
- **Render** — runs the Node server (free).
- **Hostinger** — where `asherdesign.com` lives; you add one DNS record.
- **Spotify Developer Dashboard** — where you register the redirect URL and add
  friends (Development Mode allows up to 25 users).

---

## Step 1 — Put the code in a GitHub repo

Render deploys from GitHub.

```bash
cd "my-shibuya"
git init
git add .
git commit -m "My Shibuya"
```

Create an empty repo on github.com, then:

```bash
git remote add origin https://github.com/<you>/my-shibuya.git
git branch -M main
git push -u origin main
```

`.env` is gitignored, so your secrets are NOT uploaded — you'll set them in
Render's dashboard instead (Step 2).

## Step 2 — Deploy on Render

1. Go to https://render.com, sign up, and click **New → Web Service**.
2. Connect your GitHub and pick the `my-shibuya` repo.
3. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Under **Environment**, add these variables (from your `.env`):
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - `COOKIE_SECRET`  (the long random string)
   - `NODE_ENV` = `production`
   - `REDIRECT_URI` = `https://shibuya.asherdesign.com/callback`
   - (Do **not** set `PORT` — Render provides it.)
5. Click **Create Web Service**. You'll get a URL like
   `https://my-shibuya.onrender.com`. Confirm it loads.

> Free instances sleep after ~15 min idle; the first visit then takes ~30s to
> wake. Fine for personal/friends use.

## Step 3 — Point shibuya.asherdesign.com at Render

1. In Render: **Settings → Custom Domains → Add** `shibuya.asherdesign.com`.
   Render shows you a target value (a `CNAME`, e.g. `my-shibuya.onrender.com`).
2. In Hostinger: **Domains → asherdesign.com → DNS / Nameservers**, add a record:
   - **Type:** CNAME
   - **Name / Host:** `shibuya`
   - **Points to / Target:** the value Render gave you
   - **TTL:** default
3. Wait for DNS to propagate (minutes to an hour). Render will auto-issue a free
   HTTPS certificate once it sees the record. Your main `asherdesign.com` site is
   untouched.

## Step 4 — Register the redirect URL with Spotify

1. https://developer.spotify.com/dashboard → your app → **Settings**.
2. Under **Redirect URIs**, add:
   `https://shibuya.asherdesign.com/callback`
   (keep `http://127.0.0.1:3000/callback` too, for local dev.)
3. Save.

## Step 5 — Add your friends (Development Mode)

By default a Spotify app is in Development Mode: only users you list can log in
(max 25).

1. Dashboard → your app → **User Management**.
2. Add each friend's **name + the email on their Spotify account**.
3. They can then open `https://shibuya.asherdesign.com`, connect Spotify, and
   enter their own Shibuya history (stored in their own browser).

> Want more than 25 users, or to skip the manual list? Apply for **Extended
> Quota Mode** in the dashboard — it's a short review by Spotify.

---

## Making it a phone app (PWA)

On your phone, open `https://shibuya.asherdesign.com` in Safari/Chrome →
**Share → Add to Home Screen**. It launches full-screen with its own icon (the
app already ships the required PWA meta tags).

## Local development

```bash
cp .env.example .env   # fill in values
npm install
npm start              # http://127.0.0.1:3000
```

Keep `NODE_ENV=development` locally so cookies work over plain HTTP.
