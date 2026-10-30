// Keeping the data safe, and getting it from one phone to another:
// - Recovery: when saved data can't be read the app keeps the old text (STORAGE_KEY + "-unreadable"). Here it can be saved
//   as a file, or read as far as it goes (every complete traveller, expense, payment, cash entry, stop and itinerary item
//   up to where it breaks) and offered to the normal restore, which asks before changing anything.
// - Back-up nudge: says sooner when a phone holds changes nobody else has.
// - Sync: one place that explains the two steps of sharing a trip between phones (send mine, add theirs).
// This file loads before index.html's script and only defines functions: sw.js saves it with the app.
const safetyUnreadableKey = () => STORAGE_KEY + "-unreadable";
function safetyRaw() {
	try { return localStorage.getItem(safetyUnreadableKey()) || ""; } catch (err) { return ""; }
}

// The complete objects in the array saved under `key`, read one at a time so a break further on costs only what comes after it
function safetyItems(raw, key) {
	const at = raw.indexOf(`"${key}":[`);
	if (at < 0) return [];
	const out = [];
	let depth = 0, start = -1, inText = false, escaped = false;
	for (let i = at + key.length + 4; i < raw.length; i++) {
		const c = raw[i];
		if (inText) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') inText = false; continue; }
		if (c === '"') inText = true;
		else if (c === "{" || c === "[") { if (!depth && c === "{") start = i; depth++; }
		else if (c === "}" || c === "]") {
			depth--;
			if (depth < 0) break;
			if (!depth && c === "}" && start >= 0) { try { out.push(JSON.parse(raw.slice(start, i + 1))); } catch (err) { /* one broken entry is skipped */ } start = -1; }
		}
	}
	return out;
}

// What can be read from the unreadable text, as a backup-shaped object, or null when the travellers can't be found
function safetySalvage(raw) {
	const travellers = safetyItems(raw, "travellers").filter(t => t && typeof t.id === "string" && typeof t.name === "string");
	const pick = re => { const m = raw.match(re); return m ? m[1] : ""; };
	const meId = pick(/"meId":"([^"]+)"/), home = pick(/"home":"([A-Z]{3})"/);
	if (!travellers.length || !travellers.some(t => t.id === meId)) return null;
	const trip = (() => { try { return JSON.parse(pick(/"trip":(\{[^{}]*\})/)); } catch (err) { return null; } })();
	const data2 = { version: 4, travellers, meId, expenses: safetyItems(raw, "expenses"), payments: safetyItems(raw, "payments"), cashMoves: safetyItems(raw, "cashMoves"),
		stops: safetyItems(raw, "stops"), legs: safetyItems(raw, "legs") };
	const itinerary = safetyItems(raw, "itinerary");
	if (itinerary.length) data2.itinerary = itinerary;
	if (home) data2.home = home;
	if (trip && isISODate(trip.start) && isISODate(trip.end)) data2.trip = trip;
	const deviceId = pick(/"deviceId":"([^"]+)"/);
	if (deviceId) data2.deviceId = deviceId;
	return data2;
}

async function safetyRecover() {
	const raw = safetyRaw(), found = raw && safetySalvage(raw);
	if (!found) return tell("Nothing to recover", raw ? "The unreadable copy is damaged too early to tell who was travelling. If you have a backup file, restore that in Settings." : "There is no unreadable copy on this phone.");
	const n = found.expenses.length + found.payments.length + found.cashMoves.length;
	if (!n) return tell("Nothing to recover", "The unreadable copy has no expenses, payments or cash entries that can still be read.");
	if (!(await ask(`Recover ${n} ${n === 1 ? "entry" : "entries"}?`, `${plural(found.expenses.length, "expense")}, ${plural(found.payments.length, "payment")} and ${plural(found.cashMoves.length, "cash entry")} can still be read. ` +
		"Anything after the damaged part is lost, so use a backup file instead if you have a newer one. You'll be asked how to add them.", { ok: "Recover" }))) return;
	await restoreFromFile(new File([JSON.stringify({ app: "backpocket", version: 4, exportedAt: new Date().toISOString(), data: found })], "recovered.json", { type: "application/json" }));
	safetyRender();
}

async function safetySaveCopy() {
	const raw = safetyRaw();
	if (!raw) return;
	const result = await shareOrDownload(new Blob([raw], { type: "text/plain" }), `backpocket-unreadable-${toISO(new Date())}.txt`);
	if (result) showToast("Saved a copy of the unreadable data");
}

async function safetyDiscard() {
	if (!(await ask("Delete the unreadable copy?", "It can't be read by the app. Only do this once you've recovered what you need or have a backup.", { ok: "Delete it", danger: true }))) return;
	try { localStorage.removeItem(safetyUnreadableKey()); } catch (err) { /* nothing to remove */ }
	safetyRender();
}

// At start-up when saved data couldn't be read
async function safetyUnreadablePrompt() {
	const answer = await ask("Your saved data couldn't be read", "The app started empty, and a copy of the old data was kept in this browser. It can try to recover what is still readable, or you can restore a backup file in Settings.",
		{ ok: "Recover what I can", alt: "Save a copy", cancel: "Not now" });
	if (answer === true) await safetyRecover();
	else if (answer === "alt") await safetySaveCopy();
}

