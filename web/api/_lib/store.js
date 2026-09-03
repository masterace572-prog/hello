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
const SUPABASE_TABLE = "viper_data";

/* ---------------- Supabase (Postgres via PostgREST) ---------------- */

function supabaseConfigured() {
  return Boolean(
    process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
  );
}

function supabaseHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };
}

function supabaseUrl(path, query) {
  const base = process.env.SUPABASE_URL.replace(/\/+$/, "");
  const url = new URL(`/rest/v1/${path}`, base);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

async function supabaseSeedOnce() {
  const res = await fetch(
    supabaseUrl(SUPABASE_TABLE),
    { method: "POST", headers: supabaseHeaders(), body: JSON.stringify({ id: 1, doc: seed() }) }
  );
  // 201 created, 409 already exists - both fine
}

async function supabaseGet() {
  const res = await fetch(
    supabaseUrl(SUPABASE_TABLE, { id: "eq.1", select: "doc" }),
    { headers: supabaseHeaders() }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase error (${res.status}) - did you run schema.sql? ${text.slice(0, 160)}`);
  }
  const rows = await res.json();
  if (Array.isArray(rows) && rows.length) return rows[0].doc;
  await supabaseSeedOnce().catch(() => {});
  const retry = await fetch(
    supabaseUrl(SUPABASE_TABLE, { id: "eq.1", select: "doc" }),
    { headers: supabaseHeaders() }
  );
  if (!retry.ok) throw new Error("Supabase seed failed");
  const retryRows = await retry.json();
  if (!Array.isArray(retryRows) || !retryRows.length) throw new Error("Supabase row missing after seed");
  return retryRows[0].doc;
}

async function supabaseSet(value) {
  const res = await fetch(
    supabaseUrl(SUPABASE_TABLE, { id: "eq.1" }),
    { method: "PATCH", headers: supabaseHeaders(), body: JSON.stringify({ doc: value }) }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase write failed (${res.status}) - ${text.slice(0, 160)}`);
  }
}

/* ---------------- Vercel KV (Upstash Redis) ------------------------ */

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
    const db = supabaseConfigured() ? await supabaseGet() : kvConfigured() ? await kvGet() : localGet();
    const current = db || seed();
    const next = mutator(JSON.parse(JSON.stringify(current)));
    if (supabaseConfigured()) await supabaseSet(next);
    else if (kvConfigured()) await kvSet(next);
    else localSet(next);
    return next;
  });
}

async function read() {
  const db = supabaseConfigured() ? await supabaseGet() : kvConfigured() ? await kvGet() : localGet();
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
      announcements: [],
      updates: {
        lib: { version: "1.0", url: "", changelog: "" },
        app: { version: "1.0", url: "", changelog: "", forced: true, minVersion: "1.0", enabled: false }
      }
    },
    keys: []
  };
}

function storageMode() {
  return supabaseConfigured() ? "supabase" : kvConfigured() ? "kv" : "local";
}

module.exports = {
  read,
  mutate,
  seed,
  storageMode,
  kvConfigured,
  supabaseConfigured
};
