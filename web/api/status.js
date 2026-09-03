"use strict";

/**
 * Public status endpoint: maintenance flag, message, enabled
 * announcements and the current update configuration (lib zip + app apk).
 * The Android client reads this on launch.
 */

const store = require("./_lib/store");
const auth = require("./_lib/auth");
const core = require("./_lib/core");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    auth.json(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const db = await store.read();
    const s = core.effectiveSettings(db.settings || {});
    const announcements = s.announcements
      .filter((a) => a.enabled)
      .map((a) => ({ id: a.id, title: a.title, body: a.body, createdAt: a.createdAt }));

    auth.json(res, 200, {
      ok: true,
      maintenance: s.maintenance,
      maintenanceMessage: s.maintenanceMessage,
      announcements,
      updates: s.updates
    });
  } catch (err) {
    auth.json(res, 500, { ok: false, error: "Status unavailable", reason: err.message });
  }
};
