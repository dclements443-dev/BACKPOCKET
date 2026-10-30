// First-run setup: one screen that asks who is travelling, the home currency, the dates, the countries and (optionally) a budget,
// then builds the roster, the plan and the budget from the answers. It shows once, on a phone with nothing in it, and never
// again (data.setupDone). Skipping it keeps the old defaults. "Join with a backup" is for the second phone of a pair: the
// first phone's backup replaces this one, so both share the same travellers (restoring asks who is holding the phone).
// This file loads before index.html's script and only defines functions: sw.js saves it with the app.
let setupState = null;

// Nothing in this phone yet, no other trips, setup never finished or skipped
function setupNeeded() {
	if (data.setupDone || loadProblem) return false;
	if (data.expenses.length || data.payments.length || data.cashMoves.length || data.stops.length || (Array.isArray(data.itinerary) && data.itinerary.length)) return false;
	try { if (localStorage.getItem(tripsKey())) return false; } catch (err) { /* no list: a first trip */ }
	return true;
}

// The home currency a phone's language suggests (en-US → USD, de-DE → EUR); otherwise what the app already has
function setupGuessHome() {
	const region = String((typeof navigator !== "undefined" && navigator.language) || "").split("-")[1];
	const code = region ? currencyForCountry(region.toUpperCase()) : "";
	return USD_RATES[code] ? code : HOME();
}

const SETUP_CSS = `.setup { position: fixed; inset: 0; z-index: 44; overflow-y: auto; background: var(--bg); color: var(--ink); -webkit-overflow-scrolling: touch; }
.setup-in { max-width: 600px; margin: 0 auto; padding: calc(env(safe-area-inset-top, 0px) + 28px) 16px calc(env(safe-area-inset-bottom, 0px) + 40px); }
.setup h1 { margin: 0 0 6px; font-size: 30px; letter-spacing: -0.02em; }
.setup .su-lead { margin: 0 0 22px; color: var(--ink-2); font-size: 16px; line-height: 1.4; }
.setup .su-label { display: block; margin: 20px 0 8px; font-size: 13px; font-weight: 600; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.04em; }
.setup .su-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.setup .su-seg button, .setup .su-pick, .setup .su-chip { min-height: 48px; border: 0; border-radius: 14px; background: var(--card); color: var(--ink); font: inherit; font-size: 16px; font-weight: 500; box-shadow: var(--shadow); }
.setup .su-seg button[aria-pressed="true"] { background: var(--accent-btn); color: var(--primary-ink); }
.setup .su-pick { display: flex; width: 100%; align-items: center; justify-content: space-between; padding: 0 16px; text-align: left; }
.setup .su-pick span { color: var(--ink-2); font-weight: 400; }
.setup .su-person { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.setup .su-person .note-input { flex: 1; min-width: 0; background: var(--card); box-shadow: var(--shadow); }
.setup .su-kid { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--ink-2); white-space: nowrap; }
.setup .su-dates { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.setup .su-dates > div { min-width: 0; }
.setup .su-dates input { -webkit-appearance: none; appearance: none; display: block; min-width: 0; max-width: 100%; width: 100%; box-sizing: border-box; height: 50px; line-height: 50px; padding: 0 16px; text-align: left; }
.setup h1:focus { outline: none; }
.setup .su-dates label { display: block; font-size: 13px; color: var(--ink-2); margin-bottom: 4px; }
.setup .su-dates .note-input { background: var(--card); box-shadow: var(--shadow); }
.setup .su-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.setup .su-chip { min-height: 40px; padding: 0 14px; font-size: 15px; }
.setup .su-go { display: block; width: 100%; min-height: 54px; margin-top: 28px; border: 0; border-radius: 16px; background: var(--primary-bg); color: var(--primary-ink); font: inherit; font-size: 17px; font-weight: 600; }
.setup .su-link { display: block; width: 100%; min-height: 48px; margin-top: 6px; border: 0; background: none; color: var(--link); font: inherit; font-size: 15px; }
.setup .su-error { margin: 14px 0 0; color: #D92D20; font-size: 14px; }
.setup .su-add { margin-top: 8px; background: none; border: 0; padding: 8px 0; color: var(--link); font: inherit; font-size: 15px; }`;

const setupDay = (offset = 0) => addDays(toISO(new Date()), offset);

