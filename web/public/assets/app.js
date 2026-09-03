"use strict";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

function toast(message, kind = "") {
  const box = el("div", { class: `toast ${kind}`, text: message });
  $("#toast-root").append(box);
  setTimeout(() => {
    box.style.opacity = "0";
    box.style.transition = "opacity 0.25s ease";
    setTimeout(() => box.remove(), 260);
  }, 2600);
}

async function api(path, options = {}) {
  const opts = { credentials: "same-origin", ...options };
  if (opts.body && typeof opts.body === "object") {
    opts.headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (_) { /* ignore */ }
  if (!res.ok || (data && data.ok === false)) {
    const message = (data && (data.error || data.reason)) || "Request failed.";
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const ICONS = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>'
};

function iconBtn(name, title, onClick, danger = false) {
  return el("button", {
    class: `icon-btn${danger ? " danger" : ""}`,
    title,
    html: ICONS[name] || "",
    onclick: onClick
  });
}

function fmtDate(iso) {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard", "ok");
  } catch (_) {
    toast("Copy failed", "err");
  }
}

/* ------------------------------------------------------------------ */
/* Modal system                                                        */
/* ------------------------------------------------------------------ */

function openModal(title, sub, contentNodes, actions = [], large = false) {
  const root = $("#modal-root");
  root.innerHTML = "";
  const modal = el("div", { class: `modal${large ? " modal-lg" : ""}` }, [
    el("h3", { text: title }),
    sub ? el("p", { class: "modal-sub", text: sub }) : null,
    ...contentNodes,
    actions.length ? el("div", { class: "modal-actions" }, actions) : null
  ].filter(Boolean));
  const backdrop = el("div", { class: "modal-backdrop" }, [modal]);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });
  root.append(backdrop);
  return modal;
}

function closeModal() {
  $("#modal-root").innerHTML = "";
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

let session = { authed: false, storageMode: "local", defaultPassword: false };

async function refreshSession() {
  const data = await api("/api/admin/session");
  session = { ...session, ...data };
  return session;
}

function showLogin() {
  $("#view-app").classList.add("hidden");
  $("#view-login").classList.remove("hidden");
  setTimeout(() => $("#login-password").focus(), 50);
}

function showApp() {
  $("#view-login").classList.add("hidden");
  $("#view-app").classList.remove("hidden");
  const badge = $("#storage-badge");
  if (session.storageMode === "kv") {
    badge.textContent = "Storage: Vercel KV";
    badge.className = "storage-badge";
  } else {
    badge.textContent = "Storage: file (local only)";
    badge.className = "storage-badge warn";
  }
}

/* ------------------------------------------------------------------ */
/* Login / logout                                                      */
/* ------------------------------------------------------------------ */

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("#login-error");
  error.classList.add("hidden");
  const button = $("#login-form button");
  button.disabled = true;
  try {
    await api("/api/admin/login", { method: "POST", body: { password: $("#login-password").value } });
    await refreshSession();
    showApp();
    navigate(currentView);
  } catch (err) {
    error.textContent = err.message;
    error.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});

$("#logout-btn").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST", body: {} }); } catch (_) {}
  session.authed = false;
  showLogin();
});

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

const TITLES = { overview: "Overview", keys: "Keys", announcements: "Announcements", settings: "Settings" };
let currentView = "overview";

function navigate(view) {
  currentView = view;
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#page-title").textContent = TITLES[view] || "Admin";
  $("#page-actions").innerHTML = "";
  const renders = { overview: renderOverview, keys: renderKeys, announcements: renderAnnouncements, settings: renderSettings };
  (renders[view] || renderOverview)();
}

$$(".nav-item").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.view)));

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

