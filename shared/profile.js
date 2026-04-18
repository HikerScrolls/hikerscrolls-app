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

  function renderTripRow(trip, handlers) {
    const row = el("div", { className: "hk-profile-trip" });

    const info = el("div", { className: "hk-profile-trip-info" });
    info.appendChild(el("div", { className: "hk-profile-trip-name", textContent: trip.name || "Untitled" }));

    const meta = [];
    if (trip.region) meta.push(trip.region);
    if (trip.date) meta.push(formatDate(trip.date));
    if (trip.stats?.distanceKm) meta.push(`${trip.stats.distanceKm} km`);
    if (trip.archivedAt) meta.push(`Archived ${formatDate(trip.archivedAt)}`);
    else if (trip.updatedAt) meta.push(`Updated ${formatDate(trip.updatedAt)}`);
    if (meta.length) {
      info.appendChild(el("div", { className: "hk-profile-trip-meta", textContent: meta.join(" · ") }));
    }
    row.appendChild(info);

    const actions = el("div", { className: "hk-profile-trip-actions" });
    if (handlers.onOpen) actions.appendChild(el("button", { className: "hk-profile-btn ghost", textContent: "Open", onClick: () => handlers.onOpen(trip) }));
    if (handlers.onEdit) actions.appendChild(el("button", { className: "hk-profile-btn ghost", textContent: "Edit", onClick: () => handlers.onEdit(trip) }));
    if (handlers.onExport) actions.appendChild(el("button", { className: "hk-profile-btn ghost", textContent: "Export", onClick: () => handlers.onExport(trip) }));
    if (handlers.onArchive) actions.appendChild(el("button", { className: "hk-profile-btn ghost", textContent: "Archive", onClick: () => handlers.onArchive(trip) }));
    if (handlers.onUnarchive) actions.appendChild(el("button", { className: "hk-profile-btn ghost", textContent: "Unarchive", onClick: () => handlers.onUnarchive(trip) }));
    if (handlers.onDelete) actions.appendChild(el("button", { className: "hk-profile-btn danger", textContent: "Delete", onClick: () => handlers.onDelete(trip) }));
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

    // Active trips section (title + "New Trip" CTA row)
    const section = el("div", { className: "hk-profile-section" });
    const sectionHeader = el("div", { className: "hk-profile-section-header" });
    sectionHeader.appendChild(el("div", { className: "hk-profile-section-title", textContent: "My Trips" }));
    sectionHeader.appendChild(el("button", {
      className: "hk-profile-btn primary",
      textContent: "+ New Trip",
      onClick: () => {
        closeOverlay(overlay);
        if (typeof window.showCreationWizard === "function") {
          window.showCreationWizard();
        } else {
          window.location.href = "/demo/?new=1";
        }
      }
    }));
    section.appendChild(sectionHeader);
    const listEl = el("div", { className: "hk-profile-list" });
    section.appendChild(listEl);
    body.appendChild(section);

    // Archived trips section
    const archivedSection = el("div", { className: "hk-profile-section" });
    archivedSection.style.marginTop = "20px";
    archivedSection.appendChild(el("div", { className: "hk-profile-section-title", textContent: "Archived" }));
    const archivedListEl = el("div", { className: "hk-profile-list" });
    archivedSection.appendChild(archivedListEl);
    body.appendChild(archivedSection);

    // Loading state
    listEl.appendChild(el("div", { className: "hk-profile-empty", textContent: "Loading your trips..." }));

    function openHandler(t) {
      closeOverlay(overlay);
      if (typeof window.openTrip === "function") {
        window.openTrip(t.id);
      } else {
        window.location.href = "/demo/?trip=" + encodeURIComponent(t.id);
      }
    }

    function editHandler(t) {
      closeOverlay(overlay);
      if (typeof window.editTrip === "function") {
        window.editTrip(t.id);
      } else {
        window.location.href = "/demo/?edit=" + encodeURIComponent(t.id);
      }
    }

    function exportHandler(t) {
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

    async function refresh() {
      listEl.innerHTML = "";
      archivedListEl.innerHTML = "";
      const repo = window.HikerTripsRepo;
      if (!repo) {
        listEl.appendChild(el("div", { className: "hk-profile-empty", textContent: "Cloud sync module not loaded." }));
        archivedSection.style.display = "none";
        return;
      }

      let cloudTrips = [];
      try {
        cloudTrips = await repo.listTrips();
      } catch (e) {
        listEl.appendChild(el("div", { className: "hk-profile-empty", textContent: "Could not load trips: " + (e.message || e) }));
        archivedSection.style.display = "none";
        return;
      }

      // Include local trips (when the demo module is available) so archived
      // local trips can be restored from the same surface.
      const localTrips = (typeof window.getLocalTrips === "function")
        ? window.getLocalTrips().map(t => ({ ...t, _isLocal: true, _isCloud: false }))
        : [];
      const trips = [...cloudTrips, ...localTrips];

      const active = trips.filter(t => !t.archivedAt);
      const archived = trips.filter(t => t.archivedAt);

      function setLocalArchived(id, archived) {
        if (typeof window.getLocalTrips !== "function" || typeof window.saveLocalTrips !== "function") return;
        const all = window.getLocalTrips();
        const idx = all.findIndex(x => x.id === id);
        if (idx < 0) return;
        all[idx] = { ...all[idx], archivedAt: archived ? new Date().toISOString() : null };
        window.saveLocalTrips(all);
      }

      async function doArchive(t) {
        try {
          if (t._isCloud) await repo.archiveTrip(t.id);
          else setLocalArchived(t.id, true);
          toast("Trip archived.", "success");
          refresh();
          if (typeof window.reloadTripList === "function") window.reloadTripList();
        } catch (e) { toast("Archive failed: " + (e.message || e)); }
      }

      async function doUnarchive(t) {
        try {
          if (t._isCloud) await repo.unarchiveTrip(t.id);
          else setLocalArchived(t.id, false);
          toast("Trip restored.", "success");
          refresh();
          if (typeof window.reloadTripList === "function") window.reloadTripList();
        } catch (e) { toast("Unarchive failed: " + (e.message || e)); }
      }

      async function doDelete(t, confirmMsg) {
        if (!confirm(confirmMsg)) return;
        try {
          if (t._isCloud) await repo.deleteTrip(t.id);
          else if (typeof window.deleteLocalTrip === "function") window.deleteLocalTrip(t.id);
          toast("Trip deleted.", "success");
          refresh();
          if (typeof window.reloadTripList === "function") window.reloadTripList();
        } catch (e) { toast("Delete failed: " + (e.message || e)); }
      }

      if (!active.length) {
        listEl.appendChild(el("div", {
          className: "hk-profile-empty",
          textContent: "No trips yet. Create a trip, or sync an existing local trip to the cloud."
        }));
      } else {
        for (const trip of active) {
          listEl.appendChild(renderTripRow(trip, {
            onOpen: openHandler,
            onEdit: editHandler,
            onExport: exportHandler,
            onArchive: doArchive,
            onDelete: (t) => doDelete(t, "Delete '" + (t.name || "this trip") + "'? This cannot be undone.")
          }));
        }
      }

      if (!archived.length) {
        archivedSection.style.display = "none";
      } else {
        archivedSection.style.display = "";
        for (const trip of archived) {
          archivedListEl.appendChild(renderTripRow(trip, {
            onUnarchive: doUnarchive,
            onDelete: (t) => doDelete(t, "Permanently delete '" + (t.name || "this trip") + "'? This cannot be undone.")
          }));
        }
      }
    }

    refresh();
    document.body.appendChild(overlay);
  }

  window.HikerProfile = { show };
})();
