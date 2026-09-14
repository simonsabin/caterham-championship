/* The page's data.
 *
 * ALL is every season, but with the heavy half of each championship - its
 * races, its qualifying and its championship table, about 95% of the bytes -
 * taken out and kept in SERIES_BODIES under "<year>/<key>". The single-file
 * build declares all three of these here with the bodies already in; the
 * split build declares them in the data script index.html loads first, with
 * SERIES_BODIES empty and SERIES_FILES saying where each one is.
 *
 * A body is merged into the series it belongs to the moment it arrives, so
 * everything downstream reads one object and `base.races` is what it always
 * was. seriesReady() below is what makes sure it has arrived first.
 */
// ALL, SERIES_BODIES and SERIES_FILES are declared by the data script,
// which index.html loads before this one.

const bodyKey = base => base.year + '/' + base.key;

/** Merge a series' body into it if it is to hand; true if the series is whole. */
function haveBody(base) {
  if (!base) return false;
  if (base.races) return true;
  const body = SERIES_BODIES[bodyKey(base)];
  if (!body) return false;
  Object.assign(base, body);
  return true;
}

/* The files being waited on, each with what to call when it lands. A second
   ask for the same file joins the queue rather than fetching it twice. */
const BODY_WAITING = {};

function loadBody(base, done) {
  const key = bodyKey(base), file = SERIES_FILES[key];
  if (!file) return;                 // nothing to load and nothing to wait for
  if (BODY_WAITING[key]) { BODY_WAITING[key].push(done); return; }
  BODY_WAITING[key] = [done];
  const tag = document.createElement('script');
  tag.src = file;
  tag.onload = () => {
    const waiting = BODY_WAITING[key];
    delete BODY_WAITING[key];
    haveBody(base);
    waiting.forEach(fn => fn());
  };
  tag.onerror = () => {
    delete BODY_WAITING[key];
    // This page is older than what is published. A build keeps the files the
    // build before it named, and no further back, so a tab left open across
    // two results runs is naming a file that has been taken away - index.html
    // is the stale thing, and one reload has the current names. Once only: a
    // file that is genuinely missing must not spin.
    try {
      if (!sessionStorage.getItem('reload-' + key)) {
        sessionStorage.setItem('reload-' + key, '1');
        location.reload();
        return;
      }
    } catch (e) { /* a browser with no storage; fall through and say so */ }
    console.error('could not load ' + file);
  };
  document.head.append(tag);
}

/* Which choice the page is drawing.
 *
 * A file arrives when it arrives, and by then the reader may have chosen
 * something else - a second championship while the first was still coming, or
 * a championship while the live view was fetching a meeting's. Every choice
 * takes the next number, and a deferred draw carries the number it was made
 * under; one that is no longer current is dropped rather than pulling the page
 * back to something nobody is reading any more. Whichever request finishes
 * last used to win, which is the opposite of what the reader asked for.
 */
let NAV = 0;
const navigation = () => ++NAV;
const stillWanted = nav => nav === NAV;

/**
 * Make sure these championships are whole before drawing them.
 *
 * True means they already are and the caller carries on as it always did.
 * False means their files are on their way and `again` will be called once
 * they are all in - the caller returns, and the page is redrawn then, with
 * whatever was on screen left up in the meantime. `again` is the caller's to
 * guard with stillWanted(), because only the caller knows what it would draw.
 */
function seriesReady(list, again) {
  const want = list.filter(b => b && !haveBody(b));
  if (!want.length) return true;
  let left = want.length;
  want.forEach(base => loadBody(base, () => { if (!--left) again(); }));
  return false;
}

let SEASON;  // the season currently shown
let D;       // the series within it currently shown

/* ------------------------------------------------------------------ util */
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c;
  if (txt != null) e.textContent = txt; return e; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const shortName = name => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = (Array.from(parts[parts.length - 1])[0] || '').toUpperCase();
  return `${first} ${lastInitial}.`;
};
/**
 * A driver, as every table on this page writes one.
 *
 * The name twice - in full, and as the first name and an initial - so that a
 * narrow screen can show the short one without the tables disagreeing about who
 * somebody is; then whatever the table wants said about them, and the car
 * number last. The classification, the running order, the live championship
 * table and the standings all go through here, which is what keeps a column of
 * names the same width and the same shape wherever it appears.
 */
function driverCell(name, chips) {
  return `<span class="rowhead"><b><span class="name-full">${esc(name)}</span>`
    + `<span class="name-init">${esc(shortName(name))}</span></b>`
    + (chips || []).map(c => c).join('') + '</span>';
}
const metaChip = (text, cls) =>
  `<span class="chip chip-meta${cls ? ' ' + cls : ''}">${esc(text)}</span>`;
const carChip = no => `<span class="chip carno">#${esc(no)}</span>`;

/**
 * A class as a mark rather than a word.
 *
 * Class is the one thing in a row that repeats down the whole column, and
 * spelling it out costs more room than it is worth on a phone. A shape and a
 * colour say it in nine pixels - shape as well as colour, so that it still says
 * it to somebody who cannot tell the colours apart - and the legend under the
 * table says which is which.
 */
const CLASS_MARKS = ['one', 'two', 'three', 'four'];

/**
 * A day, or a day and a clock, as the page says one: "12 Sep 2026",
 * "20 Jun 2026 12:40".
 *
 * The data carries these as ISO - when a timekeeper issued a sheet, when this
 * copy of the results last changed. Written out with the month as a word so
 * it cannot be read either way round, and left empty where nothing was
 * recorded, which is not a day to invent.
 */
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(iso || '');
  if (!m) return '';
  return `${Number(m[3])} ${MONTH_SHORT[Number(m[2]) - 1]} ${m[1]}` + (m[4] ? ` ${m[4]}` : '');
};
/**
 * When this copy of a set of results last changed.
 *
 * The same day and clock as anything else on the page, and then the zone:
 * this one is the runner's UTC rather than the circuit's local time, and a
 * clock beside a sheet issued at Dijon has to say which it is.
 */
const changedText = iso => {
  const txt = dayText(iso);
  return txt && /T\d{2}:\d{2}/.test(iso) ? `${txt} UTC` : txt;
};

/** The suffix that makes a position a place: 1st, 2nd, 11th. */
const ordinal = n => (n % 100 >= 11 && n % 100 <= 13) ? 'th'
  : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
/* Whatever classes this series' own results actually carry, in a stable order:
   several of them award no class title and still print one on the sheet. */
const CLASS_SEEN = {};
function classesHere(d) {
  if (CLASS_SEEN[d.key]) return CLASS_SEEN[d.key];
  // A championship whose races have not arrived - the split build asks for
  // them when it is read, and the live view waits on every championship at a
  // meeting before drawing one - can answer only with the classes it awards a
  // title in. That answer is not kept: the rest of them come off the sheets.
  if (!d.races) return (d.classes || []).slice();
  const seen = [];
  (d.classes || []).forEach(c => seen.push(c));      // the ones it awards a title in
  const rest = [];
  d.races.forEach(r => r.entries.forEach(e => {
    if (e.cls && !seen.includes(e.cls) && !rest.includes(e.cls)) rest.push(e.cls);
  }));
  // Then whatever else the sheets carry, in a settled order rather than the
  // order the season happened to run in.
  rest.sort((a, b) => a.localeCompare(b));
  return (CLASS_SEEN[d.key] = seen.concat(rest));
}
/* `base` is the championship the mark belongs to: which shape a class gets is
   that championship's own order, and the live view draws a table for every
   championship at a meeting at once. It defaults to the one on show, which is
   what the tabs that draw only that one want. */
function classMark(cls, base) {
  if (!cls) return '';
  const i = classesHere(base || D).indexOf(cls);
  return `<span class="cmark ${CLASS_MARKS[i] || 'other'}" data-tip="${esc(cls)}" `
    + `role="img" aria-label="${esc(cls)}"></span>`;
}
/** The marks used in a table, spelled out underneath it. */
function classLegend(used, base) {
  const list = classesHere(base || D).filter(c => used.has(c));
  if (list.length < 2) return '';
  return '<div class="legend classlegend">'
    + list.map(c => `<span>${classMark(c, base)}${esc(c)}</span>`).join('')
    + '</div>';
}

const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6'];
/* Every series has its own regulations, and every season its own edition of
   them, so a link to an article has to follow whatever is being shown -
   D.regsUrl carries it. The page numbers below were read off one particular
   document, so they are only offered when that is the one being linked to. */
const REG_PAGE_DOC = 'https://caterhamcars.com/assets/Documents/Seven%20Championship%20Documents/'
  + '2026%20Caterham%20Seven%20Championship%20UK%20Regulations%20-%20Published.pdf';
const REG_PAGE = { '1.3.5': 4, '1.3.6': 4, '1.5': 4, '1.6.1': 5, '1.6.2': 6,
                   '1.6.3': 6, '1.6.4': 6, '1.6.5': 7, '1.7.3': 7, '4.2.3': 15 };
const regsUrl = () => (D && D.regsUrl) || REG_PAGE_DOC;
const regPage = n => (D && D.regPages) ? D.regPages[n]
  : (regsUrl() === REG_PAGE_DOC ? REG_PAGE[n] : null);
const regHref = n => regsUrl() + (regPage(n) ? `#page=${regPage(n)}` : '');

/** Turn every `<span class="reg">1.6.1</span>` into a link to that article. */
function linkRegs(root) {
  root.querySelectorAll('span.reg').forEach(el => {
    const n = el.textContent.trim();
    const page = regPage(n);
    const a = document.createElement('a');
    a.className = 'reg';
    a.href = regHref(n);
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = `${SEASON.year} ${D.name} Regulations, regulation ${n}`
      + (page ? ` (page ${page})` : '');
    a.textContent = n;
    el.replaceWith(a);
  });
}
let runSet, scoring, eventOf, raceOf, REMAINING;
/* The best a race can be worth: a win plus the fastest lap point. */
const maxRace = d => (d || D).scale + 1;
/** "the 3 races left", and "the one race left" rather than "the 1 race left". */
const racesLeft = (n = REMAINING) => n === 1 ? 'the one race left' : `the ${n} races left`;
/* Not every championship publishes its own table under the same name. */
const officialName = () => (D.official_source && D.official_source.name)
  || 'Caterham\u2019s published leaderboard';
const grads = () => D.scaleType === 'graduates';

/**
 * The timekeeper's own results for a meeting, as a link to put under a session.
 *
 * Every table here is rebuilt from those sheets rather than copied from
 * anybody's summary of them, so the sheets are what a reader checks a table
 * against — and a page that asks to be checked should be one click from them.
 *
 * It is the meeting's page rather than the session's own document, for two
 * reasons: a classification is provisional for days afterwards and is re-issued
 * as amended, so the address that keeps working is the one the timekeeper files
 * the meeting under; and the sheets this page cannot draw — the grid, the
 * decisions, the sectors of a meeting whose book has no analysis in it — are on
 * that page too. Where a timekeeper files nothing under an address of its own,
 * the club's own results link off its event page is offered instead, which is
 * what a spectator would have followed at the time.
 */
function officialResults(key) {
  const ev = (D.events || []).find(e => e.key === key);
  const t = ev && ev.timing;
  if (!t || !t.url) return null;
  const p = el('p', 'evlinks');
  p.innerHTML = `<a href="${esc(t.url)}" target="_blank" rel="noopener"`
    + ` title="Every sheet of this meeting, as ${esc(t.by)} published it">`
    + `Official results · ${esc(t.by)}</a>`;
  return p;
}

/* ------------------------------------------------------------- tooltip */
const tip = $('#tip');
let tipTarget = null;
function showTip(html, x, y) {
  tip.innerHTML = html; tip.style.opacity = 1;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(Math.max(8, x - w / 2), innerWidth - w - 8) + 'px';
  tip.style.top = (y - h - 12 < 8 ? y + 18 : y - h - 12) + 'px';
}
function showTipFor(t) {
  const r = t.getBoundingClientRect();
  tipTarget = t;
  showTip(t.dataset.tip, r.left + r.width / 2, r.top);
}
const hideTip = () => { tip.style.opacity = 0; tipTarget = null; };
/* A tooltip belongs to the thing it is about. Press a button that rebuilds the
   page around it - start the demonstration, stop it - and that thing is gone
   without ever being moved off, so nothing takes the tooltip down with it. */
const tipGone = () => { if (tipTarget && !tipTarget.isConnected) hideTip(); };
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-tip]');
  if (t) showTipFor(t);
});
document.addEventListener('mouseout', e => { if (e.target.closest('[data-tip]')) hideTip(); });
document.addEventListener('focusin', e => {
  const t = e.target.closest('[data-tip]');
  if (t) showTipFor(t);
});
document.addEventListener('focusout', e => { if (e.target.closest('[data-tip]')) hideTip(); });
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tip]');
  // A button that rebuilt the page around it is off the page by the time this
  // runs, and putting its tooltip up now would leave it there with nothing to
  // take it down: `closest` is just as happy to walk a detached node.
  if (!t || !t.isConnected) { hideTip(); return; }
  if (tipTarget === t && tip.style.opacity !== '0') { hideTip(); return; }
  showTipFor(t);
});
addEventListener('scroll', hideTip, true);
addEventListener('resize', hideTip);

/* ----------------------------------------------------------- masthead */
/** How far this series' table has been checked against Caterham's own. */
function seriesNote() {
  const box = $('#seriesNote');
  const r = D.reconciliation;
  if (!box) return;
  if (!r) { box.innerHTML = ''; return; }
  const un = r.unverified_rounds || [];
  /* Caterham now publish four of the five tables net of the drop scores. The
     standings here lead with the season total, so the two are tens of points
     apart while agreeing exactly - which is worth saying rather than leaving
     to be discovered. */
  const basis = r.drops_applied
    ? ' Those totals are published after the drop scores, so each is below the'
      + ' season total shown here by whatever that driver drops.'
    : '';
  const tail = un.length
    ? ` Rounds ${un[0]}${un.length > 1 ? '–' + un[un.length - 1] : ''} came after that table `
      + `was published — about ${r.unverified_pct}% of the points so far — so they follow `
      + `the same rules but nothing official yet covers them.`
    : '';
  if (!r.differences.length) {
    box.className = 'note';
    box.innerHTML = `<span class="tag">Checked</span>Matches ${officialName()} `
      + `exactly, for all <b>${r.checked}</b> drivers listed there, up to <b>round ${r.cutoff}</b>.`
      + basis + tail;
    return;
  }
  box.className = 'note warn';
  box.innerHTML = `<span class="tag">${r.differences.length} known `
    + `discrepanc${r.differences.length === 1 ? 'y' : 'ies'}</span>`
    + `Rebuilt from the official results, this table matches ${officialName()} for `
    + `<b>${r.matched} of ${r.checked}</b> drivers up to <b>round ${r.cutoff}</b>.`
    + basis + ` These do not agree:`
    + '<details><summary>Show discrepancies</summary><ul>' + r.differences.map(d =>
        `<li><b>${esc(d.driver)}</b> <span class="mono">#${esc(d.no)}</span> — `
        + `theirs <span class="mono">${d.official}</span>, here `
        + `<span class="mono">${d.ours}</span> `
        + `(<span class="mono">${d.delta > 0 ? '+' : ''}${d.delta}</span>)</li>`).join('')
    + '</ul></details>' + tail;
}

/**
 * Where this championship stands, in five figures.
 *
 * It used to sit under the title on every page, which put one championship's
 * leader over the top of a page about another one's race. It belongs on the
 * page that is about the championship itself.
 */
function champStats() {
  const leader = scoring[0];
  const done = D.roundsRun.length, next = D.events.find(e => !e.source);
  const cells = [
    ['Races run', `${done}<small>/${D.roundsTotal}</small>`],
    ['Championship leader',
     `${esc(leader.driver.split(' ').pop().toUpperCase())} <small>#${leader.no}</small>`],
    // The total the lead is held on: net of the drop scores, which is what the
    // table is ranked on and what decides the title.
    ['Leading total', `${leader.net}<small> pts net</small>`],
    ['Registered', `${D.registrations}<small> drivers</small>`],
    ['Next round', next ? `<small>${esc(next.name)}</small>` : '<small>Season complete</small>'],
  ];
  return '<div class="mast-stats standalone">' + cells.map(([k, v]) =>
    `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')
    + '</div>';
}

/* --------------------------------------------------------------- tabs */
/* Short labels: the bar has to fit across a phone, and the id rather than the
   label is what a link carries, so these can be as brief as they read. */
const TABS = [['about', 'About'], ['standings', 'Standings'], ['live', 'Live'],
              ['radar', 'Radar'], ['races', 'Races'], ['qualifying', 'Qualifying'],
              ['enduro', 'Enduro'], ['runin', 'Run-in'],
              ['calendar', 'Calendar'], ['rules', 'Points'],
              ['socials', 'Socials'], ['faq', 'FAQ']];
const tabsEl = $('#tabs');
const tabBtn = {};
/** Show one tab; unknown or empty ids fall back to the first tab. */
function showTab(id) {
  if (!tabBtn[id]) id = TABS[0][0];
  stopVideo();
  // While Live is chosen the page is a meeting rather than a championship: the
  // tab is remembered, for coming back to, and its panel stays off the screen.
  const live = MODE === 'live';
  TABS.forEach(([t]) => {
    tabBtn[t].setAttribute('aria-selected', t === id);
    $('#p-' + t).classList.toggle('on', !live && t === id);
  });
  $('#p-liveevent').classList.toggle('on', live);
  hideTip();
  // Anything the points moved on while it was out of sight is caught up here.
  if (LIVE_STALE[id]) { keepScroll($('#p-' + id), LIVE_TABS[id]); LIVE_STALE[id] = false; }
  if (id === 'live' && !live) liveEnter();
  if (id === 'socials' && !live) socialsShow();
  radarShow(!live && id === 'radar');
  // The tables on this panel could not be measured while it was hidden.
  capSoon();
}
TABS.forEach(([id, label]) => {
  const b = el('button', null, label);
  b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', false);
  b.setAttribute('aria-controls', 'p-' + id);
  b.onclick = () => { currentTab = id; showTab(id); writeHash(); };
  tabBtn[id] = b;
  tabsEl.append(b);
});


/* ---------------------------------------------------------- standings */
/**
 * Where a driver qualified for a round that has not been run.
 *
 * Qualifying is published on the morning of a meeting, hours before the racing,
 * and the build reads it off the timekeepers' sheet like everything else - TSL's
 * at a British round, ITS Chrono's at Dijon - so a round the table cannot score
 * yet is not entirely unknown, and the grid it produced is worth showing where
 * the points will go.
 */
function qualPos(t, round) {
  const ev = eventOf[round];
  if (!ev || runSet.has(Number(round))) return null;
  const rows = liveQualifying(D, ev.key);
  const hit = rows.find(q => String(q.no) === String(t.no))
    || rows.find(q => q.driver === t.driver);
  return hit ? hit.pos : null;
}

function cellTip(t, rd) {
  const sc = t.rounds[rd], ev = eventOf[rd];
  const where = `<b>Round ${rd}</b> · ${esc(ev.name)}`;
  if (!runSet.has(Number(rd))) {
    const q = qualPos(t, rd);
    const first = ev.rounds[0];
    return `${where}<br>Not yet run`
      + (q ? `<br>${esc(t.driver)} qualified <b>P${q}</b> at this meeting`
           + `${first === Number(rd) ? ', which is the grid for this race'
              : `, which set the grid for round ${first}`}` : '');
  }
  if (!sc) return `${where}<br>${esc(t.driver)} did not enter`;
  const bits = [];
  if (sc.status === 'classified') {
    bits.push(`Finished <b>P${sc.pos}</b>`);
    if (sc.scoring_place && sc.scoring_place !== sc.pos)
      bits.push(`scores as P${sc.scoring_place} — guest entries are invisible for points`);
    bits.push(`${sc.race_points} race points`);
  } else {
    bits.push(sc.status === 'DQ' || sc.status === 'DSQ' ? 'Disqualified'
      : sc.status === 'DNS' || sc.status === 'NS' ? 'Qualified, did not start'
      : sc.status === 'DNF' || sc.status === 'RET' ? 'Started, did not finish'
      : sc.status);
    if (sc.race_points) bits.push(`${sc.race_points} race points`);
  }
  if (sc.fl) bits.push('+1 fastest lap');
  if (sc.penalty) bits.push(`<b>${sc.penalty}</b> championship penalty from this round `
    + `(reg ${D.penaltyReg}) — taken off the season total, not off these race points`);
  if (!t.registered) bits.push('Guest entry — scores no points');
  return `${where}<br>${esc(t.driver)}: ${bits.join('<br>')}`;
}

/** Tooltip for the Pen column: every deduction the driver has taken. */
function penTip(t) {
  const rows = D.penalties.filter(p => p.driver === t.driver)
    .map(p => `Round ${p.round}: <b>−${p.deduction}</b>`
      + (p.licence_points ? ` (${p.licence_points} licence points)` : ''));
  return `<b>${esc(t.driver)}</b> — championship penalties, reg ${D.penaltyReg}`
    + `<br>${rows.join('<br>')}`
    + `<br>Total <b>${t.penalty_points}</b>, deducted from the season total. `
    + `A penalty is not part of a round score, so a drop score cannot cancel it.`;
}

/* ------------------------------------------------------------- ranking --

   The championship is decided on the total after the drop scores - reg 1.6.4 -
   so Net is what the table is ranked on and what a position means. The season
   total is the other question a reader asks: who has scored the most this year,
   before any of it is thrown away. Clicking Total asks it, and clicking Net
   asks the first one again.

   Ties are broken the way the table itself is: more wins, then more podiums,
   then alphabetically - the drivers still share a position, the tie-break only
   settles which of them is printed first. */
let rankBy = 'net';

const rankOf = t => (rankBy === 'gross' ? t.gross : t.net);

/** Rows in ranking order, and the position each takes - ties shared. */
function ranked(rows) {
  // The last tie-break compares the names by code point rather than by locale,
  // which is what build_all.py's sort does: ranked on Net this has to reproduce
  // the order the table was built in, not an order of its own.
  const sorted = [...rows].sort((a, b) => rankOf(b) - rankOf(a)
    || b.wins - a.wins || b.podiums - a.podiums
    || (a.driver < b.driver ? -1 : a.driver > b.driver ? 1 : 0));
  const pos = new Map();
  let p = 0, last = null;
  sorted.forEach((t, i) => {
    if (rankOf(t) !== last) { p = i + 1; last = rankOf(t); }
    pos.set(t, p);
  });
  return { sorted, pos };
}

/* A series that awards class titles - 310R runs Pro Am and Am - is still one
   championship: reg 1.6 scores the whole grid and a class is a ranking inside
   that table, which is why the standings are cut into class tables rather than
   rebuilt from class results. */
function classGroups(order) {
  const names = (D.classes || []).filter(c => order.some(t => t.cls === c));
  if (names.length < 2) return null;
  const groups = names.map(c => ({ name: c, rows: order.filter(t => t.cls === c), split: true }));
  // Spa's sheet carries no class column, so a registered driver can reach the
  // table with no class recorded at all; they are listed by overall position.
  const rest = order.filter(t => !names.includes(t.cls));
  if (rest.length) groups.push({ name: 'No class recorded', rows: rest });
  const guests = D.table.filter(t => !t.registered);
  if (guests.length) groups.push({ name: 'Guest entries', rows: guests, guests: true });
  return groups;
}

/**
 * The points table for one set of drivers; `split` numbers them by class.
 *
 * `posOf` says what number goes in the position column - the class position
 * inside a class table, the championship position otherwise - and `overall`
 * the championship position a class table prints beside the name. Both come
 * from the ranking the reader has chosen rather than from the stored one.
 */
function champTable(rows, split, posOf, overall) {
  const sc = el('div', 'scroller'), tb = el('table', 'champ');
  const thead = el('thead');

  const band = el('tr', 'band');
  band.append(Object.assign(el('th', 'stick1'), { rowSpan: 2 }));
  band.append(Object.assign(el('th', 'stick2'), { rowSpan: 2, textContent: 'Driver' }));
  D.events.forEach(e => {
    const th = el('th', e.source ? '' : 'future', e.name);
    th.colSpan = e.rounds.length; th.title = e.dates;
    band.append(th);
  });
  // Where a driver could still finish, beside the total they have now, projected
  // over exactly the rounds this table counts - a race that is running included,
  // as it stands, the same as in Total and Net. There is nothing to project once
  // every round has been run.
  const ends = REMAINING > 0;
  ['Pen', 'Total', 'Drops', 'Net'].concat(ends ? ['Min', 'Max'] : [])
    .concat(['W', 'FL']).forEach(h => {
    const th = el('th', null, h); th.rowSpan = 2; th.style.background = 'var(--surface-2)';
    th.style.color = 'var(--ink-2)';
    // Total and Net are the two the table can be ranked on, so they are the two
    // that answer to a click. The one in force says so, and the other says what
    // clicking it would do.
    if (h === 'Total' || h === 'Net') {
      const by = h === 'Total' ? 'gross' : 'net';
      const on = rankBy === by;
      th.classList.add('rankable');
      if (on) th.classList.add('ranked');
      th.setAttribute('aria-sort', on ? 'descending' : 'none');
      th.tabIndex = 0;
      th.textContent = h + (on ? ' ▾' : '');
      th.dataset.tip = on
        ? `<b>Ranked on ${h}</b><br>` + (by === 'net'
          ? `The total after the drop scores, which is what decides the championship `
            + `<span class="reg">${D.dropComponent === 'race_points' ? '1.6.2a' : '1.6.4'}</span>.`
          : `The season total, before any round is dropped.`)
        : `<b>Rank the table on ${h}</b><br>` + (by === 'net'
          ? `The total after the drop scores - what decides the championship.`
          : `The season total, before any round is dropped. It answers a different `
            + `question, and can put the drivers in a different order.`);
      const pick = () => { rankBy = by; standings(); };
      th.onclick = pick;
      th.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    }
    band.append(th);
    if (h === 'Min' || h === 'Max') {
      th.style.color = 'var(--ink-3)';
      const n = REMAINING;
      // Both are projected over the rounds this table counts, so a race that is
      // running counts in them as it counts in Net - which is what stops a Min
      // coming out below the number beside it. The title run-in asks the other
      // question, and says so there.
      const also = D.live ? `<br>Round ${D.live.round} is running now and is counted here `
        + `as it stands, the same as in Total and Net, so neither of these can come out `
        + `below the Net beside them. The title run-in puts that race back among the ones `
        + `still to be won, and its two ends are wider apart for it.` : '';
      th.dataset.tip = h === 'Min'
        ? `<b>Lowest they can finish on</b><br>Scores nothing in ${racesLeft()}, with the `
          + `drop scores applied to what that leaves. Never below the Net they have now: a `
          + `round nobody has driven yet is a zero the drops can take instead of a real `
          + `result.${also}`
        : `<b>Highest they can finish on</b><br>Wins ${n === 1 ? 'the one race left, with '
            + 'the fastest lap in it' : `all ${n} races left with the fastest lap in each`}, `
          + `drop scores applied. Only one driver can actually have this.${also}`;
    }
  });
  thead.append(band);

  const cols = el('tr', 'cols');
  for (let r = 1; r <= D.roundsTotal; r++) {
    const th = el('th', 'num');
    const run = runSet.has(r);
    const btn = el('button', null, 'R' + r);
    btn.style.cssText = 'background:none;border:0;cursor:pointer;color:inherit;font:inherit;padding:0;'
      + 'text-decoration:underline dotted currentColor';
    btn.title = run ? 'Go to race results' : 'Go to calendar';
    btn.addEventListener('click', () => {
      currentTab = run ? 'races' : 'calendar';
      showTab(currentTab);
      writeHash();
      if (run) {
        const pb = $(`#p-races .picker-buttons [data-round="${r}"]`);
        if (pb) pb.click();
      }
    });
    th.append(btn);
    cols.append(th);
  }
  thead.append(cols);
  tb.append(thead);

  const tbody = el('tbody');
  const used = new Set();
  rows.forEach(t => {
    const tr = el('tr', t.registered ? '' : 'guest');
    const pos = posOf ? posOf(t) : (split ? t.cls_pos : t.pos);
    tr.append(Object.assign(el('td', 'stick1 num'), { textContent: pos || '—' }));
    const nm = el('td', 'stick2');
    // only an unregistered entry is a guest; a registered driver with no class
    // recorded (Spa's sheet has no class column) just gets no class chip. Inside
    // a class table the class chip says nothing, so the overall championship
    // position takes its place.
    const chip = !t.registered
        ? metaChip(grads() && t.cls ? t.cls : 'Guest')
      : split ? metaChip(`P${(overall ? overall(t) : t.pos) || '—'} overall`)
      : (t.cls && t.cls !== 'Championship' ? (used.add(t.cls), classMark(t.cls)) : '');
    nm.innerHTML = driverCell(t.driver, [chip, carChip(t.no)]);
    tr.append(nm);
    for (let r = 1; r <= D.roundsTotal; r++) {
      const key = String(r), s = t.rounds[key];
      const td = el('td', 'pt');
      if (!runSet.has(r)) {
        td.classList.add('future');
        const q = qualPos(t, r);
        if (q) { td.textContent = 'P' + q; td.classList.add('qual'); }
      }
      else if (!s) { td.textContent = '·'; td.classList.add('none'); }
      else {
        // race points plus the fastest lap point - a penalty is never netted off
        // here, it goes in the Pen column
        td.textContent = (s.status === 'classified' || s.score !== 0)
          ? s.score : s.status.toLowerCase();
        if (s.status !== 'classified') td.style.fontSize = '11px';
        if (s.fl) td.classList.add('fl');
        if (s.scoring_place === 1) td.classList.add('win');
        if (s.penalty) td.classList.add('pen');
        if (s.status !== 'classified' && !s.penalty) td.classList.add('none');
      }
      td.dataset.tip = cellTip(t, key);
      tr.append(td);
    }
    const drops = t.dropped.reduce((a, b) => a + b, 0);
    const floor = ends ? project(t, 0) : null;
    const ceiling = ends ? project(t, maxRace()) : null;
    const pen = el('td', 'num', t.penalty_points ? String(t.penalty_points) : '—');
    if (t.penalty_points) {
      pen.style.color = 'var(--alarm)';
      pen.style.fontWeight = 600;
      pen.style.cursor = 'pointer';
      pen.dataset.tip = penTip(t);
      pen.onclick = () => {
        currentTab = 'rules';
        location.hash = `${SEASON.year}/${D.key}/rules`;
        showTab('rules');
        // Scroll to and highlight this driver's penalties
        setTimeout(() => {
          const penaltyRows = document.querySelectorAll('table tbody tr[data-driver]');
          penaltyRows.forEach(row => {
            if (row.dataset.driver === t.driver) {
              row.scrollIntoView({ behavior: 'smooth', block: 'center' });
              row.classList.add('highlight');
              setTimeout(() => row.classList.remove('highlight'), 2000);
            }
          });
        }, 100);
      };
    } else {
      pen.style.color = 'var(--ink-3)';
    }
    tr.append(pen);
    // Which end this is, rather than which number: a guest's two ends are the
    // same figure, and comparing the value with the floor would put the wrong
    // sentence in one of the cells.
    const projTip = top => `<b>${esc(t.driver)}</b><br>`
      + (t.registered
         ? (top
            ? `Cannot finish above <b>${ceiling}</b>: ${REMAINING === 1 ? 'the one race left'
                : `every one of the ${REMAINING} races left`} won with the fastest lap`
            : `Cannot finish below <b>${floor}</b>: nothing more scored`)
           + `, drop scores applied`
           + (D.live ? `, and round ${D.live.round} counted as it stands.` : '.')
         : 'A guest entry scores nothing at all, so both ends of the projection are the '
           + 'total it has.');
    [[t.gross, 'tot'], [drops, 'num'], [t.net, 'num']]
      .concat(ends ? [[floor, 'num proj', projTip(false)], [ceiling, 'num proj', projTip(true)]]
                   : [])
      .concat([[t.wins, 'num'], [t.fastest_laps, 'num']])
      .forEach(([v, c, tip]) => {
        const td = el('td', c, String(v));
        if (tip) td.dataset.tip = tip;
        tr.append(td);
      });
    tbody.append(tr);
  });
  tb.append(tbody); sc.append(tb);
  // What the marks in the class column mean, across the foot of the table.
  const legend = classLegend(used);
  if (!legend) return sc;
  const box = el('div');
  box.append(sc);
  box.insertAdjacentHTML('beforeend', legend);
  return box;
}

/**
 * Every championship deduction taken this season, and where each was published.
 *
 * It belongs beside the table it comes off rather than with the article that
 * allows it: the Pen column says a driver has lost points, and this is the only
 * thing on the site that says which race and what for.
 */
function deductions() {
  if (!D.penalties.length) return null;
  const pen = el('div');
  pen.innerHTML = '<h3 class="disp" style="margin:26px 0 8px;font-size:18px;text-transform:uppercase;'
    + 'letter-spacing:.04em">Deductions applied this season</h3>'
    + `<p class="sub">Three times the licence points for the offence `
    + `<span class="reg">${D.penaltyReg}</span>, taken off the championship total.</p>`;
  const psc = el('div', 'scroller'), ptb = el('table');
  ptb.innerHTML = '<thead><tr><th class="num">Rd</th><th>Driver</th><th class="num">Licence pts</th>'
    + '<th class="num">Deduction</th><th>Decision</th></tr></thead><tbody>'
    + D.penalties.map(p => `<tr data-driver="${esc(p.driver)}"><td class="num mono">${p.round}</td><td>${esc(p.driver)}</td>`
      + `<td class="num mono">${p.licence_points == null ? '—' : p.licence_points}</td>`
      + `<td class="num mono" style="color:var(--alarm)">−${p.deduction}</td>`
      + `<td><a href="${esc(p.source)}">${grads() ? 'table' : 'sheet'}</a>`
      + `${p.provisional ? ' <span class="chip">provisional</span>' : ''}</td></tr>`)
      .join('') + '</tbody>';
  psc.append(ptb); pen.append(psc);
  return pen;
}

function standings() {
  // How far this table has been checked against the championship's own is a
  // statement about this table, so it is shown with it rather than over every
  // page on the site.
  const p = $('#p-standings');
  p.innerHTML = '<div id="seriesNote"></div>';
  seriesNote();
  // Whether a race that is running counts is a question about this table, so it
  // is asked here rather than on the page showing the race.
  const running = LIVE.view && LIVE.view.scored && LIVE.view.scored.scored.size
    ? LIVE.view.scored.round : null;
  if (running) {
    const box = el('label', 'countin');
    box.innerHTML = `<input type="checkbox"${LIVE.applied ? ' checked' : ''}>`
      + `<span>Count <b>round ${running}</b>, running now at `
      + `${esc((LIVE.view.meet.event || {}).name || 'this meeting')}, in this table and the `
      + `title run-in</span>`;
    box.querySelector('input').onchange = e => {
      LIVE.applied = e.target.checked;
      liveRefresh();
    };
    p.append(box);
  }
  const { sorted: order, pos: overallPos } = ranked(scoring);
  const overall = t => overallPos.get(t) || null;
  const groups = classGroups(order);
  const classed = groups ? groups.filter(g => g.split).map(g => g.name) : [];
  // How to read the table, kept until after it: somebody who wants the numbers
  // should not have to scroll a paragraph to reach them, and somebody who wants
  // the paragraph knows where the bottom of a page is.
  const howToRead = Object.assign(el('p', 'lede'),
    { textContent: `Ranked on ${rankBy === 'net' ? 'Net, the total after the drop scores, which is '
        + 'what decides the championship - click Total to rank it on the season total instead'
        : 'Total, the season total before any round is dropped - click Net to rank it on what '
        + 'decides the championship'}. `
      + `Points scored in every race. An underlined score took the fastest lap of that `
      + `race, worth the extra point inside the number. A round marked in `
      + `red carried a championship penalty, but the points the driver earned on track are left `
      + `whole - the deduction is collected in the Pen column and taken off the total. `
      + `${D.roundsRun.length} of ${D.roundsTotal} races have been run; the remaining columns are `
      + `hatched, and carry a driver's qualifying position where that meeting has qualified `
      + `and not yet raced. Hover any cell for the finishing position behind the number.`
      + (REMAINING > 0
         ? ` Min and Max are the two ends of the season from here: where a driver ends up `
           + `scoring nothing more, and where they end up winning everything left, fastest `
           + `lap point included. Both are after drop scores, and both are projected over `
           + `the rounds this table counts - so Min sits above Net rather than below it, `
           + `because a round still to run is a zero the drops can take instead of a real `
           + `result.`
           + (D.live ? ` The race running now is counted in them as it is counted in Total `
             + `and Net: as it stands. The title run-in is the other question - it puts a `
             + `race nobody has finished back among the ones still to be won, so its floor `
             + `allows for losing the lot and its ceiling for taking the win and the `
             + `fastest lap point off the car leading it.` : '')
         : '')
      + (classed.length
         ? ` ${D.short} awards a title in ${classed.join(' and ')}, so the table is split into `
           + `those classes - the points are unchanged, only the positions are counted within `
           + `the class.`
         : '') });

  if (groups) {
    groups.forEach(g => {
      p.append(Object.assign(el('h2'), { textContent: g.name }));
      p.append(Object.assign(el('p', 'sub'), { textContent: g.guests
        ? 'Not registered for the full championship, so they score nothing and the drivers '
          + 'behind them move up a place for scoring.'
        : g.split
          ? `${g.rows.length} registered driver${g.rows.length === 1 ? '' : 's'}. Positions are `
            + `within the class; the totals are the championship's own, scored across the `
            + `whole grid.`
          : 'Registered, but the timing sheets recorded no class for them; listed by overall '
            + 'championship position.' }));
      // A class position is this ranking counted within the class; a guest has
      // no position at all, in either.
      const inside = g.split ? ranked(g.rows).pos : null;
      p.append(champTable(g.rows, g.split,
                          g.guests ? () => null : (inside ? t => inside.get(t) : overall),
                          overall));
    });
  } else {
    p.append(champTable(order.concat(D.table.filter(t => !t.registered)), false, overall));
  }

  const lg = el('div', 'legend');
  lg.innerHTML =
    '<span><b class="mono" style="text-decoration:underline;text-decoration-color:var(--fl);'
    + 'text-decoration-thickness:2px;text-underline-offset:3px">24</b>'
    + 'Fastest lap of the race (+1 point)</span>'
    + [['var(--flag-soft)', 'Race win'],
       ['var(--alarm-soft)', 'Round carrying a championship penalty (deducted in Pen)'],
       ['var(--sunk)', 'Round not yet run — P3 where qualifying is already known']]
      .map(([c, t]) => `<span><i class="sw" style="background:${c}"></i>${t}</span>`).join('')
    + '<span><i class="sw" style="background:var(--surface)"></i>· = did not enter</span>';
  p.append(lg);

  const pen = deductions();
  if (pen) { p.append(pen); linkRegs(pen); }

  p.append(Object.assign(el('h2'), { textContent: 'How the title has swung' }));
  p.append(Object.assign(el('p', 'sub'), { textContent:
    'Running total after each race for the top six. Gross points — drop scores are not applied.' }));
  p.append(chart());

  p.append(Object.assign(el('h2'), { textContent: 'Reading the table' }));
  howToRead.style.margin = '0';
  p.append(howToRead);
}

