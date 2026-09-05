import { useState, useEffect, useMemo } from "react";
import { supabase } from "./lib/supabase";
import {
  LogIn, UserPlus, ArrowRight, ArrowLeft, Check, Pencil, Plus, Trash2,
  LogOut, Wallet, ChevronRight, AlertCircle, X, Settings, Search,
  Sun, Moon, Download, Upload, Repeat, Target, TrendingUp, Calculator, Info
} from "lucide-react";

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const rupiah = (n) => "Rp" + Math.round(n || 0).toLocaleString("id-ID");
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthKey = (d) => (d || "").slice(0, 7);
const nowMonthKey = () => new Date().toISOString().slice(0, 7);
const monthLabel = () =>
  new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
const isExpenseTx = (t) => t.type !== "topup" && t.type !== "withdraw" && t.type !== "asset_topup" && !t.directAsset;
const isTopupTx = (t) => t.type === "topup";
const isWithdrawTx = (t) => t.type === "withdraw";
const isAssetTopupTx = (t) => t.type === "asset_topup" || t.directAsset;
const isDepositTx = (t) => t.type === "expense" || isAssetTopupTx(t) || !t.type; // "setor" into an asset category
const monthLabelFor = (mKey) => {
  const [y, m] = mKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
};

/* Income is never auto-carried into a new calendar month. `activeMonth` is the
   most recent month the user has explicitly confirmed an income for — NOT
   necessarily today's real month. Everything on the dashboard/category pages
   is anchored to activeMonth, so last month's numbers keep showing until the
   user manually confirms this month's income. */
function getActiveMonth(user) {
  const months = Object.keys(user.monthlyIncomes || {}).sort();
  return months.length ? months[months.length - 1] : nowMonthKey();
}
function getIncomeForMonth(user, mKey) {
  const v = (user.monthlyIncomes || {})[mKey];
  return typeof v === "number" ? v : (user.income || 0);
}

const COLORS = ["#C9A24B", "#3E8E7E", "#C4604A", "#6E8FB0", "#9B7EBD", "#7FAE8B", "#B58AC4"];

const SECURITY_QUESTIONS = [
  "Nama hewan peliharaan pertamamu?",
  "Kota tempat kamu lahir?",
  "Nama SD kamu dulu?",
  "Makanan favoritmu?",
  "Nama panggilan masa kecil?",
];

const DEFAULT_CATEGORIES = [
  { id: "need", name: "Kebutuhan Pokok", percent: 50, subs: [], isAsset: false },
  { id: "want", name: "Keinginan", percent: 30, subs: [], isAsset: false },
  { id: "save", name: "Tabungan & Investasi", percent: 20, subs: [], isAsset: true },
];

/* For an isAsset category, money doesn't just "disappear" like a normal expense —
   it moves into an asset you still own. assetBalance tracks that cumulative,
   never-resets balance: all-time deposits minus all-time withdrawals.
   subId === undefined means "don't filter by sub" (whole-category total);
   pass null explicitly to mean "only entries with no sub tagged". */
function assetBalance(transactions, catId, subId = undefined) {
  const matches = (t) => t.categoryId === catId && (subId === undefined ? true : (t.subId || null) === subId);
  const deposits = transactions.filter((t) => matches(t) && isDepositTx(t)).reduce((s, t) => s + Number(t.amount), 0);
  const withdrawals = transactions.filter((t) => matches(t) && isWithdrawTx(t)).reduce((s, t) => s + Number(t.amount), 0);
  return deposits - withdrawals;
}

/* True "sisa saldo" — a running cash balance that rolls forward from month to
  month instead of resetting. Everything up to and including `monthLimit` counts:
  all confirmed monthly incomes + all topups, minus all expenses (normal spending
  AND deposits into savings/assets, since those also leave your spendable cash).
  Asset withdrawals do not change this total balance because they only change the
  asset balance. Category budgets still reset every month for planning purposes. */
function cumulativeBalanceUpTo(user, transactions, monthLimit) {
  const totalIncome = Object.entries(user.monthlyIncomes || {})
    .filter(([m]) => m <= monthLimit)
    .reduce((s, [, v]) => s + Number(v || 0), 0);
  const txUpTo = transactions.filter((t) => monthKey(t.date) <= monthLimit);
  const totalTopup = txUpTo.filter(isTopupTx).reduce((s, t) => s + Number(t.amount), 0);
  const totalExpense = txUpTo.filter(isExpenseTx).reduce((s, t) => s + Number(t.amount), 0);
  return totalIncome + totalTopup - totalExpense;
}

async function readKey(key, shared = true) {
  try {
    const res = await window.storage.get(key, shared);
    return res && res.value ? JSON.parse(res.value) : null;
  } catch (e) {
    return null;
  }
}
async function writeKey(key, value, shared = true) {
  try {
    await window.storage.set(key, JSON.stringify(value), shared);
  } catch (e) {
    console.error("storage write failed", e);
  }
}
async function deleteKey(key, shared = true) {
  try {
    await window.storage.delete(key, shared);
  } catch (e) {
    console.error("storage delete failed", e);
  }
}
const userKey = (u) => `mmp_user_${u}`;
const txKey = (u) => `mmp_tx_${u}`;
const emailKey = (e) => `mmp_email_${e.trim().toLowerCase()}`;
const SESSION_KEY = "mmp_session";
const THEME_KEY = "mmp_theme";

/* Password is hashed (SHA-256) before it's ever written to storage.
   Legacy accounts created before this feature still have a plaintext
   `password` field; verifyPassword accepts that once and upgrades it. */
async function hashPassword(pw) {
  const enc = new TextEncoder().encode(pw);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function verifyPassword(pw, user) {
  if (user.passwordHash) return (await hashPassword(pw)) === user.passwordHash;
  if (user.password) return user.password === pw; // legacy fallback, upgraded on next login
  return false;
}

function triggerDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function transactionsToCsv(user, transactions) {
  const rows = [["Tanggal", "Tipe", "Kategori", "Sub-alokasi", "Catatan", "Nominal"]];
  [...transactions].sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((t) => {
    const cat = user.categories.find((c) => c.id === t.categoryId);
    const sub = cat?.subs.find((s) => s.id === t.subId);
    rows.push([
      t.date,
      isAssetTopupTx(t) ? "Saldo Aset" : isTopupTx(t) ? "Tambahan Dana" : "Pengeluaran",
      cat ? cat.name : "Seluruh Alokasi",
      sub ? sub.name : "",
      (t.note || "").replace(/"/g, '""'),
      t.amount,
    ]);
  });
  return rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
}

const onEnter = (fn) => (e) => {
  if (e.key === "Enter") fn();
};

/* ---------- animated screen wrapper ---------- */
function Screen({ children, stageKey }) {
  return (
    <div key={stageKey} className="min-h-screen flex items-center justify-center p-4 anim-fade-up">
      {children}
    </div>
  );
}

/* ---------- welcome / success modal ---------- */
function WelcomeModal({ name, onContinue }) {
  return (
    <div className="modal-overlay anim-fade">
      <div className="card p-8 anim-pop" style={{ maxWidth: 380, textAlign: "center" }}>
        <div className="check-badge anim-pop-delay">
          <Check size={28} color="#101815" />
        </div>
        <h1 className="display" style={{ fontSize: 20, fontWeight: 700, marginTop: 16 }}>
          Akun berhasil dibuat!
        </h1>
        <p className="muted text-sm mt-2">
          {name ? `Selamat datang, ${name}. ` : ""}Yuk lengkapi data singkat untuk mulai menyusun rencana keuanganmu.
        </p>
        <button className="btn-primary w-full mt-6 flex items-center justify-center gap-2" onClick={onContinue}>
          Mulai <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

/* ---------- small UI atoms ---------- */
function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs muted uppercase tracking-wide">{label}</label>}
      {children}
    </div>
  );
}

function ProgressBar({ percent, color }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="progress-track w-full">
      <div className="progress-fill" style={{ width: `${p}%`, background: color || "var(--gold)" }} />
    </div>
  );
}

function SpendingTrendChart({ transactions, currentMonth }) {
  const [hoveredMonth, setHoveredMonth] = useState(null);
  const [currentYear, currentMonthNumber] = currentMonth.split("-").map(Number);
  const months = Array.from({ length: 3 }, (_, index) => {
    const date = new Date(currentYear, currentMonthNumber - 1 - (2 - index), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
  const values = months.map((month) => ({
    label: monthLabelFor(month),
    shortLabel: new Date(`${month}-01T00:00:00`).toLocaleDateString("id-ID", { month: "short" }),
    total: transactions
      .filter((transaction) => monthKey(transaction.date) === month && isExpenseTx(transaction))
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0),
  }));
  const maxValue = Math.max(...values.map((value) => value.total), 1);
  const points = values.map((value, index) => ({
    ...value,
    x: 52 + index * 158,
    y: 128 - (value.total / maxValue) * 92,
  }));
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const hoveredPoint = points.find((point) => point.label === hoveredMonth);

  return (
    <div className="spending-trend-chart flex flex-col gap-3">
      <p className="muted text-xs uppercase tracking-wide">Tren Pengeluaran 3 Bulan</p>
      <svg width="100%" height="190" viewBox="0 0 420 190" preserveAspectRatio="xMidYMid meet" style={{ overflow: "visible" }}>
        {[36, 82, 128].map((y) => <line key={y} x1="28" y1={y} x2="392" y2={y} stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />)}
        <path d={path} fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => (
          <g
            key={point.label}
            onMouseEnter={() => setHoveredMonth(point.label)}
            onMouseLeave={() => setHoveredMonth(null)}
            style={{ cursor: "pointer" }}
          >
            <rect x={point.x - 48} y="16" width="96" height="128" fill="transparent" />
            <circle cx={point.x} cy={point.y} r={hoveredMonth === point.label ? 6 : 4} fill="var(--gold)" stroke={hoveredMonth === point.label ? "var(--text)" : "none"} strokeWidth="1.5" />
            <text x={point.x} y="158" textAnchor="middle" fontSize="11" fill="var(--muted)">{point.shortLabel}</text>
            <title>{`${point.label}: ${rupiah(point.total)}`}</title>
          </g>
        ))}
        {hoveredPoint && (
          <g pointerEvents="none">
            <rect x={hoveredPoint.x > 300 ? hoveredPoint.x - 142 : hoveredPoint.x + 10} y="12" width="132" height="40" rx="6" fill="var(--surface)" stroke="var(--gold)" />
            <text x={hoveredPoint.x > 300 ? hoveredPoint.x - 132 : hoveredPoint.x + 20} y="28" fontSize="10" fill="var(--muted)">{hoveredPoint.label}</text>
            <text x={hoveredPoint.x > 300 ? hoveredPoint.x - 132 : hoveredPoint.x + 20} y="44" fontSize="11" fill="var(--text)" fontWeight="700">{rupiah(hoveredPoint.total)}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

/* Daily Spending Chart for CategoryDetail */
function DailySpendingChart({ monthTx, monthKey }) {
  const [hoveredDay, setHoveredDay] = useState(null);
  // Get last day of the month
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  
  // Calculate daily spending
  const dailySpending = Array.from({ length: lastDay }, (_, i) => {
    const day = i + 1;
    const dateStr = `${monthKey}-${String(day).padStart(2, "0")}`;
    const dayTotal = monthTx
      .filter(t => t.date === dateStr && (t.type === "expense" || !t.type))
      .reduce((sum, t) => sum + Number(t.amount), 0);
    return { day, total: dayTotal };
  });
  const avgDaily = dailySpending.reduce((sum, day) => sum + day.total, 0) / lastDay;
  const maxDaily = Math.max(...dailySpending.map((d) => d.total), 1);
  const chartHeight = 120;
  const chartLeft = 40;
  const chartRight = 395;
  const chartWidth = chartRight - chartLeft;
  const points = dailySpending.map((item, index) => ({
    ...item,
    x: chartLeft + (index / Math.max(lastDay - 1, 1)) * chartWidth,
    y: chartHeight - (item.total / maxDaily) * chartHeight,
  }));
  const hoveredPoint = hoveredDay ? points.find((point) => point.day === hoveredDay) : null;
  const hoveredDate = hoveredPoint
    ? `${monthKey}-${String(hoveredPoint.day).padStart(2, "0")}`
    : "";
  const hoveredTransactions = hoveredDate
    ? monthTx.filter((t) => t.date === hoveredDate && (t.type === "expense" || !t.type))
    : [];
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const labelStep = lastDay <= 10 ? 1 : 5;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <div>
          <p className="muted text-xs uppercase tracking-wide">Grafik Pengeluaran Harian</p>
        </div>
        <div className="flex gap-4 text-xs">
          <div>
            <p className="muted">Rata-rata harian</p>
            <p className="font-bold tabular">{rupiah(avgDaily)}</p>
          </div>
          <div>
            <p className="muted">Total bulan</p>
            <p className="font-bold tabular" style={{ color: "var(--rose)" }}>{rupiah(dailySpending.reduce((s, d) => s + d.total, 0))}</p>
          </div>
        </div>
      </div>

      <svg width="100%" height={chartHeight + 40} viewBox={`0 0 400 ${chartHeight + 40}`} preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
          <line
            key={`grid-${i}`}
            x1="40"
            y1={chartHeight - chartHeight * ratio}
            x2="400"
            y2={chartHeight - chartHeight * ratio}
            stroke="var(--border)"
            strokeWidth="0.5"
            opacity="0.3"
          />
        ))}

        <path d={path} fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => {
          const isHovered = point.day === hoveredDay;
          const pointDate = `${monthKey}-${String(point.day).padStart(2, "0")}`;
          return (
            <g
              key={`point-${point.day}`}
              onMouseEnter={() => setHoveredDay(point.day)}
              onMouseLeave={() => setHoveredDay(null)}
              style={{ cursor: "pointer" }}
            >
              <rect x={point.x - 8} y="0" width="16" height={chartHeight} fill="transparent" />
              {point.total > 0 && (
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isHovered ? 5 : 3}
                  fill="var(--gold)"
                  stroke={isHovered ? "var(--text)" : "none"}
                  strokeWidth="1.5"
                />
              )}
              <title>{`${pointDate}: ${rupiah(point.total)}`}</title>
            </g>
          );
        })}
        {hoveredPoint && (
          <g pointerEvents="none">
            <rect
              x={hoveredPoint.x > 280 ? hoveredPoint.x - 132 : hoveredPoint.x + 8}
              y="6"
              width="124"
              height={Math.min(72, 30 + hoveredTransactions.slice(0, 2).length * 17)}
              rx="6"
              fill="var(--surface)"
              stroke="var(--gold)"
              strokeWidth="1"
            />
            <text
              x={hoveredPoint.x > 280 ? hoveredPoint.x - 124 : hoveredPoint.x + 16}
              y="20"
              fontSize="10"
              fill="var(--muted)"
            >
              {hoveredDate}
            </text>
            <text
              x={hoveredPoint.x > 280 ? hoveredPoint.x - 124 : hoveredPoint.x + 16}
              y="34"
              fontSize="11"
              fill="var(--text)"
              fontWeight="700"
            >
              {rupiah(hoveredPoint.total)}
            </text>
            {hoveredTransactions.slice(0, 2).map((transaction, index) => (
              <text
                key={`${transaction.id}-detail`}
                x={hoveredPoint.x > 280 ? hoveredPoint.x - 124 : hoveredPoint.x + 16}
                y={49 + index * 14}
                fontSize="9"
                fill="var(--muted)"
              >
                {(transaction.note || "Pengeluaran").slice(0, 19)}
              </text>
            ))}
          </g>
        )}

        {/* X-axis labels */}
        {points.filter((point) => point.day % labelStep === 0 || point.day === 1 || point.day === lastDay).map((point) => {
          return (
            <text
              key={`label-${point.day}`}
              x={point.x}
              y={chartHeight + 20}
              textAnchor="middle"
              fontSize="11"
              fill="var(--muted)"
              className="muted"
            >
              {point.day}
            </text>
          );
        })}

        {/* Y-axis labels */}
        {[0, 0.5, 1].map((ratio, i) => {
          const value = Math.round(maxDaily * ratio);
          const shortVal = value >= 1000000 ? `${Math.round(value / 1000000)}jt` : value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
          return (
            <text
              key={`y-label-${i}`}
              x="30"
              y={chartHeight - chartHeight * ratio + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--muted)"
              className="muted"
            >
              {shortVal}
            </text>
          );
        })}
      </svg>

      <div className="flex items-center justify-between text-xs muted">
        <span>Hari ke-1</span>
        <span>Setiap titik = total pengeluaran hari itu</span>
        <span>Hari ke-{lastDay}</span>
      </div>
    </div>
  );
}

/* Editable percent input that can be switched to a nominal Rupiah input.
   `base` is the amount 100% represents (income for top-level, category amount for subs). */
