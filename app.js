// ==========================================================
// DATASETS (INDIA + UAE + OB)
// ==========================================================
const datasets = {
  INDIA: {
    name: "India Expenses",
    currency: "₹",
    expenseCSV: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT9Njnwjzj_xKwyoL11rSQlEsqOPZd_7bcqkTedl47tjGWrWko8y3c5vKcPtQ8p9wfiXuXRKEQ-AXbu/pub?gid=1144592483&single=true&output=csv",
    receiptsCSV: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT9Njnwjzj_xKwyoL11rSQlEsqOPZd_7bcqkTedl47tjGWrWko8y3c5vKcPtQ8p9wfiXuXRKEQ-AXbu/pub?gid=662383262&single=true&output=csv",
    contraCSV: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT9Njnwjzj_xKwyoL11rSQlEsqOPZd_7bcqkTedl47tjGWrWko8y3c5vKcPtQ8p9wfiXuXRKEQ-AXbu/pub?gid=1766372454&single=true&output=csv",
    obCSV: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT9Njnwjzj_xKwyoL11rSQlEsqOPZd_7bcqkTedl47tjGWrWko8y3c5vKcPtQ8p9wfiXuXRKEQ-AXbu/pub?gid=585847532&single=true&output=csv"
  }
};

let currentDataset = datasets.INDIA;
let currencySymbol = currentDataset.currency;

let expenseData = [];
let receiptData = [];
let contraData = [];
let openingBalanceData = [];

const pageSize = 25;
let expensePage = 1;
let receiptPage = 1;
let contraPage = 1;

let expenseTrendChart, expenseModeChart, expenseGroupChart, receiptVsExpenseChart;

// ==========================================================
// TEXT NORMALIZER (FIXES NBSP + EXTRA SPACES + CASE ISSUES)
// ==========================================================
function normalizeText(txt) {
  return (txt || "")
    .toString()
    .replace(/\u00A0/g, " ")   // remove NBSP (google sheets issue)
    .replace(/\s+/g, " ")     // collapse multiple spaces
    .trim()
    .toUpperCase();
}

// ==========================================================
// CSV PARSER
// ==========================================================
function parseCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (err) => reject(err)
    });
  });
}

// ==========================================================
// NUMBER PARSER (SUPPORTS (150.00) FORMAT)
// ==========================================================
function toNumber(value) {
  if (value === null || value === undefined) return 0;

  let v = String(value).trim();
  if (v === "") return 0;

  v = v.replace(/AED/gi, "");
  v = v.replace(/INR/gi, "");
  v = v.replace(/₹/g, "");
  v = v.replace(/\s+/g, "");

  let isBracketNegative = false;
  if (v.startsWith("(") && v.endsWith(")")) {
    isBracketNegative = true;
    v = v.slice(1, -1);
  }

  if (v.endsWith("-")) {
    v = "-" + v.slice(0, -1);
  }

  v = v.replace(/,/g, "");

  let num = parseFloat(v);
  if (isNaN(num)) return 0;

  if (isBracketNegative) num = -num;

  return num;
}

