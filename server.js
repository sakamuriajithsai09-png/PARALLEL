// PARALLEL — Backend Server (Express)
// Run: npm install  →  node server.js   (serves API on http://localhost:5000)

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 5000;
const DB_FILE = path.join(__dirname, "db.json");
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, "public");
let runtimeDB;

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.get("/student-app", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "parallel_student_app.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.post("/api/auth/login", (req, res) => {
  const { role, identifier, password } = req.body || {};
  const db = readDB();
  const accounts = role === "student" ? db.students : role === "admin" ? db.admins : role === "staff" ? db.staff : [];
  const account = accounts.find((candidate) => {
    const matchesIdentifier = role === "student"
      ? candidate.studentId === identifier
      : role === "admin"
        ? candidate.adminId === identifier
        : candidate.staffId === identifier;
    return matchesIdentifier && candidate.password === password;
  });

  if (!account) {
    return res.status(401).json({
      error: role === "student" ? "Invalid Student ID or Password." : "Invalid Admin ID or Password."
    });
  }

  res.json({
    role,
    name: account.name,
    identifier: role === "student" ? account.studentId : role === "admin" ? account.adminId : account.staffId,
    department: account.department || "",
  });
});

// --- tiny JSON-file "database" ---
const readDB = () => {
  if (runtimeDB) return runtimeDB;
  if (!fs.existsSync(DB_FILE)) return { complaints: [] };
  runtimeDB = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  return runtimeDB;
};

const writeDB = (data) => {
  runtimeDB = data;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    if (!['EROFS', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    console.warn('Database file is read-only; keeping this update in server memory.');
  }
};

// GET all complaints
app.get("/api/complaints", (req, res) => {
  const db = readDB();
  res.json(db.complaints);
});

// POST new complaint
app.post("/api/complaints", (req, res) => {
  const db = readDB();
  const {
    studentId,
    name,
    category,
    location,
    description,
    subissue,
    priority,
    department,
  } = req.body;

  if (!studentId || !name || !category || !location || !description) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const newComplaint = {
    id: db.nextId || 1000,
    studentId,
    name,
    category,
    location,
    description,
    subissue: subissue || category,
    priority: priority || "MEDIUM",
    department: department || "General Maintenance",
    status: "Pending",
    createdAt: new Date().toISOString(),
  };

  db.nextId = newComplaint.id + 1;
  db.complaints.push(newComplaint);
  writeDB(db);

  res.status(201).json(newComplaint);
});

// PUT update complaint status
app.put("/api/complaints/:id", (req, res) => {
  const db = readDB();
  const complaint = db.complaints.find(
    (c) => c.id === parseInt(req.params.id)
  );

  if (!complaint) {
    return res.status(404).json({ error: "Complaint not found" });
  }

  if (req.body.status) {
    const statuses = { PENDING: 0, IN_PROGRESS: 1, RESOLVED: 2 };
    const nextStatus = String(req.body.status).toUpperCase().replace(" ", "_");
    const currentStatus = String(complaint.status || "PENDING").toUpperCase().replace(" ", "_");
    const proof = typeof req.body.proof === "string" ? req.body.proof.trim() : "";

    if (!Object.prototype.hasOwnProperty.call(statuses, nextStatus)) {
      return res.status(400).json({ error: "Invalid complaint status" });
    }
    if (statuses[nextStatus] <= (statuses[currentStatus] ?? 0)) {
      return res.status(400).json({ error: "Status can only be upgraded" });
    }
    if (proof.length < 10) {
      return res.status(400).json({ error: "Valid proof is required to upgrade the complaint status." });
    }

    complaint.status = nextStatus;
    complaint.proof = proof;
    complaint.proofFile = typeof req.body.proofFile === "string" ? req.body.proofFile.trim() : "";
    complaint.proofAt = new Date().toISOString();
  }
  if (req.body.rating !== undefined) complaint.rating = req.body.rating;
  if (req.body.staff) complaint.staff = req.body.staff;
  if (req.body.department) complaint.department = req.body.department;
  if (req.body.priority) complaint.priority = req.body.priority;
  if (req.body.dueDate) complaint.dueDate = req.body.dueDate;

  writeDB(db);
  res.json(complaint);
});

if (require.main === module) {
  app.listen(PORT, () =>
    console.log(`PARALLEL server running on http://localhost:${PORT}`)
  );
}

module.exports = app;