/** The championship itself: what it is, and where it stands. */
function about() {
  const p = $('#p-about');
  const next = D.events.find(e => !e.source);
  p.innerHTML = '<div class="mast-in"><div>'
    + `<p class="eyebrow">BARC · Caterham Motorsport · Season `
    + `<span id="seasonLabel">${SEASON.year}</span></p>`
    + '<h1>Caterham<br><em>Championships</em></h1></div></div>'
    + '<div id="liveNote"></div>'
    + `<p class="lede">${esc(D.fullName)}${D.blurb ? ' — ' + esc(D.blurb) : ''}</p>`
    + champStats()
    + '<h2>The season</h2>'
    + `<div class="prose"><p>${D.roundsTotal} rounds across `
    + `${D.events.length} meetings, ${D.roundsRun.length} of them run`
    + (next ? `; the next is <b>${esc(next.name)}</b>, ${esc(next.dates)}` : '')
    + `. ${D.registrations} drivers are registered for the full season`
    + (D.dropScores ? `, and the lowest ${D.dropScores === 1 ? 'score is'
        : D.dropScores + ' scores are'} dropped from each of their totals` : '')
    + `. <a href="#${SEASON.year}/${D.key}/calendar">Calendar</a> · `
    + `<a href="#${SEASON.year}/${D.key}/standings">Standings</a> · `
    + `<a href="#${SEASON.year}/${D.key}/rules">How the points work</a>.</p>`
    + (D.regsUrl ? `<p>Scored from this series’ own ${SEASON.year} regulations, `
        + `<a href="${esc(D.regsUrl)}" target="_blank" rel="noopener">published here</a> — `
        + 'not from any summary of them.</p>' : '')
    + '</div>'
    + `<p class="sub">Where the numbers come from and what is provisional about them: `
    + `<a href="#${SEASON.year}/${D.key}/faq">FAQ</a>.</p>`;
  linkRegs(p);
}

/** The questions the page raises, answered once. */
function faq() {
  const p = $('#p-faq'); p.innerHTML = '';
  const live = `<a href="#${SEASON.year}/${D.key}/live">Live</a>`;
  const radar = `<a href="#${SEASON.year}/${D.key}/radar">Radar</a>`;
  p.innerHTML = '<h2>What this page is</h2>'
    + `<div class="prose"><p>Every session of the ${SEASON.year} season, taken from the `
    + `timekeepers' own sheets, with each championship's table rebuilt from that series' `
    + `own regulations rather than copied from anywhere. Points, drop scores, guests and `
    + `penalties all follow the document itself — the <a href="#${SEASON.year}/${D.key}/rules">`
    + `Points</a> page sets out how, article by article.</p>`
    + `<p>Everything here is provisional until the organisers declare it final. Where this `
    + `table can be checked against the championship's own published one it has been, and `
    + `the note at the top of the page says how far that check reaches and where the two `
    + `disagree.</p></div>`
    + '<h2>Watching a race as it runs</h2>'
    + '<div class="prose">'
    + `<p><b>Where it comes from.</b> The timekeepers' own live feed for the meeting — `
    + `the same people, and the same meeting, as the classifications every other page is `
    + `built from. TSL Timing time the British rounds and ITS Chrono time Dijon, and the `
    + `${live} page talks to whichever of them is timing the meeting directly; nothing `
    + `sits in between. Spa and the Knockhill festival have no live feed at all.</p>`
    + '<p><b>Why the table can start half-empty.</b> That is TSL’s feed, which sends '
    + 'changes rather than a snapshot: a car appears on it the first time it crosses the '
    + 'line after you connect, so a page opened mid-race fills in over a lap. Before that '
    + 'it lays the grid out from qualifying, and each slot stands until the timekeepers '
    + 'replace it. ITS answer with the whole timing screen every few seconds instead, so '
    + 'Dijon arrives complete and never fills in.</p>'
    + '<p><b>None of it is a result.</b> Points shown while a race is running are what the '
    + 'running order would be worth. The tables themselves are rebuilt from the published '
    + 'classification days later, after the stewards, and that is the only thing that ever '
    + 'changes a championship total.</p>'
    + `<p><b>The Live view.</b> <a href="#${SEASON.year}/live">Live</a>, at the end of the `
    + 'championship strip — the button in the bottom right corner on a phone — is the meeting '
    + 'rather than a championship: every meeting running today or still to come, and for each '
    + 'the stream where the club publishes one, the whole day’s timetable across every '
    + 'championship racing there, and the timing of the session out on the circuit, scored '
    + 'for whichever championship’s session it is. It follows the feed from one '
    + 'championship’s session to the next, and the rest of this page follows with it.</p>'
    + '<p><b>Seeing it out of season.</b> <span class="mono">?demo</span> in the address, or '
    + 'the button on the ' + live + ' page, races a made-up field against the clock in this '
    + 'page — twenty minutes and then the lap they are on, from this series’ own last '
    + 'race. Nothing is timed and none of those numbers are real.</p></div>'
    + '<h2>The weather over the circuit</h2>'
    + '<div class="prose">'
    + `<p><b>Where it comes from.</b> <a href="https://www.meteoblue.com/" `
    + `target="_blank" rel="noopener">meteoblue</a>’s own weather maps widget, pointed `
    + `at the circuit of the meeting being read. It is the only thing on this site that `
    + `does not come from the timekeepers or the organising club, it is the only page `
    + `here that is somebody else’s to draw, and it is not loaded at all until the `
    + `${radar} tab is opened.</p>`
    + '<p><b>Why theirs and not ours.</b> The map was drawn here first, over a public '
    + 'radar feed. A radar only ever looks backwards; that feed publishes no '
    + 'extrapolated frames; and a forecast grid cheap enough to fetch for every reader '
    + 'had 30km between its points, which can say a front is coming and can never say '
    + 'a shower will miss the paddock. meteoblue serve the thing itself, a week of it, '
    + 'and a page about a championship has no business trying to out-forecast them.</p>'
    + '<p><b>All of it is a forecast.</b> Nothing on that map was measured at the '
    + 'circuit, and the further into the week it runs the less it is worth. The page '
    + 'does not tell you where the sky is now — it tells you what a model expects.</p>'
    + '<p><b>Rain is not a wet track.</b> A circuit dries at its own rate and a shower '
    + 'that has gone through is still under the cars for a session afterwards. What '
    + 'the conditions were is on the classification sheet, and that is the only '
    + 'record of it here.</p></div>'
    + '<h2>Where the numbers come from</h2>'
    + '<div class="prose"><ul>'
    + '<li><b>Results and timing</b> — <a href="https://www.tsl-timing.com/">TSL Timing</a>, '
    + '<a href="https://www.its-results.com/">ITS Chrono</a> for Dijon, and '
    + '<a href="https://ser2026.racspa.be/">Spa Euro Race</a> (Alkamel Systems) for the '
    + 'Spa rounds.</li>'
    + '<li><b>Calendar and judicial decisions</b> — the organising club’s own pages.</li>'
    + `<li><b>Scoring</b> — this series’ ${SEASON.year} regulations`
    + (D.regsUrl ? `, <a href="${esc(D.regsUrl)}" target="_blank" rel="noopener">published `
        + 'here</a>' : '') + '.</li>'
    + '</ul></div>';
  linkRegs(p);
}

/* -------------------------------------------------------------- chart */
function chart() {
  const box = el('div', 'chartbox');
  const top = scoring.slice(0, 6);
  const rounds = D.roundsRun;
  const series = top.map((t, i) => {
    let run = 0;
    const pts = rounds.map(r => {
      const s = t.rounds[String(r)]; run += s ? s.total : 0; return { r, v: run };
    });
    return { name: t.driver, short: t.driver.split(' ').slice(-1)[0], no: t.no,
             colour: `var(${SERIES[i]})`, pts, end: run };
  });
  const maxY = Math.ceil(Math.max(...series.map(s => s.end)) / 50) * 50;

  const W = 980, H = 340, M = { t: 12, r: 108, b: 30, l: 42 };
  const x = i => M.l + (W - M.l - M.r) * (i / (rounds.length - 1));
  const y = v => H - M.b - (H - M.t - M.b) * (v / maxY);

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative championship points by race">`;
  for (let g = 0; g <= maxY; g += 50)
    s += `<line class="gl" x1="${M.l}" y1="${y(g)}" x2="${W - M.r}" y2="${y(g)}"/>`
       + `<text class="ax" x="${M.l - 8}" y="${y(g) + 3.5}" text-anchor="end">${g}</text>`;
  // event bands along the foot
  D.events.filter(e => e.source).forEach(e => {
    const idx = e.rounds.map(r => rounds.indexOf(r)).filter(i => i >= 0);
    if (!idx.length) return;
    const mid = (x(idx[0]) + x(idx[idx.length - 1])) / 2;
    s += `<text class="ax" x="${mid}" y="${H - 8}" text-anchor="middle">${esc(e.name.split(' ')[0])}</text>`;
  });
  rounds.forEach((r, i) =>
    s += `<text class="ax" x="${x(i)}" y="${H - M.b + 13}" text-anchor="middle">${r}</text>`);

  series.forEach(se => {
    const d = se.pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    s += `<path d="${d}" fill="none" stroke="${se.colour}" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round"/>`;
    const lx = x(rounds.length - 1), ly = y(se.end);
    s += `<circle cx="${lx}" cy="${ly}" r="4" fill="${se.colour}" stroke="var(--surface)" stroke-width="2"/>`;
    s += `<text class="serieslab" x="${lx + 9}" y="${ly + 4}" fill="${se.colour}">${esc(se.short)} ${se.end}</text>`;
  });
  s += `<line id="cross" x1="0" y1="${M.t}" x2="0" y2="${H - M.b}" stroke="var(--ink-3)"
          stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
  s += `<rect id="hit" x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}" fill="transparent"/>`;
  s += '</svg>';
  box.innerHTML = s;

  const svg = box.querySelector('svg'), cross = box.querySelector('#cross');
  box.querySelector('#hit').addEventListener('mousemove', ev => {
    const bb = svg.getBoundingClientRect();
    const px = (ev.clientX - bb.left) / bb.width * W;
    let i = Math.round((px - M.l) / (W - M.l - M.r) * (rounds.length - 1));
    i = Math.max(0, Math.min(rounds.length - 1, i));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', .8);
    const rd = rounds[i], race = raceOf[rd];
    const rows = series.map(se => `<i class="dot" style="background:${se.colour}"></i> `
      + `${esc(se.short)} <b>${se.pts[i].v}</b>`).join('<br>');
    showTip(`<b>Round ${rd}</b> — ${esc(race.eventName)}<br>${rows}`, ev.clientX, ev.clientY);
  });
  box.querySelector('#hit').addEventListener('mouseleave', () => {
    cross.setAttribute('opacity', 0); hideTip();
  });

  const lg = el('div', 'chart-legend');
  lg.innerHTML = series.map(se =>
    `<span><i class="dot" style="background:${se.colour}"></i>${esc(se.name)} <span class="mono"
      style="color:var(--ink-3)">#${se.no}</span></span>`).join('');
  box.append(lg);
  return box;
}

/* ---------------------------------------------------------- race replay */
/* Two things about a race that a classification cannot say: where everyone was
   while it was running, and what it looked like. The lap chart is the first -
   a line per car from its grid slot to wherever it ended up - and it is drawn
   against the second, because every point on it carries the time of day it
   happened and every broadcast carries the time of day it started. Clicking
   the chart is therefore a seek: the video goes to that moment of that lap. */

/** A colour per car. The golden angle keeps neighbouring grid slots apart. */
const carColour = i => `hsl(${(i * 137.508) % 360} 62% 45%)`;

/** Every moment the running order was published, in the order they happened.

    The lap chart gives one per lap; a position chart with intermediates gives
    two more inside each lap, which are placed evenly between the laps either
    side of them because nothing publishes the time they were taken. */
function chartPoints(c, withInts) {
  const laps = c.laps.map(l => ({ n: l.n, t: l.t, order: l.o.split(',').filter(Boolean) }));
  const ints = {};
  if (withInts) (c.ints || []).forEach(x => (ints[x.n] = ints[x.n] || []).push(
    { p: x.p, order: x.o.split(',').filter(Boolean) }));
  const pts = [];
  if (c.start) pts.push({ label: 'Grid', sub: 'Start', t: 0, order: c.start.split(',').filter(Boolean) });
  laps.forEach((l, i) => {
    const prevT = i ? laps[i - 1].t : 0;
    const group = ints[i ? laps[i - 1].n : 0] || [];
    group.forEach((g, j) => {
      const f = (j + 1) / (group.length + 1);
      pts.push({ label: `Lap ${l.n}`, sub: g.p, order: g.order,
                 t: (prevT != null && l.t != null) ? prevT + (l.t - prevT) * f : null });
    });
    pts.push({ label: `Lap ${l.n}`, sub: 'Finish', t: l.t, order: l.order, lap: l.n });
  });
  return pts;
}

