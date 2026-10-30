// The daily itinerary. Stops and journeys are the route; this is everything that happens inside it: timed activities, day trips,
// meals, reservations, each with its booking details and, if you want them, reminders for check-in, cancellation and payment
// deadlines. An item is { id, kind, title, date, time, endTime, place, status, provider, ref, phone, url, note, due, deadlines,
// done, remind, updatedAt } in data.itinerary (absent until the first item, so a trip without one backs up exactly as before). Dates are "YYYY-MM-DD", times "HH:MM" (wall-clock time wherever you are). It is
// only ever shown against a date, never tied to a stop, so moving the plan around moves nothing here.
// Reminders are inside the app (Home and the top of the itinerary): an iPhone page can't wake itself up offline, so "Add to
// Calendar" also writes an .ics with each deadline as an event carrying an alarm. A price counts like a stay's or journey's
// (bookings.js): its outstanding part is set aside from Budget left, and a payment is an ordinary expense with bookingId "i<id>".
// This file loads before index.html's script and only defines functions; sw.js saves it with the app.
const ITIN_KINDS = { activity: "Activity", daytrip: "Day trip", food: "Food & drink", booking: "Reservation" };
const ITIN_CATEGORY = { activity: "Activities", daytrip: "Activities", food: "Food", booking: "Other" };
const ITIN_DEADLINES = { checkin: "Check-in opens", cancel: "Free cancellation ends", pay: "Payment due" };
const ITIN_SHORT = { checkin: "Check-in", cancel: "Cancel by", pay: "Pay by" };   // the sheet's row names
const ITIN_LEADS = [[-1, "Don't remind me"], [0, "On the day"], [1, "1 day before"], [2, "2 days before"], [7, "1 week before"]];
let itinReady = false, itinFocus = null, itinEditing = null, itinSnap = "", itinUndo = null;

const itinList = () => (Array.isArray(data.itinerary) ? data.itinerary : []);   // reading never adds the key; writers use itinWrite
const itinTimeOK = t => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const itinValid = x => Boolean(x) && typeof x === "object" && Number.isFinite(x.id) && isISODate(x.date) && typeof x.title === "string";
const itinWrite = () => (data.itinerary = itinList());
const itinItems = () => itinList().filter(itinValid);
const itinLead = it => (ITIN_LEADS.some(l => l[0] === it.remind) ? it.remind : 1);
const itinFind = id => itinList().find(x => String(x.id) === String(id));

// An item as this app keeps it: only the known boxes, in the right kinds of value (a backup file is not trusted)
function itinClean(x) {
	if (!itinValid(x)) return null;
	const s = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : ""), t = v => (itinTimeOK(v) ? v : "");
	const rec = { id: x.id, kind: ITIN_KINDS[x.kind] ? x.kind : "activity", title: s(x.title, 120), date: x.date, time: t(x.time), endTime: t(x.endTime),
		status: STATUS_WORDS[x.status] ? x.status : "idea", remind: ITIN_LEADS.some(l => l[0] === x.remind) ? x.remind : 1, updatedAt: Number.isFinite(x.updatedAt) ? x.updatedAt : 0 };
	for (const [key, n] of [["place", 200], ["provider", 200], ["ref", 100], ["phone", 60], ["url", 300], ["note", 500]]) if (s(x[key], n)) rec[key] = s(x[key], n);
	if (x.due && x.due.amount > 0 && isFinite(x.due.amount) && isCurrencyCode(x.due.currency)) rec.due = { amount: +x.due.amount, currency: x.due.currency };
	const docs = docsClean(x.docs);
	if (docs.length) rec.docs = docs;
	for (const type of Object.keys(ITIN_DEADLINES)) {
		const d = x.deadlines && x.deadlines[type];
		if (d && isISODate(d.date)) { (rec.deadlines = rec.deadlines || {})[type] = { date: d.date, time: t(d.time) }; if (x.done && x.done[type]) (rec.done = rec.done || {})[type] = true; }
	}
	return rec;
}
// Items from a backup into this phone's: new ones are added, an item both have takes the newer edit. Returns how many changed.
function itinMerge(items) {
	let n = 0;
	if (!items.length) return 0;
	itinWrite();
	for (const x of items) {
		const i = itinList().findIndex(y => y.id === x.id);
		if (i === -1) { data.itinerary.push(x); n++; }
		else if ((x.updatedAt || 0) > (data.itinerary[i].updatedAt || 0)) { data.itinerary[i] = x; n++; }
	}
	return n;
}

