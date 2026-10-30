// Booking documents: PDFs and screenshots (tickets, vouchers, confirmations) attached to a stay, a journey or an itinerary plan.
// The file sits in its own IndexedDB ("backpocketDocs", beside the photos); the record only carries { id, name, type, size }, so a
// merge moves the list with the record. Backups carry the files, the way they carry photos.
const DOC_MAX = 8 * 1024 * 1024, DOC_LIMIT = 12;
const DOC_OK = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif|gif))$/;
const docDB = {
	db: null,
	open() {
		if (this.db) return Promise.resolve(this.db);
		return new Promise((resolve, reject) => {
			const request = indexedDB.open("backpocketDocs", 1);
			request.onupgradeneeded = () => request.result.createObjectStore("docs");
			request.onsuccess = () => {
				this.db = request.result;
				this.db.onclose = () => { this.db = null; };
				this.db.onversionchange = () => { this.db.close(); this.db = null; };
				resolve(this.db);
			};
			request.onerror = () => reject(request.error);
		});
	},
	async run(mode, action) {
		const db = await this.open();
		return new Promise((resolve, reject) => {
			let tx;
			try { tx = db.transaction("docs", mode); } catch (err) { this.db = null; reject(err); return; }
			let result;
			const request = action(tx.objectStore("docs"));
			if (request) request.onsuccess = () => { result = request.result; };
			tx.oncomplete = () => resolve(result);
			tx.onerror = tx.onabort = () => reject(tx.error || new Error("Document storage failed"));
		});
	},
	save(id, rec) { return this.run("readwrite", s => s.put(rec, id)); },
	get(id) { return this.run("readonly", s => s.get(id)); },
	remove(id) { return this.run("readwrite", s => s.delete(id)); }
};

// A record's list of attachments, cleaned: [{ id, name, type, size }]
function docsClean(list) {
	if (!Array.isArray(list)) return [];
	const seen = new Set();
	return list.filter(d => d && typeof d.id === "string" && /^[\w-]{1,40}$/.test(d.id) && !seen.has(d.id) && seen.add(d.id)).slice(0, DOC_LIMIT).map(d => ({
		id: d.id, name: (typeof d.name === "string" && d.name.trim() ? d.name.trim() : "Document").slice(0, 80),
		type: DOC_OK.test(d.type) ? d.type : "application/pdf", size: Number.isFinite(d.size) && d.size > 0 ? Math.round(d.size) : 0 }));
}
// Every attachment any stay, journey or plan on this phone points at
function docsReferenced(d = data) {
	return [...d.stops.map(s => s.stay && s.stay.docs), ...d.legs.map(l => l.docs), ...(d.itinerary || []).map(i => i.docs)].flatMap(docsClean);
}
const docSize = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1000)) + " KB");

