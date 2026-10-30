// Journey dates across time zones. A journey leaves on one local date and lands on another: nights slept on board
// (`aboard`) plus a `dateShift` of -1..+2 days for the clocks and the date line (Sydney 07:00 Tue -> Honolulu Mon evening is -1).
const JD_SHIFTS = [-1, 0, 1, 2];
const jdShift = leg => { const s = Math.round(Number(leg && leg.dateShift)); return s >= -1 && s <= 2 ? s : 0; };
// Calendar days between the local departure date and the local arrival date
const jdSpan = leg => ((leg && leg.aboard) || 0) + jdShift(leg);
const jdSigned = n => (n > 0 ? "+" + n : n < 0 ? "−" + -n : "");

// Minutes the zone is ahead of UTC at that instant, or null if the zone name isn't known
function jdOffsetMin(tz, ms) {
	try {
		const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
			hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
		return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000) / 60000);
	} catch (e) { return null; }
}
// "YYYY-MM-DD" + "HH:MM" on a zone's wall clock, as a UTC time in ms (null if unknown)
function jdUtc(date, time, tz) {
	const d = /^(\d{4})-(\d\d)-(\d\d)$/.exec(date || ""), t = /^(\d\d):(\d\d)$/.exec(time || "");
	if (!d || !t || !tz) return null;
	const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
	let off = jdOffsetMin(tz, wall);
	if (off === null) return null;
	off = jdOffsetMin(tz, wall - off * 60000);   // once more, in case the first guess landed across a clock change
	return off === null ? null : wall - off * 60000;
}
// Minutes between leaving and landing, from the two local times, the leaving date and the zones. null if anything is missing.
function jdElapsedMin(leg, departDate, fromTz, toTz) {
	if (!leg || !departDate) return null;
	const a = jdUtc(departDate, leg.departAt, fromTz), arrDate = new Date(Date.parse(departDate + "T00:00:00Z") + jdSpan(leg) * 864e5).toISOString().slice(0, 10);
	const b = jdUtc(arrDate, leg.arriveAt, toTz);
	return a === null || b === null ? null : Math.round((b - a) / 60000);
}
// One line for a journey's sheet and row: "Leaves 22:00 · lands 17:00 +0 · 14 h on the move", or a warning when it adds up to nothing
function jdNote(leg, departDate, fromTz, toTz) {
	const m = jdElapsedMin(leg, departDate, fromTz, toTz);
	if (m === null) return "";
	if (m <= 0) return "Check the dates: this lands before it leaves";
	return `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""} door to door by the clocks`;
}
