const $ = (selector) => document.querySelector(selector);
let me = null,
  registerMode = false,
  currentWeek = null;
let boardRefreshTimer = null;
let paymentsEnabled = false;
let weeksData = [];
let myEntriesData = [];
let activeView = "home";
let weekReturnView = "place-picks";
const esc = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}
const money = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents || 0) / 100,
  );
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
  try {
    me = await api("/api/auth/me");
    showDashboard();
  } catch {
    $("#auth").hidden = false;
  }
}

$("#auth-toggle").onclick = () => {
  registerMode = !registerMode;
  $("#name-label").hidden = !registerMode;
  $("#auth-title").textContent = registerMode
    ? "Join the pool"
    : "Welcome back";
  $("#auth-toggle").textContent = registerMode
    ? "Already registered? Log in"
    : "Need an account? Register";
};
$("#auth-form").onsubmit = async (event) => {
  event.preventDefault();
  $("#auth-error").textContent = "";
  try {
    const body = { email: $("#email").value, password: $("#password").value };
    if (registerMode) body.displayName = $("#display-name").value;
    me = await api(`/api/auth/${registerMode ? "register" : "login"}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    showDashboard();
  } catch (error) {
    $("#auth-error").textContent = error.message;
  }
};

async function showDashboard() {
  $("#auth").hidden = true;
  $("#dashboard").hidden = false;
  $("#nav").innerHTML = `<span>${esc(me.displayName)}</span>`;
  $("#menu-toggle").hidden = false;
  $("#admin-menu-item").hidden = me.role !== "admin";
  setupNavigation();
  renderAccount();
  await Promise.all([loadWeeks(), loadPicksBoard(), loadNotifications()]);
  if (!boardRefreshTimer)
    boardRefreshTimer = setInterval(() => {
      loadPicksBoard();
      loadNotifications();
      if (me?.role === "admin") loadPickReviews();
    }, 15000);
  if (me.role === "admin") await loadTeams();
  if (me.role === "admin") await loadPickReviews();
  showView("home");
}

function setupNavigation() {
  const drawer = $("#drawer");
  const backdrop = $("#drawer-backdrop");
  const toggle = $("#menu-toggle");
  const closeDrawer = () => {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-open");
  };
  toggle.onclick = () => {
    const opening = !drawer.classList.contains("open");
    drawer.classList.toggle("open", opening);
    drawer.setAttribute("aria-hidden", String(!opening));
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
  if (view === "history") renderHistory();
  if (view === "notifications") loadNotifications(true);
  if (view === "admin") loadPickReviews();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAccount() {
  $("#account-card").innerHTML =
    `<dl class="account-details"><div><dt>Display name</dt><dd>${esc(me.displayName)}</dd></div><div><dt>Email</dt><dd>${esc(me.email)}</dd></div><div><dt>Account type</dt><dd>${me.role === "admin" ? "Commissioner" : "Player"}</dd></div></dl><button id="account-logout" type="button">Log out</button>`;
  $("#account-logout").onclick = async () => {
    await api("/api/auth/logout", { method: "POST" });
    location.reload();
  };
}

async function loadPicksBoard() {
  try {
    const board = await api("/api/picks-board");
    paymentsEnabled = board.paymentsEnabled;
    board.games.sort(
      (a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt) || a.id - b.id,
    );
    const poolWeekName = board.poolWeek?.name ?? "Upcoming week";
    $("#pool-card").innerHTML = paymentsEnabled
      ? `<div><p class="eyebrow">${esc(poolWeekName)} money pool</p><h2>${board.pool.paidEntries} paid ${board.pool.paidEntries === 1 ? "entry" : "entries"}</h2><p class="pool-detail">Verified payments; Stripe fees reconcile automatically</p></div><strong class="pool-amount">${money(board.pool.poolCents)}</strong>`
      : `<div><p class="eyebrow">${esc(poolWeekName)} entries</p><h2>${board.pool.paidEntries} approved ${board.pool.paidEntries === 1 ? "entry" : "entries"}</h2><p class="pool-detail">Picks appear publicly only after commissioner approval and the weekly lock</p></div><strong class="pool-amount">✓</strong>`;
    if (!board.displayWeek) {
      $("#board-title").textContent = "Weekly picks";
      $("#board-status").textContent = board.poolWeek
        ? `${board.poolWeek.name} picks unlock ${easternDate(board.poolWeek.picksLockAt)} at ${easternTime(board.poolWeek.picksLockAt)} ET`
        : "No week is currently available";
      $("#picks-board").innerHTML =
        '<p class="empty-board">No previous locked week is available yet. This board will reveal the current week automatically when its deadline passes.</p>';
      return;
    }
    $("#board-title").textContent = `${board.displayWeek.name} picks`;
    $("#board-status").textContent =
      board.poolWeek?.id !== board.displayWeek.id
        ? `Showing the previous week until ${board.poolWeek.name} locks ${easternDate(board.poolWeek.picksLockAt)} at ${easternTime(board.poolWeek.picksLockAt)} ET`
        : `Locked ${easternDate(board.displayWeek.picksLockAt)} at ${easternTime(board.displayWeek.picksLockAt)} ET`;
    if (!board.entries.length) {
      $("#picks-board").innerHTML =
        '<p class="empty-board">No paid picks were submitted for this week.</p>';
      return;
    }
    const winnerId = (game) =>
      game.status === "final" && game.homeScore !== game.awayScore
        ? game.homeScore > game.awayScore
          ? game.homeTeamId
          : game.awayTeamId
        : null;
    const headers = board.games
      .map(
        (game) =>
          `<th><span class="pick-matchup"><span>${esc(game.awayAbbreviation)} @ ${esc(game.homeAbbreviation)}</span><span class="pick-matchup-logos">${game.awayLogoUrl ? `<img src="${esc(game.awayLogoUrl)}" alt="">` : ""}${game.homeLogoUrl ? `<img src="${esc(game.homeLogoUrl)}" alt="">` : ""}</span><small>${easternDay(game.kickoffAt).slice(0, 3)} ${easternTime(game.kickoffAt)} ET</small></span></th>`,
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
      .map((game) => {
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
        return `<article class="mobile-pick-card"><div class="mobile-matchup"><div>${game.awayLogoUrl ? `<img src="${esc(game.awayLogoUrl)}" alt="">` : ""}<strong>${esc(game.awayAbbreviation)}</strong></div><span><b>${score}</b><small>${kickoff}</small></span><div>${game.homeLogoUrl ? `<img src="${esc(game.homeLogoUrl)}" alt="">` : ""}<strong>${esc(game.homeAbbreviation)}</strong></div></div><ul>${playerPicks}</ul><p class="mobile-swipe-hint">Swipe for next matchup →</p></article>`;
      })
      .join("");
    $("#picks-board").innerHTML =
      `<table class="picks-table"><thead><tr><th>Player</th>${headers}<th>Tiebreaker</th></tr></thead><tbody>${rows}</tbody></table><div class="mobile-picks">${mobileCards}</div>`;
  } catch (error) {
    if (me)
      $("#picks-board").innerHTML =
        `<p class="empty-board">${esc(error.message)}</p>`;
  }
}
async function loadWeeks() {
  [weeksData, myEntriesData] = await Promise.all([
    api("/api/weeks"),
    api("/api/my-entries"),
  ]);
  $("#weeks").innerHTML = weeksData.length
    ? weeksData
        .map(
          (w) =>
            `<article class="week-card" data-id="${w.id}"><span class="pill">${Number(w.entryCount) ? `${w.entryCount} ${Number(w.entryCount) === 1 ? "entry" : "entries"}` : w.status}</span><h2>${esc(w.name)}</h2><p class="meta">Locks ${date(w.picksLockAt)}</p></article>`,
        )
        .join("")
    : "<p>No open weeks yet. The commissioner is building the schedule.</p>";
  document
    .querySelectorAll(".week-card")
    .forEach((card) => (card.onclick = () => openWeek(card.dataset.id)));
  renderHistory();
}

function renderHistory() {
  $("#history-list").innerHTML = myEntriesData.length
    ? myEntriesData
        .map(
          (entry) =>
            `<article class="history-card" data-week-id="${entry.weekId}" data-entry-id="${entry.id}"><div><span class="pill">${esc(entry.status)}</span><h2>${esc(entry.weekName)} · Entry ${entry.entryNumber}</h2><p class="meta">${entry.submittedAt ? `Submitted ${date(entry.submittedAt)}` : "Draft entry"}</p></div><div class="history-score"><strong>${entry.correctPicks ?? "—"}</strong><span>correct</span></div><div class="history-score"><strong>${entry.tiebreakerDifference ?? "—"}</strong><span>tiebreak diff</span></div></article>`,
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
  games.sort(
    (a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt) || a.id - b.id,
  );
  $("#week-heading").innerHTML =
    `<div class="detail-title"><div><p class="eyebrow">Week ${week.weekNumber}</p><h2>${esc(week.name)}${entry ? ` · Entry ${entry.entryNumber}` : " · New entry"}</h2></div><p class="meta">Locks ${date(week.picksLockAt)}</p></div>`;
  const editable =
    week.status === "open" &&
    new Date(week.picksLockAt) > new Date() &&
    (!entry || ["draft", "rejected"].includes(entry.status));
  $(".ticket").classList.toggle("editable-ticket", editable);
  const canAddEntry =
    week.status === "open" && new Date(week.picksLockAt) > new Date();
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
  $("#checkout").hidden =
    !entry || !["draft", "rejected"].includes(entry.status);
  $("#checkout").textContent = paymentsEnabled
    ? "Pay & submit"
    : "Submit picks for review";
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
    currentWeek.entry = { ...saved, id: saved.id ?? saved.entryId };
    $("#checkout").hidden = false;
    $("#pick-message").textContent =
      "Picks saved. Payment will lock and submit them.";
  } catch (e) {
    $("#pick-message").textContent = e.message;
  }
};
$("#checkout").onclick = async () => {
  try {
    const entryId = currentWeek.entry.id ?? currentWeek.entry.entryId;
    const path = paymentsEnabled
      ? `/api/entries/${entryId}/checkout`
      : `/api/entries/${entryId}/submit-review`;
    const result = await api(path, {
      method: "POST",
    });
    if (paymentsEnabled) location.href = result.checkoutUrl;
    else {
      currentWeek.entry.status = result.status;
      $("#checkout").hidden = true;
      $("#picks-form").querySelector("button[type=submit]").hidden = true;
      $("#pick-message").textContent =
        "Picks submitted. The commissioner has been notified for review.";
      await loadWeeks();
    }
  } catch (e) {
    $("#pick-message").textContent = e.message;
  }
};

async function loadNotifications(markRead = false) {
  if (!me) return;
  if (markRead) await api("/api/notifications/read-all", { method: "POST" });
  const result = await api("/api/notifications");
  $("#review-count").hidden = result.unreadCount === 0;
  $("#review-count").textContent = result.unreadCount;
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
    .forEach(
      (item) =>
        (item.onclick = () =>
          openWeek(item.dataset.weekId, item.dataset.entryId)),
    );
}

async function loadPickReviews() {
  if (me?.role !== "admin") return;
  const reviews = await api("/api/admin/pick-reviews");
  $("#admin-menu-item").textContent = reviews.length
    ? `Commissioner tools (${reviews.length})`
    : "Commissioner tools";
  $("#pick-review-list").innerHTML = reviews.length
    ? reviews
        .map(
          (review) =>
            `<article class="review-item" data-entry-id="${review.entryId}"><div><strong>${esc(review.displayName)} · Entry ${review.entryNumber}</strong><span>${esc(review.weekName)} · ${review.pickCount} picks · Tiebreaker ${review.tiebreakerTotal}</span><small>${review.submittedAt ? date(review.submittedAt) : "Just submitted"}</small></div><div><button class="approve-review" type="button">Approve</button><button class="reject-review link" type="button">Reject</button></div></article>`,
        )
        .join("")
    : '<p class="empty-board">No entries are waiting for review.</p>';
  document.querySelectorAll(".approve-review").forEach(
    (button) =>
      (button.onclick = async () => {
        const entryId = button.closest(".review-item").dataset.entryId;
        button.disabled = true;
        try {
          await api(`/api/admin/pick-reviews/${entryId}/approve`, {
            method: "POST",
          });
          await Promise.all([
            loadPickReviews(),
            loadPicksBoard(),
            loadNotifications(),
          ]);
        } catch (error) {
          $("#admin-message").textContent = error.message;
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
          await api(`/api/admin/pick-reviews/${entryId}/reject`, {
            method: "POST",
            body: JSON.stringify({ reason }),
          });
          await Promise.all([loadPickReviews(), loadNotifications()]);
        } catch (error) {
          $("#admin-message").textContent = error.message;
        }
      }),
  );
}
async function loadLeaderboard(id) {
  const rows = await api(`/api/weeks/${id}/leaderboard`);
  $("#leaderboard").innerHTML = rows.length
    ? `<h2>Leaderboard</h2><table class="leader-table"><thead><tr><th>Player</th><th>Correct</th><th>Monday diff</th><th>Prize</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}. ${esc(r.displayName)}</td><td>${r.correctPicks ?? "—"}</td><td>${r.tiebreakerDifference ?? "—"}</td><td>${r.prizeCents != null ? money(r.prizeCents) : "—"}</td></tr>`).join("")}</tbody></table>`
    : "";
}

async function loadTeams() {
  const teams = await api("/api/admin/teams");
  document.querySelectorAll("#game-form select").forEach((select) => {
    select.innerHTML =
      select.children[0].outerHTML +
      teams
        .map(
          (t) =>
            `<option value="${t.id}">${esc(t.abbreviation)} — ${esc(t.city)} ${esc(t.name)}</option>`,
        )
        .join("");
  });
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
    await Promise.all([loadTeams(), loadWeeks()]);
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
    await Promise.all([loadTeams(), loadWeeks()]);
  } catch (error) {
    $("#admin-message").textContent = error.message;
  } finally {
    event.target.value = "";
  }
};
function formObject(form) {
  return Object.fromEntries(new FormData(form));
}
function wireForm(id, path, transform = (body) => body, method = "POST") {
  $(id).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const body = transform(formObject(e.target));
      const result = await api(typeof path === "function" ? path(body) : path, {
        method,
        body: JSON.stringify(body),
      });
      $("#admin-message").textContent =
        `Saved successfully${result.id ? ` (ID ${result.id})` : ""}.`;
      e.target.reset();
      if (id === "#team-form") loadTeams();
    } catch (error) {
      $("#admin-message").textContent = error.message;
    }
  };
}
wireForm("#team-form", "/api/admin/teams");
wireForm("#season-form", "/api/admin/seasons", (b) => ({
  ...b,
  year: Number(b.year),
}));
wireForm("#week-form", "/api/admin/weeks", (b) => ({
  ...b,
  seasonId: Number(b.seasonId),
  weekNumber: Number(b.weekNumber),
  picksLockAt: new Date(b.picksLockAt).toISOString(),
  status: "open",
}));
wireForm("#game-form", "/api/admin/games", (b) => ({
  ...b,
  weekId: Number(b.weekId),
  awayTeamId: Number(b.awayTeamId),
  homeTeamId: Number(b.homeTeamId),
  kickoffAt: new Date(b.kickoffAt).toISOString(),
  isMondayTiebreaker: b.isMondayTiebreaker === "on",
}));
wireForm(
  "#result-form",
  (b) => `/api/admin/games/${b.gameId}/result`,
  (b) => ({ awayScore: Number(b.awayScore), homeScore: Number(b.homeScore) }),
  "PATCH",
);
wireForm(
  "#score-form",
  (b) => `/api/admin/weeks/${b.weekId}/score`,
  () => ({}),
);
boot();
