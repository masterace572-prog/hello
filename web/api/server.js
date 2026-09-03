"use strict";

/**
 * App activation endpoint.
 * The Android client POSTs:
 *   Content-Type: application/x-www-form-urlencoded
 *   game=PUBG&user_key=<KEY>&serial=<HWID>&tz=<minutes offset (optional)>
 *
 * Response contract is fixed by the native client (app/src/main/jni/main.cpp):
 *   success -> { "status": true,  "data": { "EXP": "...", "token": "...", "rng": 123 } }
 *   failure -> { "status": false, "reason": "..." }
 */

const auth = require("./_lib/auth");
const core = require("./_lib/core");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    auth.json(res, 405, { status: false, reason: "Method not allowed." });
    return;
  }

  let body = req.body;
  try {
    if (!body || typeof body === "string") {
      const raw = typeof body === "string" ? body : await auth.readBody(req);
      body = Object.fromEntries(new URLSearchParams(raw));
    }
  } catch (err) {
    auth.json(res, 400, { status: false, reason: "Invalid request." });
    return;
  }

  const result = await core.activate({
    userKey: body.user_key,
    serial: body.serial,
    tz: body.tz,
    appVersion: body.app_version
  });

  auth.json(res, 200, result);
};
