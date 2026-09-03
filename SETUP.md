# Viper Cheat — Complete Setup Guide

Full step-by-step to deploy the license server + admin panel on Vercel
with **Supabase** as the database, then point the Android app to it.

---

## Part 0 — What you have

| Item | Where |
|---|---|
| Admin panel + license server | `web/` in this repo |
| Android app | `app/` in this repo |
| Build workflow | `.github/workflows/android-build.yml` |
| Supabase schema | `web/supabase/schema.sql` |

---

## Part 1 — Merge the changes to `main` (recommended)

The branch `arena/01a06776-hello` contains everything:

- Clean minimal app UI
- Crash fix
- `web/` license server + admin panel
- Build workflow
- Supabase support

**To bring it to main:**
1. Open: https://github.com/masterace572-prog/hello/pull/1
2. Click **Merge pull request** → **Confirm merge**
3. Click **Delete branch** (optional but clean)

> If you prefer to keep working on the branch and test first, skip this
> and proceed — just point Vercel at `arena/01a06776-hello` instead of
> `main`. (See Part 2 note.)

---

## Part 2 — Deploy on Vercel

1. Go to https://vercel.com → **Add New → Project**
2. **Import** the `masterace572-prog/hello` repository
3. **Root Directory** → select **`web`**
4. **Framework Preset** → **Other** (no build command needed)
5. Click **Deploy**

> **Branch note:** In Vercel's project settings (Settings → Git →
> Production Branch) the default is `main`. Set it to
> `arena/01a06776-hello` if you skipped the merge in Part 1.

---

## Part 3 — Create the Supabase database

1. Go to https://supabase.com → **Sign up / Sign in**
2. **New project**:
   - Name: anything (e.g. `viper`)
   - Database password: strong password (keep it safe)
   - Region: closest to you
   - Plan: **Free** is fine
3. Wait ~2 minutes for the project to be ready
4. In Supabase left menu → **SQL Editor** → **New query**
5. Paste the full contents of [`web/supabase/schema.sql`](https://github.com/masterace572-prog/hello/blob/arena/01a06776-hello/web/supabase/schema.sql) — or use the commands below:

```sql
create table if not exists public.viper_data (
  id integer primary key,
  doc jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.viper_data (id, doc)
values (
  1,
  '{
    "version": 1,
    "settings": {
      "maintenance": false,
      "maintenanceMessage": "Server is under maintenance. Please try again later.",
      "licenseSecret": "Vm8Lk7Uj2JmsjCPVPVjrLa7zgfx3uz9E",
      "downloadUrl": "",
      "versionUrl": "",
      "announcements": []
    },
    "keys": []
  }'::jsonb
)
on conflict (id) do nothing;

alter table public.viper_data enable row level security;
revoke all on table public.viper_data from anon;
revoke all on table public.viper_data from authenticated;
grant all on table public.viper_data to service_role;
```

6. Click **Run**
7. Verify: **Table Editor** → you should see `viper_data` with 1 row

---

## Part 4 — Get Supabase keys

1. Supabase left menu → **Project Settings** (gear icon)
2. Go to **API**
3. Copy these two:
   - **Project URL** → e.g. `https://xxxx.supabase.co`
   - **service_role** key → long string starting with `eyJ...`

> ⚠️ Keep the `service_role` key private. NEVER put it in frontend code
> or commit it. It stays only in Vercel's env settings.

---

## Part 5 — Add environment variables to Vercel

1. Vercel → your project (from Part 2) → **Settings → Environment Variables**
2. Add all three:

| Name | Value |
|---|---|
| `ADMIN_PASSWORD` | your admin panel password |
| `SUPABASE_URL` | your Project URL from Part 4 |
| `SUPABASE_SERVICE_ROLE_KEY` | your service_role key from Part 4 |

3. Click **Save**
4. Deploy again (Redeploy) so the variables take effect:
   - **Deployments** tab → ⋯ (three dots) → **Redeploy**

---

## Part 6 — Verify the site works

1. Open `https://<your-project>.vercel.app/`
2. Login with your `ADMIN_PASSWORD`
3. On the **Overview** page, check the sidebar badge:
   - ✅ `Storage: Supabase` (green) = production DB connected
   - ⚠️ `Storage: file (local only)` (yellow) = env vars not applied yet
4. Create a test license key:
   - **Keys** → **Create key** → Duration: 30 days → Device limit: 1 → Create
   - Copy the key (shown once)
5. Toggle **Settings → Maintenance mode** and test that app login is blocked
6. Toggle it off again

---

## Part 7 — Point the Android app to this server

The endpoint is hardcoded in the native source:
`app/src/main/jni/main.cpp` (around line 193):

```cpp
sprintf(lol, oxorany("https://ryzencheat.authapi.xyz/server"));
```

Change to your server URL:

```cpp
sprintf(lol, oxorany("https://YOUR-PROJECT.vercel.app/server"));
```

Then commit — the GitHub Actions workflow auto-builds a new APK:

1. GitHub → **Actions** → **Android Build** → latest run
2. Wait for green
3. Scroll to **Artifacts** → download **app-debug-apk**
4. Install on your phone

---

## Part 8 — Optional: host the game package on Vercel too

The app downloads a package (`DIE.zip`) from a URL hardcoded in
`app/src/main/jni/main.cpp`:

```cpp
// version file
const char *versionUrl = (oxorany("https://github.com/AkhilRyzen/Ryzen/releases/download/Ryzen/version.txt"));
// package
const char *downloadUrl = (oxorany("https://github.com/AkhilRyzen/Ryzen/releases/download/Ryzen/hb.zip"));
```

To host on Vercel:
1. Put `DIE.zip` into `web/public/files/`
2. Update `version.txt` in `web/public/files/` to match the package version
3. Point the app to:
   ```
   https://YOUR-PROJECT.vercel.app/files/version.txt
   https://YOUR-PROJECT.vercel.app/files/DIE.zip
   ```

The app only re-downloads when the version string changes.

---

## How the pieces talk

```
Android app (native Check in main.cpp)
   │  POST /server  (game=PUBG&user_key=...&serial=HWID)
   ▼
Vercel serverless (web/api/server.js)
   │  reads/writes single JSON doc
   ▼
Supabase (viper_data table)
   ▲
Admin panel (web/public) ──▶ /api/admin/* (cookie session)
   └── create keys, HWID reset, maintenance, announcements, delete expired
```

### What is handled where

| Feature | Admin panel (web) | App behavior |
|---|---|---|
| Create keys / duration / device limit | ✅ | ✅ enforced at login |
| Device (HWID) binding | ✅ view + reset | ✅ auto-binds on login |
| Disable / delete / bulk delete expired | ✅ | ✅ enforced at login |
| Maintenance mode | ✅ toggle + message | ⚠️ shows as "Login failed: <message>" (not pretty yet) |
| Announcements | ✅ create/toggle/delete | ❌ not shown in app yet |
| Download / version URLs | ✅ configure | ⚠️ app uses hardcoded URLs (needs rebuild) |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Storage badge shows "file (local only)" | Add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, redeploy |
| Site says Supabase error / table missing | Re-run `web/supabase/schema.sql` in Supabase SQL Editor |
| App says "Invalid license key" | Key must be created in the panel; check case (keys are uppercase) |
| App says "Device limit reached" | Reset HWID for that key in the panel |
| App says maintenance message | Turn off Maintenance in Settings, or edit the message |
| Login shows old failure text | Make sure the app was rebuilt after changing `main.cpp` |
| App can't reach server | URL must be `https://...` exactly, no trailing slash issues |