async function renderOverview() {
  const content = $("#page-content");
  content.innerHTML = '<div class="empty">Loading...</div>';

  const [stats, settings] = await Promise.all([
    api("/api/admin/keys?action=stats"),
    api("/api/admin/settings?action=get")
  ]);

  const notices = [];
  if (session.defaultPassword || !session.storageMode) {
    notices.push(el("div", { class: "notice", html: '<strong>Default admin password is in use.</strong> Set the <code>ADMIN_PASSWORD</code> environment variable in Vercel before going live.' }));
  }
  if (session.storageMode !== "kv") {
    notices.push(el("div", { class: "notice", html: '<strong>File storage is active.</strong> Data is only persisted while running locally. Add Vercel KV (Storage tab) for production persistence.' }));
  }
  if (settings.settings.maintenance) {
    notices.push(el("div", { class: "notice", html: '<strong>Maintenance mode is ON.</strong> All activations are rejected until you turn it off.' }));
  }

  const stat = (label, value, cls = "") =>
    el("div", { class: `stat ${cls}` }, [el("div", { class: "value", text: String(value) }), el("div", { class: "label", text: label })]);

  content.innerHTML = "";
  content.append(
    ...notices,
    el("div", { class: "stats-grid" }, [
      stat("Total keys", stats.totalKeys, "accent"),
      stat("Active", stats.activeKeys, "success"),
      stat("Disabled", stats.disabledKeys),
      stat("Expired", stats.expiredKeys, stats.expiredKeys > 0 ? "danger" : ""),
      stat("Devices in use", stats.devicesInUse)
    ]),
    el("div", { class: "card" }, [
      el("h3", { text: "Server details" }),
      el("p", { class: "card-sub", text: "Where to point the Android client." }),
      el("div", { class: "field" }, [
        el("span", { text: "Activation endpoint (app uses /server)" }),
        el("input", { class: "input mono", readonly: "", value: `${location.origin}/server` })
      ]),
      el("div", { class: "field" }, [
        el("span", { text: "API base for future in-app status" }),
        el("input", { class: "input mono", readonly: "", value: `${location.origin}/api/status` })
      ]),
      el("div", { class: "field" }, [
        el("span", { text: "Maintenance mode" }),
        el("input", { class: "input", readonly: "", value: settings.settings.maintenance ? "ON - activations blocked" : "OFF" })
      ])
    ])
  );
}

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

let keyFilter = "all";
let keyQuery = "";

async function renderKeys() {
  const content = $("#page-content");
  content.innerHTML = '<div class="empty">Loading...</div>';

  const toolbar = el("div", { class: "toolbar" }, [
    el("input", { class: "input search", placeholder: "Search key or note", value: keyQuery, oninput: (e) => { keyQuery = e.target.value; debouncedKeys(); } }),
    el("div", { class: "filters" },
      ["all", "active", "expired", "disabled"].map((f) =>
        el("button", { class: `filter-chip${keyFilter === f ? " active" : ""}`, text: f[0].toUpperCase() + f.slice(1), onclick: () => { keyFilter = f; renderKeys(); } })
      )
    ),
    el("button", { class: "btn btn-danger btn-sm", text: "Delete expired", onclick: deleteExpiredAction }),
    el("div", { class: "spacer" }),
    el("button", { class: "btn btn-primary", html: `${ICONS.plus} Create key`, onclick: () => openCreateKey() })
  ]);

  let data;
  try {
    data = await api(`/api/admin/keys?action=list&filter=${encodeURIComponent(keyFilter)}&q=${encodeURIComponent(keyQuery)}`);
  } catch (err) {
    content.innerHTML = "";
    content.append(toolbar, el("div", { class: "empty", text: err.message }));
    return;
  }

  content.innerHTML = "";
  content.append(toolbar);

  if (!data.keys.length) {
    content.append(el("div", { class: "card" }, [el("div", { class: "empty", text: "No keys found." })]));
    return;
  }

  const table = el("table", {}, [
    el("thead", {}, [
      el("tr", {}, ["Key", "Status", "Expires", "Devices", "Note", ""].map((h) => el("th", { text: h })))
    ]),
    el("tbody", {}, data.keys.map((k) => keyRow(k)))
  ]);
  content.append(el("div", { class: "table-wrap" }, [table]));
}

let debounce;
function debouncedKeys() {
  clearTimeout(debounce);
  debounce = setTimeout(renderKeys, 300);
}

function badgeFor(key) {
  const now = Date.now();
  if (key.status === "disabled") return el("span", { class: "badge err", text: "Disabled" });
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= now) return el("span", { class: "badge warn", text: "Expired" });
  return el("span", { class: "badge ok", text: "Active" });
}

function keyRow(k) {
  const devicesTxt = `${k.devices.length} / ${k.deviceLimit === 0 ? "∞" : k.deviceLimit}`;
  const row = el("tr", {}, [
    el("td", {}, [
      el("div", { class: "key-cell" }, [
        el("span", { class: "key-text mono", text: k.key }),
        iconBtn("copy", "Copy key", () => copyText(k.key))
      ])
    ]),
    el("td", {}, [badgeFor(k)]),
    el("td", { class: "muted", text: k.expiresAt ? fmtDate(k.expiresAt) : "Never" }),
    el("td", { text: devicesTxt }),
    el("td", { class: "muted", text: k.note || "—" }),
    el("td", {}, [
      el("div", { class: "row-actions" }, [
        iconBtn("eye", "Details", () => openKeyDetails(k.id)),
        iconBtn("refresh", "Reset HWID", () => resetHwidAction(k)),
        iconBtn("trash", "Delete", () => deleteKeyAction(k), true)
      ])
    ])
  ]);
  return row;
}