// Say so sooner: any change nobody else has, after a few days; the first few changes on a phone never backed up
function safetyNudge(unsaved, sinceBackup) {
	const { changes, photos } = unsaved;
	return (changes >= 5 && (sinceBackup >= 2 || changes >= 25 || photos >= 5)) || (changes >= 1 && sinceBackup >= 3 && sinceBackup !== Infinity) || (changes >= 3 && sinceBackup === Infinity);
}

// Settings > Your data: the rows are added once, then shown or hidden as they apply
function safetyEnsure() {
	if (document.getElementById("sync-btn")) return;
	$("backup-btn").insertAdjacentHTML("afterend", '<button type="button" class="row row-action" id="sync-btn" hidden>Sync with the others<small id="sync-sub"></small></button>');
	$("undo-merge-btn").insertAdjacentHTML("beforebegin",
		'<button type="button" class="row row-action" id="recover-btn" hidden>Recover unreadable data</button>' +
		'<button type="button" class="row row-action" id="recover-save-btn" hidden>Save a copy of the unreadable data</button>' +
		'<button type="button" class="row row-action" id="recover-drop-btn" hidden>Delete the unreadable copy</button>');
	document.addEventListener("click", e => {
		const t = e.target && e.target.closest ? e.target : null;
		if (!t) return;
		if (t.closest("#sync-btn")) safetySync();
		else if (t.closest("#recover-btn")) safetyRecover();
		else if (t.closest("#recover-save-btn")) safetySaveCopy();
		else if (t.closest("#recover-drop-btn")) safetyDiscard();
	});
}
function safetyRender() {
	safetyEnsure();
	const group = !soloId() && activeAdults().length + activeChildren().length > 1, broken = Boolean(safetyRaw());
	$("sync-btn").hidden = !group;
	$("sync-sub").textContent = " Send what you've logged, add what they've logged";
	["recover-btn", "recover-save-btn", "recover-drop-btn"].forEach(id => { $(id).hidden = !broken; });
}

// Two steps, either order. Both phones end up with everything.
async function safetySync() {
	const others = andList(activeTravellers().filter(t => t.id !== data.meId && !t.child).map(t => t.name)) || "the others";
	const answer = await ask("Sync with " + others,
		`1. Send: back up this phone and share the file with ${others} (AirDrop or Messages). 2. Add: when they send theirs, choose it here. Anything new is added; nothing you've logged is lost. Do both and you each have everything.`,
		{ ok: "Send mine", alt: "Add theirs", cancel: "Close" });
	if (answer === true) makeBackup();
	else if (answer === "alt") $("restore-input").click();
}

// ---- Two phones set up on their own ----
// Each phone made its own travellers, so a backup from the other one shares no ids with this phone and could only Replace.
// When both have the same real names (not "Me" or "Partner", which every new phone has), one question settles it: the file's ids
// are rewritten to this phone's, and the normal merge takes over from there. Run on a version 4 file before anything is read from it.
const safetyMapRecords = (incoming, m) => {
	const list = k => (Array.isArray(incoming[k]) ? incoming[k] : []), weights = f => (f && typeof f === "object" ? Object.fromEntries(Object.entries(f).map(([id, w]) => [m(id), w])) : f);
	incoming.travellers.forEach(t => { t.id = m(t.id); if (t.guardian) t.guardian = m(t.guardian); });
	incoming.meId = m(incoming.meId);
	for (const e of list("expenses")) { if (e.paidBy) e.paidBy = m(e.paidBy); if (e.for) e.for = weights(e.for); if (e.forTyped) e.forTyped = m(e.forTyped); }
	for (const p of list("payments")) { if (p.from) p.from = m(p.from); if (p.to) p.to = m(p.to); }
	for (const c of list("cashMoves")) { if (c.who) c.who = m(c.who); if (c.for) c.for = weights(c.for); }
};
async function safetyMatchByName(incoming) {
	const mineList = data.travellers.filter(t => !t.left), theirs = incoming.travellers.filter(t => !t.left);
	const phoneIds = new Set(data.travellers.map(t => t.id)), norm = s => String(s || "").trim().toLowerCase();
	if (!mineList.length || mineList.length !== theirs.length || theirs.some(t => phoneIds.has(t.id))) return false;   // the same people already, or not the same roster
	const generic = n => !n || n === "me" || n === "partner" || /^traveller \d+$/.test(n) || n === norm(DEFAULT_NAMES.me) || n === norm(DEFAULT_NAMES.partner);
	const names = mineList.map(t => norm(t.name));
	if (names.some(generic) || new Set(names).size !== names.length || !theirs.every(t => names.includes(norm(t.name)))) return false;
	const hasData = [data.expenses, data.payments, data.cashMoves].some(list => list.some(x => !x.example));
	if (!hasData) return false;   // an empty phone just takes the file's travellers
	if (!(await ask("These look like the same trip", `Both phones have ${andList(mineList.map(t => t.name))}, set up separately. Treat them as the same people so the two phones can merge? Nothing changes until you choose Merge or Replace next.`, { ok: "Yes, same people", cancel: "No" }))) return false;
	const map = {};
	theirs.forEach(t => { map[t.id] = mineList.find(x => norm(x.name) === norm(t.name)).id; });
	safetyMapRecords(incoming, id => map[id] || id);
	return true;
}