/** Seconds as a clock: 4:07 inside an hour, 2:34:16 beyond one. */
const hms = s => {
  if (s == null || !isFinite(s)) return '';
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`)
    + ':' + String(sec).padStart(2, '0');
};

/** The lap chart, and a handle to move its playhead as the video plays.

    Drawn lap by lap. Where the position chart also published the two
    intermediates inside each lap they are three times as many columns for the
    same race, which is worth having and not worth reading by default, so they
    are behind a toggle. */
function lapChart(r, seek) {
  const c = r.chart;
  if (!c.laps || c.laps.length < 1) return null;

  // The chart is this series' cars only - a shared grid is filtered down to
  // them when the payload is built - so a number on it is a number in the
  // classification below.
  const mine = {};
  r.entries.forEach(e => { mine[e.no] = e; });
  const entryOf = no => mine[no];

  const wrap = el('div');
  const box = el('div', 'lapbox');
  let move = () => {};

  const draw = withInts => {
    const pts = chartPoints(c, withInts);
    const seen = [];
    pts.forEach(p => p.order.forEach(no => { if (!seen.includes(no)) seen.push(no); }));
    const first = pts[0].order, last = pts[pts.length - 1].order;
    const cars = seen.slice().sort((a, b) => {
      const ia = first.indexOf(a), ib = first.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const rows = Math.max(...pts.map(p => p.order.length));

    const rowH = rows > 32 ? 11 : rows > 22 ? 13 : 15;
    const step = Math.max(20, Math.min(56, 1030 / (pts.length - 1)));
    const M = { t: 30, b: 16, l: 112, r: 112 };
    const W = M.l + M.r + step * (pts.length - 1);
    const H = M.t + M.b + rowH * rows;
    const x = i => M.l + step * i;
    const y = pos => M.t + rowH * (pos - 0.5);
    const every = Math.ceil(pts.filter(p => p.lap).length / 26);

    const label = no => {
      const e = entryOf(no);
      return `${no}${e ? ' ' + e.driver.split(' ').slice(-1)[0].toUpperCase() : ''}`;
    };

    /* Where a moment of the race sits along the chart. The points are the
       only clock it has, so a time between two of them is interpolated
       between their columns. */
    const xAt = t => {
      if (t == null || pts[0].t == null) return null;
      let i = 0;
      while (i < pts.length - 1 && pts[i + 1].t != null && pts[i + 1].t <= t) i += 1;
      const next = pts[i + 1];
      const span = next && next.t != null && pts[i].t != null ? next.t - pts[i].t : 0;
      const frac = span > 0 ? Math.max(0, Math.min(1, (t - pts[i].t) / span)) : 0;
      return x(i) + step * frac;
    };
    const under = t => (c.flags || []).find(f => t != null && t >= f.a && t <= f.b);

    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
        aria-label="Position of every car at the end of each lap">`;

    /* The flags, behind everything else: a race spends these minutes in a
       queue behind the safety car, and the chart goes flat for a reason. */
    (c.flags || []).forEach(f => {
      const x1 = xAt(Math.max(0, f.a)), x2 = xAt(Math.min(f.b, pts[pts.length - 1].t));
      if (x1 == null || x2 == null || x2 <= x1) return;
      const red = /red/i.test(f.k);
      s += `<rect class="lc-flag${red ? ' red' : ''}" x="${x1.toFixed(1)}" y="${M.t}"`
         + ` width="${(x2 - x1).toFixed(1)}" height="${H - M.t - M.b}"/>`
         + `<line class="lc-flag-edge" x1="${x1.toFixed(1)}" y1="${M.t}"`
         + ` x2="${x1.toFixed(1)}" y2="${H - M.b}"/>`
         + `<text class="lc-flag-lab${red ? ' red' : ''}" x="${(x1 + 3).toFixed(1)}"`
         + ` y="${M.t - 6}">${esc(red ? 'Red flag' : 'Safety car')}</text>`;
    });
    s += `<text class="lc-head" x="${M.l}" y="14" text-anchor="middle">Grid</text>`;
    pts.forEach((p, i) => {
      if (!p.lap || p.lap % every) return;
      s += `<text class="lc-head" x="${x(i)}" y="14" text-anchor="middle">${p.lap}</text>`;
    });
    for (let pos = 5; pos <= rows; pos += 5)
      s += `<line class="gl" x1="${M.l}" y1="${y(pos)}" x2="${W - M.r}" y2="${y(pos)}"/>`;

    cars.forEach((no, idx) => {
      let d = '', open = false;
      pts.forEach((p, i) => {
        const pos = p.order.indexOf(no);
        if (pos < 0) { open = false; return; }
        d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(pos + 1).toFixed(1)}`;
        open = true;
      });
      if (!d) return;
      s += `<path class="lc-line" data-car="${esc(no)}" d="${d}"`
         + ` stroke="${carColour(idx)}"/>`;
    });

    [[first, M.l - 10, 'end'], [last, W - M.r + 10, 'start']].forEach(([order, tx, anchor]) => {
      order.forEach((no, i) => {
        s += `<text class="lc-lab" data-car="${esc(no)}" x="${tx}" y="${y(i + 1) + 3.5}"`
           + ` text-anchor="${anchor}" fill="${carColour(cars.indexOf(no))}"`
           + `>${esc(label(no))}</text>`;
      });
    });

    s += `<line class="lc-cross" x1="0" y1="${M.t}" x2="0" y2="${H - M.b}" opacity="0"/>`;
    s += `<line class="lc-play" x1="0" y1="${M.t - 4}" x2="0" y2="${H - M.b}" opacity="0"/>`;
    s += `<rect class="lc-hit" x="${M.l - 14}" y="${M.t}" width="${W - M.l - M.r + 28}"`
       + ` height="${H - M.t - M.b}"/>`;
    s += '</svg>';
    box.innerHTML = s;

    const svg = box.querySelector('svg');
    const cross = box.querySelector('.lc-cross'), play = box.querySelector('.lc-play');
    const nearest = ev => {
      const bb = svg.getBoundingClientRect();
      const px = (ev.clientX - bb.left) / bb.width * W;
      const py = (ev.clientY - bb.top) / bb.height * H;
      return { i: Math.max(0, Math.min(pts.length - 1, Math.round((px - M.l) / step))),
               pos: Math.max(1, Math.min(rows, Math.ceil((py - M.t) / rowH))) };
    };
    const highlight = no => {
      svg.querySelectorAll('.lc-line').forEach(p =>
        p.classList.toggle('on', no != null && p.dataset.car === no));
      svg.querySelectorAll('.lc-line, .lc-lab').forEach(p =>
        p.classList.toggle('dim', no != null && p.dataset.car !== no));
    };

    const hit = box.querySelector('.lc-hit');
    hit.addEventListener('mousemove', ev => {
      const { i, pos } = nearest(ev);
      const p = pts[i], no = p.order[pos - 1];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
      cross.setAttribute('opacity', .9);
      highlight(no || null);
      const e = no ? entryOf(no) : null;
      const flag = under(p.t);
      showTip(`<b>${esc(p.label)}</b> ${esc(p.sub)}`
        + (p.t != null ? ` · <b>${hms(p.t)}</b>` : '')
        + (flag ? ` · <b>${esc(flag.k === 'Red' ? 'red flag' : 'safety car')}</b>` : '')
        + '<br>'
        + (no ? `P${pos} — <b>${esc(no)}</b> ${esc(e ? e.driver : '')}` : '&mdash;')
        + (seek && p.t != null ? '<br><span style="opacity:.7">click to play from here</span>' : ''),
        ev.clientX, ev.clientY);
    });
    hit.addEventListener('mouseleave', () => {
      cross.setAttribute('opacity', 0); highlight(null); hideTip();
    });
    hit.addEventListener('click', ev => {
      const { i } = nearest(ev);
      if (seek && pts[i].t != null) seek(pts[i].t);
    });
    svg.querySelectorAll('.lc-lab').forEach(t => {
      t.addEventListener('mouseenter', () => highlight(t.dataset.car));
      t.addEventListener('mouseleave', () => highlight(null));
    });

    move = t => {
      const end = pts[pts.length - 1].t;
      if (t == null || end == null || t < -20 || t > end + 30) {
        play.setAttribute('opacity', 0);
        return;
      }
      const px = xAt(t);
      if (px == null) { play.setAttribute('opacity', 0); return; }
      play.setAttribute('x1', px); play.setAttribute('x2', px);
      play.setAttribute('opacity', .95);
    };
  };

  draw(false);

  const bar = el('div', 'lapbar');
  bar.innerHTML = `<span>${c.approx
    ? 'The sheet this came from carries no clock, so a click seeks on the assumption '
      + 'that every lap took the same time.'
    : 'Every lap is stamped with the time of day it ended, so a click seeks to that lap.'}${
    (c.flags || []).length ? ' Shaded where the race ran under the safety car or a red flag.' : ''}${
    c.shared ? ' The grid was shared: these are places among the ' + esc(D.short)
             + ' cars, not places on the road.' : ''}
    <span class="src">${esc(c.source)}</span></span>`;
  if (c.ints && c.ints.length) {
    const lab = el('label');
    lab.innerHTML = '<input type="checkbox"> intermediates';
    lab.title = 'Add the two intermediate points inside each lap, where they were published';
    lab.querySelector('input').onchange = ev => draw(ev.target.checked);
    bar.append(lab);
  }
  wrap.append(box, bar);
  return { node: wrap, at: t => move(t) };
}

/* One player at a time: switching race or tab has to stop the old one talking. */
let activeVideo = null;

function stopVideo() {
  if (!activeVideo) return;
  clearInterval(activeVideo.timer);
  removeEventListener('message', activeVideo.onMessage);
  activeVideo = null;
}

/** Where the meeting was shown, for a race no broadcast on the channels covers. */
function shownOnPanel(r) {
  const box = el('div', 'watch');
  box.innerHTML = '<h4>Session video</h4>'
    + '<p class="sync">No broadcast that can be lined up against this race — the '
    + 'channels read cover the meetings Caterham stream and the BTCC race days '
    + `that reached YouTube. ${esc(r.shownOn.name)} carried the meeting: `
    + `<a href="${esc(r.shownOn.url)}" target="_blank" rel="noopener">watch there</a>, `
    + 'though nothing there can be seeked to a lap.</p>';
  return box;
}

/** The session's broadcast, with a seek(t) that means "t seconds into the race". */
function watchPanel(r, onTime) {
  const v = r.video;
  const box = el('div', 'watch');
  box.innerHTML = `<h4>Session video${v.channel ? ' — ' + esc(v.channel) : ''}</h4>`
    + '<div class="vid"><button type="button"><span class="yt">&#9654;</span>'
    + 'Play from the start of the race'
    + `<small>${esc(v.title || '')}</small></button></div>`
    + '<p class="sync">Lined up on the broadcast’s own start time: the race begins '
    + `<b>${hms(v.offset)}</b> into it. `
    + `<a href="https://www.youtube.com/watch?v=${esc(v.id)}&amp;t=${Math.round(v.offset)}s"`
    + ' target="_blank" rel="noopener">Open on YouTube</a></p>';

  const wrap = box.querySelector('.vid');
  let frame = null;

  /* Nothing is requested from YouTube until this is clicked, so a page that is
     only being read never touches a third party. */
  const load = at => {
    const start = Math.max(0, Math.round(v.offset + at));
    if (!frame) {
      stopVideo();
      wrap.innerHTML = '';
      frame = el('iframe');
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      frame.title = v.title || 'Session video';
      frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}`
        + `?start=${start}&autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
      wrap.append(frame);
      listen();
      return;
    }
    post({ event: 'command', func: 'seekTo', args: [start, true] });
    post({ event: 'command', func: 'playVideo', args: [] });
  };

  const post = msg => {
    if (frame && frame.contentWindow)
      frame.contentWindow.postMessage(JSON.stringify(msg), '*');
  };

  /* The player answers "listening" with its current time, several times a
     second. It is not a documented interface; if it says nothing, the chart
     simply has no playhead and everything else still works. */
  const listen = () => {
    const onMessage = ev => {
      if (!/youtube(-nocookie)?\.com$/.test(new URL(ev.origin).host)) return;
      let data;
      try { data = JSON.parse(ev.data); } catch (e) { return; }
      const t = data && data.info && data.info.currentTime;
      if (typeof t === 'number' && onTime) onTime(t - v.offset);
    };
    addEventListener('message', onMessage);
    const timer = setInterval(() => post({ event: 'listening', id: v.id }), 500);
    activeVideo = { timer, onMessage };
  };

  box.querySelector('button').onclick = () => load(0);
  /* The player sits under a full-width chart, so a click on lap 9 can seek
     something that is off the bottom of the screen. Only scroll when it
     actually is - scrolling under someone reading the chart is worse. Behind
     the menus at the top counts as not on the screen. */
  const reveal = () => {
    const b = wrap.getBoundingClientRect();
    if (b.top < topbarH() || b.bottom > innerHeight)
      wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  return { node: box, seek: at => { load(at); reveal(); } };
}

/* --------------------------------------------------------------- races */
function races() {
  const p = $('#p-races'); p.innerHTML = '';
  p.append(Object.assign(el('p', 'lede'), { textContent:
    'Full classification for every race run so far, with the championship points each result was '
    + 'worth. Guest entries are shown greyed — they take no points and the drivers behind them '
    + 'move up a place for scoring. Where the timing company published a lap chart, the race is '
    + 'drawn lap by lap above it: click any point of it to play the broadcast from that moment.' }));
  const pick = el('div', 'picker');
  const sel = el('select', 'picker-select');
  sel.setAttribute('aria-label', 'Select race');
  const picks = el('div', 'picker-buttons');
  const host = el('div');
  const latest = D.races[D.races.length - 1];
  function chooseRace(r) {
    renderRace(host, r);
    sel.value = String(r.round);
    [...picks.children].forEach(x => x.setAttribute('aria-pressed', x.dataset.round === String(r.round)));
  }
  // Newest first: the race that has just run is the one being looked for.
  [...D.races].reverse().forEach(r => {
    const label = `R${r.round} · ${r.eventName.split(' ')[0]}`;
    sel.append(Object.assign(el('option', null, label), { value: String(r.round) }));
    const b = el('button', null, label);
    b.dataset.round = String(r.round);
    b.setAttribute('aria-pressed', r.round === latest.round);
    b.addEventListener('click', () => chooseRace(r));
    picks.append(b);
  });
  sel.value = String(latest.round);
  sel.addEventListener('change', () => {
    const r = D.races.find(x => String(x.round) === sel.value);
    if (!r) return;
    chooseRace(r);
  });
  pick.append(sel, picks);
  p.append(pick, host);
  chooseRace(latest);
}

function renderRace(host, r) {
  host.innerHTML = '';
  const h = el('div', 'racehead');
  h.innerHTML = `<h3>Round ${r.round} — ${esc(r.eventName)}</h3>`
    + `<span class="f">${esc(r.date || '')} · ${esc(r.start || '')}${r.finish ? '–' + esc(r.finish) : ''}</span>`
    // An ITS sheet gives the laps and no distance, so the miles are printed
    // only where the sheet did.
    + (r.laps ? `<span class="f"><b>${r.laps}</b> laps${r.miles ? ` / <b>${r.miles}</b> miles` : ''}</span>` : '')
    + (r.weather ? `<span class="f">${esc(r.weather)}</span>` : '')
    + (r.fastest ? `<span class="f">Fastest lap <b>${esc(r.fastest.time)}</b> — ${esc(r.fastest.driver)}</span>` : '')
    + (dayText(r.issued) ? `<span class="f">Timekeeper issued <b>${esc(dayText(r.issued))}</b></span>` : '')
    + (changedText(r.updated) ? `<span class="f">Results updated <b>${esc(changedText(r.updated))}</b></span>` : '');
  host.append(h);

  // The sheets this classification was rebuilt from, at the timekeeper - under
  // the head rather than beside the source note at the foot, because a reader
  // who wants to check a table wants it before reading the table, not after
  // scrolling past thirty cars of it.
  const official = officialResults(r.event);
  if (official) host.append(official);

  // How the race unfolded, and the video it can be played against. Either can
  // be missing - not every meeting publishes a lap chart, and not every
  // session was streamed - so the row only appears for what exists.
  stopVideo();
  if (r.chart || r.video || r.shownOn) {
    const row = el('div', 'replay');
    let chart = null, watch = null;
    if (r.video) watch = watchPanel(r, t => chart && chart.at(t));
    if (r.chart) chart = lapChart(r, watch ? watch.seek : null);
    if (chart) row.append(chart.node);
    if (watch) row.append(watch.node);
    else if (r.shownOn) row.append(shownOnPanel(r));
    if (row.children.length) host.append(row);
  }

  const sc = el('div', 'scroller'), tb = el('table', 'results');
  tb.innerHTML = '<thead><tr>'
    + ['Pos', 'No', 'Driver', 'Class', 'Laps', 'Race time', 'Best lap', 'On', 'Grid',
       'Race pts', 'FL', 'Pen', 'Round total']
      .map((x, i) => `<th class="${i > 3 ? 'num' : ''}`
        + `${i === 0 ? ' stick1' : i === 2 ? ' stick2' : ''}">${x}</th>`).join('')
    + '</tr></thead>';
  const body = el('tbody');
  const used = new Set();
  r.entries.forEach(e => {
    const tr = el('tr', (e.pos === 1 ? 'win ' : '') + (e.status !== 'classified' ? 'dnf' : '')
      + (e.guest ? ' guest' : ''));
    const cells = [
      [e.pos ?? e.status, 'stick1'], [e.no, 'num'],
      // the class column already says Trophy or Guest where a series prints it
      [e.driver + (e.guest && !(grads() && e.cls) ? ' (guest)' : ''), 'stick2 driver'],
      [e.cls || '—', 'num cls'],
      [e.laps ?? '—', 'num'], [e.time || '—', 'num'], [e.best || '—', 'num'],
      [e.on ?? '—', 'num'], [e.grid ?? '—', 'num'],
      [e.status === 'classified' || e.pts ? e.pts : '—', 'num'],
      [e.fl ? '+1' : '', 'num'], [e.pen || '', 'num'],
      [e.status === 'classified' || e.pts || e.fl || e.pen ? e.total : '—', 'num'],
    ];
    cells.forEach(([v, c], i) => {
      const td = el('td', c, String(v));
      // The driver column is written the way every other table writes one.
      if (i === 2) td.innerHTML = driverCell(String(v), []);
      if (i === 3 && e.cls) { td.innerHTML = classMark(e.cls); used.add(e.cls); }
      if (i === 11 && e.pen) td.style.color = 'var(--alarm)';
      if (i === 12) { td.style.fontWeight = 600; td.classList.add('mono'); }
      tr.append(td);
    });
    body.append(tr);
  });
  tb.append(body); sc.append(tb); host.append(sc);
  // What the marks in the class column mean, across the foot of the table.
  const legend = classLegend(used);
  if (legend) { const l = el('div'); l.innerHTML = legend; host.append(l.firstChild); }

  if (r.notes && r.notes.length) {
    const n = el('div', 'notes');
    n.innerHTML = '<p><b>Officials&rsquo; notes</b></p>' + r.notes.map(x => `<p>${esc(x)}</p>`).join('');
    host.append(n);
  }
  const pens = D.penalties.filter(p => p.round === r.round);
  if (pens.length) {
    const n = el('div', 'notes');
    n.innerHTML = `<p><b>Championship point deductions (reg ${D.penaltyReg})</b></p>`
      + pens.map(p => `<p>${esc(p.driver)} — `
        + (p.licence_points ? `${p.licence_points} licence points, ` : '')
        + `<b>−${p.deduction}</b> championship points. ${esc(p.reason)}. `
        + `<a href="${esc(p.source)}">Where this is published</a></p>`).join('');
    host.append(n);
  }
  const src = el('p', 'sub');
  src.style.marginTop = '10px';
  src.textContent = 'Timing and classification: ' + r.source + '. Results are provisional until '
    + 'the conclusion of any judicial and technical matters.';
  host.append(src);
}

/* ---------------------------------------------------------- qualifying */
/**
 * What counts as a lap.
 *
 * An out-lap's time runs from the last time the car crossed the line, so it
 * carries however long the car sat in the pits with it; a lap the car peeled
 * into the pits on is not one it is credited with either, marked IN PIT by TSL
 * and Pit In by ITS and usually crossed in the pit lane as well (P); a
 * disallowed one is marked D. TSL mark each car's own three best laps (1)(2)(3)
 * on the sheet, and those marks agree with this rule on every sheet of this
 * season - which is how the rule was arrived at rather than guessed at.
 */
const qualValid = l => !!l.time && !l.out && !l.pit && !l.in && !l.dis;

/* Why a lap does not count, for a table that has to say so. What the car was
   doing is the answer, so the flags are read before the time is: a way in that
   ITS printed no time against did not fail to set one, it ended in the pits. */
const qualVoid = l => l.out ? 'out-lap' : l.dis ? 'disallowed'
  : (l.pit || l.in) ? 'pit lane' : !l.time ? 'no time' : '';

/** One car's counting laps, quickest first. */
const qualRun = e => (e.laps || []).filter(qualValid)
  .sort((a, b) => secsOf(a.time) - secsOf(b.time));

/* How many of each car's laps the field chart draws. Five is enough to show
   whether a time was one lap that came together or where the car was all
   session, and few enough that thirty cars still read as thirty lines. */
const QUAL_N = 5;
const QUAL_PLACE = ['Quickest', '2nd', '3rd', '4th', '5th'];

/* How far above the quickest lap the field chart is drawn, as a percentage of
   it. A qualifying field is a few tenths wide at the front and minutes wide at
   the back once somebody has had a scruffy lap, and an axis that fits the back
   of it flattens the front into a single line - so the axis stops, and a line
   that goes past it leaves the bottom of the chart rather than squashing
   everything else flat. 107% is the figure this sport already uses for "off
   the pace"; these grids are wider than a single-seater one, so the default
   here is wider than that. */
const QUAL_CUTS = [[105, '105%'], [110, '110%'], [120, '120%'], [0, 'All']];
let qualCut = 110;

/* Which of the five the table below is ranked on, as an index into them. The
   chart's columns are the control: the quickest lap is the classification and
   any other is a ranking of how much of a session each car had in it, which is
   the question the column itself is drawing. */
let qualRank = 0;

/** Seconds as a lap time: 1:37.826 over a minute, 47.826 under one. */
const lapText = (s, dp = 3) => {
  if (s == null || !isFinite(s)) return '—';
  const m = Math.floor(s / 60), r = s - m * 60;
  return m ? `${m}:${r.toFixed(dp).padStart(dp + 3, '0')}` : r.toFixed(dp);
};

/** A gridline step that lands on a round number of seconds or tenths. */
function niceStep(span, want) {
  const raw = Math.max(span, 1e-6) / want;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw) || pow * 10;
}

/** The session's cars, quickest first, each with the laps that count. */
function qualField(q) {
  return (q.entries || [])
    .map(e => ({ e, best: qualRun(e) }))
    .filter(r => r.best.length)
    .sort((a, b) => secsOf(a.best[0].time) - secsOf(b.best[0].time))
    .map((r, i) => Object.assign(r, { colour: carColour(i) }));
}

function qualifying() {
  const p = $('#p-qualifying'); p.innerHTML = '';
  p.append(Object.assign(el('p', 'lede'), { textContent:
    'Every qualifying session of the season, and — where the meeting’s book '
    + 'published the analysis behind it — every lap that went into it. The first chart '
    + 'holds the whole field: a line per car through its five quickest laps, quickest '
    + 'first, so a car that found one lap and a car that could do it all session read '
    + 'differently. Pick a car, on the chart or in the table, for its own session lap by '
    + 'lap and sector by sector.' }));

  const sessions = D.qualifying || [];
  if (!sessions.length) {
    p.append(Object.assign(el('p', 'sub'), { textContent:
      'No qualifying session of this championship has been published yet.' }));
    return;
  }
  const pick = el('div', 'picker');
  const sel = el('select', 'picker-select');
  sel.setAttribute('aria-label', 'Select qualifying session');
  const picks = el('div', 'picker-buttons');
  const host = el('div');
  const latest = sessions[sessions.length - 1];
  const choose = q => {
    renderQual(host, q);
    sel.value = q.event;
    [...picks.children].forEach(x =>
      x.setAttribute('aria-pressed', x.dataset.ev === q.event));
  };
  [...sessions].reverse().forEach(q => {
    const ev = D.events.find(e => e.key === q.event);
    const label = `${ev ? 'R' + ev.rounds[0] : 'Q'} · ${q.eventName.split(' ')[0]}`;
    sel.append(Object.assign(el('option', null, label), { value: q.event }));
    const b = el('button', null, label);
    b.dataset.ev = q.event;
    b.addEventListener('click', () => choose(q));
    picks.append(b);
  });
  sel.addEventListener('change', () => {
    const q = sessions.find(x => x.event === sel.value);
    if (q) choose(q);
  });
  pick.append(sel, picks);
  p.append(pick, host);
  choose(latest);
}

function renderQual(host, q) {
  host.innerHTML = '';
  const rows = qualField(q);
  const ev = D.events.find(e => e.key === q.event);
  const h = el('div', 'racehead');
  // Not every classification sheet prints when the session ran, and an empty
  // slot is worse than a missing one.
  const when = [q.date, q.start ? `${q.start}–${q.finish || ''}` : '']
    .filter(Boolean).join(' · ');
  h.innerHTML = `<h3>Qualifying — ${esc(q.eventName)}</h3>`
    + (when ? `<span class="f">${esc(when)}</span>` : '')
    + (ev ? `<span class="f">Grid for round <b>${ev.rounds[0]}</b></span>` : '')
    + (q.weather ? `<span class="f">${esc(q.weather)}</span>` : '')
    + (rows.length ? `<span class="f">Pole <b>${esc(rows[0].best[0].time)}</b>`
       + ` — ${esc(rows[0].e.driver)}</span>` : '')
    + (dayText(q.issued) ? `<span class="f">Timekeeper issued <b>${esc(dayText(q.issued))}</b></span>` : '')
    + (changedText(q.updated) ? `<span class="f">Results updated <b>${esc(changedText(q.updated))}</b></span>` : '');
  host.append(h);

  // The meeting's own sheets, for the same reason the Races tab carries them:
  // the grid below was rebuilt from them. It matters more here, because this
  // page draws a session the sheet prints far more about than it shows - the
  // starting grid it produced, and the analysis where a session has no chart
  // above because none was published.
  const official = officialResults(q.event);
  if (official) host.append(official);

  if (!rows.length) {
    // The classification alone, which is all a meeting outside the two British
    // timekeepers' books leaves behind.
    host.append(Object.assign(el('p', 'sub'), { textContent:
      'The lap-by-lap analysis of this session was not published: it exists only '
      + 'inside the meeting’s own book, and not every timekeeper puts one in there. '
      + 'The times that set the grid are below.' }));
    host.append(qualTable(q, [], null, null));
    host.append(qualSource(q));
    return;
  }

  const chartHost = el('div');
  const tableHost = el('div');
  const detailHost = el('div');
  let picked = rows[0].e.no;
  // How many of the five laps anybody in this session actually set. A ranking
  // by a lap nobody has is not one to leave selected when the session changes.
  const cols = Math.max(1, Math.min(QUAL_N, Math.max(...rows.map(r => r.best.length))));
  if (qualRank >= cols) qualRank = 0;

  function drawChart() {
    chartHost.innerHTML = '';
    chartHost.append(qualFieldChart(rows, cols, picked, choose, refresh));
  }
  function drawTable() {
    tableHost.innerHTML = '';
    tableHost.append(qualTable(q, rows, picked, choose));
  }
  /** The cut-off or the ranked lap changed: both the chart and the table move. */
  function refresh() { drawChart(); drawTable(); }
  function choose(no) {
    picked = no;
    drawChart();
    [...tableHost.querySelectorAll('tbody tr')].forEach(tr =>
      tr.classList.toggle('pick', tr.dataset.no === picked));
    detailHost.innerHTML = '';
    const row = rows.find(r => r.e.no === picked);
    if (row) detailHost.append(qualDetail(q, row, rows[0]));
  }

  host.append(chartHost, tableHost, detailHost, qualSource(q));
  drawTable();
  choose(picked);
}

/**
 * Who timed the session, at the foot of it.
 *
 * The Races tab has said this under every classification since there was one,
 * and a qualifying sheet is issued and amended exactly like a race's - a grid
 * penalty applied afterwards is printed on it. The session itself carries no
 * source, so it is read off the meeting, which is where the timekeeper is known.
 */
function qualSource(q) {
  const ev = D.events.find(e => e.key === q.event);
  const by = ev && ev.timing ? ev.timing.by : null;
  const p = el('p', 'sub');
  p.style.marginTop = '10px';
  p.textContent = (by ? `Timing and classification: ${by}. ` : '')
    + 'Results are provisional until the conclusion of any judicial and '
    + 'technical matters.';
  return p;
}

/**
 * The whole field: a line per car through its five quickest laps.
 *
 * The x axis is not time and not lap number - it is how good each lap was for
 * the car that set it, quickest on the left. So every line starts at that car's
 * best and can only rise, and the shape of it is the question this chart is
 * for: a line that climbs steeply had one lap and nothing behind it, a flat one
 * was there all session.
 */
function qualFieldChart(rows, cols, picked, onPick, refresh) {
  const wrap = el('div');
  const box = el('div', 'qbox');
  const pole = secsOf(rows[0].best[0].time);
  const most = Math.max(...rows.map(r => secsOf(r.best[Math.min(cols, r.best.length) - 1].time)));
  let hi = qualCut ? Math.min(most, pole * qualCut / 100) : most;
  if (hi - pole < 0.25) hi = pole + 0.25;
  const lo = pole - (hi - pole) * 0.05;

  const W = 940, H = 420, M = { t: 18, b: 46, l: 80, r: 26 };
  const plotW = W - M.l - M.r, plotH = H - M.t - M.b;
  const gap = cols > 1 ? plotW / (cols - 1) : plotW;
  const x = i => cols > 1 ? M.l + gap * i : M.l + plotW / 2;
  // Quickest at the top, which is where a reader looks for the best of
  // anything - so a line descends as the laps behind a car's best get worse,
  // and one that goes past the cut-off leaves the bottom of the chart.
  const y = t => M.t + plotH * ((t - lo) / (hi - lo));
  const over = rows.filter(r => secsOf(r.best[0].time) > hi).length;

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Each car`
    + `&#39;s five quickest laps of qualifying, quickest first">`
    + `<defs><clipPath id="qclip"><rect x="${M.l - 10}" y="${M.t}"`
    + ` width="${plotW + 20}" height="${plotH}"/></clipPath></defs>`;

  const step = niceStep(hi - lo, 10);
  for (let k = Math.ceil(lo / step); k * step <= hi + 1e-9; k += 1) {
    const t = k * step;
    s += `<line class="gl" x1="${M.l}" y1="${y(t).toFixed(1)}" x2="${W - M.r}"`
       + ` y2="${y(t).toFixed(1)}"/>`
       + `<text class="ax" x="${M.l - 10}" y="${(y(t) + 3.5).toFixed(1)}"`
       + ` text-anchor="end">${lapText(t, 1)}</text>`;
  }
  // The column the table below is ranked by, banded so the two views are
  // visibly the same choice, and every column a target for changing it.
  const bx = Math.max(M.l, x(qualRank) - gap / 2);
  s += `<rect class="q-colband" x="${bx.toFixed(1)}" y="${M.t}"`
     + ` width="${(Math.min(W - M.r, x(qualRank) + gap / 2) - bx).toFixed(1)}"`
     + ` height="${plotH}"/>`;
  for (let i = 0; i < cols; i += 1) {
    const on = i === qualRank;
    s += `<line class="gl" x1="${x(i)}" y1="${M.t}" x2="${x(i)}" y2="${M.t + plotH}"/>`
       + `<rect class="q-col" data-col="${i}" x="${(x(i) - gap / 2).toFixed(1)}"`
       + ` y="${H - M.b + 4}" width="${gap.toFixed(1)}" height="${M.b - 8}"`
       + `><title>Rank the table by each car’s ${esc(QUAL_PLACE[i].toLowerCase())}`
       + ` lap</title></rect>`
       + `<text class="q-xlab${on ? ' on' : ''}" x="${x(i)}" y="${H - M.b + 22}"`
       + ` text-anchor="middle">${QUAL_PLACE[i]}</text>`;
  }
  s += `<text class="q-xlab" x="${M.l}" y="${H - 8}" text-anchor="start"`
     + ` style="text-transform:none;letter-spacing:0">`
     + `That car’s own laps, quickest first — click one to rank the table by it</text>`;

  s += '<g clip-path="url(#qclip)">';
  rows.forEach(r => {
    const d = r.best.slice(0, cols).map((l, i) =>
      `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(secsOf(l.time)).toFixed(1)}`).join('');
    // Nothing is dimmed until something is hovered: a field of thirty cars is
    // the point of this chart, and the picked car stands out by weight alone.
    s += `<path class="q-line${r.e.no === picked ? ' on' : ''}"`
       + ` data-no="${esc(r.e.no)}" d="${d}" stroke="${r.colour}"/>`;
  });
  // Dots for the picked car only: thirty cars would be a hundred and fifty.
  const pick = rows.find(r => r.e.no === picked);
  if (pick) {
    pick.best.slice(0, cols).forEach((l, i) => {
      s += `<circle class="q-dot" cx="${x(i).toFixed(1)}"`
         + ` cy="${y(secsOf(l.time)).toFixed(1)}" r="3.6" fill="${pick.colour}"/>`;
    });
    // Against the last point still on the chart, so a car whose fifth lap is
    // past the cut-off is still named - and under it, because the line now
    // arrives at that point from above.
    const shown = pick.best.slice(0, cols)
      .map((l, i) => [i, secsOf(l.time)]).filter(([, t]) => t <= hi);
    const [last, lt] = shown.length ? shown[shown.length - 1]
      : [0, secsOf(pick.best[0].time)];
    const ly = y(lt);
    s += `<text class="q-name" x="${(x(last) - 8).toFixed(1)}" y="${(ly + 17).toFixed(1)}"`
       + ` text-anchor="end" fill="${pick.colour}">`
       + `${esc(pick.e.no)} ${esc(pick.e.driver.split(' ').slice(-1)[0])}</text>`;
  }
  s += '</g>';
  s += `<rect class="q-hit" x="${M.l - 14}" y="${M.t}" width="${plotW + 28}"`
     + ` height="${plotH}"/></svg>`;
  box.innerHTML = s;

  const svg = box.querySelector('svg');
  const nearest = evt => {
    const bb = svg.getBoundingClientRect();
    const px = (evt.clientX - bb.left) / bb.width * W;
    const py = (evt.clientY - bb.top) / bb.height * H;
    const i = Math.max(0, Math.min(cols - 1, Math.round((px - M.l) / gap)));
    let hit = null, near = 1e9;
    rows.forEach(r => {
      const l = r.best[i];
      if (!l) return;
      const d = Math.abs(y(secsOf(l.time)) - py);
      if (d < near) { near = d; hit = r; }
    });
    return { i, row: near < 26 ? hit : null };
  };
  const highlight = no => {
    svg.querySelectorAll('.q-line').forEach(pth => {
      pth.classList.toggle('on', pth.dataset.no === (no != null ? no : picked));
      pth.classList.toggle('dim', no != null && pth.dataset.no !== no);
    });
  };
  const hit = box.querySelector('.q-hit');
  hit.addEventListener('mousemove', evt => {
    const { i, row } = nearest(evt);
    highlight(row ? row.e.no : null);
    if (!row) { hideTip(); return; }
    const t = secsOf(row.best[i].time), best = secsOf(row.best[0].time);
    showTip(`<b>${esc(row.e.no)}</b> ${esc(row.e.driver)}`
      + `<br>${esc(QUAL_PLACE[i])} lap — <b>${esc(row.best[i].time)}</b>`
      + ` on lap ${row.best[i].lap}`
      + (i ? ` <span style="opacity:.7">(+${(t - best).toFixed(3)} on their own best)</span>` : '')
      + (row.e.no === rows[0].e.no ? ''
         : `<br><span style="opacity:.7">+${(best - pole).toFixed(3)} off pole</span>`)
      + '<br><span style="opacity:.7">click for this car’s session</span>',
      evt.clientX, evt.clientY);
  });
  hit.addEventListener('mouseleave', () => { highlight(null); hideTip(); });
  hit.addEventListener('click', evt => {
    const { row } = nearest(evt);
    if (row) onPick(row.e.no);
  });
  box.querySelectorAll('.q-col').forEach(r => {
    r.addEventListener('click', () => { qualRank = Number(r.dataset.col); refresh(); });
  });

  const bar = el('div', 'qbar');
  const note = el('span');
  note.innerHTML = 'Pole is at the top rather than zero at the bottom, and the axis '
    + 'stops at '
    + (qualCut ? `<b>${qualCut}%</b> of it` : 'the slowest lap drawn')
    + ' — a line that leaves the bottom of the chart was slower than that. '
    + (over ? `${over} car${over > 1 ? 's are' : ' is'} off the chart altogether at this cut-off. ` : '')
    + 'Hover for a car, click for its session; click a column to rank the table '
    + 'below by that lap.';
  // The chart's own columns are the control a reader finds; these are the one
  // that is always there and big enough for a thumb.
  const ranks = el('div', 'cuts');
  ranks.append(Object.assign(el('span', 'k'), { textContent: 'Rank by' }));
  for (let i = 0; i < cols; i += 1) {
    const b = el('button', null, QUAL_PLACE[i]);
    b.setAttribute('aria-pressed', i === qualRank);
    b.title = `Rank the table by each car’s ${QUAL_PLACE[i].toLowerCase()} lap`;
    b.addEventListener('click', () => { qualRank = i; refresh(); });
    ranks.append(b);
  }
  const cuts = el('div', 'cuts');
  cuts.append(Object.assign(el('span', 'k'), { textContent: 'Cut-off' }));
  QUAL_CUTS.forEach(([pct, label]) => {
    const b = el('button', null, label);
    b.setAttribute('aria-pressed', pct === qualCut);
    b.title = pct ? `Draw up to ${label} of the pole time` : 'Draw every lap, however slow';
    b.addEventListener('click', () => { qualCut = pct; refresh(); });
    cuts.append(b);
  });
  const controls = el('div', 'controls');
  controls.append(ranks, cuts);
  bar.append(note, controls);
  wrap.append(box, bar);
  return wrap;
}

/**
 * The session, ranked by whichever of the five laps the chart has selected.
 *
 * On the quickest lap that is the classification itself, printed in the order
 * it was published - which is not always time order, because a car can be
 * moved down it after the session. Any other column is a ranking this page
 * makes rather than one anybody published, so it is ordered here, and it says
 * which lap it is ordered on: "who was quickest on their third-best lap" is a
 * question about how much of a session a car had in it, and it is the same
 * question the chart's third column is drawing.
 *
 * `base` is the championship whose sheet this is, for the class marks: the
 * live view puts the other championships' published qualifying under a shared
 * session, and those are not the one on show.
 */
function qualTable(q, rows, picked, onPick, base) {
  const laps = rows.length;
  const rank = laps ? Math.min(qualRank, Math.max(...rows.map(r => r.best.length)) - 1) : 0;
  const lap = r => (r ? r.best[rank] : null);
  const byNo = {};
  rows.forEach(r => { byNo[r.e.no] = r; });

  // The order, and with it what the first column counts.
  let list;
  if (!laps || !rank) {
    list = (q.entries || []).map(e => ({ e, r: byNo[e.no] }));
  } else {
    const has = rows.filter(r => lap(r))
      .sort((a, b) => secsOf(lap(a).time) - secsOf(lap(b).time));
    // A car that never set that many counting laps has no place in this
    // ranking, and goes under it in the order it was classified.
    const few = rows.filter(r => !lap(r)).sort((a, b) => (a.e.pos || 99) - (b.e.pos || 99));
    const none = (q.entries || []).filter(e => !byNo[e.no]);
    list = has.concat(few).map(r => ({ e: r.e, r }))
      .concat(none.map(e => ({ e })));
  }
  const lead = rank && list.length && lap(list[0].r) ? secsOf(lap(list[0].r).time)
    : (laps ? secsOf(rows[0].best[0].time) : null);

  const sc = el('div', 'scroller'), tb = el('table', 'results qtab');
  const head = [rank ? '#' : 'Pos', 'No', 'Driver', 'Class',
                rank ? `${QUAL_PLACE[rank]} best` : 'Best lap', 'Gap']
    .concat(laps ? ['On lap', 'Laps', 'Counting'] : [])
    .concat(rank ? ['Qual'] : []);
  tb.innerHTML = '<thead><tr>' + head.map((x, i) =>
    `<th class="${i > 3 ? 'num' : ''}${i === 0 ? ' stick1' : i === 2 ? ' stick2' : ''}"`
    + `>${x}</th>`).join('') + '</tr></thead>';
  const body = el('tbody');
  const used = new Set();
  let place = 0;
  list.forEach(({ e, r }) => {
    const l = lap(r);
    const t = rank ? (l ? secsOf(l.time) : null) : (e.time ? secsOf(e.time) : null);
    const ranked = rank ? !!l : !!e.pos;
    if (ranked) place += 1;
    const tr = el('tr', ((rank ? place === 1 : e.pos === 1) ? 'win ' : '')
      + (ranked ? '' : 'dnf') + (r && r.e.no === picked ? ' pick' : ''));
    tr.dataset.no = e.no;
    const cells = [
      [rank ? (ranked ? place : '—') : (e.pos ?? '—'), 'stick1'], [e.no, 'num'],
      [e.driver, 'stick2 driver'], [e.cls || '—', 'num cls'],
      [(rank ? (l && l.time) : e.time) || '—', 'num mono'],
      [t != null && lead != null ? (t === lead ? '—' : '+' + (t - lead).toFixed(3))
        : '—', 'num mono'],
    ].concat(laps ? [
      [l ? l.lap : '—', 'num'],
      [r ? (r.e.laps || []).length : '—', 'num'],
      [r ? r.best.length : '—', 'num'],
    ] : []).concat(rank ? [[e.pos ?? '—', 'num']] : []);
    cells.forEach(([v, c], i) => {
      const td = el('td', c, String(v));
      if (i === 2) td.innerHTML = driverCell(String(v), r
        ? [`<span class="swatch" style="background:${r.colour}"></span>`] : []);
      if (i === 3 && e.cls) { td.innerHTML = classMark(e.cls, base); used.add(e.cls); }
      tr.append(td);
    });
    if (r && onPick) tr.addEventListener('click', () => onPick(e.no));
    body.append(tr);
  });
  tb.append(body); sc.append(tb);
  const out = el('div');
  out.append(sc);
  const legend = classLegend(used, base);
  if (legend) { const l = el('div'); l.innerHTML = legend; out.append(l.firstChild); }
  if (laps) out.append(Object.assign(el('p', 'sub'), { textContent:
    (rank ? `Ranked on each car’s ${QUAL_PLACE[rank].toLowerCase()}-best counting lap, `
        + 'which is the column the chart has selected, not a published order — Qual is '
        + 'where the car actually qualified. Cars with fewer counting laps than that '
        + 'follow, in the order they were classified. '
      : '')
    + 'Laps is every lap the car was timed over; counting is how many of them were laps '
    + 'it is credited with — an out-lap carries the time spent in the pits with it, '
    + 'and a lap the car came into the pits on or that was disallowed is not one either. '
    + 'Click a row for that car’s session.' }));
  return out;
}

/** One car's session: what it was timed over, and what each lap was made of. */
function qualDetail(q, row, poleRow) {
  const out = el('div');
  const e = row.e, laps = e.laps || [];
  const best = secsOf(row.best[0].time), pole = secsOf(poleRow.best[0].time);
  const h = el('div', 'qhead');
  h.innerHTML = `<h4><span class="swatch" style="background:${row.colour}"></span>`
    + `${esc(e.no)} — ${esc(e.driver)}</h4>`
    + (e.cls ? `<span class="f">${esc(e.cls)}</span>` : '')
    + `<span class="f">Qualified <b>P${e.pos ?? '—'}</b></span>`
    + `<span class="f">Best <b>${esc(row.best[0].time)}</b> on lap `
    + `<b>${row.best[0].lap}</b></span>`
    + (e.no === poleRow.e.no ? '<span class="f">Pole</span>'
       : `<span class="f"><b>+${(best - pole).toFixed(3)}</b> off pole</span>`)
    + `<span class="f"><b>${laps.length}</b> laps, `
    + `<b>${row.best.length}</b> counting</span>`;
  out.append(h);
  out.append(qualCarChart(row, q.sectors || 0));
  out.append(qualLapTable(row, q.sectors || 0));
  return out;
}

/**
 * One car's session, a row per thing that was timed.
 *
 * The lap and each of its sectors get a chart of their own rather than one
 * chart between them: a sector is thirty seconds and a lap is a hundred, and
 * drawn against each other on one scale the sectors flatten into three
 * straight lines. Stacked against the same x axis they answer the question
 * that is actually being asked - which part of the lap the time came out of.
 */
function qualCarChart(row, sectors) {
  const laps = row.e.laps || [];
  const n = laps.length;
  const series = [{ k: 'Lap', c: 'var(--racing)',
                    v: l => (qualValid(l) ? secsOf(l.time) : null) }];
  for (let i = 0; i < sectors; i += 1)
    series.push({ k: `Sector ${i + 1}`, c: `var(--s${i + 1})`,
                  v: l => (l.s && l.s[i] ? secsOf(l.s[i]) : null) });
  const live = series.filter(ser => laps.some(l => ser.v(l) != null));

  const box = el('div', 'qbox');
  // The left margin holds a row's name and the range printed under it, which
  // is as wide as two lap times and a dash.
  const W = 940, M = { t: 12, b: 38, l: 136, r: 20 }, rowH = 74;
  const H = M.t + M.b + rowH * live.length;
  const plotW = W - M.l - M.r;
  const gap = n > 1 ? plotW / (n - 1) : plotW;
  const x = i => n > 1 ? M.l + gap * i : M.l + plotW / 2;

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Every lap `
    + `${esc(row.e.driver)} was timed over, and the sectors inside it">`;

  // A lap that does not count, shaded the whole height of the chart: the
  // reason the lap line has a hole in it is then visible on every row at once.
  laps.forEach((l, i) => {
    if (qualValid(l)) return;
    // Kept inside the plot: the first and last laps are half a step from the
    // edge, and a band that ran past it would sit over the row names.
    const vx = Math.max(M.l - 8, x(i) - gap / 2);
    const vw = Math.min(W - M.r + 8, x(i) + gap / 2) - vx;
    s += `<rect class="q-void" x="${vx.toFixed(1)}" y="${M.t}"`
       + ` width="${vw.toFixed(1)}" height="${H - M.t - M.b}"/>`
       + `<text class="q-void-lab" x="${x(i).toFixed(1)}" y="${H - M.b + 26}"`
       + ` text-anchor="middle">${esc(qualVoid(l))}</text>`;
  });

  live.forEach((ser, j) => {
    const top = M.t + rowH * j, inner = top + 20, innerH = rowH - 32;
    const vals = laps.map(ser.v);
    const have = vals.filter(v => v != null);
    let lo = Math.min(...have), hi = Math.max(...have);
    if (hi - lo < 0.05) { lo -= 0.2; hi += 0.2; }
    const pad = (hi - lo) * 0.14;
    const y = v => inner + innerH * (1 - (v - (lo - pad)) / ((hi + pad) - (lo - pad)));
    if (j) s += `<line class="q-sep" x1="${M.l - 126}" y1="${top}" x2="${W - M.r}"`
              + ` y2="${top}"/>`;
    s += `<text class="q-row-k" x="${M.l - 12}" y="${(inner + 4).toFixed(1)}"`
       + ` text-anchor="end">${esc(ser.k)}</text>`
       + `<text class="q-row-v" x="${M.l - 12}" y="${(inner + 19).toFixed(1)}"`
       + ` text-anchor="end">${lapText(lo)} – ${lapText(hi)}</text>`;

    let d = '', open = false;
    vals.forEach((v, i) => {
      if (v == null) { open = false; return; }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      open = true;
    });
    if (d) s += `<path class="q-line on" d="${d}" stroke="${ser.c}"/>`;
    vals.forEach((v, i) => {
      if (v == null) return;
      const top1 = v === lo;
      s += `<circle class="q-dot${top1 ? ' q-mark' : ''}" cx="${x(i).toFixed(1)}"`
         + ` cy="${y(v).toFixed(1)}" r="${top1 ? 4.2 : 2.8}"`
         + `${top1 ? '' : ` fill="${ser.c}"`}/>`;
      if (top1)
        s += `<text class="q-row-v q-mark" x="${x(i).toFixed(1)}"`
           + ` y="${(y(v) - 8).toFixed(1)}" text-anchor="middle">${lapText(v)}</text>`;
    });
  });

  const every = Math.ceil(n / 24);
  laps.forEach((l, i) => {
    if (i % every) return;
    s += `<text class="ax" x="${x(i).toFixed(1)}" y="${H - M.b + 14}"`
       + ` text-anchor="middle">${l.lap}</text>`;
  });
  s += `<text class="q-xlab" x="${M.l - 12}" y="${H - M.b + 14}" text-anchor="end"`
     + ` style="text-transform:none;letter-spacing:0">Lap</text></svg>`;
  box.innerHTML = s;

  const bar = el('div', 'qbar');
  bar.innerHTML = '<span>Each row has a scale of its own, printed under its name, because '
    + 'a sector and a lap are not the same length of time. The quickest of each is marked. '
    + (sectors ? 'Add the sector bests together and you have the ideal lap this car never '
        + 'quite put together. '
      : 'This meeting’s timekeepers published no sector times, so the lap is all there is. ')
    + 'Shaded where a lap did not count.</span>';
  const wrap = el('div');
  wrap.append(box, bar);
  return wrap;
}

/** The same session as a table, quickest lap first. */
function qualLapTable(row, sectors) {
  const laps = row.e.laps || [];
  const counted = row.best;
  const order = counted.concat(laps.filter(l => !qualValid(l)));
  const sBest = Array.from({ length: sectors }, (_, i) =>
    Math.min(...laps.map(l => (l.s && l.s[i] ? secsOf(l.s[i]) : Infinity))));
  const best = secsOf(counted[0].time);

  const sc = el('div', 'scroller'), tb = el('table', 'results');
  const head = ['Lap', 'Lap time', 'Gap']
    .concat(Array.from({ length: sectors }, (_, i) => `Sector ${i + 1}`)).concat(['']);
  tb.innerHTML = '<thead><tr>' + head.map((x, i) =>
    `<th class="num${i ? '' : ' stick1'}">${x}</th>`).join('') + '</tr></thead>';
  const body = el('tbody');
  order.forEach(l => {
    const dead = !qualValid(l);
    const t = l.time ? secsOf(l.time) : null;
    const tr = el('tr', dead ? 'dnf' : (l === counted[0] ? 'win' : ''));
    const cells = [[l.lap, 'num stick1'], [l.time || '—', 'num mono'],
                   [dead || t == null || t === best ? '—' : '+' + (t - best).toFixed(3),
                    'num mono']];
    for (let i = 0; i < sectors; i += 1) {
      const v = l.s && l.s[i] ? l.s[i] : null;
      cells.push([v || '—', 'num mono' + (v && secsOf(v) === sBest[i] ? ' qmark' : '')]);
    }
    cells.push([dead ? qualVoid(l) : (l.rank ? `${l.rank}${ordinal(l.rank)} best` : ''),
                'num' + (dead ? ' void' : '')]);
    cells.forEach(([v, c]) => tr.append(el('td', c, String(v))));
    body.append(tr);
  });
  tb.append(body); sc.append(tb);
  const out = el('div');
  out.append(sc);
  out.append(Object.assign(el('p', 'sub'), { textContent:
    'Quickest lap first, then the laps that did not count, in the order they were run. '
    + 'The quickest of each sector is marked: they are rarely all on the same lap.' }));
  return out;
}

/* ------------------------------------------------------------ calendar */

/* What each kind of club link is called here, whatever the club called it. */
const LINK_NAME = { video: 'Video', timetable: 'Timetable',
                    results: 'Timing & results', noticeboard: 'Noticeboard' };

/**
 * The organising club's page for a meeting, and the links it publishes on it.
 *
 * The page is the one address that holds everything about a meeting the timing
 * sheets do not - so it is linked against the meeting, and the stream,
 * timetable, results and noticeboard it carries are repeated beside it, which
 * makes reaching any of them one click rather than three. Where a club puts up
 * more than one of a kind - a stream a day, say - each keeps the club's own
 * wording, which is the only thing that tells them apart.
 */
function eventLinks(ev) {
  let club = '';
  try {
    const host = new URL(ev.url).hostname;
    club = /barc\.net$/.test(host) ? 'BARC ' : /brscc\.co\.uk$/.test(host) ? 'BRSCC ' : '';
  } catch (e) { /* an address the app cannot parse still makes a link */ }

  const links = ev.links || [];
  const chips = [[`${club}event page`, ev.url, 'page', ev.meeting || '']];
  links.forEach(x => chips.push([
    links.filter(y => y.kind === x.kind).length > 1 ? x.label : (LINK_NAME[x.kind] || x.label),
    x.url, '', x.label]));

  const p = el('p', 'evlinks');
  p.innerHTML = chips.map(([name, url, cls, title]) =>
    `<a class="${cls}" href="${esc(url)}" title="${esc(title)}" target="_blank"`
    + ` rel="noopener">${esc(name)}</a>`).join('');
  return p;
}

/**
 * The sessions a meeting holds for this series, one row per round.
 *
 * The rounds are in the regulations, so they are what the list is built from:
 * a race cannot go missing because no timetable was published for its meeting,
 * or because the timetable could not be read. The timetable only supplies the
 * scheduled times, matched to the rounds in the order it prints them, and the
 * classification sheets supply the times the sessions actually ran at.
 */
function meetingSessions(e, t) {
  const rows = [];
  const qual = t.actual.find(x => x.race_in_event === 0);
  const qualSched = t.scheduled.find(s => s.kind === 'qualifying');
  if (qual || qualSched) rows.push({ name: 'Qualifying', s: qualSched, a: qual });
  const raced = t.scheduled.filter(s => s.kind === 'race');
  e.rounds.forEach((n, i) => rows.push({
    name: `Round ${n}`, s: raced[i],
    a: t.actual.find(x => x.race_in_event === i + 1) }));
  return rows;
}

function calendar() {
  const p = $('#p-calendar'); p.innerHTML = '';
  p.append(Object.assign(el('p', 'lede'), { textContent:
    `${D.events.length} meetings, ${D.roundsTotal} races. Every round the regulations list is `
    + 'shown whether or not its meeting has run. Scheduled session times come from the meeting '
    + 'timetable, where one has been published; actual start times are those printed on the '
    + 'classification sheets. Each meeting carries the organising club’s page for it, and the '
    + 'stream, timetable, timing and noticeboard that page publishes.' }));
  const g = el('div', 'grid');
  // Last meeting first. The season is read from where it has got to - the one
  // that has just run and the one that is next - and a list in calendar order
  // buries both under however many months are already over.
  [...D.events].reverse().forEach(e => {
    const t = D.timings[e.key] || { scheduled: [], actual: [] };
    const done = !!e.source;
    const c = el('div', 'card' + (done ? '' : ' future'));
    const first = e.rounds[0], last = e.rounds[e.rounds.length - 1];
    c.innerHTML = '<div class="card-h"><span class="rnd">'
      + `R${first}${last > first ? '–' + last : ''}</span>`
      + `<h3>${esc(e.name)}</h3><span class="when">${esc(e.dates)}</span></div>`;
    const b = el('div', 'card-b');
    const ses = el('div', 'ses');
    meetingSessions(e, t).forEach(({ name, s, a }) => {
      ses.innerHTML += `<span class="t">${s ? esc(s.start) + (s.end ? '–' + esc(s.end) : '') : '—'}</span>`
        + `<span class="n">${esc(name)}${s && s.day ? ' <span style="color:var(--ink-3)">· '
          + esc(dayWord(s.day)) + '</span>' : ''}</span>`
        + `<span class="r">${a && a.start ? 'ran ' + esc(a.start) : (done ? '' : 'scheduled')}</span>`;
    });
    b.append(ses);
    const winners = D.races.filter(r => r.event === e.key)
      .map(r => `R${r.round} ${esc(r.entries[0] ? r.entries[0].driver : '')}`);
    const m = el('div', 'meta');
    m.innerHTML = (winners.length ? `<b>Winners:</b> ${winners.join(' · ')}<br>` : '')
      + esc(e.meeting);
    b.append(m);
    if (e.url) b.append(eventLinks(e));
    c.append(b); g.append(c);
  });
  p.append(g);
}

/* --------------------------------------------------------------- radar */
/**
 * The weather over the circuit.
 *
 * The one question a race day asks that no timing sheet can answer, and the
 * only page here that is not made of numbers somebody published.
 *
 * This is meteoblue's own maps widget, pointed at the circuit. Drawing the map
 * ourselves was tried first and the ceiling was low: a public radar feed only
 * ever looks backwards, the one this page used publishes no extrapolated frames
 * at all, and a forecast grid cheap enough to fetch per reader was 30km between
 * points - a front, never a shower. meteoblue serve the thing itself, seven days
 * of it, with their own model behind it, and a page about a championship has no
 * business trying to out-forecast them.
 *
 * What is ours is everything around it: which circuit, and why that one.
 *
 * The widget is one iframe and is not loaded until the tab is opened. A reader
 * who came for the standings should not be calling on a weather service to get
 * them, and `geoloc=fixed` is what stops the widget asking them where they are:
 * the question this tab answers is about the circuit, never about the reader.
 */
const MB_WIDGET = 'https://www.meteoblue.com/en/weather/maps/widget/';
/* Which maps the reader can choose between, on the widget's own panel.

   Which one it opens on is not decided by this list. The widget takes the
   first map it has in its own fixed order - wind animation, gust, satellite,
   clouds and precipitation, temperature, sunshine, extreme forecast - and no
   query parameter overrides that; listing them in another order changes
   nothing, it was tried. What does override it is the fragment: the widget
   writes its state into the address as it is used, and reads it back on load.
   So MB_OPEN below picks the rain, and a map above the rain in their order can
   be offered without seizing the tab from it.

   Gust and satellite are still off, and that is now only a matter of how long
   the panel should be rather than anything forced. Satellite is the one worth
   reconsidering: it carries the observed radar in quarter-hour frames. */
const MB_MAPS = 'cloudsAndPrecipitation=1&windAnimation=1&temperature=1'
  + '&sunshine=1&extremeForecastIndex=1&gust=0&satellite=0';
/* The map this tab is for, in the shape the widget writes its own fragment in:
   layer, then that layer's own settings. Rain, hourly, whichever model it likes,
   at the surface. */
const MB_OPEN = '#map=cloudsAndPrecipitation~hourly~auto~sfc~none';
/* meteoTV under the map: meteoblue's own screen, cut down to the one thing
   their map widget cannot do at all. It plays, and what it plays is the
   observed radar in quarter-hour frames - rain that fell, which is the half of
   the question the map above, being a forecast, can never answer. Their screen
   will also carry today's forecast, a five-day one and the satellite; those are
   turned off in each saved screen, because the map already says all three and a
   tab strip repeating them is width spent twice.

   It is the one piece here that cannot follow a coordinate. A meteoTV is a
   saved screen on a meteoblue account with its location baked in, so each
   circuit needs its own, made by hand, and `circuits` in data/series.json
   carries the code against the circuit. A circuit without one shows no screen
   and says so rather than showing somebody else's weather. */
const MB_TV = 'https://www.meteoblue.com/en/weather/meteotv/show?code=';

/* meteoblue's scale runs 1 to 10 and counts the other way from a slippy map's:
   1 is most of a hemisphere, 10 is the closest they go - about forty kilometres
   across, which puts the circuit and the villages around it on the screen. Out
   of range does not clamp, it falls back to a world map, so 10 is the ceiling
   and not a number to nudge upwards. The reader zooms out on meteoblue's own
   controls to see what is on its way. */
const MB_ZOOM = 10;

const RADAR = {
  ev: null,     // the meeting being looked at
  at: null,     // where its circuit is
  els: null,
  shown: false,
  loaded: '',   // the address the map is on, so it is not reloaded for nothing
  loadedTv: '',     // and the same for the screen under it
};

/**
 * A circuit as meteoblue addresses one.
 *
 * Latitude with its hemisphere spelled out, longitude signed - Oulton Park is
 * `53.180N-2.614E`. Every circuit on these calendars is north of the equator,
 * which is the only reason the N can be written rather than worked out.
 */
const mbPlace = at => `${at.lat.toFixed(3)}N${at.lon.toFixed(3)}E`;

const mbSrc = at => `${MB_WIDGET}${mbPlace(at)}?${MB_MAPS}`
  + `&geoloc=fixed&tempunit=C&lengthunit=metric&windunit=km%252Fh`
  + `&zoom=${MB_ZOOM}&autowidth=auto${MB_OPEN}`;

const mbTvSrc = code => `${MB_TV}${encodeURIComponent(code)}&hideclock=0`;

/**
 * One frame, pointed at one circuit.
 *
 * No `allow` attribute, deliberately. Geolocation is off inside an iframe
 * unless the embedding page hands it over, so not listing it is what stops the
 * widget asking the reader where they are - `geoloc=fixed` in the address says
 * the same thing, and this is the half of it the browser enforces.
 */
function mbFrame(src, title) {
  const f = el('iframe');
  f.title = title || 'meteoblue weather maps';
  f.setAttribute('frameborder', '0');
  f.setAttribute('scrolling', 'no');
  f.src = src;
  return f;
}

/**
 * The meeting this tab is about: the one running today, or the one next, or -
 * with the season over - the one that ran last.
 *
 * Unlike the live tab this does not care who is timing the meeting or whether
 * there is a feed for it. Rain falls on a meeting nobody is timing.
 */
function radarMeeting(d) {
  const today = isoDay(new Date());
  return d.events.find(e => e.first <= today && today <= e.last)
    || d.events.find(e => e.first >= today)
    || d.events[d.events.length - 1] || null;
}

/** Running, next, or the last one there was - in a word, for the head. */
function radarWhen(e) {
  const today = isoDay(new Date());
  if (!e) return '';
  if (e.first <= today && today <= e.last) return 'racing today';
  return e.first > today ? 'next' : 'last meeting';
}

/** Build the tab. Nothing is loaded here - that waits until it is looked at. */
function radar() {
  const p = $('#p-radar');
  p.innerHTML = '';
  RADAR.els = null;
  RADAR.loaded = '';
  RADAR.loadedTv = '';

  p.append(Object.assign(el('p', 'lede'), { textContent:
    'Rain and cloud over the circuit, a week ahead, on meteoblue’s own map — with wind, '
    + 'temperature, sunshine and the extreme forecast behind the same picker — and under '
    + 'it the radar over that circuit, playing. It opens on the meeting that is running, '
    + 'or on the one that is next, and any other meeting on the calendar can be looked at '
    + 'instead.' }));

  const start = radarMeeting(D);
  if (!start) {
    p.append(Object.assign(el('div', 'note'), { textContent:
      'This season has no meetings on it, so there is nowhere to point a map.' }));
    return;
  }

  // Which circuit, in the picker every other tab chooses a race with.
  const pick = el('div', 'picker');
  const sel = el('select', 'picker-select');
  sel.setAttribute('aria-label', 'Select circuit');
  const picks = el('div', 'picker-buttons');
  D.events.forEach(e => {
    sel.append(Object.assign(el('option', null, e.name), { value: e.key }));
    const b = el('button', null, e.name);
    b.dataset.key = e.key;
    b.setAttribute('aria-pressed', e.key === start.key);
    b.addEventListener('click', () => choose(e));
    picks.append(b);
  });
  sel.value = start.key;
  sel.addEventListener('change', () => {
    const e = D.events.find(x => x.key === sel.value);
    if (e) choose(e);
  });
  pick.append(sel, picks);

  const head = el('div', 'radarhead');
  const box = el('div', 'radarmap');

  // The screen goes under the map: the map is the one to read first, and this
  // is the one that moves. Its own box, 16:9, because that is the shape
  // meteoblue draw a meteoTV for - it is meant for a screen on a wall.
  const tv = el('div', 'radartv');
  const tvnote = el('p', 'radartvnote');

  const legend = el('p', 'radarsrc');
  legend.innerHTML = 'Map and radar by <a href="https://www.meteoblue.com/"'
    + ' target="_blank" rel="noopener">meteoblue</a>, both centred on the circuit.'
    + ' The map’s own controls sit on it — the panel at the top right chooses which map'
    + ' and zooms it, the bar along the foot steps through the days and hours, and on a'
    + ' narrow screen that panel folds into the button in the corner. The radar below it'
    + ' runs on its own, a frame every quarter of an hour.';

  const note = el('div', 'note');
  note.innerHTML = '<b>The map is a forecast; the radar under it is not.</b> Everything '
    + 'on the map is what a weather model expects, and nothing on it was measured at the '
    + 'circuit — the further into the week its bar goes, the less it is worth. The radar '
    + 'below is the opposite kind of fact: rain that has already fallen, seen from the '
    + 'ground up, a frame every quarter of an hour. '
    + '<b>And rain is not a wet track:</b> a circuit stays wet long after the shower has '
    + 'gone through, and dries at its own rate afterwards. What the conditions actually '
    + 'were on the day is on the classification sheet, which is the only record of it on '
    + 'this site.';

  p.append(pick, head, box, tv, tvnote, legend, note);
  RADAR.els = { head, box, tv, tvnote, at: null };

  function choose(e) {
    sel.value = e.key;
    [...picks.children].forEach(b => b.setAttribute('aria-pressed', b.dataset.key === e.key));
    radarGoTo(e);
  }
  choose(start);
}

/** Point the map at one meeting's circuit, and draw the head above it. */
function radarGoTo(e) {
  if (!RADAR.els) return;
  RADAR.ev = e;
  RADAR.at = (ALL.circuits || {})[e.key] || null;

  const when = radarWhen(e);
  // The circuit, the meeting and when it runs. Which rounds it carries is the
  // calendar's business and the standings' - the question this tab is open for
  // is what the sky is doing over that piece of ground.
  RADAR.els.head.innerHTML = '<span class="who">'
    + `<span class="ev"><span class="nm">${esc(e.name)}</span>`
    + `<small>${esc(e.meeting || '')}${e.meeting ? ' · ' : ''}${esc(e.dates)}</small></span>`
    + `<span class="when${when === 'racing today' ? '' : ' future'}">${esc(when)}</span>`
    + '</span>';

  if (!RADAR.at) {
    radarFail(`No position is recorded for ${e.name}, so there is nothing to centre `
      + 'a map on.');
    return;
  }
  // What is on the screen rather than what the routing thinks is: switching
  // series rebuilds this tab whether or not anybody is on it, and nothing here
  // should reach meteoblue until somebody is.
  if ($('#p-radar').classList.contains('on')) radarShow(true);
}

/** Say why there is no map. */
function radarFail(text) {
  const box = RADAR.els && RADAR.els.box;
  if (!box) return;
  box.querySelectorAll('.fail').forEach(x => x.remove());
  const fail = el('div', 'fail');
  fail.append(el('p', null, text));
  box.append(fail);
}

/**
 * Entering and leaving the tab.
 *
 * The widget is loaded here and nowhere else, so a reader who never opens this
 * tab never touches meteoblue. Leaving is left alone: an iframe already loaded
 * costs nothing to keep, and tearing it down would throw away the day and the
 * map the reader had chosen on it every time they looked at the standings.
 */
function radarShow(on) {
  RADAR.shown = on;
  if (!on || !RADAR.els || !RADAR.at) return;
  const want = mbSrc(RADAR.at);
  if (RADAR.loaded === want) return;
  const box = RADAR.els.box;
  box.querySelectorAll('.fail').forEach(x => x.remove());
  // The frame that was there is taken out of the page, not pointed somewhere
  // new. The widget draws itself on a WebGL canvas and a browser keeps only so
  // many of those alive at once; re-pointing one frame left the old map holding
  // its context, and a few circuits off the picker was enough to exhaust them -
  // after which the map came back blank, or drawn but no longer centred on the
  // circuit. Removing the element discards the document, and the context with
  // it, so only ever one is live.
  const old = box.querySelector('iframe');
  if (old) old.remove();
  RADAR.loaded = want;
  box.append(mbFrame(want));
  radarTv();
}

/**
 * The screen under the map, or the line that says why there isn't one.
 *
 * A meteoTV belongs to a meteoblue account and has its location fixed in it, so
 * a circuit has one only if somebody made it. Where there is none the box is
 * taken off the page entirely rather than left blank or, worse, pointed at a
 * screen for somewhere else - a playing animation of the wrong county is the
 * most convincing way this page could lie.
 */
function radarTv() {
  if (!RADAR.els || !RADAR.ev) return;
  const { tv, tvnote } = RADAR.els;
  const code = (RADAR.at || {}).meteotv;
  if (!code) {
    tv.innerHTML = '';
    tv.hidden = true;
    RADAR.loadedTv = '';
    tvnote.textContent = `There is no radar screen for ${RADAR.ev.name}. The map above `
      + 'covers it; the radar does not, because each one is made a circuit at a time '
      + 'and this circuit has not had one made.';
    tvnote.hidden = false;
    return;
  }
  tvnote.hidden = true;
  tv.hidden = false;
  const want = mbTvSrc(code);
  if (RADAR.loadedTv === want) return;
  // Taken out and rebuilt, for the same reason the map is: it is another map
  // drawing itself on a canvas, and a browser keeps only so many of those.
  const old = tv.querySelector('iframe');
  if (old) old.remove();
  RADAR.loadedTv = want;
  tv.append(mbFrame(want, 'meteoblue meteoTV'));
}

/* ------------------------------------------------------------- run-in */

/**
 * A season total, from what each round scored and what a drop would take back.
 *
 * The one place this arithmetic lives. Three questions on this page are the
 * same sum asked differently — where the table stands, where it would stand
 * with the race that is running counted, and where it could end up — and they
 * have to agree, because they are shown side by side and a driver's total is
 * not a matter of which tab you are on.
 *
 * `scores` is what each round was worth, fastest lap point included. `droppable`
 * is what a drop discards from that same round, which is not always the same
 * number: the Caterham regulations drop the whole round score, CGRC reg 1.6.2a
 * only the finishing points, so a fastest lap survives the dropping of the round
 * it was set in. `penalty` is already negative, and is applied after the drop
 * rather than inside a round, so a drop can never cancel one. `bonus` is points
 * awarded outside the races at all - Academy's marshalling and briefings.
 *
 * scripts/build_all.py computes the published table the same way; the two agree
 * to the point for every driver in all seven series.
 */
function seasonTotal(scores, droppable, dropScores, penalty, bonus) {
  const total = scores.reduce((a, b) => a + b, 0);
  const sorted = [...droppable].sort((a, b) => a - b);
  const dropped = sorted.length > dropScores ? sorted.slice(0, dropScores) : [];
  const lost = dropped.reduce((a, b) => a + b, 0);
  return { gross: total + penalty + bonus,
           net: total - lost + penalty + bonus,
           dropped };
}

/** One driver's rounds, as the two lists `seasonTotal` wants. */
function roundScores(t, rounds, dropComponent) {
  const part = dropComponent === 'race_points' ? 'race_points' : 'score';
  const scores = [], droppable = [];
  rounds.forEach(r => {
    const s = t.rounds[String(r)];
    scores.push(s ? s.score : 0);
    droppable.push(s ? s[part] : 0);
  });
  return { scores, droppable };
}

/**
 * Projected final total, with `v` scored in each round still to run.
 *
 * The rounds it counts are the rounds the table it is shown beside counts. A
 * race that is running is counted into the standings as it stands, because that
 * is the best account there is of where the championship is, so it is counted
 * here as it stands too - which is what keeps Min from coming out below the Net
 * in the same row. What a round still to run does to a total is only ever to
 * raise it: the rounds nobody has driven yet are zeros the drop scores can take
 * instead of a real result, so scoring nothing more cannot cost a driver points.
 *
 * `open` asks it the other way round, and is the title run-in's question rather
 * than the default: a round that has started and not finished, handed back to
 * the rounds still to come. Contention is about what can still happen, and what
 * can still happen in a race nobody has finished is everything - the win, the
 * fastest lap point with it, or nothing at all - so that tab projects a running
 * race as unrun. The standings and the live view's own table, which print a Net
 * with it counted, do not.
 *
 * A penalty comes off the championship total rather than off a round, so it is
 * added after the drop rather than being discarded with a bad round. What the
 * drop itself discards differs by championship: the whole round score for the
 * Caterham series, and for the Graduates the finishing points only, which
 * leaves a fastest lap point standing even when its round is dropped.
 */
function project(t, v, d, open) {
  // Against the series being shown, unless another is handed in: the live view
  // projects a table with the running race counted whether or not the page as a
  // whole is counting it.
  d = d || D;
  // A guest entry is invisible for the allocation of points (reg 1.3.5) and
  // scores nothing whatever it does in the races left, so both ends of its
  // projection are the total it already has.
  if (!t.registered) v = 0;
  const run = d === D && open == null ? runSet : new Set(d.roundsRun);
  if (open != null) run.delete(open);
  const partOnly = d.dropComponent === 'race_points';
  const scores = [], droppable = [];
  for (let r = 1; r <= d.roundsTotal; r++) {
    if (run.has(r)) {
      const x = t.rounds[String(r)];
      scores.push(x ? x.score : 0);
      droppable.push(x ? (partOnly ? x.race_points : x.score) : 0);
    } else {
      // A round still to run is worth `v`, of which the fastest lap point is
      // not part of what a CGRC drop would discard.
      scores.push(v);
      droppable.push(partOnly ? Math.min(v, d.scale) : v);
    }
  }
  return seasonTotal(scores, droppable, d.dropScores,
                     t.penalty_points, t.bonus || 0).net;
}
function quantile(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  const p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return s[lo] + (s[hi] - s[lo]) * (p - lo);
}

/** The projection for one set of drivers; `split` ranks them by class. */
function runInModel(rows, split) {
  // This tab is the one that puts a running race back among the races still to
  // win: who can still take the title turns on what is still to be won, not on
  // where the cars happen to be on the lap they are on. Everywhere a Net is
  // printed beside these numbers the round is counted as it stands instead.
  const open = D.live ? D.live.round : null;
  return rows.map(t => {
    // form band is about race pace, so it uses the round score rather than the
    // penalty-adjusted total - and not a race still running, whose score is
    // where a car has got to rather than how it went.
    const entered = D.roundsRun.filter(r => r !== open).map(r => t.rounds[String(r)])
      .filter(Boolean).map(x => x.score);
    // A driver whose only round is the one being run has no finished race to
    // read a form band off; nothing scored is the honest stand-in for it.
    const band = entered.length ? entered : [0];
    const q1 = Math.round(quantile(band, .25));
    const q3 = Math.round(quantile(band, .75));
    const med = Math.round(quantile(band, .5));
    return {
      t, entered, rank: (split ? t.cls_pos : t.pos) || t.pos,
      floor: project(t, 0, D, open),            // scores nothing in the races left
      ceiling: project(t, maxRace(), D, open),  // wins them all, with fastest lap
      bodyLo: project(t, q1, D, open), bodyHi: project(t, q3, D, open),
      mid: project(t, med, D, open),
      formLo: q1, formHi: q3, formMid: med,
    };
  });
}

function runin() {
  const p = $('#p-runin'); p.innerHTML = '';
  if (REMAINING === 0 && !D.live) {
    p.innerHTML = '<p class="lede">Every round has been run — the championship table is final.</p>';
    return;
  }
  // A class title is decided among the drivers in that class, so each class is
  // projected on its own - same points, a different floor to beat.
  const groups = classGroups();
  const classed = groups ? groups.filter(g => g.split) : [];
  const split = classed.length >= 2;
  const sets = split ? classed.map(g => ({ name: g.name, m: runInModel(g.rows, true) }))
                     : [{ name: null, m: runInModel(scoring, false) }];
  sets.forEach(s => {
    s.bestFloor = Math.max(...s.m.map(d => d.floor));
    s.m.forEach(d => { d.live = d.ceiling >= s.bestFloor; });
    s.live = s.m.filter(d => d.live);
  });
  const titleWord = split ? 'class title' : 'title';

  // A race that is running is still to win, and the wicks are drawn as though it
  // were: nobody has scored it yet.
  const open = D.live ? 1 : 0;
  const togo = REMAINING + open;
  p.append(Object.assign(el('p', 'lede'), { textContent:
    `${togo} race${togo === 1 ? '' : 's'} left, worth a theoretical maximum of `
    + `${togo * maxRace()} points`
    + (open ? ` — the one running now among them, since it can still be won and can `
        + `still be scored nothing in` : '')
    + `. Each candle is one driver's possible finishing total once the ${D.dropScores} drop `
    + `score${D.dropScores === 1 ? '' : 's'} are applied — so points banked now are not all `
    + `bankable at the end.`
    + (split
       ? ` ${D.short} awards a title in ${classed.map(g => g.name).join(' and ')}, so each class `
         + `is projected against its own drivers: the points are unchanged, but a driver only `
         + `has to beat the class they are in.`
       : '') }));

  // Where the races left are, by meeting rather than by round - and a meeting
  // counts as having races left if it has a round nobody has run, which is not
  // the same as having no results yet: the Snetterton sheet carries three races
  // and the last of them is still to come.
  const where = D.events.filter(e => e.rounds.some(r => !runSet.has(r))).map(e => e.name);
  const cells = [
    ['Races remaining', togo,
     (open ? 'the one running now' + (where.length ? ', then ' : '') : '')
     + where.join(' and ')],
    ['Maximum still available', togo * maxRace(),
     `${togo} × ${D.scale} for a win + 1 fastest lap`],
  ];
  sets.forEach(s => {
    const pre = s.name ? esc(s.name) + ' ' : '';
    cells.push([`${pre}Title floor to beat`, s.bestFloor,
                `${esc(s.m.find(d => d.floor === s.bestFloor).t.driver)} cannot finish below this`]);
    cells.push([`${pre}Still in contention`, s.live.length,
                `of ${s.m.length} registered driver${s.m.length === 1 ? '' : 's'}`]);
  });
  const kpi = el('div', 'kpis');
  kpi.innerHTML = cells.map(([k, v, n]) => `<div class="kpi"><div class="k">${k}</div>`
    + `<div class="v">${v}</div><div class="n">${n}</div></div>`).join('');
  p.append(kpi);

  p.append(Object.assign(el('h2'), { textContent: 'Best and worst case, after drop scores' }));
  p.append(Object.assign(el('p', 'sub'), { textContent:
    'Wick: score nothing more (bottom) to win every remaining race with the fastest lap (top). '
    + 'Body: the driver’s own form band — their 25th to 75th percentile race score so far, '
    + 'repeated across the races left. The bar across the body is that form band’s midpoint.'
    + (split ? ' The dashed line is the floor to beat inside that class.' : '') }));

  sets.forEach(s => {
    if (s.name) {
      const h = el('h3', 'disp', s.name);
      h.style.cssText = 'margin:26px 0 8px;font-size:18px;text-transform:uppercase;'
        + 'letter-spacing:.04em';
      p.append(h);
    }
    p.append(candles(s.m, s.bestFloor, titleWord));

    const det = el('details', 'tv');
    det.innerHTML = `<summary>Show ${s.name ? esc(s.name) + '’s' : 'the same'} figures as a `
      + `table</summary>`;
    const sc = el('div', 'scroller'), tb = el('table');
    tb.innerHTML = '<thead><tr><th>Pos</th><th>Driver</th><th class="num">Now (net)</th>'
      + '<th class="num">Worst finish</th><th class="num">Form band</th><th class="num">Best finish</th>'
      + '<th class="num">Form score</th><th>Title</th></tr></thead><tbody>'
      + s.m.map(d => `<tr class="${d.live ? '' : 'outrow'}"><td class="num mono">${d.rank}</td>`
        + `<td>${esc(d.t.driver)}</td><td class="num mono">${d.t.net}</td>`
        + `<td class="num mono">${d.floor}</td>`
        + `<td class="num mono">${d.bodyLo}–${d.bodyHi}</td>`
        + `<td class="num mono">${d.ceiling}</td>`
        + `<td class="num mono">${d.formLo}–${d.formHi}</td>`
        + `<td>${d.live ? 'In contention' : 'Out'}</td></tr>`).join('')
      + '</tbody>';
    sc.append(tb); det.append(sc); p.append(det);
  });

  const lg = el('div', 'legend');
  lg.innerHTML =
    `<span><i class="sw" style="background:var(--flag-ink);border-color:var(--flag-ink)"></i>`
    + `${split ? 'Class' : 'Championship'} leader</span>`
    + `<span><i class="sw" style="background:var(--s1);border-color:var(--s1)"></i>Can still win `
    + `the ${titleWord}</span>`
    + '<span><i class="sw" style="background:var(--ink-3);border-color:var(--ink-3)"></i>Mathematically out</span>'
    + `<span><i class="sw" style="background:transparent;border-style:dashed"></i>Dashed line: `
    + `${split ? 'that class’s' : 'title'} floor to beat</span>`;
  p.append(lg);

  p.append(Object.assign(el('p', 'sub'), { textContent:
    'Only one driver can take the win and the fastest lap in any race, so the top of every wick '
    + 'is a ceiling no two drivers can reach together. Championship penalties already applied are '
    + 'baked in; future ones obviously are not.'
    + (split
       ? ' A class ceiling assumes the win as well, which a driver from the other class may take '
         + 'instead — the points are shared out across the whole grid.'
       : '') }));
}

function candles(m, bestFloor, titleWord = 'title') {
  const box = el('div', 'candlebox');
  const SLOT = 46, PAD = { t: 14, r: 16, b: 58, l: 46 };
  const W = PAD.l + m.length * SLOT + PAD.r, H = 400;
  const vals = m.flatMap(d => [d.floor, d.ceiling]);
  const lo = Math.floor(Math.min(...vals, 0) / 50) * 50;
  const hi = Math.ceil(Math.max(...vals) / 50) * 50;
  const y = v => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo));
  const cx = i => PAD.l + SLOT * i + SLOT / 2;

  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
    aria-label="Best and worst possible final points total for each driver">`;
  for (let g = lo; g <= hi; g += 50)
    s += `<line class="gl" x1="${PAD.l - 6}" y1="${y(g)}" x2="${W - PAD.r}" y2="${y(g)}"/>`
       + `<text class="ax" x="${PAD.l - 12}" y="${y(g) + 3.5}" text-anchor="end">${g}</text>`;
  s += `<line class="refline" x1="${PAD.l - 6}" y1="${y(bestFloor)}" x2="${W - PAD.r}" y2="${y(bestFloor)}"/>`
     + `<text class="reftext" x="${W - PAD.r}" y="${y(bestFloor) - 5}" text-anchor="end">`
     + `title floor ${bestFloor}</text>`;

  m.forEach((d, i) => {
    const c = !d.live ? 'var(--ink-3)' : (d.rank === 1 ? 'var(--flag-ink)' : 'var(--s1)');
    const x = cx(i), bw = 20;
    const top = Math.min(y(d.bodyHi), y(d.bodyLo)), h = Math.max(2, Math.abs(y(d.bodyHi) - y(d.bodyLo)));
    const tipText = `<b>${esc(d.t.driver)}</b> — P${d.rank}, ${d.t.net} pts net<br>`
      + `Best possible finish <b>${d.ceiling}</b><br>`
      + `Form band <b>${d.bodyLo}–${d.bodyHi}</b> (scoring ${d.formLo}–${d.formHi} a race)<br>`
      + `Worst possible finish <b>${d.floor}</b><br>`
      + (d.live ? `Can still win the ${titleWord}` : `Mathematically out of the ${titleWord} race`);
    s += `<g data-tip="${tipText.replace(/"/g, '&quot;')}">`
       + `<rect x="${x - SLOT / 2}" y="${PAD.t}" width="${SLOT}" height="${H - PAD.t - PAD.b}" fill="transparent"/>`
       + `<line x1="${x}" y1="${y(d.ceiling)}" x2="${x}" y2="${y(d.floor)}" stroke="${c}" stroke-width="1.5"/>`
       + `<line x1="${x - 5}" y1="${y(d.ceiling)}" x2="${x + 5}" y2="${y(d.ceiling)}" stroke="${c}" stroke-width="1.5"/>`
       + `<line x1="${x - 5}" y1="${y(d.floor)}" x2="${x + 5}" y2="${y(d.floor)}" stroke="${c}" stroke-width="1.5"/>`
       + `<rect x="${x - bw / 2}" y="${top}" width="${bw}" height="${h}" rx="1.5"
            fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="1.5"/>`
       + `<line x1="${x - bw / 2}" y1="${y(d.mid)}" x2="${x + bw / 2}" y2="${y(d.mid)}"
            stroke="${c}" stroke-width="2.5"/>`
       + `<text class="xlab${d.live ? '' : ' out'}" x="${x}" y="${H - PAD.b + 14}"
            text-anchor="end" transform="rotate(-45 ${x} ${H - PAD.b + 14})">`
       + `${esc(d.t.driver.split(' ').slice(-1)[0])}</text>`
       + `</g>`;
  });
  s += '</svg>';
  box.innerHTML = s;
  return box;
}