function openCreateKey() {
  const duration = el("select", { class: "select" },
    [[7, "7 days"], [30, "30 days"], [60, "60 days"], [90, "90 days"], [180, "180 days"], [365, "365 days"], [0, "Never expires"]].map(([v, label]) =>
      el("option", { value: String(v), text: label })
    )
  );
  const limit = el("input", { class: "input", type: "number", min: "0", max: "50", value: "1" });
  const note = el("input", { class: "input", placeholder: "Optional note" });

  openModal(
    "Create license key",
    "The key is generated once. Copy it before closing.",
    [
      el("div", { class: "form-grid" }, [
        el("div", { class: "field" }, [el("span", { text: "Duration" }), duration]),
        el("div", { class: "field" }, [el("span", { text: "Device limit (0 = unlimited)" }), limit])
      ]),
      el("div", { class: "field" }, [el("span", { text: "Note" }), note])
    ],
    [
      el("button", { class: "btn btn-ghost", text: "Cancel", onclick: closeModal }),
      el("button", {
        class: "btn btn-primary", text: "Create key",
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            const res = await api("/api/admin/keys?action=create", {
              method: "POST",
              body: { durationDays: Number(duration.value), deviceLimit: Number(limit.value), note: note.value }
            });
            closeModal();
            toast("Key created", "ok");
            showCreatedKey(res.key.key);
            renderKeys();
          } catch (err) {
            toast(err.message, "err");
            e.target.disabled = false;
          }
        }
      })
    ]
  );
}

function showCreatedKey(key) {
  openModal(
    "Key created",
    "Save this key now. It cannot be shown again as plaintext later.",
    [
      el("div", { class: "field" }, [
        el("span", { text: "License key" }),
        el("input", { class: "input mono", readonly: "", value: key, onclick: (e) => e.target.select() })
      ])
    ],
    [
      el("button", { class: "btn btn-ghost", text: "Close", onclick: closeModal }),
      el("button", { class: "btn btn-primary", text: "Copy key", onclick: () => copyText(key) })
    ]
  );
}

async function openKeyDetails(id) {
  const data = await api(`/api/admin/keys?action=list&q=${encodeURIComponent(id)}`);
  const key = (data.keys || []).find((k) => k.id === id);
  if (!key) { toast("Key not found", "err"); return; }

  const deviceLimit = el("input", { class: "input", type: "number", min: "0", value: String(key.deviceLimit) });
  const note = el("input", { class: "input", value: key.note || "", placeholder: "Optional note" });
  const statusSelect = el("select", { class: "select" }, [
    el("option", { value: "active", text: "Active", selected: key.status === "active" ? "" : null }),
    el("option", { value: "disabled", text: "Disabled", selected: key.status === "disabled" ? "" : null })
  ]);
  const expires = el("input", {
    class: "input", type: "datetime-local",
    value: key.expiresAt ? new Date(key.expiresAt.getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "",
    placeholder: "Empty = never"
  });

  const deviceNodes = key.devices.length
    ? key.devices.map((d) =>
        el("div", { class: "device-row" }, [
          el("div", { class: "device-meta" }, [
            el("div", { class: "device-serial", text: d.serial }),
            el("div", { class: "device-time", text: `Last seen ${fmtDate(d.lastSeen)}${d.model ? " · " + d.model : ""}` })
          ]),
          el("button", {
            class: "btn btn-danger btn-sm", text: "Remove",
            onclick: async () => {
              await api("/api/admin/keys?action=reset-hwid", { method: "POST", body: { id, serial: d.serial } });
              toast("Device removed", "ok");
              closeModal();
              renderKeys();
            }
          })
        ])
      )
    : [el("div", { class: "empty", text: "No devices bound yet." })];

  openModal(
    "Key details",
    `Created ${fmtDate(key.createdAt)}`,
    [
      el("div", { class: "field" }, [
        el("span", { text: "Key" }),
        el("div", { class: "key-cell" }, [
          el("input", { class: "input mono", readonly: "", value: key.key, onclick: (e) => e.target.select() }),
          iconBtn("copy", "Copy", () => copyText(key.key))
        ])
      ]),
      el("div", { class: "form-grid" }, [
        el("div", { class: "field" }, [el("span", { text: "Device limit" }), deviceLimit]),
        el("div", { class: "field" }, [el("span", { text: "Status" }), statusSelect])
      ]),
      el("div", { class: "field" }, [el("span", { text: "Expiry (empty = never)" }), expires]),
      el("div", { class: "field" }, [el("span", { text: "Note" }), note]),
      el("h3", { text: "Bound devices", style: "margin-top:8px" }),
      ...deviceNodes
    ],
    [
      el("button", {
        class: "btn btn-danger", text: "Reset all HWIDs",
        onclick: async () => {
          if (!confirm("Remove all bound devices from this key?")) return;
          await api("/api/admin/keys?action=reset-hwid", { method: "POST", body: { id } });
          toast("All HWIDs reset", "ok");
          closeModal();
          renderKeys();
        }
      }),
      el("div", { style: "flex:1" }),
      el("button", { class: "btn btn-ghost", text: "Close", onclick: closeModal }),
      el("button", {
        class: "btn btn-primary", text: "Save changes",
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            const chosenExpiry = expires.value ? new Date(expires.value).toISOString() : "never";
            await api("/api/admin/keys?action=update", {
              method: "POST",
              body: {
                id,
                deviceLimit: Number(deviceLimit.value) || 0,
                status: statusSelect.value,
                note: note.value,
                expiresAt: chosenExpiry
              }
            });
            closeModal();
            toast("Key updated", "ok");
            renderKeys();
          } catch (err) {
            toast(err.message, "err");
            e.target.disabled = false;
          }
        }
      })
    ],
    true
  );
}

