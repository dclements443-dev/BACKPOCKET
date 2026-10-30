// Bookings and the budget. A stay's or a journey's price (its `due`, { amount, currency }) is split four ways:
//   estimated   a price on something not booked yet: shown, never set aside
//   committed   the price of something booked or paid
//   paid        the part of it that is spending already: payments logged against the booking (expense.bookingId), or all of it once marked Paid
//   outstanding committed minus paid: set aside, so Budget left and the daily figure are lower by it
// A payment is an ordinary expense, so it counts as spending the moment it is logged and leaves the outstanding part by the
// same amount: nothing is counted twice. Deleting the expense puts the money back to outstanding. Only this file knows the
// rules; index.html keeps one number from it (bkReserved) and a few calls. sw.js saves it with the app and it loads before
// index.html's script.
let bkPay = "";   // the booking the expense sheet is about to pay towards ("s12" a stay, "l7" a journey), set by bkPayNow
const bkNow = () => toISO(new Date());
const bkHome = (amount, cur) => (cur === HOME() ? amount : amount / (rateForSave(cur, bkNow(), null).rate || 1));

// One booking with a price: { key, kind, label, date, cc, nights, cur, status, total, paid, outstanding, estimated, left, logged, pre }
// (money in your home currency, except `left` and `logged`, which are in the booking's own currency)
function bkCore(key, kind, rec, label, date, cc, nights, plan, cat) {
	const d = rec && rec.due;
	if (!d || !(d.amount > 0) || !rec.status || rec.status === "free") return null;
	const cur = d.currency, unit = bkHome(1, cur), booked = isBooked(rec.status);
	const logged = data.expenses.filter(e => e.bookingId === key).reduce((sum, e) => sum + (e.currency === cur ? e.amount : homeValue(e) / unit), 0);
	const left = !booked || rec.status === "paid" ? 0 : Math.max(0, d.amount - logged), total = bkHome(d.amount, cur);
	return { key, kind, cur, status: rec.status, date, cc, nights, label, cat, estimated: booked ? 0 : total, total: booked ? total : 0,
		outstanding: bkHome(left, cur), paid: booked ? total - bkHome(left, cur) : 0, left, logged, owed: Math.max(0, d.amount - logged),
		pre: Boolean(date) && date < plan.start };
}
function bkOne(kind, rec, row, plan) {
	if (!rec) return null;
	const stay = kind === "stay", date = stay ? row.arrive : legDateOf(row);
	return bkCore((stay ? "s" : "l") + (stay ? row.stop.id : rec && rec.id), kind, rec, stay ? rec.name || stopName(row.stop) : `${stopName(row.from)} → ${stopName(row.stop)}`,
		date, row.stop.place.cc, stay && Number.isInteger(row.stop.nights) ? row.stop.nights : 1, plan);
}
// An itinerary item with a price: its day, and the country you are in that night
function bkItem(it, plan) {
	const night = nightOf(plan.rows, it.date);
	return bkCore("i" + it.id, "item", it, it.title, it.date, night && !night.aboard ? night.row.stop.place.cc : "", 1, plan, ITIN_CATEGORY[it.kind]);
}
function bkItems(plan = currentPlan()) {
	const items = [];
	for (const row of plan.rows) {
		const stay = !row.stop.home && bkOne("stay", row.stop.stay, row, plan), leg = row.leg && row.from && bkOne("leg", row.leg, row, plan);
		if (stay) items.push(stay);
		if (leg) items.push(leg);
	}
	for (const it of itinItems()) { const b = bkItem(it, plan); if (b) items.push(b); }
	return items;
}
// { estimated, committed, paid, outstanding, reserved, items }: reserved = the outstanding part that counts against the trip budget
// (a booking dated before the trip starts is "Before the trip", which the trip budget leaves out)
function bkTotals(plan = currentPlan()) {
	const items = bkItems(plan), sum = (list, field) => list.reduce((s, b) => s + b[field], 0);
	return { items, estimated: sum(items, "estimated"), committed: sum(items, "total"), paid: sum(items, "paid"), outstanding: sum(items, "outstanding"),
		reserved: sum(items.filter(b => !b.pre), "outstanding") };
}
const bkReserved = () => bkTotals().reserved;

