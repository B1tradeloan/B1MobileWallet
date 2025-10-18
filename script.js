// ===========================================
// 🔐 B1 MOBILE WALLET FRONTEND SCRIPT
// Connected to: https://b1mobilewallet-1.onrender.com
// ===========================================

const API_URL = "https://b1mobilewallet-1.onrender.com"; // your live backend

// Remember user info
function saveUserData(user) {
  localStorage.setItem("b1_user", JSON.stringify(user));
}

function getUserData() {
  return JSON.parse(localStorage.getItem("b1_user"));
}

function clearUserData() {
  localStorage.removeItem("b1_user");
}

// ======================
// LOGIN HANDLER
// ======================
async function handleLogin(e) {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const role = document.querySelector('input[name="role"]:checked').value;

  if (!username || !password) {
    alert("Please fill in all fields.");
    return;
  }

  try {
    const response = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, role })
    });

    const data = await response.json();

    if (response.ok) {
      saveUserData(data.user);
      if (role === "admin") {
        window.location.href = "admin.html";
      } else {
        window.location.href = "dashboard.html";
      }
    } else {
      alert(data.message || "Invalid login credentials.");
    }
  } catch (err) {
    console.error(err);
    alert("Network error. Please try again later.");
  }
}

// ======================
// DASHBOARD DISPLAY
// ======================
async function loadDashboard() {
  const user = getUserData();
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  document.getElementById("user-id").textContent = user.id;
  document.getElementById("user-number").textContent = user.number;
  document.getElementById("user-balance").textContent = `₱${user.wallet.toFixed(2)}`;
  document.getElementById("user-roi").textContent = `${user.roi}%`;
  document.getElementById("date-created").textContent = user.createdAt;

  // fetch latest wallet data
  try {
    const res = await fetch(`${API_URL}/user/${user.id}`);
    const data = await res.json();
    if (res.ok) {
      document.getElementById("user-balance").textContent = `₱${data.wallet.toFixed(2)}`;
      document.getElementById("user-roi").textContent = `${data.roi}%`;
    }
  } catch (err) {
    console.error("Error fetching user data:", err);
  }
}

// ======================
// INVESTMENT BUTTONS
// ======================
async function invest(amount) {
  const user = getUserData();
  if (!user) {
    alert("Please login first.");
    return;
  }

  const confirmInvest = confirm(`Invest ₱${amount}?`);
  if (!confirmInvest) return;

  try {
    const res = await fetch(`${API_URL}/invest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, amount })
    });
    const data = await res.json();
    if (res.ok) {
      alert("Investment request created. Please upload your receipt for verification.");
      window.location.href = "upload.html?amount=" + amount;
    } else {
      alert(data.message);
    }
  } catch (err) {
    alert("Network error. Please try again later.");
  }
}

// ======================
// UPLOAD RECEIPT
// ======================
async function uploadReceipt(e) {
  e.preventDefault();

  const user = getUserData();
  const fileInput = document.getElementById("receipt");
  const formData = new FormData();
  formData.append("userId", user.id);
  formData.append("receipt", fileInput.files[0]);

  try {
    const res = await fetch(`${API_URL}/upload-receipt`, {
      method: "POST",
      body: formData
    });

    const data = await res.json();
    if (res.ok) {
      alert("Receipt uploaded successfully. Verification will take 25-60 hours.");
      window.location.href = "dashboard.html";
    } else {
      alert(data.message);
    }
  } catch (err) {
    alert("Error uploading receipt.");
  }
}

// ======================
// ADMIN DASHBOARD
// ======================
async function loadAdminDashboard() {
  const user = getUserData();
  if (!user || user.role !== "admin") {
    window.location.href = "index.html";
    return;
  }

  try {
    const res = await fetch(`${API_URL}/admin/receipts`);
    const receipts = await res.json();

    const container = document.getElementById("receipt-list");
    container.innerHTML = "";

    receipts.forEach(r => {
      const div = document.createElement("div");
      div.classList.add("receipt-item");
      div.innerHTML = `
        <p><b>User #${r.userId}</b> | ₱${r.amount} | ${r.status}</p>
        <img src="${API_URL}/uploads/${r.filename}" width="200"><br>
        <button onclick="approveReceipt(${r.id})">Approve</button>
        <button onclick="rejectReceipt(${r.id})">Reject</button>
      `;
      container.appendChild(div);
    });
  } catch (err) {
    console.error(err);
  }
}

async function approveReceipt(id) {
  if (!confirm("Approve this receipt?")) return;
  await fetch(`${API_URL}/admin/approve/${id}`, { method: "POST" });
  alert("Approved!");
  loadAdminDashboard();
}

async function rejectReceipt(id) {
  if (!confirm("Reject this receipt?")) return;
  await fetch(`${API_URL}/admin/reject/${id}`, { method: "POST" });
  alert("Rejected.");
  loadAdminDashboard();
}

// ======================
// LOGOUT
// ======================
function logout() {
  clearUserData();
  window.location.href = "index.html";
}