/* --------------------------------------------------------------- rules */
function rules() {
  const p = $('#p-rules'); p.innerHTML = '';
  const doc = el('a', 'doclink');
  doc.href = regsUrl(); doc.target = '_blank'; doc.rel = 'noopener';
  doc.append(el('b', null, `${SEASON.year} ${D.name} Regulations`),
             el('span', null, 'PDF · ' + new URL(regsUrl()).hostname.replace(/^www\./, '')));
  p.append(doc);
  const wrapEl = el('div', 'cols2');

  const left = el('div', 'prose');
  left.innerHTML = grads() ? graduatesRules() : `
    <h3>Race points</h3>
    <p>Points go to every full-season registered driver classified as a finisher
    <span class="reg">1.6.1</span>. Which scale applies depends on how many drivers registered for
    the season — with ${D.registrations} registered, the ${D.scale}-point scale is in force.</p>
    <h3>Fastest lap</h3>
    <p>One extra point for the fastest lap of each race, shared if the time is equalled
    <span class="reg">1.6.2</span>. A lap on which the driver exceeded track limits cannot count, and
    a non-scoring car's fastest lap passes to the quickest points-scoring car.</p>
    <h3>Guest entries</h3>
    <p>Only drivers registered for the full year score. Anyone entering on a round-by-round basis is
    <em>invisible for the allocation of points</em> <span class="reg">1.3.5</span>, so a driver who
    finishes behind a guest still takes the higher score.</p>
    <h3>Drop scores</h3>
    <p>The three lowest round scores are discarded from the season total
    <span class="reg">1.6.4</span>. A round score is race points plus the fastest lap point, and a
    round a driver did not contest counts as a zero and is a candidate for dropping.
    A championship penalty is <em>not</em> part of a round score - reg 4.2.3 takes it off the
    championship total - so it cannot be discarded by dropping the round it came from.
    With ${D.roundsTotal - D.roundsRun.length} races still to run the <em>Net</em> column moves
    as the season does - a round still to come is a zero the drops can take instead of a real
    result - but it is what the title is decided on, so it is what the table is ranked on.</p>
    <h3>Penalties</h3>
    <p>A penalty that carries Motorsport UK licence points also costs three times that number of
    championship points <span class="reg">4.2.3</span>, deducted from the championship total rather
    than from that round, so a drop score cannot wipe it out. Overseas rounds use notional licence
    points one step below the equivalent domestic penalty. Every deduction taken this season, and
    where each was published, is listed on the
    <a href="#${SEASON.year}/${D.key}/standings">standings</a> page.</p>
    <h3>Shortened races</h3>
    <p>If the Clerk of the Course cuts a race short: 60% or more of the intended time scores full
    points, 25–60% scores half, below 25% scores nothing <span class="reg">1.6.4</span>.</p>`;

  const right = el('div');
  right.innerHTML = '<h3 class="disp" style="margin:0 0 8px;font-size:18px;text-transform:uppercase;'
    + 'letter-spacing:.04em">Points scale in force</h3>';
  const sc = el('div', 'scroller'), tb = el('table');
  const rows = [], extra = [];
  if (grads()) {
    for (let n = 1; n <= 26; n++) rows.push([n + ordinal(n), n === 1 ? 30 : 30 - n]);
    extra.push(['Every other classified finisher', 3],
               ['Started, did not finish', 2],
               ['Qualified, did not start', 1],
               ['Fastest lap in class', '+1']);
  } else {
    for (let n = 1; n <= 23; n++) rows.push([n + ordinal(n), n === 1 ? 25 : 25 - n]);
    extra.push(['24th and every other classified finisher', 1],
               ['Fastest lap of the race', '+1']);
  }
  tb.innerHTML = `<thead><tr><th>Finishing place (${grads() ? 'Championship entries in the class'
      : 'points-scoring cars'})</th>`
    + '<th class="num">Points</th></tr></thead><tbody>'
    + rows.concat(extra).map(([n, v]) =>
        `<tr><td>${n}</td><td class="num mono">${v}</td></tr>`).join('')
    + '</tbody>';
  sc.append(tb); right.append(sc);

  wrapEl.append(left, right); p.append(wrapEl);
  linkRegs(p);
}
/* The CGRC regulations are their own document with their own numbering, and
   they score a race differently enough that restating the Caterham articles
   with different numbers would be wrong rather than merely confusing. */
function graduatesRules() {
  const left = D.roundsTotal - D.roundsRun.length;
  return `
    <h3>Race points</h3>
    <p>Points are awarded within the class, to the Championship entries in it
    <span class="reg">1.6.1a</span>: 30 for the win, 28 for second, then 27, 26 and down by one a
    place to 4 for 26th, with 3 points for every other classified finisher. A competitor who
    starts and does not finish scores 2, and one who qualifies and then does not start scores 1 —
    so a bad weekend is still worth something, and the table has an entry for a race a driver
    never took the start of.</p>
    <h3>Fastest lap</h3>
    <p>One point for the fastest lap of the race in the class <span class="reg">1.6.1a</span>,
    where more than one car started it.</p>
    <h3>The Trophy, and guests</h3>
    <p>Each race is shared with the CGRC Trophy — a separate competition over three rounds a
    driver nominates — and with guests. Neither scores in this table, and both are invisible when
    points are allocated <span class="reg">1.6.5</span>, so a Championship entry behind them still
    takes the higher score. The timing sheets print which competition each car is entered in.</p>
    <h3>Drop scores</h3>
    <p>The ${D.dropScores} lowest scores are dropped <span class="reg">1.6.2a</span>. What is
    dropped is the finishing points alone: a fastest lap point, and a penalty, stay on the total
    even when the round they came from is dropped. A round not contested counts as a zero and is a
    candidate for dropping.${left > 0 ? ` With ${left} race${left === 1 ? '' : 's'} still to run
    the <em>Net</em> column still moves, but it is what the title is decided on and what the
    table is ranked on.` : ''}</p>
    <h3>Penalties</h3>
    <p>A penalty that carries Motorsport UK licence points also costs three times that number of
    championship points <span class="reg">4.2.4</span>, applied after the drop scores. The club
    publishes those points in the class table itself, which is where the deductions listed on the
    <a href="#${SEASON.year}/${D.key}/standings">standings</a> page come from. A round run outside
    the UK assumes notional licence points instead <span class="reg">4.2.5</span>.</p>
    <h3>Shortened races</h3>
    <p>A race cut short still counts as a full points-scoring round
    <span class="reg">1.6.4</span>.</p>`;
}


/* ---------------------------------------------------------------- live */
/**
 * The meeting as it happens, from whoever is timing it.
 *
 * The rest of this page is built from classifications that were published
 * hours or days after the race. This is the same meeting before any of that
 * exists: the timekeepers' own screen, read straight from the feed their live
 * site uses, and scored under this championship's regulations as it arrives -
 * so the standings and the title run-in can be watched moving while the race
 * is still running.
 *
 * Two feeds, and they are nothing alike. TSL time the British rounds and push
 * changes down a socket; ITS Chrono time Dijon and answer three POSTs with the
 * whole screen. Everything below either says which of them it is for, or is
 * written to hold for a third that does not exist yet.
 *
 * Two ways in, and both are needed. The socket carries every change as it
 * happens but has no snapshot in it: register for a meeting and nothing at all
 * arrives until the next car crosses a line, so a page opened cold has an empty
 * table for as long as a lap takes. The snapshot that fixes that is a plain GET
 * which the browser is not allowed to make - the endpoint sends no CORS headers
 * - so scripts/fetch_live.py makes it instead, and what it saw is baked into
 * this page as the seed. The socket then corrects it, car by car.
 *
 * Nothing here touches the championship tables. A round is scored from the
 * classification sheet like every other round, days later; this is what the
 * timekeepers' screen implies about the table, labelled as such throughout.
 */
/* The feed, or something standing in for it. `?live=http://localhost:8733`
   points the page at tests/mock_timing/server.py, which serves the same
   endpoints - the snapshot and the socket - against a scripted race, which is
   how the socket half of this is exercised on a day nobody is racing (`?demo`
   below exercises everything above the socket). `?its=` does the same for the
   ITS feed. Nothing but a hand-typed address can set either, and without one
   this is TSL and ITS. */
const LIVE_OVERRIDE = new URLSearchParams(location.search).get('live');
const LIVE_BASE = LIVE_OVERRIDE
  ? LIVE_OVERRIDE.replace(/\/$/, '') : 'https://livetiming.tsl-timing.com';
const LIVE_WS = LIVE_OVERRIDE
  ? LIVE_BASE.replace(/^http/, 'ws') + '/results/live'
  : 'wss://livetiming.tsl-timing.com/results/live';
const LIVE_SITE = LIVE_BASE + '/';
/* `?demo` races a made-up field through the same handlers the socket feeds, so
   the live view can be worked on and looked at on a day nobody is racing - see
   the simulation at the bottom of this section. It runs in real time, because a
   race is twenty minutes and a lap is a minute and a half and that is what this
   tab has to look like; `?demo=25` fast-forwards it for when a whole race is
   wanted in a hurry. Every screen it feeds says loudly that it is not timing. */
let LIVE_DEMO = new URLSearchParams(location.search).get('demo');
let LIVE_FAKE = LIVE_DEMO !== null;
const RS = '\u001e';   // SignalR ends every frame with a record separator
const SESSION_TYPE = { 1: 'Practice', 2: 'Qualifying', 3: 'Race', 4: 'RX', 5: 'Sprint' };
/* What a car is doing, as the feed numbers it. */
const CAR_RUNNING = 0, CAR_FINISHED = 1, CAR_DSQ = 2, CAR_GONE = 3, CAR_PIT = 4;
const LAST_SCORING = { 25: 23, 30: 28, 35: 33 };
const GRADS_LAST = 26, GRADS_FINISHER = 3;

const LIVE = {
  id: null,          // TSL event number being watched
  meetingName: null,
  session: null,     // the session the feed last described
  cars: new Map(),   // competitor id -> row
  ws: null, ping: null, retry: 0, wanted: false, pending: null,
  status: 'idle',    // idle | seed | connecting | live | retrying | error
  seededAt: null, clockAt: 0, clockSecs: null, sig: null,
  applied: true,     // count the running race in the standings and the run-in
  paused: false,     // the stand-in's race is being held (see LIVE_FAKE)
  clockRate: 1,      // race seconds per second of watching; only a demo moves it
  rc: [],            // race control messages, newest first
  sectorBest: {},    // the quickest anybody has gone in each sector
};

/** Is anything feeding this - the socket, or the simulation standing in for it? */
const liveOn = () => LIVE.status === 'live' || LIVE.status === 'demo';

/* -------------------------------------------------------- the feed --- */

/** One competitor, flattened the way scripts/tsl_live.py flattens it. */
function liveCar(c) {
  const r = c.result || {};
  return {
    id: c.id, no: c.no, name: c.name,
    cls: c.primaryClass || '', sub: c.subClass || '',
    vehicle: c.vehicle || '', nationality: c.nationality || '',
    pos: r.position, pic: r.pic, posChange: r.posChange, laps: r.laps,
    raceTime: r.raceTime || '', gap: r.gap || '', diff: r.diff || '',
    best: r.fastLapTime || '', last: c.lastLapTime || '',
    pitStops: r.pitStops, state: c.state,
  };
}

/** One session, likewise. */
function liveSessionOf(s) {
  return {
    id: s.id, name: s.name, series: s.series, type: s.type,
    typeName: SESSION_TYPE[s.type] || 'Session', flag: s.sessionFlag,
    clock: s.sessionClock || {}, plannedStart: s.plannedStart,
    duration: s.duration || {}, track: (s.track || {}).displayName,
    sectors: (((s.track || {}).sectors) || []).filter(x => !x.isSpeedTrap)
      .map(x => ({ key: x.key, name: x.name,
                   best: (x.sessionBest || {}).time,
                   bestBy: (x.sessionBest || {}).id })),
    classes: (s.classes || []).map(c => c.name),
    fastestLap: s.fastestLap || null,
  };
}

function liveSetSession(s) {
  const next = liveSessionOf(s);
  // A new session is a new grid: nothing from the last one survives it.
  if (LIVE.session && LIVE.session.id !== next.id) {
    LIVE.cars.clear(); LIVE.rc = []; LIVE.sectorBest = {};
  }
  LIVE.session = next;
  // A session that arrives with its field in it is a snapshot, and a page that
  // has none is entitled to it: without one, nothing is known about a car until
  // it first crosses the line, so the splits it puts in on the way round have
  // nowhere to land and the first lap of a race shows nothing.
  const field = s.classification || s.competitors;
  if (field && field.length && !LIVE.cars.size) {
    field.forEach(c => LIVE.cars.set(c.id, c.result ? liveCar(c) : c));
  }
  liveSectorBests(next);
  LIVE.fromSeed = false;      // the feed has now said so itself
  LIVE.seedIds = null;
  LIVE.stale = false;
  liveSetClock(next.clock);
}

/**
 * Has the meeting moved on from the session the seed describes?
 *
 * The feed only names a session when something about it changes - a flag, the
 * start, the finish - so a page that connects in the middle of one is told
 * nothing about which session it is watching, and the seed is the only thing
 * that knows. That makes a stale seed dangerous rather than merely old: it
 * would have qualifying's name and last race's grid over the running order of
 * whatever is actually out there.
 *
 * Cars give it away. Every entry in a session has an id of its own, so updates
 * for cars the seed has never heard of mean the seed is describing a session
 * that has ended. Three of them is past coincidence, and the honest thing then
 * is to admit to knowing nothing until the feed says otherwise.
 */
function liveSeedStale(id) {
  if (!LIVE.fromSeed || !LIVE.seedIds || LIVE.seedIds.has(id)) return;
  LIVE.unknown = (LIVE.unknown || new Set()).add(id);
  if (LIVE.unknown.size < 3) return;
  LIVE.session = null; LIVE.cars.clear(); LIVE.rc = [];
  LIVE.fromSeed = false; LIVE.seedIds = null; LIVE.unknown = null;
  LIVE.stale = true;
}

/**
 * A car's split, and what it is worth against the rest of the session.
 *
 * Two things make a split readable, and a timing screen colours both: a car's
 * own best, and the best anybody has managed. The session says what the latter
 * is when it says anything at all - and between times this keeps its own count,
 * because a page that joined ten minutes ago has seen only what it has seen and
 * should not colour a split purple on that basis alone.
 */
function liveSector(car, msg) {
  if (!car || !msg || !msg.sectorKey) return;
  const key = msg.sectorKey;
  const secs = secsOf(msg.time);
  if (secs == null) return;
  car.sectors = car.sectors || {};
  // The split just set lives in `sectors`, which starts empty every lap; a
  // car's best in that sector lives in `bests`, which does not - otherwise
  // every split is a personal best, because the only one to compare it against
  // was thrown away at the line.
  car.bests = car.bests || {};
  const better = car.bests[key] == null || secs < car.bests[key];
  if (better) car.bests[key] = secs;
  const best = LIVE.sectorBest[key];
  const session = !best || secs < best.secs;
  if (session) LIVE.sectorBest[key] = { secs, by: car.id };
  // The feed says whether it was a personal best; where it does not, this does.
  car.sectors[key] = { time: msg.time, secs,
                       pb: typeof msg.timePB === 'boolean' ? msg.timePB : better,
                       best: session, speed: msg.speed };
  if (msg.speed) car.speed = msg.speed;
  // Somebody else's purple is theirs no longer.
  if (session) LIVE.cars.forEach(c => {
    if (c !== car && c.sectors && c.sectors[key]) c.sectors[key].best = false;
  });
}

/** The session's own sector bests, where it has told us any. */
function liveSectorBests(sess) {
  (sess.sectors || []).forEach(x => {
    const secs = secsOf(x.best);
    if (secs == null) return;
    const held = LIVE.sectorBest[x.key];
    if (!held || secs <= held.secs) LIVE.sectorBest[x.key] = { secs, by: x.bestBy };
  });
}

/** "00:12:34.5" -> seconds, so the clock can run on between updates. */
function liveSetClock(clock) {
  const m = /^(\d+):(\d\d):(\d\d)/.exec((clock || {}).timeToGo || '');
  LIVE.clockSecs = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  LIVE.clockAt = Date.now();
  LIVE.clockRunning = !!(clock && clock.running);
  // A clock that is running again settles the question of whether the stand-in
  // is still holding the race, however it was let go.
  if (LIVE.clockRunning) LIVE.paused = false;
}

function liveClockNow() {
  if (LIVE.clockSecs == null) return null;
  // Only a connected clock is worth running down. A seeded one was read minutes
  // ago and counting it on would be inventing a session's progress.
  //
  // `clockRate` is how much race time a second of watching is worth: one, for
  // a race that is actually happening. A demonstration run at twenty-five times
  // life still shows the twenty minutes the race is, and simply gets through
  // them twenty-five times as fast.
  const running = LIVE.clockRunning && liveOn();
  const gone = running ? (Date.now() - LIVE.clockAt) / 1000 * (LIVE.clockRate || 1) : 0;
  const left = Math.max(0, LIVE.clockSecs - gone);
  return hms(left);
}

function liveMessage(text) {
  if (!text) return;
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (m.type !== 1) return;          // 6 is a ping, 3 a completion, 7 a close
  const a = (m.arguments || [])[0];
  if (!a) return;
  const held = LIVE.cars.get(a.id);
  switch (String(m.target || '').toLowerCase()) {
    case 'sessionupdated': liveSetSession(a); break;
    case 'resultupdated': {
      liveSeedStale(a.id);
      // A result carries everything about a car except the splits it has put in
      // since it last crossed the line, so those are carried over rather than
      // thrown away by an update that had nothing to do with them.
      const row = liveCar(a);
      if (held) {
        row.sectors = held.sectors; row.bests = held.bests; row.speed = held.speed;
      }
      LIVE.cars.set(a.id, row);
      break;
    }
    case 'competitorpitin': if (held) held.state = CAR_PIT; break;
    case 'competitorpitout': if (held) held.state = CAR_RUNNING; break;
    case 'competitorintermediate':
      // A car's split, part way round. It is the only thing the feed says about
      // a car between one crossing of the line and the next, a minute and a half
      // apart, and it is what makes a timing screen look alive.
      liveSector(held, a);
      break;
    case 'competitorlapcompleted':
      // Past the line and into a new lap: the splits of the last one are done
      // with, and the columns fill again as the car goes round.
      if (held) { held.laps = a.lap; held.last = a.time || held.last; held.sectors = {}; }
      break;
    case 'vehicledeleted': LIVE.cars.delete(a.id); break;
    case 'rcmsgreceived':
      // Each message owns a line on race control's board and replaces itself.
      LIVE.rc = LIVE.rc.filter(x => x.lineNo !== a.lineNo);
      if (a.text) LIVE.rc.unshift({ lineNo: a.lineNo, text: a.text, urgent: a.urgent });
      LIVE.rc = LIVE.rc.slice(0, 6);
      break;
    default: return;                  // sector bests, tracking, weather
  }
  liveSoon();
}

/** Redraw at most once a second, however fast the feed is talking. */
function liveSoon() {
  if (LIVE.pending) return;
  LIVE.pending = setTimeout(() => { LIVE.pending = null; liveTick(); }, 900);
}

function liveStart() {
  if (LIVE_DEMO !== null) {
    const base = SEASON.series.find(x => x.key === (D || {}).key);
    if (base) { SIM.speed = Number(LIVE_DEMO) > 0 ? Number(LIVE_DEMO) : 1; simStart(base); }
    // The whole page, not just this tab: the grid is a running order, and the
    // standings are entitled to it from the moment the lights go out rather
    // than from the first car past the line a lap and a half later.
    liveRefresh();
    return;
  }
  if (LIVE.src === 'its') { itsStart(); return; }
  if (!LIVE.id || LIVE.ws) return;
  LIVE.wanted = true;
  LIVE.declined = false;
  LIVE.status = 'connecting';
  let ws;
  try { ws = new WebSocket(LIVE_WS); } catch (e) { LIVE.status = 'error'; liveDraw(); return; }
  LIVE.ws = ws;
  ws.onopen = () => {
    // SignalR's own handshake, then the one thing this feed is asked for. The
    // negotiate step the library would normally do first is a cross-origin POST
    // and is refused; a socket is not, and skipping it is allowed.
    ws.send('{"protocol":"json","version":1}' + RS);
    ws.send(JSON.stringify({ type: 1, target: 'registerForEvent',
                             arguments: [String(LIVE.id)] }) + RS);
    LIVE.status = 'live'; LIVE.retry = 0;
    // The server hangs up on a client that has said nothing for half a minute.
    LIVE.ping = setInterval(() => { try { ws.send('{"type":6}' + RS); } catch (e) {} }, 15000);
    liveDraw();
  };
  ws.onmessage = ev => String(ev.data).split(RS).forEach(liveMessage);
  ws.onclose = () => {
    clearInterval(LIVE.ping); LIVE.ping = null; LIVE.ws = null;
    if (!LIVE.wanted) { LIVE.status = 'idle'; liveDraw(); return; }
    LIVE.status = 'retrying';
    const wait = Math.min(30000, 2000 * Math.pow(2, LIVE.retry++));
    setTimeout(() => { if (LIVE.wanted) liveStart(); }, wait);
    liveDraw();
  };
  ws.onerror = () => {};              // onclose follows, and does the work
  liveDraw();
}

