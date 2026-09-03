"use strict";

const auth = require("../_lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    auth.json(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  res.setHeader("Set-Cookie", auth.clearCookieHeader());
  auth.json(res, 200, { ok: true });
};
