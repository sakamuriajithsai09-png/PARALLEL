// PARALLEL v2.0 — Enterprise Backend Server (Express)
// Serves API on http://localhost:5000 and powers Vercel Serverless Function (api/index.js)

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;
const DB_FILE = path.join(__dirname, "db.json");
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, "public");
let runtimeDB = null;

function readDB() {
  if (runtimeDB) return runtimeDB;
  if (!fs.existsSync(DB_FILE)) {
    runtimeDB = { students: [], admins: [], staff: [], complaints: [], nextId: 1000 };
    return runtimeDB;
  }
  try {
    runtimeDB = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch (err) {
    console.error("Error reading db.json:", err);
    runtimeDB = { students: [], admins: [], staff: [], complaints: [], nextId: 1000 };
  }
  runtimeDB.students = runtimeDB.students || [];
  runtimeDB.admins = runtimeDB.admins || [];
  runtimeDB.staff = runtimeDB.staff || [];
  runtimeDB.complaints = runtimeDB.complaints || [];

  if (!runtimeDB.nextId || typeof runtimeDB.nextId !== "number") {
    const maxId = runtimeDB.complaints.reduce((max, c) => Math.max(max, Number(c.id) || 0), 999);
    runtimeDB.nextId = maxId + 1;
  }
  return runtimeDB;
}

function writeDB(data) {
  runtimeDB = data;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    if (!['EROFS', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    console.warn('Database file read-only; keeping update in server memory.');
  }
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR));

app.get("/download/project-zip", (req, res) => {
  const zipPath = path.join(PUBLIC_DIR, "parallel-project.zip");

  if (!fs.existsSync(zipPath)) {
    return res.status(404).send("Download file not found.");
  }

  res.download(zipPath, "parallel-project.zip");
});

// Helper: AI Classification Logic
function generateAiInsight(category, location, description) {
  const text = (description || "").toLowerCase();
  let dept = "Hostel Maintenance";
  let priority = "MEDIUM";
  let estTime = "3 Hours";
  let shortSummary = description.length > 60 ? description.substring(0, 57) + "..." : description;

  const cat = (category || "").toLowerCase();
  if (cat.includes("water") || text.includes("leak") || text.includes("pipe") || text.includes("tap")) {
    dept = "Water Supply";
    priority = text.includes("burst") || text.includes("profus") || text.includes("flood") ? "HIGH" : "MEDIUM";
    estTime = "2 Hours";
  } else if (cat.includes("electr") || text.includes("spark") || text.includes("fan") || text.includes("wire") || text.includes("power") || text.includes("ac")) {
    dept = "Electrical";
    priority = text.includes("spark") || text.includes("shock") || text.includes("smoke") ? "CRITICAL" : "HIGH";
    estTime = "1.5 Hours";
  } else if (cat.includes("mess") || cat.includes("food") || text.includes("lunch") || text.includes("dinner") || text.includes("canteen")) {
    dept = "Mess Management";
    priority = text.includes("sick") || text.includes("uncooked") || text.includes("stale") ? "HIGH" : "MEDIUM";
    estTime = "2 Hours";
  } else if (cat.includes("wifi") || cat.includes("wi-fi") || text.includes("network") || text.includes("internet") || text.includes("router")) {
    dept = "Wi-Fi";
    priority = text.includes("exam") || text.includes("lab") ? "HIGH" : "LOW";
    estTime = "2 Hours";
  } else if (cat.includes("clean") || text.includes("garbage") || text.includes("trash") || text.includes("washroom")) {
    dept = "Cleaning";
    priority = text.includes("overflow") || text.includes("foul") ? "HIGH" : "MEDIUM";
    estTime = "1 Hour";
  } else if (cat.includes("transport") || text.includes("bus") || text.includes("shuttle")) {
    dept = "Transport";
    priority = "MEDIUM";
    estTime = "4 Hours";
  } else if (cat.includes("security") || text.includes("gate") || text.includes("camera") || text.includes("theft")) {
    dept = "Security";
    priority = text.includes("theft") || text.includes("intrud") ? "CRITICAL" : "HIGH";
    estTime = "1 Hour";
  }

  return { dept, priority, estTime, shortSummary };
}

// ROUTE: Supabase Student Signup
app.post("/api/auth/signup", async (req, res) => {
  const { name, email, studentId, password } = req.body || {};
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedStudentId = String(studentId || "").trim();
  const normalizedName = String(name || "").trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(503).json({ error: "Authentication is not configured. Set the Supabase environment variables." });
  }
  if (normalizedName.length < 2 || normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || (normalizedStudentId && !/^2\d{9}$/.test(normalizedStudentId)) || typeof password !== "string" || !/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,32}$/.test(password)) {
    return res.status(400).json({ error: "Enter a name, valid email address, optional valid Student ID, and an 8-32 character password containing letters and numbers." });
  }

  try {
    const authResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({
        email: normalizedEmail,
        password,
        data: { role: "student", studentId: normalizedStudentId, name: normalizedName },
      }),
    });
    const authData = await authResponse.json();
    if (!authResponse.ok) {
      const authMessage = authData.msg || authData.message || "Unable to create student account.";
      if (/email rate limit exceeded/i.test(authMessage)) {
        return res.status(429).json({
          error: "Supabase's signup email limit has been reached. Disable email confirmation for these internal accounts or configure custom SMTP, then wait for the limit to reset before retrying.",
        });
      }
      return res.status(authResponse.status === 429 ? 429 : 400).json({
        error: authMessage,
      });
    }

    res.status(201).json({
      email: normalizedEmail,
      studentId: normalizedStudentId,
      requiresEmailConfirmation: !authData.session,
    });
  } catch (error) {
    console.error("Supabase signup request failed:", error.message);
    res.status(502).json({ error: "Could not reach the authentication service." });
  }
});