function PercentOrAmountInput({ percent, base, onChangePercent }) {
  const [mode, setMode] = useState("percent");
  const displayValue = mode === "percent" ? round1(percent) : Math.round((base * percent) / 100);

  const handleChange = (raw) => {
    const num = Number(raw);
    if (Number.isNaN(num)) return;
    if (mode === "percent") onChangePercent(round1(num));
    else onChangePercent(base > 0 ? (num / base) * 100 : 0);
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
      />
      <div className="unit-toggle">
        <button type="button" className={mode === "percent" ? "unit-active" : ""} onClick={() => setMode("percent")}>%</button>
        <button type="button" className={mode === "amount" ? "unit-active" : ""} onClick={() => setMode("amount")}>Rp</button>
      </div>
    </div>
  );
}
function round1(n) { return Math.round(Number(n) * 10) / 10; }
function fmtPercent(p) {
  const r = round1(p);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
function isHundred(total) { return round1(total) === 100; }

/* Free-text value input for adding a brand-new row, with a %/Rp unit toggle.
   Returns the raw text via onValue; caller converts to percent using `mode`. */
function NewValueInput({ value, onValue, mode, onMode, style }) {
  return (
    <div className="flex items-center gap-1.5" style={style}>
      <input
        type="number"
        style={{ maxWidth: mode === "percent" ? 90 : 150 }}
        placeholder={mode === "percent" ? "%" : "Rp"}
        value={value}
        onChange={(e) => onValue(e.target.value)}
      />
      <div className="unit-toggle">
        <button type="button" className={mode === "percent" ? "unit-active" : ""} onClick={() => onMode("percent")}>%</button>
        <button type="button" className={mode === "amount" ? "unit-active" : ""} onClick={() => onMode("amount")}>Rp</button>
      </div>
    </div>
  );
}
/* Nudges one row's percent so the group sums to exactly 100%, absorbing
   the tiny leftover that nominal-based (Rupiah) entry tends to create. */
function autoBalance(list) {
  if (!list.length) return list;
  const total = list.reduce((s, x) => s + Number(x.percent || 0), 0);
  const diff = round1(100 - total);
  if (diff === 0) return list;
  let biggestIdx = 0;
  list.forEach((x, i) => { if (Number(x.percent) > Number(list[biggestIdx].percent)) biggestIdx = i; });
  return list.map((x, i) => i === biggestIdx ? { ...x, percent: round1(Number(x.percent) + diff) } : x);
}

function AllocationRing({ categories, centerLabel, centerValue }) {
  let cumulative = 0;
  const stops = categories.length
    ? categories
        .map((c, i) => {
          const start = cumulative;
          cumulative += Number(c.percent) || 0;
          return `${COLORS[i % COLORS.length]} ${start}% ${cumulative}%`;
        })
        .join(", ")
    : null;
  const bg = stops ? `conic-gradient(${stops})` : "var(--surface2)";
  return (
    <div className="allocation-ring flex flex-col items-center gap-5 text-center">
      <div className="relative" style={{ width: 190, height: 190 }}>
        <div style={{ width: 190, height: 190, borderRadius: "9999px", background: bg }} />
        <div
          className="card absolute flex flex-col items-center justify-center"
          style={{ top: 26, left: 26, width: 138, height: 138, borderRadius: "9999px" }}
        >
          <span className="muted" style={{ fontSize: 11 }}>{centerLabel}</span>
          <span className="display tabular" style={{ fontSize: 15, fontWeight: 700, textAlign: "center" }}>
            {rupiah(centerValue)}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
        {categories.map((c, i) => (
          <div key={c.id} className="flex items-center gap-2 text-sm">
            <span
              style={{ width: 10, height: 10, borderRadius: "9999px", background: COLORS[i % COLORS.length] }}
            />
            <span>{c.name}</span>
            <span className="muted tabular">{fmtPercent(c.percent)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Auth screen ---------- */
function AuthScreen({ onLogin, onRegister, onForgotPassword, error, busy }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [usernameStatus, setUsernameStatus] = useState("idle");
  const [securityQuestion, setSecurityQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [securityAnswer, setSecurityAnswer] = useState("");

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordsMatch = password === passwordConfirmation;

  useEffect(() => {
    if (mode !== "register") {
      setUsernameStatus("idle");
      return undefined;
    }

    const candidate = username.trim();
    if (!candidate) {
      setUsernameStatus("idle");
      return undefined;
    }

    setUsernameStatus("checking");
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data, error: availabilityError } = await supabase.rpc("is_username_available", {
        candidate,
      });
      if (cancelled) return;
      setUsernameStatus(availabilityError ? "error" : data ? "available" : "taken");
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, username]);

  const submit = () => {
    if (!password) return;
    if (mode === "login") {
      if (!emailValid) return;
      onLogin(email.trim(), password);
    } else {
      if (!username.trim() || usernameStatus !== "available" || !emailValid || !passwordsMatch || !securityAnswer.trim()) return;
      onRegister(username.trim(), email.trim(), password, securityQuestion, securityAnswer.trim());
    }
  };

  return (
    <Screen stageKey="auth">
      <div className="w-full flex flex-col md:flex-row gap-0 card overflow-hidden anim-pop" style={{ maxWidth: 780 }}>
        <div
          className="flex-1 p-8 flex flex-col justify-center"
          style={{ background: "var(--surface2)", borderRight: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Wallet size={22} color="var(--gold)" />
            <span className="display" style={{ fontSize: 20, fontWeight: 700 }}>Pundi</span>
          </div>
          <h1 className="display" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.25 }}>
            Rancang alokasi uangmu sendiri, sampai ke rincian terkecil.
          </h1>
          <p className="muted mt-3 text-sm leading-relaxed">
            Mulai dari 50/30/20, atau susun persentase kebutuhan, keinginan, dan
            tabunganmu sendiri lengkap dengan sub-alokasi dan pencatatan pengeluaran bulanan.
          </p>
        </div>
        <div className="flex-1 p-8">
          <div className="flex gap-2 mb-6">
            <button
              className="btn-ghost text-sm flex-1 flex items-center justify-center gap-2"
              style={mode === "login" ? { borderColor: "var(--gold)", color: "var(--gold)" } : {}}
              onClick={() => setMode("login")}
            >
              <LogIn size={15} /> Masuk
            </button>
            <button
              className="btn-ghost text-sm flex-1 flex items-center justify-center gap-2"
              style={mode === "register" ? { borderColor: "var(--gold)", color: "var(--gold)" } : {}}
              onClick={() => setMode("register")}
            >
              <UserPlus size={15} /> Daftar
            </button>
          </div>
          <div className="flex flex-col gap-4">
            {mode === "register" && (
              <Field label="Username">
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
                  onKeyDown={onEnter(submit)}
                  placeholder="cth. naufal"
                />
                {usernameStatus === "checking" && <span className="muted text-xs">Mengecek ketersediaan...</span>}
                {usernameStatus === "available" && <span className="text-xs" style={{ color: "var(--teal)" }}>Username tersedia.</span>}
                {usernameStatus === "taken" && <span className="text-xs" style={{ color: "var(--rose)" }}>Username sudah digunakan.</span>}
                {usernameStatus === "error" && <span className="text-xs" style={{ color: "var(--rose)" }}>Username belum bisa dicek. Coba lagi.</span>}
              </Field>
            )}
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={onEnter(submit)}
                placeholder="cth. naufal@email.com"
              />
              {email.trim().length > 0 && !emailValid && (
                <span className="text-xs" style={{ color: "var(--rose)" }}>Format email belum valid.</span>
              )}
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={onEnter(submit)}
                placeholder="••••••••"
              />
            </Field>
            {mode === "register" && (
              <>
                <Field label="Konfirmasi Password">
                  <input
                    type="password"
                    value={passwordConfirmation}
                    onChange={(e) => setPasswordConfirmation(e.target.value)}
                    onKeyDown={onEnter(submit)}
                    placeholder="Ulangi password"
                  />
                  {passwordConfirmation && !passwordsMatch && (
                    <span className="text-xs" style={{ color: "var(--rose)" }}>Password tidak sama.</span>
                  )}
                </Field>
                <Field label="Pertanyaan Keamanan">
                  <select value={securityQuestion} onChange={(e) => setSecurityQuestion(e.target.value)}>
                    {SECURITY_QUESTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
                  </select>
                </Field>
                <Field label="Jawaban">
                  <input
                    value={securityAnswer}
                    onChange={(e) => setSecurityAnswer(e.target.value)}
                    onKeyDown={onEnter(submit)}
                    placeholder="Jawabanmu, buat jaga-jaga lupa password"
                  />
                </Field>
              </>
            )}
            {mode === "login" && (
              <button
                type="button"
                className="text-xs text-left"
                style={{ background: "none", border: "none", color: "var(--gold)", cursor: "pointer", width: "fit-content" }}
                onClick={onForgotPassword}
              >
                Lupa password?
              </button>
            )}
            {error && (
              <div className="flex items-center gap-2 text-sm" style={{ color: "var(--rose)" }}>
                <AlertCircle size={14} /> {error}
              </div>
            )}
            <button
              className="btn-primary flex items-center justify-center gap-2"
              onClick={submit}
              disabled={busy || !password || !emailValid || (mode === "register" && (usernameStatus !== "available" || !passwordsMatch || !username.trim() || !securityAnswer.trim()))}
            >
              {mode === "login" ? "Masuk" : "Buat Akun"} <ArrowRight size={16} />
            </button>
            <p className="muted" style={{ fontSize: 11 }}>
              Data disimpan di penyimpanan bersama artifact ini agar bisa diakses dari perangkat
              lain memakai email & password yang sama. Ini bukan sistem otentikasi yang
              aman untuk data sensitif sungguhan.
            </p>
          </div>
        </div>
      </div>
    </Screen>
  );
}

/* ---------- Onboarding ---------- */
function OnboardingScreen({ user, onNext }) {
  const [name, setName] = useState(user.name || "");
  const [age, setAge] = useState(user.age || "");
  const [income, setIncome] = useState(user.income || "");

  const valid = name.trim() && Number(age) > 0 && Number(income) > 0;

  return (
    <Screen stageKey="onboarding">
      <div className="card p-8 w-full anim-pop" style={{ maxWidth: 460 }}>
        <p className="muted text-xs uppercase tracking-wide mb-1">Langkah 1 dari 3</p>
        <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>Kenalan dulu, yuk</h1>
        <p className="muted text-sm mt-1 mb-6">Data ini dipakai untuk menghitung alokasi keuanganmu.</p>
        <div className="flex flex-col gap-4">
          <Field label="Nama">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama kamu" />
          </Field>
          <Field label="Umur">
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="cth. 25"
            />
          </Field>
          <Field label="Income per bulan">
            <input
              type="number"
              value={income}
              onChange={(e) => setIncome(e.target.value)}
              placeholder="cth. 8000000"
            />
          </Field>
          <button
            className="btn-primary flex items-center justify-center gap-2 mt-2"
            disabled={!valid}
            onClick={() => onNext({ name: name.trim(), age: Number(age), income: Number(income) })}
          >
            Lanjut <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </Screen>
  );
}

/* ---------- Strategy choice ---------- */
function StrategyChoice({ income, onChooseDefault, onChooseCustom }) {
  return (
    <Screen stageKey="choice">
      <div className="card p-8 w-full anim-pop" style={{ maxWidth: 560 }}>
        <p className="muted text-xs uppercase tracking-wide mb-1">Langkah 2 dari 3</p>
        <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>Pilih strategi money management</h1>
        <p className="muted text-sm mt-1 mb-6">Income bulananmu: <span className="tabular">{rupiah(income)}</span></p>

        <div className="flex flex-col gap-4">
          <div className="card2 p-5 anim-fade-up stagger-1">
            <div className="flex items-center justify-between mb-3">
              <span className="display" style={{ fontWeight: 700 }}>Strategi 50 / 30 / 20</span>
              <span className="muted text-xs">Rekomendasi umum</span>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              {DEFAULT_CATEGORIES.map((c, i) => (
                <div key={c.id} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span style={{ width: 10, height: 10, borderRadius: 9999, background: COLORS[i] }} />
                    {c.name}
                    {c.isAsset && <span className="text-xs" style={{ color: "var(--gold)" }}>🏦</span>}
                  </span>
                  <span className="tabular muted">{fmtPercent(c.percent)}% · {rupiah(income * c.percent / 100)}</span>
                </div>
              ))}
            </div>
            <button className="btn-primary w-full mt-4 flex items-center justify-center gap-2" onClick={onChooseDefault}>
              Gunakan Strategi Ini <ArrowRight size={16} />
            </button>
          </div>

          <div className="card2 p-5 anim-fade-up stagger-2">
            <span className="display" style={{ fontWeight: 700 }}>Buat Sendiri (Custom)</span>
            <p className="muted text-sm mt-1">
              Tentukan kategori & persentasemu sendiri, lalu rinci lagi tiap kategori jadi sub-alokasi.
            </p>
            <button className="btn-ghost w-full mt-4 flex items-center justify-center gap-2" onClick={onChooseCustom}>
              Susun Custom <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </Screen>
  );
}

/* ---------- Custom builder ---------- */
function CustomBuilder({ initialCategories, income, onDone, onBack }) {
  const [categories, setCategories] = useState(
    initialCategories && initialCategories.length ? initialCategories : []
  );
  const [step, setStep] = useState("top"); // top | subs
  const [activeCatId, setActiveCatId] = useState(null);
  const [catName, setCatName] = useState("");
  const [catPercent, setCatPercent] = useState("");
  const [catMode, setCatMode] = useState("percent");
  const [subName, setSubName] = useState("");
  const [subPercent, setSubPercent] = useState("");
  const [subMode, setSubMode] = useState("percent");
  const [error, setError] = useState("");

  const total = categories.reduce((s, c) => s + Number(c.percent || 0), 0);
  const remaining = 100 - total;

  const addCategory = () => {
    const raw = Number(catPercent);
    if (!catName.trim() || !(raw > 0)) return;
    const p = catMode === "amount" ? (income > 0 ? (raw / income) * 100 : 0) : raw;
    if (p > remaining + 0.0001) {
      setError(`Sisa hanya ${fmtPercent(remaining)}% (≈ ${rupiah(income * remaining / 100)})`);
      return;
    }
    setError("");
    setCategories([...categories, { id: uid(), name: catName.trim(), percent: p, subs: [] }]);
    setCatName(""); setCatPercent("");
  };
  const removeCategory = (id) => setCategories(categories.filter((c) => c.id !== id));

  const activeCat = categories.find((c) => c.id === activeCatId);
  const subTotal = activeCat ? activeCat.subs.reduce((s, x) => s + Number(x.percent || 0), 0) : 0;
  const subRemaining = 100 - subTotal;
  const activeCatAmount = activeCat ? income * activeCat.percent / 100 : 0;

  const addSub = () => {
    const raw = Number(subPercent);
    if (!subName.trim() || !(raw > 0) || !activeCat) return;
    const p = subMode === "amount" ? (activeCatAmount > 0 ? (raw / activeCatAmount) * 100 : 0) : raw;
    if (p > subRemaining + 0.0001) {
      setError(`Sisa sub hanya ${fmtPercent(subRemaining)}% (≈ ${rupiah(activeCatAmount * subRemaining / 100)})`);
      return;
    }
    setError("");
    setCategories(categories.map((c) =>
      c.id === activeCat.id ? { ...c, subs: [...c.subs, { id: uid(), name: subName.trim(), percent: p }] } : c
    ));
    setSubName(""); setSubPercent("");
  };
  const removeSub = (catId, subId) =>
    setCategories(categories.map((c) => c.id === catId ? { ...c, subs: c.subs.filter((s) => s.id !== subId) } : c));

  const finish = () => {
    const unbalanced = categories.filter((c) => c.subs.length > 0 && !isHundred(c.subs.reduce((s, x) => s + Number(x.percent || 0), 0)));
    if (unbalanced.length) {
      setError(`Sub-alokasi belum 100% untuk: ${unbalanced.map((c) => c.name).join(", ")}`);
      return;
    }
    onDone(categories);
  };

  if (step === "top") {
    return (
      <Screen stageKey="custom-top">
        <div className="card p-8 w-full anim-pop" style={{ maxWidth: 560 }}>
          <p className="muted text-xs uppercase tracking-wide mb-1">Custom · Kategori Utama</p>
          <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>Susun kategori alokasi</h1>
          <p className="muted text-sm mt-1 mb-4">Total harus mencapai 100% dari income bulanan.</p>

          <div className="flex flex-col gap-2 mb-4">
            {categories.map((c, i) => (
              <div key={c.id} className="card2 p-3 flex flex-col gap-2 anim-fade-up">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm flex-1">
                    <span style={{ width: 10, height: 10, borderRadius: 9999, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                    <input
                      value={c.name}
                      onChange={(e) => setCategories(categories.map((x) => x.id === c.id ? { ...x, name: e.target.value } : x))}
                    />
                  </span>
                  <PercentOrAmountInput
                    percent={c.percent}
                    base={income}
                    onChangePercent={(p) => setCategories(categories.map((x) => x.id === c.id ? { ...x, percent: p } : x))}
                  />
                  <span className="tabular text-xs muted" style={{ minWidth: 90, textAlign: "right" }}>
                    {rupiah(income * c.percent / 100)}
                  </span>
                  <button className="icon-btn" onClick={() => removeCategory(c.id)}><Trash2 size={14} color="var(--rose)" /></button>
                </div>
                <label className="flex items-center gap-2 text-xs muted" style={{ cursor: "pointer", paddingLeft: 18 }}>
                  <input
                    type="checkbox"
                    checked={!!c.isAsset}
                    onChange={(e) => setCategories(categories.map((x) => x.id === c.id ? { ...x, isAsset: e.target.checked } : x))}
                    style={{ width: "auto" }}
                  />
                  Ini kategori Tabungan/Investasi (lacak sebagai aset, bukan pengeluaran habis)
                </label>
              </div>
            ))}
            {categories.length === 0 && <p className="muted text-sm">Belum ada kategori. Tambahkan di bawah.</p>}
          </div>

          <div className="flex gap-2 mb-2 flex-wrap">
            <input style={{ flex: 1, minWidth: 160 }} placeholder="Tambah kategori baru (cth. Transport)" value={catName} onChange={(e) => setCatName(e.target.value)} onKeyDown={onEnter(addCategory)} />
            <NewValueInput value={catPercent} onValue={setCatPercent} mode={catMode} onMode={setCatMode} />
            <button className="btn-ghost" onClick={addCategory}><Plus size={16} /></button>
          </div>
          <ProgressBar percent={total} color={isHundred(total) ? "var(--teal)" : "var(--gold)"} />
          <div className="flex items-center justify-between mt-1 text-xs muted">
            <span>Total: {fmtPercent(total)}%</span>
            <span>Sisa: {fmtPercent(remaining)}%</span>
          </div>
          {!isHundred(total) && categories.length > 0 && (
            <button
              type="button"
              className="btn-ghost text-xs mt-2"
              onClick={() => setCategories(autoBalance(categories))}
            >
              Pas-kan otomatis ke 100% (sisa dibulatkan ke kategori terbesar)
            </button>
          )}
          {error && <p className="text-sm mt-2" style={{ color: "var(--rose)" }}>{error}</p>}

          <div className="flex gap-2 mt-6">
            <button className="btn-ghost flex items-center gap-2" onClick={onBack}><ArrowLeft size={16} /> Kembali</button>
            <button
              className="btn-primary flex-1 flex items-center justify-center gap-2"
              disabled={!isHundred(total)}
              onClick={() => { setError(""); setStep("subs"); setActiveCatId(categories[0]?.id || null); }}
            >
              Lanjut ke Sub-Alokasi <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen stageKey="custom-subs">
      <div className="card p-8 w-full anim-pop" style={{ maxWidth: 620 }}>
        <p className="muted text-xs uppercase tracking-wide mb-1">Custom · Sub-Alokasi (opsional)</p>
        <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>Rincikan tiap kategori</h1>
        <p className="muted text-sm mt-1 mb-4">Boleh dilewati per kategori. Jika diisi, total sub harus 100%.</p>

        <div className="flex gap-2 mb-4 flex-wrap">
          {categories.map((c) => (
            <button
              key={c.id}
              className="btn-ghost text-sm"
              style={c.id === activeCatId ? { borderColor: "var(--gold)", color: "var(--gold)" } : {}}
              onClick={() => { setActiveCatId(c.id); setError(""); }}
            >
              {c.name} ({fmtPercent(c.percent)}%)
            </button>
          ))}
        </div>

        {activeCat && (
          <>
            <div className="flex flex-col gap-2 mb-4">
              {activeCat.subs.map((s) => (
                <div key={s.id} className="card2 p-3 flex items-center justify-between gap-2 anim-fade-up">
                  <input
                    className="flex-1"
                    value={s.name}
                    onChange={(e) => setCategories(categories.map((c) => c.id === activeCat.id
                      ? { ...c, subs: c.subs.map((x) => x.id === s.id ? { ...x, name: e.target.value } : x) }
                      : c))}
                  />
                  <PercentOrAmountInput
                    percent={s.percent}
                    base={income * activeCat.percent / 100}
                    onChangePercent={(p) => setCategories(categories.map((c) => c.id === activeCat.id
                      ? { ...c, subs: c.subs.map((x) => x.id === s.id ? { ...x, percent: p } : x) }
                      : c))}
                  />
                  <span className="sub-allocation-amount tabular text-xs muted" style={{ minWidth: 90, textAlign: "right" }}>
                    {rupiah((income * activeCat.percent / 100) * s.percent / 100)}
                  </span>
                  <button className="icon-btn" onClick={() => removeSub(activeCat.id, s.id)}><Trash2 size={14} color="var(--rose)" /></button>
                </div>
              ))}
              {activeCat.subs.length === 0 && <p className="muted text-sm">Belum ada sub-alokasi untuk kategori ini.</p>}
            </div>
            <div className="flex gap-2 mb-2 flex-wrap">
              <input style={{ flex: 1, minWidth: 160 }} placeholder="Tambah sub baru (cth. Makan)" value={subName} onChange={(e) => setSubName(e.target.value)} onKeyDown={onEnter(addSub)} />
              <NewValueInput value={subPercent} onValue={setSubPercent} mode={subMode} onMode={setSubMode} />
              <button className="btn-ghost" onClick={addSub}><Plus size={16} /></button>
            </div>
            <ProgressBar percent={subTotal} color={isHundred(subTotal) ? "var(--teal)" : "var(--gold)"} />
            <div className="flex items-center justify-between mt-1 text-xs muted">
              <span>Total sub: {fmtPercent(subTotal)}%</span>
              <span>Sisa: {fmtPercent(subRemaining)}%</span>
            </div>
            {!isHundred(subTotal) && activeCat.subs.length > 0 && (
              <button
                type="button"
                className="btn-ghost text-xs mt-2"
                onClick={() => setCategories(categories.map((c) => c.id === activeCat.id ? { ...c, subs: autoBalance(c.subs) } : c))}
              >
                Pas-kan otomatis ke 100% (sisa dibulatkan ke sub terbesar)
              </button>
            )}
          </>
        )}

        {error && <p className="text-sm mt-3" style={{ color: "var(--rose)" }}>{error}</p>}

        <div className="flex gap-2 mt-6">
          <button className="btn-ghost flex items-center gap-2" onClick={() => setStep("top")}><ArrowLeft size={16} /> Kembali</button>
          <button className="btn-primary flex-1 flex items-center justify-center gap-2" onClick={finish}>
            Selesai <Check size={16} />
          </button>
        </div>
      </div>
    </Screen>
  );
}

/* ---------- Resume ---------- */
function ResumeScreen({ categories, income, onEdit, onConfirm }) {
  return (
    <Screen stageKey="resume">
      <div className="card p-8 w-full anim-pop" style={{ maxWidth: 620 }}>
        <p className="muted text-xs uppercase tracking-wide mb-1">Langkah 3 dari 3</p>
        <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>Ringkasan Rencana Keuanganmu</h1>
        <p className="muted text-sm mt-1 mb-6">Income bulanan: <span className="tabular">{rupiah(income)}</span></p>

        <div className="flex flex-col gap-4 mb-6">
          {categories.map((c, i) => {
            const amt = income * c.percent / 100;
            return (
              <div key={c.id} className="card2 p-4 anim-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 display" style={{ fontWeight: 700 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 9999, background: COLORS[i % COLORS.length] }} />
                    {c.name}
                    {c.isAsset && <span className="text-xs" style={{ color: "var(--gold)" }}>🏦 Aset</span>}
                  </span>
                  <span className="tabular">{fmtPercent(c.percent)}% · {rupiah(amt)}</span>
                </div>
                {c.subs.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-3 pl-4" style={{ borderLeft: "2px solid var(--border)" }}>
                    {c.subs.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-sm muted">
                        <span>{s.name}</span>
                        <span className="sub-allocation-amount tabular">{fmtPercent(s.percent)}% · {rupiah(amt * s.percent / 100)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <button className="btn-ghost flex items-center gap-2" onClick={onEdit}><Pencil size={15} /> Edit</button>
          <button className="btn-primary flex-1 flex items-center justify-center gap-2" onClick={onConfirm}>
            Konfirmasi & Lanjutkan <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </Screen>
  );
}

/* ---------- Allocation editor (post-setup, opened from dashboard) ---------- */
function AllocationEditor({ user, onSave, onCancel }) {
  const [categories, setCategories] = useState(user.categories.map((c) => ({ ...c, subs: c.subs.map((s) => ({ ...s })) })));
  const [expandedId, setExpandedId] = useState(null);
  const [newCatName, setNewCatName] = useState("");
  const [newCatPercent, setNewCatPercent] = useState("");
  const [newCatMode, setNewCatMode] = useState("percent");
  const [newSubName, setNewSubName] = useState("");
  const [newSubPercent, setNewSubPercent] = useState("");
  const [newSubMode, setNewSubMode] = useState("percent");
  const [error, setError] = useState("");

  const income = user.income;
  const total = categories.reduce((s, c) => s + Number(c.percent || 0), 0);

  const updateCatName = (id, name) => setCategories(categories.map((c) => c.id === id ? { ...c, name } : c));
  const updateCatPercent = (id, percent) => setCategories(categories.map((c) => c.id === id ? { ...c, percent } : c));
  const updateCatIsAsset = (id, isAsset) => setCategories(categories.map((c) => c.id === id ? { ...c, isAsset } : c));
  const removeCat = (id) => { setCategories(categories.filter((c) => c.id !== id)); if (expandedId === id) setExpandedId(null); };
  const addCat = () => {
    const raw = Number(newCatPercent);
    if (!newCatName.trim() || !(raw > 0)) return;
    const p = newCatMode === "amount" ? (income > 0 ? (raw / income) * 100 : 0) : raw;
    setCategories([...categories, { id: uid(), name: newCatName.trim(), percent: p, subs: [] }]);
    setNewCatName(""); setNewCatPercent("");
  };

  const updateSubName = (catId, subId, name) => setCategories(categories.map((c) =>
    c.id === catId ? { ...c, subs: c.subs.map((s) => s.id === subId ? { ...s, name } : s) } : c
  ));
  const updateSubPercent = (catId, subId, percent) => setCategories(categories.map((c) =>
    c.id === catId ? { ...c, subs: c.subs.map((s) => s.id === subId ? { ...s, percent } : s) } : c
  ));
  const removeSub = (catId, subId) => setCategories(categories.map((c) =>
    c.id === catId ? { ...c, subs: c.subs.filter((s) => s.id !== subId) } : c
  ));
  const addSub = (cat) => {
    const raw = Number(newSubPercent);
    if (!newSubName.trim() || !(raw > 0)) return;
    const catAmount = income * cat.percent / 100;
    const p = newSubMode === "amount" ? (catAmount > 0 ? (raw / catAmount) * 100 : 0) : raw;
    setCategories(categories.map((c) => c.id === cat.id ? { ...c, subs: [...c.subs, { id: uid(), name: newSubName.trim(), percent: p }] } : c));
    setNewSubName(""); setNewSubPercent("");
  };

  const save = () => {
    if (!isHundred(total)) { setError(`Total alokasi kategori harus 100%. Saat ini ${fmtPercent(total)}%.`); return; }
    const unbalanced = categories.filter((c) => c.subs.length > 0 && !isHundred(c.subs.reduce((s, x) => s + Number(x.percent || 0), 0)));
    if (unbalanced.length) { setError(`Sub-alokasi belum 100% untuk: ${unbalanced.map((c) => c.name).join(", ")}`); return; }
    if (categories.some((c) => !c.name.trim())) { setError("Nama kategori tidak boleh kosong."); return; }
    onSave(categories);
  };

  return (
    <div className="min-h-screen">
      <TopBar name={user.name} onLogout={onCancel} right={
        <button className="btn-ghost text-sm flex items-center gap-2" onClick={onCancel}><ArrowLeft size={14} /> Batal</button>
      } />
      <div className="p-4 md:p-8 max-w-3xl mx-auto flex flex-col gap-6 anim-fade-up">
        <div>
          <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>Edit alokasi & sub-alokasi</h1>
          <p className="muted text-sm mt-1">
            Ubah persentase atau ketik langsung nominal rupiah — keduanya saling menyesuaikan otomatis.
            Klik nama kategori untuk membuka rincian sub-alokasinya.
          </p>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="muted text-xs uppercase tracking-wide">Kategori utama</p>
            <span className="text-xs tabular" style={{ color: isHundred(total) ? "var(--teal)" : "var(--rose)" }}>
              Total {fmtPercent(total)}%
            </span>
          </div>
          <ProgressBar percent={total} color={isHundred(total) ? "var(--teal)" : "var(--gold)"} />
          {!isHundred(total) && categories.length > 0 && (
            <button
              type="button"
              className="btn-ghost text-xs mt-2"
              onClick={() => setCategories(autoBalance(categories))}
            >
              Pas-kan otomatis ke 100% (sisa dibulatkan ke kategori terbesar)
            </button>
          )}

          <div className="flex flex-col gap-2 mt-4">
            {categories.map((c, i) => {
              const expanded = expandedId === c.id;
              const catAmount = income * c.percent / 100;
              const subTotal = c.subs.reduce((s, x) => s + Number(x.percent || 0), 0);
              return (
                <div key={c.id} className="card2 p-3 anim-fade-up">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      className="flex items-center gap-2 text-sm flex-1"
                      style={{ background: "none", border: "none", color: "var(--text)", cursor: "pointer", textAlign: "left" }}
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                    >
                      <span style={{ width: 10, height: 10, borderRadius: 9999, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                      <ChevronRight size={14} className="muted" style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                      <input
                        value={c.name}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateCatName(c.id, e.target.value)}
                      />
                    </button>
                    <PercentOrAmountInput percent={c.percent} base={income} onChangePercent={(p) => updateCatPercent(c.id, p)} />
                    <span className="tabular text-xs muted" style={{ minWidth: 90, textAlign: "right" }}>{rupiah(catAmount)}</span>
                    <button className="icon-btn" onClick={() => removeCat(c.id)}><Trash2 size={14} color="var(--rose)" /></button>
                  </div>
                  <label className="flex items-center gap-2 text-xs muted mt-2" style={{ cursor: "pointer", paddingLeft: 18 }}>
                    <input
                      type="checkbox"
                      checked={!!c.isAsset}
                      onChange={(e) => updateCatIsAsset(c.id, e.target.checked)}
                      style={{ width: "auto" }}
                    />
                    Ini kategori Tabungan/Investasi (lacak sebagai aset)
                  </label>

                  {expanded && (
                    <div className="mt-3 pl-4 flex flex-col gap-2 anim-fade-up" style={{ borderLeft: "2px solid var(--border)" }}>
                      <div className="flex items-center justify-between">
                        <p className="muted text-xs">Sub-alokasi dari {c.name} (opsional)</p>
                        <span className="text-xs tabular" style={{ color: c.subs.length === 0 || isHundred(subTotal) ? "var(--muted)" : "var(--rose)" }}>
                          {c.subs.length > 0 ? `Total sub ${fmtPercent(subTotal)}%` : "Belum ada sub"}
                        </span>
                      </div>
                      {c.subs.map((s) => (
                        <div key={s.id} className="flex items-center justify-between gap-2">
                          <input className="flex-1" value={s.name} onChange={(e) => updateSubName(c.id, s.id, e.target.value)} />
                          <PercentOrAmountInput percent={s.percent} base={catAmount} onChangePercent={(p) => updateSubPercent(c.id, s.id, p)} />
                          <span className="sub-allocation-amount tabular text-xs muted" style={{ minWidth: 90, textAlign: "right" }}>{rupiah(catAmount * s.percent / 100)}</span>
                          <button className="icon-btn" onClick={() => removeSub(c.id, s.id)}><Trash2 size={14} color="var(--rose)" /></button>
                        </div>
                      ))}
                      {c.subs.length > 0 && !isHundred(subTotal) && (
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          style={{ alignSelf: "flex-start" }}
                          onClick={() => setCategories(categories.map((x) => x.id === c.id ? { ...x, subs: autoBalance(x.subs) } : x))}
                        >
                          Pas-kan otomatis ke 100%
                        </button>
                      )}
                      <div className="flex gap-2 mt-1 flex-wrap">
                        <input style={{ flex: 1, minWidth: 140 }} placeholder="Tambah sub baru" value={newSubName} onChange={(e) => setNewSubName(e.target.value)} onKeyDown={onEnter(() => addSub(c))} />
                        <NewValueInput value={newSubPercent} onValue={setNewSubPercent} mode={newSubMode} onMode={setNewSubMode} />
                        <button className="btn-ghost" onClick={() => addSub(c)}><Plus size={16} /></button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex gap-2 mt-4 flex-wrap">
            <input style={{ flex: 1, minWidth: 160 }} placeholder="Tambah kategori baru" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={onEnter(addCat)} />
            <NewValueInput value={newCatPercent} onValue={setNewCatPercent} mode={newCatMode} onMode={setNewCatMode} />
            <button className="btn-ghost" onClick={addCat}><Plus size={16} /></button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--rose)" }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <div className="flex gap-2">
          <button className="btn-ghost flex items-center gap-2" onClick={onCancel}><X size={15} /> Batal</button>
          <button className="btn-primary flex-1 flex items-center justify-center gap-2" onClick={save}>
            Simpan Perubahan <Check size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Dashboard ---------- */
function TopBar({ name, onLogout, right }) {
  return (
    <div className="app-topbar flex items-center justify-between p-4 md:p-6" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="app-topbar-brand flex items-center gap-2">
        <Wallet size={20} color="var(--gold)" />
        <span className="display" style={{ fontWeight: 700 }}>Pundi</span>
        <span className="muted text-sm">· Halo, {name}</span>
      </div>
      <div className="app-topbar-actions flex items-center gap-3">
        {right}
        <button className="btn-ghost text-sm flex items-center gap-2" onClick={onLogout}>
          <LogOut size={14} /> Keluar
        </button>
      </div>
    </div>
  );
}

function Dashboard({ user, transactions, onOpenCategory, onLogout, onEditAlloc, onAddMoney, onViewHistory, onOpenSettings, onOpenGoals, onOpenCalculator, onConfirmMonthIncome }) {
  const activeMonth = getActiveMonth(user);
  const realCurrentMonth = nowMonthKey();
  const needsNewMonthIncome = realCurrentMonth !== activeMonth;
  const income = getIncomeForMonth(user, activeMonth);

  const monthTx = transactions.filter((t) => monthKey(t.date) === activeMonth);
  const expenses = monthTx.filter(isExpenseTx);
  const topups = monthTx.filter(isTopupTx);
  const globalTopup = topups.filter((t) => !t.categoryId).reduce((s, t) => s + Number(t.amount), 0);
  const totalTopup = topups.reduce((s, t) => s + Number(t.amount), 0);
  const effectiveIncome = income + globalTopup;
  const totalSpent = expenses.reduce((s, t) => s + Number(t.amount), 0);
  const cashIncome = income + totalTopup;
  const thisMonthNet = cashIncome - totalSpent;
  const balance = cumulativeBalanceUpTo(user, transactions, activeMonth);
  const totalAssets = user.categories
    .filter((category) => category.isAsset)
    .reduce((sum, category) => sum + assetBalance(transactions, category.id), 0);
  const totalEquity = balance + totalAssets;
  const prevCarry = balance - thisMonthNet;

  const spentFor = (catId) => expenses.filter((t) => t.categoryId === catId && !t.directAsset).reduce((s, t) => s + Number(t.amount), 0);
  const withdrawFor = (catId) => monthTx.filter((t) => t.categoryId === catId && isWithdrawTx(t)).reduce((s, t) => s + Number(t.amount), 0);
  const directTopupFor = (catId) => topups.filter((t) => t.categoryId === catId && !t.subId).reduce((s, t) => s + Number(t.amount), 0);
  const subTopupFor = (catId) => topups.filter((t) => t.categoryId === catId && t.subId).reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div className="min-h-screen">
      <TopBar
        name={user.name}
        onLogout={onLogout}
        right={
          <>
            <button className="btn-ghost text-sm flex items-center gap-2" onClick={onEditAlloc}><Pencil size={14} /> Edit Alokasi</button>
            <button className="btn-ghost text-sm flex items-center gap-2" onClick={onOpenSettings}><Settings size={14} /> Pengaturan</button>
          </>
        }
      />
      <div className="p-4 md:p-8 max-w-4xl mx-auto flex flex-col gap-6 anim-fade-up">
        {needsNewMonthIncome && (
          <div className="card p-4 flex items-center justify-between flex-wrap gap-3" style={{ borderColor: "var(--gold)" }}>
            <div className="flex items-center gap-2">
              <AlertCircle size={16} color="var(--gold)" />
              <p className="text-sm">
                Kamu masih melihat data <b>{monthLabelFor(activeMonth)}</b>. Belum ada income yang diinput untuk{" "}
                <b>{monthLabelFor(realCurrentMonth)}</b> — saldo & alokasi bulan lalu tetap ditampilkan sampai kamu input manual.
              </p>
            </div>
            <button className="btn-primary text-sm flex items-center gap-2" onClick={onConfirmMonthIncome}>
              <Plus size={14} /> Input Income Bulan Ini
            </button>
          </div>
        )}

        <div className="card p-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="muted text-sm">Ringkasan {monthLabelFor(activeMonth)}</p>
            <div className="dashboard-actions flex gap-2">
              <button className="btn-ghost text-sm flex items-center gap-2" onClick={onViewHistory}>Riwayat Bulanan</button>
              <button className="btn-ghost text-sm flex items-center gap-2" onClick={onOpenGoals}><Target size={14} /> Tujuan Tabungan</button>
              <button className="btn-ghost text-sm flex items-center gap-2" onClick={onOpenCalculator}><Calculator size={14} /> Kalkulator</button>
              <button className="btn-primary text-sm flex items-center gap-2" onClick={onAddMoney}><Plus size={14} /> Tambah Uang</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-8 mt-3">
            <div>
              <p className="muted text-xs uppercase tracking-wide">Income</p>
              <p className="display tabular" style={{ fontSize: 20, fontWeight: 700 }}>{rupiah(cashIncome)}</p>
              {totalTopup > 0 && <p className="text-xs mt-0.5" style={{ color: "var(--teal)" }}>+{rupiah(totalTopup)} tambahan bulan ini</p>}
            </div>
            <div>
              <p className="muted text-xs uppercase tracking-wide">Terpakai</p>
              <p className="display tabular" style={{ fontSize: 20, fontWeight: 700, color: "var(--rose)" }}>{rupiah(totalSpent)}</p>
            </div>
            <div>
              <p className="muted text-xs uppercase tracking-wide">Sisa Saldo</p>
              <p className="display tabular" style={{ fontSize: 20, fontWeight: 700, color: "var(--teal)" }}>{rupiah(balance)}</p>
              {prevCarry !== 0 && (
                <p className="text-xs mt-0.5 muted">
                  termasuk {rupiah(prevCarry)} bawaan bulan lalu
                </p>
              )}
            </div>
            <div>
              <p className="muted text-xs uppercase tracking-wide">Total Equity</p>
              <p className="display tabular" style={{ fontSize: 20, fontWeight: 700, color: "var(--gold)" }}>{rupiah(totalEquity)}</p>
              <p className="text-xs mt-0.5 muted">Saldo + aset tercatat</p>
            </div>
          </div>
        </div>

        <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <div className="card p-6 anim-pop stagger-1">
            <AllocationRing categories={user.categories} centerLabel="Total Income" centerValue={effectiveIncome} />
          </div>
          <div className="card p-6 anim-pop stagger-1">
            <SpendingTrendChart transactions={transactions} currentMonth={activeMonth} />
          </div>
        </div>

        <div>
          <p className="muted text-xs uppercase tracking-wide mb-3">Kategori alokasi</p>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {user.categories.map((c, i) => {
              const allocated = effectiveIncome * c.percent / 100 + directTopupFor(c.id) + subTopupFor(c.id);
              const spent = spentFor(c.id) - (c.isAsset ? withdrawFor(c.id) : 0);
              const pct = allocated > 0 ? (spent / allocated) * 100 : 0;
              return (
                <button
                  key={c.id}
                  className="card2 p-4 text-left cat-card anim-fade-up"
                  style={{ animationDelay: `${i * 70}ms` }}
                  onClick={() => onOpenCategory(c.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center gap-2 font-medium">
                      <span style={{ width: 10, height: 10, borderRadius: 9999, background: COLORS[i % COLORS.length] }} />
                      {c.name}
                      {c.isAsset && <span className="text-xs" style={{ color: "var(--gold)" }}>🏦</span>}
                    </span>
                    <ChevronRight size={16} className="muted" />
                  </div>
                  <p className="muted text-xs mb-1">{fmtPercent(c.percent)}% dari income</p>
                  {c.isAsset ? (
                    <>
                      <p className="tabular" style={{ fontWeight: 700, color: "var(--teal)" }}>{rupiah(assetBalance(transactions, c.id))} <span className="muted font-normal text-xs">saldo</span></p>
                      <ProgressBar percent={pct} color={pct > 100 ? "var(--rose)" : pct >= 80 ? "#D9A441" : COLORS[i % COLORS.length]} />
                      <div className="flex justify-between mt-2 text-xs tabular">
                        <span className="muted">{rupiah(spent)} disetor bulan ini</span>
                        <span className="muted">target {rupiah(allocated)}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <ProgressBar percent={pct} color={pct > 100 ? "var(--rose)" : pct >= 80 ? "#D9A441" : COLORS[i % COLORS.length]} />
                      <div className="flex justify-between mt-2 text-xs tabular">
                        <span style={{ color: "var(--rose)" }}>{rupiah(spent)} terpakai</span>
                        <span className="muted">{rupiah(allocated)}</span>
                      </div>
                    </>
                  )}
                  {pct >= 80 && pct < 100 && (
                    <p className="text-xs mt-1" style={{ color: "#D9A441" }}>⚠ Hampir mencapai limit</p>
                  )}
                  {pct === 100 && (
                    <p className="text-xs mt-1" style={{ color: "#e50000" }}>⚠ Sudah mencapai limit</p>
                  )}
                  {pct > 100 && (
                    <p className="text-xs mt-1" style={{ color: "var(--rose)" }}>⚠ Melebihi alokasi</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
/* ---------- Category detail ---------- */
function CategoryDetail({ user, categoryId, transactions, onBack, onAddTx, onUpdateTx, onDeleteTx, onAddRecurring, onRemoveRecurring, onLogout }) {
  const cat = user.categories.find((c) => c.id === categoryId);
  const [amount, setAmount] = useState("");
  const [subId, setSubId] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayStr());
  const [formError, setFormError] = useState("");
  const [assetMode, setAssetMode] = useState("setor"); // setor | tarik
  const [search, setSearch] = useState("");
  const [editingTx, setEditingTx] = useState(null);
  const [recName, setRecName] = useState("");
  const [recAmount, setRecAmount] = useState("");
  const [recSubId, setRecSubId] = useState("");
  const [recError, setRecError] = useState("");
  const [expandAllTx, setExpandAllTx] = useState(false);

  if (!cat) return null;
  const isAsset = !!cat.isAsset;
  const activeMonth = getActiveMonth(user);
  const income = getIncomeForMonth(user, activeMonth);
  const allMonthTx = transactions.filter((t) => monthKey(t.date) === activeMonth);
  const globalTopup = allMonthTx.filter((t) => isTopupTx(t) && !t.categoryId).reduce((s, t) => s + Number(t.amount), 0);
  const effectiveIncome = income + globalTopup;
  const directTopup = allMonthTx.filter((t) => isTopupTx(t) && t.categoryId === cat.id && !t.subId).reduce((s, t) => s + Number(t.amount), 0);
  const subTopupTotal = allMonthTx.filter((t) => isTopupTx(t) && t.categoryId === cat.id && t.subId).reduce((s, t) => s + Number(t.amount), 0);
  const baseAllocated = effectiveIncome * cat.percent / 100;
  const allocated = baseAllocated + directTopup + subTopupTotal;
  const monthTx = allMonthTx.filter((t) => t.categoryId === cat.id);
  const spent = monthTx.filter(isExpenseTx).reduce((s, t) => s + Number(t.amount), 0);
  const withdrawn = monthTx.filter(isWithdrawTx).reduce((s, t) => s + Number(t.amount), 0);
  const netAssetMovement = spent - withdrawn;
  const remaining = allocated - (isAsset ? netAssetMovement : spent);
  const catPct = allocated > 0 ? ((isAsset ? netAssetMovement : spent) / allocated) * 100 : 0;
  const catSaldo = assetBalance(transactions, cat.id);
  const history = transactions.filter((t) => t.categoryId === cat.id && monthKey(t.date) === activeMonth).sort((a, b) => (a.date < b.date ? 1 : -1));
  const filteredHistory = search.trim()
    ? history.filter((t) => {
        const subName = cat.subs.find((s) => s.id === t.subId)?.name || "";
        const q = search.trim().toLowerCase();
        return (t.note || "").toLowerCase().includes(q) || subName.toLowerCase().includes(q) || t.date.includes(q);
      })
    : history;
  const recurring = (user.recurring || []).filter((r) => r.categoryId === cat.id);

  const spentForSub = (sid) => monthTx.filter((t) => t.subId === sid && isExpenseTx(t) && !t.directAsset).reduce((s, t) => s + Number(t.amount), 0);
  const withdrawnForSub = (sid) => monthTx.filter((t) => t.subId === sid && isWithdrawTx(t)).reduce((s, t) => s + Number(t.amount), 0);
  const topupForSub = (sid) => monthTx.filter((t) => t.subId === sid && isTopupTx(t)).reduce((s, t) => s + Number(t.amount), 0);

  const checkBalance = (amt, targetSubId) => {
    if (targetSubId) {
      const sub = cat.subs.find((s) => s.id === targetSubId);
      if (sub) {
        const subAlloc = baseAllocated * sub.percent / 100 + topupForSub(sub.id);
        const subMovement = spentForSub(sub.id) - (isAsset ? withdrawnForSub(sub.id) : 0);
        const subRemaining = subAlloc - subMovement;
        if (amt > subRemaining) return `Sisa alokasi "${sub.name}" tidak mencukupi. Sisa saat ini ${rupiah(subRemaining)}.`;
      }
    }
    if (amt > remaining) return `Sisa alokasi "${cat.name}" tidak mencukupi. Sisa saat ini ${rupiah(remaining)}.`;
    return "";
  };

  const submitSetor = () => {
    const amt = Number(amount);
    if (!(amt > 0)) { setFormError("Masukkan jumlah yang valid."); return; }
    const err = checkBalance(amt, subId);
    if (err) { setFormError(err); return; }
    setFormError("");
    onAddTx({ id: uid(), type: "expense", categoryId: cat.id, subId: subId || null, amount: amt, note: note.trim(), date });
    setAmount(""); setNote(""); setSubId("");
  };
  const submitTarik = () => {
    const amt = Number(amount);
    if (!(amt > 0)) { setFormError("Masukkan jumlah yang valid."); return; }
    const cap = subId ? assetBalance(transactions, cat.id, subId) : catSaldo;
    if (amt > cap) { setFormError(`Saldo tidak mencukupi. Saldo tersedia saat ini ${rupiah(cap)}.`); return; }
    setFormError("");
    onAddTx({ id: uid(), type: "withdraw", categoryId: cat.id, subId: subId || null, amount: amt, note: note.trim(), date });
    setAmount(""); setNote(""); setSubId("");
  };
  const submit = () => (isAsset && assetMode === "tarik" ? submitTarik() : submitSetor());

  const recordRecurring = (r) => {
    const err = checkBalance(r.amount, r.subId);
    if (err) { setRecError(err); return; }
    setRecError("");
    onAddTx({ id: uid(), type: "expense", categoryId: cat.id, subId: r.subId || null, amount: r.amount, note: r.name, date: todayStr() });
  };
  const addRecurringTemplate = () => {
    if (!recName.trim() || !(Number(recAmount) > 0)) return;
    onAddRecurring({ id: uid(), categoryId: cat.id, subId: recSubId || null, name: recName.trim(), amount: Number(recAmount) });
    setRecName(""); setRecAmount(""); setRecSubId("");
  };

  return (
    <div className="min-h-screen">
      <TopBar
        name={user.name}
        onLogout={onLogout}
        right={<button className="btn-ghost text-sm flex items-center gap-2" onClick={onBack}><ArrowLeft size={14} /> Dashboard</button>}
      />
      <div className="p-4 md:p-8 max-w-3xl mx-auto flex flex-col gap-6 anim-fade-up">
        <div className="card p-6">
          <div className="flex items-center gap-2">
            <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>{cat.name}</h1>
            {isAsset && <span className="text-xs" style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 9999, padding: "2px 8px", color: "var(--gold)" }}>🏦 Aset</span>}
          </div>
          <p className="muted text-sm mb-3">
            {fmtPercent(cat.percent)}% dari income bulanan
            {activeMonth !== nowMonthKey() && <> · menampilkan data <b style={{ color: "var(--text)" }}>{monthLabelFor(activeMonth)}</b></>}
          </p>
          {isAsset ? (
            <>
              <div className="flex flex-wrap gap-8">
                <div>
                  <p className="muted text-xs uppercase tracking-wide">Target alokasi bulan ini</p>
                  <p className="tabular" style={{ fontWeight: 700 }}>{rupiah(allocated)}</p>
                  {directTopup > 0 && <p className="text-xs mt-0.5" style={{ color: "var(--teal)" }}>+{rupiah(directTopup)} tambahan</p>}
                </div>
              </div>
              <p className="muted text-xs mt-3">
                Uang yang disetor ke sini bukan "hilang" seperti pengeluaran biasa — ini menambah saldo asetmu. Saat ditarik,
                saldo aset berkurang dan dana kembali ke saldo yang bisa digunakan.
              </p>
              <div className="mt-3"><ProgressBar percent={catPct} color={catPct > 100 ? "var(--rose)" : catPct >= 80 ? "#D9A441" : "var(--gold)"} /></div>
              {catPct >= 80 && catPct <= 100 && <p className="text-xs mt-1" style={{ color: "#D9A441" }}>⚠ Setoran bulan ini hampir mencapai target alokasi</p>}
              {catPct > 100 && <p className="text-xs mt-1" style={{ color: "var(--rose)" }}>⚠ Setoran bulan ini sudah melebihi target alokasi</p>}
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-8">
                <div>
                  <p className="muted text-xs uppercase tracking-wide">Alokasi</p>
                  <p className="tabular" style={{ fontWeight: 700 }}>{rupiah(allocated)}</p>
                  {directTopup > 0 && <p className="text-xs mt-0.5" style={{ color: "var(--teal)" }}>+{rupiah(directTopup)} tambahan</p>}
                </div>
                <div>
                  <p className="muted text-xs uppercase tracking-wide">Terpakai bulan ini</p>
                  <p className="tabular" style={{ fontWeight: 700, color: "var(--rose)" }}>{rupiah(spent)}</p>
                </div>
                <div>
                  <p className="muted text-xs uppercase tracking-wide">Sisa</p>
                  <p className="tabular" style={{ fontWeight: 700, color: remaining < 0 ? "var(--rose)" : "var(--teal)" }}>{rupiah(remaining)}</p>
                </div>
              </div>
              <div className="mt-3"><ProgressBar percent={catPct} color={catPct > 100 ? "var(--rose)" : catPct >= 80 ? "#D9A441" : "var(--gold)"} /></div>
              {catPct >= 80 && catPct < 100 && <p className="text-xs mt-1" style={{ color: "#D9A441" }}>⚠ Hampir mencapai limit alokasi</p>}
              {catPct === 100 && <p className="text-xs mt-1" style={{ color: "#e50000" }}>⚠ Sudah mencapai limit alokasi</p>}
              {catPct > 100 && <p className="text-xs mt-1" style={{ color: "var(--rose)" }}>⚠ Sudah melebihi alokasi</p>}
            </>
          )}
        </div>

        {cat.subs.length > 0 && (
          <div className="card p-6">
            <p className="muted text-xs uppercase tracking-wide mb-3">Rincian sub-alokasi</p>
            <div className="flex flex-col gap-3">
              {cat.subs.map((s, si) => {
                const subAlloc = baseAllocated * s.percent / 100 + topupForSub(s.id);
                const subSpent = spentForSub(s.id) - (isAsset ? withdrawnForSub(s.id) : 0);
                const subRemaining = subAlloc - subSpent;
                const subPct = subAlloc > 0 ? (subSpent / subAlloc) * 100 : 0;
                const subSaldo = assetBalance(transactions, cat.id, s.id);
                return (
                  <div key={s.id} className="card2 p-3 anim-fade-up" style={{ animationDelay: `${si * 60}ms` }}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{s.name} <span className="muted">({fmtPercent(s.percent)}%)</span></span>
                      {isAsset ? (
                        <span className="sub-allocation-amount tabular" style={{ color: "var(--teal)" }}>Saldo {rupiah(subSaldo)}</span>
                      ) : (
                        <span className="sub-allocation-amount tabular muted">{rupiah(subSpent)} / {rupiah(subAlloc)}</span>
                      )}
                    </div>
                    {isAsset && <p className="sub-allocation-amount muted text-xs mb-1">Setor bulan ini: {rupiah(subSpent)} dari target {rupiah(subAlloc)}</p>}
                    {!isAsset && <p className="sub-allocation-amount muted text-xs mb-1">Sisa: <span style={{ color: subRemaining < 0 ? "var(--rose)" : "var(--teal)" }}>{rupiah(subRemaining)}</span></p>}
                    <ProgressBar percent={subPct} color={subPct > 100 ? "var(--rose)" : subPct >= 80 ? "#D9A441" : COLORS[si % COLORS.length]} />
                    {subPct >= 80 && subPct < 100 && <p className="text-xs mt-1" style={{ color: "#D9A441" }}>⚠ Hampir mencapai limit</p>}
                    {subPct === 100 && <p className="text-xs mt-1" style={{ color: "#e50000" }}>⚠ Sudah mencapai limit</p>}
                    {subPct > 100 && <p className="text-xs mt-1" style={{ color: "var(--rose)" }}>⚠ Melebihi alokasi</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="card p-6">
          {isAsset ? (
            <>
              <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                <p className="muted text-xs uppercase tracking-wide">Setor / Tarik Dana</p>
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost text-xs" style={assetMode === "setor" ? { borderColor: "var(--teal)", color: "var(--teal)" } : {}} onClick={() => { setAssetMode("setor"); setFormError(""); }}>Setor</button>
                  <button type="button" className="btn-ghost text-xs" style={assetMode === "tarik" ? { borderColor: "var(--rose)", color: "var(--rose)" } : {}} onClick={() => { setAssetMode("tarik"); setFormError(""); }}>Tarik</button>
                </div>
              </div>
              <p className="muted text-xs mb-3">
                {assetMode === "setor"
                  ? <>Sisa target setor bulan ini: <span className="tabular" style={{ color: remaining < 0 ? "var(--rose)" : "var(--teal)" }}>{rupiah(remaining)}</span></>
                  : <>Saldo tersedia untuk ditarik: <span className="tabular" style={{ color: "var(--teal)" }}>{rupiah(subId ? assetBalance(transactions, cat.id, subId) : catSaldo)}</span></>}
              </p>
            </>
          ) : (
            <>
              <p className="muted text-xs uppercase tracking-wide mb-1">Catat pengeluaran</p>
              <p className="muted text-xs mb-3">
                Sisa alokasi {cat.name}: <span className="tabular" style={{ color: remaining < 0 ? "var(--rose)" : "var(--teal)" }}>{rupiah(remaining)}</span>
              </p>
            </>
          )}
          <div className="transaction-form flex flex-wrap gap-3">
            <input
              style={{ maxWidth: 160 }}
              type="number"
              placeholder="Jumlah (Rp)"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setFormError(""); }}
            />
            {cat.subs.length > 0 && (
              <select value={subId} onChange={(e) => { setSubId(e.target.value); setFormError(""); }} style={{ maxWidth: 180 }}>
                <option value="">Tanpa sub-kategori</option>
                {cat.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <input style={{ maxWidth: 160 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input
              style={{ flex: 1, minWidth: 160 }}
              placeholder="Catatan (opsional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={onEnter(submit)}
            />
            <button
              className="btn-primary flex items-center gap-2"
              style={isAsset && assetMode === "tarik" ? { background: "var(--rose)", color: "#fff" } : {}}
              onClick={submit}
            >
              <Plus size={16} /> {isAsset ? (assetMode === "tarik" ? "Tarik" : "Setor") : "Tambah"}
            </button>
          </div>
          {formError && (
            <div className="flex items-center gap-2 text-sm mt-3" style={{ color: "var(--rose)" }}>
              <AlertCircle size={14} /> {formError}
            </div>
          )}
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-2 mb-3">
            <Repeat size={14} className="muted" />
            <p className="muted text-xs uppercase tracking-wide">{isAsset ? "Setoran Rutin (auto-nabung/auto-invest)" : "Tagihan / Pengeluaran Rutin"}</p>
          </div>
          <div className="flex flex-col gap-2">
            {recurring.length === 0 && <p className="muted text-sm">Belum ada {isAsset ? "setoran rutin" : "tagihan rutin"} untuk kategori ini.</p>}
            {recurring.map((r) => {
              const subName = cat.subs.find((s) => s.id === r.subId)?.name;
              return (
                <div key={r.id} className="card2 p-3 flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm">{r.name}{subName ? ` · ${subName}` : ""}</p>
                    <p className="muted text-xs tabular">{rupiah(r.amount)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="btn-ghost text-xs flex items-center gap-1" onClick={() => recordRecurring(r)}><Plus size={13} /> Catat Sekarang</button>
                    <button className="icon-btn" onClick={() => onRemoveRecurring(r.id)}><Trash2 size={14} color="var(--rose)" /></button>
                  </div>
                </div>
              );
            })}
          </div>
          {recError && <div className="flex items-center gap-2 text-sm mt-3" style={{ color: "var(--rose)" }}><AlertCircle size={14} /> {recError}</div>}
          <div className="flex gap-2 mt-3 flex-wrap">
            <input style={{ flex: 1, minWidth: 140 }} placeholder={isAsset ? "Nama setoran (cth. Reksadana)" : "Nama tagihan (cth. Listrik)"} value={recName} onChange={(e) => setRecName(e.target.value)} onKeyDown={onEnter(addRecurringTemplate)} />
            {cat.subs.length > 0 && (
              <select value={recSubId} onChange={(e) => setRecSubId(e.target.value)} style={{ maxWidth: 160 }}>
                <option value="">Tanpa sub-kategori</option>
                {cat.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <input style={{ maxWidth: 140 }} type="number" placeholder="Nominal" value={recAmount} onChange={(e) => setRecAmount(e.target.value)} onKeyDown={onEnter(addRecurringTemplate)} />
            <button className="btn-ghost" onClick={addRecurringTemplate}><Plus size={16} /></button>
          </div>
        </div>

        {!isAsset && (
          <div className="card p-6">
            <DailySpendingChart monthTx={monthTx} monthKey={activeMonth} />
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <p className="muted text-xs uppercase tracking-wide">Riwayat transaksi · {monthLabelFor(activeMonth)}</p>
            <div className="flex items-center gap-1.5" style={{ maxWidth: 220 }}>
              <Search size={14} className="muted" />
              <input style={{ fontSize: 12 }} placeholder="Cari catatan / sub / tanggal" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {filteredHistory.length === 0 && <p className="muted text-sm">Tidak ada transaksi yang cocok.</p>}
            {filteredHistory.slice(0, expandAllTx ? filteredHistory.length : 5).map((t, hi) => {
              const subName = cat.subs.find((s) => s.id === t.subId)?.name;
              const topup = isTopupTx(t);
              const withdraw = isWithdrawTx(t);
              const positive = topup || (isAsset && !withdraw); // setor & topup are "adds", tarik is "reduces"
              const label = withdraw ? "Tarik" : topup ? "Tambahan dana" : isAsset ? "Setor" : null;
              return (
                <div key={t.id} className="card2 p-3 flex items-center justify-between anim-fade-up" style={{ animationDelay: `${Math.min(hi, 8) * 40}ms` }}>
                  <div>
                    <p className="text-sm">{t.note || subName || label || cat.name}</p>
                    <p className="muted text-xs">{t.date}{subName ? ` · ${subName}` : ""}{label ? ` · ${label}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="transaction-amount tabular" style={{ color: positive ? "var(--teal)" : "var(--rose)" }}>{positive ? "+" : "-"}{rupiah(t.amount)}</span>
                    <button className="icon-btn" onClick={() => setEditingTx(t)}><Pencil size={14} className="muted" /></button>
                    <button className="icon-btn" onClick={() => onDeleteTx(t.id)}><X size={15} className="muted" /></button>
                  </div>
                </div>
              );
            })}
            {filteredHistory.length > 5 && (
              <button 
                className="btn-ghost text-sm mt-2 flex items-center justify-center gap-2"
                onClick={() => setExpandAllTx(!expandAllTx)}
              >
                <ChevronRight size={16} style={{ transform: expandAllTx ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
                {expandAllTx ? "Sembunyikan" : `Lihat ${filteredHistory.length - 5} transaksi lainnya`}
              </button>
            )}
          </div>
        </div>
      </div>

      {editingTx && (
        <EditTransactionModal
          tx={editingTx}
          cat={cat}
          onClose={() => setEditingTx(null)}
          onSave={(updated) => { onUpdateTx(updated); setEditingTx(null); }}
        />
      )}
    </div>
  );
}

/* ---------- App ---------- */
/* ---------- Add money modal ---------- */
function AddMoneyModal({ user, onClose, onSubmit }) {
  const [target, setTarget] = useState("global"); // global | category | sub | asset
  const [categoryId, setCategoryId] = useState(user.categories[0]?.id || "");
  const [subId, setSubId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayStr());

  const cat = user.categories.find((c) => c.id === categoryId);

  const chooseCategory = (id) => { setCategoryId(id); setSubId(""); };

  const submit = () => {
    const amt = Number(amount);
    if (!(amt > 0)) return;
    if ((target === "sub" || target === "asset") && !categoryId) return;
    if (target === "sub" && !subId) return;
    onSubmit({
      id: uid(),
      type: target === "asset" ? "asset_topup" : "topup",
      categoryId: target === "global" ? null : categoryId,
      subId: target === "sub" ? subId : null,
      amount: amt,
      note: note.trim(),
      date,
      directAsset: target === "asset",
    });
  };

  const tabStyle = (active) => active ? { borderColor: "var(--gold)", color: "var(--gold)" } : {};

  return (
    <div className="modal-overlay anim-fade" onClick={onClose}>
      <div className="card p-6 anim-pop" style={{ maxWidth: 440, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="display" style={{ fontSize: 18, fontWeight: 700 }}>Tambah Uang</h2>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="muted text-sm mb-4">
          Tambahkan dana bulan ini ke seluruh alokasi, kategori tertentu, sub-alokasi,
          atau langsung mencatatnya sebagai saldo aset.
        </p>

        <div className="flex flex-col gap-4">
          <Field label="Tujuan dana">
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn-ghost text-sm" style={tabStyle(target === "global")} onClick={() => setTarget("global")}>Seluruh Alokasi</button>
              <button type="button" className="btn-ghost text-sm" style={tabStyle(target === "category")} onClick={() => setTarget("category")}>Kategori Tertentu</button>
              <button type="button" className="btn-ghost text-sm" style={tabStyle(target === "sub")} onClick={() => setTarget("sub")}>Sub-alokasi Tertentu</button>
              <button type="button" className="btn-ghost text-sm" style={tabStyle(target === "asset")} onClick={() => { setTarget("asset"); setSubId(""); }}>Saldo Aset</button>
            </div>
          </Field>

          {(target === "category" || target === "sub" || target === "asset") && (
            <Field label="Kategori">
              <select value={categoryId} onChange={(e) => chooseCategory(e.target.value)}>
               {(target === "asset" ? user.categories.filter((c) => c.isAsset) : user.categories).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}

          {target === "sub" && cat && cat.subs.length > 0 && (
            <Field label="Sub-alokasi">
              <select value={subId} onChange={(e) => setSubId(e.target.value)}>
                <option value="">Pilih sub-alokasi</option>
                {cat.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          {target === "asset" && <p className="muted text-xs">Dana ini langsung menambah saldo kategori aset dan tidak dihitung sebagai pemakaian alokasi.</p>}
          {target === "sub" && cat && cat.subs.length === 0 && (
            <p className="text-sm" style={{ color: "var(--rose)" }}>Kategori ini belum punya sub-alokasi. Tambahkan lewat Edit Alokasi dulu.</p>
          )}

          <Field label="Nominal">
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="cth. 500000" />
          </Field>
          <Field label="Tanggal">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Catatan (opsional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onEnter(submit)} placeholder="cth. Bonus kerja" />
          </Field>

          <button
            className="btn-primary flex items-center justify-center gap-2 mt-1"
            onClick={submit}
            disabled={!(Number(amount) > 0) || ((target === "sub" || target === "asset") && !cat)}
          >
            <Plus size={16} /> Tambahkan Dana
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Monthly history ---------- */
function MonthlyHistory({ user, transactions, onBack, onUpdateTx, onDeleteTx }) {
  const activeMonth = getActiveMonth(user);
  const allMonths = Array.from(new Set([
    nowMonthKey(),
    ...Object.keys(user.monthlyIncomes || {}),
    ...transactions.map((t) => monthKey(t.date)),
  ]))
    .filter(Boolean)
    .sort()
    .reverse();
  const [selected, setSelected] = useState(activeMonth);
  const [expandedCat, setExpandedCat] = useState(null);
  const [search, setSearch] = useState("");
  const [editingTx, setEditingTx] = useState(null);

  const monthT = transactions.filter((t) => monthKey(t.date) === selected);
  const expenses = monthT.filter(isExpenseTx);
  const topups = monthT.filter(isTopupTx);
  const globalTopup = topups.filter((t) => !t.categoryId).reduce((s, t) => s + Number(t.amount), 0);
  const totalTopup = topups.reduce((s, t) => s + Number(t.amount), 0);
  const selectedIncome = getIncomeForMonth(user, selected);
  const hasIncomeRecord = Object.prototype.hasOwnProperty.call(user.monthlyIncomes || {}, selected);
  const effectiveIncome = selectedIncome + globalTopup;
  const totalSpent = expenses.reduce((s, t) => s + Number(t.amount), 0);
  const cashIncome = selectedIncome + totalTopup;
  const thisMonthNet = cashIncome - totalSpent;
  const balance = cumulativeBalanceUpTo(user, transactions, selected);
  const prevCarry = balance - thisMonthNet;

  const directTopupForCat = (catId) => topups.filter((t) => t.categoryId === catId && !t.subId).reduce((s, t) => s + Number(t.amount), 0);
  const topupForSub = (catId, subId) => topups.filter((t) => t.categoryId === catId && t.subId === subId).reduce((s, t) => s + Number(t.amount), 0);
  const spentForCat = (catId) => expenses.filter((t) => t.categoryId === catId && !t.directAsset).reduce((s, t) => s + Number(t.amount), 0);
  const spentForSub = (catId, subId) => expenses.filter((t) => t.categoryId === catId && t.subId === subId && !t.directAsset).reduce((s, t) => s + Number(t.amount), 0);

  const monthTxSorted = [...monthT].sort((a, b) => (a.date < b.date ? 1 : -1));
  const filteredTx = search.trim()
    ? monthTxSorted.filter((t) => {
        const cat = user.categories.find((c) => c.id === t.categoryId);
        const sub = cat?.subs.find((s) => s.id === t.subId);
        const q = search.trim().toLowerCase();
        return (t.note || "").toLowerCase().includes(q) || (cat?.name || "").toLowerCase().includes(q) || (sub?.name || "").toLowerCase().includes(q) || t.date.includes(q);
      })
    : monthTxSorted;

  const trendMonths = allMonths.slice(0, 6).slice().reverse();
  const trendData = trendMonths.map((mKey) => ({
    mKey,
    spent: transactions.filter((t) => monthKey(t.date) === mKey && isExpenseTx(t)).reduce((s, t) => s + Number(t.amount), 0),
  }));
  const trendMax = Math.max(1, ...trendData.map((d) => d.spent));

  return (
    <div className="min-h-screen">
      <TopBar
        name={user.name}
        onLogout={onBack}
        right={<button className="btn-ghost text-sm flex items-center gap-2" onClick={onBack}><ArrowLeft size={14} /> Dashboard</button>}
      />
      <div className="p-4 md:p-8 max-w-3xl mx-auto flex flex-col gap-6 anim-fade-up">
        <div>
          <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>Riwayat Bulanan</h1>
          <p className="muted text-sm mt-1">Pengeluaran & tambahan dana per bulan, dirinci per alokasi.</p>
        </div>

        {trendData.length > 1 && (
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={14} className="muted" />
              <p className="muted text-xs uppercase tracking-wide">Tren Pengeluaran ({trendData.length} Bulan Terakhir)</p>
            </div>
            <div className="flex items-end gap-3" style={{ height: 120 }}>
              {trendData.map((d) => (
                <div key={d.mKey} className="flex-1 flex flex-col items-center justify-end gap-1" style={{ height: "100%" }}>
                  <span className="tabular" style={{ fontSize: 10, color: "var(--muted)" }}>{Math.round(d.spent / 1000)}k</span>
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 36,
                      height: `${Math.max(4, (d.spent / trendMax) * 90)}px`,
                      borderRadius: "4px 4px 0 0",
                      background: d.mKey === selected ? "var(--gold)" : "var(--surface2)",
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                      transition: "height .3s ease",
                    }}
                    onClick={() => { setSelected(d.mKey); setExpandedCat(null); }}
                  />
                  <span className="muted" style={{ fontSize: 10 }}>{monthLabelFor(d.mKey).split(" ")[0].slice(0, 3)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {allMonths.map((mKey) => (
            <button
              key={mKey}
              className="btn-ghost text-sm"
              style={mKey === selected ? { borderColor: "var(--gold)", color: "var(--gold)" } : {}}
              onClick={() => { setSelected(mKey); setExpandedCat(null); }}
            >
              {monthLabelFor(mKey)}
            </button>
          ))}
        </div>

        <div className="card p-6">
            <div className="summary-metrics flex flex-wrap gap-8">
            <div>
              <p className="muted text-xs uppercase tracking-wide">Income efektif</p>
              <p className="tabular" style={{ fontWeight: 700 }}>{rupiah(cashIncome)}</p>
              {totalTopup > 0 && <p className="text-xs mt-0.5" style={{ color: "var(--teal)" }}>termasuk +{rupiah(totalTopup)} tambahan</p>}
              {!hasIncomeRecord && <p className="text-xs mt-0.5 muted">*belum ada input income khusus bulan ini, pakai income terakhir yang diketahui</p>}
            </div>
            <div>
              <p className="muted text-xs uppercase tracking-wide">Total pengeluaran</p>
              <p className="tabular" style={{ fontWeight: 700, color: "var(--rose)" }}>{rupiah(totalSpent)}</p>
            </div>
            <div>
              <p className="muted text-xs uppercase tracking-wide">Sisa saldo</p>
              <p className="tabular" style={{ fontWeight: 700, color: "var(--teal)" }}>{rupiah(balance)}</p>
              {prevCarry !== 0 && <p className="text-xs mt-0.5 muted">termasuk {rupiah(prevCarry)} bawaan bulan sebelumnya</p>}
            </div>
          </div>
        </div>

        <div className="card p-6">
          <p className="muted text-xs uppercase tracking-wide mb-3">Rincian per alokasi</p>
          <div className="flex flex-col gap-2">
            {user.categories.map((c, i) => {
              const directTopup = directTopupForCat(c.id);
              const subTopupTotal = topups.filter((t) => t.categoryId === c.id && t.subId).reduce((s, t) => s + Number(t.amount), 0);
              const baseAllocated = effectiveIncome * c.percent / 100;
              const allocated = baseAllocated + directTopup + subTopupTotal;
              const spent = spentForCat(c.id) - (c.isAsset
                ? monthT.filter((t) => t.categoryId === c.id && isWithdrawTx(t)).reduce((s, t) => s + Number(t.amount), 0)
                : 0);
              const pct = allocated > 0 ? (spent / allocated) * 100 : 0;
              const expanded = expandedCat === c.id;
              return (
                <div key={c.id} className="card2 p-3">
                  <button
                    className="flex items-center justify-between w-full"
                    style={{ background: "none", border: "none", color: "var(--text)", cursor: "pointer" }}
                    onClick={() => setExpandedCat(expanded ? null : c.id)}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <span style={{ width: 10, height: 10, borderRadius: 9999, background: COLORS[i % COLORS.length] }} />
                      {c.name}
                      {c.isAsset && <span style={{ color: "var(--gold)" }}>🏦</span>}
                      <ChevronRight size={14} className="muted" style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                    </span>
                    <span className="tabular text-xs muted">
                      {c.isAsset ? <>saldo {rupiah(assetBalance(transactions, c.id))}</> : <>{rupiah(spent)} / {rupiah(allocated)}</>}
                    </span>
                  </button>
                  <div className="mt-2"><ProgressBar percent={pct} color={pct > 100 ? "var(--rose)" : pct >= 80 ? "#D9A441" : COLORS[i % COLORS.length]} /></div>
                  {expanded && c.subs.length > 0 && (
                    <div className="mt-3 pl-4 flex flex-col gap-2" style={{ borderLeft: "2px solid var(--border)" }}>
                      {c.subs.map((s) => {
                        const subAlloc = baseAllocated * s.percent / 100 + topupForSub(c.id, s.id);
                        const subSpent = spentForSub(c.id, s.id) - (c.isAsset
                          ? monthT.filter((t) => t.categoryId === c.id && t.subId === s.id && isWithdrawTx(t)).reduce((sum, t) => sum + Number(t.amount), 0)
                          : 0);
                        const subRemaining = subAlloc - subSpent;
                        return (
                          <div key={s.id} className="text-sm">
                            <div className="flex justify-between muted mb-1">
                              <span>{s.name}</span>
                              <span className="sub-allocation-amount tabular">{rupiah(subSpent)} / {rupiah(subAlloc)}</span>
                            </div>
                            <div className="flex justify-between muted mb-1 text-xs">
                              <span></span>
                              <span className="sub-allocation-amount tabular" style={{ color: subRemaining < 0 ? "var(--rose)" : "var(--teal)" }}>Sisa: {rupiah(subRemaining)}</span>
                            </div>
                            <ProgressBar percent={subAlloc > 0 ? (subSpent / subAlloc) * 100 : 0} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {expanded && c.subs.length === 0 && <p className="muted text-xs mt-2 pl-4">Kategori ini belum punya sub-alokasi.</p>}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <p className="muted text-xs uppercase tracking-wide">Semua transaksi bulan ini</p>
            <div className="flex items-center gap-1.5" style={{ maxWidth: 220 }}>
              <Search size={14} className="muted" />
              <input style={{ fontSize: 12 }} placeholder="Cari catatan / kategori" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {filteredTx.length === 0 && <p className="muted text-sm">Tidak ada transaksi yang cocok.</p>}
            {filteredTx.map((t) => {
              const cat = user.categories.find((c) => c.id === t.categoryId);
              const sub = cat?.subs.find((s) => s.id === t.subId);
              const topup = isTopupTx(t);
              return (
                <div key={t.id} className="card2 p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm">{t.note || sub?.name || cat?.name || (topup ? "Tambahan dana" : "Pengeluaran")}</p>
                    <p className="muted text-xs">
                      {t.date}
                      {cat ? ` · ${cat.name}` : ""}
                      {sub ? ` · ${sub.name}` : ""}
                      {!cat && topup ? " · Seluruh alokasi" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="transaction-amount tabular" style={{ color: topup ? "var(--teal)" : "var(--rose)" }}>{topup ? "+" : "-"}{rupiah(t.amount)}</span>
                    <button className="icon-btn" onClick={() => setEditingTx(t)}><Pencil size={14} className="muted" /></button>
                    <button className="icon-btn" onClick={() => onDeleteTx(t.id)}><X size={15} className="muted" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {editingTx && (
        <EditTransactionModal
          tx={editingTx}
          cat={user.categories.find((c) => c.id === editingTx.categoryId) || null}
          onClose={() => setEditingTx(null)}
          onSave={(updated) => { onUpdateTx(updated); setEditingTx(null); }}
        />
      )}
    </div>
  );
}

/* ---------- Forgot password modal ---------- */
function ForgotPasswordModal({ onClose }) {
  const [step, setStep] = useState("email"); // email | question | reset | done
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [account, setAccount] = useState(null);
  const [answer, setAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const checkEmail = async () => {
    if (!email.trim()) return;
    setBusy(true); setError("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    if (resetError) { setError(resetError.message); return; }
    setStep("done");
  };

  const verifyAnswer = () => {
    if (!answer.trim()) return;
    if (answer.trim().toLowerCase() !== (account.securityAnswer || "").trim().toLowerCase()) {
      setError("Jawaban belum tepat, coba lagi.");
      return;
    }
    setError("");
    setStep("reset");
  };

  const resetPassword = async () => {
    if (newPassword.length < 4) { setError("Password minimal 4 karakter."); return; }
    if (newPassword !== confirmPassword) { setError("Konfirmasi password tidak sama."); return; }
    setBusy(true); setError("");
    const { error: resetError } = await supabase.auth.updateUser({ password: newPassword });
    if (resetError) { setBusy(false); setError(resetError.message); return; }
    setBusy(false);
    setStep("done");
  };

  return (
    <div className="modal-overlay anim-fade" onClick={onClose}>
      <div className="card p-6 anim-pop" style={{ maxWidth: 420, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="display" style={{ fontSize: 18, fontWeight: 700 }}>Lupa Password</h2>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {step === "email" && (
          <>
            <p className="muted text-sm mb-4">Masukkan email akunmu, kita cek dulu apakah akunnya ada.</p>
            <div className="flex flex-col gap-4">
              <Field label="Email">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={onEnter(checkEmail)}
                  placeholder="cth. naufal@email.com"
                />
              </Field>
              {error && <div className="flex items-center gap-2 text-sm" style={{ color: "var(--rose)" }}><AlertCircle size={14} /> {error}</div>}
              <button className="btn-primary flex items-center justify-center gap-2" onClick={checkEmail} disabled={busy || !email.trim()}>
                Lanjut <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}

        {step === "question" && account && (
          <>
            <p className="muted text-sm mb-4">Jawab pertanyaan keamanan akun <b style={{ color: "var(--text)" }}>{username}</b> ini.</p>
            <div className="flex flex-col gap-4">
              <Field label={account.securityQuestion}>
                <input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={onEnter(verifyAnswer)}
                  placeholder="Jawabanmu"
                />
              </Field>
              {error && <div className="flex items-center gap-2 text-sm" style={{ color: "var(--rose)" }}><AlertCircle size={14} /> {error}</div>}
              <div className="flex gap-2">
                <button className="btn-ghost flex items-center gap-2" onClick={() => setStep("email")}><ArrowLeft size={15} /> Kembali</button>
                <button className="btn-primary flex-1 flex items-center justify-center gap-2" onClick={verifyAnswer} disabled={!answer.trim()}>
                  Verifikasi <Check size={16} />
                </button>
              </div>
            </div>
          </>
        )}

        {step === "reset" && (
          <>
            <p className="muted text-sm mb-4">Jawaban benar. Buat password baru untuk akunmu.</p>
            <div className="flex flex-col gap-4">
              <Field label="Password Baru">
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
              </Field>
              <Field label="Konfirmasi Password Baru">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={onEnter(resetPassword)}
                  placeholder="••••••••"
                />
              </Field>
              {error && <div className="flex items-center gap-2 text-sm" style={{ color: "var(--rose)" }}><AlertCircle size={14} /> {error}</div>}
              <button className="btn-primary flex items-center justify-center gap-2" onClick={resetPassword} disabled={busy}>
                Simpan Password Baru <Check size={16} />
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <div className="check-badge anim-pop-delay" style={{ marginTop: 8 }}><Check size={26} color="#101815" /></div>
            <p className="text-center mt-4" style={{ fontWeight: 600 }}>Email reset password terkirim!</p>
            <p className="muted text-sm text-center mt-1">Buka tautan di email untuk membuat password baru.</p>
            <button className="btn-primary w-full mt-6 flex items-center justify-center gap-2" onClick={onClose}>
              Kembali ke Masuk <ArrowRight size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Reset account data modal ---------- */
function ResetAccountModal({ user, onClose, onConfirm }) {
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = password.length > 0 && confirmText.trim().toUpperCase() === "RESET";

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password });
    if (authError) { setBusy(false); setError("Password salah."); return; }
    await onConfirm();
    setBusy(false);
  };

  return (
    <div className="modal-overlay anim-fade" onClick={onClose}>
      <div className="card p-6 anim-pop" style={{ maxWidth: 420, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="display" style={{ fontSize: 18, fontWeight: 700, color: "var(--rose)" }}>Reset Data Akun</h2>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="muted text-sm mb-4">
          Ini akan menghapus <b style={{ color: "var(--text)" }}>seluruh data keuangan</b> akun{" "}
          <b style={{ color: "var(--text)" }}>{user.username}</b> — nama, umur, income, kategori alokasi, sub-alokasi,
          dan semua riwayat transaksi. Kamu akan diarahkan ke pengisian data dari awal. Aksi ini{" "}
          <b style={{ color: "var(--rose)" }}>tidak bisa dibatalkan</b>. Login (email &amp; password) tidak berubah.
        </p>

        <div className="flex flex-col gap-4">
          <Field label="Password akun (konfirmasi identitas)">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label='Ketik "RESET" untuk melanjutkan'>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} onKeyDown={onEnter(submit)} placeholder="RESET" />
          </Field>
          {error && <div className="flex items-center gap-2 text-sm" style={{ color: "var(--rose)" }}><AlertCircle size={14} /> {error}</div>}

          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={onClose}>Batal</button>
            <button
              className="btn-primary flex-1 flex items-center justify-center gap-2"
              style={{ background: "var(--rose)", color: "#fff" }}
              onClick={submit}
              disabled={!canSubmit || busy}
            >
              <Trash2 size={16} /> Reset Sekarang
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Delete account permanently modal ---------- */
function DeleteAccountModal({ user, onClose, onConfirm }) {
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = password.length > 0 && confirmText.trim().toUpperCase() === "HAPUS";

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setError("");
    const ok = await verifyPassword(password, user);
    if (!ok) { setBusy(false); setError("Password salah."); return; }
    await onConfirm();
    setBusy(false);
  };

  return (
    <div className="modal-overlay anim-fade" onClick={onClose}>
      <div className="card p-6 anim-pop" style={{ maxWidth: 420, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="display" style={{ fontSize: 18, fontWeight: 700, color: "var(--rose)" }}>Hapus Akun Permanen</h2>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="muted text-sm mb-4">
          Ini akan menghapus akun <b style={{ color: "var(--text)" }}>{user.username}</b> beserta seluruh datanya
          secara permanen — termasuk login, email, alokasi, dan riwayat transaksi. Tidak seperti "Reset Data",
          aksi ini juga menghapus akunnya sendiri. Kamu akan langsung logout dan{" "}
          <b style={{ color: "var(--rose)" }}>tidak bisa masuk lagi</b> dengan akun ini.
        </p>

        <div className="flex flex-col gap-4">
          <Field label="Password akun (konfirmasi identitas)">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label='Ketik "HAPUS" untuk melanjutkan'>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} onKeyDown={onEnter(submit)} placeholder="HAPUS" />
          </Field>
          {error && <div className="flex items-center gap-2 text-sm" style={{ color: "var(--rose)" }}><AlertCircle size={14} /> {error}</div>}

          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={onClose}>Batal</button>
            <button
              className="btn-primary flex-1 flex items-center justify-center gap-2"
              style={{ background: "var(--rose)", color: "#fff" }}
              onClick={submit}
              disabled={!canSubmit || busy}
            >
              <Trash2 size={16} /> Hapus Akun
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Settings page ---------- */
function SettingsPage({ user, transactions, theme, onToggleTheme, onUpdateProfile, onImport, onMigrateLocal, onBack, onOpenReset, onOpenDelete, onLogout }) {
  const activeMonth = getActiveMonth(user);
  const [name, setName] = useState(user.name || "");
  const [age, setAge] = useState(user.age || "");
  const [income, setIncome] = useState(user.income || "");
  const [profileSaved, setProfileSaved] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importOk, setImportOk] = useState(false);
  const [migrationError, setMigrationError] = useState("");
  const [migrationOk, setMigrationOk] = useState(false);

  const profileValid = name.trim() && Number(age) > 0 && Number(income) > 0;
  const saveProfile = () => {
    if (!profileValid) return;
    onUpdateProfile({
      name: name.trim(), age: Number(age), income: Number(income),
      monthlyIncomes: { ...(user.monthlyIncomes || {}), [activeMonth]: Number(income) },
    });
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
  };

  const exportJson = () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      app: "Pundi",
      user: {
        name: user.name, age: user.age, income: user.income,
        monthlyIncomes: user.monthlyIncomes || {},
        strategyMode: user.strategyMode, categories: user.categories,
        recurring: user.recurring || [], goals: user.goals || [],
      },
      transactions,
    };
    triggerDownload(`pundi-backup-${user.username}-${todayStr()}.json`, JSON.stringify(backup, null, 2), "application/json");
  };
  const exportCsv = () => {
    triggerDownload(`pundi-transaksi-${user.username}-${todayStr()}.csv`, transactionsToCsv(user, transactions), "text/csv");
  };

  const doImport = () => {
    setImportError(""); setImportOk(false);
    try {
      const parsed = JSON.parse(importText);
      if (!parsed.user || !Array.isArray(parsed.transactions)) throw new Error("format");
      const u = parsed.user;
      if (!Array.isArray(u.categories)) throw new Error("format");
      onImport(
        {
          name: u.name || "", age: u.age || null, income: u.income || null,
          monthlyIncomes: (u.monthlyIncomes && typeof u.monthlyIncomes === "object")
            ? u.monthlyIncomes
            : (u.income ? { [nowMonthKey()]: u.income } : {}),
          strategyMode: u.strategyMode || "custom", categories: u.categories,
          recurring: Array.isArray(u.recurring) ? u.recurring : [],
          goals: Array.isArray(u.goals) ? u.goals : [],
          confirmed: true, stage: "dashboard",
        },
        parsed.transactions
      );
      setImportOk(true);
      setImportText("");
    } catch (e) {
      setImportError("File/teks JSON tidak valid atau formatnya bukan hasil export Pundi.");
    }
  };
  const migrateLocal = () => {
    setMigrationError(""); setMigrationOk(false);
    try {
      const prefix = "pundi:shared:";
      const localUser = JSON.parse(window.localStorage.getItem(`${prefix}mmp_user_${user.username}`) || "null");
      const localTx = JSON.parse(window.localStorage.getItem(`${prefix}mmp_tx_${user.username}`) || "[]");
      if (!localUser || !Array.isArray(localTx)) throw new Error("missing");
      onMigrateLocal({
        name: localUser.name || "", age: localUser.age || null, income: localUser.income || null,
        monthlyIncomes: localUser.monthlyIncomes || {},
        strategyMode: localUser.strategyMode || null, categories: localUser.categories || [],
        recurring: localUser.recurring || [], goals: localUser.goals || [],
        confirmed: !!localUser.confirmed, stage: localUser.stage || "dashboard",
      }, localTx);
      setMigrationOk(true);
    } catch (error) {
      setMigrationError("Data lokal untuk username ini tidak ditemukan di browser ini.");
    }
  };

  return (
    <div className="min-h-screen">
      <TopBar name={user.name} onLogout={onLogout} right={
        <button className="btn-ghost text-sm flex items-center gap-2" onClick={onBack}><ArrowLeft size={14} /> Dashboard</button>
      } />
      <div className="p-4 md:p-8 max-w-2xl mx-auto flex flex-col gap-6 anim-fade-up">
        <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>Pengaturan</h1>

        <div className="card p-6">
          <p className="muted text-xs uppercase tracking-wide mb-3">Profil</p>
          <div className="flex flex-col gap-3">
            <Field label="Nama"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Umur"><input type="number" value={age} onChange={(e) => setAge(e.target.value)} /></Field>
            <Field label={`Income bulan ${monthLabelFor(activeMonth)}`}><input type="number" value={income} onChange={(e) => setIncome(e.target.value)} /></Field>
            <p className="muted text-xs">
              Ini mengoreksi income bulan yang sedang aktif ({monthLabelFor(activeMonth)}), bukan menetapkan income permanen ke depannya.
              Setiap bulan baru tetap perlu diinput manual lewat notifikasi di dashboard.
            </p>
            <p className="muted text-xs">Mengubah income tidak menghapus alokasi/riwayat — nominal tiap kategori otomatis mengikuti persentase yang sudah diatur.</p>
            <button className="btn-primary flex items-center justify-center gap-2" onClick={saveProfile} disabled={!profileValid}>
              <Check size={16} /> {profileSaved ? "Tersimpan!" : "Simpan Profil"}
            </button>
          </div>

          <div className="card p-6">
            <p className="muted text-xs uppercase tracking-wide mb-3">Migrasi dari browser lama</p>
            <p className="muted text-sm">
              Memindahkan akun dan transaksi lokal dengan username <b>{user.username}</b> ke Supabase.
              Jalankan hanya jika data Supabase masih kosong.
            </p>
            <button className="btn-ghost flex items-center gap-2 mt-3" onClick={migrateLocal}>
              <Upload size={15} /> Migrasikan Data Lokal
            </button>
            {migrationError && <p className="text-sm mt-2" style={{ color: "var(--rose)" }}>{migrationError}</p>}
            {migrationOk && <p className="text-sm mt-2" style={{ color: "var(--teal)" }}>Data lokal berhasil dimigrasikan.</p>}
          </div>
        </div>

        <div className="card p-6">
          <p className="muted text-xs uppercase tracking-wide mb-3">Tampilan</p>
          <button className="btn-ghost flex items-center gap-2" onClick={onToggleTheme}>
            {theme === "dark" ? <><Sun size={15} /> Ganti ke Tema Terang</> : <><Moon size={15} /> Ganti ke Tema Gelap</>}
          </button>
        </div>

        <div className="card p-6">
          <p className="muted text-xs uppercase tracking-wide mb-3">Ekspor Data</p>
            <div className="calculator-tabs flex gap-2 flex-wrap">
            <button className="btn-ghost flex items-center gap-2" onClick={exportJson}><Download size={15} /> Backup JSON (semua data)</button>
            <button className="btn-ghost flex items-center gap-2" onClick={exportCsv}><Download size={15} /> Riwayat Transaksi (CSV)</button>
          </div>
        </div>

        <div className="card p-6">
          <p className="muted text-xs uppercase tracking-wide mb-3">Impor Data</p>
          <p className="muted text-sm mb-3">
            Tempel isi file backup JSON (dari fitur Ekspor di atas) untuk memulihkan alokasi & riwayat transaksi.
            Ini akan menimpa data alokasi & transaksi akun ini — login tidak berubah.
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='{"user": {...}, "transactions": [...]}'
            rows={4}
            style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", padding: 10, fontFamily: "monospace", fontSize: 12 }}
          />
          {importError && <p className="text-sm mt-2" style={{ color: "var(--rose)" }}>{importError}</p>}
          {importOk && <p className="text-sm mt-2" style={{ color: "var(--teal)" }}>Data berhasil diimpor.</p>}
          <button className="btn-ghost flex items-center gap-2 mt-3" onClick={doImport} disabled={!importText.trim()}>
            <Upload size={15} /> Impor Sekarang
          </button>
        </div>

        <div className="card p-6" style={{ borderColor: "var(--rose)" }}>
          <p className="text-xs uppercase tracking-wide mb-3" style={{ color: "var(--rose)" }}>Zona Berbahaya</p>
          <div className="flex flex-col gap-2 items-start">
            <button className="btn-ghost text-sm flex items-center gap-2" style={{ color: "var(--rose)" }} onClick={onOpenReset}>
              <Trash2 size={14} /> Reset Data Akun (hapus alokasi & riwayat, akun tetap ada)
            </button>
            <button className="btn-ghost text-sm flex items-center gap-2" style={{ color: "var(--rose)" }} onClick={onOpenDelete}>
              <Trash2 size={14} /> Hapus Akun Permanen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Goals / Tujuan Tabungan page ---------- */
function GoalsPage({ user, onBack, onUpdateGoals, onLogout, onAddTx, transactions }) {
  const goals = user.goals || [];
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [selectedCatId, setSelectedCatId] = useState("");
  const [selectedSubId, setSelectedSubId] = useState("");
  const [contrib, setContrib] = useState({});

  const selectedCat = user.categories.find((c) => c.id === selectedCatId);
  const selectedSub = selectedCat ? selectedCat.subs.find((s) => s.id === selectedSubId) : null;

  const addGoal = () => {
    if (!name.trim() || !(Number(target) > 0) || !selectedCatId || !selectedSubId) return;
    onUpdateGoals([...goals, {
      id: uid(),
      name: name.trim(),
      target: Number(target),
      categoryId: selectedCatId,
      subId: selectedSubId,
    }]);
    setName(""); setTarget(""); setSelectedCatId(""); setSelectedSubId("");
  };

  const removeGoal = (id) => onUpdateGoals(goals.filter((g) => g.id !== id));

  const getGoalSaved = (goalId) => {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return 0;
    return (transactions || []).filter((t) => t.goalId === goalId && t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  };

  const contribute = (id, sign) => {
    const goal = goals.find((g) => g.id === id);
    const amt = Number(contrib[id]);
    if (!(amt > 0) || !goal) return;
    
    if (sign > 0) {
      // Contribute to goal
      onAddTx({ id: uid(), type: "expense", categoryId: goal.categoryId, subId: goal.subId, amount: amt, note: `Nabung untuk: ${goal.name}`, date: todayStr(), goalId: id });
    } else {
      // Remove from goal - create a negative contribution or reverse transaction
      onAddTx({ id: uid(), type: "withdraw", categoryId: goal.categoryId, subId: goal.subId, amount: amt, note: `Ambil dari: ${goal.name}`, date: todayStr(), goalId: id });
    }
    setContrib({ ...contrib, [id]: "" });
  };

  return (
    <div className="min-h-screen">
      <TopBar name={user.name} onLogout={onLogout} right={
        <button className="btn-ghost text-sm flex items-center gap-2" onClick={onBack}><ArrowLeft size={14} /> Dashboard</button>
      } />
      <div className="p-4 md:p-8 max-w-2xl mx-auto flex flex-col gap-6 anim-fade-up">
        <div>
          <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>Tujuan Tabungan</h1>
          <p className="muted text-sm mt-1">
            Nabung langsung dipotong dari sub-alokasi pilihan — mengintegrasikan target jangka panjang dengan anggaran bulanan.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {goals.length === 0 && <p className="muted text-sm">Belum ada tujuan tabungan. Tambahkan di bawah.</p>}
          {goals.map((g) => {
            const cat = user.categories.find((c) => c.id === g.categoryId);
            const sub = cat ? cat.subs.find((s) => s.id === g.subId) : null;
            const saved = getGoalSaved(g.id);
            const pct = g.target > 0 ? (saved / g.target) * 100 : 0;
            const done = saved >= g.target;
            return (
              <div key={g.id} className="card p-5 anim-fade-up">
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-2 display" style={{ fontWeight: 700 }}>
                    <Target size={16} color={done ? "var(--teal)" : "var(--gold)"} /> {g.name}
                  </span>
                  <button className="icon-btn" onClick={() => removeGoal(g.id)}><Trash2 size={14} color="var(--rose)" /></button>
                </div>
                {cat && sub && <p className="text-xs muted mb-2">Dari: <span style={{ color: "var(--teal)" }}>{cat.name} - {sub.name}</span></p>}
                <ProgressBar percent={pct} color={done ? "var(--teal)" : "var(--gold)"} />
                <div className="flex justify-between mt-2 text-sm tabular">
                  <span>{rupiah(saved)}</span>
                  <span className="muted">dari {rupiah(g.target)} ({fmtPercent(pct)}%)</span>
                </div>
                {done && <p className="text-xs mt-1" style={{ color: "var(--teal)" }}>🎉 Target tercapai!</p>}
                <div className="flex gap-2 mt-3">
                  <input
                    type="number"
                    placeholder="Nominal"
                    value={contrib[g.id] || ""}
                    onChange={(e) => setContrib({ ...contrib, [g.id]: e.target.value })}
                    onKeyDown={onEnter(() => contribute(g.id, 1))}
                  />
                  <button className="btn-ghost flex items-center gap-1" onClick={() => contribute(g.id, 1)}><Plus size={14} /> Nabung</button>
                  <button className="btn-ghost flex items-center gap-1" onClick={() => contribute(g.id, -1)}>Ambil</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="card p-6">
          <p className="muted text-xs uppercase tracking-wide mb-3">Tambah tujuan baru</p>
          <div className="flex gap-2 flex-col">
            <input style={{ flex: 1 }} placeholder="Nama tujuan (cth. DP Motor)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter(addGoal)} />
            <input style={{}} type="number" placeholder="Target (Rp)" value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={onEnter(addGoal)} />
            <select value={selectedCatId} onChange={(e) => { setSelectedCatId(e.target.value); setSelectedSubId(""); }}>
              <option value="">Pilih kategori...</option>
              {user.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {selectedCat && selectedCat.subs.length > 0 && (
              <select value={selectedSubId} onChange={(e) => setSelectedSubId(e.target.value)}>
                <option value="">Pilih sub-alokasi...</option>
                {selectedCat.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {selectedCat && selectedCat.subs.length === 0 && <p className="text-xs muted">Kategori ini belum punya sub-alokasi</p>}
            <button className="btn-primary flex items-center gap-2" onClick={addGoal} disabled={!selectedSubId}><Plus size={16} /> Tambah Tujuan</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Edit transaction modal ---------- */
function EditTransactionModal({ tx, cat, onClose, onSave }) {
  const [amount, setAmount] = useState(String(tx.amount));
  const [subId, setSubId] = useState(tx.subId || "");
  const [note, setNote] = useState(tx.note || "");
  const [date, setDate] = useState(tx.date);
  const [error, setError] = useState("");
  const topup = isTopupTx(tx);
  const withdraw = isWithdrawTx(tx);
  const txLabel = withdraw ? "Tarik Dana" : topup ? "Tambahan Dana" : (cat && cat.isAsset) ? "Setor" : "Pengeluaran";

  const submit = () => {
    const amt = Number(amount);
    if (!(amt > 0)) { setError("Jumlah harus lebih dari 0."); return; }
    onSave({ ...tx, amount: amt, subId: subId || null, note: note.trim(), date });
  };

  return (
    <div className="modal-overlay anim-fade" onClick={onClose}>
      <div className="card p-6 anim-pop" style={{ maxWidth: 400, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="display" style={{ fontSize: 18, fontWeight: 700 }}>Edit {txLabel}</h2>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="flex flex-col gap-4 mt-3">
          <Field label="Nominal">
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {cat && cat.subs.length > 0 && (
            <Field label="Sub-alokasi">
              <select value={subId} onChange={(e) => setSubId(e.target.value)}>
                <option value="">Tanpa sub-kategori</option>
                {cat.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Tanggal">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Catatan">
            <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onEnter(submit)} />
          </Field>
          {error && <div className="flex items-center gap-2 text-sm" style={{ color: "var(--rose)" }}><AlertCircle size={14} /> {error}</div>}
          <button className="btn-primary flex items-center justify-center gap-2" onClick={submit}><Check size={16} /> Simpan Perubahan</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Financial calculator page ---------- */
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function CalcField({ label, value, onChange, placeholder, suffix }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        {suffix && <span className="muted text-xs" style={{ whiteSpace: "nowrap" }}>{suffix}</span>}
      </div>
    </Field>
  );
}
function CalcResult({ label, value, color, big }) {
  return (
    <div className="card2 p-3 flex items-center justify-between">
      <span className="muted text-sm">{label}</span>
      <span className="tabular" style={{ fontWeight: 700, fontSize: big ? 18 : 14, color: color || "var(--text)" }}>{value}</span>
    </div>
  );
}

function EmergencyFundCalc({ defaultExpense }) {
  const [expense, setExpense] = useState(defaultExpense ? String(Math.round(defaultExpense)) : "");
  const [months, setMonths] = useState(6);
  const [current, setCurrent] = useState("");
  const [monthlySave, setMonthlySave] = useState("");

  const target = num(expense) * months;
  const shortfall = Math.max(0, target - num(current));
  const monthsNeeded = num(monthlySave) > 0 ? Math.ceil(shortfall / num(monthlySave)) : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="muted text-sm">Hitung berapa besar dana darurat idealmu, dan berapa lama waktu buat mencapainya.</p>
      <CalcField label="Pengeluaran rutin per bulan" value={expense} onChange={setExpense} placeholder="cth. 4500000" suffix="Rp" />
      <Field label="Target proteksi">
        <div className="flex gap-2">
          {[3, 6, 12].map((m) => (
            <button key={m} type="button" className="btn-ghost text-sm flex-1" style={months === m ? { borderColor: "var(--gold)", color: "var(--gold)" } : {}} onClick={() => setMonths(m)}>
              {m} bulan
            </button>
          ))}
        </div>
      </Field>
      <CalcField label="Dana darurat yang sudah kamu punya" value={current} onChange={setCurrent} placeholder="0" suffix="Rp" />
      <CalcField label="Kemampuan menabung per bulan (opsional)" value={monthlySave} onChange={setMonthlySave} placeholder="cth. 500000" suffix="Rp" />

      <div className="flex flex-col gap-2 mt-2">
        <CalcResult label={`Target dana darurat (${months}x pengeluaran)`} value={rupiah(target)} big color="var(--gold)" />
        <CalcResult label="Masih kurang" value={rupiah(shortfall)} color={shortfall > 0 ? "var(--rose)" : "var(--teal)"} />
        {monthsNeeded !== null && (
          <CalcResult label="Estimasi waktu tercapai" value={shortfall === 0 ? "Sudah tercapai 🎉" : `${monthsNeeded} bulan lagi`} color="var(--teal)" />
        )}
      </div>
    </div>
  );
}

function LoanCalc() {
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [tenor, setTenor] = useState("");
  const [mode, setMode] = useState("flat"); // flat | anuitas

  const P = num(principal), annualRate = num(rate), n = num(tenor);
  let monthlyPayment = 0, totalPayment = 0, totalInterest = 0;
  if (P > 0 && n > 0) {
    if (mode === "flat") {
      totalInterest = P * (annualRate / 100) * (n / 12);
      totalPayment = P + totalInterest;
      monthlyPayment = totalPayment / n;
    } else {
      const r = annualRate / 100 / 12;
      if (r > 0) {
        monthlyPayment = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
      } else {
        monthlyPayment = P / n;
      }
      totalPayment = monthlyPayment * n;
      totalInterest = totalPayment - P;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="muted text-sm">Simulasi cicilan pinjaman/KPR/kredit — perkiraan kasar, bunga riil bisa berbeda tergantung kebijakan lembaga pemberi pinjaman.</p>
      <Field label="Metode bunga">
        <div className="flex gap-2">
          <button type="button" className="btn-ghost text-sm flex-1" style={mode === "flat" ? { borderColor: "var(--gold)", color: "var(--gold)" } : {}} onClick={() => setMode("flat")}>Flat</button>
          <button type="button" className="btn-ghost text-sm flex-1" style={mode === "anuitas" ? { borderColor: "var(--gold)", color: "var(--gold)" } : {}} onClick={() => setMode("anuitas")}>Efektif/Anuitas</button>
        </div>
      </Field>
      <CalcField label="Plafon pinjaman" value={principal} onChange={setPrincipal} placeholder="cth. 50000000" suffix="Rp" />
      <CalcField label="Bunga per tahun" value={rate} onChange={setRate} placeholder="cth. 10" suffix="%" />
      <CalcField label="Tenor" value={tenor} onChange={setTenor} placeholder="cth. 24" suffix="bulan" />

      <div className="flex flex-col gap-2 mt-2">
        <CalcResult label="Cicilan per bulan" value={rupiah(monthlyPayment)} big color="var(--gold)" />
        <CalcResult label="Total bunga" value={rupiah(totalInterest)} color="var(--rose)" />
        <CalcResult label="Total yang dibayar" value={rupiah(totalPayment)} />
      </div>
    </div>
  );
}

function InvestmentCalc() {
  const [initial, setInitial] = useState("");
  const [monthly, setMonthly] = useState("");
  const [rate, setRate] = useState("");
  const [years, setYears] = useState("");

  const P = num(initial), PMT = num(monthly), annualRate = num(rate), n = num(years) * 12;
  const r = annualRate / 100 / 12;
  let futureValue = P, totalDeposit = P;
  if (n > 0) {
    if (r > 0) {
      futureValue = P * Math.pow(1 + r, n) + PMT * ((Math.pow(1 + r, n) - 1) / r);
    } else {
      futureValue = P + PMT * n;
    }
    totalDeposit = P + PMT * n;
  }
  const totalGain = futureValue - totalDeposit;

  return (
    <div className="flex flex-col gap-4">
      <p className="muted text-sm">Simulasi pertumbuhan tabungan/investasi dengan setoran rutin bulanan (bunga majemuk/compound).</p>
      <CalcField label="Modal awal" value={initial} onChange={setInitial} placeholder="0" suffix="Rp" />
      <CalcField label="Setoran rutin per bulan" value={monthly} onChange={setMonthly} placeholder="cth. 500000" suffix="Rp" />
      <CalcField label="Estimasi return/bunga per tahun" value={rate} onChange={setRate} placeholder="cth. 6" suffix="%" />
      <CalcField label="Lama investasi" value={years} onChange={setYears} placeholder="cth. 5" suffix="tahun" />

      <div className="flex flex-col gap-2 mt-2">
        <CalcResult label="Perkiraan nilai akhir" value={rupiah(futureValue)} big color="var(--teal)" />
        <CalcResult label="Total setoran" value={rupiah(totalDeposit)} />
        <CalcResult label="Perkiraan keuntungan" value={rupiah(totalGain)} color="var(--teal)" />
      </div>
      <p className="muted text-xs">*Simulasi murni matematis, belum memperhitungkan pajak, biaya admin, atau fluktuasi return sesungguhnya.</p>
    </div>
  );
}

function SavingsGoalCalc() {
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("");
  const [months, setMonths] = useState("");

  const shortfall = Math.max(0, num(target) - num(current));
  const perMonth = num(months) > 0 ? shortfall / num(months) : 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="muted text-sm">Berapa yang perlu kamu tabung tiap bulan supaya target tercapai tepat waktu.</p>
      <CalcField label="Target dana" value={target} onChange={setTarget} placeholder="cth. 20000000" suffix="Rp" />
      <CalcField label="Sudah punya berapa" value={current} onChange={setCurrent} placeholder="0" suffix="Rp" />
      <CalcField label="Dalam berapa bulan" value={months} onChange={setMonths} placeholder="cth. 12" suffix="bulan" />

      <div className="flex flex-col gap-2 mt-2">
        <CalcResult label="Masih dibutuhkan" value={rupiah(shortfall)} />
        <CalcResult label="Nabung per bulan" value={shortfall === 0 ? "Sudah tercapai 🎉" : rupiah(perMonth)} big color="var(--gold)" />
      </div>
    </div>
  );
}

function DebtRatioCalc({ defaultIncome }) {
  const [income, setIncome] = useState(defaultIncome ? String(Math.round(defaultIncome)) : "");
  const [debt, setDebt] = useState("");

  const ratio = num(income) > 0 ? (num(debt) / num(income)) * 100 : 0;
  const status =
    ratio === 0 ? { label: "Belum ada data", color: "var(--muted)" } :
    ratio <= 30 ? { label: "Sehat", color: "var(--teal)" } :
    ratio <= 40 ? { label: "Waspada", color: "#D9A441" } :
    { label: "Berisiko tinggi", color: "var(--rose)" };

  return (
    <div className="flex flex-col gap-4">
      <p className="muted text-sm">Rasio total cicilan/utang dibanding income bulanan — patokan umum: idealnya di bawah 30%.</p>
      <CalcField label="Income bulanan" value={income} onChange={setIncome} placeholder="cth. 8000000" suffix="Rp" />
      <CalcField label="Total cicilan/utang per bulan" value={debt} onChange={setDebt} placeholder="cth. 1500000" suffix="Rp" />

      <div className="flex flex-col gap-2 mt-2">
        <CalcResult label="Rasio utang terhadap income" value={`${fmtPercent(ratio)}%`} big color={status.color} />
        <ProgressBar percent={Math.min(ratio, 100)} color={status.color} />
        <div className="flex items-center gap-2 text-sm mt-1" style={{ color: status.color }}>
          <Info size={14} /> Status: {status.label}
        </div>
        <p className="muted text-xs mt-1">Patokan umum: ≤30% sehat, 30–40% waspada, {'>'}40% berisiko tinggi terhadap arus kas bulanan.</p>
      </div>
    </div>
  );
}

const CALCULATORS = [
  { id: "emergency", label: "Dana Darurat", icon: Wallet },
  { id: "loan", label: "Simulasi Cicilan", icon: Repeat },
  { id: "invest", label: "Investasi/Tabungan", icon: TrendingUp },
  { id: "goal", label: "Target Nabung", icon: Target },
  { id: "debt", label: "Rasio Utang", icon: AlertCircle },
];

function CalculatorPage({ user, transactions, onBack, onLogout }) {
  const [tab, setTab] = useState("emergency");

  const last3Months = Array.from({ length: 3 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const recentExpenses = transactions.filter((t) => isExpenseTx(t) && last3Months.includes(monthKey(t.date)));
  const monthsWithData = new Set(recentExpenses.map((t) => monthKey(t.date))).size || 1;
  const avgMonthlyExpense = recentExpenses.reduce((s, t) => s + Number(t.amount), 0) / monthsWithData;

  return (
    <div className="min-h-screen">
      <TopBar name={user.name} onLogout={onLogout} right={
        <button className="btn-ghost text-sm flex items-center gap-2" onClick={onBack}><ArrowLeft size={14} /> Dashboard</button>
      } />
      <div className="p-4 md:p-8 max-w-2xl mx-auto flex flex-col gap-6 anim-fade-up">
        <div className="flex items-center gap-2">
          <Calculator size={20} color="var(--gold)" />
          <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>Kalkulator Keuangan</h1>
        </div>

        <div className="flex gap-2 flex-wrap">
          {CALCULATORS.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                className="btn-ghost text-sm flex items-center gap-2"
                style={tab === c.id ? { borderColor: "var(--gold)", color: "var(--gold)" } : {}}
                onClick={() => setTab(c.id)}
              >
                <Icon size={14} /> {c.label}
              </button>
            );
          })}
        </div>

        <div className="card p-6 anim-pop">
          {tab === "emergency" && <EmergencyFundCalc defaultExpense={avgMonthlyExpense} />}
          {tab === "loan" && <LoanCalc />}
          {tab === "invest" && <InvestmentCalc />}
          {tab === "goal" && <SavingsGoalCalc />}
          {tab === "debt" && <DebtRatioCalc defaultIncome={user.income} />}
        </div>
      </div>
    </div>
  );
}

/* ---------- New month income confirmation modal ---------- */
function NewMonthIncomeModal({ user, onClose, onConfirm }) {
  const activeMonth = getActiveMonth(user);
  const realMonth = nowMonthKey();
  const lastIncome = getIncomeForMonth(user, activeMonth);
  const [income, setIncome] = useState(String(lastIncome || ""));

  const submit = () => {
    const amt = Number(income);
    if (!(amt > 0)) return;
    onConfirm(amt);
  };

  return (
    <div className="modal-overlay anim-fade" onClick={onClose}>
      <div className="card p-6 anim-pop" style={{ maxWidth: 420, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="display" style={{ fontSize: 18, fontWeight: 700 }}>Input Income {monthLabelFor(realMonth)}</h2>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="muted text-sm mb-4">
          Data yang sedang ditampilkan masih dari <b style={{ color: "var(--text)" }}>{monthLabelFor(activeMonth)}</b>.
          Masukkan income untuk bulan ini supaya alokasi & pelacakan pengeluaran mulai dihitung dari awal untuk bulan baru.
          Riwayat bulan lalu tetap tersimpan dan bisa dilihat lagi lewat Riwayat Bulanan.
        </p>
        <div className="flex flex-col gap-4">
          <Field label={`Income bulan ${monthLabelFor(realMonth)}`}>
            <input type="number" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="cth. 8000000" />
          </Field>
          <p className="muted text-xs">Terisi otomatis dengan income bulan lalu ({rupiah(lastIncome)}) sebagai contoh saja — ubah kalau berbeda.</p>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={onClose}>Nanti Saja</button>
            <button className="btn-primary flex-1 flex items-center justify-center gap-2" onClick={submit} disabled={!(Number(income) > 0)}>
              <Check size={16} /> Mulai Bulan Ini
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState("dashboard"); // dashboard | category | editAlloc | monthlyHistory | settings | goals
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [pendingUser, setPendingUser] = useState(null); // holds new account while welcome modal shows
  const [showAddMoney, setShowAddMoney] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showResetAccount, setShowResetAccount] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showNewMonthIncome, setShowNewMonthIncome] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const savedTheme = await readKey(THEME_KEY, false);
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);

      const { data: { session } } = await supabase.auth.getSession();
      if (session) await loadAccount(session.user.id);
      setSessionChecked(true);
    })().catch((error) => {
      console.error("Supabase session load failed", error);
      setAuthError(error.message);
      setSessionChecked(true);
    });
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    writeKey(THEME_KEY, next, false);
  };

  const loadAccount = async (userId) => {
    const [{ data: profile, error: profileError }, { data: tx, error: txError }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      supabase.from("transactions").select("*").eq("user_id", userId).order("date", { ascending: true }),
    ]);
    if (profileError) throw profileError;
    if (txError) throw txError;
    setUser({
      ...profile,
      monthlyIncomes: profile.monthly_incomes || {},
      strategyMode: profile.strategy_mode,
      passwordHash: undefined,
      securityQuestion: profile.security_question,
      securityAnswer: profile.security_answer,
    });
    setTransactions((tx || []).map(({ user_id, category_id, sub_id, direct_asset, ...item }) => ({
      ...item,
      categoryId: category_id,
      subId: sub_id,
      directAsset: !!direct_asset,
      amount: Number(item.amount),
    })));
  };

  const profilePayload = (u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    name: u.name || "",
    age: u.age || null,
    income: u.income || null,
    monthly_incomes: u.monthlyIncomes || {},
    strategy_mode: u.strategyMode || null,
    categories: u.categories || [],
    recurring: u.recurring || [],
    goals: u.goals || [],
    confirmed: !!u.confirmed,
    stage: u.stage || "onboarding",
    security_question: u.securityQuestion || null,
    security_answer: u.securityAnswer || null,
  });

  const persistUser = async (u) => {
    const { error } = await supabase.from("profiles").upsert(profilePayload(u));
    if (error) console.error("profile save failed", error);
  };

  const persistTx = async (userId, tx) => {
    const rows = tx.map((item) => ({
      id: item.id,
      user_id: userId,
      date: item.date,
      type: item.type || "expense",
      category_id: item.categoryId || null,
      sub_id: item.subId || null,
      direct_asset: !!item.directAsset,
      note: item.note || null,
      amount: Number(item.amount),
    }));
    const { error: deleteError } = await supabase.from("transactions").delete().eq("user_id", userId);
    if (deleteError) console.error("transaction cleanup failed", deleteError);
    if (rows.length) {
      const { error } = await supabase.from("transactions").insert(rows);
      if (error) console.error("transaction save failed", error);
    }
  };

  const updateUser = (patch) => {
    setUser((prev) => {
      const next = { ...prev, ...patch };
      void persistUser(next);
      return next;
    });
  };

  const handleLogin = async (email, password) => {
    setBusy(true); setAuthError("");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setBusy(false); setAuthError(error.message); return; }
    try {
      await loadAccount(data.user.id);
      setPage("dashboard");
    } catch (loadError) {
      setAuthError(loadError.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (username, email, password, securityQuestion, securityAnswer) => {
    setBusy(true); setAuthError("");
    const { data: authData, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { username, securityQuestion, securityAnswer } },
    });
    if (error) { setBusy(false); setAuthError(error.message); return; }
    if (!authData.session) {
      setBusy(false);
      setAuthError("Pendaftaran berhasil. Silakan verifikasi email sebelum masuk.");
      return;
    }
    const newUser = {
      id: authData.user.id, username, email: email.trim(),
      securityQuestion, securityAnswer,
      name: "", age: null, income: null,
      monthlyIncomes: {},
      strategyMode: null,
      categories: [],
      recurring: [],
      goals: [],
      confirmed: false,
      stage: "onboarding",
    };
    const { error: profileError } = await supabase.from("profiles").upsert(profilePayload(newUser));
    if (profileError) { setBusy(false); setAuthError(profileError.message); return; }
    setBusy(false);
    setTransactions([]);
    setPendingUser(newUser); // show welcome notice before entering the app
  };

  const handleLogout = () => {
    void supabase.auth.signOut();
    setUser(null);
    setTransactions([]);
    setAuthError("");
    setPage("dashboard");
  };

  const handleAddTx = (tx) => {
    setTransactions((prev) => {
      const next = [...prev, tx];
      void persistTx(user.id, next);
      return next;
    });
  };
  const handleUpdateTx = (updatedTx) => {
    setTransactions((prev) => {
      const next = prev.map((t) => t.id === updatedTx.id ? updatedTx : t);
      void persistTx(user.id, next);
      return next;
    });
  };
  const handleDeleteTx = (id) => {
    setTransactions((prev) => {
      const next = prev.filter((t) => t.id !== id);
      void persistTx(user.id, next);
      return next;
    });
  };
  const handleAddRecurring = (item) => updateUser({ recurring: [...(user.recurring || []), item] });
  const handleRemoveRecurring = (id) => updateUser({ recurring: (user.recurring || []).filter((r) => r.id !== id) });

  const handleResetAccount = async () => {
    const resetUser = {
      ...user,
      name: "", age: null, income: null,
      monthlyIncomes: {},
      strategyMode: null,
      categories: [],
      recurring: [],
      goals: [],
      confirmed: false,
      stage: "onboarding",
    };
    await persistUser(resetUser);
    await supabase.from("transactions").delete().eq("user_id", user.id);
    setUser(resetUser);
    setTransactions([]);
    setPage("dashboard");
    setShowResetAccount(false);
  };

  const handleConfirmMonthIncome = (amount) => {
    const mKey = nowMonthKey();
    updateUser({
      income: amount,
      monthlyIncomes: { ...(user.monthlyIncomes || {}), [mKey]: amount },
    });
    setShowNewMonthIncome(false);
  };

  const handleDeleteAccount = async () => {
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      setAuthError(error.message);
      return;
    }
    await supabase.auth.signOut();
    setShowDeleteAccount(false);
    setUser(null);
    setTransactions([]);
    setPage("dashboard");
  };

  if (!sessionChecked) {
    return (
      <div className={"mmp-app" + (theme === "light" ? " theme-light" : "")}>
        <style>{STYLE}</style>
        <div className="min-h-screen flex items-center justify-center">
          <Wallet size={26} color="var(--gold)" className="anim-fade" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={"mmp-app" + (theme === "light" ? " theme-light" : "")}>
        <style>{STYLE}</style>
        <AuthScreen
          onLogin={handleLogin}
          onRegister={handleRegister}
          onForgotPassword={() => setShowForgotPassword(true)}
          error={authError}
          busy={busy}
        />
        {pendingUser && (
          <WelcomeModal
            name={pendingUser.name}
            onContinue={() => { setUser(pendingUser); setPendingUser(null); }}
          />
        )}
        {showForgotPassword && <ForgotPasswordModal onClose={() => setShowForgotPassword(false)} />}
      </div>
    );
  }

  let content;
  if (user.stage === "onboarding") {
    content = (
      <OnboardingScreen
        user={user}
        onNext={(data) => updateUser({ ...data, monthlyIncomes: { [nowMonthKey()]: data.income }, stage: "choice" })}
      />
    );
  } else if (user.stage === "choice") {
    content = (
      <StrategyChoice
        income={user.income}
        onChooseDefault={() => updateUser({ strategyMode: "default", categories: DEFAULT_CATEGORIES, stage: "resume" })}
        onChooseCustom={() => updateUser({ strategyMode: "custom", stage: "custom" })}
      />
    );
  } else if (user.stage === "custom") {
    content = (
      <CustomBuilder
        initialCategories={user.categories}
        income={user.income}
        onBack={() => updateUser({ stage: "choice" })}
        onDone={(categories) => updateUser({ categories, stage: "resume" })}
      />
    );
  } else if (user.stage === "resume") {
    content = (
      <ResumeScreen
        categories={user.categories}
        income={user.income}
        onEdit={() => updateUser({ stage: user.strategyMode === "custom" ? "custom" : "choice" })}
        onConfirm={() => updateUser({ confirmed: true, stage: "dashboard" })}
      />
    );
  } else {
    if (page === "category") {
      content = (
        <CategoryDetail
          user={user}
          categoryId={activeCategoryId}
          transactions={transactions}
          onBack={() => setPage("dashboard")}
          onAddTx={handleAddTx}
          onUpdateTx={handleUpdateTx}
          onDeleteTx={handleDeleteTx}
          onAddRecurring={handleAddRecurring}
          onRemoveRecurring={handleRemoveRecurring}
          onLogout={handleLogout}
        />
      );
    } else if (page === "editAlloc") {
      content = (
        <AllocationEditor
          user={user}
          onCancel={() => setPage("dashboard")}
          onSave={(categories) => { updateUser({ categories }); setPage("dashboard"); }}
        />
      );
    } else if (page === "monthlyHistory") {
      content = (
        <MonthlyHistory
          user={user}
          transactions={transactions}
          onBack={() => setPage("dashboard")}
          onUpdateTx={handleUpdateTx}
          onDeleteTx={handleDeleteTx}
        />
      );
    } else if (page === "settings") {
      content = (
        <SettingsPage
          user={user}
          transactions={transactions}
          theme={theme}
          onToggleTheme={toggleTheme}
          onUpdateProfile={(patch) => updateUser(patch)}
          onImport={(userPatch, tx) => {
            updateUser(userPatch);
            setTransactions(tx);
            void persistTx(user.id, tx);
          }}
          onMigrateLocal={(userPatch, tx) => {
            updateUser(userPatch);
            setTransactions(tx);
            void persistTx(user.id, tx);
          }}
          onBack={() => setPage("dashboard")}
          onOpenReset={() => setShowResetAccount(true)}
          onOpenDelete={() => setShowDeleteAccount(true)}
          onLogout={handleLogout}
        />
      );
    } else if (page === "goals") {
      content = (
        <GoalsPage
          user={user}
          onBack={() => setPage("dashboard")}
          onUpdateGoals={(goals) => updateUser({ goals })}
          onAddTx={handleAddTx}
          transactions={transactions}
          onLogout={handleLogout}
        />
      );
    } else if (page === "calculator") {
      content = (
        <CalculatorPage
          user={user}
          transactions={transactions}
          onBack={() => setPage("dashboard")}
          onLogout={handleLogout}
        />
      );
    } else {
      content = (
        <Dashboard
          user={user}
          transactions={transactions}
          onOpenCategory={(id) => { setActiveCategoryId(id); setPage("category"); }}
          onEditAlloc={() => setPage("editAlloc")}
          onAddMoney={() => setShowAddMoney(true)}
          onViewHistory={() => setPage("monthlyHistory")}
          onOpenSettings={() => setPage("settings")}
          onOpenGoals={() => setPage("goals")}
          onOpenCalculator={() => setPage("calculator")}
          onConfirmMonthIncome={() => setShowNewMonthIncome(true)}
          onLogout={handleLogout}
        />
      );
    }
  }

  return (
    <div className={"mmp-app" + (theme === "light" ? " theme-light" : "")}>
      <style>{STYLE}</style>
      {content}
      {showAddMoney && (
        <AddMoneyModal
          user={user}
          onClose={() => setShowAddMoney(false)}
          onSubmit={(tx) => { handleAddTx(tx); setShowAddMoney(false); }}
        />
      )}
      {showResetAccount && (
        <ResetAccountModal
          user={user}
          onClose={() => setShowResetAccount(false)}
          onConfirm={handleResetAccount}
        />
      )}
      {showDeleteAccount && (
        <DeleteAccountModal
          user={user}
          onClose={() => setShowDeleteAccount(false)}
          onConfirm={handleDeleteAccount}
        />
      )}
      {showNewMonthIncome && (
        <NewMonthIncomeModal
          user={user}
          onClose={() => setShowNewMonthIncome(false)}
          onConfirm={handleConfirmMonthIncome}
        />
      )}
    </div>
  );
}

const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
.mmp-app{
  --bg:#0D1614; --surface:#142320; --surface2:#1B2E29;
  --gold:#C9A24B; --teal:#3E8E7E; --rose:#C4604A;
  --text:#EDF2F0; --muted:#7E938D; --border:#24413A;
  background:var(--bg); color:var(--text);
  font-family:'Inter',sans-serif; min-height:100vh;
  transition: background .2s ease, color .2s ease;
}
.mmp-app.theme-light{
  --bg:#F4F1EA; --surface:#FFFFFF; --surface2:#F0ECE3;
  --gold:#B4842A; --teal:#2E7A68; --rose:#C0503B;
  --text:#20281F; --muted:#6B7266; --border:#DCD5C6;
}
.mmp-app .display{ font-family:'Space Grotesk',sans-serif; }
.mmp-app .card{ background:var(--surface); border:1px solid var(--border); border-radius:16px; }
.mmp-app .card2{ background:var(--surface2); border:1px solid var(--border); border-radius:12px; }
.mmp-app .muted{ color:var(--muted); }
.mmp-app .tabular{ font-variant-numeric: tabular-nums; }
.mmp-app input, .mmp-app select{
  background:var(--surface2); border:1px solid var(--border); color:var(--text);
  border-radius:8px; padding:9px 12px; outline:none; width:100%; font-size:14px;
}
.mmp-app input[type="date"]{ min-width:0; max-width:100%; }
.mmp-app input::placeholder{ color:var(--muted); }
.mmp-app input:focus, .mmp-app select:focus{ border-color:var(--gold); }
.mmp-app .btn-primary{
  background:var(--gold); color:#101815; font-weight:600; border-radius:9999px;
  padding:10px 20px; transition:opacity .15s; border:none; cursor:pointer;
}
.mmp-app .btn-primary:hover{ opacity:.88; }
.mmp-app .btn-primary:disabled{ opacity:.35; cursor:not-allowed; }
.mmp-app .btn-ghost{
  background:transparent; color:var(--text); border:1px solid var(--border);
  border-radius:9999px; padding:10px 20px; cursor:pointer;
}
.mmp-app .btn-ghost:hover{ border-color:var(--gold); }
.mmp-app .progress-track{ background:var(--surface2); border-radius:9999px; height:8px; overflow:hidden; }
.mmp-app .progress-fill{ height:100%; border-radius:9999px; transition:width .5s cubic-bezier(.4,0,.2,1); }

/* buttons & interactive feel */
.mmp-app .btn-primary, .mmp-app .btn-ghost{ transition: transform .15s ease, opacity .15s ease, border-color .15s ease; }
.mmp-app .btn-primary:active, .mmp-app .btn-ghost:active{ transform: scale(.96); }
.mmp-app .btn-primary:hover:not(:disabled), .mmp-app .btn-ghost:hover{ transform: translateY(-1px); }
.mmp-app .icon-btn{ transition: transform .15s ease; }
.mmp-app .icon-btn:hover{ transform: scale(1.15); }
.mmp-app .unit-toggle{ display:flex; border:1px solid var(--border); border-radius:9999px; overflow:hidden; flex-shrink:0; }
.mmp-app .unit-toggle button{
  background:transparent; color:var(--muted); border:none; padding:6px 10px; font-size:11px; cursor:pointer; transition: background .15s, color .15s;
}
.mmp-app .unit-toggle button.unit-active{ background:var(--gold); color:#101815; font-weight:600; }
.mmp-app .card2{ transition: transform .15s ease, border-color .15s ease, background .15s ease; }
.mmp-app .cat-card{ cursor:pointer; }
.mmp-app .allocation-ring{ width:100%; justify-content:center; }
.mmp-app .spending-trend-chart{ width:100%; min-height:100%; }
.mmp-app .cat-card:hover{ transform: translateY(-3px); border-color: var(--gold); }
.mmp-app input, .mmp-app select{ transition: border-color .15s ease; }

/* entrance animations */
@keyframes mmpFadeUp{ from{ opacity:0; transform:translateY(14px);} to{ opacity:1; transform:translateY(0);} }
@keyframes mmpFadeIn{ from{ opacity:0;} to{ opacity:1;} }
@keyframes mmpPop{ from{ opacity:0; transform:scale(.94);} to{ opacity:1; transform:scale(1);} }
@keyframes mmpCheck{ 0%{ transform:scale(0); opacity:0;} 60%{ transform:scale(1.15); opacity:1;} 100%{ transform:scale(1); opacity:1;} }

.mmp-app .anim-fade-up{ animation: mmpFadeUp .5s cubic-bezier(.2,.7,.3,1) both; }
.mmp-app .anim-fade{ animation: mmpFadeIn .3s ease both; }
.mmp-app .anim-pop{ animation: mmpPop .4s cubic-bezier(.2,.7,.3,1) both; }
.mmp-app .anim-pop-delay{ animation: mmpCheck .5s .15s cubic-bezier(.34,1.56,.64,1) both; }
.mmp-app .stagger-1{ animation-delay: .06s; }
.mmp-app .stagger-2{ animation-delay: .14s; }

.mmp-app .modal-overlay{
  position: fixed; inset: 0; background: rgba(6,11,10,.72);
  display:flex; align-items:center; justify-content:center; z-index: 50; padding: 16px;
  backdrop-filter: blur(2px);
}
.mmp-app .check-badge{
  width:56px; height:56px; border-radius:9999px; background:var(--gold);
  display:flex; align-items:center; justify-content:center; margin: 0 auto;
}

@media (max-width: 640px){
  .mmp-app{ overflow-x:hidden; }
  .mmp-app *{ box-sizing:border-box; }
  .mmp-app .min-h-screen{ min-height:100dvh; }
  .mmp-app .app-topbar{ align-items:flex-start; flex-wrap:wrap; gap:12px; padding:14px 16px; }
  .mmp-app .app-topbar-brand{ min-width:0; flex:1 1 100%; }
  .mmp-app .app-topbar-brand > span:last-child{ overflow-wrap:anywhere; }
  .mmp-app .app-topbar-actions{ width:100%; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
  .mmp-app .app-topbar-actions > *{ flex:1 1 auto; min-width:0; }
  .mmp-app .app-topbar-actions > .btn-ghost{ text-align:center; }
  .mmp-app .card{ border-radius:12px; }
  .mmp-app .card.p-8{ padding:20px; }
  .mmp-app .card.p-6{ padding:16px; }
  .mmp-app .card2.p-5{ padding:16px; }
  .mmp-app .card2.p-4{ padding:12px; }
  .mmp-app .card2.p-3{ padding:10px; }

  .mmp-app .p-4.md\\:p-8{ padding:16px; }
  .mmp-app .p-4.md\\:p-6{ padding:16px; }
  .mmp-app .gap-8{ gap:16px; }

  .mmp-app .min-w-0{ min-width:0; }
  .mmp-app .btn-primary, .mmp-app .btn-ghost{ padding:9px 14px; }
  .mmp-app .btn-primary, .mmp-app .btn-ghost{ white-space:normal; min-height:40px; }

  .mmp-app .dashboard-actions{ width:100%; overflow-x:auto; flex-wrap:nowrap; justify-content:flex-start; padding-bottom:2px; scrollbar-width:thin; }
  .mmp-app .dashboard-actions > *{ flex:0 0 auto; white-space:nowrap; }
  .mmp-app .summary-metrics{ display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; }
  .mmp-app .summary-metrics > *{ min-width:0; }
  .mmp-app .summary-metrics > :last-child{ grid-column:1 / -1; }
  .mmp-app .transaction-amount{ font-size:12px; line-height:1.25; white-space:nowrap; }
  .mmp-app .sub-allocation-amount{ font-size:12px; line-height:1.25; }
  .mmp-app .transaction-form{ display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; }
  .mmp-app .transaction-form > input,
  .mmp-app .transaction-form > select{ max-width:none !important; min-width:0 !important; width:100%; }
  .mmp-app .transaction-form > input[type="number"],
  .mmp-app .transaction-form > input[type="date"],
  .mmp-app .transaction-form > input[placeholder*="Catatan"],
  .mmp-app .transaction-form > button{ grid-column:1 / -1; }
  .mmp-app .transaction-form > input,
  .mmp-app .transaction-form > select,
  .mmp-app .transaction-form > button{ min-height:42px; }
  .mmp-app input[type="date"]{
    min-width:0 !important;
    max-width:100% !important;
    width:100% !important;
    font-size:13px;
    padding-left:8px;
    padding-right:6px;
  }
  .mmp-app .transaction-form > input[type="date"]{ grid-column:1 / -1; }
  .mmp-app .transaction-form > input[placeholder*="Catatan"]{ min-width:0 !important; }
  .mmp-app .calculator-tabs{ display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .mmp-app .calculator-tabs > button{ min-width:0; padding-inline:10px; }

  .mmp-app .modal-overlay{ align-items:flex-start; overflow-y:auto; padding:12px; }
  .mmp-app .modal-overlay > .card{ margin:auto 0; max-height:calc(100vh - 24px); overflow-y:auto; }

  .mmp-app .cat-card{ width:100%; min-width:0; }
  .mmp-app [style*="grid-template-columns"]{ grid-template-columns:1fr !important; }
  .mmp-app [style*="minWidth"]{ min-width:0 !important; }
  .mmp-app [style*="maxWidth"]{ max-width:100% !important; }

  .mmp-app .flex.flex-wrap.gap-3 > input,
  .mmp-app .flex.flex-wrap.gap-3 > select,
  .mmp-app .flex.flex-wrap.gap-3 > button,
  .mmp-app .flex.gap-2.flex-wrap > input,
  .mmp-app .flex.gap-2.flex-wrap > select,
  .mmp-app .flex.gap-2.flex-wrap > button{ min-width:0; }

  .mmp-app .unit-toggle{ align-self:stretch; }
  .mmp-app .unit-toggle button{ flex:1; min-width:42px; }
  .mmp-app .flex.items-center.gap-1\.5:has(.unit-toggle){ width:100%; }

  .mmp-app .flex.items-center.justify-between.gap-2 > input,
  .mmp-app .flex.items-center.justify-between.gap-2 > .flex-1{ min-width:0; }
  .mmp-app .tabular{ overflow-wrap:anywhere; }
  .mmp-app textarea{ max-width:100%; }
}

@media (max-width: 380px){
  .mmp-app .card.p-8{ padding:16px; }
  .mmp-app .card.p-6{ padding:14px; }
  .mmp-app .summary-metrics{ grid-template-columns:1fr; }
  .mmp-app .summary-metrics > :last-child{ grid-column:auto; }
  .mmp-app .dashboard-actions > *{ padding-inline:11px; }
  .mmp-app .calculator-tabs{ grid-template-columns:1fr; }
  .mmp-app .transaction-form{ grid-template-columns:1fr; }
  .mmp-app .transaction-form > select{ grid-column:auto; }
}

@media (prefers-reduced-motion: reduce){
  .mmp-app .anim-fade-up, .mmp-app .anim-fade, .mmp-app .anim-pop, .mmp-app .anim-pop-delay{
    animation: none !important;
  }
  .mmp-app .cat-card:hover, .mmp-app .btn-primary:hover:not(:disabled), .mmp-app .btn-ghost:hover, .mmp-app .icon-btn:hover{
    transform:none !important;
  }
}
`;
