import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "../dist/app.js";
import { pool } from "../dist/db/pool.js";
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let userId;
async function call(path, method = "GET", body, cookie, status = 200) {
  const response = await fetch(base + "/api/" + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return { data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
try {
  const body = {
    email: `support-${randomUUID()}@example.invalid`,
    displayName: "Support test",
    password: "SupportTest!2026",
    confirmPassword: "SupportTest!2026",
  };
  await call("auth/register", "POST", body, undefined, 400);
  const registered = await call(
    "auth/register",
    "POST",
    { ...body, acceptTerms: true },
    undefined,
    201,
  );
  userId = registered.data.id;
  const cookie = registered.cookie;
  const [users] = await pool.query(
    "SELECT terms_version,terms_accepted_at FROM users WHERE id=?",
    [userId],
  );
  assert.equal(users[0].terms_version, "2026-09-06");
  assert.ok(users[0].terms_accepted_at);
  assert.deepEqual((await call("groups", "GET", undefined, cookie)).data, []);
  await call("support/preferences", "GET", undefined, undefined, 401);
  await call(
    "support/preferences",
    "PATCH",
    { reminders: false, results: false },
    cookie,
  );
  assert.deepEqual(
    (await call("support/preferences", "GET", undefined, cookie)).data,
    { reminders: false, results: false },
  );
  await call(
    "support/requests",
    "POST",
    {
      category: "deletion",
      message: "Please review and delete my test account.",
    },
    cookie,
    201,
  );
  const requests = (await call("support/requests", "GET", undefined, cookie))
    .data;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, "open");
  await call("support/admin/requests", "GET", undefined, cookie, 403);
  await call(
    "support/admin/requests/" + requests[0].id,
    "PATCH",
    { status: "resolved" },
    cookie,
    403,
  );
  await call('admin/users','GET',undefined,cookie,403);
  await pool.execute("UPDATE users SET role='admin' WHERE id=?", [userId]);
  await call('admin/users','GET',undefined,undefined,401);
  const directory=(await call('admin/users?q='+encodeURIComponent(body.email),'GET',undefined,cookie)).data;
  assert.equal(directory.total,1);
  assert.equal(directory.users[0].id,userId);
  assert.deepEqual(Object.keys(directory.users[0]).sort(),['createdAt','displayName','email','groupCount','id','role']);
  assert.equal((await call('admin/users?q='+encodeURIComponent(body.email)+'&page=2','GET',undefined,cookie)).data.users.length,0);
  await call('admin/users?page=0','GET',undefined,cookie,400);
  assert.ok(
    (await call("support/admin/requests", "GET", undefined, cookie)).data.some(
      (row) => row.id === requests[0].id,
    ),
  );
  await call(
    "support/admin/requests/" + requests[0].id,
    "PATCH",
    { status: "resolved" },
    cookie,
  );
  assert.equal(
    (await call("support/requests", "GET", undefined, cookie)).data[0].status,
    "resolved",
  );
  for (const path of ["privacy", "terms", "rules", "cookies", "support"]) {
    const response = await fetch(base + "/" + path + ".html");
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes("Redcrows Solutions"));
  }
  console.log(
    "PASS: required Terms acceptance, stored version/date, no-group preferences and requests, authenticated access, admin-only request handling, public information pages.",
  );
} finally {
  if (userId) {
    await pool.execute("DELETE FROM sessions WHERE user_id=?", [userId]);
    await pool.execute("DELETE FROM users WHERE id=?", [userId]);
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