// ---- Deadlines and reminders ----
// Every deadline an item has: { type, item, date, time, done }
const itinDeadlines = it => Object.keys(ITIN_DEADLINES).filter(t => it.deadlines && it.deadlines[t] && isISODate(it.deadlines[t].date))
	.map(type => ({ type, item: it, date: it.deadlines[type].date, time: itinTimeOK(it.deadlines[type].time) ? it.deadlines[type].time : "", done: Boolean(it.done && it.done[type]) }));
// The deadlines to be reminded of today, soonest first. One shows from its lead time until two days after it passes, or until it is
// marked done; payment goes quiet once paid, check-in and cancellation once the day itself has gone. Items set to "don't remind me" never show.
function itinReminders(today = toISO(new Date())) {
	const priced = Object.fromEntries(bkItems().filter(b => b.kind === "item").map(b => [b.key, b]));
	return itinItems().flatMap(itinDeadlines).filter(r => {
		const it = r.item, lead = itinLead(it), b = priced["i" + it.id];
		if (lead < 0 || r.done) return false;
		if (r.type === "pay" && (it.status === "paid" || (b && b.left <= 0.005 && b.logged > 0))) return false;
		if (r.type !== "pay" && it.date < today) return false;
		return addDays(r.date, -lead) <= today && r.date >= addDays(today, -2);
	}).map(r => ({ ...r, days: daysBetween(today, r.date) })).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.item.id - b.item.id);
}
const itinWhen = days => (days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : days > 1 ? `in ${days} days` : `${-days} days ago`);
function itinDone(id, type) {
	const it = itinFind(id);
	if (!it || !ITIN_DEADLINES[type]) return;
	it.done = { ...it.done, [type]: true };
	it.updatedAt = Date.now();
	saveData();
	render();
}

