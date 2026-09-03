"use strict";

/**
 * Persistent storage adapter.
 *
 * Production (Vercel): uses Upstash Redis REST API via the standard
 * KV_REST_API_URL / KV_REST_API_TOKEN environment variables that the
 * Vercel KV integration provides. Zero SDK dependencies.
 *
 * Local / vercel dev: falls back to a JSON file in data/db.json.
 * File storage is NOT persistent across serverless instances - use KV
 * (or the local `vercel dev` server) for real deployments.
 */

const fs = require("fs");
const path = require("path");

const DB_KEY = "viper_db_v1";

function kvConfigured() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvGet() {
  const url = `${process.env.KV_REST_API_URL}/get/${DB_KEY}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  if (!res.ok) throw new Error(`KV get failed (${res.status})`);
  const json = await res.json();
  if (!json || typeof json.result !== "string") return null;
  return JSON.parse(json.result);
}

async function kvSet(value) {
  const url = `${process.env.KV_REST_API_URL}/set/${DB_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "text/plain"
    },
    body: JSON.stringify(value)
  });
  if (!res.ok) throw new Error(`KV set failed (${res.status})`);
}

function localFile() {
  return path.join(__dirname, "..", "..", "data", "db.json");
}

function localGet() {
  try {
    const raw = fs.readFileSync(localFile(), "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function localSet(value) {
  fs.mkdirSync(path.dirname(localFile()), { recursive: true });
  fs.writeFileSync(localFile(), JSON.stringify(value, null, 2), "utf8");
}

/** Round-trip read-modify-write with a serialized in-process queue. */
let queue = Promise.resolve();

function withLock(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function mutate(mutator) {
  return withLock(async () => {
    const db = kvConfigured() ? await kvGet() : localGet();
    const current = db || seed();
    const next = mutator(JSON.parse(JSON.stringify(current)));
    if (kvConfigured()) await kvSet(next);
    else localSet(next);
    return next;
  });
}

async function read() {
  const db = kvConfigured() ? await kvGet() : localGet();
  return db || seed();
}

function seed() {
  return {
    version: 1,
    settings: {
      maintenance: false,
      maintenanceMessage: "Server is under maintenance. Please try again later.",
      licenseSecret: "Vm8Lk7Uj2JmsjCPVPVjrLa7zgfx3uz9E",
      downloadUrl: "",
      versionUrl: "",
      announcements: []
    },
    keys: []
  };
}

function storageMode() {
  return kvConfigured() ? "kv" : "local";
}

module.exports = { read, mutate, seed, storageMode, kvConfigured };
