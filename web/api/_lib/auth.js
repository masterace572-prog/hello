"use strict";

/**
 * Stateless admin session using an HMAC-signed cookie.
 * No external auth service required.
 */

const crypto = require("crypto");

const COOKIE_NAME = "viper_session";
const SESSION_HOURS = 12;

function adminPassword() {
  return process.env.ADMIN_PASSWORD || "viper-admin";
}

function usesDefaultPassword() {
  return !process.env.ADMIN_PASSWORD;
}

function secret() {
  return process.env.SESSION_SECRET || crypto.createHash("sha256").update(`viper-secret::${adminPassword()}`).digest("hex");
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function createToken() {
  const payload = b64url(
    JSON.stringify({
      exp: Date.now() + SESSION_HOURS * 3600 * 1000,
      nonce: crypto.randomBytes(12).toString("hex")
    })
  );
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch (_) {
    return false;
  }
}

function cookieHeader() {
  const maxAge = SESSION_HOURS * 3600;
  return `${COOKIE_NAME}=${createToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`;
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

function readCookie(req) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function isAuthed(req) {
  return verifyToken(readCookie(req));
}

function requireAuth(req, res) {
  if (!isAuthed(req)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
    return false;
  }
  return true;
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** Binary-safe body reader (for file uploads). */
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = {
  adminPassword,
  usesDefaultPassword,
  createToken,
  verifyToken,
  cookieHeader,
  clearCookieHeader,
  isAuthed,
  requireAuth,
  json,
  readBody,
  readRawBody
};
