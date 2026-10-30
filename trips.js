// Named trips with an archive. The trip you're in is always the ordinary saved data (STORAGE_KEY), so everything else in the app, backups
// and merges included, works on it as before. The other trips wait in their own slots and swap in when you open them (the page reloads, so
// nothing from the old trip is left in memory). The list is only written once you first open Trips: until then the app saves exactly what it did.
const tripsKey = () => STORAGE_KEY + "-trips", tripSlot = id => STORAGE_KEY + "-trip-" + id;   // functions: STORAGE_KEY is defined after this file loads
const tripsReload = () => { if (typeof location.reload === "function") location.reload(); };
function tripsRead() {
	let idx = null;
	try { idx = JSON.parse(localStorage.getItem(tripsKey())); } catch (err) { /* a fresh list below */ }
	const ok = idx && Array.isArray(idx.trips) ? idx.trips.filter(t => t && typeof t.id === "string" && /^[\w-]{1,20}$/.test(t.id)) : [];
	if (!ok.some(t => t.id === idx.active)) return { v: 1, active: "t1", trips: [{ id: "t1", name: "My trip", archived: false }] };
	return { v: 1, active: idx.active, trips: ok.map(t => ({ id: t.id, name: String(t.name || "Trip").trim().slice(0, 40) || "Trip", archived: t.id !== idx.active && t.archived === true })) };
}
function tripsWrite(idx) {
	try { localStorage.setItem(tripsKey(), JSON.stringify(idx)); return true; } catch (err) { showToast("Not saved: storage full or blocked", { tone: "error" }); return false; }
}
const tripsName = () => { const idx = tripsRead(); return idx.trips.find(t => t.id === idx.active).name; };
const tripsId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);

// A trip you aren't in, read from its slot: its data, or null
function tripsPeek(id) {
	try { return JSON.parse(localStorage.getItem(tripSlot(id))); } catch (err) { return null; }
}
// The photos of the other trips are not "orphans": loadPhotos keeps them
function tripsPhotoIds() {
	const idx = tripsRead();
	return idx.trips.filter(t => t.id !== idx.active).flatMap(t => ((tripsPeek(t.id) || {}).expenses || []).filter(e => e && e.hasPhoto).map(e => e.id));
}

