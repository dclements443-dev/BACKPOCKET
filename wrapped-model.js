// The numbers behind Trip Wrapped (what the story slides and the share card say). A separate file so index.html stays small;
// sw.js saves it with the app and it loads before index.html's script, so these functions are there when Wrapped opens.
		// Every number the story needs, worked out once. The only function here that reads your data.
		function wrapModel(mode, extra = {}) {
			const scope = wrapScope(mode);
			const t = tripProgress();
			const keep = x => mode === "preview" || !x.example;   // example entries never count in your real story
			const ALL = spending().filter(keep);
			const L = ALL.filter(e => e.country !== PRE_TRIP);          // the trip itself (Home's "spent")
			const PRE = ALL.filter(e => e.country === PRE_TRIP);
			const ITEMS = L.filter(e => !e.isFee);                      // things you logged (fees are worked out)
			const REAL = ITEMS.filter(e => (e.note || "").trim() !== UNTRACKED_NOTE);
			const MOVES = data.cashMoves.filter(m => keep(m) && m.kind !== "count" && (m.country || "") !== PRE_TRIP);
			const total = sumHome(L);
			// During the trip: the nights so far (a week paid for ahead isn't spent yet), as on Home
			const perDay = scope.days ? (mode === "sofar" ? spentBy(L, scope.asOf, t.start).upTo : sumHome(L.filter(e => e.date >= t.start && e.date <= t.end))) / scope.days : 0;
			// During the trip, things booked for later (next week's hotel) aren't places you've been yet
			const SOFAR = mode === "sofar" ? ITEMS.filter(e => e.date <= scope.asOf) : ITEMS;

			// The route: the plan's countries in order (cc, and c for its name), with their days when the plan is dated
			const plan = currentPlan();
			let countries = tripCountries().filter(cc => SOFAR.some(e => ccOf(e) === cc))
				.map(cc => ({ cc, c: countryName(cc, cc), gbp: sumHome(L.filter(e => ccOf(e) === cc)), daysIn: null }));
			if (countries.length && arrivalsKnown(plan)) {
				countries.forEach(x => { x.daysIn = countryDays(x.cc, scope.start, scope.asOf, plan); });
				if (mode === "sofar") countries = countries.filter(x => x.daysIn > 0);
			}

			// Local money
			const byCur = {};
			for (const e of SOFAR) {
				const r = byCur[e.currency] || (byCur[e.currency] = { code: e.currency, native: 0, gbp: 0, n: 0 });
				r.native += e.amount; r.gbp += homeValue(e); r.n++;
			}
			const currencies = Object.values(byCur).sort((a, b) => (a.code === HOME()) - (b.code === HOME()) || b.gbp - a.gbp);
			// Millionaires: the local money with the most zeros, if you spent a million of it
			const biggest = currencies.filter(c => c.code !== HOME()).sort((a, b) => b.native - a.native)[0];
			const millions = biggest ? Math.floor(biggest.native / 1e6) : 0;

			// Categories (fees and old categories land in Other, as in the Insights ring) and the travel personality
			const cats = CATEGORIES.map(name => ({ name, gbp: 0, pct: 0 }));
			for (const [name, value] of Object.entries(groupTotals(L, "category"))) (cats.find(c => c.name === name) || cats[cats.length - 1]).gbp += value;
			cats.forEach(c => { c.pct = total ? (c.gbp / total) * 100 : 0; });
			const personaCat = cats.filter(c => ["Food", "Transport", "Activities", "Nightlife"].includes(c.name) && c.gbp > 0).sort((a, b) => b.gbp - a.gbp)[0];
			const beds = cats.find(c => c.name === "Accommodation");
			const night = cats.find(c => c.name === "Nightlife");
			cats.sort((a, b) => b.gbp - a.gbp);
			const persona = personaCat ? personaCat.name : "Nesters";

			// The regular: the note you logged most often ("Bánh mì", "banh mi" and "Banh Mi" are one)
			const norm = s => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/\s+/g, " ");
			const groups = {};
			for (const e of REAL) {
				const note = (e.note || "").trim();
				if (!note) continue;
				const g = groups[norm(note)] || (groups[norm(note)] = { count: 0, gbp: 0, native: 0, spell: {}, currencies: new Set(), min: Infinity, max: 0, cats: {} });
				g.count++; g.gbp += homeValue(e); g.native += e.amount;
				const sp = g.spell[note] || (g.spell[note] = { n: 0, last: "" });
				sp.n++; if (e.date >= sp.last) sp.last = e.date;
				g.currencies.add(e.currency);
				g.min = Math.min(g.min, e.amount); g.max = Math.max(g.max, e.amount);
				g.cats[e.category] = (g.cats[e.category] || 0) + 1;
			}
			const ranked = Object.values(groups).map(g => {
				const label = Object.entries(g.spell).sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last))[0][0];
				const category = Object.entries(g.cats).sort((a, b) => b[1] - a[1])[0][0];
				const currency = g.currencies.size === 1 ? [...g.currencies][0] : null;
				return { label, count: g.count, gbp: g.gbp, native: g.native, currency, min: g.min, max: g.max, category, avgGBP: g.gbp / g.count };
			}).sort((a, b) => b.count - a.count || b.gbp - a.gbp);
			const regular = ranked.find(r => r.count >= 3 && (r.category === "Food" || r.category === "Nightlife")) || ranked.find(r => r.count >= 3) || null;
			const top5 = ranked.filter(r => r.count >= 2).slice(0, 5);

			// Biggest and thriftiest days (hotel stays spread over their nights, as in the Insights chart)
			const series = dailySeries(L).days.filter(d => d.date <= scope.asOf);
			const days = { series, big: null, why: [], mostly: false, thrifty: null };
			const spendDays = series.filter(d => d.total > 0);
			if (spendDays.length >= 4) {
				const big = spendDays.reduce((a, b) => (b.total > a.total ? b : a));
				const covering = REAL.filter(e => big.date >= e.date && big.date <= addDays(e.date, nightsOf(e) - 1))
					.map(e => ({ e, share: homeValue(e) / nightsOf(e) })).sort((a, b) => b.share - a.share);
				Object.assign(days, { big, why: covering.slice(0, 2), mostly: covering.length > 0 && covering[0].share >= 0.5 * big.total });
				if (!covering.length) days.big = null;   // a day that's all untracked cash has no story to tell
				const byDay = {};
				for (const e of REAL) {
					if (e.category === "Accommodation" || e.date < scope.start || e.date > scope.asOf) continue;
					(byDay[e.date] || (byDay[e.date] = [])).push(e);
				}
				const options = Object.entries(byDay).filter(([d, list]) => list.length >= 2 && d !== big.date && !(d === t.today && t.today <= t.end));
				if (options.length) {
					const [date, list] = options.map(([d, l]) => [d, l]).sort((a, b) => sumHome(a[1]) - sumHome(b[1]))[0];
					days.thrifty = { date, items: list, total: sumHome(list) };
				}
			}

			// Christmas Day and New Year's Eve
			const holidays = [];
			for (let d = scope.start; d <= scope.asOf; d = addDays(d, 1)) {
				const md = d.slice(5);
				if (md !== "12-25" && md !== "12-31") continue;
				const items = REAL.filter(e => e.date === d && e.category !== "Accommodation");
				const sum = sumHome(items);
				if (!(items.length >= 2 || sum >= 5 * homeUnit())) continue;
				const one = new Set(items.map(e => e.currency)).size === 1 ? items[0].currency : null;
				const counts = {};
				items.forEach(e => { counts[countryOf(e)] = (counts[countryOf(e)] || 0) + 1; });
				const here = countryOnIn(plan, d);
				const where = here && here !== PRE_TRIP ? here : Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
				const nights = items.filter(e => e.category === "Nightlife");
				holidays.push({
					date: d, kind: md === "12-25" ? "xmas" : "nye", total: sum, cc: where, place: countryLabel(where),
					local: one ? items.reduce((s, e) => s + e.amount, 0) : null, currency: one,
					star: items.reduce((a, b) => (homeValue(b) > homeValue(a) ? b : a)),
					night: { gbp: sumHome(nights), local: one ? nights.reduce((s, e) => s + e.amount, 0) : null },
					year: Number(d.slice(0, 4)) + 1
				});
			}

			// Teamwork: who reached for the wallet (never who owes whom)
			const led = ledgerOf(ALL, data.payments.filter(keep)), times = {}, me = data.meId, other = idOf("partner");
			ALL.forEach(e => { if (!e.isFee && (e.note || "").trim() !== UNTRACKED_NOTE) times[idOf(e.paidBy)] = (times[idOf(e.paidBy)] || 0) + 1; });
			const allGBP = sumHome(ALL);
			const people = data.travellers.map(t => ({ id: t.id, paid: led.paid[t.id] || 0, times: times[t.id] || 0 })).filter(p => p.paid > 0).sort((a, b) => b.paid - a.paid);
			const treats = ALL.filter(e => { const a = allocOf(e); return !e.isFee && a.o > 0 && !(a.share[idOf(e.paidBy)] > 0); });
			const team = soloId() || data.travellers.filter(t => !t.child).length < 2 ? null : {
				paid: { me: led.paid[me] || 0, partner: led.paid[other] || 0 }, paidSum: people.reduce((sum, p) => sum + p.paid, 0),
				times: { me: times[me] || 0, partner: times[other] || 0 }, people,
				sharedPct: allGBP ? (sumHome(ALL.filter(e => owedShare(e) > 0)) / allGBP) * 100 : 0,
				treat: treats.length ? treats.reduce((a, b) => (homeValue(b) > homeValue(a) ? b : a)) : null,
				square: mode === "final" && allSquare(led.net),
				merged: mode === "preview" || Boolean(data.partnerDeviceId)
			};

			// The small print: a receipt of odd facts, first 7 that apply
			const receipt = [];
			const acc = REAL.filter(e => e.category === "Accommodation" && homeValue(e) > 0 && e.date <= scope.asOf);
			// Nights up to today only (a five-night stay that started yesterday counts two so far)
			const nightsSlept = acc.reduce((s, e) => s + Math.min(nightsOf(e), mode === "sofar" ? daysBetween(e.date, scope.asOf) + 1 : Infinity), 0);
			if (acc.length >= 2 && nightsSlept >= 3) {
				const covered = mode === "final" && nightsSlept >= t.total - 1;
				receipt.push({ label: "Nights in a bed", value: String(nightsSlept), sub: `${plural(acc.length, "stay")}${covered ? " · every night covered" : ""}` });
				const fancy = acc.reduce((a, b) => (homeValue(b) / nightsOf(b) > homeValue(a) / nightsOf(a) ? b : a));
				receipt.push({ label: "Average a night", value: money(sumHome(acc) / nightsSlept), sub: `Fanciest: ${wrNote(fancy)}, ${cash(fancy.amount / nightsOf(fancy), fancy.currency)} a night` });
			}
			const atmMoves = MOVES.filter(m => m.kind === "atm"), exMoves = MOVES.filter(m => m.kind === "exchange");
			const fees = [...atmMoves, ...exMoves].reduce((s, m) => s + moveFeeHome(m), 0) + ITEMS.reduce((s, e) => s + cardFeeOf(e), 0);
			if (fees >= homeUnit()) {
				const rough = atmMoves.some(m => !(m.homeCharged > 0)) || exMoves.some(m => m.rateSource !== "market");
				const parts = [atmMoves.length ? plural(atmMoves.length, "cash machine") : "", exMoves.length ? plural(exMoves.length, "money change") : ""].filter(Boolean);
				const k = regular ? Math.round(fees / regular.avgGBP) : 0;
				receipt.push({ label: "Fees", value: (rough ? "≈ " : "") + money(fees), sub: [parts.join(" and "), k >= 3 ? `About ${k} × ${regular.label}.` : ""].filter(Boolean).join(". ") || "Card fees abroad" });
			}
			const withMethod = ITEMS.filter(e => e.method === "cash" || e.method === "card");
			if (sumHome(withMethod) > 0) {
				const share = (sumHome(withMethod.filter(e => e.method === "cash")) / sumHome(withMethod)) * 100;
				if (share >= 60 || share <= 25) receipt.push({ label: "Paid in cash", value: wrPct(share), sub: share >= 60 ? (ITEMS.filter(e => "VN KH TH LA MY ID PH MM SG BN TL".includes(ccOf(e) || "-")).length * 2 > ITEMS.length ? "Very Southeast Asia of you." : "Cash people.") : "Card people." });
			}
			const owls = REAL.filter(e => Number.isInteger(e.id) && e.id > 1.6e12 && !e.example).map(e => {
				const at = new Date(e.id + 7 * 3600e3);   // Vietnam, Cambodia and Thailand are all 7 hours ahead of UTC
				const day = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(at.getUTCDate()).padStart(2, "0")}`;
				const h = at.getUTCHours();
				return { e, h, m: at.getUTCMinutes(), late: (day === e.date && h >= 23) || (day === addDays(e.date, 1) && h < 5) };
			}).filter(o => o.late);
			if (owls.length) {
				const o = owls.reduce((a, b) => ((b.h + 12) % 24 * 60 + b.m > (a.h + 12) % 24 * 60 + a.m ? b : a));
				receipt.push({ label: "Latest entry", value: `${o.h % 12 || 12}:${String(o.m).padStart(2, "0")}${o.h < 12 ? "am" : "pm"}`, sub: `${wrNote(o.e)}. Respect.` });
			}
			const priced = REAL.filter(e => homeValue(e) >= 0.01);
			if (priced.length) {
				const tiny = priced.reduce((a, b) => (homeValue(b) < homeValue(a) ? b : a));
				if (homeValue(tiny) < 0.5 * homeUnit()) receipt.push({ label: "Smallest spend", value: cash(tiny.amount, tiny.currency),
					sub: tiny.currency === HOME() ? wrNote(tiny) : `${wrPence(homeValue(tiny))} for ${wrNote(tiny).toLowerCase()}` });
			}
			const vanished = ITEMS.filter(e => (e.note || "").trim() === UNTRACKED_NOTE);
			if (sumHome(vanished) > 3 * homeUnit()) {
				const byC = {};
				vanished.forEach(e => { byC[e.currency] = (byC[e.currency] || 0) + e.amount; });
				receipt.push({ label: "Vanished from wallets", value: Object.entries(byC).map(([c, a]) => cash(a, c)).join(" + "), sub: "Untracked cash. We'll never know." });
			}
			if (countries.filter(x => x.daysIn >= 2).length >= 2) {
				receipt.push({ label: "A day in each", value: "", sub: countries.filter(x => x.daysIn >= 2).map(x => `${x.c} ${moneyWhole(x.gbp / x.daysIn)}`).join(" · ") });
			}

			// The verdict, against the trip budget (never counting "Before the trip", as on Home)
			const budgetTotal = totalBudget();
			const realDays = extra.realTripDays || t.total;
			const scale = mode === "preview" ? scope.days / realDays : 1;
			let diff = budgetTotal * scale - total;
			if (mode === "sofar") diff = (budgetTotal * t.elapsed) / t.total - spentBy(L, scope.asOf).upTo;
			const spentIn = groupTotals(L, countryOf);
			const budget = {
				total: budgetTotal, diff,
				tier: Math.abs(diff) <= Math.max(10 * homeUnit(), 0.01 * budgetTotal) ? "on" : diff > 0 ? "under" : "over",
				word: currencyWord(currencyForCountry(countries.length ? countries[countries.length - 1].cc : tripCountries()[0])) || "penny",
				rows: tripCountries().filter(cc => data.countryBudgets[cc] > 0)
					.map(cc => ({ cc, c: countryName(cc, cc), budget: data.countryBudgets[cc] * scale, spent: spentIn[cc] || 0 }))
			};

			// Photos saved with your spending (never on the card: they're often receipts)
			let photos = REAL.filter(e => e.hasPhoto && photoUrls[e.id] && e.date >= scope.start && e.date <= scope.asOf)
				.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
			const photoCount = photos.length;
			if (photos.length > 9) {
				const pretty = photos.filter(e => e.category !== "Transport" && e.category !== "Other");
				if (pretty.length >= 9) photos = pretty;
				photos = Array.from({ length: 9 }, (_, i) => photos[Math.round((i * (photos.length - 1)) / 8)]);
			}
			const hero = photos.length >= 6 ? photos.reduce((a, b) => (homeValue(b) > homeValue(a) ? b : a)) : null;

			return Object.freeze({
				mode, scope, tripDays: t.total, elapsed: t.elapsed, realEnd: extra.realEnd || t.end, couple: coupleName(),
				countries, total, perDay, preT: sumHome(PRE),
				outside: sumHome(L.filter(e => e.date < t.start || e.date > t.end)),
				ahead: mode === "sofar" ? sumHome(L.filter(e => e.date > t.today)) : 0,
				pendingN: ITEMS.filter(isPending).length + MOVES.filter(isPending).length,
				pendingGBP: sumHome(ITEMS.filter(isPending)),
				count: ITEMS.length, currencies, millions, millionCode: millions ? biggest.code : "", atms: atmMoves.length,
				cats, persona, personaGBP: personaCat ? personaCat.gbp : beds.gbp, personaN: personaCat ? ITEMS.filter(e => e.category === persona).length : 0,
				bedsFirst: Boolean(personaCat) && cats[0] === beds && cats[1] === personaCat, bedsPct: beds.pct,
				flavour: persona !== "Nightlife" && night.pct >= 12 ? night.pct : 0,
				regular, top5, days, holidays, team, receipt, budget,
				photos: photos.map(e => ({ e, thumb: photoUrls[e.id].thumb, full: photoUrls[e.id].full })),
				hero: hero ? { e: hero, full: photoUrls[hero.id].full } : null, photoCount
			});
		}
