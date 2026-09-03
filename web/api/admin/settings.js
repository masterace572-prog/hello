"use strict";

const auth = require("../_lib/auth");
const core = require("../_lib/core");

module.exports = async function handler(req, res) {
  if (!auth.requireAuth(req, res)) return;

  const method = req.method;
  const url = new URL(req.url, "http://localhost");
  const action = url.searchParams.get("action") || "get";
  const body = req.body || {};

  try {
    if (method === "GET" && action === "get") {
      auth.json(res, 200, { ok: true, settings: await core.getSettings() });
      return;
    }

    // POST ?action=update -> maintenance, message, urls, lib/app updates
    if (method === "POST" && action === "update") {
      const settings = await core.updateSettings({
        maintenance: body.maintenance,
        maintenanceMessage: body.maintenanceMessage,
        downloadUrl: body.downloadUrl,
        versionUrl: body.versionUrl,
        updates: {
          libVersion: body.libVersion,
          libUrl: body.libUrl,
          libChangelog: body.libChangelog,
          appVersion: body.appVersion,
          apkUrl: body.apkUrl,
          appChangelog: body.appChangelog,
          appForced: body.appForced,
          appMinVersion: body.appMinVersion,
          appEnabled: body.appEnabled
        }
      });
      auth.json(res, 200, { ok: true, settings });
      return;
    }

    // POST ?action=announcement-add  { title, body }
    if (method === "POST" && action === "announcement-add") {
      const item = await core.addAnnouncement({ title: body.title, body: body.body });
      auth.json(res, 200, { ok: true, announcement: item });
      return;
    }

    // POST ?action=announcement-update  { id, title?, body?, enabled? }
    if (method === "POST" && action === "announcement-update") {
      const item = await core.updateAnnouncement(String(body.id || ""), {
        title: body.title,
        body: body.body,
        enabled: body.enabled
      });
      if (!item) {
        auth.json(res, 404, { ok: false, error: "Announcement not found." });
        return;
      }
      auth.json(res, 200, { ok: true, announcement: item });
      return;
    }

    // POST ?action=announcement-delete  { id }
    if (method === "POST" && action === "announcement-delete") {
      const found = await core.deleteAnnouncement(String(body.id || ""));
      if (!found) {
        auth.json(res, 404, { ok: false, error: "Announcement not found." });
        return;
      }
      auth.json(res, 200, { ok: true });
      return;
    }

    auth.json(res, 404, { ok: false, error: "Unknown action." });
  } catch (err) {
    auth.json(res, 500, { ok: false, error: "Server error: " + err.message });
  }
};