function setupOpen() {
	if (document.getElementById("setup")) return;
	if (!document.getElementById("setup-css")) document.head.insertAdjacentHTML("beforeend", `<style id="setup-css">${SETUP_CSS}</style>`);
	setupState = { group: false, others: [{ name: "", child: false }], countries: [], home: setupGuessHome(), busy: false };
	document.body.insertAdjacentHTML("beforeend", `<div class="setup" id="setup" role="dialog" aria-modal="true" aria-labelledby="su-title"><div class="setup-in">
		<h1 id="su-title" tabindex="-1">Set up your trip</h1>
		<p class="su-lead">A minute now means the budget, the plan and settle-up are right from day one. Everything can be changed later in Settings.</p>
		<label class="su-label" for="su-me">Your name</label>
		<input class="note-input" id="su-me" type="text" maxlength="24" autocomplete="off" placeholder="e.g. Alex" style="background:var(--card);box-shadow:var(--shadow)">
		<label class="su-label">Who is travelling?</label>
		<div class="su-seg"><button type="button" data-su-group="0" aria-pressed="true">Just me</button><button type="button" data-su-group="1" aria-pressed="false">With others</button></div>
		<div id="su-others" hidden></div>
		<label class="su-label">Home currency</label>
		<button type="button" class="su-pick" id="su-home"><b id="su-home-text" style="font-weight:500"></b><span>Change</span></button>
		<label class="su-label">When</label>
		<div class="su-dates"><div><label for="su-start">Leaving</label><input class="note-input" id="su-start" type="date"></div><div><label for="su-end">Back</label><input class="note-input" id="su-end" type="date"></div></div>
		<label class="su-label">Where to? <span style="text-transform:none;letter-spacing:0;font-weight:400">(optional, in order)</span></label>
		<div class="su-chips" id="su-chips"></div>
		<button type="button" class="su-pick" id="su-country">Add a country <span>＋</span></button>
		<label class="su-label" for="su-budget">Total budget <span style="text-transform:none;letter-spacing:0;font-weight:400">(optional)</span></label>
		<input class="note-input" id="su-budget" type="text" inputmode="decimal" autocomplete="off" placeholder="0" style="background:var(--card);box-shadow:var(--shadow)">
		<p class="su-error" id="su-error" role="alert" hidden></p>
		<button type="button" class="su-go" id="su-go">Start my trip</button>
		<button type="button" class="su-link" id="su-join">Someone already set this up? Join with their backup</button>
		<button type="button" class="su-link" id="su-skip">Skip for now</button>
	</div></div>`);
	["topbar", "main", "tabbar"].forEach(id => { const el = document.getElementById(id); if (el) el.inert = true; });
	$("su-start").value = setupDay(0);
	$("su-end").value = setupDay(13);
	setupPaint();
	$("setup").addEventListener("click", setupClick);
	$("setup").addEventListener("input", e => { if (e.target.dataset && e.target.dataset.suPerson !== undefined) setupState.others[+e.target.dataset.suPerson].name = e.target.value; });
	$("setup").addEventListener("change", e => { if (e.target.dataset && e.target.dataset.suKid !== undefined) setupState.others[+e.target.dataset.suKid].child = e.target.checked; });
	$("su-title").focus({ preventScroll: true });
}

function setupPaint() {
	const s = setupState;
	$("su-error").hidden = true;   // an old message is about the old answers
	document.querySelectorAll("#setup [data-su-group]").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.suGroup === "1") === s.group)));
	$("su-others").hidden = !s.group;
	$("su-others").innerHTML = s.others.map((o, i) => `<div class="su-person"><input class="note-input" type="text" maxlength="24" autocomplete="off" data-su-person="${i}" value="${esc(o.name)}" placeholder="${s.others.length > 1 ? "Traveller " + (i + 2) : "Their name"}" aria-label="Name of traveller ${i + 2}">` +
		`<label class="su-kid"><input type="checkbox" data-su-kid="${i}"${o.child ? " checked" : ""}> Child</label></div>`).join("") +
		(s.others.length < 9 ? `<button type="button" class="su-add" data-su-more>Add another person</button>` : "");
	$("su-home-text").textContent = `${currencyName(s.home)} (${s.home})`;
	$("su-chips").innerHTML = s.countries.map(cc => `<button type="button" class="su-chip" data-su-drop="${esc(cc)}" aria-label="Remove ${esc(countryName(cc, cc))}">${esc(flagOf(cc))} ${esc(countryName(cc, cc))} ✕</button>`).join("");
	$("su-chips").hidden = !s.countries.length;
}

function setupError(text) {
	$("su-error").textContent = text;
	$("su-error").hidden = !text;
	if (text && $("su-error").scrollIntoView) $("su-error").scrollIntoView({ block: "center" });
}

function setupClick(e) {
	const t = e.target && e.target.closest ? e.target : null;
	if (!t || setupState.busy) return;
	const g = t.closest("[data-su-group]"), drop = t.closest("[data-su-drop]");
	if (g) { setupState.group = g.dataset.suGroup === "1"; setupPaint(); }
	else if (t.closest("[data-su-more]")) { setupState.others.push({ name: "", child: false }); setupPaint(); const boxes = document.querySelectorAll("#su-others [data-su-person]"); boxes[boxes.length - 1].focus(); }
	else if (drop) { setupState.countries = setupState.countries.filter(cc => cc !== drop.dataset.suDrop); setupPaint(); }
	else if (t.closest("#su-home")) openPicker("currency", code => { setupState.home = code; setupPaint(); });
	else if (t.closest("#su-country")) openPicker("country", cc => { if (!setupState.countries.includes(cc)) setupState.countries.push(cc); setupPaint(); });
	else if (t.closest("#su-go")) setupFinish();
	else if (t.closest("#su-skip")) setupClose(true);
	else if (t.closest("#su-join")) setupJoin();
}

