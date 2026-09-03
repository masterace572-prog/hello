"use strict";

/**
 * Business logic for license management and activation.
 * Kept pure so it can be unit-tested without a serverless runtime.
 */

const crypto = require("crypto");
const store = require("./store");

const KEY_PREFIX = "VPR";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars

function randomBlock(len) {
  let out = "";
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function generateKey() {
  return `${KEY_PREFIX}-${randomBlock(4)}-${randomBlock(4)}-${randomBlock(4)}`;
}

function normalizeKey(raw) {
  return String(raw || "").trim().toUpperCase();
}

function now() {
  return Date.now();
}

/* ---------------- Updates config defaults (lib + app) ---------------- */

const DEFAULT_UPDATES = {
  lib: { version: "1.0", url: "", changelog: "" },
  app: { version: "1.0", url: "", changelog: "", forced: true, minVersion: "1.0", enabled: false }
};

function effectiveSettings(raw) {
  const s = raw || {};
  const storedLib = (s.updates && s.updates.lib) || {};
  const storedApp = (s.updates && s.updates.app) || {};
  return {
    maintenance: Boolean(s.maintenance),
    maintenanceMessage: s.maintenanceMessage || "Server is under maintenance. Please try again later.",
    licenseSecret: s.licenseSecret || "Vm8Lk7Uj2JmsjCPVPVjrLa7zgfx3uz9E",
    announcements: Array.isArray(s.announcements) ? s.announcements : [],
    downloadUrl: s.downloadUrl || "",
    versionUrl: s.versionUrl || "",
    updates: {
      lib: {
        version: storedLib.version || DEFAULT_UPDATES.lib.version,
        url: storedLib.url || "",
        changelog: storedLib.changelog || ""
      },
      app: {
        version: storedApp.version || DEFAULT_UPDATES.app.version,
        url: storedApp.url || "",
        changelog: storedApp.changelog || "",
        forced: storedApp.forced === undefined ? DEFAULT_UPDATES.app.forced : Boolean(storedApp.forced),
        minVersion: storedApp.minVersion || DEFAULT_UPDATES.app.minVersion,
        enabled: Boolean(storedApp.enabled)
      }
    }
  };
}

/** Simple dotted version compare: returns true when a < b */
function versionLt(a, b) {
  const pa = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va < vb;
  }
  return false;
}

function addDurationDays(days) {
  return new Date(now() + days * 24 * 3600 * 1000).toISOString();
}