// ROUTE: Supabase Auth Login
app.post("/api/auth/login", async (req, res) => {
  const { role, identifier, password } = req.body || {};
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const normalizedId = String(identifier || "").trim().toLowerCase();

  if (role === 'admin') {
    const adminAccounts = [
      {
        adminId: 'superadmin',
        password: 'Admin@123',
        name: 'Super Admin',
        department: 'Administration'
      }
    ];

    const db = readDB();

    const accounts = [
      ...(db.admins || []),
      ...adminAccounts
    ];

    const account = accounts.find(candidate =>
      String(candidate.adminId || '').trim().toLowerCase() ===
        String(identifier || '').trim().toLowerCase()
      &&
      String(candidate.password || '').trim() ===
        String(password || '').trim()
    );

    if (!account) {
      return res.status(401).json({
        error: 'Invalid Admin ID or Password.'
      });
    }

    return res.json({
      role: 'admin',
      name: account.name,
      identifier: account.adminId,
      department: account.department
    });
  }
  if (!["student", "admin", "staff"].includes(role) || !normalizedId || typeof password !== "string" || !password) {
    return res.status(400).json({ error: "Role, ID, and password are required." });
  }

  if (role === "student" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedId)) {
    return res.status(400).json({ error: "Enter a valid student email address." });
  }

  const safeId = normalizedId.replace(/[^a-z0-9._+-]/g, "-");
  const email = role === "student" ? normalizedId : `parallel-${role}-${safeId}@parallel-campus.org`;

  try {
    const authResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({ email, password }),
    });
    const authData = await authResponse.json();
    if (!authResponse.ok) {
      return res.status(401).json({ error: "Invalid ID or password." });
    }

    const account = role === "student"
      ? { ...(authData.user?.app_metadata || {}), ...(authData.user?.user_metadata || {}) }
      : authData.user?.app_metadata || {};
    if (account.role !== role || (role !== "student" && String(account.identifier || "").toLowerCase() !== normalizedId)) {
      return res.status(403).json({ error: "This account is not authorized for the selected portal." });
    }

    const studentId = role === "student" ? String(account.studentId || account.identifier || "") : "";
    res.json({
      role,
      name: account.name || "",
      identifier: role === "student" ? studentId || authData.user?.email : account.identifier,
      studentId,
      email: authData.user?.email || normalizedId,
      department: account.department || "",
      accessToken: authData.access_token,
      refreshToken: authData.refresh_token,
      expiresIn: authData.expires_in,
    });
  } catch (error) {
    console.error("Supabase authentication request failed:", error.message);
    res.status(502).json({ error: "Could not reach the authentication service." });
  }
});