// ---- A day ----
// What happens on `d`, in time order (anything with no time first): journeys leaving, check-in and check-out at a stay, and your items
function itinEntries(plan, d) {
	const out = [], ok = t => (itinTimeOK(t) ? t : "");
	plan.rows.forEach((row, i) => {
		const stay = !row.stop.home && row.stop.stay;
		if (i && row.leg && legDateOf(row) === d) out.push({ type: "leg", time: ok(row.leg.departAt), rank: 0, id: row.leg.id, row });
		if (stay && (stay.name || stay.checkIn) && row.arrive === d) out.push({ type: "in", time: ok(stay.checkIn), rank: 1, id: row.stop.id, row });
		if (stay && (stay.name || stay.checkOut) && row.depart === d) out.push({ type: "out", time: ok(stay.checkOut), rank: 1, id: row.stop.id, row });
	});
	itinItems().filter(x => x.date === d).forEach(it => out.push({ type: "item", time: ok(it.time), rank: 2, id: it.id, item: it }));
	return out.sort((a, b) => a.time.localeCompare(b.time) || a.rank - b.rank || a.id - b.id);
}
// "🇻🇳 Huế · night 2 of 3", or the night on board, or "" when nothing says where you are
function itinWhere(plan, d) {
	const night = nightOf(plan.rows, d);
	if (!night) return plan.rows.some((r, i) => i && r.stop.home && r.arrive === d) ? "Back home" : "";
	if (night.aboard) return `Night on the ${ABOARD_WORDS[night.row.leg.mode] || "move"} to ${stopName(night.row.stop)}`;
	return `${stopTitle(night.row.stop)} · night ${night.n}${night.of ? " of " + night.of : ""}`;
}
const itinRange = t => esc(t.time) + (t.end ? `<small>–${esc(t.end)}</small>` : "");
function itinChips(it, today) {
	const live = new Set(itinReminders(today).filter(r => r.item === it).map(r => r.type));
	return itinDeadlines(it).filter(r => !r.done).map(r => `<span class="itin-chip${live.has(r.type) ? " soon" : ""}">${esc(ITIN_DEADLINES[r.type])} ${esc(niceDate(r.date, "short"))}${r.time ? " " + esc(r.time) : ""}</span>`).join("");
}
function itinEntryHtml(e, today) {
	if (e.type === "item") {
		const it = e.item, base = it.kind === "daytrip" ? nightOf(currentPlan().rows, it.date) : null;
		const meta = [it.kind === "daytrip" ? (base && !base.aboard ? "Day trip from " + stopName(base.row.stop) : "Day trip") : ITIN_KINDS[it.kind] || "", it.place ? esc(it.place) : "",
			isBooked(it.status) || it.status === "free" ? statusHtml(it.status) : "", it.ref ? "Ref " + esc(it.ref) : ""].filter(Boolean).join(" · ");
		return `<li class="itin-row"><span class="itin-time">${e.time ? itinRange({ time: e.time, end: itinTimeOK(it.endTime) ? it.endTime : "" }) : it.kind === "daytrip" ? "All day" : "Any time"}</span>` +
			`<button type="button" class="itin-open" data-itin-open="${esc(it.id)}"><b>${esc(it.title)}</b><small>${meta}</small>${itinChips(it, today)}</button></li>`;
	}
	const row = e.row, stay = row.stop.stay;
	const text = e.type === "leg" ? `${MODES[modeOf(row.leg)].short} ${stopName(row.from)} → ${stopName(row.stop)}` : `${e.type === "in" ? "Check in" : "Check out"} · ${stay.name ? esc(stay.name) : stopName(row.stop)}`;
	const sub = e.type === "leg" && itinTimeOK(row.leg.arriveAt) ? `Arrives ${esc(row.leg.arriveAt)}${jdSpan(row.leg) ? " " + jdSigned(jdSpan(row.leg)) : ""}` : e.type === "in" && stay.ref ? "Ref " + esc(stay.ref) : "";
	return `<li class="itin-row route"><span class="itin-time">${e.time ? esc(e.time) : ""}</span><button type="button" class="itin-open" data-stop="${esc(row.stop.id)}"><b>${text}</b>${sub ? `<small>${sub}</small>` : ""}</button></li>`;
}
function itinReminderHtml(r) {
	const label = ITIN_DEADLINES[r.type];
	return `<li class="itin-rem${r.days < 0 ? " late" : ""}"><button type="button" class="itin-open" data-itin-open="${esc(r.item.id)}"><b>${esc(label)}</b>` +
		`<small>${esc(r.item.title)} · ${itinWhen(r.days)}${r.time ? " at " + esc(r.time) : ""}</small></button>` +
		`<button type="button" class="link" data-itin-done="${esc(r.item.id)}" data-type="${r.type}" aria-label="Mark ${esc(label.toLowerCase())} for ${esc(r.item.title)} as done">Done</button></li>`;
}

// ---- The Plan tab's Itinerary view ----
function itinRender(plan) {
	itinEnsure();
	const today = toISO(new Date()), box = $("plan-list"), fresh = !box.querySelector || !box.querySelector(".itin");
	const trip = tripDates(plan), dates = new Set();
	itinItems().forEach(it => dates.add(it.date));
	for (let d = plan.start, n = 0; d <= trip.end && n < 400; d = addDays(d, 1), n++) dates.add(d);
	const rems = itinReminders(today);
	const days = [...dates].sort().slice(0, 400).map(d => {
		const entries = itinEntries(plan, d), where = itinWhere(plan, d), n = d >= plan.start ? daysBetween(plan.start, d) + 1 : 0;
		return `<section class="card itin-day${d === today ? " today" : ""}${d < today ? " past" : ""}" data-day="${d}"${d === today ? ' aria-current="date"' : ""}>` +
			`<header><span><b>${n ? "Day " + n : d < plan.start ? "Before the trip" : "After the trip"}</b>${d === today ? "Today" : esc(niceDate(d))}</span>${where ? `<em>${where}</em>` : ""}</header>` +
			(entries.length ? `<ol>${entries.map(e => itinEntryHtml(e, today)).join("")}</ol>` : "") +
			`<button type="button" class="link itin-add" data-itin-add="${d}">Add to ${d === today ? "today" : "this day"}</button></section>`;
	});
	box.innerHTML = `<div class="itin">` +
		(rems.length ? `<div class="card itin-reminders"><h2>Reminders</h2><ul>${rems.map(itinReminderHtml).join("")}</ul></div>` : "") +
		`<div class="itin-tools"><button type="button" class="btn-ghost" data-itin-add="">Add to the itinerary</button>` +
		`<button type="button" class="btn-ghost" data-itin-cal>Add to Calendar</button><button type="button" class="btn-ghost" data-itin-share>Share itinerary</button><button type="button" class="btn-ghost" data-itin-copy>Copy as text</button>` + `</div>${days.join("")}</div>`;
	const now = box.querySelector && box.querySelector(".itin-day.today");
	if (fresh && now && now.scrollIntoView) now.scrollIntoView({ block: "start" });
}

