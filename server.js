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
  const accounts = role === "student" ? db.students : role === "admin" ? db.admins : [];
  const account = accounts.find((candidate) => {
    const matchesIdentifier = role === "student"
      ? candidate.studentId === identifier
      : candidate.adminId === identifier;
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
    identifier: role === "student" ? account.studentId : account.adminId,
  });
});

// --- tiny JSON-file "database" ---
const readDB = () => {
  if (!fs.existsSync(DB_FILE)) return { complaints: [] };
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
};

const writeDB = (data) =>
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

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

  if (req.body.status) complaint.status = req.body.status;
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