// ---- The sheet ----
// A journey's price row (a stay's is in index.html), and what's paid and left, with the button that logs a payment
function bkEnsure() {
	if (document.getElementById("bk-stay")) return;
	document.head.insertAdjacentHTML("beforeend", "<style>#leg-due{flex:none;width:5.5em}.bk-sum{margin-top:8px}.bk-sum p{margin:0 0 8px}</style>");
	$("leg-rows").insertAdjacentHTML("beforeend", '<div class="row"><label for="leg-due">Price<small>The whole booking</small></label>' +
		'<input type="text" inputmode="decimal" id="leg-due" autocomplete="off" placeholder="0"><select id="leg-due-cur" aria-label="Currency"></select></div>');
	$("stay-rows").insertAdjacentHTML("afterend", '<div class="bk-sum" id="bk-stay"></div>');
	$("leg-rows").insertAdjacentHTML("afterend", '<div class="bk-sum" id="bk-leg"></div>');
	document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-bk-pay]"); if (b) bkPayNow(b.dataset.bkPay); });
}
// Called as the stop or journey sheet opens (pf says which)
function bkSheet() {
	bkEnsure();
	const stop = pf.kind === "stop", rec = stop ? pf.stop && pf.stop.stay : pf.leg;
	if (!stop) {
		const code = rec && rec.due ? rec.due.currency : currencyForCountry(pf.to.place.cc) || HOME();
		$("leg-due").value = rec && rec.due ? rec.due.amount : "";
		$("leg-due-cur").innerHTML = [...new Set([...tripCurrencies(), code])].map(c => `<option>${c}</option>`).join("");
		$("leg-due-cur").value = code;
	}
	const id = stop ? pf.stop && pf.stop.id : pf.leg && pf.leg.id, box = $(stop ? "bk-stay" : "bk-leg"), other = $(stop ? "bk-leg" : "bk-stay");
	other.innerHTML = "";
	const b = rec && id != null && bkItems().find(x => x.key === (stop ? "s" : "l") + id);
	if (!b) { box.innerHTML = rec && rec.due && rec.status !== "free" ? '<p class="hint-text">Save, then you can log payments here.</p>' : ""; return; }
	const parts = [`Price ${cash(rec.due.amount, b.cur)}`];
	if (b.estimated) parts.push("not booked yet, so nothing is set aside");
	else parts.push(`paid ${moneyTidy(b.paid)}`, b.outstanding > 0 ? `${moneyTidy(b.outstanding)} still to pay, set aside from your budget` : "nothing left to pay");
	const unlogged = rec.status === "paid" && b.owed > 0.005;
	box.innerHTML = `<p class="hint-text">${esc(parts.join(" · "))}</p>` + (unlogged ? `<p class="hint-text">Marked paid, but ${esc(cash(b.owed, b.cur))} isn't in your expenses yet.</p>` : "") +
		(b.left > 0 || unlogged ? `<button type="button" class="btn-ghost" data-bk-pay="${b.key}">Log a payment of ${esc(cash(unlogged ? b.owed : b.left, b.cur))}</button>` : "");
}
// A journey's price from its sheet: set on the journey, or taken off it when the box is empty
function bkLegDue(leg) {
	const code = $("leg-due-cur").value, n = parseAmount($("leg-due").value, code);
	if (n > 0) leg.due = { amount: n, currency: code }; else delete leg.due;
}

// Open the expense sheet filled in as a payment towards a booking; saving it links the expense to the booking
async function bkPayNow(key) {
	const b = bkItems().find(x => x.key === key);
	if (!b || !(await (b.kind === "item" ? itinClose() : closePlanSheet()))) return;
	newExpense();
	const date = b.date || bkNow(), stay = b.kind === "stay", country = b.cc || defaultCountry(date), category = b.cat || (stay ? "Accommodation" : "Transport");
	const payer = getRadio("payer"), who = forIds();   // drawing the choices again forgets who paid and who it was for
	renderChoices({ currency: b.cur, country, category });
	setRadio("payer", payer); setForSet(who);
	$("date").value = date;
	$("amount").value = Math.round((b.status === "paid" ? b.owed : b.left) * 100) / 100;
	$("note").value = "Payment: " + b.label;
	setRadio("currency", b.cur); setRadio("country", country); setRadio("category", category);
	formNights = stay ? Math.max(1, Math.min(365, b.nights)) : 1;
	currencyTouched = countryTouched = true;
	bkPay = key;
	updateSheetFields();
	updateDateLabel();
	updateZerosButton();
	updateNightsField();
	updateConverted();
	updateSplitSummary();
	updateWalletEffect();
	refreshRates([date]);
}

// ---- Home ----
// Four figures under the pace card, once any booking has a price
function bkRenderHome() {
	let card = document.getElementById("bk-card");
	if (!card) {
		const after = $("pace-note").closest(".card");
		after.insertAdjacentHTML("afterend", '<div class="card widget" id="bk-card" hidden><div class="widget-head"><h2>Bookings</h2></div>' +
			'<div class="stats" id="bk-stats"></div><p class="pace-note" id="bk-note"></p></div>');
		card = document.getElementById("bk-card");
	}
	const t = bkTotals(), any = t.items.length > 0;
	card.hidden = !any;
	if (!any) return;
	const stat = (label, n, sub) => `<div class="stat"><span>${label}</span><strong>${esc(moneyFit(n))}</strong><small>${sub}</small></div>`;
	$("bk-stats").innerHTML = stat("Estimated", t.estimated, "not set aside") + stat("Committed", t.committed, "booked") + stat("Paid", t.paid, "in spending") + stat("To pay", t.outstanding, "set aside");
	const pre = t.outstanding - t.reserved;
	$("bk-note").textContent = `${moneyTidy(t.outstanding)} still to pay is kept out of Budget left until you log the payments.` + (pre > 0.5 * homeUnit() ? ` ${moneyTidy(pre)} of it is before the trip, which the trip budget leaves out.` : "");
}
