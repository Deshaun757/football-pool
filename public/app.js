const $ = (selector) => document.querySelector(selector);
function removeInviteCodeFromUrl() {
  if (!window.history?.replaceState) return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^(inviteCode|invite_code|code)$/i.test(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (url.pathname !== '/reset-password' && /(?:^|[?#&])(inviteCode|invite_code|code)=/i.test(url.hash)) {
    url.hash = '';
    changed = true;
  }
  if (changed) {
    history.replaceState(null, document.title, url.pathname + url.search + url.hash);
  }
}
removeInviteCodeFromUrl();
let me = null,
  registerMode = false,
  currentWeek = null;
let forgotMode = false;
let resetToken = location.pathname === '/reset-password' ? new URLSearchParams(location.hash.slice(1)).get('token') : null;
let boardRefreshTimer = null;
let activeGroup = null;
let groups = [];
const needsPickReview = () => !!activeGroup?.requirePickApproval && activeGroup?.role !== 'commissioner';
const canReview = () => !!activeGroup && (activeGroup.role === 'commissioner' || me?.role === 'admin');
const maxEntriesForActiveGroup = () => Number(activeGroup?.maxEntriesPerMember ?? (activeGroup?.allowMultipleEntries ? 10 : 1));
let weeksData = [];
let myEntriesData = [];
let activeView = "home";
let weekReturnView = "place-picks";
let pendingReviewHighlightEntryId = null;
let settingsMessageTimer = null;
const esc = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );
const reservedNames = new Set([
  "admin",
  "administrator",
  "commissioner",
  "commish",
  "huddle pickem",
  "huddlepickem",
  "huddle pick em",
  "huddle",
  "support",
]);
function cleanName(value) {
  return value.trim().replace(/\s+/g, " ");
}
function validateName(value, label, minimum, maximum) {
  const name = cleanName(value);
  if (name.length < minimum) throw new Error(`${label} must be at least ${minimum} characters.`);
  if (name.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  if (!/^[A-Za-z0-9 .&'-]+$/.test(name)) throw new Error(`${label} can only use letters, numbers, spaces, apostrophes, hyphens, periods, and ampersands.`);
  if (/[.@][^\s]*\.[^\s]+/.test(name) || /(?:https?:\/\/|www\.)/i.test(name)) throw new Error(`${label} cannot be an email address or website.`);
  if (/^[a-f0-9]{24,}$/i.test(name)) throw new Error(`${label} cannot look like an invite code.`);
  if (reservedNames.has(name.toLowerCase().replace(/\s+/g, " "))) throw new Error(`${label} is reserved. Please choose another name.`);
  return name;
}
function showSettingsMessage(message, autoClear = false) {
  $('#settings-message').textContent = message;
  if (settingsMessageTimer) clearTimeout(settingsMessageTimer);
  settingsMessageTimer = null;
  if (autoClear) {
    settingsMessageTimer = setTimeout(() => {
      $('#settings-message').textContent = '';
      settingsMessageTimer = null;
    }, 5000);
  }
}
function updateReviewMessageCount() {
  const value = $('#group-settings-form').elements.reviewSubmissionMessage.value;
  $('#review-message-count').textContent = `${value.length} / 500`;
}

async function api(path, options = {}) {
  if (/^\/api\/(weeks|entries|my-entries|picks-board|reviews|notifications)(\/|$)/.test(path)) {
    if (!activeGroup) throw new Error('Choose or join a group first');
    path = '/api/groups/' + activeGroup.id + path.slice(4);
  }
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.details?.map(issue => issue.message).join(". ") || data.error || "Something went wrong");
  return data;
}
const date = (value) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const easternDateKey = (value) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const easternDay = (value) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(new Date(value));
const easternDate = (value) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
const easternTime = (value) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

async function boot() {
  if (location.pathname === "/reset-password") {
    configureAuth();
    $("#auth").hidden = false;
    return;
  }
  try {
    me = await api("/api/auth/me");
    if (me) await showDashboard();
    else $("#auth").hidden = false;
  } catch (error) {
    $("#auth").hidden = false;
    $("#auth-error").textContent = error.message;
  }
}

function configureAuth() {
  $('#terms-label').hidden = !registerMode;
  $('#accept-terms').required = registerMode;
  $('#auth-form').classList.toggle('register-mode', registerMode);
  const resetting = location.pathname === '/reset-password';
  const newPassword = registerMode || resetting;
  $('#name-label').hidden = !registerMode;
  $('#display-name').required = registerMode;
  $('#email').closest('label').hidden = resetting;
  $('#email').required = !resetting;
  $('#password').closest('label').hidden = forgotMode;
  $('#password').required = !forgotMode;
  $('#password').maxLength = newPassword ? 128 : 200;
  $('#password').autocomplete = newPassword ? 'new-password' : 'current-password';
  $('#confirm-password-label').hidden = !newPassword;
  $('#confirm-password').required = newPassword;
  $('#password-help').hidden = !newPassword;
  $('#forgot-password').hidden = forgotMode || newPassword;
  $('#auth-title').textContent = resetting ? 'Reset your password' : forgotMode ? 'Forgot your password?' : registerMode ? 'Join the pool' : 'Welcome back';
  $('#auth-toggle').textContent = forgotMode || resetting || registerMode ? 'Back to sign in' : 'Need an account? Register';
  $('#auth-form button[type=submit]').textContent = resetting ? 'Reset password' : forgotMode ? 'Send reset link' : 'Continue';
}
$('#forgot-password').onclick = () => { forgotMode = true; registerMode = false; $('#auth-error').textContent = ''; configureAuth(); };
$('#auth-toggle').onclick = () => {
  if (forgotMode || location.pathname === '/reset-password') {
    forgotMode = false; registerMode = false; resetToken = null; history.replaceState(null,'','/');
  } else registerMode = !registerMode;
  $('#auth-error').textContent = ''; configureAuth();
};
$('#auth-form').onsubmit = async event => {
  event.preventDefault();
  const button = event.target.querySelector('button[type=submit]');
  button.disabled = true;
  $('#auth-error').textContent = '';
  try {
    const body = {email:$('#email').value,password:$('#password').value};
    if (forgotMode) {
      const result = await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:body.email})});
      $('#auth-error').textContent = result.message;
      return;
    }
    const resetting = location.pathname === '/reset-password';
    if (registerMode || resetting) {
      body.confirmPassword = $('#confirm-password').value;
      if (body.password !== body.confirmPassword) throw new Error('Passwords do not match');
      if (body.password.length < 10 || body.password.length > 128 || !/[a-z]/.test(body.password) || !/[A-Z]/.test(body.password) || !/[0-9]/.test(body.password) || !/[^a-zA-Z0-9\s]/.test(body.password)) throw new Error('Use 10�128 characters with uppercase, lowercase, a number, and a special character.');
    }
    if (resetting) {
      if (!resetToken) throw new Error('This reset link is invalid. Request a new one.');
      const result = await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({...body,token:resetToken})});
      resetToken = null; history.replaceState(null,'','/');
      $('#password').value = ''; $('#confirm-password').value = '';
      configureAuth(); $('#auth-error').textContent = result.message;
      return;
    }
    if (registerMode) {
      body.displayName = validateName($('#display-name').value, 'Display name', 2, 40);
      body.acceptTerms = $('#accept-terms').checked;
    }
    me = await api('/api/auth/' + (registerMode ? 'register' : 'login'),{method:'POST',body:JSON.stringify(body)});
    await showDashboard();
  } catch(error) { $('#auth-error').textContent = error.message; }
  finally { button.disabled = false; }
};