// ROUTE: Get Complaints (with optional filtering)
app.get("/api/complaints", (req, res) => {
  const db = readDB();
  const { studentId, staffId, department, status } = req.query;
  let result = db.complaints;

  if (studentId) {
    result = result.filter(c => String(c.studentId).toLowerCase() === String(studentId).toLowerCase());
  }
  if (staffId) {
    result = result.filter(c => String(c.staffId).toLowerCase() === String(staffId).toLowerCase());
  }
  if (department && department !== 'All Departments' && department !== 'ALL') {
    result = result.filter(c => String(c.department).toLowerCase().includes(String(department).toLowerCase()));
  }
  if (status && status !== 'ALL') {
    result = result.filter(c => String(c.status).toLowerCase() === String(status).toLowerCase());
  }

  res.json(result);
});

// ROUTE: Get Single Complaint Details
app.get("/api/complaints/:id", (req, res) => {
  const db = readDB();
  const complaint = db.complaints.find(c => c.id === parseInt(req.params.id));
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });
  res.json(complaint);
});

// ROUTE: Post New Complaint (Step 1: Student Submission + AI Detection)
app.post("/api/complaints", (req, res) => {
  const db = readDB();
  const {
    studentId,
    name,
    category,
    location,
    description,
    subissue,
    photoUrl
  } = req.body;

  if (!studentId || !name || !category || !location || !description) {
    return res.status(400).json({ error: "Required fields missing: studentId, name, category, location, description" });
  }

  const ai = generateAiInsight(category, location, description);

  const newComplaint = {
    id: db.nextId || 1000,
    studentId: String(studentId).trim(),
    name: String(name).trim(),
    category: String(category).trim(),
    location: String(location).trim(),
    description: String(description).trim(),
    subissue: subissue || category,
    priority: ai.priority,
    department: ai.dept,
    aiSummary: ai.shortSummary,
    estimatedTime: ai.estTime,
    status: "Pending Admin Verification",
    photoUrl: photoUrl || "",
    createdAt: new Date().toISOString()
  };

  db.nextId = newComplaint.id + 1;
  db.complaints.unshift(newComplaint);
  writeDB(db);

  res.status(201).json(newComplaint);
});

// ROUTE: Admin Verify Complaint (Step 3)
app.put("/api/complaints/:id/verify", (req, res) => {
  const db = readDB();
  const complaint = db.complaints.find(c => c.id === parseInt(req.params.id));
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const { action, notes, priority, department } = req.body;
  if (action === "reject") {
    complaint.status = "Rejected";
    complaint.adminNotes = notes || "Rejected by Admin";
  } else {
    complaint.status = "Verified";
    if (priority) complaint.priority = priority;
    if (department) complaint.department = department;
    if (notes) complaint.adminNotes = notes;
    complaint.verifiedAt = new Date().toISOString();
  }

  writeDB(db);
  res.json(complaint);
});

// ROUTE: Admin Assign Staff (Step 4)
app.put("/api/complaints/:id/assign", (req, res) => {
  const db = readDB();
  const complaint = db.complaints.find(c => c.id === parseInt(req.params.id));
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const { staffId, staffName, department, adminNotes } = req.body;
  if (!staffId || !staffName) {
    return res.status(400).json({ error: "Staff ID and Staff Name are required for assignment" });
  }

  complaint.staffId = staffId;
  complaint.staff = staffName;
  if (department) complaint.department = department;
  if (adminNotes) complaint.adminNotes = adminNotes;
  complaint.status = "Staff Assigned";
  complaint.assignedAt = new Date().toISOString();

  writeDB(db);
  res.json(complaint);
});

// ROUTE: Staff Action - Accept Task / Start Work / Upload Proof (Step 5 & 6)
app.put("/api/complaints/:id/staff-action", (req, res) => {
  const db = readDB();
  const complaint = db.complaints.find(c => c.id === parseInt(req.params.id));
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const { action, beforeImage, afterImage, videoUrl, notes } = req.body;

  if (action === "accept" || action === "start") {
    complaint.status = "Staff Working";
    complaint.workStartedAt = new Date().toISOString();
  } else if (action === "upload_proof") {
    if (!afterImage) {
      return res.status(400).json({ error: "Please add a repair photo before submitting." });
    }
    complaint.status = "Proof Under Admin Verification";
    if (beforeImage) complaint.beforeImage = beforeImage;
    if (afterImage) complaint.afterImage = afterImage;
    if (videoUrl) complaint.videoUrl = videoUrl;
    complaint.repairNotes = notes || "Repair completed successfully.";
    complaint.proofAt = new Date().toISOString();
  } else {
    return res.status(400).json({ error: "Invalid staff action" });
  }

  writeDB(db);
  res.json(complaint);
});

