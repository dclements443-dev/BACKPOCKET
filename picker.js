// Pickers for a country or a currency, laid out like the Been app: a search pill, then a plain list with a flag (or the
// symbol) in a round badge, "Popular" first and the rest A to Z. A tick marks what is already on your trip; nothing is put
// first because it is yours. The sheet itself (#picker) is in index.html. This file loads before index.html's script and only
// defines functions: sw.js saves it with the app.
const PICK_POPULAR = { country: "FR ES US IT TR MX TH DE GB JP AT GR", currency: "USD EUR GBP JPY AUD CAD CHF THB MXN TRY INR SGD" };
const PICK_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
let pickerOn = null, pickerWired = false;
const pickerCache = {};

// Every country (or currency) once: its id, name, the badge, a line underneath and other words that find it
function pickerItems(kind) {
	if (!pickerCache[kind]) {
		pickerCache[kind] = (kind === "country" ? Object.keys(CC_CURRENCY) : ALL_CURRENCIES).map(id => {
			if (kind === "currency") return { id, label: currencyName(id), glyph: currencyMeta(id).symbol || id, sub: id, alt: [id] };
			const code = currencyForCountry(id), name = countryName(id, id);
			return { id, label: name, glyph: flagOf(id), sub: code ? `${currencyName(code)} · ${code}` : "", alt: [...Object.keys(NAME_ALIASES).filter(a => NAME_ALIASES[a] === id), code, currencyName(code)] };
		}).filter(x => x.label !== x.id).sort((a, b) => a.label.localeCompare(b.label, "en-GB"));
	}
	return pickerCache[kind];
}

// What the list shows for a search: { found } (best matches first), or with nothing typed { pop, items } (Popular, then everything)
function pickerList(kind, query) {
	const q = query.trim().toLowerCase(), items = pickerItems(kind);
	if (!q) return { pop: PICK_POPULAR[kind].split(" ").map(id => items.find(x => x.id === id)).filter(Boolean), items };
	const hit = (t, extra, deep) => { t = String(t || "").toLowerCase(); return t.startsWith(q) ? extra : t.includes(" " + q) ? 1 + extra : deep && q.length > 2 && t.includes(q) ? 2 + extra : 9; };   // the middle of a word only counts from three letters, and not in the other words
	const rank = x => Math.min(x.id.toLowerCase() === q ? 0 : 9, hit(x.label, 0, 1), ...x.alt.map(t => hit(t, 3, 0)));
	return { found: items.map(x => [rank(x), x]).filter(p => p[0] < 9).sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label, "en-GB")).map(p => p[1]) };
}

function pickerRow(kind, x, have) {
	const on = have.has(x.id);
	return `<button type="button" class="pick-row${on ? " on" : ""}" data-pick="${esc(x.id)}" aria-label="${esc(x.label)}${x.sub ? ", " + esc(x.sub) : ""}${on ? ", on your trip" : ""}">` +
		`<span class="pick-glyph${kind === "currency" ? " sym" : ""}" aria-hidden="true">${esc(x.glyph)}</span><span class="pick-text"><b>${esc(x.label)}</b><small>${esc(x.sub)}</small></span>` +
		`<span class="pick-tick" aria-hidden="true">${on ? PICK_CHECK : ""}</span></button>`;
}

function pickerDraw() {
	const kind = pickerOn.kind, query = $("picker-search").value, have = new Set(kind === "country" ? tripCountries() : tripCurrencies()), list = pickerList(kind, query);
	const rows = xs => xs.map(x => pickerRow(kind, x, have)).join("");
	let html = "", letter = "";
	if (list.found) html = list.found.length ? rows(list.found) : `<p class="pick-empty">No ${kind} matches “${esc(query.trim())}”</p>`;
	else {
		html = `<h3 class="pick-head">Popular</h3>` + rows(list.pop);
		for (const x of list.items) {
			const first = x.label.normalize("NFD")[0].toUpperCase();
			if (first !== letter) html += `<h3 class="pick-head">${esc(letter = first)}</h3>`;
			html += pickerRow(kind, x, have);
		}
	}
	$("picker-list").innerHTML = html;
}

// onPick(id) is called with the country code or currency code that was tapped, after the picker has closed
function openPicker(kind, onPick) {
	if (pickerOn) return;
	if (!pickerWired) {
		pickerWired = true;
		$("picker-search").addEventListener("input", pickerDraw);
		$("picker-search").addEventListener("keydown", event => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			const first = pickerList(pickerOn.kind, $("picker-search").value).found;
			if (first && first[0]) pickerTake(first[0].id);
		});
		$("picker-list").addEventListener("click", event => { const row = event.target.closest("[data-pick]"); if (row) pickerTake(row.dataset.pick); });
		$("picker-cancel").addEventListener("click", closePicker);
		$("picker-back").addEventListener("click", closePicker);
		document.addEventListener("keydown", event => { if (event.key === "Escape" && pickerOn) closePicker(); });
	}
	pickerOn = { kind, onPick, back: document.activeElement, inert: ["topbar", "main", "tabbar", "sheet", "plan-sheet"].map(id => [$(id), $(id).inert]) };
	$("picker-title").textContent = kind === "country" ? "Choose a country" : "Choose a currency";
	$("picker-search").value = "";
	$("picker-search").placeholder = kind === "country" ? "Search countries" : "Search currencies";
	pickerDraw();
	pickerOn.inert.forEach(([el]) => { el.inert = true; });   // the page behind can't be reached while this is open
	$("picker").inert = false;
	$("picker-list").scrollTop = 0;
	document.documentElement.classList.add("picker-open");
	$("picker-title").focus({ preventScroll: true });
}

function closePicker() {
	if (!pickerOn) return null;
	const was = pickerOn;
	pickerOn = null;
	if (document.activeElement) document.activeElement.blur();   // the keyboard goes away with the sheet
	document.documentElement.classList.remove("picker-open");
	$("picker").inert = true;
	was.inert.forEach(([el, prev]) => { el.inert = prev; });
	if (was.back && document.contains(was.back)) was.back.focus({ preventScroll: true });
	return was;
}

function pickerTake(id) {
	const was = closePicker();
	if (was) was.onPick(id);
}