async function resetHwidAction(key) {
  if (!confirm(`Reset all bound devices for ${key.key}?`)) return;
  try {
    await api("/api/admin/keys?action=reset-hwid", { method: "POST", body: { id: key.id } });
    toast("HWID reset", "ok");
    renderKeys();
  } catch (err) {
    toast(err.message, "err");
  }
}

async function deleteKeyAction(key) {
  if (!confirm(`Delete key ${key.key}? This cannot be undone.`)) return;
  try {
    await api("/api/admin/keys?action=delete", { method: "POST", body: { id: key.id } });
    toast("Key deleted", "ok");
    renderKeys();
  } catch (err) {
    toast(err.message, "err");
  }
}

async function deleteExpiredAction() {
  if (!confirm("Delete all expired keys?")) return;
  try {
    const res = await api("/api/admin/keys?action=delete-expired", { method: "POST", body: {} });
    toast(`Deleted ${res.deleted} expired keys`, "ok");
    renderKeys();
  } catch (err) {
    toast(err.message, "err");
  }
}

/* ------------------------------------------------------------------ */
/* Announcements                                                       */
/* ------------------------------------------------------------------ */

async function renderAnnouncements() {
  const content = $("#page-content");
  content.innerHTML = '<div class="empty">Loading...</div>';
  const { settings } = await api("/api/admin/settings?action=get");
  const announcements = settings.announcements || [];

  const title = el("input", { class: "input", placeholder: "Title" });
  const body = el("textarea", { class: "textarea", placeholder: "Announcement text" });

  const form = el("div", { class: "card" }, [
    el("h3", { text: "New announcement" }),
    el("p", { class: "card-sub", text: "Visible to the public via /api/status." }),
    el("div", { class: "field" }, [el("span", { text: "Title" }), title]),
    el("div", { class: "field" }, [el("span", { text: "Message" }), body]),
    el("button", {
      class: "btn btn-primary", text: "Publish",
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          await api("/api/admin/settings?action=announcement-add", { method: "POST", body: { title: title.value, body: body.value } });
          toast("Announcement published", "ok");
          renderAnnouncements();
        } catch (err) {
          toast(err.message, "err");
          e.target.disabled = false;
        }
      }
    })
  ]);

  const list = el("div", { class: "card" }, [
    el("h3", { text: "Published announcements" }),
    el("p", { class: "card-sub", text: "Toggle, edit, or remove active announcements." }),
    ...(announcements.length ? announcements.map((a) => announcementRow(a)) : [el("div", { class: "empty", text: "No announcements yet." })])
  ]);

  content.innerHTML = "";
  content.append(form, list);
}

