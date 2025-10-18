// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const csvStringify = require('csv-stringify');
const cron = require('node-cron');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session setup
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: './data' }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

// Ensure uploads dir
const UPLOADS = path.join(__dirname, 'uploads');
if(!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);

// Multer for file uploads (limit files to 5MB)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + Math.random().toString(36).slice(2,8) + path.extname(file.originalname);
    cb(null, safe);
  }
});
const upload = multer({ storage, limits:{ fileSize:5*1024*1024 } });

// ---------- Helpers ----------
function requireAuth(req,res,next){
  if(req.session && req.session.userId) return next();
  return res.status(401).json({error:'not_authenticated'});
}
function requireAdmin(req,res,next){
  if(req.session && req.session.isAdmin) return next();
  return res.status(403).json({error:'admin_required'});
}

// ---------- Auth routes ----------
app.post('/api/auth/register', async (req,res) => {
  const { name, number, pin, password } = req.body;
  if(!number || !name || !pin || !password) return res.status(400).json({error:'missing_fields'});
  const exists = db.getUserByNumber(number);
  if(exists) return res.status(409).json({error:'user_exists'});
  const hash = await bcrypt.hash(password, 12);
  const userId = db.createUser({ name, number, pin, passwordHash:hash });
  res.json({ userId });
});

app.post('/api/auth/login', async (req,res) => {
  const { number, password } = req.body;
  const user = db.getUserByNumber(number);
  if(!user) return res.status(401).json({error:'invalid_credentials'});
  const ok = await bcrypt.compare(password, user.passwordHash);
  if(!ok) return res.status(401).json({error:'invalid_credentials'});
  req.session.userId = user.id;
  req.session.isAdmin = user.isAdmin ? 1 : 0;
  res.json({ message:'ok', isAdmin: !!user.isAdmin });
});

app.post('/api/auth/admin-login', async (req,res)=>{
  const { username, password } = req.body;
  const user = db.getUserByAdminUsername(username);
  if(!user) return res.status(401).json({error:'invalid_credentials'});
  const ok = await bcrypt.compare(password, user.passwordHash);
  if(!ok) return res.status(401).json({error:'invalid_credentials'});
  req.session.userId = user.id;
  req.session.isAdmin = 1;
  res.json({ message:'ok', isAdmin: true });
});

app.post('/api/auth/logout', (req,res)=>{
  req.session.destroy(()=>res.json({message:'logged_out'}));
});

// ---------- User endpoints ----------
app.get('/api/me', requireAuth, (req,res)=>{
  const user = db.getUserById(req.session.userId);
  if(!user) return res.status(404).json({error:'not_found'});
  delete user.passwordHash;
  res.json(user);
});

// Make investment (upload receipt) - one per month rule enforced in backend
app.post('/api/invest', requireAuth, upload.single('receipt'), (req,res)=>{
  const user = db.getUserById(req.session.userId);
  if(!user) return res.status(404).json({error:'user_not_found'});
  const { amount } = req.body;
  const amt = Number(amount);
  if(![1000,3000,5000,10000].includes(amt)) {
    if(req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({error:'invalid_amount'});
  }
  // check last investment month
  const last = db.getLastInvestmentForUser(user.id);
  if(last){
    const lastDate = new Date(last.date);
    const now = new Date();
    if(lastDate.getMonth()===now.getMonth() && lastDate.getFullYear()===now.getFullYear()){
      if(req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({error:'already_invested_this_month'});
    }
  }
  // check slot availability
  const slots = db.getSlots();
  if(slots[amt].available <= 0){
    if(req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({error:'no_slots_available'});
  }
  // decrement slot and create pending
  db.decrementSlot(amt);
  const entryId = db.createPending({ userId: user.id, amount: amt, receiptPath: req.file.path, createdAt: new Date().toISOString() });
  res.json({ message:'submitted', entryId });
});

// withdraw (simulated) - implementation placeholder
app.post('/api/withdraw', requireAuth, (req,res)=>{
  const user = db.getUserById(req.session.userId);
  if(user.wallet <= 0) return res.status(400).json({error:'no_balance'});
  db.updateUserWallet(user.id, 0);
  res.json({message:'withdraw_processed'});
});

// ---------- Admin endpoints ----------
app.get('/api/admin/pending', requireAuth, requireAdmin, (req,res)=>{
  const pend = db.getPending();
  res.json(pend);
});

app.post('/api/admin/approve', requireAuth, requireAdmin, (req,res)=>{
  const { pendingId } = req.body;
  const entry = db.getPendingById(pendingId);
  if(!entry) return res.status(404).json({error:'not_found'});
  const roiPercent = db.calculateROI(entry.amount);
  db.approvePending(entry.id, roiPercent);
  res.json({ message:'approved', roiPercent });
});

app.post('/api/admin/reject', requireAuth, requireAdmin, (req,res)=>{
  const { pendingId } = req.body;
  const entry = db.getPendingById(pendingId);
  if(!entry) return res.status(404).json({error:'not_found'});
  db.rejectPending(entry.id);
  res.json({ message:'rejected' });
});

app.post('/api/admin/delete-receipt', requireAuth, requireAdmin, (req,res)=>{
  const { pendingId } = req.body;
  const entry = db.getPendingById(pendingId);
  if(!entry) return res.status(404).json({error:'not_found'});
  db.deleteReceiptFile(entry.id);
  res.json({ message:'deleted' });
});

// CSV export for admin
app.get('/api/admin/export-csv', requireAuth, requireAdmin, (req,res)=>{
  const rows = db.getAllInvestmentsFlat();
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="investments.csv"');
  csvStringify(rows, { header: true }, (err, output) => {
    if(err) return res.status(500).send('error');
    res.send(output);
  });
});

// Serve uploaded files securely (admin-only)
app.get('/uploads/:file', requireAuth, requireAdmin, (req,res)=>{
  const file = path.join(UPLOADS, path.basename(req.params.file));
  if(fs.existsSync(file)) return res.sendFile(file);
  res.status(404).send('not found');
});

// Auto-delete job (every hour)
cron.schedule('0 * * * *', ()=>{
  console.log('[cron] checking old receipts for deletion');
  const stale = db.getPendingOlderThanHours(60);
  stale.forEach(p=>{
    try{
      if(fs.existsSync(p.receiptPath)) fs.unlinkSync(p.receiptPath);
      db.deletePendingRecord(p.id);
      console.log('deleted', p.id);
    }catch(err){ console.error('err deleting',p.id,err) }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Server running on port', PORT));
