// HikerScrolls — Profile Modal
// Shown from the auth dropdown "Profile" item. Surfaces identity +
// cloud trip management (rename, delete, open, export).
// Requires `shared/auth.js` (HikerAuth) and `shared/trips-repo.js` (HikerTripsRepo).

(function () {
  "use strict";

  const ICON_CLOSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === "className") e.className = v;
        else if (k === "innerHTML") e.innerHTML = v;
        else if (k === "textContent") e.textContent = v;
        else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
        else e.setAttribute(k, v);
      }
    }
    if (children) {
      for (const c of (Array.isArray(children) ? children : [children])) {
        if (c == null) continue;
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else e.appendChild(c);
      }
    }
    return e;
  }

  function toast(msg, type) {
    const t = el("div", { className: "hk-auth-toast" + (type === "success" ? " success" : ""), textContent: msg });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity 0.3s"; }, 2500);
    setTimeout(() => t.remove(), 2900);
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function closeOverlay(overlay) { overlay.remove(); }

  // ── Trip row ──────────────────────────────────────────────

  function renderTripRow(trip, onOpen, onRename, onDelete, onExport) {
    const row = el("div", { className: "hk-profile-trip" });

    const info = el("div", { className: "hk-profile-trip-info" });
    info.appendChild(el("div", { className: "hk-profile-trip-name", textContent: trip.name || "Untitled" }));

    const meta = [];
    if (trip.region) meta.push(trip.region);
    if (trip.date) meta.push(formatDate(trip.date));
    if (trip.stats?.distanceKm) meta.push(`${trip.stats.distanceKm} km`);
    if (trip.updatedAt) meta.push(`Updated ${formatDate(trip.updatedAt)}`);
    if (meta.length) {
      info.appendChild(el("div", { className: "hk-profile-trip-meta", textContent: meta.join(" · ") }));
    }
    row.appendChild(info);

    const actions = el("div", { className: "hk-profile-trip-actions" });
    actions.appendChild(el("button", { className: "hk-profile-btn ghost", textContent: "Open", onClick: () => onOpen(trip) }));
    actions.appendChild(el("button", { className: "hk-profile-btn ghost", textContent: "Rename", onClick: () => onRename(trip) }));
    actions.appendChild(el("button", { className: "hk-profile-btn ghost", textContent: "Export", onClick: () => onExport(trip) }));
    actions.appendChild(el("button", { className: "hk-profile-btn danger", textContent: "Delete", onClick: () => onDelete(trip) }));
    row.appendChild(actions);

    return row;
  }

  // ── Modal ─────────────────────────────────────────────────

  function show() {
    const existing = document.querySelector(".hk-profile-overlay");
    if (existing) existing.remove();

    const overlay = el("div", { className: "hk-profile-overlay" });
    const modal = el("div", { className: "hk-profile-modal" });
    overlay.appendChild(modal);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(overlay); });
    function onKey(e) {
      if (e.key === "Escape") { closeOverlay(overlay); document.removeEventListener("keydown", onKey); }
    }
    document.addEventListener("keydown", onKey);

    // Header
    const header = el("div", { className: "hk-profile-header" });
    header.appendChild(el("h2", { className: "hk-profile-title", textContent: "Profile" }));
    header.appendChild(el("button", {
      className: "hk-profile-close",
      innerHTML: ICON_CLOSE,
      onClick: () => closeOverlay(overlay)
    }));
    modal.appendChild(header);

    const body = el("div", { className: "hk-profile-body" });
    modal.appendChild(body);

    const user = window.HikerAuth && window.HikerAuth.getUser ? window.HikerAuth.getUser() : null;

    if (!user) {
      body.appendChild(el("div", {
        className: "hk-profile-empty",
        textContent: "Sign in to see your profile and cloud-synced trips."
      }));
      body.appendChild(el("button", {
        className: "hk-profile-btn primary",
        textContent: "Sign In",
        onClick: () => {
          closeOverlay(overlay);
          if (window.HikerAuth && window.HikerAuth.showAuthModal) window.HikerAuth.showAuthModal();
        }
      }));
      document.body.appendChild(overlay);
      return;
    }

    // Identity block
    const identity = el("div", { className: "hk-profile-identity" });
    const initial = ((user.email || "U")[0] || "U").toUpperCase();
    identity.appendChild(el("div", { className: "hk-profile-avatar", textContent: initial }));
    const idText = el("div", { className: "hk-profile-identity-text" });
    idText.appendChild(el("div", { className: "hk-profile-email", textContent: user.email || "User" }));
    if (user.created_at) {
      idText.appendChild(el("div", { className: "hk-profile-since", textContent: "Member since " + formatDate(user.created_at) }));
    }
    identity.appendChild(idText);

    const signOutBtn = el("button", {
      className: "hk-profile-btn ghost",
      textContent: "Sign Out",
      onClick: async () => {
        if (window.HikerAuth && window.HikerAuth.signOut) {
          await window.HikerAuth.signOut();
          closeOverlay(overlay);
        }
      }
    });
    identity.appendChild(signOutBtn);
    body.appendChild(identity);

    // Trips section
    const section = el("div", { className: "hk-profile-section" });
    section.appendChild(el("div", { className: "hk-profile-section-title", textContent: "My Trips" }));
    const listEl = el("div", { className: "hk-profile-list" });
    section.appendChild(listEl);
    body.appendChild(section);

    // Loading state
    listEl.appendChild(el("div", { className: "hk-profile-empty", textContent: "Loading your trips..." }));

    async function refresh() {
      listEl.innerHTML = "";
      const repo = window.HikerTripsRepo;
      if (!repo) {
        listEl.appendChild(el("div", { className: "hk-profile-empty", textContent: "Cloud sync module not loaded." }));
        return;
      }
      let trips = [];
      try {
        trips = await repo.listTrips();
      } catch (e) {
        listEl.appendChild(el("div", { className: "hk-profile-empty", textContent: "Could not load trips: " + (e.message || e) }));
        return;
      }

      if (!trips.length) {
        listEl.appendChild(el("div", {
          className: "hk-profile-empty",
          textContent: "No cloud-synced trips yet. Create a trip while signed in, or sync an existing local trip."
        }));
        return;
      }

      for (const trip of trips) {
        listEl.appendChild(renderTripRow(
          trip,
          (t) => {
            closeOverlay(overlay);
            if (typeof window.openTrip === "function") {
              window.openTrip(t.id);
            } else {
              // No trip viewer on this page — redirect to demo app.
              window.location.href = "/demo/?trip=" + encodeURIComponent(t.id);
            }
          },
          async (t) => {
            const name = prompt("Rename trip:", t.name || "");
            if (name == null) return;
            const trimmed = name.trim();
            if (!trimmed || trimmed === t.name) return;
            try {
              await repo.renameTrip(t.id, trimmed);
              toast("Trip renamed.", "success");
              refresh();
              if (typeof window.reloadTripList === "function") window.reloadTripList();
            } catch (e) {
              toast("Rename failed: " + (e.message || e));
            }
          },
          async (t) => {
            if (!confirm("Delete '" + (t.name || "this trip") + "'? This cannot be undone.")) return;
            try {
              await repo.deleteTrip(t.id);
              toast("Trip deleted.", "success");
              refresh();
              if (typeof window.reloadTripList === "function") window.reloadTripList();
            } catch (e) {
              toast("Delete failed: " + (e.message || e));
            }
          },
          (t) => {
            try {
              const blob = new Blob([JSON.stringify(t, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = (t.name || "trip").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".json";
              document.body.appendChild(a);
              a.click();
              setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
            } catch (e) {
              toast("Export failed: " + (e.message || e));
            }
          }
        ));
      }
    }

    refresh();
    document.body.appendChild(overlay);
  }

  window.HikerProfile = { show };
})();