function setupClose(done) {
	if (done) { data.setupDone = true; saveData(); }
	const box = document.getElementById("setup");
	if (box) box.remove();
	["topbar", "main", "tabbar"].forEach(id => { const el = document.getElementById(id); if (el) el.inert = false; });
	setupState = null;
	render();
	window.scrollTo(0, 0);   // Home starts at its top, not where the form was scrolled to
}

// The second phone of a pair: the first phone's backup becomes this phone's trip. The normal restore asks "who are you?"
function setupJoin() {
	showToast("Choose the backup file from the other phone", { duration: 4000 });
	const input = $("restore-input");
	let polls = 0;
	const timer = setInterval(() => {
		if (!document.getElementById("setup")) return clearInterval(timer);
		if (!setupNeeded() && !loadProblem) { clearInterval(timer); data.setupDone = true; saveData(); setupClose(false); }
		else if (++polls > 240) clearInterval(timer);
	}, 500);
	input.click();
}

// Every answer checked, then written in one go: the roster, the dates, the currency, the plan and the budget
async function setupFinish() {
	const s = setupState;
	setupError("");
	const me = $("su-me").value.trim() || "Me", start = $("su-start").value, end = $("su-end").value;
	if (me.length > 24) return setupError("Names are up to 24 letters.");
	if (!isISODate(start) || !isISODate(end)) return setupError("Choose the dates you leave and come back.");
	if (end < start) return setupError("The trip can't end before it starts.");
	if (daysBetween(start, end) > 365) return setupError("Trips here are up to a year. You can add another trip later.");
	const others = s.group ? s.others.filter(o => o.name.trim()).map(o => ({ name: o.name.trim().slice(0, 24), child: o.child })) : [];
	if (s.group && !others.length) return setupError("Add at least one other person, or choose Just me.");
	const names = [me, ...others.map(o => o.name)].map(n => n.toLowerCase());
	if (new Set(names).size !== names.length) return setupError("Two people have the same name. Add an initial to tell them apart.");
	if (others.length > 9) return setupError("Up to 10 people can be on a trip.");
	const text = $("su-budget").value.trim().replace(/\s/g, "").replace(/^[^\d]+/, "");   // "£2,500" or "2 500" or "2500,50"
	let budget = 0;
	if (text) {
		if (/^\d{1,3}(,\d{3})+(\.\d+)?$|^\d+(\.\d+)?$/.test(text)) budget = parseFloat(text.replace(/,/g, ""));
		else if (/^\d+,\d{1,2}$/.test(text)) budget = parseFloat(text.replace(",", "."));
		else return setupError("The budget should be a number.");
	}
	s.busy = true;
	try {
		if (s.home !== HOME()) await switchHome(s.home);
		// Roster: the phone's owner first. A pair keeps the usual second traveller; a larger group gets new ones.
		const mine = data.travellers.find(x => x.id === data.meId);
		mine.name = me;
		if (!s.group) { data.travellers = data.travellers.slice(0, 2); data.solo = true; }
		else {
			delete data.solo;
			const spare = data.travellers.find(x => x.id !== data.meId);
			const roster = [mine];
			others.forEach((o, i) => {
				const who = i === 0 && spare ? spare : { id: "t-" + newDeviceId(), cardFee: 0 };
				Object.assign(who, { name: o.name, child: o.child });
				if (o.child) who.guardian = mine.id; else delete who.guardian;
				roster.push(who);
			});
			data.travellers = roster;
		}
		data.trip = { ...data.trip, start, end, endTyped: true, updatedAt: Date.now() };
		// The plan: each country gets an even share of the nights
		if (s.countries.length) {
			const total = daysBetween(start, end), each = Math.floor(total / s.countries.length), base = newId();
			data.stops = s.countries.map((cc, i) => ({
				id: base + i, order: i + 1, nights: each >= 1 ? (i === s.countries.length - 1 ? total - each * i : each) : null, stay: null, note: "", updatedAt: Date.now(),
				place: { name: countryName(cc, cc), cc, lat: null, lon: null, admin: "", tz: "", kind: "country", src: "setup" }
			}));
			s.countries.forEach(cc => ensureCurrency(cc));
		}
		if (budget > 0) data.tripBudget = budget;
		data.setupDone = true;
		if (!saveData()) { s.busy = false; return setupError("Couldn't save: storage is full or blocked."); }
		setupClose(false);
		showToast(s.countries.length ? "Your trip is ready" : "Set up. Add your stops in Plan", { icon: "check" });
		refreshRates();
	} catch (err) {
		console.warn(err);
		s.busy = false;
		setupError("Something went wrong. Try again, or skip for now and set things up in Settings.");
	}
}

function setupMaybe() {
	try { if (setupNeeded() && document.body && document.body.insertAdjacentHTML) setupOpen(); } catch (err) { console.warn("setup", err); }
}