async function showDashboard() {
  document.body.classList.add('signed-in');
  $("#auth").hidden = true;
  $("#dashboard").hidden = false;
  $("#nav").innerHTML = `<span>${esc(me.displayName)}</span>`;
  $("#menu-toggle").hidden = false;
  $("#admin-menu-item").hidden = me.role !== "admin";
  setupNavigation();
  renderAccount();
  await loadGroups();
  if (activeGroup) await Promise.all([loadWeeks(), loadPicksBoard(), loadNotifications()]);
  if (!boardRefreshTimer)
    boardRefreshTimer = setInterval(() => {
      if (!activeGroup) return;
      if (activeView === "place-picks" && $("#week-detail").hidden) loadWeeks().catch(error=>{ $("#weeks").textContent=error.message; });
      Promise.all([...(activeView === "home" ? [loadPicksBoard()] : []), loadNotifications(), ...(canReview() ? [loadPickReviews()] : [])])
        .catch(error => { $('#group-message').textContent = error.message; });
    }, 15000);

  if (canReview()) await loadPickReviews();
  showView(activeGroup ? "home" : "groups");
}

function setupNavigation() {
  const drawer = $("#drawer");
  const backdrop = $("#drawer-backdrop");
  const toggle = $("#menu-toggle");
  const desktop = window.matchMedia('(min-width: 761px)');
  const closeDrawer = () => {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", String(!desktop.matches));
    drawer.inert = !desktop.matches;
    backdrop.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-open");
  };
  desktop.onchange = closeDrawer;
  closeDrawer();
  toggle.onclick = () => {
    const opening = !drawer.classList.contains("open");
    drawer.classList.toggle("open", opening);
    drawer.setAttribute("aria-hidden", String(!opening));
    drawer.inert = !opening;
    backdrop.hidden = !opening;
    toggle.setAttribute("aria-expanded", String(opening));
    document.body.classList.toggle("drawer-open", opening);
  };
  backdrop.onclick = closeDrawer;
  document.onkeydown = (event) => {
    if (event.key === "Escape") closeDrawer();
  };
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.onclick = () => {
      showView(button.dataset.view);
      closeDrawer();
    };
  });
  $(".brand").onclick = (event) => {
    event.preventDefault();
    showView("home");
    closeDrawer();
  };
}