// ROUTE: Admin Proof Verification (Step 6 -> Step 7)
app.put("/api/complaints/:id/admin-proof-verify", (req, res) => {
  const db = readDB();
  const complaint = db.complaints.find(c => c.id === parseInt(req.params.id));
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const { action, comment } = req.body;

  if (action === "approve") {
    complaint.status = "Waiting Student Review";
    complaint.approvedByAdminAt = new Date().toISOString();
  } else if (action === "reject" || action === "rework") {
    complaint.status = "Staff Working";
    complaint.reworkComment = comment || "Admin requested rework. Please re-check resolution proof.";
  } else {
    return res.status(400).json({ error: "Invalid admin proof verification action" });
  }

  writeDB(db);
  res.json(complaint);
});

// ROUTE: Student Satisfaction Review & Rating / Auto-Reopen (Step 7 -> Step 8)
app.put("/api/complaints/:id/satisfaction", (req, res) => {
  const db = readDB();
  const complaint = db.complaints.find(c => c.id === parseInt(req.params.id));
  if (!complaint) return res.status(404).json({ error: "Complaint not found" });

  const { satisfied, rating, feedback } = req.body;

  if (satisfied === true || satisfied === "yes" || satisfied === "YES") {
    complaint.status = "Closed";
    complaint.rating = rating || 5;
    complaint.feedback = feedback || "Resolved to student satisfaction.";
    complaint.closedAt = new Date().toISOString();
  } else {
    complaint.status = "Reopened";
    complaint.priority = "CRITICAL"; // Automatically escalated to top priority
    complaint.feedback = feedback || "Student not satisfied with resolution.";
    complaint.reopenedAt = new Date().toISOString();
    complaint.reopenReason = feedback || "Resolution did not meet student satisfaction.";
    complaint.adminAlert = "URGENT: Reopened by student. High priority rework required!";
  }

  writeDB(db);
  res.json(complaint);
});

// ROUTE: Get Staff Members per Department
app.get("/api/staff", (req, res) => {
  const db = readDB();
  const staffList = db.staff.map(s => {
    const activeTasks = db.complaints.filter(c => c.staffId === s.staffId && (c.status === "Staff Assigned" || c.status === "Staff Working")).length;
    return {
      staffId: s.staffId,
      name: s.name,
      department: s.department || "",
      activeTasks,
      workload: activeTasks === 0 ? "AVAILABLE" : activeTasks < 3 ? "MODERATE" : "BUSY"
    };
  });
  res.json(staffList);
});

// ROUTE: Get Analytics Data
app.get("/api/analytics", (req, res) => {
  const db = readDB();
  const complaints = db.complaints;

  const total = complaints.length;
  const pendingVerification = complaints.filter(c => c.status === "Pending Admin Verification" || c.status === "Submitted").length;
  const staffAssigned = complaints.filter(c => c.status === "Staff Assigned").length;
  const staffWorking = complaints.filter(c => c.status === "Staff Working").length;
  const proofPending = complaints.filter(c => c.status === "Proof Under Admin Verification").length;
  const waitingStudentReview = complaints.filter(c => c.status === "Waiting Student Review").length;
  const closed = complaints.filter(c => c.status === "Closed").length;
  const reopened = complaints.filter(c => c.status === "Reopened").length;

  const inProgressTotal = staffAssigned + staffWorking + proofPending;
  const resolutionRate = total > 0 ? Math.round((closed / total) * 100) : 100;

  res.json({
    total,
    pendingVerification,
    inProgressTotal,
    proofPending,
    waitingStudentReview,
    closed,
    reopened,
    resolutionRate,
    staffCount: db.staff.length
  });
});

// Universal Catch-All HTML routes
app.get("/student-app", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "parallel_student_app.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`PARALLEL v2.0 Enterprise server running on http://localhost:${PORT}`));
}

module.exports = app;