// ---- Home: what's due and what's on today ----
function itinRenderHome() {
	itinEnsure();
	let card = document.getElementById("itin-card");
	if (!card) {
		const after = document.getElementById("bk-card") || $("pace-note").closest(".card");
		after.insertAdjacentHTML("afterend", '<div class="card widget" id="itin-card" hidden><div class="widget-head"><h2>Coming up</h2></div><div id="itin-home"></div></div>');
		card = document.getElementById("itin-card");
	}
	const today = toISO(new Date()), rems = itinReminders(today).slice(0, 4), plan = currentPlan();
	const items = itinEntries(plan, today).filter(e => e.type === "item");
	card.hidden = !rems.length && !items.length;
	if (card.hidden) return;
	$("itin-home").innerHTML = (rems.length ? `<ul class="itin-list">${rems.map(itinReminderHtml).join("")}</ul>` : "") +
		(items.length ? `<p class="itin-sub">Today</p><ul class="itin-list">${items.map(e => itinEntryHtml(e, today)).join("")}</ul>` : "") +
		`<button type="button" class="link" data-itin-view>Open the itinerary</button>`;
}
function itinGo() {
	savePlanPrefs({ view: "itinerary" });
	showView("plan");
	renderPlan();
}

// ---- Calendar ----
// An .ics file: each timed item an event (floating time, so it reads the same wherever the phone is), untimed ones all-day,
// and every deadline with reminders on an event with an alarm at your lead time
function itinICS(now = new Date(), withPlan = false) {
	const esc2 = t => String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
	const fold = line => { const parts = []; for (let i = 0; i < line.length; i += 60) parts.push((i ? " " : "") + line.slice(i, i + 60)); return parts.join("\r\n"); };
	const day = d => d.replace(/-/g, ""), at = (d, t) => day(d) + "T" + t.replace(":", "") + "00";
	const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
	const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Backpocket//Itinerary//EN", "CALSCALE:GREGORIAN"];
	const event = (uid, summary, d, time, endTime, extra, alarm) => {
		lines.push("BEGIN:VEVENT", `UID:${uid}@backpocket`, `DTSTAMP:${stamp}`, `SUMMARY:${esc2(summary)}`);
		if (time) {
			const end = itinTimeOK(endTime) && endTime > time ? endTime : addMinutes(time, 60);
			lines.push(`DTSTART:${at(d, time)}`, `DTEND:${at(end < time ? addDays(d, 1) : d, end)}`);
		} else lines.push(`DTSTART;VALUE=DATE:${day(d)}`, `DTEND;VALUE=DATE:${day(addDays(d, 1))}`);
		extra.filter(Boolean).forEach(l => lines.push(l));
		if (alarm) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc2(summary)}`, `TRIGGER:${alarm}`, "END:VALARM");
		lines.push("END:VEVENT");
	};
	const addMinutes = (time, m) => { const t = (+time.slice(0, 2) * 60 + +time.slice(3) + m) % 1440; return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); };
	for (const it of itinItems().sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "") || a.id - b.id)) {
		const info = [it.provider && "Booked with: " + it.provider, it.ref && "Reference: " + it.ref, it.phone && "Phone: " + it.phone, it.url && "Link: " + it.url, it.note].filter(Boolean).join("\n");
		event("item-" + it.id, it.title, it.date, itinTimeOK(it.time) ? it.time : "", it.endTime, [it.place && `LOCATION:${esc2(it.place)}`, info && `DESCRIPTION:${esc2(info)}`], "");
		const lead = itinLead(it);
		if (lead < 0) continue;
		for (const r of itinDeadlines(it)) {
			// all-day: 9am the morning of / n days before; with a time: n days before at that time (an hour before, on the day)
			const alarm = r.time ? (lead ? `-P${lead}D` : "-PT1H") : (lead ? `-P${lead - 1}DT15H`.replace("P0DT", "PT") : "PT9H");
			event(`due-${it.id}-${r.type}`, `${ITIN_DEADLINES[r.type]}: ${it.title}`, r.date, r.time, "", [info && `DESCRIPTION:${esc2(info)}`], alarm);
		}
	}
	if (withPlan) lines.push(...shareIcsEvents(currentPlan(), esc2, stamp));
	lines.push("END:VCALENDAR");
	return lines.map(fold).join("\r\n") + "\r\n";
}
async function itinCalendar() {
	const ics = itinICS(new Date(), true), reminders = itinItems().reduce((n, it) => n + (itinLead(it) < 0 ? 0 : itinDeadlines(it).length), 0);
	const done = await shareOrDownload(new Blob([ics], { type: "text/calendar" }), "backpocket-itinerary.ics");
	if (done) showToast(done === "shared" ? "Choose Calendar to add them" : "Calendar file ready" + (reminders ? `, with ${plural(reminders, "reminder")}` : ""));
}

// ---- The sheet ----
function itinEnsure() {
	if (itinReady || document.getElementById("itin-sheet")) return;
	itinReady = true;
	document.head.insertAdjacentHTML("beforeend", "<style>" +
		"html.itin-open{overflow:hidden}html.itin-open .backdrop{opacity:1;pointer-events:auto}html.itin-open #itin-sheet{transform:none}" +
		".itin>*+*{margin-top:12px}.itin-tools{display:flex;gap:8px;flex-wrap:wrap}.itin-tools .btn-ghost{margin:0}" +
		".itin-day{padding:0 0 4px;scroll-margin-top:84px}.itin-day.past{opacity:.7}.itin-day.today{box-shadow:0 0 0 2px var(--accent)}" +
		".itin-day>header{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:12px 18px 4px;font-size:13px;color:var(--ink-2)}" +
		".itin-day>header b{display:block;font-size:15px;font-weight:600;color:var(--ink)}.itin-day>header em{font-style:normal;text-align:right;overflow-wrap:anywhere}" +
		".itin-day ol,.itin-list,.itin-reminders ul{margin:0;padding:0;list-style:none}" +
		".itin-row{display:grid;grid-template-columns:58px minmax(0,1fr);gap:10px;align-items:start;padding:2px 18px}" +
		".itin-time{padding-top:12px;font-size:14px;font-weight:500;font-variant-numeric:tabular-nums}.itin-time small{display:block;font-size:12px;font-weight:400;color:var(--ink-2)}" +
		".itin-open{display:block;width:100%;min-height:44px;padding:10px 0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}" +
		".itin-open b{display:block;font-weight:500;overflow-wrap:anywhere}.itin-open small{display:block;font-size:13px;color:var(--ink-2);overflow-wrap:anywhere}" +
		".itin-row.route .itin-open b{font-weight:400;color:var(--ink-2)}" +
		".itin-chip{display:inline-block;margin:4px 6px 0 0;padding:2px 8px;border-radius:999px;font-size:12px;background:var(--line);color:var(--ink-2)}" +
		".itin-chip.soon{background:var(--accent-tint);color:var(--ink);font-weight:500}" +
		".itin-add{display:block;margin:0 0 0 18px}" +
		".itin-reminders{padding:12px 18px}.itin-reminders h2,.itin-sub{margin:0 0 4px;font-size:15px;font-weight:600}.itin-sub{margin-top:10px}" +
		".itin-rem{display:flex;align-items:center;gap:8px}.itin-rem .itin-open{flex:1}.itin-rem.late .itin-open b{color:var(--danger,#c0392b)}" +
		"#itin-due{flex:none;width:5.5em}.itin-pair{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}" +
		"</style>");
	document.body.insertAdjacentHTML("beforeend",
		'<div class="sheet" id="itin-sheet" role="dialog" aria-modal="true" aria-labelledby="itin-title" inert><form id="itin-form" novalidate>' +
		'<div class="sheet-top"><div class="grabber"></div><div class="sheet-nav"><button type="button" class="nav-btn" id="itin-cancel">Cancel</button>' +
		'<h2 id="itin-title" tabindex="-1">New plan</h2><button type="submit" class="nav-btn primary" id="itin-submit">Add</button></div></div>' +
		'<div class="choices cols-2 field" id="itin-kind" role="radiogroup" aria-label="Type"></div>' +
		'<div class="field"><label class="field-label" for="itin-name">What</label><input class="note-input" type="text" id="itin-name" maxlength="120" autocomplete="off" enterkeyhint="next" placeholder="Cooking class, Hội An to Bà Nà Hills…"></div>' +
		'<div class="card field">' + boxRows([["itin-date", "Day", "date"], ["itin-time", "Starts", "time"], ["itin-end", "Ends", "time"], ["itin-place", "Where"]]) + "</div>" +
		'<fieldset class="field"><legend>Booking</legend><div class="choices cols-4" id="itin-status" role="radiogroup" aria-label="Booking"></div></fieldset>' +
		'<div class="card field">' + boxRows([["itin-provider", "Booked with"], ["itin-ref", "Booking reference"], ["itin-phone", "Phone", "tel"], ["itin-url", "Link", "url"]]) +
		'<div class="row"><label for="itin-due">Price<small>The whole booking</small></label><input type="text" inputmode="decimal" id="itin-due" autocomplete="off" placeholder="0"><select id="itin-due-cur" aria-label="Currency"></select></div></div>' +
		'<div class="bk-sum" id="itin-pay"></div>' +
		'<div class="field"><p class="field-label">Deadlines</p><div class="card">' +
		Object.entries(ITIN_DEADLINES).map(([t, label]) => `<div class="row"><label for="itin-d-${t}">${ITIN_SHORT[t]}</label><span class="itin-pair"><input type="date" id="itin-d-${t}" aria-label="${label}, day"><input type="time" id="itin-t-${t}" aria-label="${label}, time"></span></div>`).join("") +
		'<div class="row"><label for="itin-remind">Remind me</label><select id="itin-remind">' + ITIN_LEADS.map(([n, w]) => `<option value="${n}">${w}</option>`).join("") + "</select></div></div>" +
		'<p class="hint-text">Reminders show here and on Home. “Add to Calendar” on the itinerary puts them in your phone’s Calendar too.</p></div>' +
		'<div class="field" id="itin-docs"></div>' +
		'<div class="field"><label class="field-label" for="itin-note">Note</label><input class="note-input" type="text" id="itin-note" maxlength="500" enterkeyhint="done"></div>' +
		'<button type="button" class="btn-destructive" id="itin-delete">Delete</button></form></div>');
	$("itin-kind").innerHTML = Object.entries(ITIN_KINDS).map(([k, w]) => choice("itin-kind", k, w)).join("");
	$("itin-status").innerHTML = Object.keys(STATUS_WORDS).map(st => choice("itin-status", st, statusHtml(st))).join("");
	$("itin-form").addEventListener("submit", e => { e.preventDefault(); itinSave(); });
	$("itin-cancel").addEventListener("click", () => itinClose());
	$("itin-delete").addEventListener("click", itinDelete);
	// Capture, so the expense sheet's own backdrop handler (which would ask about an expense nobody is writing) never runs
	document.addEventListener("click", e => { if (e.target && e.target.id === "backdrop" && document.documentElement.classList.contains("itin-open")) { e.stopPropagation(); itinClose(); } }, true);
	document.addEventListener("keydown", e => {
		if (e.key === "Escape" && document.documentElement.classList.contains("itin-open") && $("dialog").hidden) { e.preventDefault(); itinClose(); }
	});
	document.addEventListener("click", e => {
		const t = e.target && e.target.closest ? e.target : null;
		if (!t) return;
		const open = t.closest("[data-itin-open]"), add = t.closest("[data-itin-add]"), done = t.closest("[data-itin-done]");
		if (open) itinOpen(open.dataset.itinOpen);
		else if (add) itinOpen(null, add.dataset.itinAdd);
		else if (done) itinDone(done.dataset.itinDone, done.dataset.type);
		else if (t.closest("[data-itin-cal]")) itinCalendar();
		else if (t.closest("[data-itin-share]")) shareItinerary();
		else if (t.closest("[data-itin-copy]")) shareItineraryText();
		else if (t.closest("[data-itin-view]")) itinGo();
	});
}
const itinSnapshot = () => JSON.stringify([...$("itin-form").querySelectorAll("input:not([type=radio]), select")].map(el => el.value), getRadio("itin-kind"), getRadio("itin-status"));

function itinOpen(id, date) {
	itinEnsure();
	bkEnsure();   // its "Log a payment" button is wired there
	const it = id == null ? null : itinFind(id);
	if (id != null && !it) return;
	const plan = currentPlan(), today = toISO(new Date()), trip = tripDates(plan);
	const day = it ? it.date : isISODate(date) ? date : today >= trip.start && today <= trip.end ? today : trip.start;
	const base = nightOf(plan.rows, day), cc = base && !base.aboard ? base.row.stop.place.cc : "";
	const code = it && it.due ? it.due.currency : currencyForCountry(cc) || HOME();
	itinEditing = { id: it ? it.id : null, it };
	setRadio("itin-kind", it ? it.kind : "activity");
	setRadio("itin-status", it ? it.status : "idea");
	const set = (k, v) => { $("itin-" + k).value = v || ""; };
	set("name", it && it.title); set("date", day); set("time", it && it.time); set("end", it && it.endTime); set("place", it && it.place);
	set("provider", it && it.provider); set("ref", it && it.ref); set("phone", it && it.phone); set("url", it && it.url); set("note", it && it.note);
	$("itin-due").value = it && it.due ? it.due.amount : "";
	$("itin-due-cur").innerHTML = [...new Set([...tripCurrencies(), code])].map(c => `<option>${c}</option>`).join("");
	$("itin-due-cur").value = code;
	for (const t of Object.keys(ITIN_DEADLINES)) {
		const d = it && it.deadlines && it.deadlines[t];
		$("itin-d-" + t).value = d ? d.date : ""; $("itin-t-" + t).value = d ? d.time || "" : "";
	}
	$("itin-remind").value = String(it ? itinLead(it) : 1);
	$("itin-title").textContent = it ? "Edit plan" : "New plan";
	$("itin-submit").textContent = it ? "Save" : "Add";
	$("itin-delete").hidden = !it;
	itinPayBox(it);
	docsMount("itin-docs", it && it.docs);
	if (!document.documentElement.classList.contains("itin-open")) {
		itinFocus = document.activeElement;
		["topbar", "main", "tabbar"].forEach(x => { $(x).inert = true; });
		$("itin-sheet").inert = false;
		document.documentElement.classList.add("itin-open");
		if (typeof fitToKeyboard === "function") fitToKeyboard();
	}
	$("itin-sheet").scrollTop = 0;
	itinSnap = itinSnapshot();
	$(it ? "itin-title" : "itin-name").focus({ preventScroll: true });
}
// The price, what is paid and left, and the button that logs a payment (the same wording as a stay's)
function itinPayBox(it) {
	const box = $("itin-pay"), b = it && bkItems().find(x => x.key === "i" + it.id);
	if (!b) { box.innerHTML = it && it.due && it.status !== "free" ? '<p class="hint-text">Save, then you can log payments here.</p>' : ""; return; }
	const parts = [`Price ${cash(it.due.amount, b.cur)}`];
	if (b.estimated) parts.push("not booked yet, so nothing is set aside");
	else parts.push(`paid ${moneyTidy(b.paid)}`, b.outstanding > 0 ? `${moneyTidy(b.outstanding)} still to pay, set aside from your budget` : "nothing left to pay");
	const unlogged = it.status === "paid" && b.owed > 0.005;
	box.innerHTML = `<p class="hint-text">${esc(parts.join(" · "))}</p>` + (unlogged ? `<p class="hint-text">Marked paid, but ${esc(cash(b.owed, b.cur))} isn't in your expenses yet.</p>` : "") +
		(b.left > 0 || unlogged ? `<button type="button" class="btn-ghost" data-bk-pay="${b.key}">Log a payment of ${esc(cash(unlogged ? b.owed : b.left, b.cur))}</button>` : "");
}
async function itinClose(force = false) {
	if (!document.documentElement.classList.contains("itin-open")) return true;
	if (!force && itinSnapshot() !== itinSnap && !(await ask(itinEditing && itinEditing.it ? "Discard your changes?" : "Discard this plan?", "What you've entered will be lost.", { ok: "Discard", cancel: "Keep editing", danger: true }))) return false;
	if ($("itin-sheet").contains(document.activeElement)) document.activeElement.blur();
	document.documentElement.classList.remove("itin-open");
	$("itin-sheet").inert = true;
	["topbar", "main", "tabbar"].forEach(x => { $(x).inert = false; });
	itinEditing = null;
	docsCancel("itin-docs");
	if (itinFocus && document.contains(itinFocus)) itinFocus.focus({ preventScroll: true });
	return true;
}
function itinError(message, id) {
	showToast(message, { tone: "error" });
	$(id).focus();
	return false;
}
function itinSave() {
	const title = $("itin-name").value.trim(), date = $("itin-date").value, time = $("itin-time").value, end = $("itin-end").value;
	if (!title) return itinError("Say what it is", "itin-name");
	if (!isISODate(date)) return itinError("Pick the day", "itin-date");
	if (end && !time) return itinError("Add a start time, or clear the end", "itin-time");
	if (end && end <= time) return itinError("It ends before it starts", "itin-end");
	const cur = $("itin-due-cur").value, price = parseAmount($("itin-due").value, cur), old = itinEditing && itinEditing.it, deadlines = {}, done = {};
	for (const t of Object.keys(ITIN_DEADLINES)) {
		const d = $("itin-d-" + t).value, tm = $("itin-t-" + t).value;
		if (tm && !d) return itinError(`${ITIN_DEADLINES[t]}: add the day`, "itin-d-" + t);
		if (!d) continue;
		deadlines[t] = { date: d, time: tm };
		const was = old && old.deadlines && old.deadlines[t];
		if (old && old.done && old.done[t] && was && was.date === d && was.time === tm) done[t] = true;   // moving a deadline brings its reminder back
	}
	const rec = itinClean({ id: old ? old.id : newId(), kind: getRadio("itin-kind") || "activity", title, date, time, endTime: end, place: $("itin-place").value, status: getRadio("itin-status") || "idea",
		provider: $("itin-provider").value, ref: $("itin-ref").value, phone: $("itin-phone").value, url: $("itin-url").value, note: $("itin-note").value,
		due: price > 0 ? { amount: price, currency: cur } : null, deadlines, done, docs: docsList("itin-docs"), remind: Number($("itin-remind").value), updatedAt: Date.now() });
	if (!rec) return itinError("That can't be saved", "itin-name");
	if (old) data.itinerary[data.itinerary.indexOf(old)] = rec; else itinWrite().push(rec);
	delete data.deleted[rec.id];
	if (!saveData()) return false;
	docsCommit("itin-docs");
	itinClose(true);
	render();
	showToast(old ? "Saved" : "Added to " + niceDate(date));
	return true;
}
async function itinDelete() {
	const it = itinEditing && itinEditing.it;
	if (!it || !(await ask(`Delete ${it.title}?`, "Expenses logged against it stay as they are.", { ok: "Delete", danger: true }))) return;
	itinClose(true);
	data.itinerary = itinList().filter(x => x !== it);
	data.deleted[it.id] = Date.now();   // so a merge can't bring it back
	itinUndo = it;
	saveData();
	render();
	showToast(`Deleted ${it.title}`, { action: "Undo", onAction: () => {
		if (!itinUndo) return;
		itinWrite().push({ ...itinUndo, updatedAt: Date.now() });
		delete data.deleted[itinUndo.id];
		itinUndo = null;
		saveData();
		render();
		showToast("Restored");
	}, duration: 7000 });
}