function liveStop() {
  LIVE.wanted = false;
  LIVE.declined = true;      // asked to stop; do not reconnect on its own
  if (LIVE_DEMO !== null) { simStop(); liveDraw(); return; }
  if (LIVE.src === 'its') { itsStop(); return; }
  clearInterval(LIVE.ping); LIVE.ping = null;
  if (LIVE.ws) { try { LIVE.ws.close(); } catch (e) {} }
  LIVE.ws = null;
  LIVE.status = LIVE.session ? 'seed' : 'idle';
  liveDraw();
}

/* ---------------------------------------------------- the ITS feed --- */
/**
 * The same job for the rounds ITS Chrono time, which is Dijon.
 *
 * Nothing about it is like TSL's. There is no socket and no deltas: three POSTs
 * answer with the whole timing screen as it stands, so a tick here replaces the
 * session and the field outright rather than correcting a car at a time. That
 * also means there is nothing to seed - the first tick is a full snapshot - and
 * no CORS problem to work around, because this API answers any origin.
 *
 * What it does need is the session number, and that is the awkward part. ITS
 * number sessions across the whole meeting rather than within a grid, so the
 * Graduates' two Friday practices were 4 and 20 with seven other grids' running
 * in between, and nothing lists them. The seed says which ones were ours when
 * the page was built; anything created since - qualifying, then the races - is
 * found by looking at the handful of numbers above the highest we have seen,
 * which is only done between sessions, when there is something to look for.
 */
const ITS_OVERRIDE = new URLSearchParams(location.search).get('its');
const ITS_API = ITS_OVERRIDE
  ? ITS_OVERRIDE.replace(/\/$/, '') + '/v1' : 'https://api-live.its-live.net/v1';
const ITS_SITE = 'https://www.its-live.net';
const ITS_EVERY = 5000;     // while something is running
const ITS_IDLE = 20000;     // between sessions, looking for the next
const ITS_AHEAD = 16;       // session numbers to look ahead over
const ITS_STOPPED = { STOP: 1, '': 1 };

const itsSsid = (cfg, id) => ({ cs_id: cfg.cs, season: String(cfg.season),
                                event_id: cfg.event_id, session_id: id });

function itsPost(path, body) {
  return fetch(ITS_API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => (r.ok ? r.json() : null)).catch(() => null);
}

/** Milliseconds as a lap time, the way every sheet on this page prints one. */
function itsLap(ms) {
  if (!ms || ms <= 0) return '';
  const t = Math.round(ms);
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000), ms3 = t % 1000;
  const pad = (n, w) => String(n).padStart(w, '0');
  return (h ? `${h}:${pad(m, 2)}` : `${m}`) + `:${pad(s, 2)}.${pad(ms3, 3)}`;
}

/** One car, in the shape liveCar hands one back. */
function itsCar(c, pic) {
  const names = (c.driver_names || []).filter(Boolean);
  const nats = (c.driver_nats || []).filter(Boolean);
  const lead = c.pos === 1;
  return {
    id: c.competitor_id, no: String(c.number || ''),
    name: names.length ? itsName(names[0]) : '',
    cls: c.cat || '', sub: c.class || '',
    vehicle: c.vehicle || c.brand || '', nationality: nats[0] || '',
    pos: c.pos, pic, posChange: null, laps: c.total_lap,
    raceTime: '', gap: lead ? '' : (c.gap_first || '').replace('-', ''),
    diff: lead ? '' : (c.gap_prev || '').replace('-', ''),
    best: itsLap(c.best_time), last: itsLap(c.lap_time),
    pitStops: c.total_pit_stop, state: c.status, bestOn: c.best_time_lap,
  };
}

/**
 * A driver's name the way round this page holds it.
 *
 * ITS print the surname first and shout it - "MCDOUGALL Callum", "VAN ES
 * William" - which is scripts/parse_its.py's problem too, and solved the same
 * way: the leading run of shouted words is the surname and the rest is the
 * given name. A name with no shouting in it is left alone.
 */
function itsName(raw) {
  const words = String(raw || '').replace(/\s+/g, ' ').trim().split(' ');
  if (!words[0]) return '';
  const shout = w => /^(?:Mc|Mac|O')?[A-ZÀ-Þ][A-ZÀ-Þ'-]*$/.test(w);
  let n = 0;
  while (n < words.length - 1 && shout(words[n])) n++;
  if (!n) return words.join(' ');
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const surname = words.slice(0, n).map(w => cap(w)
    .replace(/^(Mc|Mac)(.)/, (m, a, b) => a + b.toUpperCase())
    .replace(/^O'(.)/, (m, a) => "O'" + a.toUpperCase())
    .replace(/-(.)/g, (m, a) => '-' + a.toUpperCase()));
  return words.slice(n).map(cap).concat(surname).join(' ');
}

/** The classification as it stands, ordered, with a place in class counted. */
function itsRanking(cfg, id) {
  return itsPost('/Session/GetRankingWithBestOfAll',
                 { ssid: itsSsid(cfg, id), startPos: 1,
                   endPos: 99999999, startId: 0 })
    .then(d => {
      const rows = ((d || {}).ranking || []).slice()
        .sort((a, b) => (a.pos || 1e9) - (b.pos || 1e9));
      const seen = {};
      return rows.map(r => {
        const cat = r.cat || '';
        let pic = null;
        if (cat && r.pos) pic = (seen[cat] = (seen[cat] || 0) + 1);
        return itsCar(r, pic);
      });
    });
}

/** What a session number is, and what it is doing. */
const itsInfo = (cfg, id) =>
  itsPost('/Session/GetLastRaceInfo', itsSsid(cfg, id))
    .then(d => (d && d.folder_name ? d : null));

/** Is this one ours, and is it running? */
const itsOurs = (info, grid) =>
  !!info && String(info.folder_name || '').toLowerCase()
    .indexOf(String(grid || '').toLowerCase()) >= 0;
const itsRunning = info => !!info && !ITS_STOPPED[info.race_flag || ''];

/**
 * Look for a session of ours that has appeared since the last time we looked.
 *
 * Only ever called between sessions. A number that answers with anything at all
 * moves the mark up, whoever it belongs to, so the window keeps pace with the
 * meeting rather than with our own grid - the Graduates run twice a day and
 * everyone else runs in between.
 */
function itsLookAhead(cfg, grid) {
  const its = LIVE.its;
  const seen = its.top;
  const from = seen + 1, to = seen + ITS_AHEAD;
  const want = [];
  for (let n = from; n <= to; n++) want.push(n);
  return Promise.all(want.map(n => itsInfo(cfg, n).then(info => ({ n, info }))))
    .then(found => {
      found.forEach(({ n, info }) => {
        if (!info) return;
        its.top = Math.max(its.top, n);
        if (itsOurs(info, grid) && its.ids.indexOf(n) < 0) its.ids.push(n);
      });
      its.ids.sort((a, b) => a - b);
      // A window with something in it means the meeting is further on than
      // the mark: keep going until one comes back empty, so a seed that is a
      // day old is caught up on the first look rather than a window a tick.
      if (its.top > seen) return itsLookAhead(cfg, grid);
    });
}

/** Put a session and its field on the page. */
function itsApply(info, id, cars, cfg) {
  const ended = !itsRunning(info);
  const next = {
    id, name: info.race_name, series: info.folder_name,
    type: info.race_type,
    typeName: info.race_type ? 'Race' : 'Practice',
    flag: info.race_flag, clock: {}, plannedStart: null,
    duration: { elapsed: info.elapsed_time, remaining: info.remaining_time,
                laps: info.elapsed_lap },
    track: null, sectors: [],
    classes: cars.map(c => c.cls).filter((v, i, a) => v && a.indexOf(v) === i),
    fastestLap: null, ended,
  };
  const quickest = cars.filter(c => c.best)
    .sort((a, b) => (a.best < b.best ? -1 : 1))[0];
  next.fastestLap = quickest ? quickest.best : null;
  if (LIVE.session && LIVE.session.id !== next.id) {
    LIVE.cars.clear(); LIVE.rc = []; LIVE.sectorBest = {};
  }
  LIVE.session = next;
  LIVE.cars.clear();
  cars.forEach(c => LIVE.cars.set(c.id, c));
  LIVE.fromSeed = false; LIVE.seedIds = null; LIVE.stale = false;
  LIVE.ended = ended;
}

/** One pass of the feed. */
function itsTick() {
  const its = LIVE.its;
  if (!its || !LIVE.wanted) return;
  const { cfg, grid } = its;
  const live = its.current;

  const after = wait => {
    if (!LIVE.wanted) return;
    clearTimeout(its.timer);
    its.timer = setTimeout(itsTick, wait);
  };

  // While one of ours is running there is nothing to look for: poll it.
  const poll = id => Promise.all([itsInfo(cfg, id), itsRanking(cfg, id)])
    .then(([info, cars]) => {
      if (!info) return false;
      itsApply(info, id, cars, cfg);
      LIVE.status = 'live'; LIVE.retry = 0;
      liveRefresh();
      return itsRunning(info);
    });

  if (live) {
    poll(live).then(still => {
      if (!still) its.current = null;
      after(still ? ITS_EVERY : ITS_IDLE);
    }).catch(() => after(ITS_IDLE));
    return;
  }

  // Between sessions: is one of the ones we know about running, and has a new
  // one appeared since we last looked?
  itsLookAhead(cfg, grid)
    .then(() => Promise.all(its.ids.map(n => itsInfo(cfg, n)
      .then(info => ({ n, info })))))
    .then(found => {
      const on = found.filter(f => itsRunning(f.info))[0];
      if (on) { its.current = on.n; return poll(on.n).then(() => after(ITS_EVERY)); }
      // Nothing out there. Show the last one that ran, so the order from the
      // session that has just finished stays up rather than the tab emptying.
      const last = found.filter(f => f.info)
        .sort((a, b) => (b.info.epoch || 0) - (a.info.epoch || 0))[0];
      if (last) return poll(last.n).then(() => after(ITS_IDLE));
      LIVE.status = 'live';
      liveDraw();
      return after(ITS_IDLE);
    })
    .catch(() => after(ITS_IDLE));
}

function itsStart() {
  const cfg = LIVE.itsCfg;
  if (!cfg) return;
  // The seed says which session numbers were ours when the page was built, and
  // the first look-ahead finds anything created since.
  const seeded = LIVE.itsSeed || [];
  const ids = seeded.slice();
  LIVE.its = {
    cfg, grid: cfg.grid, ids, current: null, timer: null,
    top: ids.length ? Math.max.apply(null, ids) : 0,
  };
  LIVE.wanted = true;
  LIVE.declined = false;
  LIVE.status = 'connecting';
  liveDraw();
  itsTick();
}

function itsStop() {
  if (LIVE.its) { clearTimeout(LIVE.its.timer); LIVE.its.timer = null; }
  LIVE.status = LIVE.session ? 'seed' : 'idle';
  liveDraw();
}

/** Where a person can watch the same session. */
const itsWatchUrl = (cfg, id) =>
  `${ITS_SITE}/live/${cfg.cs}/${cfg.season}/${cfg.event_id}`
  + (id ? `/${id}` : '');

/* ------------------------------------------------ who is timing it --- */
/**
 * Two companies time the rounds this tab can watch, and the page says which.
 *
 * Everything written here used to name TSL outright, because they were the
 * only feed there was. Dijon is ITS Chrono's, so the name is asked for rather
 * than spelled out - and where the meeting has no feed at all, there is no
 * timekeeper to name and the wording says so instead.
 */
const TIMEKEEPER = { tsl: 'TSL', its: 'ITS Chrono' };
const timerName = () => TIMEKEEPER[LIVE.src] || 'the timekeepers';
const timerSite = () => (LIVE.src === 'its')
  ? (LIVE.itsCfg ? itsWatchUrl(LIVE.itsCfg, (LIVE.session || {}).id) : '')
  : (LIVE.id ? LIVE_SITE + LIVE.id : '');

/* ------------------------------------------------------ this meeting --- */

const isoDay = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  .toISOString().slice(0, 10);

/** What the seed - data/live.json, baked in at build time - holds for a series. */
function liveSeed(key) {
  const live = SEASON.live;
  if (!live) return null;
  return (live.events || []).find(e => (e.series || []).some(s => s.key === key)) || null;
}

/**
 * The meeting to watch for one series: the one running today, or the one the
 * seed was taken at.
 *
 * Two of the timing companies here have a feed and two do not. TSL time every
 * UK round and ITS Chrono time Dijon; Spa is Alkamel's and the Knockhill
 * festival is SMART's, and neither of those publishes anything to watch. A TSL
 * meeting also needs the number TSL address it by, where an ITS one carries
 * everything it needs in the calendar itself.
 */
const liveFeed = e => (e && e.kind === 'tsl' && e.tslEvent) ? 'tsl'
  : (e && e.kind === 'its' && e.its && e.its.event_id) ? 'its' : null;

function liveMeeting(base) {
  const today = isoDay(new Date());
  const seed = liveSeed(base.key);
  // One identity per meeting, whoever times it, so that switching series knows
  // when it has landed somewhere new. TSL's is the number they address it by;
  // ITS have no single number for a meeting, so it is the three values that
  // name one.
  const of = (e, extra) => {
    const src = liveFeed(e);
    const its = e && e.its;
    return Object.assign({
      event: e, src, its, seed,
      id: src === 'tsl' ? e.tslEvent : null,
      key: src === 'its' ? `its:${its.cs}/${its.season}/${its.event_id}`
         : src === 'tsl' ? String(e.tslEvent) : null,
    }, extra);
  };

  const running = base.events.find(e => liveFeed(e)
    && e.first <= today && today <= e.last);
  if (running) return of(running, { running: true });
  if (seed) {
    const at = (seed.series.find(s => s.key === base.key) || {}).event;
    const e = base.events.find(x => x.key === at) || null;
    const m = of(e, { running: false });
    if (m.src === 'tsl' && !m.id) { m.id = seed.id; m.key = String(seed.id); }
    return m;
  }
  const next = base.events.find(e => liveFeed(e) && e.last >= today);
  return of(next || null, { running: false });
}

/* The timetable prints a clock time and a day; the countdown needs an instant.
   A meeting abroad prints its own local time - Dijon's noon is not Britain's -
   so the day and time are read in the circuit's zone rather than the reader's,
   whichever side of the Channel each of them is on. */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/* Timetables shout their days - SATURDAY, in the heading above the block.
   The page says Saturday. */
const dayWord = d => String(d || '').toLowerCase()
  .replace(/\b[a-z]/g, c => c.toUpperCase());

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday',
                  'friday', 'saturday'];
const ZONES = { CET: 'Europe/Paris', CEST: 'Europe/Paris' };

function zoneOffset(t, zone) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = {};
  f.formatToParts(new Date(t)).forEach(x => { p[x.type] = x.value; });
  return Date.UTC(+p.year, p.month - 1, +p.day, p.hour % 24, +p.minute, +p.second) - t;
}

/** A scheduled session's start, as an instant, or null if it cannot be placed. */
function schedAt(sch, ev) {
  if (!sch || !sch.start) return null;
  const hm = /^(\d{1,2}):(\d{2})/.exec(sch.start);
  if (!hm) return null;
  const zone = ZONES[ev.tz] || 'Europe/London';
  const txt = String(sch.day || '');
  let y, mo, d;
  const mi = MONTHS.findIndex(n => new RegExp(n, 'i').test(txt));
  const dm = /\b(\d{1,2})\b/.exec(txt);
  if (mi >= 0 && dm) {
    y = +String(ev.first || '').slice(0, 4) || SEASON.year;
    mo = mi; d = +dm[1];
  } else if (ev.first) {
    // A BARC timetable heads each day's block with the day and nothing else -
    // "START FINISH DURATION SATURDAY ..." - so which Saturday is settled by
    // the meeting whose timetable it is.
    const wd = WEEKDAYS.findIndex(n => new RegExp(n, 'i').test(txt));
    const [y0, m0, d0] = ev.first.split('-').map(Number);
    const last = ev.last || ev.first;
    const span = Math.round((Date.parse(last) - Date.parse(ev.first)) / 864e5) || 0;
    let pick = 0;
    if (wd >= 0) {
      pick = -1;
      for (let i = 0; i <= span && pick < 0; i++) {
        if (new Date(Date.UTC(y0, m0 - 1, d0 + i)).getUTCDay() === wd) pick = i;
      }
      if (pick < 0) return null;
    } else if (span > 0) {
      return null;             // more than one day, and nothing says which
    }
    y = y0; mo = m0 - 1; d = d0 + pick;
  } else {
    return null;
  }
  let t = Date.UTC(y, mo, d, +hm[1], +hm[2]);
  // The offset depends on the instant, and the instant on the offset: two
  // passes settle it either side of a clock change.
  for (let i = 0; i < 2; i++) t = Date.UTC(y, mo, d, +hm[1], +hm[2]) - zoneOffset(t, zone);
  return t;
}

/**
 * The next session this series is scheduled for at this meeting.
 *
 * The timetable is the only thing that knows a session is coming: the feed says
 * nothing until it starts. Races are matched to rounds in the order the
 * timetable prints them, the same pairing the calendar makes.
 */
function liveNext(base, meet) {
  const ev = meet && meet.event;
  if (!ev) return null;
  const t = (base.timings || {})[ev.key];
  if (!t || !t.scheduled || !t.scheduled.length) return null;
  const rows = [];
  const qual = t.scheduled.find(x => x.kind === 'qualifying');
  if (qual) rows.push({ name: 'Qualifying', s: qual });
  t.scheduled.filter(x => x.kind === 'race').forEach((x, i) => rows.push({
    name: ev.rounds[i] != null ? `Round ${ev.rounds[i]}` : (x.activity || 'Race'), s: x }));
  const now = Date.now();
  const next = rows.map(r => ({ name: r.name, s: r.s, at: schedAt(r.s, ev) }))
    .filter(r => r.at != null && r.at > now)
    .sort((a, b) => a.at - b.at)[0];
  return next ? { ...next, secs: Math.round((next.at - now) / 1000) } : null;
}

/* Five minutes out is close enough to open the feed. It costs one socket, and
   a page that waits for the session to start has already missed the start. */
const LIVE_CONNECT = 5 * 60;

/**
 * A countdown, in as few figures as it takes to read it.
 *
 * Hours and minutes while the session is still hours away - a seconds figure
 * turning over for two hours is movement that means nothing, and it is the kind
 * of number a glance has to stop and read. Inside the five minutes where the
 * page connects by itself it becomes a race clock, minutes and seconds, because
 * by then the seconds are the whole point.
 */
function liveCountText(secs) {
  if (secs == null) return '—';
  if (secs <= 0) return 'any moment';
  if (secs >= 86400) {
    return `${Math.floor(secs / 86400)}d ${Math.round(secs % 86400 / 3600)}h`;
  }
  const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), ss = secs % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (secs > LIVE_CONNECT) return `${m}m`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/**
 * What a live session is to a series - "own", "shared" or nothing at all.
 *
 * This is scripts/series.py's section_kind, in the browser: a session names its
 * championship the way a TSL event page names its section, so the expressions
 * that pick a series' sheets out of a meeting pick its sessions out of a day.
 */
function sessionKind(tsl, text) {
  if (!tsl || !tsl.match || !text) return null;
  const has = p => new RegExp(p, 'i').test(text);
  if (!has(tsl.match)) return null;
  if (tsl.exclude && has(tsl.exclude)) return null;
  if (!tsl.require || has(tsl.require)) return 'own';
  if (tsl.classHeading && !has(tsl.classHeading)) return 'shared';
  return null;
}

/* ------------------------------------------------------- the scoring --- */

/* A time off a timing screen, in seconds. They come in every length: a race is
   "21:00.642", a lap "1:36.921", a sector plain "34.296". Anything that is not
   a time - a gap, a blank - is nothing rather than zero. */
const secsOf = t => {
  const parts = String(t == null ? '' : t).trim().split(':');
  if (!/^[\d:.]+$/.test(String(t == null ? '' : t).trim())) return null;
  if (parts.some(p => p === '' || isNaN(Number(p)))) return null;
  return parts.reduce((a, p) => a * 60 + Number(p), 0);
};

/** Reg 1.6.1: points for a place among the scoring classified finishers. */
function pointsForPlace(base, place) {
  const top = base.scale;
  if (place === 1) return top;
  if (base.scaleType === 'graduates')
    return place <= GRADS_LAST ? top - place : GRADS_FINISHER;
  return place <= LAST_SCORING[top] ? top - place : 1;
}

/** CGRC reg 1.6.1a pays for starting, and for qualifying; nobody else does. */
function pointsForStatus(base, status) {
  if (base.scaleType !== 'graduates') return 0;
  if (status === 'DSQ' || status === 'DQ') return 0;
  return status === 'DNS' ? 1 : 2;
}

/** That meeting's qualifying, best first - the grid, as the build read it. */
function liveQualifying(base, eventKey) {
  if (!base._quals) {
    base._quals = {};
    (base.qualifying || []).forEach(q => { base._quals[q.event] = q.entries || []; });
  }
  return (base._quals[eventKey] || []).filter(e => e.pos)
    .slice().sort((a, b) => a.pos - b.pos);
}

/**
 * This series' cars, in the order the feed has them - and the rest of the grid
 * behind them.
 *
 * A race starts with everyone on it and the feed saying nothing: the first
 * thing it sends about a car is that car crossing the line, a lap and a half
 * later. So the field is laid out from qualifying to begin with, which the
 * build has already read off TSL's own sheet and put in this page, and each
 * car's grid slot stands until the timekeepers have something better to say
 * about it. A placeholder is dropped the moment its car reports.
 */
function liveRows(base, kind, event) {
  let rows = [...LIVE.cars.values()];
  let mixed = false;
  const marker = base.tsl && base.tsl.classMarker;
  if (kind === 'shared' && marker) {
    const mine = rows.filter(r => (r.cls + ' ' + r.sub).indexOf(marker) >= 0);
    // A shared grid whose sheet does name the class; where it does not, the
    // feed cannot say which of the two a car is in, and saying so is better
    // than quietly scoring the other class's cars as this one's.
    if (mine.length) rows = mine; else mixed = true;
  }
  let fromGrid = 0, missing = 0;
  if (event) {
    const reported = new Set(rows.map(r => String(r.no)));
    // A grid slot stands until the car reports - but not for ever. Once the
    // leader has two laps in, a car that has never come past is not running:
    // it did not take the start, or it stopped on the first lap. Either way the
    // grid no longer says anything useful about it, and it is not to be scored
    // as though it were still circulating in the slot it qualified in.
    const led = Math.max(0, ...rows.map(r => r.laps || 0));
    const gone = led >= 2;
    liveQualifying(base, event.key).forEach(q => {
      if (reported.has(String(q.no))) return;
      if (gone) missing++; else fromGrid++;
      rows.push({ id: 'grid-' + q.no, no: String(q.no), missing: gone,
        name: String(q.driver || '').split(' ').pop().toUpperCase(),
        cls: q.cls || '', sub: '', pos: null, gridPos: q.pos, laps: 0,
        gap: '', diff: '', best: '', last: '', raceTime: '', pitStops: null,
        posChange: 0, state: CAR_RUNNING, onGrid: true });
    });
  }
  rows.sort((a, b) => (a.pos == null) - (b.pos == null) || (a.pos - b.pos)
    || (a.gridPos || 99) - (b.gridPos || 99)
    || String(a.no).localeCompare(String(b.no)));
  return { rows, mixed, fromGrid, missing };
}

/** The round this session is, or null if it is not one of ours to score. */
function liveRoundOf(base, event, session) {
  if (!event || session.type !== 3) return null;      // only a race is a round
  const rounds = event.rounds || [];
  const m = /(?:race|round|r)\s*(\d+)/i.exec(session.name || '');
  let rd = null;
  if (m) {
    const n = Number(m[1]);
    rd = rounds.includes(n) ? n : rounds[n - 1];      // "Race 2" of this meeting
  }
  if (!rd) rd = rounds.find(r => !base.roundsRun.includes(r));
  // A round whose classification is already published is scored from that, and
  // the feed replaying it must not overwrite it.
  return rd && !base.roundsRun.includes(rd) ? rd : null;
}

/** Car number, then surname, to a driver in the championship table. */
function liveWho(base, row) {
  if (!base._byNo) {
    base._byNo = new Map();
    base._bySurname = new Map();
    base.table.forEach(t => {
      base._byNo.set(String(t.no), t);
      const sn = t.driver.split(' ').pop().toUpperCase();
      base._bySurname.set(sn, base._bySurname.has(sn) ? null : t);   // ties are no use
    });
  }
  const byNo = base._byNo.get(String(row.no));
  if (byNo) return byNo;
  const name = String(row.name || '').toUpperCase().replace(/\s*\(.*\)\s*$/, '');
  const surname = name.split(' ').pop();
  // A surname has to be unique on both sides of the match, not just in the
  // table. Two McDougalls entered Dijon and the championship knows one of
  // them, so a surname alone would have scored one of their races to the
  // other - and a guest who happens to share a name with somebody registered
  // would quietly collect their points. Where it is ambiguous out on the
  // circuit, the honest answer is that this car is nobody the table knows.
  let sharing = 0;
  LIVE.cars.forEach(c => {
    if (String(c.name || '').toUpperCase().split(' ').pop() === surname) sharing++;
  });
  if (sharing > 1) return null;
  return base._bySurname.get(surname) || null;
}

/**
 * The round score this session implies, driver by driver.
 *
 * The same rules the tables are built with: guests are invisible for the
 * allocation of points (reg 1.3.5), so the cars behind them move up a place;
 * the fastest lap point (reg 1.6.2) goes to the quickest points-scoring car
 * where a non-scoring one set it; and only the Graduates pay anything to a car
 * that did not finish (their reg 1.6.1a).
 */
function liveScore(base, rows, session, round) {
  const out = new Map();
  const mine = rows.map(r => ({ r, t: liveWho(base, r) }));
  const scores = mine.filter(x => x.t && x.t.registered);

  // Fastest lap: the session's own, if that car scores here, else the quickest
  // scoring car's - which is what reg 1.6.2 does with a guest's.
  let flDriver = null;
  const flId = (session.fastestLap || {}).id;
  const owner = flId && scores.find(x => x.r.id === flId);
  if (owner) flDriver = owner.t.driver;
  else {
    let best = null;
    scores.forEach(x => {
      const s = secsOf(x.r.best);
      if (s != null && (best == null || s < best)) { best = s; flDriver = x.t.driver; }
    });
  }

  let place = 0;
  mine.forEach(({ r, t }) => {
    if (!t) return;                                   // not in this championship
    const gone = r.state === CAR_GONE, dsq = r.state === CAR_DSQ;
    // A car yet to cross the line is still in the race, in the slot it started
    // from; only the feed can say otherwise, and it has not yet.
    const classified = !gone && !dsq && !r.missing && (r.pos != null || r.onGrid);
    const scoring = t.registered;
    let pts = 0, status = 'classified', pos = r.pos || r.gridPos || null, sp = null;
    if (classified) {
      if (scoring) { place += 1; sp = place; pts = pointsForPlace(base, place); }
    } else {
      status = dsq ? 'DSQ' : r.missing ? 'DNS' : 'DNF';
      pos = null;
      pts = scoring ? pointsForStatus(base, status) : 0;
    }
    const fl = (scoring && t.driver === flDriver) ? 1 : 0;
    out.set(t.driver, {
      pos, scoring_place: sp, race_points: pts, fl, score: pts + fl,
      penalty: 0, total: pts + fl, status, best: r.best || null, grid: null,
      live: true, no: r.no,
    });
  });
  return { scored: out, flDriver, round };
}

/* ------------------------------------- the standings, with it counted --- */

/** Gross, net, drops and the counting stats, exactly as build_all.py has them. */
function liveTotals(t, d) {
  const { scores, droppable } = roundScores(t, d.roundsRun, d.dropComponent);
  const sum = seasonTotal(scores, droppable, d.dropScores,
                          t.penalty_points, t.bonus || 0);
  const seen = Object.values(t.rounds);
  t.dropped = sum.dropped;
  t.gross = sum.gross;
  t.net = sum.net;
  t.wins = seen.filter(s => s.scoring_place === 1).length;
  t.podiums = seen.filter(s => s.scoring_place && s.scoring_place <= 3).length;
  t.fastest_laps = seen.reduce((a, s) => a + (s.fl || 0), 0);
}

/** Registered drivers ranked on net, ties broken as the tables break them. */
function liveRank(d) {
  // The same ranking build_all.py applies, on the same total: a race counted in
  // as it stands has to move the table the way the finished race will, and the
  // championship is decided on the total after the drop scores.
  const reg = d.table.filter(t => t.registered);
  reg.sort((a, b) => b.net - a.net || b.wins - a.wins || b.podiums - a.podiums
    || (a.driver < b.driver ? -1 : a.driver > b.driver ? 1 : 0));
  let pos = 0, last = null;
  reg.forEach((t, i) => {
    if (t.net !== last) { pos = i + 1; last = t.net; }
    t.pos = pos;
  });
  (d.classes || []).forEach(cls => {
    let p = 0, l = null;
    reg.filter(t => t.cls === cls).forEach((t, i) => {
      if (t.net !== l) { p = i + 1; l = t.net; }
      t.cls_pos = p;
    });
  });
  d.table = reg.concat(d.table.filter(t => !t.registered)
    .sort((a, b) => a.driver.localeCompare(b.driver)));
}

/** The series as it would stand if this session ended as it is now. */
function withLive(base, v) {
  const key = String(v.round);
  const d = Object.assign({}, base);
  d.roundsRun = base.roundsRun.concat([v.round]).sort((a, b) => a - b);
  d.table = base.table.map(t => {
    const row = Object.assign({}, t, { rounds: Object.assign({}, t.rounds) });
    const s = v.scored.get(t.driver);
    if (s) row.rounds[key] = s; else delete row.rounds[key];
    liveTotals(row, d);
    return row;
  });
  liveRank(d);
  d.live = v;
  return d;
}

/** Everything the live view knows about the series being shown. */
function liveView(base) {
  const meet = liveMeeting(base);
  const forKey = base.key;
  const session = LIVE.session;
  const kind = session ? sessionKind(base.tsl, [session.series, session.name]
    .filter(Boolean).join(' ')) : null;
  if (!session || !kind) return { forKey, meet, session, kind: null, rows: [] };
  const round = liveRoundOf(base, meet.event, session);
  // The grid only stands in for a race, and only for one that has not been
  // classified: qualifying says nothing about a session that is not this
  // meeting's, and nothing at all about practice.
  const { rows, mixed, fromGrid, missing } =
    liveRows(base, kind, round ? meet.event : null);
  // `mixed` is a shared grid the feed will not split: both classes are on the
  // sheet and nothing on it says which car is in which. The order is still
  // worth showing, and is shown with that said - but it cannot be scored, and
  // allocating places down a list that has the other class's cars in it would
  // hand this championship's points to the wrong people.
  const scored = round && !mixed ? liveScore(base, rows, session, round) : null;
  return { forKey, meet, session, kind, rows, mixed, fromGrid, missing, round, scored };
}

/** The series object the rest of the page should be drawing right now. */
function liveDress(base) {
  const v = liveView(base);
  LIVE.view = v;
  return (LIVE.applied && v.scored && v.scored.scored.size) ? withLive(base, v.scored) : base;
}

/* ------------------------------------------------- the stand-in race --- */
/**
 * A race, made up, run through the same handlers the socket feeds.
 *
 * The live view can only be exercised while a meeting is running, which is
 * seven days of the year. `?demo` races a field against the clock in this page
 * and hands each crossing of the line to `liveMessage` as the JSON the feed
 * would have sent - so the matching, the scoring, the standings and the run-in
 * are all exercised by the same code paths, and only the socket underneath
 * them is missing.
 *
 * It is faithful where being faithful is the point. It names the session only
 * when something about it changes - a flag, the start, the finish - because
 * that is the awkward thing about the real feed and the reason a seeded
 * snapshot exists at all. And it reports one crossing at a time, so a table
 * fills in over a lap exactly as it will on the day.
 *
 * The grid is this series' last real race: its entry list, its class column,
 * the pace each driver actually showed and the length that race ran to. So the
 * numbers are the numbers of people in the championship table, and the
 * standings move the way they would move.
 */
const SIM = {
  speed: 1, key: null, cars: [], plan: [], next: 0, t0: 0, timer: null,
  duration: 0, flagAt: 0, laps: 0, flag: null, session: null, held: null,
  bests: {},         // quickest anybody has gone in each sector
  sc: [0, 0], retire: null, retireOn: 0, pit: null, pitOn: 0,
};

const shuffled = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0])
  .map(p => p[1]);
