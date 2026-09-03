"use strict";

const auth = require("../_lib/auth");
const core = require("../_lib/core");

module.exports = async function handler(req, res) {
  if (!auth.requireAuth(req, res)) return;

  const method = req.method;
  const url = new URL(req.url, "http://localhost");
  const action = url.searchParams.get("action") || "list";
  const body = req.body || {};

  try {
    // GET /api/admin/keys?action=list&q=...&filter=...
    if (method === "GET" && action === "list") {
      const result = await core.listKeys({ q: url.searchParams.get("q") || "", filter: url.searchParams.get("filter") || "all" });
      auth.json(res, 200, { ok: true, ...result });
      return;
    }

    if (method === "GET" && action === "stats") {
      auth.json(res, 200, { ok: true, ...(await core.stats()) });
      return;
    }

    // POST /api/admin/keys?action=create
    if (method === "POST" && action === "create") {
      const key = await core.createKey({
        durationDays: body.durationDays,
        deviceLimit: body.deviceLimit,
        note: body.note
      });
      auth.json(res, 200, { ok: true, key });
      return;
    }

    if (method === "POST" && action === "update") {
      const key = await core.updateKey(String(body.id || ""), {
        deviceLimit: body.deviceLimit,
        note: body.note,
        status: body.status,
        expiresAt: body.expiresAt
      });
      if (!key) {
        auth.json(res, 404, { ok: false, error: "Key not found." });
        return;
      }
      auth.json(res, 200, { ok: true, key });
      return;
    }

    // POST /api/admin/keys?action=reset-hwid  { id, serial? }
    if (method === "POST" && action === "reset-hwid") {
      const done = await core.resetHwid(String(body.id || ""), body.serial || undefined);
      if (!done) {
        auth.json(res, 404, { ok: false, error: "Key not found." });
        return;
      }
      auth.json(res, 200, { ok: true });
      return;
    }

    // POST /api/admin/keys?action=delete  { id }
    if (method === "POST" && action === "delete") {
      const found = await core.deleteKey(String(body.id || ""));
      if (!found) {
        auth.json(res, 404, { ok: false, error: "Key not found." });
        return;
      }
      auth.json(res, 200, { ok: true });
      return;
    }

    // POST /api/admin/keys?action=delete-expired
    if (method === "POST" && action === "delete-expired") {
      const count = await core.deleteExpired();
      auth.json(res, 200, { ok: true, deleted: count });
      return;
    }

    auth.json(res, 404, { ok: false, error: "Unknown action." });
  } catch (err) {
    auth.json(res, 500, { ok: false, error: "Server error: " + err.message });
  }
};
