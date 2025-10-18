// db.js - lightweight SQLite helper for the project
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const dbFile = path.join(__dirname, 'data', 'b1.db');
if(!fs.existsSync(path.join(__dirname,'data'))) fs.mkdirSync(path.join(__dirname,'data'));
const db = new Database(dbFile);

// initialize tables
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  number TEXT UNIQUE,
  pin TEXT,
  passwordHash TEXT,
  createdAt TEXT,
  wallet REAL DEFAULT 0,
  roi REAL DEFAULT 0,
  isAdmin INTEGER DEFAULT 0,
  adminUsername TEXT
);

CREATE TABLE IF NOT EXISTS slots (
  amount INTEGER PRIMARY KEY,
  limitCount INTEGER,
  available INTEGER
);

CREATE TABLE IF NOT EXISTS pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  amount INTEGER,
  receiptPath TEXT,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS investments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  amount INTEGER,
  date TEXT,
  roiPercent REAL
);
`);

// seed default slots if not present
const slotCounts = {1000:50,3000:30,5000:10,10000:5};
const stmtCheck = db.prepare('SELECT COUNT(*) as c FROM slots');
const cnt = stmtCheck.get().c;
if(cnt===0){
  const ins = db.prepare('INSERT INTO slots (amount, limitCount, available) VALUES (@amount,@limit,@avail)');
  const insertMany = db.transaction((rows)=>{
    for(const r of rows) ins.run(r);
  });
  insertMany(Object.keys(slotCounts).map(a=>({amount:+a, limit:slotCounts[a], avail: slotCounts[a]})));
}

// create admin account if not exists (AdminGcash)
const adminExists = db.prepare('SELECT * FROM users WHERE isAdmin=1').get();
const bcrypt = require('bcrypt');
if(!adminExists){
  const passHash = bcrypt.hashSync('987654321',12);
  db.prepare('INSERT INTO users (name, number, pin, passwordHash, createdAt, wallet, roi, isAdmin, adminUsername) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('Admin','0000000000','0000', passHash, new Date().toISOString(), 0, 0, 1, 'AdminGcash');
}

module.exports = {
  getUserByNumber: (number) => db.prepare('SELECT * FROM users WHERE number=?').get(number),
  getUserById: (id) => db.prepare('SELECT id,name,number,pin,createdAt,wallet,roi,isAdmin,adminUsername FROM users WHERE id=?').get(id),
  getUserByAdminUsername: (username) => db.prepare('SELECT * FROM users WHERE adminUsername=?').get(username),
  createUser: ({name,number,pin,passwordHash}) => {
    const info = db.prepare('INSERT INTO users (name, number, pin, passwordHash, createdAt) VALUES (?,?,?,?,?)').run(name,number,pin,passwordHash,new Date().toISOString());
    return info.lastInsertRowid;
  },
  updateUserWallet: (userId, wallet) => db.prepare('UPDATE users SET wallet=? WHERE id=?').run(wallet,userId),
  getSlots: () => {
    const rows = db.prepare('SELECT amount,limitCount,available FROM slots').all();
    const out = {};
    rows.forEach(r=> out[r.amount] = {limit: r.limitCount, available: r.available});
    return out;
  },
  decrementSlot: (amount) => db.prepare('UPDATE slots SET available = available - 1 WHERE amount=? AND available>0').run(amount),
  createPending: ({userId, amount, receiptPath, createdAt}) => {
    const info = db.prepare('INSERT INTO pending (userId, amount, receiptPath, createdAt) VALUES (?,?,?,?)').run(userId,amount,receiptPath,createdAt);
    return info.lastInsertRowid;
  },
  getPending: () => db.prepare('SELECT p.id, p.userId, u.name as userName, u.number as userNumber, p.amount, p.receiptPath, p.createdAt FROM pending p JOIN users u ON u.id=p.userId').all(),
  getPendingById: (id) => db.prepare('SELECT * FROM pending WHERE id=?').get(id),
  getPendingOlderThanHours: (hours) => {
    const cutoff = new Date(Date.now() - hours*3600*1000).toISOString();
    return db.prepare('SELECT * FROM pending WHERE createdAt <= ?').all(cutoff);
  },
  deletePendingRecord: (id) => db.prepare('DELETE FROM pending WHERE id=?').run(id),
  rejectPending: (id) => {
    const row = db.prepare('SELECT * FROM pending WHERE id=?').get(id);
    if(!row) return;
    db.prepare('UPDATE slots SET available = available + 1 WHERE amount=?').run(row.amount);
    try{ if(row.receiptPath && fs.existsSync(row.receiptPath)) fs.unlinkSync(row.receiptPath) }catch(e){}
    db.prepare('DELETE FROM pending WHERE id=?').run(id);
  },
  deleteReceiptFile: (id) => {
    const row = db.prepare('SELECT * FROM pending WHERE id=?').get(id);
    if(!row) return;
    try{ if(row.receiptPath && fs.existsSync(row.receiptPath)) fs.unlinkSync(row.receiptPath) }catch(e){}
    db.prepare('UPDATE pending SET receiptPath=NULL WHERE id=?').run(id);
  },
  approvePending: (id, roiPercent) => {
    const row = db.prepare('SELECT * FROM pending WHERE id=?').get(id);
    if(!row) return;
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.userId);
    const newWallet = (user.wallet || 0) + row.amount;
    db.prepare('UPDATE users SET wallet=?, roi=? WHERE id=?').run(newWallet, roiPercent, user.id);
    db.prepare('INSERT INTO investments (userId, amount, date, roiPercent) VALUES (?,?,?,?)').run(user.id, row.amount, new Date().toISOString(), roiPercent);
    try{ if(row.receiptPath && fs.existsSync(row.receiptPath)) fs.unlinkSync(row.receiptPath) }catch(e){}
    db.prepare('DELETE FROM pending WHERE id=?').run(id);
  },
  getLastInvestmentForUser: (userId) => db.prepare('SELECT * FROM investments WHERE userId=? ORDER BY date DESC LIMIT 1').get(userId),
  calculateROI: (amount) => {
    let roi = (amount/1000)*10;
    if(roi < -0.4) roi = -0.4;
    if(roi > 130) roi = 130;
    return Math.round(roi * 100)/100;
  },
  getAllInvestmentsFlat: () => {
    return db.prepare('SELECT i.id as investId, u.name as userName, u.number as userNumber, i.amount, i.date, i.roiPercent FROM investments i JOIN users u ON u.id=i.userId').all();
  }
};
