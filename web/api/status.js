"use strict";

/**
 * Public status endpoint: maintenance flag, message and enabled
 * announcements. Useful for future in-app display; maintenance state
 * is also enforced directly inside /server during activation.
 */

const store = require("./_lib/store");
const auth = require("./_lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    auth.json(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const db = await store.read();
  const s = db.settings || {};
  const announcements = (s.announcements || [])
    .filter((a) => a.enabled)
    .map((a) => ({ id: a.id, title: a.title, body: a.body, createdAt: a.createdAt }));

  auth.json(res, 200, {
    ok: true,
    maintenance: Boolean(s.maintenance),
    maintenanceMessage: s.maintenanceMessage || "",
    announcements
  });
};
