const fs = require("fs");
const path = require("path");

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbPath = path.join(__dirname, "..", "db.json");

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before migrating users.");
  process.exit(1);
}

function accountEmail(account) {
  if (account.role === "student") {
    const email = String(account.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Student ${account.identifier} needs a real email in db.json before migration.`);
    }
    return email;
  }

  const safeId = account.identifier.toLowerCase().replace(/[^a-z0-9._+-]/g, "-");
  return `parallel-${account.role}-${safeId}@parallel-campus.org`;
}

function legacyAccountEmails(account) {
  const safeId = account.identifier.toLowerCase().replace(/[^a-z0-9._+-]/g, "-");
  if (account.role === "student") {
    return [
      `parallel-student-${safeId}@parallel-campus.org`,
      `parallel-student-${safeId}@example.com`,
    ];
  }
  return [`parallel-${account.role}-${safeId}@example.com`];
}

async function adminRequest(route, options = {}) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/admin/${route}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.msg || result.message || result.error_description || `Supabase returned ${response.status}`);
  }
  return result;
}

async function listUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const result = await adminRequest(`users?page=${page}&per_page=1000`);
    const batch = result.users || [];
    users.push(...batch);
    if (batch.length < 1000) return users;
  }
}

async function main() {
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  const roles = [
    ["student", db.students || [], "studentId"],
    ["admin", db.admins || [], "adminId"],
    ["staff", db.staff || [], "staffId"],
  ];
  const accounts = roles.flatMap(([role, entries, idField]) => entries.map((entry) => ({
    role,
    identifier: String(entry[idField] || "").trim(),
    name: entry.name || "",
    department: entry.department || "",
    email: entry.email || "",
    password: entry.password || "",
  })));

  if (accounts.some((account) => !account.identifier || (account.password && typeof account.password !== "string"))) {
    throw new Error("Every account needs an ID, and any supplied password must be a string.");
  }
  accounts.forEach((account) => { account.email = accountEmail(account); });

  const existingUsers = await listUsers();
  const usersByEmail = new Map(existingUsers.map((user) => [String(user.email).toLowerCase(), user]));
  let migrated = 0;

  for (const account of accounts) {
    const email = account.email;
    const metadata = {
      role: account.role,
      identifier: account.identifier,
      name: account.name,
      department: account.department,
    };
    const existingUser = usersByEmail.get(email.toLowerCase())
      || legacyAccountEmails(account).map((legacyEmail) => usersByEmail.get(legacyEmail.toLowerCase())).find(Boolean);
    if (!existingUser && !account.password) {
      throw new Error(`No password is available to create ${account.role} ${account.identifier}.`);
    }

    const user = existingUser
      ? await adminRequest(`users/${existingUser.id}`, {
        method: "PUT",
        body: JSON.stringify({
          email,
          ...(account.password ? { password: account.password } : {}),
          email_confirm: true,
          app_metadata: metadata,
        }),
      })
      : await adminRequest("users", {
        method: "POST",
        body: JSON.stringify({ email, password: account.password, email_confirm: true, app_metadata: metadata }),
      });

    usersByEmail.set(email.toLowerCase(), user);
    migrated += 1;
    console.log(`Migrated ${account.role}: ${account.identifier}`);
  }

  console.log(`Migration complete: ${migrated} accounts are ready in Supabase Auth.`);
}

main().catch((error) => {
  console.error(`Supabase account migration failed: ${error.message}`);
  process.exitCode = 1;
});