/* A race time always carries its minutes, even inside the first one. */
const raceTime = s => (s < 60 ? '0:' : '') + lapText(s);
const hhmmss = s => {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:`
    + (r < 10 ? '0' : '') + r.toFixed(3);
};
/* Two draws from a uniform make something close enough to a normal for a lap
   time that is only ever going to be looked at. */
const wobble = (mid, spread) => mid + (Math.random() + Math.random() - 1) * spread;

/** The grid, and how long the race runs, from this series' last real one. */
function simGrid(base) {
  const race = base.races[base.races.length - 1];
  const rows = ((race && race.entries) || []).filter(e => e.no);
  if (!rows.length) return null;
  const paces = rows.map(e => secsOf(e.best));
  const quickest = Math.min(...paces.filter(Boolean).concat([1e9]));
  const cars = shuffled(rows.map((e, i) => ({
    id: 'sim-' + e.no, no: String(e.no), driver: e.driver,
    name: String(e.driver).split(' ').pop().toUpperCase(),
    cls: e.cls || '', pace: paces[i] || quickest + 2,
    laps: 0, total: 0, best: null, last: null, state: CAR_RUNNING, stops: 0,
  })));
  cars.forEach((c, i) => { c.grid = c.pos = c.pic = c.was = i + 1; });
  // These are twenty-minute races, and a winner's time is never twenty minutes
  // - it is 20:02, or 21:00 - because the clock expiring does not end the race,
  // the leader finishing the lap he is on does. Rounding down recovers the
  // length that was scheduled, per series: the same sum reads 25 minutes off a
  // Graduates race, which is what theirs are.
  const won = secsOf((rows.find(e => e.pos === 1) || {}).time);
  return { cars, quickest: quickest === 1e9 ? 100 : quickest,
           duration: won ? Math.max(300, Math.floor(won / 300) * 300) : 20 * 60 };
}

/**
 * Every crossing of the line, worked out before any of it is shown.
 *
 * The flag goes out when the leader next crosses after the clock expires, and
 * every other car is shown it as it comes round - so how many laps the race
 * runs to is an outcome, and a safety car costs the field a lap the way it does
 * at a meeting.
 */
function simPlan(cars, duration, quickest) {
  const most = Math.floor(duration / quickest) + 3;
  const out = [];
  cars.forEach(c => {
    c.total = 0;
    for (let lap = 1; lap <= most; lap++) {
      let t = wobble(c.pace + 0.25, 0.6);
      if (lap === 1) t += 1.5 + 0.35 * (c.grid - 1);      // the start, and the queue
      if (lap >= SIM.sc[0] && lap <= SIM.sc[1]) t = quickest * 1.75 + 0.2 * c.grid;
      if (c === SIM.pit && lap === SIM.pitOn) t += 28;
      t = Math.max(t, quickest * 0.97);
      const from = c.total;
      c.total += t;
      // Two intermediates and the line, which is how these circuits are cut up:
      // a car says something about itself twice inside a lap rather than once
      // at the end of it.
      const s1 = t * (0.28 + Math.random() * 0.02);
      const s2 = t * (0.45 + Math.random() * 0.02);
      out.push({ when: from + s1, car: c, lap, sector: 'S1Time', took: s1 });
      out.push({ when: from + s1 + s2, car: c, lap, sector: 'S2Time', took: s2 });
      out.push({ when: c.total, car: c, lap, took: t });
      if (c === SIM.retire && lap === SIM.retireOn) break;
    }
  });
  out.sort((a, b) => a.when - b.when);

  // A race is decided at the line, so only crossings settle the flag and the
  // lap count; the splits are things that happen on the way to one.
  const won = out.find(x => !x.sector && x.when > duration)
    || out.filter(x => !x.sector).pop();
  const flagAt = won ? won.when : 0;
  const laps = won ? won.lap : 0;
  const kept = [], done = new Set();
  out.forEach(x => {
    if (done.has(x.car)) return;
    kept.push(x);
    if (!x.sector && (x.when >= flagAt
                      || (x.car === SIM.retire && x.lap === SIM.retireOn)))
      done.add(x.car);
  });
  return { plan: kept, flagAt, laps };
}

/** One car, in the shape the feed sends it. */
function simRow(c, leader, ahead) {
  const gapTo = other => !other || other === c ? ''
    : c.laps < other.laps ? `+${other.laps - c.laps} lap${other.laps - c.laps > 1 ? 's' : ''}`
    : `+${(c.total - other.total).toFixed(3)}`;
  return {
    id: c.id, no: c.no, name: c.name, team: null, primaryClass: c.cls, subClass: '',
    vehicle: 'Caterham', sponsor: '', nationality: 'GBR', manufacturer: 'Caterham',
    result: { position: c.pos, pic: c.pic, posChange: c.pos - c.was, laps: c.laps,
              raceTime: c.laps ? raceTime(c.total) : '',
              fastLapTime: c.best ? lapText(c.best) : '',
              gap: c.laps ? gapTo(leader) : '', diff: c.laps ? gapTo(ahead) : '',
              pitStops: c.stops },
    lastLapTime: c.last ? lapText(c.last) : '', state: c.state,
  };
}

const simOrder = () => SIM.cars.slice().sort((a, b) =>
  (a.state === CAR_GONE) - (b.state === CAR_GONE) || b.laps - a.laps
  || a.total - b.total || a.grid - b.grid);

/** Renumber everyone, and hand back whoever moved. */
function simRenumber() {
  const moved = [], inClass = {};
  simOrder().forEach((c, i) => {
    const n = inClass[c.cls] = (inClass[c.cls] || 0) + 1;
    if (c.pos !== i + 1) moved.push(c);
    c.pos = i + 1; c.pic = n;
  });
  return moved;
}

/** Hand something to the page exactly as the socket would have delivered it. */
const simSend = (target, arg) =>
  liveMessage(JSON.stringify({ type: 1, target, arguments: [arg] }));

/* What the clock says, `gone` seconds of watching into the race. The race's own
   time, because that is what a race clock shows - twenty minutes, counting down
   as fast as the race is being run. */
const simLeft = gone => hhmmss(Math.max(0, SIM.duration - gone * SIM.speed));

function simAnnounce() {
  SIM.session.track.sectors.forEach(x => {
    const b = SIM.bests[x.key];
    x.sessionBest = b ? { id: b.by, time: lapText(b.secs) } : undefined;
  });
  SIM.session.fastestLap = (() => {
    const run = SIM.cars.filter(c => c.best);
    if (!run.length) return null;
    const c = run.reduce((a, b) => (a.best <= b.best ? a : b));
    return { id: c.id, lapTime: lapText(c.best) };
  })();
  simSend('SessionUpdated', SIM.session);
}

/**
 * The qualifying sheet this grid came out of.
 *
 * A real meeting qualifies in the morning, the build reads that sheet, and the
 * live view lays the grid out from it before a wheel turns. A demonstration has
 * no such morning, so it writes the sheet its own shuffled grid implies - the
 * same shape, in the same place - and everything downstream of it, the grid at
 * lights out and the qualifying positions in the standings, then works on the
 * demonstration exactly as it will on the day. It is taken out again by `Done`,
 * because a made-up qualifying session has no business outliving the race it
 * was made up for.
 */
function simQualifying(base, event) {
  base.qualifying = (base.qualifying || []).filter(q => !q.demo);
  base.qualifying.push({
    event: event.key, eventName: event.name, date: event.first, demo: true,
    entries: SIM.cars.slice().sort((a, b) => a.grid - b.grid).map((c, i) => ({
      pos: c.grid, no: c.no, cls: c.cls, driver: c.driver,
      // A sheet has to hold together: pole is the quickest time on it, and
      // every slot below is a little slower. The grid is shuffled rather than
      // ordered on pace, so that a race is not a procession.
      time: lapText(Math.min(...SIM.cars.map(x => x.pace)) + i * 0.22
                    + Math.random() * 0.09),
    })),
  });
  delete base._quals;                // the index is built from that list once
}

/** Set a race up: the grid, the plan, and the session it is run under. */
function simSetUp(base) {
  const grid = simGrid(base);
  if (!grid) return false;
  SIM.key = base.key;
  SIM.cars = grid.cars;
  SIM.duration = grid.duration;

  const about = Math.max(3, Math.floor(grid.duration / grid.quickest));
  const from = 2 + Math.floor(Math.random() * Math.max(1, about - 4));
  SIM.sc = [from, from + 1];
  SIM.retire = SIM.cars[Math.floor(Math.random() * SIM.cars.length)];
  SIM.retireOn = 2 + Math.floor(Math.random() * Math.max(1, about - 2));
  SIM.pit = SIM.cars.find(c => c !== SIM.retire) || null;
  SIM.pitOn = 2 + Math.floor(Math.random() * Math.max(1, about - 2));

  const made = simPlan(SIM.cars, grid.duration, grid.quickest);
  SIM.plan = made.plan; SIM.flagAt = made.flagAt; SIM.laps = made.laps;
  SIM.cars.forEach(c => { c.laps = 0; c.total = 0; c.best = c.last = null;
                          c.state = CAR_RUNNING; c.stops = 0;
                          c.pos = c.pic = c.was = c.grid; });
  SIM.next = 0;
  SIM.flag = 'Green';
  SIM.bests = {};

  // Which round this is: the meeting's first round still to be run.
  const meet = liveMeeting(base);
  const rounds = (meet.event && meet.event.rounds) || [];
  const nth = Math.max(1, rounds.findIndex(r => !base.roundsRun.includes(r)) + 1);
  if (meet.event) simQualifying(base, meet.event);
  SIM.session = {
    sessionFlag: 'Green',
    sessionClock: { timeToGo: simLeft(0), running: true },
    id: 'sim-' + Date.now(),
    series: base.fullName,
    name: 'RACE ' + nth,
    type: 3,
    plannedStart: new Date().toISOString(),
    weatherConditions: 'Dry', trackConditions: 'Dry', units: 1,
    duration: { time: hhmmss(grid.duration), laps: 0 },
    fastestLap: null,
    track: { name: meet.event ? meet.event.name : '',
             displayName: meet.event ? meet.event.name : '', length: 3000,
             sectors: [{ name: 'Sector 1', key: 'S1Time', isSpeedTrap: false },
                       { name: 'Sector 2', key: 'S2Time', isSpeedTrap: false },
                       { name: 'Sector 3', key: 'S3Time', isSpeedTrap: false }] },
    classes: [...new Set(SIM.cars.map(c => c.cls).filter(Boolean))]
      .map((c, i) => ({ id: String(i), name: c, colour: '#FF00A650' })),
    // The grid, as the snapshot a real page is built with would have it. The
    // feed itself says nothing about a car until it crosses the line, so
    // without this the demonstration spends its first lap unable to show the
    // splits it is sending - which is not what a real race day looks like.
    classification: SIM.cars.slice().sort((a, b) => a.grid - b.grid)
      .map(c => simRow(c, null, null)),
  };
  return true;
}

/** Play it, one crossing at a time, at `speed` times life. */
function simTick() {
  SIM.timer = null;
  const now = () => (Date.now() - SIM.t0) / 1000;
  while (SIM.next < SIM.plan.length) {
    const x = SIM.plan[SIM.next];
    const due = x.when / SIM.speed - now();
    if (due > 0.02) {
      SIM.timer = setTimeout(simTick, due * 1000);
      return;
    }
    SIM.next++;

    const want = x.when >= SIM.flagAt ? 'Finish'
      : (x.lap >= SIM.sc[0] && x.lap <= SIM.sc[1]) ? 'Yellow' : 'Green';
    if (want !== SIM.flag) {
      SIM.flag = want;
      SIM.session.sessionFlag = want;
      SIM.session.sessionClock = { timeToGo: simLeft(now()), running: want !== 'Finish' };
      simAnnounce();
      simSend('RCMsgReceived', { lineNo: 1, urgent: true,
        timestamp: new Date().toISOString(),
        text: { Yellow: 'SAFETY CAR DEPLOYED', Green: 'TRACK CLEAR - GREEN FLAG',
                Finish: 'CHEQUERED FLAG' }[want] });
    }

    const c = x.car;
    if (x.sector) {
      // Part way round: the two intermediates a lap is cut at, which is all a
      // car says about itself between one crossing of the line and the next.
      const was = SIM.bests[x.sector] || {};
      const mine = c.bests || (c.bests = {});
      const pb = !mine[x.sector] || x.took < mine[x.sector];
      if (pb) mine[x.sector] = x.took;
      if (!was.secs || x.took < was.secs) SIM.bests[x.sector] = { secs: x.took, by: c.id };
      simSend('CompetitorIntermediate', {
        id: c.id, sectorKey: x.sector, time: lapText(x.took), timePB: pb,
        speedTrapKey: x.sector === 'S1Time' ? 'Int1Speed' : 'Int2Speed',
        speed: 44 + Math.random() * 9, speedPB: false });
      continue;
    }
    c.laps = x.lap; c.last = x.took; c.total = x.when;
    c.best = c.best === null ? x.took : Math.min(c.best, x.took);
    if (c === SIM.pit && x.lap === SIM.pitOn) { c.stops = 1; simSend('CompetitorPitIn', { id: c.id }); }
    else if (c === SIM.pit && x.lap === SIM.pitOn + 1) simSend('CompetitorPitOut', { id: c.id });
    if (c === SIM.retire && x.lap === SIM.retireOn) {
      c.state = CAR_GONE;
      simSend('RCMsgReceived', { lineNo: 2, urgent: false,
        timestamp: new Date().toISOString(), text: `CAR ${c.no} ${c.name} - RETIRED` });
    }

    const moved = simRenumber();
    simSend('CompetitorLapCompleted', { id: c.id, lap: x.lap, time: lapText(x.took) });
    const order = simOrder();
    // The car that crossed, and anyone its crossing moved - which is what a
    // timing screen does, and why a page that joins late fills in over a lap.
    new Set([c, ...moved]).forEach(who => {
      const i = order.indexOf(who);
      simSend('ResultUpdated', simRow(who, order[0], i ? order[i - 1] : null));
    });
  }

  SIM.cars.forEach(c => { if (c.state === CAR_RUNNING) c.state = CAR_FINISHED; });
  SIM.session.sessionFlag = 'Finish';
  SIM.session.sessionClock = { timeToGo: '00:00:00', running: false };
  simAnnounce();
}

/** Start a demonstration from the page, and leave the address saying so. */
function liveDemoOn(speed) {
  LIVE_DEMO = String(speed || 25);
  LIVE_FAKE = true;
  LIVE.cars.clear(); LIVE.session = null; LIVE.rc = []; LIVE.sig = null;
  LIVE.seededAt = null; LIVE.fromSeed = false; LIVE.seedIds = null;
  const u = new URL(location.href);
  u.searchParams.set('demo', LIVE_DEMO);
  history.replaceState(null, '', u);       // a refresh keeps the demonstration
  liveStart();
  liveRefresh();
}

/** And back to the real thing. */
function liveDemoOff() {
  simStop();
  LIVE_DEMO = null;
  LIVE_FAKE = false;
  // The made-up qualifying goes with the made-up race that needed it.
  SEASON.series.forEach(s => {
    if (!(s.qualifying || []).some(q => q.demo)) return;
    s.qualifying = s.qualifying.filter(q => !q.demo);
    delete s._quals;
  });
  LIVE.cars.clear(); LIVE.session = null; LIVE.rc = []; LIVE.sig = null;
  LIVE.status = 'idle'; LIVE.wanted = false; LIVE.declined = true;
  const u = new URL(location.href);
  u.searchParams.delete('demo');
  history.replaceState(null, '', u);
  liveRefresh();
}

function simStart(base) {
  simStop();
  if (!simSetUp(base)) return;
  LIVE.status = 'demo';
  LIVE.clockRate = SIM.speed;
  LIVE.wanted = true;
  LIVE.declined = false;
  LIVE.paused = false;
  SIM.t0 = Date.now();
  simAnnounce();          // lights out: the one announcement a joiner relies on
  simTick();
}

function simStop() {
  clearTimeout(SIM.timer); SIM.timer = null; SIM.held = null;
  LIVE.clockRate = 1;
  if (LIVE.status === 'demo') LIVE.status = LIVE.session ? 'seed' : 'idle';
  LIVE.wanted = false;
}

/** Hold the race where it is, or let it go - the clock stops with it. */
function simHold(held) {
  if (held) {
    clearTimeout(SIM.timer); SIM.timer = null;
    SIM.held = Date.now();
    SIM.session.sessionClock = { timeToGo: simLeft((SIM.held - SIM.t0) / 1000),
                                 running: false };
    simAnnounce();
  } else if (SIM.held) {
    SIM.t0 += Date.now() - SIM.held;    // time spent held is not race time
    SIM.held = null;
    SIM.session.sessionClock = { timeToGo: simLeft((Date.now() - SIM.t0) / 1000),
                                 running: true };
    simAnnounce();
    simTick();
  }
}

/* ------------------------------------------------------- drawing it --- */

const FLAG_CLASS = { green: 'green', yellow: 'yellow', fcy: 'fcy', red: 'red',
                     finish: 'finish' };
const liveFlagClass = f => FLAG_CLASS[String(f || '').toLowerCase()] || '';

/* What the colour on the clock means, for anyone who would rather read it than
   know it - and for anyone who cannot tell the two of them apart. */
const FLAG_SAYS = {
  green: 'Green flag: the session is running, and this is the time left in it.',
  yellow: 'Yellow flag: something is wrong somewhere on the circuit and cars are '
    + 'slowing for it. The clock is still running.',
  fcy: 'Full course yellow: the whole circuit is neutralised and nobody may '
    + 'improve. The clock is still running.',
  red: 'Red flag: the session is stopped. The clock is stopped with it.',
  finish: 'Chequered flag: the session is over and this classification is '
    + 'provisional until the timekeepers publish it.',
};
const liveFlagSays = f => FLAG_SAYS[String(f || '').toLowerCase()]
  || `${f ? f + '. ' : ''}Time left in the session.`;

/** Where the socket has got to, in a phrase. */
function liveConn() {
  switch (LIVE.status) {
    case 'live': return ['on', `Live from ${timerName()}`];
    case 'demo': return ['on', 'Simulated in this page'];
    case 'connecting': return ['warn', 'Connecting…'];
    case 'retrying': return ['warn', 'Connection dropped — retrying'];
    case 'error': return ['off', 'This browser refused the connection'];
    case 'seed': return ['off', 'Not connected'];
    default: return ['off', 'Not connected'];
  }
}

const liveAgo = iso => {
  const t = Date.parse(iso || '');
  if (!t) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  return mins < 1 ? 'less than a minute ago'
    : mins < 60 ? `${mins} minute${mins === 1 ? '' : 's'} ago`
    : `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'} ago`;
};

/** The place-change arrow the feed carries: a smaller number is a place gained. */
function liveMove(n) {
  if (!n) return '<span style="color:var(--ink-3)">·</span>';
  return n < 0 ? `<span class="up">▲${-n}</span>` : `<span class="down">▼${n}</span>`;
}

const LIVE_STATE_LABEL = { 2: 'DSQ', 3: 'Out', 4: 'Pit' };

/* Two headings that are a word where a picture does: the order they are in, and
   how far round they have got. Both carry the word for anyone hovering or
   reading the page aloud. */
const ICON_POS = '<svg class="hicon" viewBox="0 0 16 16" aria-label="Position" '
  + 'role="img"><title>Position</title>'
  + '<rect x="1" y="9" width="4" height="6" rx="1"/>'
  + '<rect x="6" y="4" width="4" height="11" rx="1"/>'
  + '<rect x="11" y="11" width="4" height="4" rx="1"/></svg>';
/* Teeth rather than rays: they start where the body ends, and they are cut off
   square, which is what stops a small cog reading as a small sun. */
const ICON_COG = '<svg class="cogicon" viewBox="0 0 16 16" aria-hidden="true" '
  + 'focusable="false" fill="none" stroke="currentColor">'
  + '<circle cx="8" cy="8" r="4.8" stroke-width="1.6"/>'
  + '<path d="M8 .7v1.9M8 13.4v1.9M.7 8h1.9M13.4 8h1.9'
  + 'M2.84 2.84 4.18 4.18M11.82 11.82l1.34 1.34'
  + 'M13.16 2.84 11.82 4.18M4.18 11.82 2.84 13.16" stroke-width="2.2"/></svg>';
const ICON_LAPS = '<svg class="hicon" viewBox="0 0 16 16" aria-label="Laps completed" '
  + 'role="img"><title>Laps completed</title>'
  + '<path d="M13.5 8a5.5 5.5 0 1 1-1.9-4.2" fill="none" stroke="currentColor" '
  + 'stroke-width="1.8" stroke-linecap="round"/>'
  + '<path d="M13.6 1.4v3.1h-3.1" fill="none" stroke="currentColor" stroke-width="1.8" '
  + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Which columns of the running order are on.
 *
 * A timing screen is wider than a phone and there is no arrangement of it that
 * suits everybody, so it is the reader's to arrange: what they turn off is
 * remembered in this browser and applied to every session afterwards.
 *
 * The default is the width of the screen it is first read on - a phone gets the
 * interval to the car ahead rather than the gap to the leader, and is spared
 * the pit stops - and the moment anything is changed that judgement is over and
 * the choice is theirs.
 */
const COL_STORE = 'caterham.live.cols';
const COL_LOCKED = new Set(['pos', 'driver']);
const COL_NAME = {
  move: 'Places gained or lost', laps: 'Laps', gap: 'Gap to the leader',
  int: 'Interval to the car ahead', last: 'Last lap', best: 'Best lap',
  stops: 'Pit stops', pts: 'Points', net: 'Net after drop scores',
};

function colHidden() {
  if (LIVE.cols) return LIVE.cols;
  let held = null;
  try { held = localStorage.getItem(COL_STORE); } catch (e) { held = null; }
  LIVE.cols = new Set(held !== null ? held.split(' ').filter(Boolean)
    : innerWidth < 768 ? ['gap', 'stops'] : []);
  return LIVE.cols;
}

function colShow(key, on) {
  const hidden = colHidden();
  if (on) hidden.delete(key); else hidden.add(key);
  try { localStorage.setItem(COL_STORE, [...hidden].join(' ')); } catch (e) { /* private */ }
  colApply();
}

/** One stylesheet says what is off, so a change costs no redraw of the table. */
function colApply() {
  let tag = $('#liveColCss');
  if (!tag) {
    tag = el('style');
    tag.id = 'liveColCss';
    document.head.append(tag);
  }
  const off = [...colHidden()];
  tag.textContent = off.length
    ? off.map(k => `table.livetab [data-c="${k}"]`).join(',') + '{display:none}'
    : '';
}

/* A gap is behind by definition, so the plus in front of it says nothing and
   costs a column's width on a screen that has none to spare. */
const plain = t => String(t == null ? '' : t).replace(/^\+/, '') || '—';

/** The running order, this championship's cars only - or, for a session that
    is nobody's (`v.foreign`), everybody's, scored for no one. `id` names the
    table, so that a page holding more than one can put new rows into each. */
function liveTable(base, v, live, id = 'liveOrderTab') {
  const scored = v.scored ? v.scored.scored : null;
  const nets = scored && live && base.dropScores
    ? new Map(live.table.map(t => [t.driver, liveNetGain(live, t, String(v.scored.round))]))
    : null;
  // The sectors this session is cut into, in the order a car goes through them.
  // The last of them is the lap itself, so only the ones before it are columns.
  const splits = ((v.session || {}).sectors || []).slice(0, -1);
  // The quickest lap anybody has set. In a race that is the fastest lap; in
  // qualifying it is pole. It goes purple either way, because purple on a
  // timing screen means the best anybody has gone and not what it is worth.
  // What it is worth is a separate matter: the championship's extra point goes
  // to a registered driver, which is not always whoever set the time.
  let quickest = null, quickestAt = Infinity;
  v.rows.forEach(r => {
    const t = secsOf(r.best);
    if (t != null && t < quickestAt) { quickestAt = t; quickest = r.id; }
  });
  // Every column knows what it is, so a narrow screen can be given the ones
  // that matter and spared the rest.
  const cols = [['pos', ICON_POS], ['move', ''], ['driver', 'Driver'],
                ['laps', ICON_LAPS], ['gap', 'Gap'], ['int', 'Int']]
    .concat(splits.map((x, i) => ['s' + (i + 1), 'S' + (i + 1)]))
    .concat([['last', 'Last'], ['best', 'Best'], ['stops', 'Stops']])
    .concat(scored ? [['pts', 'Pts']] : []).concat(nets ? [['net', 'Net']] : []);
  const head = cols.map(c => c[1]);
  const used = new Set();
  const rows = v.rows.map(r => {
    // A session that is nobody's is nobody's driver by driver too. `liveWho`
    // matches on the car number first, and a number is only this
    // championship's inside this championship's own session: the support race
    // on the same feed has a 7 and a 23 of its own, and resolving them against
    // the table would put registered drivers' names - and their class marks
    // and their links - against cars belonging to somebody else entirely. So
    // a foreign running order is shown as the timekeepers have it, under the
    // names the feed itself gives.
    const t = v.foreign ? null : liveWho(base, r);
    const s = scored && t ? scored.get(t.driver) : null;
    const gain = nets && t && nets.has(t.driver) ? nets.get(t.driver) : null;
    const cls = r.state === CAR_GONE || r.state === CAR_DSQ ? 'gone'
      : r.state === CAR_PIT ? 'pit' : r.missing ? 'gone' : r.onGrid ? 'ongrid' : '';
    // Which class a car is in is its championship's answer, off the same table
    // the standings mark, and not what the feed prints in its own class
    // column: that is the championship's name - "Caterham 270R" - which is no
    // class of that championship's at all, so every row in the running order
    // came out as the blank outline that stands for a class nothing is known
    // about. A driver in no class but the championship itself is unmarked
    // here for the same reason the standings leave them unmarked.
    const mark = t && t.cls && t.cls !== 'Championship' ? t.cls : '';
    if (mark) used.add(mark);
    const who = t
      ? driverCell(t.driver, [t.registered ? '' : metaChip('Guest'),
                              classMark(mark, base), carChip(r.no)])
      : driverCell(r.name || '—', [v.foreign ? '' : metaChip('Not in the table'), carChip(r.no)]);
    const fastest = quickest != null && r.id === quickest;
    const point = v.scored && v.scored.flDriver && t && t.driver === v.scored.flDriver;
    return `<tr class="${cls}">`
      + `<td class="stick1 num mono" data-c="pos"${!r.onGrid ? '' : r.missing
          ? ' data-tip="Qualified here and has not been seen since the start, so it '
            + 'is not being scored as though it were running."'
          : ' data-tip="Where this car starts from, off the qualifying sheet. It has '
            + 'not crossed the line yet."'}>`
      + (r.onGrid ? `${r.gridPos}${r.missing ? '<small> no time</small>' : ''}`
         : r.pos == null ? '—' : r.pos)
      + (LIVE_STATE_LABEL[r.state] ? ` <small>${LIVE_STATE_LABEL[r.state]}</small>` : '')
      + `</td>`
      + `<td class="num mono" data-c="move" data-tip="Places gained or lost since the session started">`
      + `${liveMove(r.posChange)}</td>`
      + `<td class="stick2" data-c="driver">${who}</td>`
      + `<td class="num mono" data-c="laps">${r.laps == null ? '—' : r.laps}</td>`
      + `<td class="num mono" data-c="gap">${esc(plain(r.gap))}</td>`
      + `<td class="num mono" data-c="int">${esc(plain(r.diff))}</td>`
      + splits.map((x, i) => {
          const got = (r.sectors || {})[x.key];
          if (!got) return `<td class="num mono" data-c="s${i + 1}">—</td>`;
          // The conventions a timing screen has always used: purple for the
          // best anybody has gone in that sector, green for a car's own best.
          return `<td data-c="s${i + 1}" class="num mono split${got.best ? ' sbest' : got.pb ? ' pbest' : ''}"`
            + ` data-tip="${esc(x.name || x.key)}${got.best
                ? ' — quickest anybody has gone in it'
                : got.pb ? ' — this car’s own best' : ''}">`
            + `${esc(got.time)}</td>`;
        }).join('')
      + `<td class="num mono" data-c="last">${esc(r.last || '—')}</td>`
      + `<td class="num mono${fastest || point ? ' fl' : ''}" data-c="best"`
      + (fastest || point
         ? ` data-tip="${esc(
             (fastest ? (v.session && v.session.type === 2
                ? 'Quickest lap of qualifying so far — provisional pole'
                : 'Quickest lap of the session so far') : '')
             + (fastest && point ? '. ' : '')
             + (point ? 'Carries this championship’s extra point' : ''))}"`
         : '')
      + `>${esc(r.best || '—')}</td>`
      + `<td class="num mono" data-c="stops">${r.pitStops == null ? '—' : r.pitStops}</td>`
      + (scored ? `<td class="pts" data-c="pts">${!s ? '—'
          : s.status === 'classified' ? s.score
          : (s.score ? s.score + ' ' : '') + s.status.toLowerCase()}</td>` : '')
      + (nets ? `<td class="pts net${gain === 0 ? ' none' : ''}" data-c="net"`
          + (gain == null ? '' : ` data-tip="${esc(liveNetTip(base, t, s, gain))}"`)
          + `>${gain == null ? '—' : '+' + gain}</td>` : '')
      + '</tr>';
  }).join('');
  const hidden = colHidden();
  const chooser = '<details class="fakes icon">'
    + `<summary aria-label="Choose the columns to show" data-tip="Which columns `
    + `this table shows. What you turn off stays off, in this browser, for every `
    + `session after it.">${ICON_COG}</summary><div class="fakemenu">`
    + cols.filter(([k]) => !COL_LOCKED.has(k)).map(([k]) => {
        const sec = /^s(\d+)$/.exec(k);
        const name = sec ? ((splits[+sec[1] - 1] || {}).name || 'Sector ' + sec[1])
          : COL_NAME[k] || k;
        return `<label><input type="checkbox" data-col="${k}"`
          + `${hidden.has(k) ? '' : ' checked'}> ${esc(name)}</label>`;
      }).join('')
    + '</div></details>';
  return { rows, cols: head.join('|'), chooser,
    html: `<div class="scroller"><table class="livetab" id="${id}"><thead><tr>`
      + cols.map(([k, h]) => `<th data-c="${k}" class="${h && h !== 'Driver' ? 'num' : ''}`
        + `${k === 'pos' ? ' stick1' : k === 'driver' ? ' stick2' : ''}">${h}</th>`).join('')
      + `</tr></thead><tbody>${rows}</tbody></table></div>${classLegend(used, base)}` };
}

/**
 * What this round is actually worth to a driver, once the drop scores are in.
 *
 * The season total with it, less the season total with the same race run and
 * nothing scored in it - which is the question a driver is asking. It is not
 * the same as the difference the round makes to a mid-season total: adding a
 * sixteenth round to fifteen also widens the window the drops are chosen from,
 * and that would credit a car that retired with the points it frees up.
 *
 * So the comparison holds the round itself fixed and varies only the score in
 * it. A round that would be dropped either way is worth nothing; one that
 * displaces a 12-point round is worth its score less twelve; and a driver with
 * a zero still to discard keeps the lot. Both sides go through `seasonTotal`,
 * so this cannot drift from the table it sits next to.
 */
function liveNetGain(d, t, key) {
  const part = d.dropComponent === 'race_points' ? 'race_points' : 'score';
  const scored = { scores: [], droppable: [] }, blank = { scores: [], droppable: [] };
  d.roundsRun.forEach(r => {
    const k = String(r), s = t.rounds[k], mine = k === key;
    scored.scores.push(s ? s.score : 0);
    scored.droppable.push(s ? s[part] : 0);
    blank.scores.push(s && !mine ? s.score : 0);
    blank.droppable.push(s && !mine ? s[part] : 0);
  });
  const p = t.penalty_points, b = t.bonus || 0, n = d.dropScores;
  return seasonTotal(scored.scores, scored.droppable, n, p, b).net
       - seasonTotal(blank.scores, blank.droppable, n, p, b).net;
}

/** Why a round worth 22 adds 7 to a season, or nothing at all. */
function liveNetTip(base, t, s, gain) {
  const n = base.dropScores;
  const drops = `the ${n === 1 ? 'lowest score is' : `lowest ${n} scores are`} dropped`;
  const part = base.dropComponent === 'race_points'
    ? ' — and for the Graduates a drop takes the finishing points only, so a fastest '
      + 'lap point survives the round it was set in' : '';
  if (!t.registered) return `${esc(t.driver)} is a guest entry and scores nothing.`;
  const score = s ? s.score : 0;
  if (gain === score) {
    return `${t.driver}: all ${score} of it counts. Nothing better than this round `
      + `is being discarded yet, so the season total goes up by the lot.`;
  }
  if (gain === 0) {
    return `${t.driver}: worth nothing to the season. With ${drops}, this round is one `
      + `of the discarded ones — only beating a round already counting would add anything${part}.`;
  }
  return `${t.driver}: scores ${score}, adds ${gain}. It displaces a ${score - gain}-point `
    + `round rather than an empty one, because ${drops}${part}.`;
}

/** What the running order does to the championship, if it ends as it stands. */
function liveImpact(base, v, d) {
  const before = new Map(base.table.map(t => [t.driver, t]));
  // Every registered driver, in one run. Cutting it to the top of the table and
  // whoever this race had moved meant a Pos column that skipped, and a table
  // that skips has to explain itself; the whole championship is a dozen rows
  // more and explains itself.
  const reg = d.table.filter(t => t.registered);
  // Both ends of the season with this race counted as it stands, which is what
  // this table is: where the championship ends up if it finishes like this. The
  // Net beside them counts the race the same way, so neither end can come out on
  // the wrong side of it. The title run-in asks it of a race still to be won.
  const left = d.roundsTotal - d.roundsRun.length;
  // "the one race after it", and nothing at all where this is the last round.
  const after = left === 1 ? 'the one race after it' : `the ${left} races after it`;
  const rows = reg.map(t => {
    const b = before.get(t.driver) || {};
    const s = t.rounds[String(v.scored.round)];
    const move = (b.pos || 0) - (t.pos || 0);
    const floor = project(t, 0, d);
    const ceiling = project(t, maxRace(d), d);
    return `<tr><td class="stick1 num mono" data-c="pos">${t.pos}</td>`
      + `<td class="mv" data-c="move">${move ? liveMove(-move)
          : '<span style="color:var(--ink-3)">·</span>'}</td>`
      + `<td class="stick2" data-c="driver">`
      + `${driverCell(t.driver, [carChip(t.no)])}</td>`
      + `<td class="num mono" data-c="before">${b.gross == null ? '—' : b.gross}</td>`
      + `<td class="num mono" data-c="race">${!s ? '—'
          : s.status === 'classified' ? '+' + s.score
          : s.status.toLowerCase() + (s.score ? ' +' + s.score : '')}</td>`
      + `<td class="num mono" data-c="total"><b>${t.gross}</b></td>`
      + `<td class="num mono" data-c="net">${t.net}</td>`
      + `<td class="num mono proj" data-c="min" data-tip="${esc(t.driver)} ends the season on `
      + `${floor} if this race finishes as it stands`
      // With nothing after this race there is no zero left for the drops to take,
      // so the floor is the Net itself rather than something above it.
      + (left
         ? ` and they score nothing in ${after}. It is never below the Net beside it `
           + `because a round still to run is a zero the drop scores can take instead of a `
           + `real result.`
         : ', the last round of the season - so it is the Net beside it, with nothing '
           + 'left to project.')
      + `">${floor}</td>`
      + `<td class="num mono proj" data-c="max" data-tip="${esc(t.driver)} cannot finish above `
      + `${ceiling} from here: this race as it stands`
      + `${left ? `, and ${after} won with the fastest lap` : ', the last round of the '
          + 'season'}.">${ceiling}</td></tr>`;
  }).join('');
  return { rows,
    html: `<div class="scroller"><table class="deltatab" id="liveImpactTab"><thead><tr>`
      + `<th class="num stick1" data-c="pos">${ICON_POS}</th>`
      + '<th class="num" data-c="move">Move</th>'
      + '<th class="stick2" data-c="driver">Driver</th>'
      + '<th class="num" data-c="before">Before</th><th class="num" data-c="race">This race</th>'
      + '<th class="num" data-c="total">Total</th><th class="num" data-c="net">Net</th>'
      + '<th class="num" data-c="min">Min</th><th class="num" data-c="max">Max</th>'
      + `</tr></thead><tbody>${rows}</tbody></table></div>` };
}

/** The Live tab - or the same thing on the live view's meeting page, which is
    `p`: the box is drawn into whichever of the two is on the screen. */
function livePanel(base, v, p) {
  const meet = v.meet;
  const [cc, ctext] = liveConn();
  const sess = v.session;
  // The clock the feed carries is a time in every session, lap-limited or not:
  // a race over a number of laps still counts the minutes down. It sits beside
  // the session it is counting and says nothing about itself - a clock next to
  // a race is a clock counting the race down - and it is coloured by the flag
  // showing, which is the other thing a timing screen is read for.
  // Every handle on this tab, behind one button. There are not many of them -
  // watch, stop, and the handles on the demonstration - but they are the only
  // things here that are not the race, and a row of buttons beside a timing
  // screen is a row of buttons in the way of it.
  const item = (id, label, tip) =>
    `<button class="livebtn quiet" id="${id}" data-tip="${esc(tip)}">${label}</button>`;
  const items = [];
  if (LIVE_FAKE) {
    items.push(LIVE.wanted
      ? item('liveStop', 'Stop the race',
             'Stop the simulation and leave the table where it got to')
      : item('liveGo', 'Run the race',
             'Run twenty minutes of a made-up race, in real time, against this '
             + 'championship’s own scoring'));
    items.push(item('livePause', LIVE.paused ? 'Let it go' : 'Hold the race',
                    'Stop the simulation where it is — the clock stops with '
                    + 'it — or let it go again'));
    items.push(item('liveReset', 'Restart the race',
                    'Send the simulation back to the grid and run it again from '
                    + 'lights out'));
    items.push(item('liveDemoOff', 'Done',
                    `Stop the demonstration and put this tab back on `
                    + `${timerName()}’s own feed`));
  } else {
    if (LIVE.key) {
      items.push(LIVE.wanted
        ? item('liveStop', 'Stop watching',
               `Close the connection to ${timerName()}. The table stays where `
               + `it got to`)
        : item('liveGo', 'Watch live',
               `Open ${timerName()}’s feed for this meeting and score every `
               + `lap of it against this championship as it comes in`));
      items.push(`<a class="livebtn quiet" target="_blank" rel="noopener" `
        + `href="${esc(timerSite())}" data-tip="${esc(timerName())}’s own live `
        + `timing page for this meeting, every session of it">${esc(timerName())} `
        + `live timing ↗</a>`);
    }
    items.push(item('liveDemoOn', 'Show a demonstration race',
                    'Race a made-up field against the clock in this page, in real '
                    + 'time, to show what this tab does while a meeting is '
                    + 'running: twenty minutes of it, a lap every minute and a '
                    + 'half. Nothing is timed and none of the numbers are real.'));
  }
  const fakes = '<details class="fakes icon"><summary aria-label="What this tab can do"'
    + ' data-tip="Watch the feed, stop watching, and the handles on the '
    + 'demonstration"><span class="bars"></span></summary>'
    + `<div class="fakemenu">${items.join('')}</div></details>`;

  // Nothing is running until the timetable says it is, and the feed will not
  // say so either - it is silent until the first car crosses the line. So when
  // there is no session the same slot counts down to the one that is coming.
  const soon = sess ? null : liveNext(base, meet);
  LIVE.startsAt = soon ? soon.at : null;
  const soonTip = soon
    ? `${soon.name} is timetabled for ${soon.s.start}`
      + (soon.s.day ? `, ${dayWord(soon.s.day)}` : '')
      + (meet.event && meet.event.tz ? ` ${meet.event.tz}` : '')
      + '. This page opens the feed five minutes before it starts.'
    : '';
  const clock = sess
    ? `<span class="clock ${liveFlagClass(sess.flag)}" id="liveClock"`
      + ` data-tip="${esc(liveFlagSays(sess.flag))}">${liveClockNow() || '—'}</span>`
    : soon
    ? `<span class="clock soon" id="liveClock" data-tip="${esc(soonTip)}">`
      + `${liveCountText(soon.secs)}</span>`
    : '';
  // The meeting and what is on at it, and nothing else: which rounds it carries
  // and what dates it runs on are the calendar's business, and repeating them
  // over a timing screen is a line of the page spent saying nothing.
  const where = meet.event
    ? `<span class="ev">${esc(meet.event.name)}</span>`
      + (sess ? `<span class="sess">${esc(sess.name || sess.typeName)}</span>` : '')
      + (soon ? `<span class="sess next">${esc(soon.name)}</span>` : '')
      + clock
    : 'No meeting';

  const bar = [];
  if (LIVE.seededAt) {
    bar.push(`<span style="font-size:12.5px;color:var(--ink-3)">Snapshot taken `
      + `${liveAgo(LIVE.seededAt)}${liveOn() ? ', and live since' : ''}</span>`);
  }

  let body = '', order = null, impact = null, gridNote = '';
  if (sess && v.kind) {
    // The meeting and the session are in the box above; what is left to say is
    // what this session is worth.
    const about = [
      sess.duration && sess.duration.laps ? `${sess.duration.laps} laps` : '',
      // Which round a race counts as is the meeting's business, and the box
      // above already says which rounds are at it. What is worth saying here is
      // when a session does not count at all.
      v.scored ? ''
        : sess.type === 3 ? 'already classified — the tables use that, not this'
        : sess.type === 2 ? 'qualifying — no championship points, but this is the '
            + 'sheet the grid for the race is laid out from'
        : 'practice carries no championship points',
      LIVE.ended && !LIVE.ws ? 'finished, as the last snapshot saw it' : '',
    ].filter(Boolean);
    if (about.length) body += `<p class="sub" style="margin-top:0">${about.join(' · ')}</p>`;
    // A car that has not come past yet is shown in the slot it starts from,
    // which the table says for itself. What is worth a note is a car that
    // started and has not been seen since.
    gridNote = (v.missing ? ''
      + (`${v.missing} car${v.missing === 1 ? '' : 's'} on the grid `
          + `${v.missing === 1 ? 'has' : 'have'} not been seen since the start, so `
          + `${v.missing === 1 ? 'it is' : 'they are'} listed with no time and scored `
          + 'as having qualified and not started.')
      : '');
    // Its own element, because how much of the grid is still standing changes
    // every time a car comes past and the rest of the page does not.
    body += `<div class="livenote" id="liveGridNote"${gridNote ? '' : ' hidden'}>`
      + `${gridNote}</div>`;
    if (v.mixed) {
      body += '<div class="livenote">This grid is shared by both classes and the feed '
        + 'does not say which class each car is in, so every car on it is listed and '
        + 'none of it is scored: places are allocated down a championship’s own '
        + 'entries, and there is no telling here which of these are ours. The '
        + 'classification will say, when it is published.</div>';
    }
    // The table with this session's round folded in, worked out once: the
    // running order needs it for what a place is worth, and the standings under
    // it are the same table shown a different way round.
    const live = v.scored && v.scored.scored.size ? withLive(base, v.scored) : null;
    order = liveTable(base, v, live);
    body += order.html;
    if (live && base.dropScores) {
      const n = base.dropScores;
      body += `<details class="tv"><summary>What Pts and Net mean</summary>`
        + `<p class="sub" style="margin:8px 0 0"><b>Pts</b> is what the place is worth `
        + `under <span class="reg">1.6.1</span>, with the fastest lap point in it. `
        + `<b>Net</b> is what it adds to the season total: ${n === 1 ? 'the lowest score is'
          : `the lowest ${n} scores are`} dropped at the end of the year `
        + `(<span class="reg">${grads() ? '1.6.2a' : '1.6.4'}</span>), so a driver with `
        + `nothing poor left to discard keeps less of a good round than the number beside it `
        + `suggests — and none of it at all where this round is the one being dropped. `
        + `Hover any of them for which it is.</p></details>`;
    }
    if (v.scored && v.scored.scored.size) {
      body += '<h2>The championship, if it ends like this</h2>'
        + (impact = liveImpact(base, v, live)).html
        + `<details class="tv"><summary>How this is worked out</summary>`
        + `<p class="sub" style="margin:8px 0 0">Round ${v.scored.round} scored under `
        + `<span class="reg">1.6.1</span> from the order above, with the fastest lap point `
        + `and the drop scores applied. Min and Max carry it to the end of the season: where `
        + `each driver ends up if this race finishes as it stands and they score nothing after `
        + `it, and where they end up if it finishes as it stands and they win everything left. `
        + `Both count this race exactly as Total and Net do, so Min is never below the Net `
        + `beside it. The title run-in asks the other question, of a race still to be won. `
        + `Provisional in every sense — the race is still running, and the classification is `
        + `the stewards' to write.</p></details>`;
    }
    if (LIVE.rc.length) {
      body += '<h2>Race control</h2><div class="notes">'
        + LIVE.rc.map(m => `<p>${esc(m.text)}</p>`).join('') + '</div>';
    }
  } else if (sess) {
    body += `<p class="lede">${esc(timerName())} are timing `
      + `<b>${esc(sess.series || 'another championship')}</b> `
      + `at this meeting right now — ${esc(sess.typeName)}, ${esc(sess.name || '')}. `
      + `${esc(base.short)}'s next session will appear here as soon as it starts.</p>`;
  } else if (liveOn() && LIVE.cars.size) {
    // Cars are reporting and nothing has said what they are in. The feed names
    // a session only when something about it changes, so this clears itself at
    // the next flag, and at the finish at the latest.
    body += `<p class="lede">Connected, and <b>${LIVE.cars.size}</b> `
      + `car${LIVE.cars.size === 1 ? ' is' : 's are'} reporting — but the feed only names a `
      + `session when something about it changes, so it has not yet said which one is out `
      + `there. Until it does there is no telling whether these are ${esc(base.short)}'s `
      + `cars. The next flag will settle it.</p>`
      + (LIVE.stale
         ? '<div class="livenote">The session in the snapshot this page was built with has '
           + 'been superseded — cars are reporting that were not in it — so it has been '
           + 'dropped rather than shown over the top of whatever is running now.</div>'
         : '');
  } else if (liveOn()) {
    body += '<p class="lede">Connected, and nothing is running: the feed says nothing '
      + 'between sessions, and this page will fill in on its own when the next one '
      + 'starts.</p>';
  } else if (meet.running) {
    body += `<p class="lede">${esc(meet.event.name)} is running today`
      + (soon
         ? `, and <b>${esc(soon.name)}</b> is timetabled for ${esc(soon.s.start)}`
           + (soon.s.day ? ` on ${esc(dayWord(soon.s.day))}` : '')
           + `. This page opens ${timerName()}’s feed five minutes before that, and `
           + 'scores every lap of it under this championship’s regulations — or press '
           + '<b>Watch live</b> in the menu to open it now.'
         : `. Nothing has been asked of ${timerName()} yet — press <b>Watch live</b> `
           + 'in the menu and this page opens their timing feed directly, then scores '
           + 'every lap of it under this championship’s regulations.')
      + '</p>';
  } else if (meet.event) {
    body += `<p class="lede">Nothing is running. The next meeting on ${esc(base.short)}'s `
      + `calendar is <b>${esc(meet.event.name)}</b>, ${esc(meet.event.dates)}`
      + (meet.key ? ', and this page can watch it live when it does.'
                 : ', which nobody is publishing live timing for.')
      + (soon && meet.key
         ? ` First out is <b>${esc(soon.name)}</b>, timetabled for `
           + `${esc(soon.s.start)}`
           + (soon.s.day ? ` on ${esc(dayWord(soon.s.day))}` : '')
           + '; the clock above is counting down to it, and this page opens the '
           + 'feed five minutes before it starts.'
         : '')
      + `</p>`;
  } else {
    body += '<p class="lede">Every round has been run — there is nothing left to watch.</p>';
  }

  // Everything that explains rather than reports is on the About page; what is
  // left here is the one line that says where to find it.
  const why = '<p class="sub" style="margin-top:18px">Where this comes from, why the '
    + 'table can start half-empty, and why none of it is a result: '
    + `<a href="#${SEASON.year}/${base.key}/faq">FAQ</a>.`
    + (LIVE_FAKE ? ' Nothing is being timed at the moment — this is a demonstration.' : '')
    + '</p>';

  /* The tables are redrawn every time the feed says anything - once a second
     through a race - and until now so was everything around them. A button
     rebuilt between the press and the release is a button that does nothing,
     which is exactly what a redraw under the pointer did to Restart. So the
     controls are their own piece of the page, rebuilt only when something
     about them actually changes, and the running order alone is replaced on a
     tick. */
  // Built last, because the columns the cog offers are the columns the table
  // turned out to have - which sectors this circuit is cut into, and whether
  // this session is one that scores.
  let head = `<div class="livehead"><div class="who">${where}</div>`;
  head += '<div class="right">'
    + (LIVE_FAKE ? `<span class="flagpill" data-tip="Nothing is being timed: this `
        + `page is racing a made-up field against the clock to show what the live `
        + `view does`
        + `${SIM.speed > 1 ? `, at ${SIM.speed} times life` : `, in real time`}. `
        + `None of these numbers are real.">Simulated race</span>` : '')
    + `<span class="conn ${cc}"><i></i>${ctext}</span>`
    + '</div>'
    // The two buttons are a child of the box rather than of the status group,
    // so that on a phone they can stay up on the line with the clock while the
    // status drops below them.
    + `<span class="acts">${fakes}${order ? order.chooser : ''}</span>`
    + '</div>';

  const shell = [base.key, LIVE.status, LIVE.wanted, LIVE.paused, LIVE.key, LIVE_FAKE,
                 sess && sess.id, sess && sess.flag, v.scored && v.scored.round,
                 LIVE.applied, LIVE.seededAt, meet.event && meet.event.key,
                 soon && soon.name, order && order.cols].join('|');
  if (p.dataset.shell !== shell) {
    p.innerHTML = head
      + (bar.length ? `<div class="livebar">${bar.join('')}</div>` : '')
      + '<div id="liveBody"></div>';
    p.dataset.shell = shell;
    tipGone();

    const go = $('#liveGo', p), stop = $('#liveStop', p);
    if (go) go.onclick = () => liveStart();
    if (stop) stop.onclick = () => liveStop();
    const again = $('#liveReset', p);
    if (again) again.onclick = () => {
      // Back to the grid: the page's own view goes with it, so the last race's
      // laps and times cannot sit under this one's.
      LIVE.cars.clear(); LIVE.rc = []; LIVE.sig = null;
      liveStart();
      liveRefresh();
    };
    const hold = $('#livePause', p);
    if (hold) hold.onclick = () => {
      LIVE.paused = !LIVE.paused;
      simHold(LIVE.paused);
      liveDraw();
    };
    const demoOn = $('#liveDemoOn', p);
    if (demoOn) demoOn.onclick = () => liveDemoOn(1);
    const demoOff = $('#liveDemoOff', p);
    if (demoOff) demoOff.onclick = () => liveDemoOff();
  }
  /* A table is a thing you are holding: on a phone it is wider than the screen,
     and reading the points column means dragging it sideways. Rebuilding it
     under your finger every time a car crosses the line throws that away - the
     scroll goes back to the left, and a drag in progress dies with the element
     it was dragging. So the page around the tables is rebuilt only when it
     actually differs, and the rows alone are replaced on a tick, into the table
     that is already on the screen, exactly where you left it. */
  const into = $('#liveBody', p);
  const shape = [(sess || {}).id, v.kind, v.round, v.mixed, LIVE.rc.length,
                 order && order.cols, !!impact, !!v.scored].join('|');
  const same = into.dataset.shape === shape && $('#liveOrderTab', into);
  if (same) {
    liveRows2(into, '#liveOrderTab', order);
    liveRows2(into, '#liveImpactTab', impact);
    const note = $('#liveGridNote', into);
    if (note) { note.innerHTML = gridNote; note.hidden = !gridNote; }
  } else {
    into.innerHTML = body + why;
    into.dataset.shape = shape;
    linkRegs(into);
    tipGone();
  }
}

