// A readable copy of the plan to send to someone who doesn't have the app: plain text and a one-file web page (opens anywhere, prints
// to PDF), plus the stays and journeys as calendar events. Everything is built from shareModel, so the two copies always agree.
const plainOf = html => String(html).replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const shareStatus = st => (st === "booked" || st === "paid" || st === "free" ? STATUS_WORDS[st] : "");
const shareDocs = list => { const d = docsClean(list); return d.length ? "Documents: " + d.map(x => x.name).join(", ") : ""; };
const shareFlag = cc => (isCC(cc) ? flagOf(cc) + " " : "");

// { title, range, days: [{ date, label, where, entries: [{ time, head, lines }] }] }
function shareModel(plan = currentPlan(), name = "") {
	const trip = tripDates(plan), dates = new Set();
	itinItems().forEach(it => dates.add(it.date));
	for (let d = plan.start, n = 0; d <= trip.end && n < 400; d = addDays(d, 1), n++) dates.add(d);
	const days = [...dates].sort().slice(0, 400).map(d => {
		const n = d >= plan.start ? daysBetween(plan.start, d) + 1 : 0, night = nightOf(plan.rows, d);
		const where = night ? (night.aboard ? `night on the ${ABOARD_WORDS[night.row.leg.mode] || "move"} to ${placeName(night.row.stop)}`
			: `${shareFlag(night.row.stop.place.cc)}${placeName(night.row.stop)} · night ${night.n}${night.of ? " of " + night.of : ""}`)
			: plan.rows.some((r, i) => i && r.stop.home && r.arrive === d) ? "Back home" : "";
		return { date: d, label: (n ? "Day " + n + " · " : "") + niceDate(d), where, entries: itinEntries(plan, d).map(e => shareEntry(e)) };
	}).filter(day => day.entries.length || day.where);
	const nights = plan.rows.every(r => r.depart) ? daysBetween(plan.start, trip.end) : 0;
	return { title: name || "Itinerary", range: `${niceDate(trip.start)} – ${niceDate(trip.end)}${nights ? " · " + plural(nights, "night") : ""}`, days };
}
function shareEntry(e) {
	if (e.type === "item") {
		const it = e.item, lines = [it.place, it.provider && "Booked with " + it.provider, it.ref && "Ref " + it.ref, it.phone && "Phone " + it.phone, it.url, shareStatus(it.status),
			it.due && "Price " + cash(it.due.amount, it.due.currency), ...itinDeadlines(it).map(r => `${ITIN_DEADLINES[r.type]} ${niceDate(r.date, "short")}${r.time ? " " + r.time : ""}`),
			it.note, shareDocs(it.docs)].filter(Boolean);
		return { time: e.time + (itinTimeOK(it.endTime) && e.time ? "–" + it.endTime : ""), head: it.title, lines };
	}
	const row = e.row, stay = row.stop.stay, leg = row.leg;
	if (e.type === "leg") {
		const arrives = itinTimeOK(leg.arriveAt) ? `Arrives ${leg.arriveAt}${jdSpan(leg) ? " on " + niceDate(row.arrive) : ""} (local time)` : "";
		return { time: e.time, head: `${MODES[modeOf(leg)].short} ${placeName(row.from)} → ${placeName(row.stop)}`,
			lines: [arrives, leg.operator, leg.ref && "Ref " + leg.ref, leg.seat && "Seat " + leg.seat, shareStatus(leg.status), leg.note, shareDocs(leg.docs)].filter(Boolean) };
	}
	return { time: e.time, head: `${e.type === "in" ? "Check in" : "Check out"} · ${stay.name || placeName(row.stop)}`,
		lines: e.type === "out" ? [shareDocs(stay.docs)].filter(Boolean) : [stay.address, stay.phone && "Phone " + stay.phone, stay.ref && "Ref " + stay.ref, stay.platform && "Booked on " + stay.platform, stay.url,
			stay.cancelBy && "Free cancellation until " + niceDate(stay.cancelBy, "short"), shareStatus(stay.status), stay.note, shareDocs(stay.docs)].filter(Boolean) };
}
function shareText(model = shareModel()) {
	const out = [model.title.toUpperCase(), model.range, ""];
	for (const day of model.days) {
		out.push(day.label + (day.where ? " — " + day.where : ""));
		for (const en of day.entries) {
			out.push("  " + (en.time ? en.time.padEnd(11) : "".padEnd(11)) + en.head);
			en.lines.forEach(l => out.push("  " + "".padEnd(11) + l));
		}
		out.push("");
	}
	return out.join("\n").replace(/\n+$/, "\n");
}
function shareHtml(model = shareModel()) {
	const days = model.days.map(day => `<section><h2>${esc(day.label)}${day.where ? `<small>${esc(day.where)}</small>` : ""}</h2>` + (day.entries.length ? "<ul>" + day.entries.map(en =>
		`<li><span class="t">${esc(en.time)}</span><div><b>${esc(en.head)}</b>${en.lines.map(l => `<div class="l">${/^https?:\/\//.test(l) ? `<a href="${esc(l)}">${esc(l)}</a>` : esc(l)}</div>`).join("")}</div></li>`).join("") + "</ul>" : "") + "</section>").join("");
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(model.title)}</title><style>` +
		"body{font:16px/1.45 -apple-system,system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px;color:#111}h1{margin:0}p.r{margin:2px 0 20px;color:#555}" +
		"section{break-inside:avoid;border-top:1px solid #ddd;padding:12px 0}h2{font-size:17px;margin:0 0 6px}h2 small{display:block;font-size:14px;font-weight:400;color:#555}" +
		"ul{list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:84px 1fr;gap:8px;padding:4px 0}.t{font-variant-numeric:tabular-nums;color:#333}.l{font-size:14px;color:#444;overflow-wrap:anywhere}" +
		"footer{margin-top:24px;font-size:12px;color:#777}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}p.r,.l,.t,h2 small{color:#bbb}section{border-color:#333}}" +
		`</style></head><body><h1>${esc(model.title)}</h1><p class="r">${esc(model.range)}</p>${days}<footer>Made with Backpocket. Times are local to each place.</footer></body></html>`;
}
const shareSlug = () => ((typeof tripsName === "function" ? tripsName() : "") || "trip").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "trip";
async function shareItinerary() {
	const model = shareModel(currentPlan(), typeof tripsName === "function" ? tripsName() : "");
	const done = await shareOrDownload(new Blob([shareHtml(model)], { type: "text/html" }), `${shareSlug()}-itinerary.html`);
	if (done) showToast(done === "shared" ? "Itinerary shared" : "Itinerary file ready");
}
async function shareItineraryText() {
	const text = shareText(shareModel(currentPlan(), typeof tripsName === "function" ? tripsName() : ""));
	try { await navigator.clipboard.writeText(text); showToast("Itinerary copied"); return; } catch (err) { /* no clipboard here: send it as a file */ }
	const done = await shareOrDownload(new Blob([text], { type: "text/plain" }), `${shareSlug()}-itinerary.txt`);
	if (done) showToast("Itinerary file ready");
}

// ---- Calendar: where you sleep (all-day, check-in to check-out) and each journey ----
// A journey between two places whose time zones are known is written in UTC, so the calendar shows it right in both; otherwise as the clock reads.
function shareIcsEvents(plan, esc2, stamp) {
	const out = [], day = d => d.replace(/-/g, ""), local = (d, t) => day(d) + "T" + t.replace(":", "") + "00", utc = ms => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
	const ev = (uid, summary, startLines, extra) => out.push("BEGIN:VEVENT", `UID:${uid}@backpocket`, `DTSTAMP:${stamp}`, `SUMMARY:${esc2(summary)}`, ...startLines, ...extra.filter(Boolean), "END:VEVENT");
	plan.rows.forEach((row, i) => {
		const stay = !row.stop.home && row.stop.stay, leg = i && row.leg;
		if (stay && (stay.name || stay.checkIn) && row.arrive && row.depart) {
			const info = [stay.ref && "Reference: " + stay.ref, stay.phone && "Phone: " + stay.phone, stay.checkIn && "Check-in from " + stay.checkIn, stay.checkOut && "Check-out by " + stay.checkOut, stay.url && "Link: " + stay.url, stay.note].filter(Boolean).join("\n");
			ev("stay-" + row.stop.id, "Stay: " + (stay.name || placeName(row.stop)), [`DTSTART;VALUE=DATE:${day(row.arrive)}`, `DTEND;VALUE=DATE:${day(row.depart)}`],
				[(stay.address || placeName(row.stop)) && `LOCATION:${esc2(stay.address || placeName(row.stop))}`, info && `DESCRIPTION:${esc2(info)}`]);
		}
		const left = leg && legDateOf(row);
		if (left) {
			const title = `${MODES[modeOf(leg)].short}: ${placeName(row.from)} to ${placeName(row.stop)}`;
			const info = [leg.operator, leg.ref && "Reference: " + leg.ref, leg.seat && "Seat: " + leg.seat, leg.note].filter(Boolean).join("\n");
			let start;
			if (!itinTimeOK(leg.departAt)) start = [`DTSTART;VALUE=DATE:${day(left)}`, `DTEND;VALUE=DATE:${day(addDays(left, 1))}`];
			else {
				const a = jdUtc(left, leg.departAt, row.from.place.tz), b = itinTimeOK(leg.arriveAt) ? jdUtc(row.arrive, leg.arriveAt, row.stop.place.tz) : null;
				if (a !== null && b !== null && b > a) start = [`DTSTART:${utc(a)}Z`, `DTEND:${utc(b)}Z`];
				else if (itinTimeOK(leg.arriveAt) && (row.arrive > left || leg.arriveAt > leg.departAt)) start = [`DTSTART:${local(left, leg.departAt)}`, `DTEND:${local(row.arrive, leg.arriveAt)}`];
				else start = [`DTSTART:${local(left, leg.departAt)}`, `DTEND:${local(left, String(Math.min(23, +leg.departAt.slice(0, 2) + 1)).padStart(2, "0") + leg.departAt.slice(2))}`];
			}
			ev("leg-" + leg.id, title, start, [info && `DESCRIPTION:${esc2(info)}`]);
		}
	});
	return out;
}