// ---- Editing: each sheet keeps a draft of its list; the files themselves are only deleted when the sheet is saved ----
const docsDraft = {};
let docsTarget = "", docsInput = null;
function docsMount(box, list) {
	const clean = docsClean(list);
	docsDraft[box] = { orig: clean, list: clean.slice(), added: [] };
	docsPaint(box);
}
const docsList = box => (docsDraft[box] ? docsDraft[box].list.slice() : []);
function docsPaint(box) {
	const el = document.getElementById(box), d = docsDraft[box];
	if (!el || !d) return;
	el.innerHTML = '<p class="field-label">Documents</p><div class="card">' + d.list.map(x =>
		`<div class="row doc-row"><button type="button" class="doc-open" data-doc-open="${esc(x.id)}" data-doc-box="${box}"><b>${esc(x.name)}</b><small>${x.type === "application/pdf" ? "PDF" : "Image"}${x.size ? " · " + docSize(x.size) : ""}</small></button>` +
		`<button type="button" class="link" data-doc-del="${esc(x.id)}" data-doc-box="${box}" aria-label="Remove ${esc(x.name)}">Remove</button></div>`).join("") +
		(d.list.length < DOC_LIMIT ? `<button type="button" class="row row-action" data-doc-add="${box}">Attach a ticket or confirmation</button>` : "") + "</div>" +
		'<p class="hint-text">PDFs and screenshots up to 8 MB stay on this phone and go into backups.</p>';
}
function docsCommit(box) {
	const d = docsDraft[box];
	if (!d) return;
	const keep = new Set(d.list.map(x => x.id));
	d.orig.filter(x => !keep.has(x.id)).forEach(x => docDB.remove(x.id).catch(() => {}));
	d.orig = d.list.slice();
	d.added = [];
}
function docsCancel(box) {
	const d = docsDraft[box];
	if (!d) return;
	d.added.forEach(id => docDB.remove(id).catch(() => {}));
	delete docsDraft[box];
}
function docsPick(box) {
	if (!docsInput) {
		docsInput = document.createElement("input");
		docsInput.type = "file"; docsInput.accept = "application/pdf,image/*"; docsInput.hidden = true;
		docsInput.addEventListener("change", docsChosen);
		document.body.appendChild(docsInput);
	}
	docsTarget = box;
	docsInput.click();
}
async function docsChosen() {
	const file = docsInput.files && docsInput.files[0], box = docsTarget, d = docsDraft[box];
	docsInput.value = "";
	if (!file || !d) return;
	const type = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "");
	if (!DOC_OK.test(type)) return showToast("Attach a PDF or an image", { tone: "error" });
	if (file.size > DOC_MAX) return showToast(`That file is ${docSize(file.size)}: the limit is 8 MB`, { tone: "error" });
	const id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
	try { await docDB.save(id, { name: file.name, type, blob: file }); }
	catch (err) { return showToast("Couldn't store that file: storage may be full", { tone: "error" }); }
	if (docsDraft[box] !== d) { docDB.remove(id).catch(() => {}); return; }   // the sheet closed meanwhile
	d.list.push(...docsClean([{ id, name: file.name.replace(/\.[^.]+$/, "") || "Document", type, size: file.size }]));
	d.added.push(id);
	docsPaint(box);
}
async function docsOpen(id) {
	let rec = null;
	try { rec = await docDB.get(id); } catch (err) { /* treated as missing */ }
	if (!rec || !rec.blob) return showToast("That file isn't on this phone yet: restore a backup that includes it", { tone: "error" });
	const blob = new Blob([rec.blob], { type: rec.type }), url = URL.createObjectURL(blob);
	if (!window.open(url, "_blank")) await shareOrDownload(blob, rec.name || "document");
	setTimeout(() => URL.revokeObjectURL(url), 120000);
}
document.addEventListener("click", e => {
	const t = e.target && e.target.closest ? e.target : null;
	if (!t) return;
	const add = t.closest("[data-doc-add]"), open = t.closest("[data-doc-open]"), del = t.closest("[data-doc-del]");
	if (add) docsPick(add.dataset.docAdd);
	else if (open) docsOpen(open.dataset.docOpen);
	else if (del) {
		const d = docsDraft[del.dataset.docBox];
		if (d) { d.list = d.list.filter(x => x.id !== del.dataset.docDel); docsPaint(del.dataset.docBox); }
	}
});
if (document.head && document.head.insertAdjacentHTML) document.head.insertAdjacentHTML("beforeend", "<style>.doc-row{display:flex;align-items:center;gap:8px}.doc-open{flex:1;min-width:0;min-height:44px;padding:8px 0;border:0;background:none;color:inherit;font:inherit;text-align:left}" +
	".doc-open b{display:block;font-weight:500;overflow-wrap:anywhere}.doc-open small{display:block;font-size:13px;color:var(--ink-2)}</style>");

// ---- Backups: the files go in as { id: { name, type, data: "data:...;base64,..." } } under "docs" ----
// Returns the text to put before the closing brace of the backup ("" when there are none), and how many files were left out
async function docsBackupPart() {
	const refs = docsReferenced(), seen = new Set();
	let blob = new Blob([',"docs":{']), count = 0, missing = 0;
	for (const x of refs) {
		if (seen.has(x.id)) continue;
		seen.add(x.id);
		try {
			const rec = await docDB.get(x.id);
			if (!rec || !rec.blob) { missing++; continue; }
			const url = await blobToDataURL(new Blob([rec.blob], { type: rec.type }));
			blob = new Blob([blob, count ? "," : "", JSON.stringify(x.id), ":", JSON.stringify({ name: rec.name || x.name, type: rec.type, data: url })]);
			count++;
		} catch (err) { missing++; }
	}
	return { part: count ? new Blob([blob, "}"]) : "", count, missing };
}
// After a restore or merge: store the files in the backup that this phone's records point at and doesn't have yet
async function docsRestore(backupDocs) {
	const files = backupDocs && typeof backupDocs === "object" ? backupDocs : {}, seen = new Set();
	let restored = 0, failed = 0;
	for (const x of docsReferenced()) {
		if (seen.has(x.id)) continue;
		seen.add(x.id);
		try { if (await docDB.get(x.id)) continue; } catch (err) { failed++; continue; }
		const f = files[x.id];
		if (!f || typeof f.data !== "string" || !f.data.startsWith("data:")) continue;   // not in this file: left as "not on this phone yet"
		try {
			const blob = await (await fetch(f.data)).blob();
			await docDB.save(x.id, { name: String(f.name || x.name).slice(0, 80), type: DOC_OK.test(f.type) ? f.type : x.type, blob });
			restored++;
		} catch (err) { failed++; }
	}
	return { restored, failed };
}
