// Forecast: where the trip is heading by its last day, and where each country is heading against its budget. It adds up what
// is spent and booked so far and prices the days still to come from your own habits: everyday spending (everything but
// accommodation) at the average per day so far, and nights nobody has paid or booked yet at your average per night.
// A pure reading of the saved data; nothing is stored. All money is in the home currency. Needs two days of the trip behind
// you, so it stays quiet before and after. This file loads before index.html's script and only defines functions: sw.js saves it with the app.

// The stay nights after `today` that a booking (outstanding) or a paid-ahead stay already covers
const fcCoveredNights = (items, counted, today, cc) => {
	let n = 0;
	for (const b of items) {
		if (b.kind !== "stay" || !(b.outstanding > 0) || !b.date || (cc && b.cc !== cc)) continue;
		for (let k = 0; k < b.nights; k++) if (addDays(b.date, k) > today) n++;
	}
	for (const e of counted) {
		if (e.category !== "Accommodation" || (cc && countryOf(e) !== cc)) continue;
		for (let k = 1; k < nightsOf(e); k++) if (addDays(e.date, k) > today) n++;
	}
	return n;
};

// { total, budget, projected, spent, booked, variable, lodging, rate, night, runsOutOn, countries: [{ cc, budget, spent, projected }] } or null
function forecastModel() {
	const trip = tripProgress(), today = trip.today;
	if (today < trip.start || today > trip.end || trip.elapsed < 2) return null;
	const counted = tripSpending(), plan = currentPlan(), items = bkTotals(plan).items.filter(b => !b.pre);
	if (!counted.length) return null;
	const inTrip = list => list.filter(e => e.date >= trip.start && e.date <= today);
	const rateOf = (list, days) => (days > 0 ? sumHome(list.filter(e => e.category !== "Accommodation" && !e.bookingId)) / days : 0);
	const lodging = list => {
		let cost = 0, nights = 0;
		for (const e of list) if (e.category === "Accommodation") { cost += homeValue(e); nights += nightsOf(e); }
		return nights ? cost / nights : 0;
	};
	const sofar = spentBy(counted, today), spent = sofar.upTo + sofar.ahead;
	const booked = items.reduce((s, b) => s + b.outstanding, 0);
	const left = trip.total - trip.elapsed;   // whole days after today
	const everyday = inTrip(counted).filter(e => e.category !== "Accommodation");
	const rate = rateOf(inTrip(counted), trip.elapsed), night = lodging(counted);
	const todayTopUp = Math.max(0, rate - sumHome(everyday.filter(e => e.date === today)));
	const uncovered = Math.max(0, left - fcCoveredNights(items, counted, today));
	const variable = rate * left + todayTopUp, lodgingLeft = night * uncovered;
	const projected = spent + booked + variable + lodgingLeft;
	const budget = totalBudget(), model = { budget, projected, spent, booked, variable, lodging: lodgingLeft, rate, night, runsOutOn: "", countries: [] };

	// When the money runs out at this pace (only if it does)
	const burn = rate + (left > 0 ? lodgingLeft / left : 0), room = budget - spent - booked;
	if (budget > 0 && projected > budget && burn > 0 && room > 0) {
		const days = Math.floor(room / burn), date = addDays(today, days);
		if (date < trip.end) model.runsOutOn = date;
	}

	// Each country with a budget: its own spending so far plus the days still to come there
	if (arrivalsKnown(plan)) {
		for (const cc of tripCountries()) {
			const cb = data.countryBudgets[cc] > 0 ? data.countryBudgets[cc] : 0;
			if (!cb) continue;
			const mine = counted.filter(e => countryOf(e) === cc), here = countryDays(cc, trip.start, today, plan), ahead = countryDays(cc, addDays(today, 1), trip.end, plan);
			const cSpent = sumHome(mine) , cBooked = items.filter(b => b.cc === cc).reduce((s, b) => s + b.outstanding, 0);
			const cRate = here >= 1 ? rateOf(inTrip(mine), here) : rate, cNight = lodging(mine) || night;
			const cLeft = Math.max(0, ahead - fcCoveredNights(items, mine, today, cc));
			model.countries.push({ cc, budget: cb, spent: cSpent, projected: cSpent + cBooked + cRate * ahead + cNight * cLeft });
		}
	}
	return model;
}

function forecastRender() {
	let card = document.getElementById("fc-card");
	if (!card) {
		const after = $("pace-note").closest(".card");
		after.insertAdjacentHTML("afterend", '<div class="card widget" id="fc-card" hidden><div class="widget-head"><h2>Forecast</h2><span class="aside">an estimate</span></div>' +
			'<p class="pace-caption" id="fc-head"></p><p class="pace-note" id="fc-note"></p><div id="fc-list"></div></div>');
		card = document.getElementById("fc-card");
	}
	const m = forecastModel();
	card.hidden = !m;
	if (!m) return;
	const over = m.budget > 0 ? m.projected - m.budget : 0, near = m.budget > 0 && over <= 0 && -over < 0.05 * m.budget;
	$("fc-head").textContent = !(m.budget > 0) ? `On course for about ${moneyWhole(m.projected)} by the last day`
		: over > 0.5 * homeUnit() ? `Heading for ${moneyWhole(over)} over budget` : near ? "Right on budget, with little to spare" : `On course to finish ${moneyWhole(-over)} under budget`;
	$("fc-head").className = "pace-caption" + (m.budget > 0 ? (over > 0.5 * homeUnit() ? " over" : near ? "" : " under") : "");
	const when = m.runsOutOn ? ` At this pace the money runs out around ${niceDate(m.runsOutOn)}, ${plural(daysBetween(m.runsOutOn, tripDates().end), "day")} before the end.` : "";
	$("fc-note").textContent = `${moneyWhole(m.spent)} spent` + (m.booked > 0.5 * homeUnit() ? ` and ${moneyWhole(m.booked)} still to pay on bookings` : "") +
		`, plus about ${moneyWhole(m.variable + m.lodging)} for the days to come (${moneyWhole(m.rate)} a day on everyday costs${m.lodging > 0 ? `, ${moneyWhole(m.night)} a night for stays not yet booked` : ""}).` + when;
	$("fc-list").innerHTML = m.countries.length ? `<ul class="fc-rows" style="list-style:none;margin:12px 12px 0;padding:0">` + m.countries.map(c => {
		const d = c.projected - c.budget, bad = d > 0.5 * homeUnit();
		return `<li style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line)"><span>${esc(flagOf(c.cc))} ${esc(countryName(c.cc, c.cc))}</span>` +
			`<span class="${bad ? "negative" : ""}" style="${bad ? "" : "color:var(--ink-2)"}">${bad ? `${moneyWhole(d)} over` : `${moneyWhole(-d)} spare`} <small>of ${moneyWhole(c.budget)}</small></span></li>`;
	}).join("") + `</ul>` : "";
}
