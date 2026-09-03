# Viper Cheat — License Server & Admin Panel

Zero-dependency Vercel project that is wire-compatible with the Android
client's native activation call. Deploy the `web/` directory of this
repository to Vercel.

## What it does

- **App activation** — `POST /server` accepts exactly what the client
  sends (`game=PUBG&user_key=<KEY>&serial=<HWID>`) and returns the exact
  JSON the native code expects (`status`, `data.EXP`, `data.token`,
  `data.rng`). No app-side protocol changes needed.
- **Admin panel** — create / delete / edit keys, choose expiry duration
  and device limit, view and reset HWIDs per key, delete expired keys in
  bulk, disable keys.
- **Server management** — maintenance mode with custom message (blocks
  activations), announcements, optional package download URL and
  version URL configuration.
- **Public status** — `GET /api/status` returns maintenance state and
  active announcements for future in-app display.

## Deploy to Vercel

1. Push this repo to GitHub (already done for `masterace572-prog/hello`).
2. In Vercel: **Add New → Project → Import** this repository.
3. In **Root Directory**, select **`web`**.
4. Framework preset: **Other**. Keep the default build settings (no
   build command is needed; Vercel deploys `public/` + `api/`).
5. **Environment Variables** (Settings → Environment Variables):

   | Name | Value | Required |
   |---|---|---|
   | `ADMIN_PASSWORD` | your admin password | Yes — change from default |
   | `KV_REST_API_URL` | set automatically by the KV integration | With KV |
   | `KV_REST_API_TOKEN` | set automatically by the KV integration | With KV |
   | `SESSION_SECRET` | random string for session signing | Recommended |

6. **Storage** (only if you want persistent production data): Store →
   Create → **Vercel KV** (or Upstash Redis) and connect it to the
   project. It injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`
   automatically.
   - Without KV, the API falls back to `web/data/db.json`. That works in
     `vercel dev` and for local testing, but serverless instances do not
     persist files — use KV in production.
7. Deploy. Your admin panel: `https://<project>.vercel.app/`
   Sign in with `ADMIN_PASSWORD`.

## Point the Android app to this server

The endpoint the client calls is hardcoded in
`app/src/main/jni/main.cpp`:

```cpp
sprintf(lol, oxorany("https://ryzencheat.authapi.xyz/server"));
```

Change it to your deployment:

```cpp
sprintf(lol, oxorany("https://YOUR-PROJECT.vercel.app/server"));
```

Then commit and the repo's GitHub Actions workflow rebuilds the APK
automatically. (Optionally, to make license expiry timezone-accurate,
append `serial`'s timezone in the same POST body:

```cpp
sprintf(data, oxorany("game=PUBG&user_key=%s&serial=%s&tz=%d"), user_key, UUID.c_str(), offsetMinutes);
```

The server understands `tz` (minutes east of UTC), and ignores it when
absent. Without it, expiry timestamps are formatted in UTC.)

Also point the game package at this site (optional):

- Put `DIE.zip` in `web/public/files/` (see `files/README.txt`).
- Update `Downtwo::Version()` and `Downtwo::Link()` URLs in
  `app/src/main/jni/main.cpp` to
  `https://YOUR-PROJECT.vercel.app/files/version.txt` and
  `.../files/DIE.zip`.

## API reference (public)

### `POST /server`
```
Content-Type: application/x-www-form-urlencoded
game=PUBG&user_key=VPR-XXXX-XXXX-XXXX&serial=<hwid>&tz=<minutes>
```
Success: `{ "status": true, "data": { "EXP": "yyyy-MM-dd HH:mm:ss", "token": "<md5>", "rng": 1234567890 } }`
Failure: `{ "status": false, "reason": "..." }`

### `GET /api/status`
```
{ "ok": true, "maintenance": false, "maintenanceMessage": "", "announcements": [...] }
```

## API reference (admin, cookie session)

All under `/api/admin/`:

- `POST login` `{ password }` → sets `viper_session` cookie (12h)
- `POST logout`
- `GET session`
- `GET keys?action=list&q=&filter=all|active|expired|disabled`
- `POST keys?action=create` `{ durationDays, deviceLimit, note }`
- `POST keys?action=update` `{ id, deviceLimit?, status?, note?, expiresAt? }`
- `POST keys?action=reset-hwid` `{ id, serial? }` (no serial = all)
- `POST keys?action=delete` `{ id }`
- `POST keys?action=delete-expired`
- `GET keys?action=stats`
- `GET settings?action=get`
- `POST settings?action=update` `{ maintenance, maintenanceMessage, downloadUrl, versionUrl }`
- `POST settings?action=announcement-add` `{ title, body }`
- `POST settings?action=announcement-update` `{ id, title?, body?, enabled? }`
- `POST settings?action=announcement-delete` `{ id }`

## Local development

```bash
cd web
vercel dev
# admin: http://localhost:3000  password: ADMIN_PASSWORD or "viper-admin"
```

The API was unit-tested locally against the exact client contract
(token MD5, rng freshness, device-limit enforcement, maintenance mode).
