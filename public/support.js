const $ = (selector) => document.querySelector(selector);
async function api(path, options = {}) {
  const response = await fetch("/api/" + path, {
    ...options,
    headers: { "content-type": "application/json" },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to complete request");
  return body;
}
function renderRequests(container, rows, admin = false) {
  container.replaceChildren();
  if (!rows.length) container.textContent = "No requests yet.";
  for (const row of rows) {
    const item = document.createElement("article");
    const title = document.createElement("h3");
    title.textContent = `Request #${row.id}: ${row.category} (${row.status})`;
    const text = document.createElement("p");
    text.textContent = row.message;
    const meta = document.createElement("p");
    meta.textContent = `${new Date(row.created_at).toLocaleString()}${admin ? " — " + row.display_name + " · " + row.email : ""}`;
    item.append(title, meta, text);
    if (admin) {
      const button = document.createElement("button");
      button.textContent = row.status === "open" ? "Mark resolved" : "Reopen";
      button.onclick = async () => {
        button.disabled = true;
        try {
          await api("support/admin/requests/" + row.id, {
            method: "PATCH",
            body: JSON.stringify({
              status: row.status === "open" ? "resolved" : "open",
            }),
          });
          await loadAdmin();
        } catch (error) {
          $("#admin-message").textContent = error.message;
          button.disabled = false;
        }
      };
      item.append(button);
    }
    container.append(item);
  }
}
async function loadAdmin() {
  renderRequests(
    $("#admin-requests"),
    await api("support/admin/requests"),
    true,
  );
}
async function loadRequests() {
  renderRequests($("#my-requests"), await api("support/requests"));
}
async function boot() {
  try {
    const me = await api("auth/me");
    if (!me) return;
    $("#signed-in-tools").hidden = false;
    $("#signin-note").hidden = true;
    const prefs = await api("support/preferences");
    $("#reminders").checked = prefs.reminders;
    $("#results").checked = prefs.results;
    await loadRequests();
    if (me.role === "admin") {
      $("#admin-tools").hidden = false;
      await loadAdmin();
    }
  } catch (error) {
    $("#page-message").textContent = error.message;
  }
}
$("#preferences").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    await api("support/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        reminders: $("#reminders").checked,
        results: $("#results").checked,
      }),
    });
    $("#preference-message").textContent = "Email preferences saved.";
  } catch (error) {
    $("#preference-message").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
$("#request-form").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    const result = await api("support/requests", {
      method: "POST",
      body: JSON.stringify({
        category: $("#category").value,
        message: $("#request-message").value,
      }),
    });
    $("#request-status").textContent = result.message;
    event.target.reset();
    await loadRequests();
  } catch (error) {
    $("#request-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
boot();