function announcementRow(a) {
  const toggle = el("input", { type: "checkbox", checked: a.enabled ? "" : null, onchange: async (e) => {
    await api("/api/admin/settings?action=announcement-update", { method: "POST", body: { id: a.id, enabled: e.target.checked } });
    toast(e.target.checked ? "Announcement enabled" : "Announcement hidden", "ok");
  } });

  const titleInput = el("input", { class: "input", value: a.title });
  const bodyInput = el("textarea", { class: "textarea", value: a.body, style: "min-height:60px" });

  return el("div", { class: "announcement-item" }, [
    el("div", { style: "flex:1; min-width:0" }, [
      el("div", { style: "display:flex; gap:10px; align-items:center; margin-bottom:8px" }, [
        el("div", { class: "switch" }, [toggle, el("span", { class: "track" })]),
        el("span", { class: "badge", class: a.enabled ? "badge ok" : "badge neutral", text: a.enabled ? "Live" : "Hidden" }),
        el("span", { class: "announcement-meta", text: fmtDate(a.createdAt) })
      ]),
      titleInput,
      el("div", { style: "height:8px" }),
      bodyInput,
      el("div", { class: "modal-actions", style: "margin-top:10px" }, [
        el("button", {
          class: "btn btn-sm", text: "Save",
          onclick: async (e) => {
            await api("/api/admin/settings?action=announcement-update", { method: "POST", body: { id: a.id, title: titleInput.value, body: bodyInput.value } });
            toast("Announcement updated", "ok");
            renderAnnouncements();
          }
        }),
        el("button", {
          class: "btn btn-danger btn-sm", text: "Delete",
          onclick: async () => {
            if (!confirm("Delete this announcement?")) return;
            await api("/api/admin/settings?action=announcement-delete", { method: "POST", body: { id: a.id } });
            toast("Announcement deleted", "ok");
            renderAnnouncements();
          }
        })
      ])
    ])
  ]);
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

async function renderSettings() {
  const content = $("#page-content");
  content.innerHTML = '<div class="empty">Loading...</div>';
  const { settings } = await api("/api/admin/settings?action=get");

  const maintenance = el("input", { type: "checkbox", checked: settings.maintenance ? "" : null });
  const maintenanceMessage = el("input", { class: "input", value: settings.maintenanceMessage || "" });
  const downloadUrl = el("input", { class: "input", value: settings.downloadUrl || "", placeholder: "https://.../DIE.zip" });
  const versionUrl = el("input", { class: "input", value: settings.versionUrl || "", placeholder: "https://.../version.txt" });

  const storage = session.storageMode === "kv"
    ? "Vercel KV - persistent across deployments and serverless instances."
    : "Local file - only for local development. Add Vercel KV for production.";

  content.innerHTML = "";
  content.append(
    el("div", { class: "card" }, [
      el("h3", { text: "Server management" }),
      el("p", { class: "card-sub", text: "Maintenance blocks all app activations until disabled." }),
      el("div", { class: "field inline" }, [
        el("div", { class: "switch" }, [maintenance, el("span", { class: "track" })]),
        el("span", { text: "Maintenance mode" })
      ]),
      el("div", { class: "field" }, [el("span", { text: "Maintenance message (shown to the app)" }), maintenanceMessage]),
      el("div", { class: "field" }, [
        el("span", { text: "Optional download URL for the game package (DIE.zip)" }),
        downloadUrl
      ]),
      el("div", { class: "field" }, [
        el("span", { text: "Optional version file URL (version.txt)" }),
        versionUrl
      ]),
      el("button", {
        class: "btn btn-primary", text: "Save settings",
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            await api("/api/admin/settings?action=update", {
              method: "POST",
              body: {
                maintenance: maintenance.checked,
                maintenanceMessage: maintenanceMessage.value,
                downloadUrl: downloadUrl.value,
                versionUrl: versionUrl.value
              }
            });
            toast("Settings saved", "ok");
            if (maintenance.checked) toast("Maintenance mode is ON - activations blocked");
          } catch (err) {
            toast(err.message, "err");
          } finally {
            e.target.disabled = false;
          }
        }
      })
    ]),
    el("div", { class: "card" }, [
      el("h3", { text: "Deployment info" }),
      el("p", { class: "card-sub", text: "Configuration notes for this deployment." }),
      el("div", { class: "field" }, [el("span", { text: "Storage" }), el("input", { class: "input", readonly: "", value: storage })]),
      el("div", { class: "field" }, [
        el("span", { text: "Admin password" }),
        el("input", {
          class: "input",
          readonly: "",
          value: session.defaultPassword ? "Default (viper-admin) - set ADMIN_PASSWORD in Vercel" : "Configured via ADMIN_PASSWORD"
        })
      ]),
      el("div", { class: "field" }, [
        el("span", { text: "App activation endpoint" }),
        el("input", { class: "input mono", readonly: "", value: `${location.origin}/server` })
      ])
    ])
  );
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

(async function boot() {
  try {
    await refreshSession();
  } catch (_) {
    session.authed = false;
  }
  if (session.authed) {
    showApp();
    navigate("overview");
  } else {
    showLogin();
  }
})();
