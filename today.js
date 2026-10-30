// The Today card on Home, shown on the days of the trip: where you are tonight, what is left to spend today, the cash in your
// wallet, the reminders and plans for the day, and your usual purchases one tap away (a tap opens the Add sheet filled in
// from last time). It replaces "Coming up" while it is showing, so nothing appears twice. Reads the saved data and stores nothing.
// This file loads before index.html's script and only defines functions: sw.js saves it with the app.
let todayRegulars = [];

// The wallet that matters today: yours, in the money of the country you are in (else the first you hold). null with no cash tracked.
function todayCash(today) {
	const mine = data.meId, held = cashCurrencies().filter(c => hasCashData(mine, c));
	if (!held.length) return null;
	const here = countryOn(today), want = isCC(here) ? currencyForCountry(here) : "";
	const cur = held.includes(want) ? want : held[0], balance = cashBalance(mine, cur), days = cashDaysLeft(cur, balance, [roleOf(mine)]);
	return { cur, balance, days };
}

function todayRender() {
	let card = document.getElementById("today-card");
	if (!card) {
		if (!document.getElementById("today-css")) document.head.insertAdjacentHTML("beforeend", `<style id="today-css">.today-chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0;padding:0 12px}#today-list{padding:0 12px}.today-chips button{min-height:44px;padding:0 14px;border:0;border-radius:22px;background:var(--btn-2-bg);color:var(--btn-2-ink);font:inherit;font-size:15px;font-weight:500}.today-chips small{margin-left:6px;opacity:.75}#today-card .itin-list{margin-top:12px}</style>`);
		document.querySelector("#view-home .hero").insertAdjacentHTML("afterend", '<div class="card widget" id="today-card" hidden><div class="widget-head"><h2>Today</h2><span class="aside" id="today-where"></span></div>' +
			'<div class="stats" id="today-stats"></div><div class="today-chips" id="today-chips"></div><div id="today-list"></div></div>');
		card = document.getElementById("today-card");
		card.addEventListener("click", e => {
			const chip = e.target.closest ? e.target.closest("[data-today-regular]") : null;
			if (!chip || !todayRegulars[+chip.dataset.todayRegular]) return;
			const regular = todayRegulars[+chip.dataset.todayRegular];
			newExpense();
			useRegular(regular);
		});
	}
	const trip = tripProgress(), today = trip.today, itin = document.getElementById("itin-card");
	const live = today >= trip.start && today <= trip.end && Boolean(data.stops.length || data.expenses.length || data.cashMoves.length || totalBudget() > 0 || itinItems().length);   // not on a trip with nothing in it
	card.hidden = !live;
	if (!live) return;
	if (itin) itin.hidden = true;   // this card carries its reminders and plans
	const plan = currentPlan(), allowance = dailyAllowance(), cash = todayCash(today);
	const where = itinWhere(plan, today);
	$("today-where").innerHTML = where;
	const stat = (label, big, sub) => `<div class="stat"><span>${label}</span><strong>${esc(big)}</strong><small>${esc(sub)}</small></div>`;
	const spentToday = spentBy(tripSpending(), today, today).upTo;
	const money = allowance && allowance.allowance > 0
		? stat(allowance.left >= 0 ? "Left today" : "Over today", moneyWhole(Math.abs(allowance.left)), `of ${moneyWhole(allowance.allowance)} · ${moneyWhole(allowance.spentToday)} spent`)
		: stat("Spent today", moneyWhole(spentToday), allowance ? "" : "set a budget for a daily limit");
	const wallet = cash ? stat("Cash", cashShort(cash.balance, cash.cur), cash.balance < 0 ? "count your wallet" : cash.days !== null ? `about ${cash.days < 1 ? "less than a day" : plural(Math.round(cash.days), "day")} left` : currencyName(cash.cur))
		: stat("Day", `${trip.elapsed} of ${trip.total}`, trip.left > 1 ? `${plural(trip.left - 1, "day")} to go` : "last day");
	$("today-stats").innerHTML = money + wallet;
	todayRegulars = regularsFor(defaultCountry(today)).slice(0, 4);
	$("today-chips").hidden = !todayRegulars.length;
	$("today-chips").innerHTML = todayRegulars.map((e, i) => `<button type="button" data-today-regular="${i}">${esc(e.note)}<small>${esc(cashShort(e.amount, e.currency))}</small></button>`).join("");
	const rems = itinReminders(today).slice(0, 3), items = itinEntries(plan, today);
	$("today-list").innerHTML = (rems.length ? `<ul class="itin-list">${rems.map(itinReminderHtml).join("")}</ul>` : "") +
		(items.length ? `<p class="itin-sub">On today</p><ul class="itin-list">${items.map(e => itinEntryHtml(e, today)).join("")}</ul>` : "") +
		`<button type="button" class="link" data-itin-view>${items.length || rems.length ? "Open the itinerary" : "Plan today in the itinerary"}</button>`;
}