// Put the current trip away and make `next` (its saved text) the one in use. All or nothing.
function tripsSwap(idx, nextId, nextText) {
	if (!saveData()) return false;
	const before = localStorage.getItem(STORAGE_KEY), oldIndex = localStorage.getItem(tripsKey()), from = idx.active;
	try {
		localStorage.setItem(tripSlot(from), before);
		localStorage.setItem(STORAGE_KEY, nextText);
		localStorage.removeItem(tripSlot(nextId));
		localStorage.removeItem(UNDO_KEY);   // a merge made in one trip can't be undone from another
		idx.active = nextId;
		localStorage.setItem(tripsKey(), JSON.stringify(idx));
		return true;
	} catch (err) {
		try {
			localStorage.setItem(STORAGE_KEY, before);
			if (oldIndex === null) localStorage.removeItem(tripsKey()); else localStorage.setItem(tripsKey(), oldIndex);
			localStorage.removeItem(tripSlot(from));
		} catch (e2) { /* nothing more to do */ }
		showToast("Couldn't switch trips: storage is full", { tone: "error" });
		return false;
	}
}
function tripsOpen(id) {
	const idx = tripsRead();
	if (id === idx.active || !idx.trips.some(t => t.id === id)) return false;
	const text = localStorage.getItem(tripSlot(id));
	if (text === null) { showToast("That trip's data isn't on this phone", { tone: "error" }); return false; }
	if (!tripsSwap(idx, id, text)) return false;
	tripsReload();
	return true;
}
// A new trip, keeping (or not) the travellers, home currency and your rates; nothing else comes across
function tripsCreate(name, keepPeople) {
	const idx = tripsRead(), id = tripsId(), saved = { version: 4, deviceId: data.deviceId };
	if (keepPeople) Object.assign(saved, { travellers: copy(data.travellers), meId: data.meId, home: data.home, rates: copy(data.rates), autoRates: data.autoRates });
	const fresh = withDefaults(saved, { ...copy(DEFAULT_DATA), deviceId: data.deviceId });
	idx.trips.push({ id, name: String(name || "").trim().slice(0, 40) || "New trip", archived: false });
	if (!tripsSwap(idx, id, JSON.stringify(fresh))) return false;
	tripsReload();
	return true;
}
function tripsRename(id, name) {
	const idx = tripsRead(), t = idx.trips.find(x => x.id === id), clean = String(name || "").trim().slice(0, 40);
	if (!t || !clean || clean === t.name) return false;
	t.name = clean;
	return tripsWrite(idx);
}
function tripsArchive(id, on) {
	const idx = tripsRead(), t = idx.trips.find(x => x.id === id);
	if (!t || id === idx.active) return false;   // you archive a trip you've left
	t.archived = Boolean(on);
	return tripsWrite(idx);
}
// Only a trip you aren't in. Its photos and documents go with it.
function tripsDelete(id) {
	const idx = tripsRead();
	if (id === idx.active || !idx.trips.some(t => t.id === id)) return false;
	const gone = tripsPeek(id) || {};
	idx.trips = idx.trips.filter(t => t.id !== id);
	if (!tripsWrite(idx)) return false;
	try { localStorage.removeItem(tripSlot(id)); } catch (err) { /* only a leftover */ }
	(gone.expenses || []).filter(e => e && e.hasPhoto).forEach(e => photoDB.remove(e.id).catch(() => {}));
	try { docsReferenced({ stops: gone.stops || [], legs: gone.legs || [], itinerary: gone.itinerary || [] }).forEach(x => docDB.remove(x.id).catch(() => {})); } catch (err) { /* only leftovers */ }
	return true;
}
// "9 Dec 2026 – 6 Jan 2027 · 12 entries" for the list
function tripsSummary(d) {
	if (!d || !d.trip) return "";
	const n = ["expenses", "payments", "cashMoves"].reduce((sum, k) => sum + (Array.isArray(d[k]) ? d[k].length : 0), 0);
	const fmt = iso => (isISODate(iso) ? new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
	return [fmt(d.trip.start) && fmt(d.trip.end) ? `${fmt(d.trip.start)} – ${fmt(d.trip.end)}` : "", n ? `${n} ${n === 1 ? "entry" : "entries"}` : "No entries yet"].filter(Boolean).join(" · ");
}

// ---- The sheet ----
let tripsReady = false, tripsFocus = null;
function tripsEnsure() {
	if (tripsReady || document.getElementById("trips-sheet")) return;
	tripsReady = true;
	document.head.insertAdjacentHTML("beforeend", "<style>html.trips-open{overflow:hidden}html.trips-open .backdrop{opacity:1;pointer-events:auto}html.trips-open #trips-sheet{transform:none}" +
		".trips>*+*{margin-top:12px}.trip-new{padding:12px 18px}.trip-new>*+*{margin-top:10px}</style>");
	document.body.insertAdjacentHTML("beforeend", '<div class="sheet" id="trips-sheet" role="dialog" aria-modal="true" aria-labelledby="trips-title" inert><div class="sheet-top"><div class="grabber"></div>' +
		'<div class="sheet-nav"><span></span><h2 id="trips-title" tabindex="-1">Trips</h2><button type="button" class="nav-btn primary" id="trips-done">Done</button></div></div><div class="trips" id="trips-body"></div></div>');
	document.getElementById("trips-done").addEventListener("click", tripsClose);
	document.addEventListener("click", e => { if (e.target && e.target.id === "backdrop" && document.documentElement.classList.contains("trips-open")) { e.stopPropagation(); tripsClose(); } }, true);
	document.addEventListener("keydown", e => { if (e.key === "Escape" && document.documentElement.classList.contains("trips-open") && $("dialog").hidden) { e.preventDefault(); tripsClose(); } });
	document.getElementById("trips-body").addEventListener("change", e => {
		if (e.target.id === "trips-name") { if (tripsRename(tripsRead().active, e.target.value)) { tripsRefresh(); showToast("Renamed"); } else e.target.value = tripsName(); }
	});
}
function tripsRefresh() {
	const el = document.getElementById("trips-now");
	if (el) el.textContent = tripsName();
}
function tripsPaint() {
	const idx = tripsRead(), row = (t, buttons) => {
		const d = tripsPeek(t.id);
		return `<div class="row doc-row"><button type="button" class="doc-open" data-trip-open="${esc(t.id)}"><b>${esc(t.name)}</b><small>${esc(tripsSummary(d))}</small></button>${buttons}</div>`;
	};
	const others = idx.trips.filter(t => t.id !== idx.active), live = others.filter(t => !t.archived), shelf = others.filter(t => t.archived);
	document.getElementById("trips-body").innerHTML =
		`<div class="field"><p class="field-label">This trip</p><div class="card"><div class="row"><label for="trips-name">Name<small>${esc(tripsSummary(data))}</small></label><input type="text" id="trips-name" maxlength="40" autocomplete="off" value="${esc(tripsName())}"></div></div></div>` +
		(live.length ? `<div class="field"><p class="field-label">Other trips</p><div class="card">${live.map(t => row(t, `<button type="button" class="link" data-trip-archive="${esc(t.id)}">Archive</button>`)).join("")}</div></div>` : "") +
		'<div class="field"><div class="card" id="trips-newbox"><button type="button" class="row row-action" data-trip-new>New trip…</button></div>' +
		'<p class="hint-text">Each trip keeps its own expenses, plan and bookings. To bring a trip in from a backup, start a new trip, then restore the backup in Settings.</p></div>' +
		(shelf.length ? `<div class="field"><p class="field-label">Archive</p><div class="card">${shelf.map(t => row(t, `<button type="button" class="link" data-trip-archive="${esc(t.id)}" data-off="1">Unarchive</button><button type="button" class="link" data-trip-delete="${esc(t.id)}">Delete</button>`)).join("")}</div></div>` : "");
}
function tripsShow() {
	tripsEnsure();
	tripsPaint();
	if (!document.documentElement.classList.contains("trips-open")) {
		tripsFocus = document.activeElement;
		["topbar", "main", "tabbar"].forEach(x => { $(x).inert = true; });
		$("trips-sheet").inert = false;
		document.documentElement.classList.add("trips-open");
	}
	$("trips-sheet").scrollTop = 0;
	$("trips-title").focus({ preventScroll: true });
}
function tripsClose() {
	if (!document.documentElement.classList.contains("trips-open")) return;
	if ($("trips-sheet").contains(document.activeElement)) document.activeElement.blur();
	document.documentElement.classList.remove("trips-open");
	$("trips-sheet").inert = true;
	["topbar", "main", "tabbar"].forEach(x => { $(x).inert = false; });
	if (tripsFocus && document.contains(tripsFocus)) tripsFocus.focus({ preventScroll: true });
}
function tripsNewForm() {
	document.getElementById("trips-newbox").innerHTML = '<div class="trip-new"><label class="field-label" for="trips-new-name">Name</label>' +
		'<input class="note-input" type="text" id="trips-new-name" maxlength="40" autocomplete="off" placeholder="Portugal, summer" enterkeyhint="done">' +
		'<div class="row"><label for="trips-keep">Same travellers and home currency<small>Your budget, expenses and plan start empty</small></label><input type="checkbox" id="trips-keep" class="switch" checked></div>' +
		'<button type="button" class="btn-ghost" data-trip-create>Create and open</button></div>';
	document.getElementById("trips-new-name").focus();
}
document.addEventListener("click", async e => {
	const t = e.target && e.target.closest ? e.target : null;
	if (!t) return;
	if (t.closest("[data-trips-open]")) return tripsShow();
	if (!t.closest("#trips-sheet")) return;
	const open = t.closest("[data-trip-open]"), arch = t.closest("[data-trip-archive]"), del = t.closest("[data-trip-delete]");
	if (t.closest("[data-trip-new]")) tripsNewForm();
	else if (t.closest("[data-trip-create]")) tripsCreate($("trips-new-name").value, $("trips-keep").checked);
	else if (open) { if (await ask(`Open ${tripsRead().trips.find(x => x.id === open.dataset.tripOpen).name}?`, "This trip is saved as it is, and the app reloads on the other one.", { ok: "Open" })) tripsOpen(open.dataset.tripOpen); }
	else if (arch) { if (tripsArchive(arch.dataset.tripArchive, !arch.dataset.off)) { tripsPaint(); showToast(arch.dataset.off ? "Moved out of the archive" : "Archived"); } }
	else if (del) {
		const t2 = tripsRead().trips.find(x => x.id === del.dataset.tripDelete);
		if (t2 && await ask(`Delete ${t2.name}?`, "Its expenses, plan, photos and documents are removed from this phone. A backup file is the only way to get them back.", { ok: "Delete trip", danger: true }) && tripsDelete(t2.id)) { tripsPaint(); showToast("Trip deleted"); }
	}
});
document.addEventListener("DOMContentLoaded", () => { try { tripsRefresh(); } catch (err) { /* only the label */ } });
