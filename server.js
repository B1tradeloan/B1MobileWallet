// server.js - B1 Mobile Wallet (Render-ready, MongoDB via Mongoose)
import express from "express";
import dotenv from "dotenv";
import session from "express-session";
import MongoStore from "connect-mongo";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import { connectDB, User, Receipt, Investment, seedAdmin } from "./db.js";

dotenv.config();
await connectDB(); // connect to MongoDB
await seedAdmin();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session store using MongoDB
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGO_URI,
  collectionName: "sessions",
});
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change_this_secret",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  })
);

// Ensure uploads folder exists
const UPLOADS = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename: (req, file, cb) => {
    cb(
      null,
      Date.now() +
        "-" +
        Math.random().toString(36).slice(2, 8) +
        path.extname(file.originalname)
    );
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ---------- Middleware ----------
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: "not_authenticated" });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(403).json({ error: "admin_required" });
}

// ---------- Routes ----------

// Health check
app.get("/", (req, res) =>
  res.json({ status: "B1 Mobile Wallet Backend Running" })
);

// --- Authentication ---

// User registration
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, number, pin, password } = req.body;
    if (!name || !number || !pin || !password)
      return res.status(400).json({ error: "missing_fields" });

    const exists = await User.findOne({ gcashNumber: number });
    if (exists) return res.status(409).json({ error: "user_exists" });

    const user = await User.create({
      name,
      gcashNumber: number,
      pin,
      passwordHash: password,
    });
    res.json({ message: "registered", userId: user._id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

// User login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { number, password } = req.body;
    const user = await User.findOne({ gcashNumber: number });
    if (!user) return res.status(401).json({ error: "invalid_credentials" });

    const ok = await user.verifyPassword(password);
    if (!ok) return res.status(401).json({ error: "invalid_credentials" });

    req.session.userId = user._id.toString();
    req.session.isAdmin = !!user.isAdmin;
    res.json({ message: "ok", isAdmin: !!user.isAdmin });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

// Admin login
app.post("/api/auth/admin-login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ adminUsername: username, isAdmin: true });
    if (!user) return res.status(401).json({ error: "invalid_credentials" });

    const ok = await user.verifyPassword(password);
    if (!ok) return res.status(401).json({ error: "invalid_credentials" });

    req.session.userId = user._id.toString();
    req.session.isAdmin = true;
    res.json({ message: "ok", isAdmin: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ message: "logged_out" }));
});

// Get current user info
app.get("/api/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId).select(
    "-passwordHash -__v"
  );
  if (!user) return res.status(404).json({ error: "not_found" });
  res.json(user);
});

// --- Investments ---

// Upload receipt and request verification
app.post("/api/invest", requireAuth, upload.single("receipt"), async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: "user_not_found" });

    const amount = Number(req.body.amount);
    if (![1000, 3000, 5000, 10000].includes(amount)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "invalid_amount" });
    }

    // check one investment per month
    const last = await Investment.findOne({ userId: user._id }).sort({ date: -1 });
    if (last) {
      const lastDate = new Date(last.date);
      const now = new Date();
      if (
        lastDate.getMonth() === now.getMonth() &&
        lastDate.getFullYear() === now.getFullYear()
      ) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "already_invested_this_month" });
      }
    }

    const slots = JSON.parse(
      process.env.SLOTS_JSON ||
        '{"1000":23,"3000":10,"5000":7,"10000":4}'
    );
    if ((slots[amount] || 0) <= 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "no_slots_available" });
    }

    const receipt = await Receipt.create({
      userId: user._id,
      amount,
      receiptPath: req.file.path,
      status: "pending",
      createdAt: new Date(),
    });
    res.json({ message: "submitted", id: receipt._id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

// --- Admin Functions ---

// List pending receipts
app.get("/api/admin/pending", requireAuth, requireAdmin, async (req, res) => {
  const pend = await Receipt.find({ status: "pending" }).populate(
    "userId",
    "name gcashNumber"
  );
  res.json(pend);
});

// Approve investment
app.post("/api/admin/approve", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { pendingId } = req.body;
    const rec = await Receipt.findById(pendingId);
    if (!rec) return res.status(404).json({ error: "not_found" });

    const roiPercent = calculateROI(rec.amount);
    await Investment.create({
      userId: rec.userId,
      amount: rec.amount,
      date: new Date(),
      status: "approved",
      roiPercent,
    });

    const user = await User.findById(rec.userId);
    user.walletBalance = (user.walletBalance || 0) + rec.amount;
    user.roi = roiPercent;
    await user.save();

    try {
      if (rec.receiptPath && fs.existsSync(rec.receiptPath))
        fs.unlinkSync(rec.receiptPath);
    } catch (e) {}
    rec.status = "approved";
    await rec.save();

    res.json({ message: "approved", roiPercent });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

// Reject investment
app.post("/api/admin/reject", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { pendingId } = req.body;
    const rec = await Receipt.findById(pendingId);
    if (!rec) return res.status(404).json({ error: "not_found" });
    try {
      if (rec.receiptPath && fs.existsSync(rec.receiptPath))
        fs.unlinkSync(rec.receiptPath);
    } catch (e) {}
    rec.status = "rejected";
    await rec.save();
    res.json({ message: "rejected" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

// Delete receipt file (admin)
app.post("/api/admin/delete-receipt", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { pendingId } = req.body;
    const rec = await Receipt.findById(pendingId);
    if (!rec) return res.status(404).json({ error: "not_found" });
    try {
      if (rec.receiptPath && fs.existsSync(rec.receiptPath))
        fs.unlinkSync(rec.receiptPath);
    } catch (e) {}
    rec.receiptPath = null;
    await rec.save();
    res.json({ message: "deleted" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

// Export CSV
app.get("/api/admin/export-csv", requireAuth, requireAdmin, async (req, res) => {
  const docs = await Investment.find()
    .populate("userId", "name gcashNumber")
    .lean();
  const rows = docs.map((d) => ({
    investId: d._id,
    userName: d.userId.name,
    userNumber: d.userId.gcashNumber,
    amount: d.amount,
    date: d.date.toISOString(),
    roiPercent: d.roiPercent,
  }));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=investments.csv");
  const header = Object.keys(rows[0] || {}).join(",") + "\n";
  const body = rows.map((r) => Object.values(r).join(",")).join("\n");
  res.send(header + body);
});

// Serve uploaded receipts (admin only)
app.get("/uploads/:file", requireAuth, requireAdmin, (req, res) => {
  const p = path.join(UPLOADS, path.basename(req.params.file));
  if (fs.existsSync(p)) return res.sendFile(p);
  res.status(404).json({ error: "not_found" });
});

// Auto-delete pending receipts older than 60 hours
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 60 * 3600 * 1000);
    const stale = await Receipt.find({
      status: "pending",
      createdAt: { $lte: cutoff },
    });
    for (const s of stale) {
      try {
        if (s.receiptPath && fs.existsSync(s.receiptPath))
          fs.unlinkSync(s.receiptPath);
      } catch (e) {}
      s.status = "expired";
      await s.save();
    }
  } catch (e) {
    console.error("cron err", e);
  }
}, 1000 * 60 * 60);

// ROI calculation rule
function calculateROI(amount) {
  let roi = (amount / 1000) * 10;
  if (roi < -0.4) roi = -0.4;
  if (roi > 130) roi = 130;
  return Math.round(roi * 100) / 100;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server listening on", PORT));
