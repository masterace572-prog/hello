"use strict";

const auth = require("../_lib/auth");
const store = require("../_lib/store");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    auth.json(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const authed = auth.isAuthed(req);
  await store.read().catch(() => null);

  auth.json(res, 200, {
    ok: true,
    authed,
    defaultPassword: authed && auth.usesDefaultPassword(),
    storageMode: store.storageMode(),
    hasKv: store.kvConfigured()
  });
};