/* The column chooser is rebuilt whenever the table around it is, and the table
   is drawn on either of two panels, so the handler is on the document rather
   than on the boxes. */
document.addEventListener('change', e => {
  const box = e.target.closest('input[data-col]');
  if (box) colShow(box.dataset.col, box.checked);
});

/* Two menus side by side: opening one puts the other away, and anywhere that is
   not a menu puts both away. A panel left hanging over the running order is the
   one thing worse than no menu at all. */
document.addEventListener('click', e => {
  const inside = e.target.closest('details.fakes');
  document.querySelectorAll('details.fakes[open]').forEach(d => {
    if (d !== inside) d.open = false;
  });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('details.fakes[open]').forEach(d => { d.open = false; });
});

/** New rows into the table already on the page, leaving the page where it is. */
function liveRows2(into, sel, made) {
  const tab = made && $(sel, into);
  if (!tab) return;
  const body = tab.tBodies[0];
  if (body && body.innerHTML !== made.rows) body.innerHTML = made.rows;
}

/** The line under the tabs, on every tab, when a live round is being counted. */
function liveNote(base, v) {
  const box = $('#liveNote');
  if (!(D && D.live)) { box.innerHTML = ''; box.className = ''; return; }
  const s = D.live;
  const connected = liveOn();
  box.className = 'note';
  const where = v.meet.event ? v.meet.event.name : '';
  if (innerWidth < 768) {
    // Same thing said in a quarter of the room.
    box.innerHTML = `<span class="tag">${connected ? 'Live' : 'Provisional'}</span>`
      + `<b>Round ${s.round}</b> at ${esc(where)} is counted in the standings and the `
      + `run-in, provisionally. <a href="#" id="liveOff">Leave it out</a>`;
    const off = $('#liveOff', box);
    if (off) off.onclick = e => { e.preventDefault(); LIVE.applied = false; liveRefresh(); };
    return;
  }
  box.innerHTML = `<span class="tag">${connected ? 'Live' : 'Provisional'}</span>`
    + `<b>Round ${s.round}</b> `
    + (connected ? 'is running at ' : LIVE.ended ? 'has just been run at ' : 'was running at ')
    + `${esc(v.meet.event ? v.meet.event.name : '')}, `
    + `and the standings, the swing chart and the title run-in on this page include it as `
    + (connected ? 'it stands. ' : `the snapshot taken ${liveAgo(LIVE.seededAt)} left it. `)
    + `It is provisional: the classification is written after the race. `
    + `<a href="#" id="liveOff">Leave it out</a> · `
    + `<a href="#${SEASON.year}/${D.key}/live">the live timing</a>`;
  const off = $('#liveOff', box);
  if (off) off.onclick = e => { e.preventDefault(); LIVE.applied = false; liveRefresh(); };
}

/** A dot on the tab while a session of this series is actually running. */
function liveDot(v) {
  const b = tabBtn.live;
  if (!b) return;
  const on = liveOn() && v.session && v.kind
    && String(v.session.flag || '').toLowerCase() !== 'finish';
  b.innerHTML = 'Live' + (on ? '<span class="livedot"></span>' : '');
}

function liveDraw() {
  const base = SEASON.series.find(s => s.key === (D || {}).key);
  if (!base) return;
  // Always worked out afresh. Holding on to the last one saved a few passes
  // over forty rows and cost a panel that said nothing was running for a second
  // after the lights went out, because the view it was drawing predated them.
  const v = liveView(base);
  // On the live view the running order is drawn on the meeting's page, and the
  // meeting may have moved on to another championship's session - in which
  // case the page has been switched to that series and redrawn already.
  if (MODE === 'live') { if (liveEventDraw(base, v)) return; }
  else livePanel(base, v, $('#p-live'));
  liveNote(base, v);
  liveDot(v);
  liveMarks();
}

/* What has to change before the whole page is redrawn: the running order and
   who is still in the race, not every lap time that lands. */
function liveSig() {
  const s = LIVE.session || {};
  return [s.id, s.flag,
          ...[...LIVE.cars.values()].map(r => `${r.no}:${r.pos}:${r.state}`)].join('|');
}

function liveTick() {
  const base = SEASON.series.find(s => s.key === (D || {}).key);
  if (!base) return;
  const sig = liveSig();
  if (sig !== LIVE.sig) { LIVE.sig = sig; liveRefresh(); } else liveDraw();
}

/* Tabs whose contents the points have moved on from. */
const LIVE_STALE = {};
const LIVE_TABS = { standings: () => standings(), runin: () => runin() };

/** Rebuild a tab if it is on screen; otherwise remember that it needs it. */
function liveStale(tab) {
  // What is on the screen, rather than what the routing thinks is: a panel can
  // be shown without the address having caught up with it, and a tab that never
  // rebuilds because of that bookkeeping is worse than one that rebuilds twice.
  const panel = $('#p-' + tab);
  if (panel && panel.classList.contains('on')) {
    keepScroll(panel, LIVE_TABS[tab]);
    LIVE_STALE[tab] = false;
  } else LIVE_STALE[tab] = true;
}

/**
 * Rebuild something, and leave the page where the reader had it.
 *
 * A championship table is twenty-one rounds wide and a phone is not, so reading
 * the right-hand end of it means dragging it there. Rebuilding it puts it back
 * at the left, which on a race day it would do every few seconds.
 */
function keepScroll(host, render) {
  const was = [...host.querySelectorAll('.scroller')]
    .map(x => [x.scrollLeft, x.scrollTop]);
  render();
  [...host.querySelectorAll('.scroller')].forEach((x, i) => {
    if (!was[i]) return;
    // The table now scrolls down as well as across, so row 40 is somewhere a
    // reader can be when the rebuild comes, the same as round 21 is.
    if (was[i][0]) x.scrollLeft = was[i][0];
    if (was[i][1]) x.scrollTop = was[i][1];
  });
}

/* -------------------------------------------------------------- enduro */
/* The race that is a round of nothing.
 *
 * Every other tab is a view of one championship, chosen with the strip along
 * the top. This one is not: the 3 Hours of 300 is contested by 310R, 270R and
 * Roadsport cars at once and counts for none of their tables, so there is no
 * championship whose page it could sit on without filling that table with
 * another series' cars.
 *
 * What the series switcher still does here is say which of these cars are the
 * ones being followed - the rows of the series on show are marked, and a
 * series that did not enter is told so rather than shown a table with nothing
 * of its own in it.
 */

/** The special events of the season being shown, newest first. */
const specials = () => (SEASON.specials || []).slice().sort(
  (a, b) => String(b.date || '').localeCompare(String(a.date || '')));

/** Which series a class marker on that sheet stands for. */
function enduroSeriesOf(ev, marker) {
  const c = (ev.classes || []).find(x => x.marker === marker);
  return c ? c.series : null;
}

/** A class marker, coloured and shaped the way the standings colour a class. */
function enduroClassMark(ev, marker) {
  const i = (ev.classes || []).findIndex(x => x.marker === marker);
  const shape = CLASS_MARKS[i] || 'other';
  const c = (ev.classes || []).find(x => x.marker === marker);
  return `<span class="rowhead"><span class="cmark ${shape}"></span>`
    + `<b>${esc((c && c.name) || marker)}</b></span>`;
}

/**
 * A team and the drivers who shared the car, in one cell.
 *
 * The team is the entry and the drivers are who drove it, which is the whole
 * difference between this race and every other one on the page - so both are
 * shown, rather than a name standing in for an entry the way a sprint race
 * lets it.
 */
function enduroCrew(e) {
  const names = (e.drivers || []).map(n => driverCell(n, [])).join(
    '<span class="crewsep">/</span>');
  return `<span class="crew"><b>${esc(e.team)}</b>`
    + (e.hero ? ' <span class="chip hero" data-tip="One driver, the whole three '
      + 'hours - which is what the Hero trophy is for">Hero</span>' : '')
    + `</span><span class="crewnames">${names || '—'}</span>`;
}

/** The first three overall, and the first three of each class. */
function enduroPodiums(ev) {
  const run = (ev.entries || []).filter(e => e.pos);
  if (!run.length) return '';
  const box = ['<div class="podiums">'];
  const card = (title, rows) => '<div class="podium"><div class="k">' + title
    + '</div><ol>' + rows.map(e =>
      `<li><span class="pno">#${esc(e.no)}</span> <b>${esc(e.team)}</b>`
      + (e.hero ? ' <span class="chip hero">Hero</span>' : '')
      + `<span class="pwho">${esc((e.drivers || []).join(' / '))}</span></li>`).join('')
    + '</ol></div>';
  box.push(card('Overall', run.slice(0, 3)));
  (ev.classes || []).forEach(c => {
    const inCls = run.filter(e => e.cls === c.marker).slice(0, 3);
    if (inCls.length) box.push(card(c.name, inCls));
  });
  box.push('</div>');
  return box.join('');
}

/** The figures across the top: how long, how far, in what weather. */
function enduroStats(ev) {
  const win = (ev.entries || []).find(e => e.pos === 1);
  const cells = [
    ['Length', ev.minutes ? `${ev.minutes / 60}<small> hours</small>` : '—'],
    ['Distance', ev.miles ? `${ev.miles}<small> miles</small>` : '—'],
    ['Leader’s laps', ev.laps != null ? `${ev.laps}` : '—'],
    ['Entries', `${(ev.entries || []).length}<small> cars</small>`],
    ['Winner', win ? `${esc(win.team)}` : '<small>Not run yet</small>'],
  ];
  return '<div class="mast-stats standalone">' + cells.map(([k, v]) =>
    `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')
    + '</div>';
}

/** The classification, or the qualifying sheet, which share a shape. */
function enduroTable(ev, rows, kind) {
  const race = kind === 'race';
  const mine = D && D.key;
  const sc = el('div', 'scroller'), tb = el('table', 'results enduro');
  const cols = race
    ? ['Pos', 'No', 'Class', 'Team / drivers', 'Laps', 'Race time', 'Gap', 'Diff',
       'Best lap', 'On', 'Grid', '±']
    : ['Pos', 'No', 'Class', 'Team / drivers', 'Best lap', 'On', 'Laps', 'Gap', 'Diff', 'MPH'];
  tb.innerHTML = '<thead><tr>' + cols.map((x, i) =>
    `<th class="${i > 3 ? 'num' : ''}${i === 0 ? ' stick1' : i === 3 ? ' stick2' : ''}"`
    + `>${x}</th>`).join('') + '</tr></thead>';
  const body = el('tbody');
  rows.forEach(e => {
    const ours = enduroSeriesOf(ev, e.cls) === mine;
    const tr = el('tr', (e.pos === 1 ? 'win ' : '')
      + (e.status && e.status !== 'classified' ? 'dnf ' : '') + (ours ? 'ours' : ''));
    const cells = race
      ? [[e.pos ?? e.status ?? '—', 'stick1'], [e.no, 'num'], [e.cls, 'cls'],
         [e.team, 'stick2 crewcell'],
         [e.laps ?? '—', 'num'], [e.time || '—', 'num'], [e.gap || '—', 'num'],
         [e.diff || '—', 'num'], [e.best || '—', 'num'], [e.best_on ?? '—', 'num'],
         [e.grid ?? '—', 'num'], [e.gained ?? '—', 'num gained']]
      : [[e.pos ?? '—', 'stick1'], [e.no, 'num'], [e.cls, 'cls'],
         [e.team, 'stick2 crewcell'],
         [e.time || '—', 'num'], [e.best_on ?? '—', 'num'], [e.laps ?? '—', 'num'],
         [e.gap || '—', 'num'], [e.diff || '—', 'num'], [e.mph ?? '—', 'num']];
    cells.forEach(([v, c], i) => {
      const td = el('td', c, String(v));
      if (i === 2) td.innerHTML = enduroClassMark(ev, e.cls);
      if (i === 3) td.innerHTML = enduroCrew(e);
      // A car that gained places went forward; one that lost them went back.
      if (c && c.indexOf('gained') >= 0 && typeof e.gained === 'number' && e.gained) {
        td.textContent = (e.gained > 0 ? '+' : '') + e.gained;
        td.style.color = e.gained > 0 ? 'var(--s1)' : 'var(--alarm)';
      }
      tr.append(td);
    });
    body.append(tr);
  });
  tb.append(body); sc.append(tb);
  return sc;
}

function enduro() {
  const p = $('#p-enduro'); p.innerHTML = '';
  const evs = specials();
  if (!evs.length) {
    p.append(Object.assign(el('p', 'lede'), { textContent:
      'No endurance race is on this season’s calendar.' }));
    return;
  }
  evs.forEach(ev => p.append(enduroPanel(ev)));
}

function enduroPanel(ev) {
  const host = el('div');
  const h = el('div', 'racehead');
  h.innerHTML = `<h3>${esc(ev.name)}</h3>`
    + `<span class="f">${esc(ev.circuit || '')} · ${esc(ev.dates || '')}</span>`
    + (ev.start ? `<span class="f">${esc(ev.start)}–${esc(ev.finish || '')}</span>` : '')
    + (ev.weather ? `<span class="f">${esc(ev.weather)}</span>` : '')
    + (ev.laps ? `<span class="f"><b>${ev.laps}</b> laps${ev.miles ? ` / <b>${ev.miles}</b> miles` : ''}</span>` : '');
  host.append(h);

  const note = el('p', 'lede');
  note.innerHTML = esc(ev.blurb || '');
  host.append(note);

  // Said plainly and once, at the top: nothing on this page moves a
  // championship table, and somebody arriving from the standings should not
  // have to work that out from the absence of a points column.
  const flag = el('div', 'notes');
  flag.innerHTML = '<p><b>Not a championship round.</b> The '
    + `${esc(ev.full_name || ev.name)} is a standalone race, so no result here `
    + 'scores points and none of it appears in any championship table.</p>';
  host.append(flag);

  const stats = el('div');
  stats.innerHTML = enduroStats(ev);
  host.append(stats.firstChild);

  // Which of these cars belong to the championship being read. A series that
  // was not eligible is told so, rather than left to notice that none of the
  // rows are marked.
  if (D) {
    const ours = (ev.entries || []).filter(e => enduroSeriesOf(ev, e.cls) === D.key);
    const sub = el('p', 'sub');
    const names = (ev.classes || []).map(c => c.name);
    const list = names.length > 1
      ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
      : names.join('');
    sub.textContent = ours.length
      ? `${ours.length} of these ${(ev.entries || []).length} cars are ${D.short} `
        + 'cars, marked in the table below.'
      : `${D.short} cars were not eligible for this race — it is open to `
        + `${list} specifications.`;
    host.append(sub);
  }

  if (ev.entries && ev.entries.length) {
    const pods = el('div');
    pods.innerHTML = enduroPodiums(ev);
    if (pods.firstChild) host.append(pods.firstChild);

    host.append(Object.assign(el('h4', 'enduro-h'), { textContent: 'Classification' }));
    host.append(enduroTable(ev, ev.entries, 'race'));

    if (ev.fastest && ev.fastest.length) {
      const f = el('div', 'notes');
      f.innerHTML = '<p><b>Fastest lap in each class</b></p>' + ev.fastest.map(x =>
        `<p>${esc((ev.classes.find(c => c.marker === x.cls) || {}).name || x.cls)} — `
        + `<b>${esc(x.time)}</b> on lap ${x.lap}, ${esc(x.team)}`
        + (x.mph ? ` (${x.mph} mph)` : '') + '</p>').join('');
      host.append(f);
    }
    if (ev.red_flag) {
      const r = el('p', 'sub');
      r.textContent = `The race was red-flagged at ${ev.red_flag} and the `
        + 'classification taken from the order at that point.';
      host.append(r);
    }
    if (ev.notes && ev.notes.length) {
      const n = el('div', 'notes');
      n.innerHTML = '<p><b>Officials&rsquo; notes</b></p>'
        + ev.notes.map(x => `<p>${esc(x)}</p>`).join('');
      host.append(n);
    }
  } else {
    host.append(Object.assign(el('p', 'sub'), { textContent:
      'The race has not run yet — the classification appears here once it has.' }));
  }

  if (ev.qualifying && ev.qualifying.length) {
    const d = el('details', 'enduro-qual');
    const s = el('summary', null, 'Qualifying');
    d.append(s, enduroTable(ev, ev.qualifying, 'qual'));
    if (ev.qualifying_notes && ev.qualifying_notes.length) {
      const n = el('div', 'notes');
      n.innerHTML = '<p><b>Officials&rsquo; notes</b></p>'
        + ev.qualifying_notes.map(x => `<p>${esc(x)}</p>`).join('');
      d.append(n);
    }
    // The heroes qualify as a class of their own and then race folded back in
    // among the cars they share a specification with, which is why a driver's
    // place in class is not the same number on the two sheets.
    d.append(Object.assign(el('p', 'sub'), { textContent:
      'Qualifying counts the solo Hero entries as a class of their own; the '
      + 'classification folds them back in among the cars of their own '
      + 'specification, so a place in class differs between the two.' }));
    host.append(d);
  }

  const src = el('p', 'sub');
  src.innerHTML = 'Timing and classification: ' + esc(ev.source || '—')
    + (ev.url ? ` (<a href="${esc(ev.url)}">event page</a>)` : '')
    + '. Results are provisional until the conclusion of any judicial and '
    + 'technical matters.'
    // What the club published about the race beyond the sheets: their own
    // report of it, and the broadcast it was streamed on.
    + ((ev.links || []).length
      ? ' Also: ' + ev.links.map(l =>
        `<a href="${esc(l.url)}">${esc(l.name)}</a>`).join(', ') + '.' : '');
  host.append(src);
  return host;
}
/* ------------------------------------------------------------- socials */
/* Pictures of these cars, from the accounts that take them.
 *
 * Everywhere else this page holds its own data: the sheets are fetched, parsed
 * and committed, and what ships is one file that asks the network for nothing.
 * This tab cannot work that way and should not pretend to. A photograph on
 * Instagram belongs to whoever took it, so the post is linked and the
 * platform's own embed is mounted at it - the picture is served by Instagram,
 * to Instagram's terms, and nothing is copied into this repository.
 *
 * That costs a script from each platform, and those scripts are the one thing
 * on this page that can fail: an embed blocked by a tracker blocker, a post
 * taken down, a phone with no signal. So every card is written as a link that
 * says what the post is *before* the embed is asked for, and stays that link
 * if the embed never arrives. Nothing here is the only way to learn anything -
 * it is the paddock's photographs beside the timing sheets, and the tab is
 * legible with every picture missing.
 *
 * The embeds are mounted only when the tab is opened, and only once, so a
 * reader who never comes here never asks either platform for anything.
 */

const SOCIAL_SRC = {
  instagram: {
    name: 'Instagram',
    script: 'https://www.instagram.com/embed.js',
    at: h => `https://www.instagram.com/${h}/`,
  },
  x: {
    name: 'X',
    script: 'https://platform.twitter.com/widgets.js',
    at: h => `https://x.com/${h}`,
  },
};

/* Which platforms have had their script asked for. Asked for once each, on the
   first opening of this tab, and never again. */
const socialLoaded = {};
let socialsMounted = false;

function socialScript(kind) {
  const cfg = SOCIAL_SRC[kind];
  if (!cfg || socialLoaded[kind]) return;
  socialLoaded[kind] = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = cfg.script;
  // A blocked script is not an error worth showing: the card underneath it is
  // already the post, written out, with a link to it.
  s.onerror = () => { socialLoaded[kind] = 'failed'; };
  document.head.append(s);
}

/**
 * Is this account or post about the championship being read?
 *
 * Named series only. An entry that names none covers everything, which is not
 * the same as covering this one - marking those too would put a mark on almost
 * every card and leave it saying nothing.
 *
 * A post about a race that is a round of nothing belongs to whichever series
 * were eligible for it, which the race itself says.
 */
function socialMine(x) {
  if (!D) return false;
  if (x.special) {
    const ev = (SEASON.specials || []).find(e => e.key === x.special);
    return !!ev && (ev.classes || []).some(c => c.series === D.key);
  }
  return !!x.series && x.series.indexOf(D.key) >= 0;
}

/** The accounts, as a strip of links across the top. */
function socialAccounts(host, data) {
  const box = el('div', 'accounts');
  (data.accounts || []).forEach(a => {
    const cfg = SOCIAL_SRC[a.platform] || {};
    const a1 = el('a', 'account' + (socialMine(a) ? ' mine' : ''));
    a1.href = a.url;
    a1.rel = 'noopener';
    a1.target = '_blank';
    a1.innerHTML = `<span class="plat ${esc(a.platform)}">${esc(cfg.name || a.platform)}</span>`
      + `<b>@${esc(a.handle)}</b><span class="what">${esc(a.covers || '')}</span>`;
    box.append(a1);
  });
  host.append(box);
}

/**
 * One post: what it is, then the embed.
 *
 * The blockquote is what both platforms' scripts look for and replace with the
 * post itself. Written out longhand rather than with innerHTML on the embed
 * markup, because what is inside it is what a reader sees if the script never
 * runs, and that has to be a sentence and a link rather than an empty box.
 */
function socialCard(x) {
  const card = el('article', 'socialcard' + (socialMine(x) ? ' mine' : ''));
  const head = el('div', 'sc-head');
  head.innerHTML = `<span class="plat ${esc(x.platform)}">`
    + `${esc((SOCIAL_SRC[x.platform] || {}).name || x.platform)}</span>`
    + `<b>${esc(x.title || '')}</b>`
    + `<span class="who">@${esc(x.handle)}</span>`
    + (x.date ? `<span class="who">${esc(x.date)}</span>` : '');
  card.append(head);

  if (x.note) card.append(Object.assign(el('p', 'sc-note'), { textContent: x.note }));

  const holder = el('div', 'sc-embed');
  if (x.platform === 'instagram') {
    const q = el('blockquote', 'instagram-media');
    q.setAttribute('data-instgrm-permalink', x.url);
    q.setAttribute('data-instgrm-version', '14');
    const a = el('a', null, 'View this post on Instagram');
    a.href = x.url; a.rel = 'noopener'; a.target = '_blank';
    q.append(a);
    holder.append(q);
  } else {
    const q = el('blockquote', 'twitter-tweet');
    const a = el('a', null, 'View this post on X');
    a.href = x.url; a.rel = 'noopener'; a.target = '_blank';
    q.append(a);
    holder.append(q);
  }
  card.append(holder);
  return card;
}

function socials() {
  const p = $('#p-socials'); p.innerHTML = '';
  const data = ALL.socials;
  p.append(Object.assign(el('p', 'lede'), { textContent:
    'What the paddock and the circuits published. The pictures are served by '
    + 'Instagram and X from the posts themselves — nothing is copied here, so '
    + 'every one of these is somebody else’s photograph, shown the way they '
    + 'published it and credited to the account that posted it.' }));

  if (!data || (!(data.accounts || []).length && !(data.posts || []).length)) {
    p.append(Object.assign(el('p', 'sub'), { textContent:
      'No accounts or posts are recorded for this season yet.' }));
    return;
  }

  p.append(Object.assign(el('h4', 'enduro-h'), { textContent: 'Where to follow it' }));
  socialAccounts(p, data);

  const posts = data.posts || [];
  if (!posts.length) return;
  p.append(Object.assign(el('h4', 'enduro-h'), { textContent: 'Posts worth keeping' }));
  p.append(Object.assign(el('p', 'sub'), { textContent:
    'Both platforms put an account’s feed behind a login, so this is a list '
    + 'somebody kept rather than a feed being read — it does not update on its '
    + 'own. Posts about the championship being read are marked.' }));

  const grid = el('div', 'socialgrid');
  posts.forEach(x => grid.append(socialCard(x)));
  p.append(grid);
}

/**
 * Ask the platforms for their scripts, the first time this tab is opened.
 *
 * Not on load: a reader who never opens this tab has never asked Instagram or
 * X for anything, and that is worth keeping true. After the first mount the
 * scripts are already on the page, so a rebuild of the cards - which happens
 * on every change of series - only needs the platforms told to look again.
 */
function socialsShow() {
  const kinds = new Set(((ALL.socials || {}).posts || []).map(x => x.platform));
  kinds.forEach(socialScript);
  socialsMounted = true;
  socialsScan();
}

/** Tell whichever scripts have arrived to process the blockquotes now on the page. */
function socialsScan() {
  if (!socialsMounted) return;
  // Both are asynchronous and either may not be there yet; each re-scans the
  // document itself when it does arrive, so a miss here costs nothing.
  if (window.instgrm && instgrm.Embeds) instgrm.Embeds.process();
  if (window.twttr && twttr.widgets) twttr.widgets.load($('#p-socials'));
}
/* ---------------------------------------------------------- live view */
/**
 * The meeting, rather than the championship.
 *
 * Everything else on this page is a view of one championship: pick a series
 * across the top, then a page of it. A race day is not shaped like that. Five
 * championships race at Snetterton on the same Saturday off the same timing
 * feed and the same stream, and somebody at the circuit - or on the sofa -
 * wants to know what is on *now*, whoever's session it is, and then the next
 * thing. So Live is the last choice in the strip and is not a championship: it
 * is a list of meetings, the ones running today first and then the ones to
 * come, and the home of each is what a spectator wants of it in order - the
 * stream, if there is one; the day's timetable across every championship
 * racing there; and the timekeepers' screen for the session running, scored
 * for whichever championship's session it is.
 *
 * Nothing here is a second feed. The page can watch one meeting at a time
 * (`LIVE` is one socket, one snapshot), and the series it scores against is
 * the one whose session is out on the circuit: when qualifying for the 270R
 * ends and the Seven UK race begins, the view follows it, and the rest of the
 * page - the standings, the run-in - follows with it, exactly as though that
 * series' own Live tab had been opened. It is the same code drawing the same
 * table, in front of a different question.
 *
 * On a phone the strip is a pop-up list in one corner, so Live gets the other
 * corner: a button that is there from anywhere on the page, and that carries
 * the dot while a session is actually running.
 */
let MODE = 'series';        // 'series' - a championship and its tabs; 'live'
let LIVE_EVENT = null;      // the slug of the meeting on show, in live mode
let LIVE_REFOCUS = false;   // following the feed to another series, right now

const liveEventsEl = $('#liveEvents');
const liveFabEl = $('#liveFab');
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* Who times a meeting the page cannot watch, so the view can say so by name. */
const TIMEKEEPER_ALL = Object.assign({ alkamel: 'Alkamel Systems', smart: 'SMART Timing' },
                                     TIMEKEEPER);

/**
 * Every meeting of the season, once, whoever times it and however many
 * championships race at it.
 *
 * The calendars are per series, so the same weekend appears up to five times
 * over; what makes two of those entries one meeting is the feed that times it
 * - TSL's event number, or the three values ITS address a meeting by - and,
 * where nobody publishes a feed, the circuit and the day. Each meeting keeps
 * the championships racing at it, the club's page and everything that page
 * links, and a slug the address bar can carry: the circuit's key where that is
 * enough, with the month (and the day, where a circuit hosts two meetings in
 * one month) where it is not.
 */
function liveEvents(season = SEASON) {
  const today = isoDay(new Date());
  const groups = new Map();
  season.series.forEach(base => (base.events || []).forEach(e => {
    if (!e.first) return;                 // an archived season without its days
    const src = liveFeed(e);
    const feedKey = src === 'tsl' ? String(e.tslEvent)
      : src === 'its' ? `its:${e.its.cs}/${e.its.season}/${e.its.event_id}` : null;
    const id = feedKey || `${e.key}@${e.first}`;
    let g = groups.get(id);
    if (!g) {
      g = { id, feedKey, src, kind: e.kind || '', key: e.key, name: e.name,
            meeting: e.meeting || '', dates: e.dates || '', first: e.first,
            last: e.last || e.first, tz: e.tz || '', url: e.url || '',
            links: [], series: [] };
      groups.set(id, g);
    }
    g.series.push({ base, event: e });
    if (e.first < g.first) g.first = e.first;
    if ((e.last || e.first) > g.last) g.last = e.last || e.first;
    if (!g.url && e.url) g.url = e.url;
    (e.links || []).forEach(l => {
      if (!g.links.some(x => x.url === l.url)) g.links.push(l);
    });
  }));
  const list = [...groups.values()]
    .sort((a, b) => a.first.localeCompare(b.first) || a.name.localeCompare(b.name));
  list.forEach(g => {
    g.running = g.first <= today && today <= g.last;
    g.over = g.last < today;
  });
  const byKey = {};
  list.forEach(g => (byKey[g.key] = byKey[g.key] || []).push(g));
  Object.values(byKey).forEach(gs => {
    if (gs.length === 1) { gs[0].slug = gs[0].key; return; }
    const months = {};
    gs.forEach(g => { const m = g.first.slice(5, 7); months[m] = (months[m] || 0) + 1; });
    gs.forEach(g => {
      const m = g.first.slice(5, 7);
      g.slug = `${g.key}-${MONTHS[+m - 1]}${months[m] > 1 ? +g.first.slice(8, 10) : ''}`;
    });
  });
  return list;
}

/**
 * The meetings the second row offers: whatever is running today, then what is
 * still to come. A finished meeting is the Races page's business, so only when
 * the season has nothing left does the last one stand in, rather than an empty
 * row.
 */
function liveOnOffer(list) {
  const out = list.filter(g => g.running).concat(list.filter(g => !g.running && !g.over));
  if (out.length) return out;
  const past = list.filter(g => g.over);
  return past.length ? [past[past.length - 1]] : [];
}

/** "12–13 Sep", "18 Jul", "29 May – 1 Jun". */
function liveEventWhen(g) {
  const [, m1, d1] = g.first.split('-').map(Number);
  const [, m2, d2] = g.last.split('-').map(Number);
  if (g.first === g.last) return `${d1} ${MON_SHORT[m1 - 1]}`;
  if (m1 === m2) return `${d1}–${d2} ${MON_SHORT[m1 - 1]}`;
  return `${d1} ${MON_SHORT[m1 - 1]} – ${d2} ${MON_SHORT[m2 - 1]}`;
}

/** Is the feed showing a session of this meeting under way right now? */
const liveEventOn = g => !!(g.feedKey && LIVE.key === g.feedKey && liveOn()
  && LIVE.session && String(LIVE.session.flag || '').toLowerCase() !== 'finish');

/** The meeting the address names, or the first on offer. */
function liveEventNow() {
  const all = liveEvents();
  return all.find(g => g.slug === LIVE_EVENT) || liveOnOffer(all)[0] || null;
}

/**
 * Which championship the view scores against: the one whose session is out
 * there, if the feed is this meeting's and has named one; else the series being
 * read, if it races here; else the first that does.
 */
function liveEventFocus(ev) {
  const sess = LIVE.session;
  if (sess && ev.feedKey && LIVE.key === ev.feedKey) {
    const text = [sess.series, sess.name].filter(Boolean).join(' ');
    const hit = ev.series.find(s => sessionKind(s.base.tsl, text));
    if (hit) return hit.base;
  }
  const reading = D && ev.series.find(s => s.base.key === D.key);
  return (reading || ev.series[0]).base;
}

/* ------------------------------------------------------------- the row --- */

/** The second row: one button per meeting on offer. */
function liveEventsBar() {
  const list = liveOnOffer(liveEvents());
  const sig = list.map(g => `${g.slug}:${liveEventOn(g) ? 1 : 0}:${g.slug === LIVE_EVENT ? 1 : 0}`)
    .join('|');
  if (liveEventsEl.dataset.sig === sig) return;
  liveEventsEl.dataset.sig = sig;
  liveEventsEl.replaceChildren();
  list.forEach(g => {
    const b = el('button');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(g.slug === LIVE_EVENT));
    b.dataset.slug = g.slug;
    b.title = [g.meeting, g.dates, g.series.map(s => s.base.short).join(', ')]
      .filter(Boolean).join(' · ');
    b.innerHTML = `<span>${esc(g.name)}${liveEventOn(g) ? '<span class="livedot"></span>' : ''}</span>`
      + `<small>${g.running ? 'On today' : g.over ? 'Over' : esc(liveEventWhen(g))}</small>`;
    b.onclick = () => { showLive(g.slug); writeHash(); };
    liveEventsEl.append(b);
  });
}

/* ------------------------------------------------------------ the mode --- */

/** The page's furniture, for whichever of the two shapes it is in. */
function liveModeUi() {
  const live = MODE === 'live';
  tabsEl.hidden = live;
  liveEventsEl.hidden = !live;
  $('#p-liveevent').classList.toggle('on', live);
  TABS.forEach(([t]) => $('#p-' + t).classList.toggle('on', !live && t === currentTab));
  [...seriesBar.children].forEach(b => b.setAttribute('aria-pressed',
    String(b.dataset.key === 'live' ? live : !live && !!D && b.dataset.key === D.key)));
  liveFabEl.setAttribute('aria-pressed', String(live));
  radarShow(!live && currentTab === 'radar');
  // Only one of the two panels holds the running order at a time: the same
  // ids are inside it, and the clock is found by its id.
  const other = $(live ? '#p-live' : '#p-liveevent');
  if (other.innerHTML) { other.innerHTML = ''; delete other.dataset.shell; delete other.dataset.event; }
}