// ==========================================================
function formatMoney(num) {
  if (num === null || num === undefined || isNaN(num)) return "0.00";
  return Number(num).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function money(num) {
  return `${currencySymbol} ${formatMoney(num)}`;
}

function cleanRow(row) {
  const cleaned = {};
  for (let key in row) {
    cleaned[key.trim()] = (row[key] || "").toString().trim();
  }
  return cleaned;
}

function removeEmptyRows(data) {
  return data.map(cleanRow).filter(r => Object.values(r).some(v => v !== ""));
}

function parseDateValue(dateStr) {
  if (!dateStr) return new Date("1900-01-01");

  const clean = dateStr.split(",")[0].trim();
  const parts = clean.split("/");

  if (parts.length === 3) {
    const day = parts[0];
    const mon = parts[1];
    const year = parts[2];
    return new Date(`${day} ${mon} ${year}`);
  }

  return new Date(clean);
}

// ==========================================================
// LOADING UI
// ==========================================================
const LOADER_STYLE = 1;

function getLoaderHTML() {
  if (LOADER_STYLE === 2) {
    return `<div class="loader-dna"><div></div><div></div><div></div></div>`;
  }

  if (LOADER_STYLE === 3) {
    return `<div class="loader-dots"><span></span><span></span><span></span></div>`;
  }

  if (LOADER_STYLE === 4) {
    return `<div class="loader-spin"></div>`;
  }

  return `<div class="skeleton skeleton-value"></div>`;
}

function showLoadingUI() {
  document.getElementById("dashboardSubTitle").innerText = "Loading data...";

  document.getElementById("totalExpense").innerHTML = getLoaderHTML();
  document.getElementById("totalReceipts").innerHTML = getLoaderHTML();
  document.getElementById("netCashflow").innerHTML = getLoaderHTML();
  document.getElementById("totalContra").innerHTML = getLoaderHTML();

  document.getElementById("balanceCards").innerHTML = `
    <div class="col-12 text-center py-4">
      ${getLoaderHTML()}
    </div>
  `;

  document.getElementById("expenseTable").innerHTML =
    `<tr><td colspan="8" class="text-center py-4">${getLoaderHTML()}</td></tr>`;

  document.getElementById("receiptTable").innerHTML =
    `<tr><td colspan="5" class="text-center py-4">${getLoaderHTML()}</td></tr>`;

  document.getElementById("contraTable").innerHTML =
    `<tr><td colspan="5" class="text-center py-4">${getLoaderHTML()}</td></tr>`;
}

function setControlsEnabled(enabled) {
  const ids = [
    "refreshBtn",
    "monthFilter",
    "modeFilter",
    "groupFilter",
    "searchBox",
    "expenseSort",
    "receiptSort",
    "contraSort"
  ];

  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

// ==========================================================
// FILTERING / SEARCH
// ==========================================================
function applyFilters(data, type) {
  const selectedMonth = document.getElementById("monthFilter").value;
  const selectedMode = document.getElementById("modeFilter").value;
  const selectedGroup = document.getElementById("groupFilter").value;
  const selectedHome = document.getElementById("homeFilter").value;
  const q = document.getElementById("searchBox").value.trim().toLowerCase();

  const selectedModeNorm = normalizeText(selectedMode);

  let filtered = data.filter(r => r.Date);

  if (selectedMonth !== "ALL") {
    filtered = filtered.filter(r => (r.Month || "").trim() === selectedMonth);
  }

  // MODE FILTER
  if (selectedMode !== "ALL") {
    if (type === "expense" || type === "receipt") {
      filtered = filtered.filter(r =>
        normalizeText(r.Mode) === selectedModeNorm
      );
    }
    else if (type === "contra") {
      filtered = filtered.filter(r =>
        normalizeText(r.From) === selectedModeNorm ||
        normalizeText(r.To) === selectedModeNorm
      );
    }
  }

  // GROUP FILTER (ONLY FOR EXPENSE)
  if (selectedGroup !== "ALL") {
    if (type === "expense") {
      filtered = filtered.filter(r => (r.Group || "").trim() === selectedGroup);
    }
  }

  // HOME FILTER (ONLY FOR EXPENSE)
  if (selectedHome !== "ALL") {
    if (type === "expense") {
      filtered = filtered.filter(r => (r.Home || "").trim() === selectedHome);
    }
  }

  // SEARCH FILTER
  if (q) {
    filtered = filtered.filter(row =>
      Object.values(row).join(" ").toLowerCase().includes(q)
    );
  }

  return filtered;
}


function applySorting(data, sortValue) {
  let sorted = [...data];

  if (sortValue === "date_desc") sorted.sort((a, b) => parseDateValue(b.Date) - parseDateValue(a.Date));
  if (sortValue === "date_asc") sorted.sort((a, b) => parseDateValue(a.Date) - parseDateValue(b.Date));
  if (sortValue === "amount_desc") sorted.sort((a, b) => toNumber(b.Amount) - toNumber(a.Amount));
  if (sortValue === "amount_asc") sorted.sort((a, b) => toNumber(a.Amount) - toNumber(b.Amount));

  return sorted;
}

// ==========================================================
// DROPDOWNS
// ==========================================================
function fillDropdowns() {
  const monthSet = new Set();
  const modeSet = new Set();
  const groupSet = new Set();
  const homeSet = new Set();

  expenseData.forEach(r => {
    if (r.Month) monthSet.add(r.Month.trim());
    if (r.Mode) modeSet.add(normalizeText(r.Mode));
    if (r.Group) groupSet.add(r.Group.trim());
    if (r.Home) homeSet.add(r.Home.trim());
  });

  receiptData.forEach(r => {
    if (r.Month) monthSet.add(r.Month.trim());
    if (r.Mode) modeSet.add(normalizeText(r.Mode));
  });

  contraData.forEach(r => {
    if (r.Month) monthSet.add(r.Month.trim());
    if (r.From) modeSet.add(normalizeText(r.From));
    if (r.To) modeSet.add(normalizeText(r.To));
  });

  openingBalanceData.forEach(r => {
    if (r.Mode) modeSet.add(normalizeText(r.Mode));
  });

  const months = Array.from(monthSet).filter(m => m).sort((a, b) => a.localeCompare(b));
  const modes = Array.from(modeSet).filter(m => m).sort((a, b) => a.localeCompare(b));
  const groups = Array.from(groupSet).filter(g => g).sort((a, b) => a.localeCompare(b));
  const homes = Array.from(homeSet).filter(h => h).sort((a, b) => a.localeCompare(b));

  const monthDropdown = document.getElementById("monthFilter");
  const modeDropdown = document.getElementById("modeFilter");
  const groupDropdown = document.getElementById("groupFilter");
  const homeDropdown = document.getElementById("homeFilter");

  monthDropdown.innerHTML = `<option value="ALL">All Months</option>`;
  modeDropdown.innerHTML = `<option value="ALL">All Modes</option>`;
  groupDropdown.innerHTML = `<option value="ALL">All Groups</option>`;
  homeDropdown.innerHTML = `<option value="ALL">All Homes</option>`;

  months.forEach(m => monthDropdown.innerHTML += `<option value="${m}">${m}</option>`);
  modes.forEach(m => modeDropdown.innerHTML += `<option value="${m}">${m}</option>`);
  groups.forEach(g => groupDropdown.innerHTML += `<option value="${g}">${g}</option>`);
  homes.forEach(h => homeDropdown.innerHTML += `<option value="${h}">${h}</option>`);

  monthDropdown.onchange = resetPagesAndUpdate;
  modeDropdown.onchange = resetPagesAndUpdate;
  groupDropdown.onchange = resetPagesAndUpdate;
  homeDropdown.onchange = resetPagesAndUpdate;
}


function resetPagesAndUpdate() {
  expensePage = 1;
  receiptPage = 1;
  contraPage = 1;
  updateDashboard();
}

// ==========================================================
// SUMMARY
// ==========================================================
function updateSummary() {
  const exp = applyFilters(expenseData, "expense");
  const rec = applyFilters(receiptData, "receipt");
  const con = applyFilters(contraData, "contra");

  const totalExp = exp.reduce((sum, r) => sum + toNumber(r.Amount), 0);
  const totalRec = rec.reduce((sum, r) => sum + toNumber(r.Amount), 0);
  const totalCon = con.reduce((sum, r) => sum + toNumber(r.Amount), 0);

  document.getElementById("totalExpense").innerText = money(totalExp);
  document.getElementById("totalReceipts").innerText = money(totalRec);
  document.getElementById("netCashflow").innerText = money(totalRec - totalExp);
  document.getElementById("totalContra").innerText = money(totalCon);
}

// ==========================================================
// BALANCE BY MODE
// ==========================================================
function updateModeBalances() {
  const modeBalances = {};
  const openingMap = {};

  openingBalanceData.forEach(r => {
    const mode = normalizeText(r.Mode);
    if (!mode) return;

    const obVal = toNumber(r.OpeningBalance || r.OB || r.Balance || 0);
    openingMap[mode] = obVal;
    modeBalances[mode] = obVal;
  });

  receiptData.forEach(r => {
    const mode = normalizeText(r.Mode);
    if (!mode) return;

    if (modeBalances[mode] === undefined) modeBalances[mode] = 0;
    modeBalances[mode] += toNumber(r.Amount);
  });

  expenseData.forEach(r => {
    const mode = normalizeText(r.Mode);
    if (!mode) return;

    if (modeBalances[mode] === undefined) modeBalances[mode] = 0;
    modeBalances[mode] -= toNumber(r.Amount);
  });

  contraData.forEach(r => {
    const from = normalizeText(r.From);
    const to = normalizeText(r.To);
    const amt = toNumber(r.Amount);

    if (from) {
      if (modeBalances[from] === undefined) modeBalances[from] = 0;
      modeBalances[from] -= amt;
    }

    if (to) {
      if (modeBalances[to] === undefined) modeBalances[to] = 0;
      modeBalances[to] += amt;
    }
  });

  const container = document.getElementById("balanceCards");
  container.innerHTML = "";

  const sortedModes = Object.keys(modeBalances).sort((a, b) => a.localeCompare(b));

  sortedModes.forEach(mode => {
    const ob = openingMap[mode] || 0;
    const val = modeBalances[mode];

    container.innerHTML += `
      <div class="col-6 col-md-3">
        <div class="card p-3">
          <div class="summary-title">${mode}</div>
          <div class="summary-value">${money(val)}</div>
          <div class="small-muted">OB: ${money(ob)}</div>
        </div>
      </div>
    `;
  });
}

// ==========================================================
// PAGINATION
// ==========================================================
function paginate(data, page) {
  const start = (page - 1) * pageSize;
  return data.slice(start, start + pageSize);
}

function totalPages(data) {
  return Math.max(1, Math.ceil(data.length / pageSize));
}

// ==========================================================
// TABLES
// ==========================================================
function updateExpenseTable() {
  let exp = applyFilters(expenseData, "expense");
  exp = applySorting(exp, document.getElementById("expenseSort").value);

  const maxPages = totalPages(exp);
  if (expensePage > maxPages) expensePage = maxPages;
  if (expensePage < 1) expensePage = 1;

  const pageData = paginate(exp, expensePage);

  const tbody = document.getElementById("expenseTable");
  tbody.innerHTML = "";

  pageData.forEach(r => {
    const amt = toNumber(r.Amount);
    const amountClass = amt < 0 ? "text-success fw-bold" : "";

    tbody.innerHTML += `
      <tr>
        <td>${r.Date || ""}</td>
        <td>${r.Month || ""}</td>
        <td>${r.Item || ""}</td>
        <td>${r.SubGroup || ""}</td>
        <td>${r.Group || ""}</td>
        <td><span class="badge-mode">${r.Mode || ""}</span></td>
        <td class="text-end ${amountClass}">${money(amt)}</td>
        <td>${r.Narration || ""}</td>
      </tr>
    `;
  });

  if (pageData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center">No expense data</td></tr>`;
  }

  document.getElementById("expensePageInfo").innerText =
    `Page ${expensePage} of ${maxPages} (Rows: ${exp.length})`;
}

function updateReceiptTable() {
  let rec = applyFilters(receiptData, "receipt");
  rec = applySorting(rec, document.getElementById("receiptSort").value);

  const maxPages = totalPages(rec);
  if (receiptPage > maxPages) receiptPage = maxPages;
  if (receiptPage < 1) receiptPage = 1;

  const pageData = paginate(rec, receiptPage);

  const tbody = document.getElementById("receiptTable");
  tbody.innerHTML = "";

  pageData.forEach(r => {
    tbody.innerHTML += `
      <tr>
        <td>${r.Date || ""}</td>
        <td>${r.Month || ""}</td>
        <td>${r.From || ""}</td>
        <td><span class="badge-mode">${r.Mode || ""}</span></td>
        <td class="text-end">${money(toNumber(r.Amount))}</td>
      </tr>
    `;
  });

  if (pageData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center">No receipts data</td></tr>`;
  }

  document.getElementById("receiptPageInfo").innerText =
    `Page ${receiptPage} of ${maxPages} (Rows: ${rec.length})`;
}

function updateContraTable() {
  let con = applyFilters(contraData, "contra");
  con = applySorting(con, document.getElementById("contraSort").value);

  const maxPages = totalPages(con);
  if (contraPage > maxPages) contraPage = maxPages;
  if (contraPage < 1) contraPage = 1;

  const pageData = paginate(con, contraPage);

  const tbody = document.getElementById("contraTable");
  tbody.innerHTML = "";

  pageData.forEach(r => {
    tbody.innerHTML += `
      <tr>
        <td>${r.Date || ""}</td>
        <td>${r.Month || ""}</td>
        <td><span class="badge-mode">${r.From || ""}</span></td>
        <td><span class="badge-mode">${r.To || ""}</span></td>
        <td class="text-end">${money(toNumber(r.Amount))}</td>
      </tr>
    `;
  });

  if (pageData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center">No contra data</td></tr>`;
  }

  document.getElementById("contraPageInfo").innerText =
    `Page ${contraPage} of ${maxPages} (Rows: ${con.length})`;
}

// ==========================================================
// CHARTS
// ==========================================================
function updateCharts() {

  const monthTotals = {};
  expenseData.forEach(r => {
    const m = (r.Month || "").trim();
    if (!m) return;
    monthTotals[m] = (monthTotals[m] || 0) + toNumber(r.Amount);
  });

  const months = Object.keys(monthTotals).sort((a, b) => a.localeCompare(b));
  const totals = months.map(m => monthTotals[m]);

  if (expenseTrendChart) expenseTrendChart.destroy();
  expenseTrendChart = new Chart(document.getElementById("expenseTrendChart"), {
    type: "line",
    data: {
      labels: months,
      datasets: [{
        label: "Expense (Net)",
        data: totals,
        tension: 0.3
      }]
    }
  });

  const expFiltered = applyFilters(expenseData, "expense");

  const modeTotals = {};
  expFiltered.forEach(r => {
    const mode = normalizeText(r.Mode);
    if (!mode) return;
    modeTotals[mode] = (modeTotals[mode] || 0) + toNumber(r.Amount);
  });

  if (expenseModeChart) expenseModeChart.destroy();
  expenseModeChart = new Chart(document.getElementById("expenseModeChart"), {
    type: "bar",
    data: {
      labels: Object.keys(modeTotals),
      datasets: [{
        label: "Expense (Net)",
        data: Object.values(modeTotals)
      }]
    }
  });

  const groupTotals = {};
  expFiltered.forEach(r => {
    const g = (r.Group || "").trim();
    if (!g) return;
    groupTotals[g] = (groupTotals[g] || 0) + toNumber(r.Amount);
  });

  if (expenseGroupChart) expenseGroupChart.destroy();
  expenseGroupChart = new Chart(document.getElementById("expenseGroupChart"), {
    type: "doughnut",
    data: {
      labels: Object.keys(groupTotals),
      datasets: [{
        label: "Expense (Net)",
        data: Object.values(groupTotals)
      }]
    }
  });

  const recFiltered = applyFilters(receiptData, "receipt");
  const totalExp = expFiltered.reduce((sum, r) => sum + toNumber(r.Amount), 0);
  const totalRec = recFiltered.reduce((sum, r) => sum + toNumber(r.Amount), 0);

  if (receiptVsExpenseChart) receiptVsExpenseChart.destroy();
  receiptVsExpenseChart = new Chart(document.getElementById("receiptVsExpenseChart"), {
    type: "pie",
    data: {
      labels: ["Expense (Net)", "Receipts"],
      datasets: [{
        data: [totalExp, totalRec]
      }]
    }
  });
}

// ==========================================================
// UPDATE DASHBOARD
// ==========================================================
function updateDashboard() {
  updateSummary();
  updateModeBalances();
  updateExpenseTable();
  updateReceiptTable();
  updateContraTable();

  setTimeout(() => {
    updateCharts();
  }, 200);
}

// ==========================================================
// LOAD DATA
// ==========================================================
async function loadAllData() {
  showLoadingUI();
  setControlsEnabled(false);

  document.getElementById("refreshSpinner").classList.remove("d-none");

  currentDataset = datasets.INDIA;
  currencySymbol = currentDataset.currency;

  try {
    expenseData = removeEmptyRows(await parseCSV(currentDataset.expenseCSV));
    receiptData = removeEmptyRows(await parseCSV(currentDataset.receiptsCSV));
    contraData = removeEmptyRows(await parseCSV(currentDataset.contraCSV));
    openingBalanceData = removeEmptyRows(await parseCSV(currentDataset.obCSV));

    document.getElementById("dashboardSubTitle").innerText =
      `${currentDataset.name} (Currency: ${currencySymbol})`;

    fillDropdowns();
    resetPagesAndUpdate();

  } catch (err) {
    alert("Error loading CSV data. Check internet or sheet publish settings.");
    console.error(err);
  }

  document.getElementById("refreshSpinner").classList.add("d-none");
  setControlsEnabled(true);
}

// ==========================================================
// EVENTS
// ==========================================================
document.getElementById("searchBox").addEventListener("input", resetPagesAndUpdate);

document.getElementById("expenseSort").addEventListener("change", () => {
  expensePage = 1;
  updateExpenseTable();
});

document.getElementById("receiptSort").addEventListener("change", () => {
  receiptPage = 1;
  updateReceiptTable();
});

document.getElementById("contraSort").addEventListener("change", () => {
  contraPage = 1;
  updateContraTable();
});

document.getElementById("refreshBtn").addEventListener("click", loadAllData);

// Pagination buttons
document.getElementById("expenseNextBtn").addEventListener("click", () => {
  expensePage++;
  updateExpenseTable();
});

document.getElementById("expensePrevBtn").addEventListener("click", () => {
  expensePage--;
  updateExpenseTable();
});

document.getElementById("receiptNextBtn").addEventListener("click", () => {
  receiptPage++;
  updateReceiptTable();
});

document.getElementById("receiptPrevBtn").addEventListener("click", () => {
  receiptPage--;
  updateReceiptTable();
});

document.getElementById("contraNextBtn").addEventListener("click", () => {
  contraPage++;
  updateContraTable();
});

document.getElementById("contraPrevBtn").addEventListener("click", () => {
  contraPage--;
  updateContraTable();
});

// ==========================================================
// INITIAL LOAD
// ==========================================================
loadAllData();