function showView(view) {
  if (view === "admin" && me.role !== "admin") view = "home";
  if (view === 'reviews' && !canReview()) view = 'groups';
  if (!activeGroup && view !== 'groups') view = 'groups';
  activeView = view;
  $("#week-detail").hidden = true;
  document.querySelectorAll(".app-view").forEach((section) => {
    section.hidden = true;
  });
  const target =
    $(`#${view}-view`) ?? (view === "admin" ? $("#admin") : $("#home-view"));
  target.hidden = false;
  document
    .querySelectorAll("[data-view]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.view === view),
    );
  if (view === "admin") { loadUsers(); loadResultWeeks(); }
  if (view === "place-picks") loadWeeks().catch(error=>{ $("#weeks").textContent=error.message; });
  if (view === "home" && activeGroup) loadPicksBoard();
  if (view === "history") renderHistory();
  if (view === "notifications") loadNotifications(true);
  if (view === "reviews") loadPickReviews().catch(error => { $("#review-message").textContent = error.message; });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAccount() {
  $("#account-card").innerHTML =
    `<form id="account-profile-form"><label>Display name<input name="displayName" autocomplete="name" minlength="2" maxlength="40" pattern="[A-Za-z0-9 .&'-]+" title="Use 2-40 characters: letters, numbers, spaces, apostrophes, hyphens, periods, and ampersands." required value="${esc(me.displayName)}"></label><button type="submit">Save display name</button><p id="account-message" role="status"></p></form><dl class="account-details"><div><dt>Email</dt><dd>${esc(me.email)}</dd></div><div><dt>Account type</dt><dd>${me.role === "admin" ? "App administrator" : "Player"}</dd></div></dl><p><a href="/support.html">Email preferences, support &amp; privacy requests</a></p>`;
  $("#account-profile-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.target.querySelector("button");
    button.disabled = true;
    $("#account-message").textContent = "";
    try {
      const displayName = validateName(event.target.elements.displayName.value, "Display name", 2, 40);
      me = await api("/api/auth/me", { method: "PATCH", body: JSON.stringify({ displayName }) });
      $("#nav").innerHTML = `<span>${esc(me.displayName)}</span>`;
      event.target.elements.displayName.value = me.displayName;
      $("#account-message").textContent = "Display name saved.";
      await loadGroups();
    } catch (error) {
      $("#account-message").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  $("#menu-logout").onclick = async (event) => {
    event.currentTarget.disabled = true;
    $("#logout-error").textContent = "";
    try {
      await api("/api/auth/logout", { method: "POST" });
      location.reload();
    } catch (error) {
      $("#logout-error").textContent = error.message;
      $("#menu-logout").disabled = false;
    }
  };
}

function captureMobilePicksPosition() {
  const strip = document.querySelector(".mobile-picks");
  if (!strip) return null;
  const cards = [...strip.querySelectorAll(".mobile-pick-card")];
  const stripBounds = strip.getBoundingClientRect();
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  cards.forEach((card, index) => {
    const bounds = card.getBoundingClientRect();
    const distance = Math.abs(bounds.left - stripBounds.left);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  return {
    left: strip.scrollLeft,
    index: closestIndex,
  };
}

function restoreMobilePicksPosition(position) {
  if (!position) return;
  const strip = document.querySelector(".mobile-picks");
  if (!strip) return;
  const card = strip.querySelectorAll(".mobile-pick-card")[position.index];
  requestAnimationFrame(() => {
    strip.scrollLeft = position.left;
    if (card && Math.abs(strip.scrollLeft - position.left) > 8) {
      strip.scrollLeft = card.offsetLeft - strip.offsetLeft;
    }
  });
}

function renderCurrentPicksLeaderboard(entries) {
  if (!entries.length) return "";
  const sorted = [...entries].sort((a, b) => {
    const correctA = a.correctPicks ?? -1;
    const correctB = b.correctPicks ?? -1;
    const diffA = a.tiebreakerDifference ?? Number.POSITIVE_INFINITY;
    const diffB = b.tiebreakerDifference ?? Number.POSITIVE_INFINITY;
    return correctB - correctA || diffA - diffB || a.displayName.localeCompare(b.displayName);
  });
  const rows = sorted
    .map((entry, index) => {
      const tiebreakerDifference = entry.tiebreakerDifference ?? "—";
      const tiebreakerTotal = entry.tiebreakerTotal ?? null;
      const tiebreakerLabel = tiebreakerTotal === null ? tiebreakerDifference : `${tiebreakerDifference} (${tiebreakerTotal})`;
      return `<tr><td>${index + 1}. ${esc(entry.displayName)}</td><td>${entry.correctPicks ?? 0}</td><td>${tiebreakerLabel}</td></tr>`;
    })
    .join("");
  return `<section class="current-leaderboard"><h2>Leaderboard</h2><table class="leader-table"><thead><tr><th>Player</th><th>Correct</th><th>Monday diff</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

async function loadPicksBoard() {
  try {
    const mobilePicksPosition = captureMobilePicksPosition();
    const board = await api("/api/picks-board");
    const winners=board.winners ?? [];
    $('#week-winners').hidden=!winners.length;
    $('#week-winners').innerHTML=winners.length ? `<p class="eyebrow">Final results · ${esc(board.displayWeek.name)}</p><h2>${winners.length===1?'Week winner':'Week co-winners'}</h2><ul>${winners.map(winner=>`<li><strong>${esc(winner.displayName)}</strong> · Entry ${esc(winner.entryNumber)}<span>${esc(winner.correctPicks)} correct picks · Tiebreaker difference: ${esc(winner.tiebreakerDifference)}</span></li>`).join('')}</ul>` : '';
    board.games.sort(
      (a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt) || a.id - b.id,
    );
    const poolWeekName = board.poolWeek?.name ?? board.displayWeek?.name ?? "Weekly picks";
    $("#pool-card").innerHTML = `<div><p class="eyebrow">${esc(poolWeekName)}</p><h2>Locked picks are ready to view</h2><p class="pool-detail">Community picks appear here after the weekly lock.</p></div><strong class="pool-amount">✓</strong>`;
    if (!board.displayWeek) {
      $("#board-title").textContent = "Weekly picks";
      $("#board-status").textContent = board.poolWeek
        ? `${board.poolWeek.name} picks unlock ${easternDate(board.poolWeek.picksLockAt)} at ${easternTime(board.poolWeek.picksLockAt)} ET`
        : "No week is currently available";
      $("#picks-board").innerHTML =
        '<p class="empty-board">No previous locked week is available yet. This board will reveal the current week automatically when its deadline passes.</p>';
      $("#current-leaderboard-slot").innerHTML = "";
      return;
    }
    $("#board-title").textContent = `${board.displayWeek.name} picks`;
    $("#board-status").textContent =
      board.poolWeek?.id !== board.displayWeek.id
        ? `Showing the previous week until ${board.poolWeek.name} locks ${easternDate(board.poolWeek.picksLockAt)} at ${easternTime(board.poolWeek.picksLockAt)} ET`
        : `Locked ${easternDate(board.displayWeek.picksLockAt)} at ${easternTime(board.displayWeek.picksLockAt)} ET`;

    const winnerId = (game) =>
      game.status === "final" && game.homeScore !== game.awayScore
        ? game.homeScore > game.awayScore
          ? game.homeTeamId
          : game.awayTeamId
        : null;
    const headers = board.games
      .map(
        (game) =>
          `<th><span class="pick-matchup"><span>${esc(game.awayAbbreviation)} @ ${esc(game.homeAbbreviation)}</span><span class="pick-matchup-logos">${game.awayLogoUrl ? `<img src="${esc(game.awayLogoUrl)}" alt="">` : ""}${game.homeLogoUrl ? `<img src="${esc(game.homeLogoUrl)}" alt="">` : ""}</span><small>${easternDay(game.kickoffAt).slice(0, 3)} ${easternTime(game.kickoffAt)} ET</small>${game.status === "final" ? `<strong class="matchup-final">Final: ${esc(game.awayAbbreviation)} ${game.awayScore} - ${esc(game.homeAbbreviation)} ${game.homeScore}</strong>` : ""}</span></th>`,
      )
      .join("");
    const rows = board.entries
      .map(
        (entry) =>
          `<tr><td>${esc(entry.displayName)}</td>${board.games
            .map((game) => {
              const pick = entry.picks[String(game.id)];
              const winner = winnerId(game);
              const resultClass = winner
                ? pick?.selectedTeamId === winner
                  ? "correct"
                  : "incorrect"
                : "";
              return `<td class="pick-cell ${resultClass}">${pick ? esc(pick.selectedAbbreviation) : "—"}</td>`;
            })
            .join("")}<td>${entry.tiebreakerTotal}</td></tr>`,
      )
      .join("");
    const mobileCards = board.games
      .map((game, index) => {
        const winner = winnerId(game);
        const playerPicks = board.entries
          .map((entry) => {
            const pick = entry.picks[String(game.id)];
            const resultClass = winner
              ? pick?.selectedTeamId === winner
                ? "correct"
                : "incorrect"
              : "";
            const selectedLogo = pick
              ? pick.selectedTeamId === game.awayTeamId
                ? game.awayLogoUrl
                : game.homeLogoUrl
              : null;
            return `<li class="mobile-player-pick ${resultClass}"><span>${esc(entry.displayName)}</span><strong>${selectedLogo ? `<img src="${esc(selectedLogo)}" alt="">` : ""}${pick ? esc(pick.selectedAbbreviation) : "—"}</strong></li>`;
          })
          .join("");
        const score =
          game.status === "final"
            ? `${game.awayScore}–${game.homeScore}`
            : "AT";
        const kickoff = `${easternDay(game.kickoffAt).slice(0, 3)} ${easternTime(game.kickoffAt)} ET`;
        return `<article class="mobile-pick-card" data-game-count="${index + 1} of ${board.games.length}"><div class="mobile-matchup"><div>${game.awayLogoUrl ? `<img src="${esc(game.awayLogoUrl)}" alt="">` : ""}<strong>${esc(game.awayAbbreviation)}</strong></div><span><b>${score}</b><small>${game.status === "final" ? "Final" : kickoff}</small></span><div>${game.homeLogoUrl ? `<img src="${esc(game.homeLogoUrl)}" alt="">` : ""}<strong>${esc(game.homeAbbreviation)}</strong></div></div><ul>${playerPicks}</ul><p class="mobile-swipe-hint">Swipe for next matchup →</p></article>`;
      })
      .join("");
    $("#picks-board").innerHTML =
      `<p class="meta">Scores and picks for ${esc(board.displayWeek.name)}.</p>${!board.entries.length ? '<p class="meta">No approved entries for this week. Game scores are shown below.</p>' : ""}<table class="picks-table"><thead><tr><th>Player</th>${headers}<th>Tiebreaker</th></tr></thead><tbody>${rows}</tbody></table><div class="mobile-picks">${mobileCards}</div>`;
    $("#current-leaderboard-slot").innerHTML = renderCurrentPicksLeaderboard(board.entries);
    restoreMobilePicksPosition(mobilePicksPosition);
  } catch (error) {
    if (me)
      $('#week-winners').hidden=true;
    if (me)
      $("#picks-board").innerHTML =
        `<p class="empty-board">${esc(error.message)}</p>`;
      $("#current-leaderboard-slot").innerHTML = "";
  }
}
function weekIsPlayable(week) {
  return week.status === 'open' && Boolean(Number(week.previousWeeksFinal)) && new Date(week.picksLockAt) > new Date();
}
function weekOrder(week) {
  if (weekIsPlayable(week)) return 0;
  if (week.status === 'final') return 3;
  if (new Date(week.picksLockAt) <= new Date()) return 1;
  return 2;
}
function weekLabel(week) {
  if (weekIsPlayable(week)) return 'Open for picks';
  if (week.status === 'final') return 'Completed - locked';
  if (new Date(week.picksLockAt) <= new Date()) return 'Picks locked';
  if (!Number(week.previousWeeksFinal)) return 'Locked until previous weeks are finalized';
  return 'Picks locked';
}
async function loadWeeks() {
  [weeksData, myEntriesData] = await Promise.all([
    api("/api/weeks"),
    api("/api/my-entries"),
  ]);
  weeksData.sort((a,b)=>weekOrder(a)-weekOrder(b) || (weekOrder(a)===3 ? new Date(b.picksLockAt)-new Date(a.picksLockAt) : new Date(a.picksLockAt)-new Date(b.picksLockAt)) || a.id-b.id);
  $('#weeks').innerHTML = weeksData.length ? weeksData.map(w => {
    const futureLocked = !weekIsPlayable(w) && w.status !== 'final' && new Date(w.picksLockAt) > new Date();
    return `<button type="button" class="week-card" data-id="${w.id}" ${futureLocked?'disabled':''}><span class="pill">${weekLabel(w)}</span><h2>${esc(w.name)}</h2><p class="meta">Locks ${date(w.picksLockAt)}</p><p class="meta">${Number(w.entryCount)||0} entries${futureLocked?'':' ? '+(weekIsPlayable(w)?'Make picks':'View picks')}</p></button>`;
  }).join('') : '<p>No weeks are available yet. The app administrator needs to import the schedule.</p>';
  document.querySelectorAll('.week-card').forEach(card=>card.onclick=()=>openWeek(card.dataset.id));
  renderHistory();
}

function renderHistory() {
  $("#history-list").innerHTML = myEntriesData.length
    ? myEntriesData
        .map(
          (entry) =>
            `<article class="history-card" data-week-id="${entry.weekId}" data-entry-id="${entry.id}"><div><span class="pill">${esc(entry.status)}</span><h2>${esc(entry.weekName)} · Entry ${entry.entryNumber}</h2><p class="meta">${entry.submittedAt ? `Submitted ${date(entry.submittedAt)}` : "Draft entry"}</p></div><div class="history-score"><strong>${entry.correctPicks ?? (entry.status === "submitted" ? 0 : "—")}</strong><span>correct</span></div><div class="history-score"><strong>${entry.tiebreakerDifference ?? "—"}</strong><span>tiebreak diff</span></div></article>`,
        )
        .join("")
    : '<p class="empty-board">You have not created an entry yet. Choose Place Picks from the menu to get started.</p>';
  document
    .querySelectorAll(".history-card")
    .forEach(
      (card) =>
        (card.onclick = () =>
          openWeek(card.dataset.weekId, card.dataset.entryId)),
    );
}
async function openWeek(id, entryId = null) {
  weekReturnView = activeView === "history" ? "history" : "place-picks";
  currentWeek = await api(
    `/api/weeks/${id}${entryId ? `?entryId=${encodeURIComponent(entryId)}` : ""}`,
  );
  document.querySelectorAll(".app-view").forEach((section) => {
    section.hidden = true;
  });
  $("#week-detail").hidden = false;
  const { week, games, entry } = currentWeek;
  $("#pick-message").textContent = weekIsPlayable(week) ? "" : weekLabel(week);
  games.sort(
    (a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt) || a.id - b.id,
  );
  $("#week-heading").innerHTML =
    `<div class="detail-title"><div><p class="eyebrow">Week ${week.weekNumber}</p><h2>${esc(week.name)}${entry ? ` · Entry ${entry.entryNumber}` : " · New entry"}</h2></div><p class="meta">Locks ${date(week.picksLockAt)}</p></div>`;
  const editable =
    weekIsPlayable(week) &&
    (!entry || ["draft", "rejected"].includes(entry.status));
  $(".ticket").classList.toggle("editable-ticket", editable);
  const canAddEntry =
    weekIsPlayable(week) && currentWeek.entries.length < maxEntriesForActiveGroup();
  $("#entry-controls").innerHTML =
    `${currentWeek.entries.map((item) => `<button type="button" class="entry-switch ${entry?.id === item.id ? "active" : ""}" data-entry-id="${item.id}">Entry ${item.entryNumber} · ${esc(item.status)}</button>`).join("")}${canAddEntry ? '<button type="button" id="new-entry" class="entry-switch">+ New entry</button>' : ""}`;
  document
    .querySelectorAll(".entry-switch[data-entry-id]")
    .forEach(
      (button) => (button.onclick = () => openWeek(id, button.dataset.entryId)),
    );
  if ($("#new-entry")) $("#new-entry").onclick = () => openWeek(id, "new");
  const gamesByDate = games.reduce((groups, game) => {
    const key = easternDateKey(game.kickoffAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(game);
    return groups;
  }, new Map());
  $("#games").innerHTML = [...gamesByDate.values()]
    .map(
      (dayGames) =>
        `<section class="game-day"><header class="game-day-heading"><h3>${easternDay(dayGames[0].kickoffAt)}</h3><span>${easternDate(dayGames[0].kickoffAt)}</span></header>${dayGames
          .map(
            (g) =>
              `<div class="game"><label class="team"><input type="radio" name="game-${g.id}" value="${g.awayTeamId}" ${g.selectedTeamId === g.awayTeamId ? "checked" : ""} ${editable ? "" : "disabled"}>${g.awayLogoUrl ? `<img class="team-logo" src="${esc(g.awayLogoUrl)}" alt="">` : ""}<strong>${esc(g.awayAbbreviation)}</strong><br>${esc(g.awayCity)} ${esc(g.awayName)}${g.awayScore != null ? ` · ${g.awayScore}` : ""}</label><span class="versus"><strong>${easternTime(g.kickoffAt)}</strong><small>ET</small><b>AT</b>${g.isMondayTiebreaker ? "<em>Tiebreaker</em>" : ""}</span><label class="team"><input type="radio" name="game-${g.id}" value="${g.homeTeamId}" ${g.selectedTeamId === g.homeTeamId ? "checked" : ""} ${editable ? "" : "disabled"}>${g.homeLogoUrl ? `<img class="team-logo" src="${esc(g.homeLogoUrl)}" alt="">` : ""}<strong>${esc(g.homeAbbreviation)}</strong><br>${esc(g.homeCity)} ${esc(g.homeName)}${g.homeScore != null ? ` · ${g.homeScore}` : ""}</label></div>`,
          )
          .join("")}</section>`,
    )
    .join("");
  document
    .querySelectorAll('#games input[type="radio"]')
    .forEach((input) => input.addEventListener("change", updatePickProgress));
  updatePickProgress();
  $("#tiebreaker").value = entry?.tiebreakerTotal ?? "";
  $("#tiebreaker").disabled = !editable;
  $("#picks-form").querySelector("button[type=submit]").hidden = !editable;
  $("#submit-review").hidden =
    !editable || !entry;
  $("#submit-review").textContent = needsPickReview() ? "Submit picks for review" : "Submit picks";
  await loadLeaderboard(id);
}
function updatePickProgress() {
  if (!currentWeek) return;
  const selected = currentWeek.games.filter((game) =>
    document.querySelector(`input[name="game-${game.id}"]:checked`),
  ).length;
  $("#pick-progress").textContent =
    `${selected} of ${currentWeek.games.length} selected`;
  $("#pick-progress").classList.toggle(
    "complete",
    selected === currentWeek.games.length,
  );
}
$("#back").onclick = () => {
  loadWeeks();
  showView(weekReturnView);
};
$("#picks-form").addEventListener("input", () => {
  $("#submit-review").hidden = true;
  $("#pick-message").textContent = "You have unsaved changes. Save your picks before submitting.";
});
$("#picks-form").onsubmit = async (event) => {
  event.preventDefault();
  const picks = currentWeek.games.map((g) => ({
    gameId: g.id,
    teamId: Number(
      document.querySelector(`input[name="game-${g.id}"]:checked`)?.value,
    ),
  }));
  if (picks.some((p) => !p.teamId)) {
    $("#pick-message").textContent = "Pick a winner for every game.";
    return;
  }
  try {
    const saved = await api(`/api/weeks/${currentWeek.week.id}/entry`, {
      method: "PUT",
      body: JSON.stringify({
        entryId: currentWeek.entry?.id,
        picks,
        tiebreakerTotal: Number($("#tiebreaker").value),
      }),
    });
    await openWeek(currentWeek.week.id, saved.id ?? saved.entryId);
    $("#pick-message").textContent =
      needsPickReview() ? "Picks saved. Submit them for commissioner review." : "Picks saved. Submit to lock your entry.";
  } catch (e) {
    $("#pick-message").textContent = e.message;
  }
};
$("#submit-review").onclick = async () => {
  try {
    const entryId = currentWeek.entry.id ?? currentWeek.entry.entryId;
    const result = await api(`/api/entries/${entryId}/submit-review`, {
      method: "POST",
    });
    await openWeek(currentWeek.week.id, entryId);
    $("#pick-message").textContent =
      result.status === "submitted" ? "Picks submitted. Your entry is locked in." : result.reviewSubmissionMessage || "Picks submitted. The commissioner has been notified for review.";
    await loadWeeks();
  } catch (e) {
    $("#pick-message").textContent = e.message;
  }
};

$("#tiebreaker").addEventListener("input", (event) => {
  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 3);
});

async function loadNotifications(markRead = false) {
  if (!me) return;
  if (markRead) await api("/api/notifications/read-all", { method: "POST" });
  const result = await api("/api/notifications");
  $("#review-count").hidden = result.unreadCount === 0;
  $("#review-count").textContent = result.unreadCount;
  $('.drawer-nav [data-view="notifications"]').textContent = result.unreadCount
    ? `Notifications (${result.unreadCount})` : 'Notifications';
  $("#notifications-list").innerHTML = result.notifications.length
    ? result.notifications
        .map(
          (notification) =>
            `<article class="notification-item ${notification.readAt ? "" : "unread"}" ${notification.weekId ? `data-week-id="${notification.weekId}" data-entry-id="${notification.entryId}"` : ""}><div><strong>${notification.type === "entry_approved" ? "Picks approved" : notification.type === "entry_rejected" ? "Picks need changes" : "Review requested"}</strong><p>${esc(notification.message)}</p>${notification.weekName ? `<span>${esc(notification.weekName)}${notification.entryNumber ? ` · Entry ${notification.entryNumber}` : ""}</span>` : ""}</div><time>${date(notification.createdAt)}</time></article>`,
        )
        .join("")
    : '<p class="empty-board">You do not have any notifications yet.</p>';
  document
    .querySelectorAll(".notification-item[data-week-id]")
    .forEach((item, index) => {
      const notification = result.notifications[index];
      item.onclick = () => {
        if (notification?.type === "pick_review_requested" && canReview()) {
          pendingReviewHighlightEntryId = item.dataset.entryId;
          showView("reviews");
          return;
        }
        openWeek(item.dataset.weekId, item.dataset.entryId);
      };
    });
}

async function loadPickReviews() {
  if (!canReview()) return;
  const reviews = await api("/api/reviews");
  $("#commissioner-menu-item").textContent = reviews.length
    ? `Group commissioner (${reviews.length})`
    : "Group commissioner";
  $("#pick-review-list").innerHTML = reviews.length
    ? reviews
        .map(
          (review) =>
            `<article class="review-item" data-entry-id="${review.entryId}"><div><strong>${esc(review.displayName)} · Entry ${review.entryNumber}</strong><span>${esc(review.weekName)} · ${review.pickCount} picks · Tiebreaker ${review.tiebreakerTotal}</span><small>${review.submittedAt ? date(review.submittedAt) : "Just submitted"}</small></div><div><button class="approve-review" type="button">Approve</button><button class="reject-review link" type="button">Reject</button></div></article>`,
        )
        .join("")
    : '<p class="empty-board">No entries are waiting for review.</p>';
  const highlightedReview = pendingReviewHighlightEntryId
    ? document.querySelector(`.review-item[data-entry-id="${CSS.escape(String(pendingReviewHighlightEntryId))}"]`)
    : null;
  if (highlightedReview) {
    highlightedReview.classList.add("highlight");
    highlightedReview.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  pendingReviewHighlightEntryId = null;
  document.querySelectorAll(".approve-review").forEach(
    (button) =>
      (button.onclick = async () => {
        const entryId = button.closest(".review-item").dataset.entryId;
        button.disabled = true;
        try {
          await api(`/api/reviews/${entryId}/approve`, {
            method: "POST",
          });
          await Promise.all([
            loadPickReviews(),
            loadPicksBoard(),
            loadNotifications(),
          ]);
        } catch (error) {
          $("#review-message").textContent = error.message;
          button.disabled = false;
        }
      }),
  );
  document.querySelectorAll(".reject-review").forEach(
    (button) =>
      (button.onclick = async () => {
        const reason = window.prompt(
          "Why should this player update their picks?",
        );
        if (!reason) return;
        const entryId = button.closest(".review-item").dataset.entryId;
        try {
          await api(`/api/reviews/${entryId}/reject`, {
            method: "POST",
            body: JSON.stringify({ reason }),
          });
          await Promise.all([loadPickReviews(), loadNotifications()]);
        } catch (error) {
          $("#review-message").textContent = error.message;
        }
      }),
  );
}
async function loadLeaderboard(id) {
  const rows = await api(`/api/weeks/${id}/leaderboard`);
  $("#leaderboard").innerHTML = rows.length
    ? `<h2>Leaderboard</h2><table class="leader-table"><thead><tr><th>Player</th><th>Correct</th><th>Monday diff</th></tr></thead><tbody>${rows.map((r, i) => {
        const tiebreakerDifference = r.tiebreakerDifference ?? "—";
        const tiebreakerTotal = r.tiebreakerTotal ?? null;
        const tiebreakerLabel = tiebreakerTotal === null ? tiebreakerDifference : `${tiebreakerDifference} (${tiebreakerTotal})`;
        return `<tr><td>${i + 1}. ${esc(r.displayName)}</td><td>${r.correctPicks ?? 0}</td><td>${tiebreakerLabel}</td></tr>`;
      }).join("")}</tbody></table>`
    : "";
}


$("#schedule-import-form").onsubmit = async (event) => {
  event.preventDefault();
  const season = Number(new FormData(event.target).get("season"));
  const button = event.target.querySelector("button");
  button.disabled = true;
  $("#admin-message").textContent = `Importing the ${season} schedule…`;
  try {
    const result = await api("/api/admin/schedules/import-nflverse", {
      method: "POST",
      body: JSON.stringify({ season }),
    });
    $("#admin-message").textContent =
      `Imported ${result.teams} teams, ${result.weeks} weeks, and ${result.games} games.`;
    await loadResultWeeks();
    if (activeGroup) await loadWeeks();
  } catch (error) {
    $("#admin-message").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

$("#schedule-file").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const season = Number(new FormData($("#schedule-import-form")).get("season"));
  $("#admin-message").textContent = `Uploading ${file.name}…`;
  try {
    const result = await api("/api/admin/schedules/import-csv", {
      method: "POST",
      body: JSON.stringify({ season, csv: await file.text() }),
    });
    $("#admin-message").textContent =
      `Imported ${result.teams} teams, ${result.weeks} weeks, and ${result.games} games.`;
    await loadResultWeeks();
    if (activeGroup) await loadWeeks();
  } catch (error) {
    $("#admin-message").textContent = error.message;
  } finally {
    event.target.value = "";
  }
};
function formObject(form) {
  return Object.fromEntries(new FormData(form));
}
async function loadGroups() {
  groups = await api('/api/groups');
  const saved = Number(localStorage.getItem('pickem-group-' + me.id));
  activeGroup = groups.find(group => group.id === saved) ?? groups[0] ?? null;
  $('#group-select').innerHTML = groups.length ? groups.map(group => `<option value="${group.id}" ${group.id === activeGroup?.id ? 'selected' : ''}>${esc(group.name)}</option>`).join('') : '<option>No groups yet</option>';
  $('#group-select').disabled = !groups.length;
  document.querySelectorAll('[data-view]').forEach(button => {
    const locked = !activeGroup && button.dataset.view !== 'groups';
    button.disabled = locked;
    button.title = locked ? 'Create or join a group to unlock this tab.' : '';
  });
  $('#commissioner-menu-item').hidden = !canReview();
  $('#group-settings-form').elements.requirePickApproval.checked = !!activeGroup?.requirePickApproval;
  $('#group-settings-form').elements.maxEntriesPerMember.value = maxEntriesForActiveGroup();
  $('#group-settings-form').elements.reviewSubmissionMessage.value = activeGroup?.reviewSubmissionMessage ?? '';
  updateReviewMessageCount();
  $('#group-settings-form').elements.joiningEnabled.checked = !!activeGroup?.joiningEnabled;
  $('#group-list').innerHTML = groups.length ? groups.map(group => `<article class="panel"><h2>${esc(group.name)}</h2><p>${group.memberCount} members · ${group.role === 'commissioner' ? 'You are commissioner' : group.role === 'member' ? 'Member' : 'Administrator access'}</p><p>Commissioner: ${esc(group.commissionerName ?? 'Not assigned')}</p>${group.inviteCode ? `<label>Share this invite code<input readonly value="${esc(group.inviteCode)}" aria-label="Invite code for ${esc(group.name)}"></label>` : ''}<button type="button" data-group-id="${group.id}">Open group</button></article>`).join('') : '<p>Create your first group or ask a commissioner for an invite code.</p>';
  document.querySelectorAll('[data-group-id]').forEach(button => button.onclick = () => selectGroup(Number(button.dataset.groupId)));
  if (activeGroup) {
    const members = await api('/api/groups/' + activeGroup.id + '/members');
    $('#group-members').innerHTML = members.map(member => `<div class="member-row"><div><strong>${esc(member.displayName)}</strong><span> · ${member.role === 'commissioner' ? 'Commissioner' : 'Member'}</span>${member.email ? `<p class="member-email">${esc(member.email)}</p>` : ''}</div>${canReview() && member.role !== 'commissioner' ? `<button type="button" data-remove-member="${member.id}">Remove member</button>` : ''}</div>`).join('');
    document.querySelectorAll('[data-remove-member]').forEach(button => button.onclick = async () => {
      const member=members.find(member=>String(member.id)===button.dataset.removeMember);
      if(!confirm(`Remove ${member.displayName} from ${activeGroup.name}? They will lose group access. Existing picks and results will remain. They can rejoin using an active invite code; replace the code in Group commissioner settings if needed.`)) return;
      button.disabled=true;
      try {
        const result=await api(`/api/groups/${activeGroup.id}/members/${member.id}`,{method:'DELETE'});
        await loadGroups();
        $('#group-message').textContent=result.message;
      } catch(error) { $('#group-message').textContent=error.message;button.disabled=false; }
    });
  } else $('#group-members').textContent = 'Choose a group to see its members.';
}
function selectGroup(id) {
  localStorage.setItem('pickem-group-' + me.id, String(id));
  location.reload();
}
$('#group-select').onchange = event => selectGroup(Number(event.target.value));
$('#group-settings-form').elements.reviewSubmissionMessage.addEventListener('input', updateReviewMessageCount);
for (const [id,path] of [['create-group-form','/api/groups'],['join-group-form','/api/groups/join']]) {
  $('#' + id).onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      const body = formObject(event.target);
      if (id === 'create-group-form') body.name = validateName(body.name, 'Group name', 3, 50);
      const group = await api(path,{method:'POST',body:JSON.stringify(body)});
      selectGroup(group.id);
    } catch(error) { $('#group-message').textContent = error.message; }
    finally { button.disabled = false; }
  };
}
$('#group-settings-form').onsubmit = async event => {
  event.preventDefault();
  const button = event.target.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const maxEntriesPerMember = Number(event.target.elements.maxEntriesPerMember.value);
    if (!Number.isInteger(maxEntriesPerMember) || maxEntriesPerMember < 1 || maxEntriesPerMember > 10) throw new Error('Entries per member must be between 1 and 10.');
    const settings = {
      requirePickApproval:event.target.elements.requirePickApproval.checked,
      maxEntriesPerMember,
      reviewSubmissionMessage:event.target.elements.reviewSubmissionMessage.value.trim(),
      joiningEnabled:event.target.elements.joiningEnabled.checked,
    };
    await api('/api/groups/' + activeGroup.id + '/settings',{method:'PATCH',body:JSON.stringify(settings)});
    await loadGroups();
    showSettingsMessage('Group settings saved.', true);
  } catch(error) { showSettingsMessage(error.message); }
  finally { button.disabled = false; }
};
$('#rotate-invite').onclick = async event => {
  event.target.disabled = true;
  try {
    await api('/api/groups/' + activeGroup.id + '/invite-code',{method:'POST'});
    await loadGroups();
    $('#settings-message').textContent = 'Invite code replaced. Find the new code in My groups.';
  } catch(error) { $('#settings-message').textContent = error.message; }
  finally { event.target.disabled = false; }
};
$('#group-invite-form').onsubmit = async event => {
  event.preventDefault();
  const button=event.target.querySelector('button');
  button.disabled=true;
  $('#invite-message').textContent='';
  try {
    const result=await api('/api/groups/'+activeGroup.id+'/invitations',{method:'POST',body:JSON.stringify(formObject(event.target))});
    $('#invite-message').textContent=result.message;
    event.target.reset();
  } catch(error) { $('#invite-message').textContent=error.message; }
  finally { button.disabled=false; }
};
let usersPage=1, usersQuery='', usersRequest=0;
async function loadUsers() {
  const request=++usersRequest;
  $('#users-status').textContent='Loading registered users...';
  $('#users-prev').disabled=true;
  $('#users-next').disabled=true;
  $('#users-rows').replaceChildren();
  try {
    const result=await api('/api/admin/users?'+new URLSearchParams({page:String(usersPage),q:usersQuery}));
    if(request!==usersRequest) return;
    $('#users-rows').innerHTML=result.users.map(user=>`<tr><td>${esc(user.id)}</td><td>${esc(user.displayName)}</td><td>${esc(user.email)}</td><td>${user.role==='admin'?'Administrator':'Player'}</td><td>${esc(user.groupCount)}</td><td>${esc(date(user.createdAt))}</td></tr>`).join('');
    $('#users-status').textContent=result.total?`${result.total} registered users${usersQuery?' matching your search':''}. Page ${result.page} of ${Math.ceil(result.total/result.pageSize)}.`:'No users found.';
    $('#users-prev').disabled=usersPage<=1;
    $('#users-next').disabled=usersPage*result.pageSize>=result.total;
  } catch(error) { if(request===usersRequest) $('#users-status').textContent=error.message; }
}
$('#users-search').onsubmit=event=>{event.preventDefault();usersQuery=new FormData(event.target).get('q').trim();usersPage=1;loadUsers();};
$('#users-refresh').onclick=()=>{usersPage=1;loadUsers();};
$('#users-prev').onclick=()=>{usersPage--;loadUsers();};
$('#users-next').onclick=()=>{usersPage++;loadUsers();};
let resultWeeks=[], resultGames=[], resultRequest=0, resultBusy=false;
function setResultBusy(value) {
  resultBusy=value;
  document.querySelectorAll(".game-score-form input,.game-score-form button").forEach(control=>control.disabled=value);
  $("#results-week").disabled=value || !resultWeeks.length;
  updateFinalizeButton();
}
async function loadResultWeeks() {
  try {
    const selected=$('#results-week').value;
    resultWeeks=await api('/api/admin/weeks');
    const preferred=resultWeeks.find(w=>String(w.id)===selected && w.scoringStatus!=='Locked') ?? resultWeeks.find(w=>w.scoringStatus==='Open for scoring') ?? resultWeeks[0];
    $('#results-week').innerHTML=resultWeeks.map(w=>`<option value="${w.id}" ${w.scoringStatus==='Locked'?'disabled':''}>${esc(w.year)} - ${esc(w.name)} (${esc(w.scoringStatus ?? w.status)})</option>`).join('');
    $('#results-week').disabled=!resultWeeks.length;
    if(preferred) $('#results-week').value=String(preferred.id);
    await loadResultGames();
  } catch(error) {$('#results-status').textContent=error.message;}
}
function updateFinalizeButton() {
  const forms=[...document.querySelectorAll('.game-score-form')];
  const dirty=forms.some(form=>form.dataset.dirty==='true');
  const ready=resultGames.length>0 && resultGames.every(g=>g.status==='final' && g.homeScore!==null && g.awayScore!==null) && resultGames.some(g=>g.isTiebreaker);
  $('#finalize-week').disabled=resultBusy || !ready || dirty;
  const week=resultWeeks.find(w=>String(w.id)===$('#results-week').value);
  $('#finalize-week').textContent=week?.status==='final'?'Recalculate selected week':'Finalize selected week';
  $('#results-status').textContent=`${resultGames.filter(g=>g.status==='final').length} of ${resultGames.length} games final.${dirty?' Save changed scores before finalizing.':!resultGames.some(g=>g.isTiebreaker)?' A designated Monday tiebreaker is required.':''}`;
}
async function loadResultGames() {
  const request=++resultRequest,weekId=$('#results-week').value;
  $('#finalize-week').disabled=true;$('#results-games').replaceChildren();resultGames=[];
  $('#finalize-message').textContent='';
  if(!weekId){$('#results-status').textContent='Import a schedule to enter scores.';return;}
  $('#results-status').textContent='Loading games...';
  try {
    const games=await api(`/api/admin/weeks/${weekId}/games`);
    if(request!==resultRequest)return;
    resultGames=games;
    $('#results-games').innerHTML=games.map(g=>`<form class="game-score-form" data-game="${g.id}"><h4>${esc(g.awayName)} at ${esc(g.homeName)}</h4><p class="meta">${esc(date(g.kickoffAt))}${g.isTiebreaker?' - Monday tiebreaker':''}</p><div class="score-fields"><label>${esc(g.awayName)} (away)<input type="number" name="awayScore" min="0" max="200" step="1" required value="${g.awayScore ?? ''}"></label><label>${esc(g.homeName)} (home)<input type="number" name="homeScore" min="0" max="200" step="1" required value="${g.homeScore ?? ''}"></label><button>${g.status==='final'?'Save correction':'Save final score'}</button></div><p class="game-save-message" role="status">${esc(g.status)}</p></form>`).join('');
    document.querySelectorAll('.game-score-form').forEach(form=>{
      form.oninput=()=>{form.dataset.dirty='true';updateFinalizeButton();};
      form.onsubmit=async event=>{
        event.preventDefault();if(resultBusy)return;setResultBusy(true);const button=form.querySelector('button');button.disabled=true;
        $('#results-week').disabled=true;$('#finalize-week').disabled=true;
        const body={awayScore:Number(form.elements.awayScore.value),homeScore:Number(form.elements.homeScore.value)};
        try {
          const savedResult = await api(`/api/admin/games/${form.dataset.game}/result`,{method:'PATCH',body:JSON.stringify(body)});
          const game=resultGames.find(g=>String(g.id)===form.dataset.game);Object.assign(game,body,{status:'final'});
          form.dataset.dirty=String(Number(form.elements.awayScore.value)!==body.awayScore || Number(form.elements.homeScore.value)!==body.homeScore);
          form.querySelector('.game-save-message').textContent='Final score saved. Finalize the week to calculate or update results.';
          button.textContent='Save correction';
          const refreshes = activeGroup ? [loadPicksBoard(), loadHistory()] : [];
          if (currentWeek?.week?.id === Number(savedResult.weekId)) refreshes.push(loadLeaderboard(savedResult.weekId));
          await Promise.all(refreshes);
        } catch(error){form.querySelector('.game-save-message').textContent=error.message;}
        finally {setResultBusy(false);}
      };
    });
    updateFinalizeButton();
  } catch(error){if(request===resultRequest)$('#results-status').textContent=error.message;}
}
$('#results-week').onchange=loadResultGames;
$('#finalize-week').onclick=async()=>{
  if(resultBusy)return;
  const weekId=$('#results-week').value;
  if(!confirm('Finalize this week? This calculates group winners, queues results emails, and unlocks the next week if its deadline has not passed.'))return;
  setResultBusy(true);
  try {
    const result=await api(`/api/admin/weeks/${weekId}/score`,{method:'POST'});
    await loadResultWeeks();
    $('#finalize-message').textContent=`Week finalized: ${result.winners} winning entries across all groups. Results emails queued where applicable.`;
    const refreshes = activeGroup ? [loadWeeks(), loadPicksBoard()] : [];
    if (currentWeek?.week?.id === Number(weekId)) refreshes.push(loadLeaderboard(weekId));
    await Promise.all(refreshes);
  } catch(error){$('#finalize-message').textContent=error.message;updateFinalizeButton();}
  finally {setResultBusy(false);}
};
boot();