/** Into the live view, on one meeting - of another season, if `year` says so. */
function showLive(slug, year) {
  const season = (year != null && ALL.seasons.find(s => s.year === year)) || SEASON
    || ALL.seasons[0];
  const all = liveEvents(season);
  const reading = (D || {}).key || season.series[0].key;
  const ev = all.find(g => g.slug === slug)
    // No meeting named: the one running that the championship being read
    // races at, else whatever is first on offer.
    || all.find(g => g.running && g.series.some(s => s.base.key === reading))
    || liveOnOffer(all)[0] || null;
  const focus = ev ? liveEventFocus(ev) : null;
  // This view scores whatever is on for whichever championship's session it
  // is, and shows the others at the meeting their own order, so it wants
  // every championship racing here whole rather than just the one being read.
  // writeHash as well as the view itself: an address that named no meeting -
  // "#2026/live" - is normally tidied to the one shown by the writeHash that
  // follows the call, and that has already been and gone by the time this
  // comes back.
  // And dropped if the reader has chosen something else - another meeting, or
  // a championship - while the meeting's championships were coming.
  const nav = navigation();
  if (!seriesReady((ev ? ev.series.map(s => s.base) : []).concat(focus || []),
                   () => {
                     if (!stillWanted(nav)) return;
                     showLive(slug, year);
                     writeHash();
                   })) return;
  MODE = 'live';
  LIVE_EVENT = ev ? ev.slug : null;
  // The rest of the page follows: a race that is running belongs to the
  // standings and the run-in as much as to this view. The series is chosen
  // here and handed to the season, so that a link straight into the live view
  // draws the page once rather than once per guess.
  if (!SEASON || SEASON.year !== season.year) selectSeason(season.year, focus && focus.key);
  else if (focus && D.key !== focus.key) selectSeries(focus.key);
  else if (focus) liveEnter(focus);
  liveModeUi();
  liveEventsBar();
  if (!focus) liveDraw();
}

/** Back to a championship and its pages. */
function leaveLive() {
  if (MODE !== 'live') return;
  MODE = 'series';
  liveModeUi();
  showTab(currentTab);
}

liveFabEl.onclick = () => {
  if (MODE === 'live') leaveLive(); else showLive(LIVE_EVENT || '');
  writeHash();
};

/* ---------------------------------------------------------- the stream --- */

/** A YouTube video id out of any of the addresses the clubs write. */
const ytVideoId = url => {
  const m = /(?:[?&]v=|youtu\.be\/|\/live\/|\/embed\/)([\w-]{11})(?:[^\w-]|$)/.exec(url || '');
  return m ? m[1] : null;
};

/**
 * Where a meeting can be watched, in the order it is worth trying.
 *
 * A club's event page links the stream: sometimes a video with an id of its
 * own, one per day; sometimes just the channel's page, in which case the thing
 * to embed is that channel's live stream, which YouTube reach by the channel's
 * id (data/series.json knows the ids). Caterham stream their own meetings on
 * their own channel, so for a series they stream that channel is offered too.
 * A link that is neither - ITV, Spa's own player - is offered as a link: it
 * cannot be put in the page, and saying so beats a black box.
 */
function liveStreams(ev) {
  const streams = ALL.streams || {};
  const known = url => Object.keys(streams).find(k => String(url).indexOf(k) === 0);
  const tidy = s => String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  const out = [];
  const add = s => {
    if (!out.some(x => x.kind === s.kind && (x.id ? x.id === s.id : x.url === s.url))) out.push(s);
  };
  ev.links.filter(l => l.kind === 'video').forEach(l => {
    const id = ytVideoId(l.url);
    const ch = known(l.url);
    const m = /youtube\.com\/channel\/(UC[\w-]+)/.exec(l.url);
    if (id) add({ name: tidy(l.label), kind: 'video', id, url: l.url });
    else if (ch) add({ name: streams[ch].name, kind: 'channel', id: streams[ch].id, url: l.url });
    else if (m) add({ name: tidy(l.label), kind: 'channel', id: m[1], url: l.url });
    else {
      let host = '';
      try { host = new URL(l.url).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
      add({ name: host || tidy(l.label), kind: 'link', url: l.url });
    }
  });
  if (ev.series.some(s => s.base.streamed)) {
    Object.keys(streams).filter(k => streams[k].own).forEach(k =>
      add({ name: streams[k].name, kind: 'channel', id: streams[k].id, url: k + '/streams' }));
  }
  return out;
}

/** Which of them to start on: the day's own stream, where the club posts one a day. */
function liveStreamDefault(sources) {
  const day = WEEKDAYS[new Date().getDay()];
  const today = sources.findIndex(s => s.kind === 'video'
    && new RegExp(day, 'i').test(s.name));
  return today >= 0 ? today : 0;
}

const LIVE_STREAM = { slug: null, at: 0, playing: false };

/** The player, with the other streams as a row under it. */
function liveStreamBox(ev, sources) {
  if (!sources.length) {
    return '<p class="sub">No stream has been published for this meeting'
      + (ev.url ? ` — the <a href="${esc(ev.url)}" target="_blank" rel="noopener">club’s `
        + 'event page</a> is where one would appear.' : '.') + '</p>';
  }
  if (LIVE_STREAM.slug !== ev.slug) {
    LIVE_STREAM.slug = ev.slug; LIVE_STREAM.at = liveStreamDefault(sources);
    LIVE_STREAM.playing = false;
  }
  return '<div class="watch" id="leWatch"><h4>Live stream — <span class="src"></span></h4>'
    + '<div class="vid"></div>'
    + (sources.length > 1 ? '<div class="sources">' + sources.map((s, i) =>
        `<button type="button" data-i="${i}" aria-pressed="${i === LIVE_STREAM.at}">`
        + `${esc(s.name)}</button>`).join('') + '</div>' : '')
    + '<p class="sync">Nothing loads until it is played, and nothing here is lined up '
    + 'against it — that happens on the Races page once the broadcast has ended and '
    + 'carries a clock. <a class="yt" href="#" target="_blank" rel="noopener">Open on '
    + 'YouTube</a></p></div>';
}

/** Point the player at one of the sources; load it only if one was already playing. */
function liveStreamShow(box, sources, i, play) {
  const s = sources[i];
  if (!s) return;
  LIVE_STREAM.at = i;
  $('.src', box).textContent = s.name;
  [...box.querySelectorAll('.sources button')].forEach(b =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.i) === i)));
  const yt = $('.yt', box);
  yt.href = s.url;
  yt.textContent = s.kind === 'link' ? `Open ${s.name}` : 'Open on YouTube';
  const vid = $('.vid', box);
  if (s.kind === 'link') {
    LIVE_STREAM.playing = false;
    vid.innerHTML = `<a class="out" href="${esc(s.url)}" target="_blank" rel="noopener">`
      + `Watch on ${esc(s.name)} ↗<small>Their player cannot be put in this page, so `
      + 'this opens it on their site.</small></a>';
    return;
  }
  const src = s.kind === 'video'
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(s.id)}?autoplay=1&rel=0`
    : `https://www.youtube-nocookie.com/embed/live_stream?channel=${encodeURIComponent(s.id)}&autoplay=1`;
  const load = () => {
    LIVE_STREAM.playing = true;
    const frame = el('iframe');
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.title = s.name;
    frame.src = src;
    vid.replaceChildren(frame);
  };
  if (play && LIVE_STREAM.playing) { load(); return; }
  LIVE_STREAM.playing = false;
  vid.innerHTML = '<button type="button"><span class="yt">&#9654;</span>Play the stream'
    + `<small>${esc(s.name)}${s.kind === 'channel'
        ? ' — whatever the channel is broadcasting now' : ''}</small></button>`;
  $('button', vid).onclick = load;
}

/* ------------------------------------------------------- the timetable --- */

/**
 * The day, across every championship at the meeting.
 *
 * The calendar draws one series' sessions on that series' card; here the same
 * rows from every series are shuffled into one list in the order they run,
 * which is the order anybody at the circuit wants them in. Where the feed has
 * named the session running that row is marked from the feed, because a
 * timetable is a plan and a session that started twenty minutes late is still
 * the one that is on.
 */
function liveEventTimetable(ev, focus) {
  const now = Date.now();
  const rows = [];
  ev.series.forEach(({ base, event: e }) => {
    const t = (base.timings || {})[e.key] || { scheduled: [], actual: [] };
    meetingSessions(e, t).forEach(r => {
      const at = schedAt(r.s, e);
      const end = r.s && r.s.end ? schedAt({ day: r.s.day, start: r.s.end }, e)
        : at != null ? at + 20 * 60000 : null;
      rows.push(Object.assign(r, { base, e, at, end }));
    });
  });
  if (!rows.some(r => r.s)) {
    return '<p class="sub">No timetable has been published for this meeting yet'
      + (rows.length ? `: ${rows.map(r => `${r.base.short} ${r.name}`).join(', ')}`
        + ' are the sessions the regulations list for it.' : '.') + '</p>';
  }
  rows.sort((a, b) => (a.at == null) - (b.at == null) || (a.at - b.at)
    || a.base.short.localeCompare(b.base.short));

  // What the feed says is on, if it is this meeting's feed and one of ours.
  let onRow = null;
  const sess = LIVE.session;
  if (sess && ev.feedKey === LIVE.key && liveOn()
      && String(sess.flag || '').toLowerCase() !== 'finish') {
    const text = [sess.series, sess.name].filter(Boolean).join(' ');
    const hit = ev.series.find(s => sessionKind(s.base.tsl, text));
    if (hit) {
      const round = sess.type === 3 ? liveRoundOf(hit.base, hit.event, sess) : null;
      const want = round ? `Round ${round}` : sess.type === 2 ? 'Qualifying' : null;
      onRow = rows.find(r => r.base === hit.base && r.name === want) || null;
    }
  }
  let next = null;
  rows.forEach(r => { if (!onRow || r !== onRow) { if (r.at != null && r.at > now && (!next || r.at < next.at)) next = r; } });

  let html = '<div class="scroller"><table class="results ttab"><thead><tr>'
    + `<th class="num">${ev.tz ? esc(ev.tz) : 'Time'}</th><th>Session</th>`
    + '<th>Championship</th><th></th></tr></thead><tbody>';
  let day = null;
  rows.forEach(r => {
    const s = r.s;
    const d = s && s.day ? dayWord(s.day) : (s ? '' : 'Not timetabled');
    if (d !== day) {
      day = d;
      if (d) html += `<tr class="dayrow"><td colspan="4">${esc(d)}</td></tr>`;
    }
    let cls = '', st = '';
    if (onRow ? r === onRow : (r.at != null && r.end != null && r.at <= now && now <= r.end)) {
      cls = 'now';
      // Reachable from the keyboard, and read out in full: the tooltip is the
      // only place the marker says where it came from.
      const why = onRow && r === onRow
        ? 'The timing feed has named this session as the one running, whatever the timetable says'
        : 'Inside its timetabled slot; the feed has not named it yet';
      st = `<span tabindex="0" data-tip="${esc(why)}" aria-label="On now. ${esc(why)}">on now</span>`;
    } else if (r.a && r.a.start) {
      cls = 'done'; st = `ran ${r.a.start}`;
    } else if (r.end != null && now > r.end) {
      cls = 'done'; st = 'finished';
    } else if (next && r === next) {
      const secs = Math.round((r.at - now) / 1000);
      cls = 'next'; st = secs <= LIVE_CONNECT ? 'any minute' : `in ${liveCountText(secs)}`;
    }
    html += `<tr class="${cls}"><td class="num mono">${s ? esc(s.start) + (s.end ? '–' + esc(s.end) : '') : '—'}</td>`
      + `<td>${esc(r.name)}${s && s.activity && /race/i.test(s.activity) && !/^race$/i.test(s.activity)
          ? ` <small style="color:var(--ink-3)">${esc(s.activity)}</small>` : ''}</td>`
      + `<td${r.base === focus ? ' data-tip="The championship the running order below is scored for"' : ''}>`
      + `${r.base === focus ? `<b>${esc(r.base.short)}</b>` : esc(r.base.short)}</td>`
      + `<td class="st">${st}</td></tr>`;
  });
  html += '</tbody></table></div>';
  return html;
}

/* --------------------------------------------------------- the meeting --- */

/** Make or find a numbered part of the panel; rebuild it only when its signature changes. */
function livePart(host, id, sig, build) {
  const node = $('#' + id, host);
  if (node.dataset.sig === sig) return node;
  node.innerHTML = build();
  node.dataset.sig = sig;
  return node;
}

/** The head of the meeting: what it is, when, who races there, and the club's links. */
function liveEventHead(ev, focus) {
  const when = liveEventOn(ev)
    ? '<span class="when" data-tip="A session at this meeting is running now">Live</span>'
    : ev.running ? '<span class="when" data-tip="This meeting is running today">Today</span>'
    : ev.over ? '<span class="when future">Over</span>'
    : `<span class="when future">${esc(liveEventWhen(ev))}</span>`;
  const chips = ev.series.map(s =>
    `<a class="chip${s.base.key === focus.key ? ' on' : ''}" `
    + `href="#${SEASON.year}/${s.base.key}/live" data-tip="${esc(s.base.fullName)} — `
    + `its own Live tab, and the rest of its pages">${esc(s.base.short)}</a>`).join('');
  const timer = ev.feedKey ? `Timed by ${TIMEKEEPER_ALL[ev.src] || 'the timekeepers'}`
    : ev.kind === 'tsl' ? 'Timed by TSL — the feed opens once they have loaded the meeting'
    : `${TIMEKEEPER_ALL[ev.kind] || 'The timekeepers'} time this meeting and publish no feed`;
  let links = '';
  if (ev.url) links = eventLinks({ url: ev.url, links: ev.links, meeting: ev.meeting }).outerHTML;
  return `<div class="radarhead evhead"><div class="who"><span class="ev">`
    + `<span class="nm">${esc(ev.name)}</span>`
    + `<small>${esc([ev.meeting, ev.dates].filter(Boolean).join(' · '))} · ${esc(timer)}`
    + `<span class="evchips">${chips}</span></small></span>${when}</div></div>` + links;
}

/** What to say when there is nothing to time. */
function liveEventQuiet(ev, focus) {
  const now = Date.now();
  let first = null;
  ev.series.forEach(({ base, event: e }) => {
    const t = (base.timings || {})[e.key] || { scheduled: [], actual: [] };
    meetingSessions(e, t).forEach(r => {
      const at = schedAt(r.s, e);
      if (at != null && at > now && (!first || at < first.at)) first = { at, r, base };
    });
  });
  const soon = first
    ? ` First out is <b>${esc(first.base.short)} ${esc(first.r.name)}</b>, timetabled for `
      + `${esc(first.r.s.start)}` + (first.r.s.day ? ` on ${esc(dayWord(first.r.s.day))}` : '')
      + (ev.tz ? ` ${esc(ev.tz)}` : '')
      + ` — in ${liveCountText(Math.round((first.at - now) / 1000))}.`
    : '';
  if (ev.over) {
    return `<p class="lede">This meeting is over. What each race came to is on the Races `
      + `page of the championship it was a round of: ${ev.series.map(s =>
        `<a href="#${SEASON.year}/${s.base.key}/races">${esc(s.base.short)}</a>`).join(' · ')}.</p>`;
  }
  if (!ev.feedKey && ev.kind === 'tsl') {
    return `<p class="lede"><b>${esc(ev.name)}</b> ${ev.running ? 'is running today' : `runs ${esc(ev.dates)}`}. `
      + 'TSL time it, and this page will be able to watch it once they have loaded the '
      + 'meeting on their live timing site - usually the week before it runs - and the '
      + `number that addresses their feed is known.${soon}</p>`;
  }
  if (!ev.feedKey) {
    return `<p class="lede"><b>${esc(ev.name)}</b> ${ev.running ? 'is running today' : `runs ${esc(ev.dates)}`}, `
      + `and nobody publishes live timing for it: it is `
      + `${esc(TIMEKEEPER_ALL[ev.kind] || 'another timekeeper')}’s meeting, and their screen `
      + `cannot be read from here. Each classification appears on the Races page of its `
      + `championship as it is published.${soon}</p>`;
  }
  return `<p class="lede"><b>${esc(ev.name)}</b> runs ${esc(ev.dates)}, and this page can `
    + `watch it: ${esc(TIMEKEEPER_ALL[ev.src])}’s feed is opened five minutes before the `
    + `first session and every lap is scored under the regulations of whichever `
    + `championship is out.${soon}</p>`;
}

/**
 * The meeting's home, drawn on every tick of the feed.
 *
 * Five parts, each rebuilt only when what it says has changed: the head, the
 * stream (never on a tick - an iframe rebuilt is a stream stopped), the
 * timetable, the running order with everything that hangs off it, and the
 * tables that a qualifying session sets for the other championships sharing
 * it. Returns true when the feed has moved to another championship's session
 * and the page has been switched to it, which redraws everything.
 */
function liveEventDraw(base, v) {
  const p = $('#p-liveevent');
  const ev = liveEventNow();
  if (!ev) {
    if (p.dataset.event !== 'none') {
      p.innerHTML = `<p class="lede">Nothing on the ${SEASON.year} calendar can be watched: `
        + 'no meeting is running and none is still to come.</p>';
      p.dataset.event = 'none';
    }
    liveEventsBar();
    return false;
  }
  const focus = liveEventFocus(ev);
  if (focus.key !== base.key && !LIVE_REFOCUS) {
    LIVE_REFOCUS = true;
    try { selectSeries(focus.key); writeHash(); } finally { LIVE_REFOCUS = false; }
    return true;
  }
  if (p.dataset.event !== ev.slug) {
    // In the order a phone reads them, which is also the order a screen reader
    // does: the stream, the timing, then the plan for the day. The grid puts
    // the timetable beside the rest on a wide screen without moving it here.
    p.innerHTML = ['leHead', 'leStream', 'leLive', 'leExtra', 'leTimes']
      .map(id => `<div id="${id}"></div>`).join('');
    p.dataset.event = ev.slug;
    LIVE_STREAM.slug = null;
  }
  const sess = LIVE.session;
  const here = ev.series.find(s => s.base === focus);
  // Whether the running order on the feed is this meeting's - a demonstration
  // counts, run against the series' meeting - and so worth drawing at all.
  const meetOf = liveMeeting(focus);
  const watching = LIVE_FAKE ? !!(meetOf.event && here && meetOf.event.key === here.event.key)
    : !!(ev.feedKey && LIVE.key === ev.feedKey);
  const minute = Math.floor(Date.now() / 60000);

  livePart(p, 'leHead', [ev.slug, focus.key, liveEventOn(ev), ev.running].join('|'),
           () => liveEventHead(ev, focus));

  const sources = liveStreams(ev);
  const box = livePart(p, 'leStream', [ev.slug, ...sources.map(s => s.kind + ':' + (s.id || s.url))].join('|'),
                       () => liveStreamBox(ev, sources));
  const watch = $('#leWatch', box);
  if (watch && !watch.dataset.wired) {
    watch.dataset.wired = '1';
    [...watch.querySelectorAll('.sources button')].forEach(b => {
      b.onclick = () => liveStreamShow(watch, sources, Number(b.dataset.i), true);
    });
    liveStreamShow(watch, sources, LIVE_STREAM.at, false);
  }

  livePart(p, 'leTimes', [ev.slug, focus.key, minute, sess && sess.id, sess && sess.type,
                          sess && sess.name, sess && sess.flag, LIVE.status].join('|'),
           () => '<h2>Timetable</h2>' + liveEventTimetable(ev, focus));

  const host = $('#leLive', p);
  if (watching) {
    if (host.dataset.sig) { delete host.dataset.sig; host.innerHTML = ''; delete host.dataset.shell; }
    livePanel(base, v, host);
  } else {
    if (host.dataset.shell) { delete host.dataset.shell; host.innerHTML = ''; }
    livePart(p, 'leLive', [ev.slug, focus.key, minute, ev.over, ev.running].join('|'),
             () => liveEventQuiet(ev, focus));
  }

  liveEventExtra(p, ev, focus, v, watching);
  liveEventsBar();
  return false;
}

/**
 * Under the running order: what a session means to the championships that are
 * not the one being scored.
 *
 * A qualifying session is a sheet each championship lays its grid out from,
 * and where two share one - the Graduates' classes at Dijon - the same running
 * order is a different provisional grid for each, so each gets its table. A
 * session that is nobody's - a support race on the same feed - is still what is
 * on, and is shown as the running order it is, scored for nobody.
 */
function liveEventExtra(p, ev, focus, v, watching) {
  const node = $('#leExtra', p);
  const sess = LIVE.session;
  const text = sess ? [sess.series, sess.name].filter(Boolean).join(' ') : '';
  const others = watching && sess && sess.type === 2 && v.kind
    ? ev.series.filter(s => s.base !== focus && sessionKind(s.base.tsl, text)) : [];
  const sheets = watching && sess && sess.type === 2 && v.kind
    ? [focus].concat(others.map(s => s.base)).map(b => {
        const e = ev.series.find(s => s.base === b).event;
        const q = (b.qualifying || []).find(x => x.event === e.key && !x.demo);
        return q ? { base: b, q } : null;
      }).filter(Boolean) : [];
  const foreign = watching && sess && !v.kind && LIVE.cars.size > 0;
  const made = others.map(s => {
    const ov = liveView(s.base);
    return { key: s.base.key, short: s.base.short, tab: liveTable(s.base, ov, null, 'leq-' + s.base.key) };
  });
  let all = null;
  if (foreign) {
    const rows = [...LIVE.cars.values()].sort((a, b) => (a.pos == null) - (b.pos == null)
      || (a.pos - b.pos) || String(a.no).localeCompare(String(b.no)));
    all = liveTable(focus, { rows, session: sess, scored: null, foreign: true }, null, 'leAll');
  }
  const sig = [ev.slug, sess && sess.id, sess && sess.type, !!v.kind, foreign,
               made.map(m => m.key + ':' + m.tab.cols).join(','),
               sheets.map(s => s.base.key).join(','), all && all.cols].join('|');
  if (node.dataset.sig === sig) {
    made.forEach(m => liveRows2(node, '#leq-' + m.key, m.tab));
    if (all) liveRows2(node, '#leAll', all);
    return;
  }
  node.dataset.sig = sig;
  node.innerHTML = '';
  if (foreign) {
    node.innerHTML = `<h2>${esc(sess.name || sess.typeName)} — running order</h2>`
      + `<p class="sub">${esc(timerName())} are timing <b>${esc(sess.series || 'another championship')}</b> `
      + 'at this meeting right now. None of these cars are in a championship on this page, so '
      + 'nothing is scored; the next session of one that is will take this table over as it starts.</p>'
      + all.html;
  }
  made.forEach(m => {
    const d = el('div', 'leq');
    d.innerHTML = `<h2>${esc(m.short)} — provisional grid</h2>`
      + '<p class="sub" style="margin-top:0">The same session, read for this championship: '
      + 'the order its cars are in is the grid its first race is laid out from.</p>' + m.tab.html;
    node.append(d);
  });
  sheets.forEach(({ base: b, q }) => {
    const d = el('div', 'leq');
    d.innerHTML = `<h2>${esc(b.short)} — as published</h2>`
      + `<p class="sub" style="margin-top:0">${esc(timerName())}’s classification of this session, `
      + `read by the build${q.start ? ` — ran ${esc(q.start)}${q.finish ? '–' + esc(q.finish) : ''}` : ''}. `
      + `The <a href="#${SEASON.year}/${b.key}/qualifying">Qualifying</a> page has it lap by lap.</p>`;
    d.append(qualTable(q, [], null, null, b));
    node.append(d);
  });
  linkRegs(node);
}

/** The dot on the strip's Live button and on the corner button. */
function liveMarks() {
  const on = liveOn() && LIVE.session
    && String(LIVE.session.flag || '').toLowerCase() !== 'finish';
  const dot = on ? '<span class="livedot"></span>' : '';
  const b = seriesBar.querySelector('button.live');
  if (b) b.innerHTML = 'Live' + dot;
  liveFabEl.innerHTML = 'Live' + dot;
}

/* A countdown and a timetable move with the clock, feed or no feed. */
setInterval(() => { if (MODE === 'live') liveDraw(); }, 60000);
/* ---------------------------------------------------------- table height */
/* A table twenty rows deep can be read; one sixty rows deep is read by
   scrolling the page through it, which takes the head that says what the
   columns are off the top. So the box holds twenty rows and scrolls the rest
   inside itself, and the head stays at the top of the box.
   Never taller than the window, either: a head at the top of a box that
   begins above the top of the screen is a head nobody can see. */
const ROWS_SHOWN = 20;
const ROWS_LEAST = 8;

function capTable(sc) {
  const tb = sc.querySelector('table');
  // A table on a tab that is not being shown measures nothing at all, so it is
  // left alone and capped when that tab is shown.
  if (!tb || !sc.offsetParent) return;
  const high = n => n.getBoundingClientRect().height;
  // Where the second head row stops: under the first, whatever height that
  // came out as, rather than at a figure that is only right on a wide screen.
  const band = $('thead tr.band', tb);
  if (band) tb.style.setProperty('--cols-top', Math.round(high(band)) + 'px');

  const rows = [...tb.tBodies].flatMap(b => [...b.rows]);
  if (rows.length <= ROWS_SHOWN) { sc.style.maxHeight = ''; return; }
  const head = tb.tHead ? high(tb.tHead) : 0;
  const deep = n => head + rows.slice(0, n).reduce((a, r) => a + high(r), 0);
  const room = innerHeight - topbarH() - 24;
  sc.style.maxHeight = Math.round(Math.max(
    Math.min(deep(ROWS_SHOWN), room), deep(Math.min(ROWS_LEAST, rows.length)))) + 'px';
}

/* Every table on the page is built from script, and some are built again every
   few seconds while a race is running, so the cap follows the tables rather
   than being remembered at each of the dozen places one is made. */
function capTables() { [...document.querySelectorAll('.scroller')].forEach(capTable); }

let capQueued = false;
function capSoon() {
  if (capQueued) return;
  capQueued = true;
  // Just before a paint, where measuring costs least - unless the page is not
  // being painted at all, in a tab left in the background, where waiting for a
  // frame means waiting until somebody looks at it.
  const soon = document.hidden ? f => setTimeout(f, 0) : f => requestAnimationFrame(f);
  soon(() => { capQueued = false; capTables(); });
}

new MutationObserver(capSoon).observe($('main'), { childList: true, subtree: true });
// A window that changes shape changes both how deep a row is and how much room
// there is for rows.
addEventListener('resize', capSoon);

/** Rebuild the series being shown, and every tab that depends on the points. */
function liveRefresh() {
  const base = SEASON.series.find(s => s.key === (D || {}).key);
  if (!base) return;
  D = liveDress(base);
  runSet = new Set(D.roundsRun);
  scoring = D.table.filter(t => t.registered);
  REMAINING = D.roundsTotal - D.roundsRun.length;
  about();                     // where the championship stands has moved
  // Only what is being looked at. The others are marked and rebuilt when they
  // are next shown, which saves the work and, more to the point, stops a table
  // being pulled out from under somebody who is reading it on another tab.
  liveStale('standings'); liveStale('runin');
  liveDraw();
}

/** Seed the feed with the snapshot baked into the page, once per meeting. */
function liveAdopt(seed) {
  if (!seed || !seed.session || LIVE.session) return;
  LIVE.session = seed.session;
  LIVE.cars = new Map((seed.session.competitors || []).map(c => [c.id, c]));
  LIVE.seededAt = (SEASON.live || {}).fetched;
  LIVE.status = LIVE.ws ? LIVE.status : 'seed';
  // Held so that a session which has since moved on can be recognised.
  LIVE.fromSeed = true;
  LIVE.seedIds = new Set(LIVE.cars.keys());
  // The snapshot carries the session's best in each sector. Without them the
  // first split to arrive is the best this page has seen and goes purple, and a
  // previous session's bests would sit there suppressing real ones.
  LIVE.sectorBest = {};
  liveSectorBests(seed.session);
  LIVE.unknown = null;
  LIVE.ended = !!seed.ended;
  liveSetClock(seed.session.clock);
}

/** Point the live view at the meeting the series on show is racing at. */
function liveSwitch(base) {
  const meet = liveMeeting(base);
  if (meet.key !== LIVE.key) {
    liveStop();
    LIVE.key = meet.key; LIVE.src = meet.src; LIVE.id = meet.id;
    LIVE.itsCfg = meet.its || null;
    // Which session numbers at this ITS meeting are this grid's, as far as the
    // seed knows. The feed's own look-ahead finds the rest.
    LIVE.itsSeed = (meet.seed && meet.seed.session && meet.src === 'its')
      ? [meet.seed.session.id] : [];
    LIVE.session = null; LIVE.cars = new Map();
    LIVE.rc = []; LIVE.seededAt = null; LIVE.sig = null; LIVE.view = null;
    LIVE.declined = false;      // a different meeting is a fresh decision
  }
  liveAdopt(meet.seed);
  // A simulation races one championship: asked for another, it races that one
  // rather than leaving this series watching somebody else's session.
  if (LIVE_DEMO !== null && LIVE.wanted && SIM.key !== base.key) {
    LIVE.cars.clear(); LIVE.rc = []; LIVE.sig = null;
    liveStart();
  }
}

/** Opening the tab on a day there is a meeting is asking to watch it. */
function liveEnter(base) {
  base = base || SEASON.series.find(s => s.key === (D || {}).key);
  if (!base) return;
  const meet = liveMeeting(base);
  // Opening this tab while a session is close is asking to watch it - unless
  // the answer last time was to stop, which stands until it is asked again.
  // Asking for a simulation is asking for it to run, whatever day it is.
  //
  // Close means within five minutes of the timetable, or a session already
  // under way. Where no timetable has been published there is nothing to be
  // close to, and a meeting running today is reason enough on its own.
  const soon = liveNext(base, meet);
  const under = !!(meet.seed && meet.seed.session && !meet.seed.ended);
  const wants = LIVE_DEMO !== null
    || (meet.running && meet.key && (under || !soon || soon.secs <= LIVE_CONNECT));
  if (wants && !LIVE.wanted && !LIVE.declined && LIVE.status !== 'error') liveStart();
  liveDraw();
}

/* The clock is the one thing that changes with no message behind it. */
setInterval(() => {
  const c = $('#liveClock');
  if (!c) return;
  // Counting down to a session that has not started. Five minutes out the feed
  // is opened, so that the first lap of it arrives on a page already listening.
  if (LIVE.startsAt != null && !LIVE.session) {
    const secs = Math.round((LIVE.startsAt - Date.now()) / 1000);
    c.textContent = liveCountText(secs);
    if (secs <= LIVE_CONNECT && LIVE.key && !LIVE.wanted && !LIVE.declined
        && LIVE.status !== 'error' && !LIVE_FAKE) {
      liveStart();
      liveDraw();
    }
    return;
  }
  if (LIVE.clockSecs == null) return;
  c.textContent = liveClockNow() || '—';
  // A flag can change between draws, and the clock is now how it is shown.
  const want = 'clock ' + liveFlagClass((LIVE.session || {}).flag);
  if (c.className.trim() !== want.trim()) {
    c.className = want;
    c.setAttribute('data-tip', liveFlagSays((LIVE.session || {}).flag));
  }
}, 1000);

function selectSeries(key) {
  const base = SEASON.series.find(s => s.key === key) || SEASON.series[0];
  // Its races, its qualifying and its table may still be on their way: come
  // back to this when they land, leaving whatever is on screen up until then -
  // unless something else has been chosen since, in which case this is a
  // championship the reader has already moved on from.
  const nav = navigation();
  if (!seriesReady([base],
                   () => { if (stillWanted(nav)) selectSeries(key); })) return;
  // A meeting that is running is watched per series: switching to one racing at
  // the same meeting keeps the socket, switching away from it drops it.
  liveSwitch(base);
  D = liveDress(base);
  runSet = new Set(D.roundsRun);
  scoring = D.table.filter(t => t.registered);
  eventOf = {}; D.events.forEach(e => e.rounds.forEach(r => eventOf[r] = e));
  raceOf = {}; D.races.forEach(r => raceOf[r.round] = r);
  REMAINING = D.roundsTotal - D.roundsRun.length;
  [...seriesBar.children].forEach(b =>
    b.setAttribute('aria-pressed', MODE !== 'live' && b.dataset.key === D.key));
  $('#seriesFabNow').textContent = base.short;
  about(); standings(); races(); qualifying(); enduro(); runin(); calendar();
  radar(); rules(); socials(); faq();
  // The cards were rebuilt with the series, so the embeds in them are
  // blockquotes again until the platforms are told to look.
  socialsScan();
  // Not liveDraw: a race that is running belongs to the standings and the title
  // run-in as much as to the Live tab, so the feed is opened for the series
  // being shown whatever tab that series is being looked at on.
  liveEnter();
  showTab(currentTab);
  hideTip();
}

const seriesBar = $('#seriesBar');
const seriesFab = $('#seriesFab');

/* The menus hold the top of the window, so everything else that stops on
   scroll - the table heads - has to stop underneath them. Their height is not
   a constant: the tabs wrap on a narrow window, and the season row appears
   only once there is a second season, so it is measured rather than assumed. */
const topbar = $('#topbar');
const topbarH = () => topbar.getBoundingClientRect().height;
const measureTopbar = () => document.documentElement.style.setProperty(
  '--topbar-h', topbarH() + 'px');
measureTopbar();
if (window.ResizeObserver) new ResizeObserver(measureTopbar).observe(topbar);
else addEventListener('resize', measureTopbar);

/* The corner button, on a phone. It says which championship is being read as
   well as opening the list, because on a page with the strip out of sight that
   is the only thing left saying so. */
function seriesPick(open) {
  const want = open === undefined ? !seriesBar.classList.contains('open') : open;
  seriesBar.classList.toggle('open', want);
  seriesFab.setAttribute('aria-expanded', String(want));
  if (want) {
    const on = seriesBar.querySelector('[aria-pressed="true"]');
    if (on) on.focus();
  }
}

seriesFab.onclick = e => { e.stopPropagation(); seriesPick(); };
// Anywhere else is a way out of it, and so is Escape.
document.addEventListener('click', e => {
  if (seriesBar.classList.contains('open') && !seriesBar.contains(e.target)) {
    seriesPick(false);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && seriesBar.classList.contains('open')) {
    seriesPick(false);
    seriesFab.focus();
  }
});

/* The series on offer change with the season, so the bar is rebuilt rather
   than filtered - a series that ran in one year need not exist in another. */
function buildSeriesBar() {
  seriesBar.replaceChildren();
  SEASON.series.forEach(s => {
    const b = el('button', null, s.short);
    b.dataset.key = s.key;
    b.title = s.fullName;
    b.onclick = () => { leaveLive(); selectSeries(s.key); writeHash(); seriesPick(false); };
    seriesBar.append(b);
  });
  // And the one choice that is not a championship: the meeting, whatever is
  // on at it. Last, and set apart, because it is a different kind of thing.
  const live = el('button', 'live', 'Live');
  live.dataset.key = 'live';
  live.title = 'What is on right now: every meeting running or still to come, with '
    + 'the stream, the timetable and the timing of the session out on the circuit';
  live.setAttribute('aria-pressed', String(MODE === 'live'));
  live.onclick = () => { showLive(LIVE_EVENT || ''); writeHash(); seriesPick(false); };
  seriesBar.append(live);
}

/* -------------------------------------------------------------- year bar */
/* One season is the normal case and needs no chooser, so the bar only appears
   once there is a second year to choose between. */
const yearBar = $('#yearBar');

function selectSeason(year, keepSeries) {
  SEASON = ALL.seasons.find(s => s.year === year) || ALL.seasons[0];
  [...yearBar.children].forEach(b =>
    b.setAttribute('aria-pressed', Number(b.dataset.year) === SEASON.year));
  // every place the page names the season, so an archived year never shows
  // the live season's figures or links
  const label = $('#seasonLabel');
  if (label) label.textContent = SEASON.year;
  $('#footerSeason').textContent = SEASON.year;
  buildSeriesBar();
  // hold the same series across a year change when that year also ran it
  const want = keepSeries && SEASON.series.some(s => s.key === keepSeries)
    ? keepSeries : SEASON.series[0].key;
  selectSeries(want);
}

if (ALL.seasons.length > 1) {
  yearBar.hidden = false;
  ALL.seasons.forEach(s => {
    const b = el('button', null, String(s.year));
    b.dataset.year = s.year;
    b.title = `${s.year} season`;
    b.onclick = () => {
      selectSeason(s.year, D && D.key);
      // A different year has different meetings; the live view starts again
      // from whatever that year has to watch.
      if (MODE === 'live') showLive('');
      writeHash();
    };
    yearBar.append(b);
  });
}

/* --------------------------------------------------------------- routing */
/* The address bar carries "#<year>/<series>/<tab>", so a season, a series
   within it, and a tab within that can all be linked to, bookmarked and
   walked with the browser's back button. The year leads because it is the
   outermost thing being chosen.

   The live view is "#<year>/live/<meeting>" - the meeting in the place a
   series would be, because it is chosen instead of one. Only with the year in
   front: a bare "#live" is an older link to a series' own Live tab.

   Links written before the year existed - "#<series>" or "#<series>/<tab>" -
   still resolve, against the current season. */
let currentTab = TABS[0][0];

function writeHash() {
  // Nothing has been drawn yet: a championship's file is still on its way, and
  // whatever asked for it writes the address when it lands and the page draws.
  if (!SEASON || (MODE !== 'live' && !D)) return;
  const parts = [SEASON.year];
  if (MODE === 'live') {
    parts.push('live');
    if (LIVE_EVENT) parts.push(LIVE_EVENT);
  } else {
    parts.push(D.key);
    if (currentTab !== TABS[0][0]) parts.push(currentTab);
  }
  const want = parts.join('/');
  if (location.hash.slice(1) !== want) location.hash = want;
}

function readHash() {
  const parts = decodeURIComponent(location.hash.slice(1)).split('/').filter(Boolean);

  // A leading four-digit part is a year. An unknown one falls back to the
  // current season rather than showing nothing.
  let year = ALL.season, dated = false;
  if (parts.length && /^\d{4}$/.test(parts[0])) {
    const asked = Number(parts.shift());
    if (ALL.seasons.some(s => s.year === asked)) year = asked;
    dated = true;
  }
  const season = ALL.seasons.find(s => s.year === year) || ALL.seasons[0];

  const [rawSeries, rawTab] = parts;
  if (dated && rawSeries === 'live') {
    return { year: season.year, key: (D || {}).key || season.series[0].key,
             tab: TABS[0][0], live: rawTab || '' };
  }
  const found = season.series.find(s => s.key === rawSeries)
    // tolerate a display name or an old tab-only link
    || season.series.find(s => s.short.toLowerCase() === (rawSeries || '').toLowerCase());
  const tab = TABS.some(([t]) => t === rawTab) ? rawTab
    : (TABS.some(([t]) => t === rawSeries) ? rawSeries : TABS[0][0]);
  return { year: season.year, key: found ? found.key : season.series[0].key, tab, live: null };
}

function applyHash() {
  const { year, key, tab, live } = readHash();
  if (live != null) { showLive(live, year); return; }
  if (MODE === 'live') leaveLive();
  // selectSeason picks the series too, so only one of these should run
  if (!SEASON || SEASON.year !== year) selectSeason(year, key);
  else if (!D || D.key !== key) selectSeries(key);
  currentTab = tab;
  showTab(tab);
}

addEventListener('hashchange', applyHash);
colApply();                      // whatever columns this browser was left on
applyHash();
writeHash();
