// db.js - MongoDB models for B1 Mobile Wallet
import mongoose from "mongoose";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 10;

// --------------------
// Database Connection
// --------------------
export async function connectDB() {
  try {
    const uri =
      process.env.MONGO_URI ||
      "mongodb+srv://<your_username>:<your_password>@cluster0.mongodb.net/b1wallet";
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}

// --------------------
// User Schema
// --------------------
const userSchema = new mongoose.Schema({
  name: { type: String },
  gcashNumber: { type: String, unique: true },
  pin: { type: String },
  passwordHash: { type: String, required: true },
  walletBalance: { type: Number, default: 0 },
  roi: { type: Number, default: 0 },
  dateCreated: { type: Date, default: Date.now },
  isAdmin: { type: Boolean, default: false },
  adminUsername: { type: String },
});

// Secure password hash before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("passwordHash")) return next();
  const hashed = await bcrypt.hash(this.passwordHash, SALT_ROUNDS);
  this.passwordHash = hashed;
  next();
});

userSchema.methods.verifyPassword = async function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

// --------------------
// Receipt Schema
// --------------------
const receiptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  amount: { type: Number, required: true },
  receiptPath: { type: String },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "expired"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
});

// --------------------
// Investment Schema
// --------------------
const investmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  amount: { type: Number, required: true },
  date: { type: Date, default: Date.now },
  status: { type: String, enum: ["approved", "pending"], default: "pending" },
  roiPercent: { type: Number, default: 0 },
});

// --------------------
// Models
// --------------------
export const User = mongoose.model("User", userSchema);
export const Receipt = mongoose.model("Receipt", receiptSchema);
export const Investment = mongoose.model("Investment", investmentSchema);

// --------------------
// Seed Admin
// --------------------
export async function seedAdmin() {
  const existing = await User.findOne({ isAdmin: true });
  if (existing) return;

  const admin = new User({
    name: "System Admin",
    gcashNumber: "00000000000",
    pin: "0000",
    isAdmin: true,
    adminUsername: "AdminGcash",
    passwordHash: "987654321",
  });
  await admin.save();
  console.log("👑 Admin account created: AdminGcash / 987654321");
}
