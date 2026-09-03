"use strict";

const auth = require("../_lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    auth.json(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const body = req.body || {};
  const password = typeof body.password === "string" ? body.password : "";

  if (password !== auth.adminPassword()) {
    auth.json(res, 401, { ok: false, error: "Incorrect password." });
    return;
  }

  res.setHeader("Set-Cookie", auth.cookieHeader());
  auth.json(res, 200, { ok: true, defaultPassword: auth.usesDefaultPassword() });
};