/** Format expiry the way the native client expects: yyyy-MM-dd HH:mm:ss */
function formatExp(iso, tzOffsetMinutes) {
  const d = iso ? new Date(iso) : new Date(2099, 11, 31, 23, 59, 59);
  if (!Number.isFinite(d.getTime())) return "2099-12-31 23:59:59";
  if (tzOffsetMinutes && Number.isFinite(tzOffsetMinutes)) {
    const shifted = new Date(d.getTime() + tzOffsetMinutes * 60000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(
      shifted.getUTCHours()
    )}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes()
  )}:${pad(d.getUTCSeconds())}`;
}

function md5(s) {
  return crypto.createHash("md5").update(s, "utf8").digest("hex");
}

function publicKeyShape(key) {
  return {
    id: key.id,
    key: key.key,
    createdAt: key.createdAt,
    expiresAt: key.expiresAt,
    deviceLimit: key.deviceLimit,
    note: key.note || "",
    status: key.status,
    devices: (key.devices || []).map((d) => ({ serial: d.serial, model: d.model || "", lastSeen: d.lastSeen })),
    lastSeen: key.lastSeen || null
  };
}

/**
 * App activation - must match the native client contract exactly:
 *   POST /server  (application/x-www-form-urlencoded)
 *   game=PUBG&user_key=<KEY>&serial=<HWID>
 *
 * Success:
 *   { "status": true, "data": { "EXP": "yyyy-MM-dd HH:mm:ss",
 *                               "token": md5("PUBG-<KEY>-<HWID>-<SECRET>"),
 *                               "rng": <unix seconds> } }
 * Failure:
 *   { "status": false, "reason": "<message>" }
 */
async function activate({ userKey, serial, tz, appVersion }) {
  const key = normalizeKey(userKey);
  // Device serials are opaque (lowercase UUIDs on Android). They must be
  // hashed byte-exact as sent, so never case-normalize them.
  const device = String(serial || "").trim();

  if (!key || !device) return { status: false, reason: "Missing key or device identifier." };

  const tzOffset = tz !== undefined && tz !== null && tz !== "" ? parseInt(tz, 10) : null;

  let outcome = null;

  await store.mutate((db) => {
    const settings = effectiveSettings(db.settings || {});

    if (settings.maintenance) {
      outcome = { status: false, reason: settings.maintenanceMessage || "Server is under maintenance." };
      return db;
    }

    // Old-version shutdown: when an app update is pushed and the client is
    // below the required minimum version, activation is rejected so the old
    // APK can no longer be used.
    const appConfig = settings.updates.app;
    if (
      appConfig.enabled &&
      appConfig.url &&
      String(appVersion || "").length > 0 &&
      versionLt(appVersion, appConfig.minVersion)
    ) {
      outcome = { status: false, reason: "Update required. Please install the latest version of the app to continue." };
      return db;
    }

    const record = (db.keys || []).find((k) => k.key === key);
    if (!record) {
      outcome = { status: false, reason: "Invalid license key." };
      return db;
    }

    if (record.status === "disabled") {
      outcome = { status: false, reason: "This license is disabled." };
      return db;
    }

    if (record.expiresAt && new Date(record.expiresAt).getTime() < now()) {
      outcome = { status: false, reason: "License expired." };
      return db;
    }

    const devices = record.devices || (record.devices = []);
    const limit = Number(record.deviceLimit) || 0; // 0 = unlimited

    let owned = devices.find((d) => d.serial === device);
    if (!owned && limit > 0 && devices.length >= limit) {
      outcome = { status: false, reason: "Device limit reached. Contact support to reset your HWID." };
      return db;
    }

    if (!owned) {
      devices.push({ serial: device, model: "", lastSeen: new Date().toISOString() });
    } else {
      owned.lastSeen = new Date().toISOString();
    }
    record.lastSeen = new Date().toISOString();

    const token = md5(`PUBG-${record.key}-${device}-${settings.licenseSecret || "Vm8Lk7Uj2JmsjCPVPVjrLa7zgfx3uz9E"}`);
    outcome = {
      status: true,
      data: {
        EXP: formatExp(record.expiresAt, tzOffset),
        token,
        rng: Math.floor(Date.now() / 1000)
      }
    };
    return db;
  });

  return outcome;
}

async function createKey({ durationDays, deviceLimit, note }) {
  const created = {
    id: crypto.randomUUID(),
    key: generateKey(),
    createdAt: new Date().toISOString(),
    expiresAt: durationDays && Number(durationDays) > 0 ? addDurationDays(Number(durationDays)) : null,
    deviceLimit: Number(deviceLimit) >= 0 ? Number(deviceLimit) : 1,
    note: String(note || "").slice(0, 200),
    status: "active",
    devices: [],
    lastSeen: null
  };

  await store.mutate((db) => {
    db.keys.unshift(created);
    return db;
  });

  return publicKeyShape(created);
}

async function listKeys({ q = "", filter = "all" } = {}) {
  const db = await store.read();
  const query = String(q).trim().toLowerCase();
  let keys = db.keys || [];

  keys = keys.filter((k) => {
    if (filter === "active" && !(k.status === "active" && (!k.expiresAt || new Date(k.expiresAt) > new Date())))
      return false;
    if (filter === "disabled" && k.status !== "disabled") return false;
    if (filter === "expired" && !(k.expiresAt && new Date(k.expiresAt) <= new Date())) return false;
    if (query && !(k.key.toLowerCase().includes(query) || (k.note || "").toLowerCase().includes(query)))
      return false;
    return true;
  });

  return { keys: keys.map(publicKeyShape) };
}

async function updateKey(id, changes) {
  let updated = null;
  await store.mutate((db) => {
    const record = (db.keys || []).find((k) => k.id === id);
    if (!record) return db;
    if (changes.deviceLimit !== undefined) record.deviceLimit = Math.max(0, Number(changes.deviceLimit) || 0);
    if (changes.note !== undefined) record.note = String(changes.note).slice(0, 200);
    if (changes.status !== undefined) record.status = changes.status === "active" ? "active" : "disabled";
    if (changes.expiresAt !== undefined) {
      record.expiresAt = changes.expiresAt === "" || changes.expiresAt === "never" ? null : new Date(changes.expiresAt).toISOString();
    }
    updated = publicKeyShape(record);
    return db;
  });
  return updated;
}

async function resetHwid(id, serial) {
  let removed = null;
  await store.mutate((db) => {
    const record = (db.keys || []).find((k) => k.id === id);
    if (!record) return db;
    if (serial) {
      record.devices = (record.devices || []).filter((d) => d.serial !== String(serial || "").trim());
    } else {
      record.devices = [];
    }
    removed = true;
    return db;
  });
  return removed;
}

async function deleteKey(id) {
  let found = false;
  await store.mutate((db) => {
    const before = (db.keys || []).length;
    db.keys = (db.keys || []).filter((k) => k.id !== id);
    found = db.keys.length < before;
    return db;
  });
  return found;
}

async function deleteExpired() {
  let count = 0;
  await store.mutate((db) => {
    const before = (db.keys || []).length;
    db.keys = (db.keys || []).filter((k) => !(k.expiresAt && new Date(k.expiresAt).getTime() < now()));
    count = before - db.keys.length;
    return db;
  });
  return count;
}

async function stats() {
  const db = await store.read();
  const keys = db.keys || [];
  const nowMs = now();
  const active = keys.filter((k) => k.status === "active" && (!k.expiresAt || new Date(k.expiresAt).getTime() > nowMs));
  const disabled = keys.filter((k) => k.status === "disabled");
  const expired = keys.filter((k) => k.expiresAt && new Date(k.expiresAt).getTime() <= nowMs);
  const devices = keys.reduce((sum, k) => sum + (k.devices || []).length, 0);

  return {
    totalKeys: keys.length,
    activeKeys: active.length,
    disabledKeys: disabled.length,
    expiredKeys: expired.length,
    devicesInUse: devices,
    maintenance: Boolean(db.settings && db.settings.maintenance),
    storageMode: store.storageMode()
  };
}

async function getSettings() {
  const db = await store.read();
  const s = effectiveSettings(db.settings || {});
  return {
    maintenance: s.maintenance,
    maintenanceMessage: s.maintenanceMessage,
    announcements: s.announcements.map((a) => ({ ...a })),
    downloadUrl: s.downloadUrl,
    versionUrl: s.versionUrl,
    updates: s.updates
  };
}

async function updateSettings(changes) {
  await store.mutate((db) => {
    const s = db.settings || (db.settings = {});
    if (changes.maintenance !== undefined) s.maintenance = Boolean(changes.maintenance);
    if (changes.maintenanceMessage !== undefined) s.maintenanceMessage = String(changes.maintenanceMessage).slice(0, 500);
    if (changes.downloadUrl !== undefined) s.downloadUrl = String(changes.downloadUrl).slice(0, 1000);
    if (changes.versionUrl !== undefined) s.versionUrl = String(changes.versionUrl).slice(0, 1000);

    // Updates (lib zip + app apk) - merged with defaults so old DB rows work
    if (changes.updates) {
      const u = s.updates || (s.updates = {});
      const lib = u.lib || (u.lib = {});
      const app = u.app || (u.app = {});
      const upd = changes.updates;
      if (upd.libVersion !== undefined) lib.version = String(upd.libVersion || "").slice(0, 40);
      if (upd.libUrl !== undefined) lib.url = String(upd.libUrl || "").slice(0, 2000);
      if (upd.libChangelog !== undefined) lib.changelog = String(upd.libChangelog || "").slice(0, 2000);
      if (upd.appVersion !== undefined) app.version = String(upd.appVersion || "").slice(0, 40);
      if (upd.apkUrl !== undefined) app.url = String(upd.apkUrl || "").slice(0, 2000);
      if (upd.appChangelog !== undefined) app.changelog = String(upd.appChangelog || "").slice(0, 4000);
      if (upd.appForced !== undefined) app.forced = Boolean(upd.appForced);
      if (upd.appMinVersion !== undefined) app.minVersion = String(upd.appMinVersion || "1.0").slice(0, 40);
      if (upd.appEnabled !== undefined) app.enabled = Boolean(upd.appEnabled);
    }
    return db;
  });
  return getSettings();
}

async function addAnnouncement({ title, body }) {
  const item = {
    id: crypto.randomUUID(),
    title: String(title || "").slice(0, 120),
    body: String(body || "").slice(0, 2000),
    enabled: true,
    createdAt: new Date().toISOString()
  };
  await store.mutate((db) => {
    const s = db.settings || (db.settings = {});
    s.announcements = s.announcements || [];
    s.announcements.unshift(item);
    return db;
  });
  return item;
}

async function updateAnnouncement(id, changes) {
  let item = null;
  await store.mutate((db) => {
    const s = db.settings || (db.settings = {});
    const list = s.announcements || (s.announcements = []);
    const record = list.find((a) => a.id === id);
    if (!record) return db;
    if (changes.title !== undefined) record.title = String(changes.title).slice(0, 120);
    if (changes.body !== undefined) record.body = String(changes.body).slice(0, 2000);
    if (changes.enabled !== undefined) record.enabled = Boolean(changes.enabled);
    item = { ...record };
    return db;
  });
  return item;
}

async function deleteAnnouncement(id) {
  let found = false;
  await store.mutate((db) => {
    const s = db.settings || (db.settings = {});
    const before = (s.announcements || []).length;
    s.announcements = (s.announcements || []).filter((a) => a.id !== id);
    found = s.announcements.length < before;
    return db;
  });
  return found;
}

module.exports = {
  generateKey,
  normalizeKey,
  formatExp,
  md5,
  effectiveSettings,
  activate,
  createKey,
  listKeys,
  updateKey,
  resetHwid,
  deleteKey,
  deleteExpired,
  stats,
  getSettings,
  updateSettings,
  addAnnouncement,
  updateAnnouncement,
  deleteAnnouncement
};
