import { useState, useEffect, useMemo, useRef } from "react";
import { authCallbackUrl, authRecoveryUrl, supabase } from "./lib/supabase";
import {
  LogIn, UserPlus, ArrowRight, ArrowLeft, Check, Pencil, Plus, Trash2,
  LogOut, Wallet, ChevronRight, AlertCircle, X, Settings, Search,
  Sun, Moon, Download, Upload, Repeat, Target, TrendingUp, Calculator, Info,
  Bug, Image, Send, Bot, MessageCircle, Sparkles, Eye, EyeOff
} from "lucide-react";

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const rupiah = (n) => "Rp" + Math.round(n || 0).toLocaleString("id-ID");
function friendlyErrorMessage(error, fallback) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();

  if (["invalid_credentials", "email_not_found", "user_not_found"].includes(code)
      || /invalid (login )?credentials|invalid (email|password)|email or password|user not found|email not found|no user found/.test(message)) {
    return "Akun tidak ditemukan atau kata sandi salah. Periksa kembali email dan kata sandi.";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "Email belum diverifikasi. Buka tautan verifikasi yang dikirim ke emailmu.";
  }
  if (["user_already_exists", "email_exists"].includes(code) || message.includes("already registered")) {
    return "Email sudah terdaftar. Silakan masuk atau gunakan email lain.";
  }
  if (["email_address_not_authorized", "email_provider_disabled"].includes(code)
      || message.includes("error sending confirmation email")
      || message.includes("email address not authorized")
      || message.includes("email provider is disabled")) {
    return "Pendaftaran belum dapat dilanjutkan karena email verifikasi gagal dikirim. Periksa konfigurasi SMTP atau provider email di Supabase.";
  }
  if (message.includes("database error saving new user")) {
    return "Pendaftaran gagal saat menyiapkan profil akun. Pastikan schema.sql terbaru sudah dijalankan di Supabase dan username belum digunakan.";
  }
  if (code === "signup_disabled" || message.includes("signups not allowed")) {
    return "Pendaftaran akun sedang dinonaktifkan. Periksa pengaturan sign-up di Supabase Authentication.";
  }
  if (code === "weak_password" || message.includes("password should be")) {
    return "Kata sandi belum memenuhi syarat. Gunakan kata sandi yang lebih kuat.";
  }
  if (code === "invalid_email" || message.includes("invalid email")) {
    return "Format email tidak valid. Periksa kembali alamat emailmu.";
  }
  if (code === "23505" || message.includes("duplicate key")) {
    return "Data dengan ID yang sama sudah tersimpan. Periksa kembali data lalu coba lagi.";
  }
  if (code === "pgrst116") {
    return "Data akun belum tersedia. Coba masuk kembali beberapa saat lagi.";
  }
  if (code === "pgrst202" || code === "42883" ||
      /replace_my_transactions.*(not found|does not exist)|could not find the function/.test(message)) {
    return "Fitur impor belum tersedia di database. Jalankan ulang supabase/schema.sql pada project Supabase yang digunakan aplikasi.";
  }
  if (code === "42703" || /borrowed_from_category_id|borrowed_from_sub_id|borrowed_amount/.test(message)) {
    return "Struktur database belum diperbarui untuk format backup terbaru. Jalankan ulang supabase/schema.sql di Supabase.";
  }
  if (code === "429" || message.includes("rate limit") || message.includes("too many requests")) {
    return "Limit pembuatan akun terlampaui. Tunggu beberapa saat lalu coba lagi.";
  }
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "Koneksi bermasalah. Periksa internetmu lalu coba lagi.";
  }
  return fallback;
}
const todayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const monthKey = (d) => (d || "").slice(0, 7);
const nowMonthKey = () => todayStr().slice(0, 7);
const monthLabel = () =>
  new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
const isExpenseTx = (t) => t.type !== "topup" && t.type !== "withdraw" && t.type !== "asset_topup" && t.type !== "asset_opening" && !t.directAsset;
const isTopupTx = (t) => t.type === "topup";
const isWithdrawTx = (t) => t.type === "withdraw";
const isAssetTopupTx = (t) => t.type === "asset_topup" || t.directAsset;
const isAssetOpeningTx = (t) => t.type === "asset_opening" || t.type === "asset_topup";
const isAssetMonthlyDepositTx = (t) => t.type === "expense" || !t.type;
const isDepositTx = (t) => isAssetOpeningTx(t) || !!t.directAsset;
const dateAtLocalMidnight = (value) => new Date(`${value}T00:00:00`);
const dateString = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateLabel = (value) => dateAtLocalMidnight(value).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
const addDays = (value, days) => {
  const date = dateAtLocalMidnight(value);
  date.setDate(date.getDate() + days);
  return dateString(date);
};

/* New salary periods coexist with legacy calendar-month income records. */
function getSalaryPeriods(user) {
  const savedPeriods = Array.isArray(user.salaryPeriods) ? user.salaryPeriods : [];
  const legacyPeriods = Object.entries(user.monthlyIncomes || {}).sort(([a], [b]) => a.localeCompare(b)).filter(([month]) =>
    /^\d{4}-\d{2}$/.test(month) && !savedPeriods.some((period) => period.id === `legacy-${month}` || period.startDate === `${month}-01`)
  ).map(([month, amount]) => ({
    id: `legacy-${month}`,
    startDate: `${month}-01`,
    amount: Number(amount || 0),
    categories: user.categories,
    legacy: true,
  }));
  return [...legacyPeriods, ...savedPeriods].sort((a, b) => a.startDate.localeCompare(b.startDate));
}
function getActivePeriod(user) {
  const periods = getSalaryPeriods(user);
  return periods[periods.length - 1] || {
    id: `unstarted-${todayStr()}`,
    startDate: todayStr(),
    amount: Number(user.income || 0),
    categories: user.categories,
  };
}
function getPeriodEnd(period, periods = []) {
  const nextPeriod = periods.find((item) => item.startDate > period.startDate);
  return nextPeriod ? addDays(nextPeriod.startDate, -1) : null;
}
function transactionsForPeriod(transactions, period, periods = []) {
  const endDate = getPeriodEnd(period, periods);
  return transactions.filter((transaction) => transaction.date >= period.startDate && (!endDate || transaction.date <= endDate));
}
function periodCarryoverAmount(period, categoryId, subId = undefined) {
  return (period.carryovers || [])
    .filter((item) => item.categoryId === categoryId && (subId === undefined || (item.subId || null) === (subId || null)))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}
function periodAllocationAdjustment(period, categoryId) {
  return (period.allocationRepayments || []).reduce((sum, repayment) => {
    if (repayment.fromSubId || repayment.toSubId) return sum;
    if (repayment.fromCategoryId === categoryId) return sum - Number(repayment.amount || 0);
    if (repayment.toCategoryId === categoryId) return sum + Number(repayment.amount || 0);
    return sum;
  }, 0);
}
function periodSubAllocationAdjustment(period, categoryId, subId) {
  return (period.allocationRepayments || []).reduce((sum, repayment) => {
    if (repayment.fromCategoryId === categoryId && repayment.fromSubId === subId) {
      return sum - Number(repayment.amount || 0);
    }
    if (repayment.toCategoryId === categoryId && repayment.toSubId === subId) {
      return sum + Number(repayment.amount || 0);
    }
    return sum;
  }, 0);
}
function transactionBorrowedAmount(transaction) {
  if (!transaction.borrowedFromCategoryId) return 0;
  if (transaction.borrowedAmount !== null &&
      transaction.borrowedAmount !== undefined &&
      Number.isFinite(Number(transaction.borrowedAmount))) {
    return Math.max(0, Math.min(Number(transaction.amount || 0), Number(transaction.borrowedAmount)));
  }
  return Number(transaction.amount || 0);
}
function transactionBorrowedFromAssetAmount(transaction, user) {
  if (!transaction.borrowedFromCategoryId) return 0;
  const assetCategoryIds = new Set(getAssetCategoryCatalog(user).map((category) => category.id));
  return assetCategoryIds.has(transaction.borrowedFromCategoryId)
    ? transactionBorrowedAmount(transaction)
    : 0;
}
function assetLoanRepayments(user, categoryId, subId = undefined) {
  return getSalaryPeriods(user).flatMap((period) => period.allocationRepayments || [])
    .filter((repayment) =>
      repayment.toCategoryId === categoryId &&
      (subId === undefined || (repayment.toSubId || null) === (subId || null))
    )
    .reduce((sum, repayment) => sum + Number(repayment.amount || 0), 0);
}
function assetLoanRepaymentTotalForPeriod(user, period) {
  const assetCategoryIds = new Set(getAssetCategoryCatalog(user).map((category) => category.id));
  return (period.allocationRepayments || [])
    .filter((repayment) => assetCategoryIds.has(repayment.toCategoryId))
    .reduce((sum, repayment) => sum + Number(repayment.amount || 0), 0);
}
function assetLoanRepaymentsForPeriod(period, categoryId, subId = undefined) {
  return (period.allocationRepayments || [])
    .filter((repayment) =>
      repayment.toCategoryId === categoryId &&
      (subId === undefined || (repayment.toSubId || null) === (subId || null))
    )
    .reduce((sum, repayment) => sum + Number(repayment.amount || 0), 0);
}
function allocationBudgetSpent(transactions, categoryId) {
  return transactions.filter((transaction) => isExpenseTx(transaction) && !transaction.directAsset)
    .reduce((sum, transaction) => {
      const borrowedAmount = transactionBorrowedAmount(transaction);
      if (transaction.categoryId === categoryId) {
        return sum + Number(transaction.amount || 0) - borrowedAmount +
          (transaction.borrowedFromCategoryId === categoryId ? borrowedAmount : 0);
      }
      if (transaction.borrowedFromCategoryId === categoryId) {
        return sum + borrowedAmount;
      }
      return sum;
    }, 0);
}
function allocationSubSpent(transactions, categoryId, subId) {
  return transactions.filter((transaction) =>
    isExpenseTx(transaction) &&
    !transaction.directAsset &&
    ((transaction.categoryId === categoryId && transaction.subId === subId) ||
      (transaction.borrowedFromCategoryId === categoryId && transaction.borrowedFromSubId === subId))
  ).reduce((sum, transaction) => {
    const borrowedAmount = transactionBorrowedAmount(transaction);
    const spentByTarget = transaction.categoryId === categoryId && transaction.subId === subId
      ? Number(transaction.amount || 0) - borrowedAmount
      : 0;
    const borrowedFromSub = transaction.borrowedFromCategoryId === categoryId && transaction.borrowedFromSubId === subId
      ? borrowedAmount
      : 0;
    return sum + spentByTarget + borrowedFromSub;
  }, 0);
}
function allocationRemaining(user, transactions, period, categoryId, excludedTransactionId = null) {
  const category = (period.categories || user.categories).find((item) => item.id === categoryId)
    || user.categories.find((item) => item.id === categoryId);
  if (!category) return 0;
  const periodTransactions = transactionsForPeriod(transactions, period, getSalaryPeriods(user));
  const globalTopups = periodTransactions.filter((transaction) => isTopupTx(transaction) && !transaction.categoryId)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const categoryTopups = periodTransactions.filter((transaction) => isTopupTx(transaction) && transaction.categoryId === categoryId)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const allocated = (Number(period.amount || 0) + globalTopups) * category.percent / 100 +
    periodAllocationAdjustment(period, categoryId) +
    categoryTopups +
    periodCarryoverAmount(period, categoryId);
  const spendingTransactions = excludedTransactionId
    ? periodTransactions.filter((transaction) => transaction.id !== excludedTransactionId)
    : periodTransactions;
  return allocated - allocationBudgetSpent(spendingTransactions, categoryId);
}
function allocationSubRemaining(user, transactions, period, categoryId, subId, excludedTransactionId = null) {
  const category = (period.categories || user.categories).find((item) => item.id === categoryId)
    || user.categories.find((item) => item.id === categoryId);
  const sub = category?.subs?.find((item) => item.id === subId);
  if (!category || !sub) return 0;
  const periodTransactions = transactionsForPeriod(transactions, period, getSalaryPeriods(user))
    .filter((transaction) => transaction.id !== excludedTransactionId);
  const globalTopups = periodTransactions.filter((transaction) => isTopupTx(transaction) && !transaction.categoryId)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const baseAllocated = (Number(period.amount || 0) + globalTopups) * category.percent / 100 +
    periodAllocationAdjustment(period, categoryId);
  const subTopups = periodTransactions
    .filter((transaction) => isTopupTx(transaction) && transaction.categoryId === categoryId && transaction.subId === subId)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const subSpent = allocationSubSpent(periodTransactions, categoryId, subId);
  const allocated = baseAllocated * sub.percent / 100 +
    periodSubAllocationAdjustment(period, categoryId, subId) +
    subTopups +
    periodCarryoverAmount(period, categoryId, subId);
  return Math.min(
    allocationRemaining(user, transactions, period, categoryId, excludedTransactionId),
    allocated - subSpent
  );
}
function allocationLoanKey(fromCategoryId, toCategoryId, fromSubId = null, toSubId = null) {
  return JSON.stringify(fromSubId || toSubId
    ? [fromCategoryId, toCategoryId, fromSubId || null, toSubId || null]
    : [fromCategoryId, toCategoryId]);
}
function getOutstandingAllocationLoans(user, transactions, beforeDate = null) {
  const events = [];
  transactions.filter((transaction) =>
    isExpenseTx(transaction) &&
    transaction.borrowedFromCategoryId &&
    transaction.categoryId &&
    (transaction.categoryId !== transaction.borrowedFromCategoryId ||
      (transaction.subId && transaction.borrowedFromSubId && transaction.subId !== transaction.borrowedFromSubId)) &&
    (!beforeDate || transaction.date < beforeDate)
  ).forEach((transaction) => {
    const borrowedAmount = transactionBorrowedAmount(transaction);
    if (borrowedAmount <= 0) return;
    const fromSubId = transaction.categoryId === transaction.borrowedFromCategoryId ? transaction.subId : null;
    const toSubId = transaction.categoryId === transaction.borrowedFromCategoryId ? transaction.borrowedFromSubId : null;
    const key = allocationLoanKey(transaction.categoryId, transaction.borrowedFromCategoryId, fromSubId, toSubId);
    events.push({ key, date: transaction.date, amount: borrowedAmount, type: "loan" });
  });
  getSalaryPeriods(user).filter((period) => !beforeDate || period.startDate < beforeDate)
    .forEach((period) => (period.allocationRepayments || []).forEach((repayment) => {
      const key = allocationLoanKey(repayment.fromCategoryId, repayment.toCategoryId, repayment.fromSubId, repayment.toSubId);
      events.push({ key, date: period.startDate, amount: Number(repayment.amount || 0), type: "repayment" });
    }));
  events.sort((a, b) => a.date.localeCompare(b.date) ||
    Number(a.type !== "repayment") - Number(b.type !== "repayment"));
  const balances = new Map();
  events.forEach((event) => {
    const amount = balances.get(event.key) || 0;
    balances.set(event.key, event.type === "loan"
      ? amount + event.amount
      : Math.max(0, amount - event.amount));
  });
  return [...balances.entries()].filter(([, amount]) => amount > 0).map(([key, amount]) => {
    const [fromCategoryId, toCategoryId, fromSubId = null, toSubId = null] = JSON.parse(key);
    return { key, fromCategoryId, toCategoryId, fromSubId, toSubId, amount };
  });
}
function allocationCategoryName(user, categoryId) {
  const currentCategory = user.categories.find((category) => category.id === categoryId);
  if (currentCategory) return currentCategory.name;
  const historicalCategory = getSalaryPeriods(user)
    .flatMap((period) => period.categories || [])
    .find((category) => category.id === categoryId);
  return historicalCategory?.name || "Alokasi dihapus";
}
function allocationSourceName(user, categoryId, subId) {
  const categoryName = allocationCategoryName(user, categoryId);
  if (!subId) return categoryName;
  const category = user.categories.find((item) => item.id === categoryId)
    || getSalaryPeriods(user).flatMap((period) => period.categories || []).find((item) => item.id === categoryId);
  const sub = category?.subs?.find((item) => item.id === subId);
  return sub ? `${categoryName} / ${sub.name}` : categoryName;
}
function AllocationLoanNote({ user, transactions, categoryId }) {
  const loans = new Map();
  transactions.filter((transaction) =>
    isExpenseTx(transaction) &&
    !transaction.directAsset &&
    transactionBorrowedAmount(transaction) > 0 &&
    ((transaction.categoryId !== transaction.borrowedFromCategoryId &&
      (transaction.categoryId === categoryId || transaction.borrowedFromCategoryId === categoryId)) ||
      (transaction.categoryId === categoryId &&
        transaction.borrowedFromCategoryId === categoryId &&
        transaction.subId &&
        transaction.borrowedFromSubId &&
        transaction.subId !== transaction.borrowedFromSubId))
  ).forEach((transaction) => {
    if (transaction.categoryId === transaction.borrowedFromCategoryId) {
      const key = JSON.stringify(["internal", transaction.borrowedFromSubId, transaction.subId]);
      const summary = loans.get(key) || {
        type: "internal",
        fromSubId: transaction.borrowedFromSubId,
        toSubId: transaction.subId,
        amount: 0,
      };
      summary.amount += transactionBorrowedAmount(transaction);
      loans.set(key, summary);
      return;
    }
    const isBorrowed = transaction.categoryId === categoryId;
    const relatedCategoryId = isBorrowed ? transaction.borrowedFromCategoryId : transaction.categoryId;
    const key = JSON.stringify([isBorrowed ? "borrowed" : "lent", relatedCategoryId]);
    const summary = loans.get(key) || {
      type: isBorrowed ? "borrowed" : "lent",
      categoryId: relatedCategoryId,
      amount: 0,
    };
    summary.amount += transactionBorrowedAmount(transaction);
    loans.set(key, summary);
  });
  if (!loans.size) return null;
  return (
    <div className="flex flex-col gap-1 mt-2">
      {[...loans.values()].map((loan) => (
        <p key={JSON.stringify([loan.type, loan.categoryId, loan.fromSubId, loan.toSubId])} className="text-xs" style={{ color: "var(--gold)" }}>
          {loan.type === "internal"
            ? `Dialihkan ${rupiah(loan.amount)} dari ${allocationSourceName(user, categoryId, loan.fromSubId)} ke ${allocationSourceName(user, categoryId, loan.toSubId)}`
            : `${loan.type === "borrowed" ? "Pinjam" : "Dipinjamkan"} ${rupiah(loan.amount)} ${loan.type === "borrowed" ? "dari" : "ke"} ${allocationCategoryName(user, loan.categoryId)}`}
        </p>
      ))}
    </div>
  );
}
function getPeriodCashRemainder(user, transactions, period, beforeDate = null) {
  const periods = getSalaryPeriods(user);
  const periodTransactions = transactionsForPeriod(transactions, period, periods)
    .filter((transaction) => !beforeDate || transaction.date < beforeDate);
  const additionalIncome = periodTransactions
    .filter((transaction) => transaction.type === "topup")
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const spent = periodTransactions.filter(isExpenseTx)
    .reduce((sum, transaction) =>
      sum + Number(transaction.amount || 0) - transactionBorrowedFromAssetAmount(transaction, user), 0);
  const assetRepayments = assetLoanRepaymentTotalForPeriod(user, period);
  const carriedIn = (period.carryovers || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return Math.max(0, Number(period.amount || 0) + carriedIn + additionalIncome - spent - assetRepayments);
}
function isPaydayReminderDue(user, today = todayStr()) {
  const payDay = Math.max(1, Math.min(31, Number(user.payDay) || 1));
  const todayDate = dateAtLocalMidnight(today);
  const expectedDay = Math.min(payDay, new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).getDate());
  const expectedDate = dateString(new Date(todayDate.getFullYear(), todayDate.getMonth(), expectedDay));
  const latestPeriod = getSalaryPeriods(user).at(-1);
  return today >= expectedDate && (!latestPeriod || latestPeriod.startDate < expectedDate);
}

function paydayReminderDismissalKey(user, today = todayStr()) {
  const payDay = Math.max(1, Math.min(31, Number(user.payDay) || 1));
  const todayDate = dateAtLocalMidnight(today);
  const expectedDay = Math.min(payDay, new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).getDate());
  return `payday:${dateString(new Date(todayDate.getFullYear(), todayDate.getMonth(), expectedDay))}`;
}

function getMonthlyPromptDismissals(user) {
  const values = user.monthlyIncomePromptDismissed && typeof user.monthlyIncomePromptDismissed === "object"
    ? user.monthlyIncomePromptDismissed
    : {};
  return Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith("__pundi_")));
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

function getAssetCategoryCatalog(user) {
  const categories = new Map();
  const allCategories = [
    ...(user.assetArchive || []),
    ...(user.categories || []),
    ...getSalaryPeriods(user).flatMap((period) => period.categories || []),
  ];
  allCategories.forEach((category) => {
    if (!category.isAsset) return;
    const current = categories.get(category.id);
    categories.set(category.id, {
      ...category,
      name: category.name || current?.name || "Aset arsip",
      subs: category.subs?.length ? category.subs : (current?.subs || []),
    });
  });
  return [...categories.values()];
}

/* Asset deposits and withdrawals remain attached to their historical category
   even after that category is removed from the current allocation plan. */
function assetBalance(transactions, catId, subId = undefined, user = null, excludedTransactionId = null) {
  const balanceTransactions = excludedTransactionId
    ? transactions.filter((transaction) => transaction.id !== excludedTransactionId)
    : transactions;
  const assetCategoryIds = new Set(user ? getAssetCategoryCatalog(user).map((category) => category.id) : []);
  const matches = (t) => t.categoryId === catId && (subId === undefined ? true : (t.subId || null) === subId);
  const deposits = balanceTransactions.filter((t) => matches(t) && (
    isDepositTx(t) || (assetCategoryIds.has(t.categoryId) && isAssetMonthlyDepositTx(t))
  )).reduce((s, t) => s + Number(t.amount), 0);
  const withdrawals = balanceTransactions.filter((t) => matches(t) && isWithdrawTx(t)).reduce((s, t) => s + Number(t.amount), 0);
  const loans = user
    ? balanceTransactions.filter((transaction) =>
      isExpenseTx(transaction) &&
      transaction.borrowedFromCategoryId === catId &&
      assetCategoryIds.has(catId) &&
      (subId === undefined || (transaction.borrowedFromSubId || null) === (subId || null))
    ).reduce((sum, transaction) => sum + transactionBorrowedAmount(transaction), 0)
    : 0;
  return deposits + (user ? assetLoanRepayments(user, catId, subId) : 0) - withdrawals - loans;
}

/* True "sisa saldo" — a running cash balance that rolls forward across periods.
  Everything up to and including `dateLimit` counts: all confirmed salary periods
  + all topups, minus all expenses (normal spending and deposits into savings/assets,
  since those also leave your spendable cash). Asset withdrawals do not change this
  total because they only change the asset balance. */
function cumulativeBalanceUpTo(user, transactions, dateLimit) {
  const totalIncome = getSalaryPeriods(user)
    .filter((period) => period.startDate <= dateLimit)
    .reduce((sum, period) => sum + Number(period.amount || 0), 0);
  const txUpTo = transactions.filter((t) => t.date <= dateLimit);
  const totalTopup = txUpTo.filter(isTopupTx).reduce((s, t) => s + Number(t.amount), 0);
  const totalExpense = txUpTo.filter(isExpenseTx).reduce((sum, transaction) =>
    sum + Number(transaction.amount) - transactionBorrowedFromAssetAmount(transaction, user), 0);
  const totalAssetRepayments = getSalaryPeriods(user)
    .filter((period) => period.startDate <= dateLimit)
    .reduce((sum, period) => sum + assetLoanRepaymentTotalForPeriod(user, period), 0);
  return totalIncome + totalTopup - totalExpense - totalAssetRepayments;
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

function triggerDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function transactionsToCsv(user, transactions) {
  const rows = [["Tanggal", "Tipe", "Kategori", "Sub-alokasi", "Sumber pinjaman", "Nominal pinjaman", "Catatan", "Nominal"]];
  [...transactions].sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((t) => {
    const cat = user.categories.find((c) => c.id === t.categoryId);
    const sub = cat?.subs.find((s) => s.id === t.subId);
    const fundingCategory = user.categories.find((c) => c.id === t.borrowedFromCategoryId);
    rows.push([
      t.date,
      isAssetTopupTx(t) ? "Saldo Aset" : isTopupTx(t) ? "Tambahan Dana" : "Pengeluaran",
      cat ? cat.name : "Seluruh Alokasi",
      sub ? sub.name : "",
      fundingCategory ? allocationSourceName(user, t.borrowedFromCategoryId, t.borrowedFromSubId) : "",
      transactionBorrowedAmount(t),
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

function SpendingTrendChart({ user, transactions }) {
  const [hoveredPeriod, setHoveredPeriod] = useState(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState(null);
  const [viewMode, setViewMode] = useState("total");
  const periods = getSalaryPeriods(user);
  const trendPeriods = (periods.length ? periods : [getActivePeriod(user)]).slice(-6);
  const values = trendPeriods.map((period) => ({
    id: period.id,
    period,
    label: `Periode mulai ${dateLabel(period.startDate)}`,
    shortLabel: dateAtLocalMidnight(period.startDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
    endDate: getPeriodEnd(period, periods) || todayStr(),
    total: transactionsForPeriod(transactions, period, periods)
      .filter(isExpenseTx)
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0),
  })).map((value) => {
    const days = Math.max(1, Math.round((dateAtLocalMidnight(value.endDate) - dateAtLocalMidnight(value.period.startDate)) / 86400000) + 1);
    return { ...value, days, average: value.total / days };
  });
  const selectedId = values.some((value) => value.id === selectedPeriodId)
    ? selectedPeriodId
    : values.at(-1)?.id;
  const selectedValue = values.find((value) => value.id === selectedId);
  const selectedIndex = values.findIndex((value) => value.id === selectedId);
  const previousValue = values[selectedIndex - 1];
  const measureValue = (value) => viewMode === "daily" ? value.average : value.total;
  const maxValue = Math.max(...values.map(measureValue), 1);
  const points = values.map((value, index) => ({
    ...value,
    plottedValue: measureValue(value),
    x: values.length === 1 ? 210 : 52 + (index * 316) / (values.length - 1),
    y: 128 - (measureValue(value) / maxValue) * 92,
  }));
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const hoveredPoint = points.find((point) => point.id === hoveredPeriod);
  const activePoint = hoveredPoint || points.find((point) => point.id === selectedId);
  const previousMeasure = previousValue ? measureValue(previousValue) : null;
  const selectedMeasure = selectedValue ? measureValue(selectedValue) : 0;
  const changePercent = previousMeasure > 0
    ? ((selectedMeasure - previousMeasure) / previousMeasure) * 100
    : null;

  return (
    <div className="spending-trend-chart flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="muted text-xs uppercase tracking-wide">Tren Pengeluaran</p>
        <div className="flex gap-1" role="group" aria-label="Ukuran grafik pengeluaran">
          {[
            { id: "total", label: "Total" },
            { id: "daily", label: "Rata-rata/hari" },
          ].map((mode) => (
            <button
              key={mode.id}
              type="button"
              className="btn-ghost text-xs"
              aria-pressed={viewMode === mode.id}
              onClick={() => setViewMode(mode.id)}
              style={viewMode === mode.id ? { borderColor: "var(--gold)", color: "var(--gold)", padding: "6px 10px" } : { padding: "6px 10px" }}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
      <svg className="spending-trend-svg" viewBox="0 0 420 190" preserveAspectRatio="xMidYMid meet" style={{ overflow: "visible" }}>
        {[36, 82, 128].map((y) => <line key={y} x1="28" y1={y} x2="392" y2={y} stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />)}
        <path d={path} fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => (
          <g
            key={point.id}
            onMouseEnter={() => setHoveredPeriod(point.id)}
            onMouseLeave={() => setHoveredPeriod(null)}
            onClick={() => setSelectedPeriodId(point.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedPeriodId(point.id);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={`${point.label}: ${rupiah(point.total)} total, rata-rata ${rupiah(point.average)} per hari`}
            aria-pressed={selectedId === point.id}
            style={{ cursor: "pointer", outline: "none" }}
          >
            <rect x={point.x - 48} y="16" width="96" height="128" fill="transparent" />
            {selectedId === point.id && <circle cx={point.x} cy={point.y} r="9" fill="var(--gold)" opacity=".18" />}
            <circle cx={point.x} cy={point.y} r={hoveredPeriod === point.id || selectedId === point.id ? 5.5 : 4} fill="var(--gold)" stroke={selectedId === point.id ? "var(--text)" : "none"} strokeWidth="1.5" />
            <text x={point.x} y="158" textAnchor="middle" fontSize="11" fill={selectedId === point.id ? "var(--text)" : "var(--muted)"}>{point.shortLabel}</text>
            <title>{`${point.label}: ${rupiah(point.total)} total, ${rupiah(point.average)} per hari`}</title>
          </g>
        ))}
        {activePoint && (
          <g pointerEvents="none">
            <rect x={activePoint.x > 300 ? activePoint.x - 158 : activePoint.x + 10} y="8" width="148" height="50" rx="6" fill="var(--surface)" stroke="var(--gold)" />
            <text x={activePoint.x > 300 ? activePoint.x - 148 : activePoint.x + 20} y="25" fontSize="10" fill="var(--muted)">{activePoint.shortLabel} · {activePoint.days} hari</text>
            <text x={activePoint.x > 300 ? activePoint.x - 148 : activePoint.x + 20} y="43" fontSize="11" fill="var(--text)" fontWeight="700">
              {viewMode === "daily" ? rupiah(activePoint.average) : rupiah(activePoint.total)}
              {viewMode === "daily" ? " / hari" : ""}
            </text>
          </g>
        )}
      </svg>
      {selectedValue && (
        <div className="flex flex-col gap-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="muted text-xs">{dateLabel(selectedValue.period.startDate)} – {dateLabel(selectedValue.endDate)}</p>
              <p className="display tabular" style={{ fontSize: 18, fontWeight: 700 }}>
                {rupiah(selectedValue.total)}
                <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> · {rupiah(selectedValue.average)}/hari</span>
              </p>
            </div>
            {previousValue && (
              <p className="text-xs text-right" style={{ color: changePercent === null ? "var(--muted)" : changePercent > 0 ? "var(--rose)" : changePercent < 0 ? "var(--teal)" : "var(--muted)" }}>
                {changePercent === null
                  ? "Belum ada pembanding"
                  : `${changePercent > 0 ? "+" : ""}${changePercent.toFixed(1)}% vs periode sebelumnya`}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Daily Spending Chart for CategoryDetail */
function DailySpendingChart({ monthTx, periodStart, periodEnd, subCategories = [] }) {
  const [hoveredDay, setHoveredDay] = useState(null);
  const days = [];
  for (let day = dateAtLocalMidnight(periodStart), end = dateAtLocalMidnight(periodEnd); day <= end; day.setDate(day.getDate() + 1)) {
    days.push(dateString(day));
  }
  const dayCount = Math.max(days.length, 1);

  const colors = ["#C9A24B", "#3E8E7E", "#C4604A", "#6E8FB0", "#9B7EBD", "#7FAE8B", "#B58AC4"];
  const spendingTx = monthTx.filter((t) => t.type === "expense" || !t.type);
  const subIds = Array.from(new Set(spendingTx.map((t) => t.subId || "__category")));
  const series = subIds.map((subId, index) => {
    const subName = subId === "__category" ? "Tanpa sub-alokasi" : (subCategories.find((sub) => sub.id === subId)?.name || subId);
    const values = days.map((dateStr) => {
      return spendingTx
        .filter((t) => (t.subId || "__category") === subId && t.date === dateStr)
        .reduce((sum, t) => sum + Number(t.amount), 0);
    });
    return { id: subId, name: subName, color: colors[index % colors.length], values };
  });
  const dailyTotals = Array.from({ length: dayCount }, (_, index) => series.reduce((sum, item) => sum + item.values[index], 0));
  const totalSpending = dailyTotals.reduce((sum, value) => sum + value, 0);
  const avgDaily = totalSpending / dayCount;
  const maxDaily = Math.max(...series.flatMap((item) => item.values), 1);
  const chartHeight = 120;
  const chartLeft = 52;
  const chartRight = 408;
  const chartWidth = chartRight - chartLeft;
  const pointsFor = (item) => item.values.map((value, index) => ({
    day: index + 1,
    value,
    x: chartLeft + (index / Math.max(dayCount - 1, 1)) * chartWidth,
    y: chartHeight - (value / maxDaily) * chartHeight,
  }));
  const hoveredDate = hoveredDay ? days[hoveredDay - 1] : "";
  const hoveredValues = series.map((item) => ({ ...item, value: item.values[(hoveredDay || 1) - 1] || 0 }));
  const labelStep = dayCount <= 10 ? 1 : Math.ceil(dayCount / 7);

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
          <div><p className="muted">Total periode</p><p className="font-bold tabular" style={{ color: "var(--rose)" }}>{rupiah(totalSpending)}</p></div>
        </div>
      </div>

      <div className="chart-legend flex flex-wrap gap-x-4 gap-y-1 text-xs muted">
        {series.map((item) => <span key={item.id} className="flex items-center gap-1.5"><i style={{ width: 9, height: 9, borderRadius: "50%", background: item.color }} />{item.name}</span>)}
      </div>
      <svg width="100%" height={chartHeight + 40} viewBox={`0 0 440 ${chartHeight + 40}`} preserveAspectRatio="xMidYMid meet" style={{ overflow: "visible" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
          <line
            key={`grid-${i}`}
            x1={chartLeft}
            y1={chartHeight - chartHeight * ratio}
            x2={chartRight}
            y2={chartHeight - chartHeight * ratio}
            stroke="var(--border)"
            strokeWidth="0.5"
            opacity="0.3"
          />
        ))}
        {series.map((item) => {
          const points = pointsFor(item);
          const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
          return <path key={item.id} d={path} fill="none" stroke={item.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
        })}
        {days.map((date, index) => {
          const cellWidth = chartWidth / dayCount;
          const dailyTotal = dailyTotals[index];
          return (
            <rect
              key={`hover-${date}`}
              x={chartLeft + index * cellWidth}
              y="0"
              width={cellWidth}
              height={chartHeight}
              fill="transparent"
              style={{ cursor: "crosshair" }}
              onMouseEnter={() => setHoveredDay(index + 1)}
              onMouseLeave={() => setHoveredDay(null)}
              onFocus={() => setHoveredDay(index + 1)}
              onBlur={() => setHoveredDay(null)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setHoveredDay(null);
              }}
              tabIndex={0}
              role="button"
              aria-label={`Pengeluaran ${dateLabel(date)}: ${rupiah(dailyTotal)}`}
            >
              <title>{`${dateLabel(date)}: ${rupiah(dailyTotal)}`}</title>
            </rect>
          );
        })}
        {hoveredDay && (
          <g pointerEvents="none">
            <rect
              x={hoveredDay > dayCount * 0.7 ? 250 : 62}
              y="6"
              width="170"
              height={42 + Math.min(4, hoveredValues.filter((item) => item.value > 0).length) * 14}
              rx="6"
              fill="var(--surface)"
              stroke="var(--gold)"
              strokeWidth="1"
            />
            <text
              x={hoveredDay > dayCount * 0.7 ? 260 : 72}
              y="20"
              fontSize="10"
              fill="var(--muted)"
            >
              {dateLabel(hoveredDate)} · {rupiah(dailyTotals[hoveredDay - 1])}
            </text>
            {hoveredValues.filter((item) => item.value > 0).slice(0, 4).map((item, index) => (
              <text
                key={`${item.id}-detail`}
                x={hoveredDay > dayCount * 0.7 ? 260 : 72}
                y={34 + index * 14}
                fontSize="9"
                fill={item.color}
              >
                {`${item.name}: ${rupiah(item.value)}`}
              </text>
            ))}
          </g>
        )}

        {/* X-axis labels */}
        {Array.from({ length: dayCount }, (_, index) => index + 1).filter((day) => day % labelStep === 0 || day === 1 || day === dayCount).map((day) => {
          return (
            <text
              key={`label-${day}`}
              x={chartLeft + (day - 1) / Math.max(dayCount - 1, 1) * chartWidth}
              y={chartHeight + 20}
              textAnchor="middle"
              fontSize="11"
              fill="var(--muted)"
              className="muted"
            >
              {Number(days[day - 1]?.slice(-2) || day)}
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
              x="45"
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
        <span>{dayCount} hari</span>
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
    <div className="flex items-center gap-1.5 allocation-value-input">
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
    <div className="allocation-ring flex flex-col items-center gap-3 text-center">
      <div className="allocation-ring-chart relative">
        <div className="allocation-ring-disc" style={{ borderRadius: "9999px", background: bg }} />
        <div
          className="card absolute flex flex-col items-center justify-center"
          style={{ inset: "14%", borderRadius: "9999px" }}
        >
          <span className="muted" style={{ fontSize: 11 }}>{centerLabel}</span>
          <span className="display tabular" style={{ fontSize: 15, fontWeight: 700, textAlign: "center" }}>
            {rupiah(centerValue)}
          </span>
        </div>
      </div>
      <div className="allocation-ring-legend flex flex-wrap justify-center gap-x-4 gap-y-1.5">
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
function AuthScreen({ onLogin, onRegister, onForgotPassword, notice, error, busy }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [usernameStatus, setUsernameStatus] = useState("idle");
  const [emailStatus, setEmailStatus] = useState("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [securityQuestion, setSecurityQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [securityAnswer, setSecurityAnswer] = useState("");

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordsMatch = password === passwordConfirmation;
  const normalizedEmail = email.trim().toLowerCase();

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

  useEffect(() => {
    if (mode !== "register" || !emailValid) {
      setEmailStatus("idle");
      return undefined;
    }

    let cancelled = false;
    setEmailStatus("checking");
    const timer = setTimeout(async () => {
      const { data, error: availabilityError } = await supabase.rpc("is_email_available", {
        candidate: normalizedEmail,
      });
      if (cancelled) return;
      if (availabilityError) {
        console.error("Email availability check failed", availabilityError);
        setEmailStatus("error");
        return;
      }
      setEmailStatus(data ? "available" : "taken");
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, normalizedEmail, emailValid]);

  const submit = () => {
    if (busy || !password) return;
    if (mode === "login") {
      if (!emailValid) return;
      onLogin(normalizedEmail, password);
    } else {
      if (!username.trim() || usernameStatus !== "available" || !emailValid || emailStatus !== "available" || !passwordsMatch || !securityAnswer.trim()) return;
      onRegister(username.trim(), normalizedEmail, password, securityQuestion, securityAnswer.trim());
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
                  placeholder="cth. username123"
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
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailStatus("idle");
                }}
                onKeyDown={onEnter(submit)}
                placeholder="cth. user123@gmail.com"
              />
              {email.trim().length > 0 && !emailValid && (
                <span className="text-xs" style={{ color: "var(--rose)" }}>Format email belum valid.</span>
              )}
              {mode === "register" && emailValid && emailStatus === "checking" && (
                <span className="muted text-xs">Mengecek ketersediaan email...</span>
              )}
              {mode === "register" && emailStatus === "available" && (
                <span className="text-xs" style={{ color: "var(--teal)" }}>Email tersedia.</span>
              )}
              {mode === "register" && emailStatus === "taken" && (
                <span className="text-xs" style={{ color: "var(--rose)" }}>Email sudah terdaftar. Silakan masuk atau gunakan email lain.</span>
              )}
              {mode === "register" && emailStatus === "error" && (
                <span className="text-xs" style={{ color: "var(--rose)" }}>Email belum bisa dicek. Pastikan fungsi database sudah diperbarui, lalu coba lagi.</span>
              )}
            </Field>
            <Field label="Password">
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={onEnter(submit)}
                  placeholder="••••••••"
                  style={{ paddingRight: 42 }}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                  style={{ position: "absolute", top: "50%", right: 12, transform: "translateY(-50%)", padding: 0, border: "none", background: "none", color: "var(--muted)", cursor: "pointer", display: "flex" }}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </Field>
            {mode === "register" && (
              <>
                <Field label="Konfirmasi Password">
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPasswordConfirmation ? "text" : "password"}
                      value={passwordConfirmation}
                      onChange={(e) => setPasswordConfirmation(e.target.value)}
                      onKeyDown={onEnter(submit)}
                      placeholder="Ulangi password"
                      style={{ paddingRight: 42 }}
                    />
                    <button
                      type="button"
                      aria-label={showPasswordConfirmation ? "Sembunyikan konfirmasi password" : "Tampilkan konfirmasi password"}
                      aria-pressed={showPasswordConfirmation}
                      onClick={() => setShowPasswordConfirmation((visible) => !visible)}
                      style={{ position: "absolute", top: "50%", right: 12, transform: "translateY(-50%)", padding: 0, border: "none", background: "none", color: "var(--muted)", cursor: "pointer", display: "flex" }}
                    >
                      {showPasswordConfirmation ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
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
            {notice && (
              <div className="flex items-center gap-2 text-sm" role="status" style={{ color: "var(--teal)" }}>
                <Check size={14} /> {notice}
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 text-sm" role="alert" style={{ color: "var(--rose)" }}>
                <AlertCircle size={15} style={{ flex: "0 0 auto", marginTop: 2 }} /> {error}
              </div>
            )}
            <button
              className="btn-primary flex items-center justify-center gap-2"
              onClick={submit}
              disabled={busy || !password || !emailValid || (mode === "register" && (usernameStatus !== "available" || emailStatus !== "available" || !passwordsMatch || !username.trim() || !securityAnswer.trim()))}
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
                <div className="flex items-center justify-between gap-2 main-allocation-row">
                  <span className="flex items-center gap-2 text-sm flex-1">
                    <span style={{ width: 10, height: 10, borderRadius: 9999, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                    <input
                      className="main-allocation-name"
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
                <div key={s.id} className="card2 p-3 flex items-center justify-between gap-2 anim-fade-up sub-allocation-row">
                  <input
                    className="flex-1 sub-allocation-name"
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
function AllocationEditor({ user, onSave, onCancel, onLogout, initialCategories, incomeOverride, embedded = false }) {
  const sourceCategories = initialCategories || user.categories;
  const [categories, setCategories] = useState(sourceCategories.map((c) => ({ ...c, subs: (c.subs || []).map((s) => ({ ...s })) })));
  const [expandedId, setExpandedId] = useState(null);
  const [newCatName, setNewCatName] = useState("");
  const [newCatPercent, setNewCatPercent] = useState("");
  const [newCatMode, setNewCatMode] = useState("percent");
  const [newSubName, setNewSubName] = useState("");
  const [newSubPercent, setNewSubPercent] = useState("");
  const [newSubMode, setNewSubMode] = useState("percent");
  const [error, setError] = useState("");

  const income = Number(incomeOverride ?? getActivePeriod(user).amount ?? 0);
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
    <div className={embedded ? "modal-overlay anim-fade" : "min-h-screen"} onClick={embedded ? onCancel : undefined}>
      <div className={embedded ? "card p-4 anim-pop" : ""} style={embedded ? { maxWidth: 760, maxHeight: "92vh", width: "100%", overflowY: "auto" } : undefined} onClick={embedded ? (event) => event.stopPropagation() : undefined}>
      {!embedded && <TopBar name={user.name} onLogout={onLogout} right={
        <button className="btn-ghost text-sm flex items-center gap-2" onClick={onCancel}><ArrowLeft size={14} /> Batal</button>
      } />}
      <div className={`p-4 md:p-8 max-w-3xl mx-auto flex flex-col gap-6 anim-fade-up${embedded ? "" : ""}`}>
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
                  <div className="flex items-center justify-between gap-2 main-allocation-row">
                    <button
                      className="flex items-center gap-2 text-sm flex-1"
                      style={{ background: "none", border: "none", color: "var(--text)", cursor: "pointer", textAlign: "left" }}
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                    >
                      <span style={{ width: 10, height: 10, borderRadius: 9999, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                      <ChevronRight size={14} className="muted" style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                      <input
                        className="main-allocation-name"
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
                        <div key={s.id} className="flex items-center justify-between gap-2 sub-allocation-row">
                          <input className="flex-1 sub-allocation-name" value={s.name} onChange={(e) => updateSubName(c.id, s.id, e.target.value)} />
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
            <button className="btn-ghost flex items-center gap-2" onClick={onCancel}><X size={15} /> {embedded ? "Kembali" : "Batal"}</button>
          <button className="btn-primary flex-1 flex items-center justify-center gap-2" onClick={save}>
            {embedded ? "Gunakan Alokasi Ini" : "Simpan Perubahan"} <Check size={16} />
          </button>
        </div>
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

function AppFooter() {
  return (
    <footer className="app-footer">
      Developed by{" "}
      <a 
        href="https://instagram.com/naufalnurf__" 
        target="_blank" 
        rel="noopener noreferrer"
      >
        @naufalnurf__
      </a>
      <span className="muted"> · v1.3.8</span>
    </footer>
  );
}

function Dashboard({ user, transactions, accountLoaded, onOpenCategory, onLogout, onEditAlloc, onAddMoney, onViewHistory, onOpenSettings, onOpenGoals, onOpenCalculator, onDismissIncomeReminder }) {
  const periods = getSalaryPeriods(user);
  const activePeriod = getActivePeriod(user);
  const openAllocationLoans = getOutstandingAllocationLoans(user, transactions);
  const periodLabel = `${dateLabel(activePeriod.startDate)} - ${dateLabel(getPeriodEnd(activePeriod, periods) || todayStr())}`;
  const reminderKey = paydayReminderDismissalKey(user);
  const needsNewMonthIncome = accountLoaded && isPaydayReminderDue(user) && !user.monthlyIncomePromptDismissed?.[reminderKey];
  const income = Number(activePeriod.amount || 0);

  const monthTx = transactionsForPeriod(transactions, activePeriod, periods);
  const expenses = monthTx.filter(isExpenseTx);
  const topups = monthTx.filter(isTopupTx);
  const globalTopup = topups.filter((t) => !t.categoryId).reduce((s, t) => s + Number(t.amount), 0);
  const totalTopup = topups.reduce((s, t) => s + Number(t.amount), 0);
  const effectiveIncome = income + globalTopup;
  const totalSpent = expenses.reduce((s, t) => s + Number(t.amount), 0);
  const cashIncome = income + totalTopup;
  const thisMonthNet = cashIncome - expenses.reduce((sum, transaction) =>
    sum + Number(transaction.amount || 0) - transactionBorrowedFromAssetAmount(transaction, user), 0) -
    assetLoanRepaymentTotalForPeriod(user, activePeriod);
  const balance = cumulativeBalanceUpTo(user, transactions, todayStr());
  const assetCatalog = getAssetCategoryCatalog(user);
  const activeAssetIds = new Set(user.categories.filter((category) => category.isAsset).map((category) => category.id));
  const archivedAssets = assetCatalog.filter((category) =>
    !activeAssetIds.has(category.id) && transactions.some((transaction) => transaction.categoryId === category.id)
  );
  const totalAssets = assetCatalog.reduce((sum, category) => sum + assetBalance(transactions, category.id, undefined, user), 0);
  const totalEquity = balance + totalAssets;
  const prevCarry = balance - thisMonthNet;

  const spentFor = (catId) => allocationBudgetSpent(expenses, catId);
  const withdrawFor = (catId) => monthTx.filter((t) => t.categoryId === catId && isWithdrawTx(t)).reduce((s, t) => s + Number(t.amount), 0);
  const assetDepositFor = (catId) =>
    monthTx.filter((t) => t.categoryId === catId && isAssetMonthlyDepositTx(t)).reduce((s, t) => s + Number(t.amount), 0) +
    assetLoanRepaymentsForPeriod(activePeriod, catId);
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
                Periode gaji terakhir dimulai <b>{dateLabel(activePeriod.startDate)}</b>. Saat gaji berikutnya diterima, catat lewat <b>Tambah Uang · Gaji Bulanan</b>.
              </p>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={onDismissIncomeReminder}
              aria-label="Tutup pemberitahuan periode gaji"
              title="Tutup pemberitahuan"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="card p-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="muted text-sm">Periode {periodLabel}</p>
            <div className="dashboard-actions flex gap-2">
              <button className="btn-ghost text-sm flex items-center gap-2" onClick={onViewHistory}>Riwayat Bulanan</button>
              <button className="btn-ghost text-sm flex items-center gap-2" onClick={onOpenGoals}><Target size={14} /> Tujuan Tabungan</button>
              <button className="btn-ghost text-sm flex items-center gap-2" onClick={onOpenCalculator}><Calculator size={14} /> Kalkulator</button>
              <button className="btn-ghost text-sm flex items-center gap-2" onClick={onAddMoney}><Plus size={14} /> Tambah Uang</button>
            </div>
          </div>
          <div className="dashboard-summary-metrics flex flex-wrap gap-8 mt-3">
            <div>
              <p className="muted text-xs uppercase tracking-wide">Income</p>
              <p className="display tabular" style={{ fontSize: 20, fontWeight: 700 }}>{rupiah(cashIncome)}</p>
              {totalTopup > 0 && <p className="text-xs mt-0.5" style={{ color: "var(--teal)" }}>+{rupiah(totalTopup)} tambahan periode ini</p>}
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

        {openAllocationLoans.length > 0 && (
          <div className="card p-5">
            <p className="muted text-xs uppercase tracking-wide mb-2">Pinjaman antar alokasi</p>
            <div className="flex flex-col gap-2">
              {openAllocationLoans.map((loan) => (
                <div key={loan.key} className="flex justify-between gap-3 text-sm">
                  <span>
                    {allocationSourceName(user, loan.fromCategoryId, loan.fromSubId)} meminjam dari{" "}
                    {allocationSourceName(user, loan.toCategoryId, loan.toSubId)}
                  </span>
                  <span className="tabular" style={{ color: "var(--gold)" }}>{rupiah(loan.amount)}</span>
                </div>
              ))}
            </div>
            <p className="muted text-xs mt-2">Kamu bisa menyesuaikan alokasi dan mengurangi pinjaman saat mencatat gaji periode berikutnya.</p>
          </div>
        )}

        <div className="dashboard-analytics-grid grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <div className="dashboard-analytics-card card p-5 anim-pop stagger-1">
            <AllocationRing categories={user.categories} centerLabel="Total Income" centerValue={effectiveIncome} />
          </div>
          <div className="dashboard-analytics-card card p-5 anim-pop stagger-1">
            <SpendingTrendChart user={user} transactions={transactions} />
          </div>
        </div>

        <div>
          <p className="muted text-xs uppercase tracking-wide mb-3">Kategori alokasi</p>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {user.categories.map((c, i) => {
                const carryover = periodCarryoverAmount(activePeriod, c.id);
                const allocated = effectiveIncome * c.percent / 100 + periodAllocationAdjustment(activePeriod, c.id) + directTopupFor(c.id) + subTopupFor(c.id) + carryover;
              const spent = c.isAsset ? assetDepositFor(c.id) - withdrawFor(c.id) : spentFor(c.id);
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
                  {carryover > 0 && <p className="text-xs mb-1" style={{ color: "var(--teal)" }}>+{rupiah(carryover)} saldo periode lalu</p>}
                  <AllocationLoanNote user={user} transactions={monthTx} categoryId={c.id} />
                  {c.isAsset ? (
                    <>
                      <p className="muted text-xs">Saldo total aset</p>
                      <p className="tabular" style={{ fontWeight: 700, color: "var(--teal)" }}>{rupiah(assetBalance(transactions, c.id, undefined, user))}</p>
                      <ProgressBar percent={pct} color={pct > 100 ? "var(--rose)" : pct >= 80 ? "#D9A441" : COLORS[i % COLORS.length]} />
                      <div className="flex justify-between mt-2 text-xs tabular">
                        <span className="muted">Setor bulan ini {rupiah(spent)}</span>
                        <span className="muted">alokasi {rupiah(allocated)}</span>
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
        {archivedAssets.length > 0 && (
          <section>
            <p className="muted text-xs uppercase tracking-wide mb-3">Aset arsip</p>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
              {archivedAssets.map((category) => {
                const assetTransactions = transactions.filter((transaction) => transaction.categoryId === category.id);
                const totalWithdrawn = assetTransactions.filter(isWithdrawTx).reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
                return (
                  <div key={category.id} className="card2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{category.name}</span>
                      <span className="text-xs" style={{ color: "var(--gold)" }}>Arsip</span>
                    </div>
                    <p className="muted text-xs mt-2">Saldo tersisa</p>
                    <p className="tabular" style={{ fontWeight: 700, color: "var(--teal)" }}>
                      {rupiah(assetBalance(transactions, category.id, undefined, user))}
                    </p>
                    {totalWithdrawn > 0 && <p className="muted text-xs mt-1">Total ditarik {rupiah(totalWithdrawn)}</p>}
                  </div>
                );
              })}
            </div>
          </section>
        )}
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
  const [borrowPromptStage, setBorrowPromptStage] = useState("");
  const [borrowPromptMessage, setBorrowPromptMessage] = useState("");
  const [borrowedFromCategoryId, setBorrowedFromCategoryId] = useState("");
  const [borrowedFromSubId, setBorrowedFromSubId] = useState("");
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
  const periods = getSalaryPeriods(user);
  const activePeriod = getActivePeriod(user);
  const activeMonth = monthKey(activePeriod.startDate);
  const periodLabel = `${dateLabel(activePeriod.startDate)} - ${dateLabel(getPeriodEnd(activePeriod, periods) || todayStr())}`;
  const income = Number(activePeriod.amount || 0);
  const allMonthTx = transactionsForPeriod(transactions, activePeriod, periods);
  const globalTopup = allMonthTx.filter((t) => isTopupTx(t) && !t.categoryId).reduce((s, t) => s + Number(t.amount), 0);
  const effectiveIncome = income + globalTopup;
  const directTopup = allMonthTx.filter((t) => isTopupTx(t) && t.categoryId === cat.id && !t.subId).reduce((s, t) => s + Number(t.amount), 0);
  const subTopupTotal = allMonthTx.filter((t) => isTopupTx(t) && t.categoryId === cat.id && t.subId).reduce((s, t) => s + Number(t.amount), 0);
  const baseAllocated = effectiveIncome * cat.percent / 100 + periodAllocationAdjustment(activePeriod, cat.id);
  const categoryCarryover = periodCarryoverAmount(activePeriod, cat.id);
  const allocated = baseAllocated + directTopup + subTopupTotal + categoryCarryover;
  const monthTx = allMonthTx.filter((t) => t.categoryId === cat.id);
  const deposited = monthTx.filter(isAssetMonthlyDepositTx).reduce((s, t) => s + Number(t.amount), 0) +
    assetLoanRepaymentsForPeriod(activePeriod, cat.id);
  const spent = isAsset ? deposited : allocationBudgetSpent(allMonthTx, cat.id);
  const withdrawn = monthTx.filter(isWithdrawTx).reduce((s, t) => s + Number(t.amount), 0);
  const netAssetMovement = isAsset ? deposited - withdrawn : spent;
  const remaining = allocated - (isAsset ? netAssetMovement : spent);
  const catPct = allocated > 0 ? ((isAsset ? netAssetMovement : spent) / allocated) * 100 : 0;
  const catSaldo = assetBalance(transactions, cat.id, undefined, user);
  const history = allMonthTx.filter((t) => t.categoryId === cat.id || t.borrowedFromCategoryId === cat.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const filteredHistory = search.trim()
    ? history.filter((t) => {
        const subName = cat.subs.find((s) => s.id === t.subId)?.name || "";
        const q = search.trim().toLowerCase();
        return (t.note || "").toLowerCase().includes(q) || subName.toLowerCase().includes(q) || t.date.includes(q);
      })
    : history;
  const recurring = (user.recurring || []).filter((r) => r.categoryId === cat.id);

  const spentForSub = (sid) => isAsset
    ? monthTx.filter((transaction) => transaction.subId === sid && isAssetMonthlyDepositTx(transaction))
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0) +
      assetLoanRepaymentsForPeriod(activePeriod, cat.id, sid)
    : allocationSubSpent(allMonthTx, cat.id, sid);
  const withdrawnForSub = (sid) => monthTx.filter((t) => t.subId === sid && isWithdrawTx(t)).reduce((s, t) => s + Number(t.amount), 0);
  const topupForSub = (sid) => monthTx.filter((t) => t.subId === sid && isTopupTx(t)).reduce((s, t) => s + Number(t.amount), 0);

  const subAllocationRemaining = (targetSubId) => {
    if (!targetSubId) return remaining;
    const sub = cat.subs.find((item) => item.id === targetSubId);
    if (!sub) return remaining;
    const subAlloc = baseAllocated * sub.percent / 100 +
      topupForSub(sub.id) +
      periodCarryoverAmount(activePeriod, cat.id, sub.id);
    const subMovement = spentForSub(sub.id) - (isAsset ? withdrawnForSub(sub.id) : 0);
    return Math.min(remaining, subAlloc - subMovement);
  };
  const checkBalance = (amt, targetSubId) => {
    const available = subAllocationRemaining(targetSubId);
    if (amt > available) {
      const sub = cat.subs.find((item) => item.id === targetSubId);
      return `Sisa alokasi "${sub ? sub.name : cat.name}" tidak mencukupi. Sisa saat ini ${rupiah(available)}.`;
    }
    return "";
  };
  const spendingRemaining = isAsset ? remaining : subAllocationRemaining(subId);
  const sourceCategory = user.categories.find((category) => category.id === borrowedFromCategoryId);
  const sourceSub = sourceCategory?.subs?.find((sub) => sub.id === borrowedFromSubId);
  const requiredBorrowAmount = Math.max(0, Number(amount || 0) - Math.max(0, spendingRemaining));
  const sourceRemaining = sourceCategory
    ? (sourceCategory.isAsset
      ? assetBalance(transactions, sourceCategory.id, sourceSub?.id, user)
      : sourceSub
      ? allocationSubRemaining(user, transactions, activePeriod, sourceCategory.id, sourceSub.id)
      : allocationRemaining(user, transactions, activePeriod, sourceCategory.id))
    : 0;
  const eligibleBorrowSources = (targetSubId) => user.categories
    .flatMap((category) => {
      if (category.id !== cat.id) {
        return [
          { categoryId: category.id, subId: null },
          ...(category.subs || []).map((sub) => ({ categoryId: category.id, subId: sub.id })),
        ];
      }
      return (category.subs || [])
        .filter((sub) => targetSubId && sub.id !== targetSubId)
        .map((sub) => ({ categoryId: category.id, subId: sub.id }));
    });
  const borrowSourceOptions = eligibleBorrowSources(subId || null);
  const hasPeriodLoans = allMonthTx.some((transaction) =>
    isExpenseTx(transaction) &&
    !transaction.directAsset &&
    transactionBorrowedAmount(transaction) > 0 &&
    ((transaction.categoryId !== transaction.borrowedFromCategoryId &&
      (transaction.categoryId === cat.id || transaction.borrowedFromCategoryId === cat.id)) ||
      (transaction.categoryId === cat.id &&
        transaction.borrowedFromCategoryId === cat.id &&
        transaction.subId &&
        transaction.borrowedFromSubId &&
        transaction.subId !== transaction.borrowedFromSubId))
  );
  const relevantLoans = getOutstandingAllocationLoans(user, transactions)
    .filter((loan) => loan.fromCategoryId === cat.id || loan.toCategoryId === cat.id);

  const submitSetor = () => {
    const amt = Number(amount);
    if (!(amt > 0)) { setFormError("Masukkan jumlah yang valid."); return; }
    if (amt > spendingRemaining) {
      const eligibleSources = eligibleBorrowSources(subId || null);
      if (eligibleSources.length) {
        const sub = cat.subs.find((item) => item.id === subId);
        const targetName = sub ? sub.name : cat.name;
        setBorrowPromptMessage(`Sisa alokasi "${targetName}" ${rupiah(Math.max(0, spendingRemaining))} tidak cukup.`);
        setBorrowedFromCategoryId(eligibleSources[0].categoryId);
        setBorrowedFromSubId(eligibleSources[0].subId || "");
        setBorrowPromptStage("confirm");
      } else {
        const sub = cat.subs.find((item) => item.id === subId);
        setFormError(`Sisa alokasi "${sub ? sub.name : cat.name}" tidak mencukupi. Sisa saat ini ${rupiah(spendingRemaining)}.`);
      }
      return;
    }
    setFormError("");
    onAddTx({
      id: uid(),
      type: "expense",
      categoryId: cat.id,
      subId: subId || null,
      amount: amt,
      note: note.trim(),
      date,
      borrowedFromCategoryId: null,
      borrowedFromSubId: null,
      borrowedAmount: 0,
    });
    setAmount(""); setNote(""); setSubId("");
  };
  const continueBorrow = () => {
    setBorrowPromptStage("source");
    setFormError("");
  };
  const cancelBorrow = () => {
    setBorrowPromptStage("");
    setBorrowPromptMessage("");
    setBorrowedFromCategoryId("");
    setBorrowedFromSubId("");
  };
  const submitBorrow = () => {
    const amt = Number(amount);
    if (!(amt > 0)) {
      setFormError("Masukkan jumlah yang valid.");
      setBorrowPromptStage("");
      return;
    }
    if (!sourceCategory || (sourceCategory.id === cat.id && (!sourceSub || sourceSub.id === (subId || null)))) {
      setFormError("Pilih alokasi sumber pinjaman yang valid.");
      return;
    }
    const borrowedAmount = Math.max(0, amt - Math.max(0, spendingRemaining));
    if (borrowedAmount <= 0) {
      setFormError("Pinjaman tidak diperlukan karena sisa alokasi kategori ini masih cukup.");
      return;
    }
    if (borrowedAmount > sourceRemaining) {
      setFormError(`Pinjaman yang dibutuhkan ${rupiah(borrowedAmount)}, tetapi sisa ${sourceCategory.isAsset ? "aset" : "alokasi"} "${allocationSourceName(user, sourceCategory.id, sourceSub?.id)}" hanya ${rupiah(sourceRemaining)}.`);
      return;
    }
    onAddTx({
      id: uid(),
      type: "expense",
      categoryId: cat.id,
      subId: subId || null,
      amount: amt,
      note: note.trim(),
      date,
      borrowedFromCategoryId: sourceCategory.id,
      borrowedFromSubId: sourceSub?.id || null,
      borrowedAmount,
    });
    setAmount(""); setNote(""); setSubId("");
    cancelBorrow();
  };
  const submitTarik = () => {
    const amt = Number(amount);
    if (!(amt > 0)) { setFormError("Masukkan jumlah yang valid."); return; }
    const cap = subId ? assetBalance(transactions, cat.id, subId, user) : catSaldo;
    if (amt > cap) { setFormError(`Saldo tidak mencukupi. Saldo tersedia saat ini ${rupiah(cap)}.`); return; }
    setFormError("");
    onAddTx({ id: uid(), type: "withdraw", categoryId: cat.id, subId: subId || null, amount: amt, note: note.trim(), date });
    setAmount(""); setNote(""); setSubId("");
  };
  const submit = () => (isAsset && assetMode === "tarik" ? submitTarik() : submitSetor());

  const recordRecurring = (r) => {
    const err = checkBalance(r.amount, r.subId);
    if (err) {
      const available = subAllocationRemaining(r.subId);
      const eligibleSource = eligibleBorrowSources(r.subId || null)[0];
      if (!isAsset && r.amount > available && eligibleSource) {
        setAmount(String(r.amount));
        setNote(r.name);
        setSubId(r.subId || "");
        setDate(todayStr());
        const sub = cat.subs.find((item) => item.id === r.subId);
        setBorrowPromptMessage(`Sisa alokasi "${sub ? sub.name : cat.name}" ${rupiah(Math.max(0, available))} tidak cukup.`);
        setBorrowedFromCategoryId(eligibleSource.categoryId);
        setBorrowedFromSubId(eligibleSource.subId || "");
        setBorrowPromptStage("confirm");
        setRecError("");
      } else {
        setRecError(err);
      }
      return;
    }
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
            · periode {periodLabel}
          </p>
          {isAsset ? (
            <>
              <div className="flex flex-wrap gap-8">
                <div>
                  <p className="muted text-xs uppercase tracking-wide">Saldo total aset</p>
                  <p className="display tabular" style={{ fontSize: 20, fontWeight: 700, color: "var(--teal)" }}>{rupiah(catSaldo)}</p>
                </div>
                <div>
                  <p className="muted text-xs uppercase tracking-wide">Alokasi periode ini</p>
                  <p className="tabular" style={{ fontWeight: 700 }}>{rupiah(allocated)}</p>
                  {directTopup > 0 && <p className="text-xs mt-0.5" style={{ color: "var(--teal)" }}>+{rupiah(directTopup)} tambahan</p>}
                  {categoryCarryover > 0 && <p className="text-xs mt-0.5" style={{ color: "var(--teal)" }}>termasuk {rupiah(categoryCarryover)} saldo periode lalu</p>}
                </div>
              </div>
              <p className="muted text-xs mt-3">
                Saldo total mencakup saldo awal dan seluruh setoran aset. Alokasi bulan ini hanya menghitung setoran pada bulan aktif,
                sehingga saldo awal tidak membuat progres bulanan melebihi target.
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
                  {categoryCarryover > 0 && <p className="text-xs mt-0.5" style={{ color: "var(--teal)" }}>termasuk {rupiah(categoryCarryover)} saldo periode lalu</p>}
                </div>
                <div>
                  <p className="muted text-xs uppercase tracking-wide">Terpakai dari alokasi</p>
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

        {hasPeriodLoans && (
          <div className="card p-4">
            <p className="muted text-xs uppercase tracking-wide mb-1">Pinjaman alokasi · periode ini</p>
            <AllocationLoanNote user={user} transactions={allMonthTx} categoryId={cat.id} />
          </div>
        )}

        {relevantLoans.length > 0 && (
          <div className="card p-5">
            <p className="muted text-xs uppercase tracking-wide mb-2">Pinjaman alokasi belum disesuaikan</p>
            <div className="flex flex-col gap-2">
              {relevantLoans.map((loan) => (
                <div key={loan.key} className="flex justify-between gap-3 text-sm">
                  <span>
                    {loan.fromCategoryId === loan.toCategoryId
                      ? `Dialihkan dari ${allocationSourceName(user, loan.fromCategoryId, loan.fromSubId)} ke ${allocationSourceName(user, loan.toCategoryId, loan.toSubId)}`
                      : `${loan.fromCategoryId === cat.id ? "Meminjam dari" : "Dipinjam oleh"} ${
                        allocationCategoryName(user, loan.fromCategoryId === cat.id ? loan.toCategoryId : loan.fromCategoryId)
                      }`}
                  </span>
                  <span className="tabular" style={{ color: "var(--gold)" }}>{rupiah(loan.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {cat.subs.length > 0 && (
          <div className="card p-6">
            <p className="muted text-xs uppercase tracking-wide mb-3">Rincian sub-alokasi</p>
            <div className="flex flex-col gap-3">
              {cat.subs.map((s, si) => {
                const subAlloc = baseAllocated * s.percent / 100 +
                  periodSubAllocationAdjustment(activePeriod, cat.id, s.id) +
                  topupForSub(s.id) +
                  periodCarryoverAmount(activePeriod, cat.id, s.id);
                const subSpent = spentForSub(s.id) - (isAsset ? withdrawnForSub(s.id) : 0);
                const subRemaining = subAlloc - subSpent;
                const subPct = subAlloc > 0 ? (subSpent / subAlloc) * 100 : 0;
                const subSaldo = assetBalance(transactions, cat.id, s.id, user);
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
                  ? <>Sisa target setor periode ini: <span className="tabular" style={{ color: remaining < 0 ? "var(--rose)" : "var(--teal)" }}>{rupiah(remaining)}</span></>
                  : <>Saldo tersedia untuk ditarik: <span className="tabular" style={{ color: "var(--teal)" }}>{rupiah(subId ? assetBalance(transactions, cat.id, subId, user) : catSaldo)}</span></>}
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
            <input className="transaction-date-input" style={{ maxWidth: 160 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
            <DailySpendingChart
              monthTx={monthTx}
              periodStart={activePeriod.startDate}
              periodEnd={getPeriodEnd(activePeriod, periods) || todayStr()}
              subCategories={cat.subs}
            />
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <p className="muted text-xs uppercase tracking-wide">Riwayat transaksi · {periodLabel}</p>
            <div className="flex items-center gap-1.5" style={{ maxWidth: 220 }}>
              <Search size={14} className="muted" />
              <input style={{ fontSize: 12 }} placeholder="Cari catatan / sub / tanggal" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {filteredHistory.length === 0 && <p className="muted text-sm">Tidak ada transaksi yang cocok.</p>}
            {filteredHistory.slice(0, expandAllTx ? filteredHistory.length : 5).map((t, hi) => {
              const transactionCategory = user.categories.find((category) => category.id === t.categoryId);
              const subName = transactionCategory?.subs.find((s) => s.id === t.subId)?.name;
              const topup = isTopupTx(t);
              const withdraw = isWithdrawTx(t);
              const positive = topup || (isAsset && !withdraw); // setor & topup are "adds", tarik is "reduces"
              const displayAmount = t.borrowedFromCategoryId === cat.id && t.categoryId !== cat.id
                ? transactionBorrowedAmount(t)
                : t.amount;
              const label = withdraw ? "Tarik" : topup ? "Tambahan dana" : isAssetOpeningTx(t) ? "Saldo awal aset" : isAsset ? "Setor" : null;
              return (
                <div key={t.id} className="card2 p-3 flex items-center justify-between anim-fade-up" style={{ animationDelay: `${Math.min(hi, 8) * 40}ms` }}>
                  <div>
                    <p className="text-sm">
                      {t.note || subName || (t.borrowedFromCategoryId === cat.id
                        ? allocationCategoryName(user, t.categoryId)
                        : label || cat.name)}
                    </p>
                    <p className="muted text-xs">
                      {t.date}{subName ? ` · ${subName}` : ""}{label ? ` · ${label}` : ""}
                      {t.borrowedFromCategoryId && t.categoryId === cat.id
                        ? t.borrowedFromCategoryId === t.categoryId
                          ? ` · Dialihkan ${rupiah(transactionBorrowedAmount(t))} dari ${allocationSourceName(user, t.borrowedFromCategoryId, t.borrowedFromSubId)}`
                          : ` · Pinjam ${rupiah(transactionBorrowedAmount(t))} dari ${allocationSourceName(user, t.borrowedFromCategoryId, t.borrowedFromSubId)}`
                        : t.borrowedFromCategoryId === cat.id
                          ? ` · Dibiayai ${rupiah(transactionBorrowedAmount(t))} untuk ${allocationCategoryName(user, t.categoryId)}`
                          : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="transaction-amount tabular" style={{ color: positive ? "var(--teal)" : "var(--rose)" }}>{positive ? "+" : "-"}{rupiah(displayAmount)}</span>
                    <button className="icon-btn" onClick={() => setEditingTx(t)}><Pencil size={14} className="muted" /></button>
                    <button className="icon-btn" onClick={() => { if (window.confirm("Hapus transaksi ini?")) onDeleteTx(t.id); }}><X size={15} className="muted" /></button>
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
          categories={user.categories}
          user={user}
          transactions={transactions}
          period={activePeriod}
          onClose={() => setEditingTx(null)}
          onSave={(updated) => { onUpdateTx(updated); setEditingTx(null); }}
        />
      )}
      {borrowPromptStage && (
        <div className="modal-overlay anim-fade" onClick={cancelBorrow}>
          <div className="card p-6 anim-pop" style={{ maxWidth: 440, width: "100%" }} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle size={18} color="var(--gold)" />
              <h2 className="display" style={{ fontSize: 18, fontWeight: 700 }}>
                {borrowPromptStage === "confirm" ? "Saldo alokasi tidak cukup" : "Pilih alokasi sumber"}
              </h2>
            </div>
            {borrowPromptStage === "confirm" ? (
              <>
                <p className="muted text-sm mb-4">
                  {borrowPromptMessage} Pengeluaran ini {rupiah(Number(amount) || 0)}.
                  Pinjaman yang dibutuhkan {rupiah(requiredBorrowAmount)}. Apakah kamu ingin meminjam dari alokasi lain?
                </p>
                <div className="flex gap-2">
                  <button className="btn-ghost flex-1" onClick={cancelBorrow}>Tidak, batal</button>
                  <button className="btn-primary flex-1" onClick={continueBorrow}>Ya, pilih alokasi</button>
                </div>
              </>
            ) : (
              <>
                <p className="muted text-sm mb-4">
                  Pengeluaran tetap dicatat sebagai {cat.name}; saldo alokasi, sub-alokasi, atau aset yang dipilih akan digunakan sebagai sumber dana.
                </p>
                <div className="flex flex-col gap-3">
                  <Field label="Sumber pinjaman">
                    <select
                      value={JSON.stringify([borrowedFromCategoryId, borrowedFromSubId || null])}
                      onChange={(event) => {
                        const [categoryId, sourceSubId] = JSON.parse(event.target.value);
                        setBorrowedFromCategoryId(categoryId);
                        setBorrowedFromSubId(sourceSubId || "");
                      }}
                    >
                      {borrowSourceOptions.map((source) => {
                        const category = user.categories.find((item) => item.id === source.categoryId);
                        const sub = category?.subs?.find((item) => item.id === source.subId);
                        const available = category.isAsset
                          ? assetBalance(transactions, category.id, sub?.id, user)
                          : sub
                            ? allocationSubRemaining(user, transactions, activePeriod, category.id, sub.id)
                            : allocationRemaining(user, transactions, activePeriod, category.id);
                        return (
                          <option key={`${source.categoryId}:${source.subId || ""}`} value={JSON.stringify([source.categoryId, source.subId])}>
                            {source.categoryId === cat.id ? "↳ " : ""}{allocationSourceName(user, source.categoryId, source.subId)}{category.isAsset ? " · aset" : ""} · sisa {rupiah(available)}
                          </option>
                        );
                      })}
                    </select>
                  </Field>
                  {sourceCategory && (
                    <p className="muted text-xs">
                      Pinjaman dibutuhkan {rupiah(requiredBorrowAmount)} · sisa {allocationSourceName(user, sourceCategory.id, sourceSub?.id)}: {rupiah(sourceRemaining)}
                      {requiredBorrowAmount > sourceRemaining && <span style={{ color: "var(--rose)" }}> — saldo sumber tidak cukup</span>}
                    </p>
                  )}
                  {formError && (
                    <div className="flex items-center gap-2 text-sm" style={{ color: "var(--rose)" }}>
                      <AlertCircle size={14} /> {formError}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button className="btn-ghost flex-1" onClick={cancelBorrow}>Batal</button>
                    <button
                      className="btn-primary flex-1"
                      onClick={submitBorrow}
                      disabled={!sourceCategory || requiredBorrowAmount <= 0 || requiredBorrowAmount > sourceRemaining}
                    >
                      Gunakan alokasi ini
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- App ---------- */
/* ---------- Add money modal ---------- */
function AddMoneyModal({ user, transactions, onClose, onSubmit, onSalarySubmit, initialTarget = "global" }) {
  const [target, setTarget] = useState(initialTarget); // global | category | sub | asset | asset_opening | salary
  const [categoryId, setCategoryId] = useState(user.categories[0]?.id || "");
  const [subId, setSubId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayStr());
  const activePeriod = getActivePeriod(user);
  const [salaryAmount, setSalaryAmount] = useState(String(activePeriod.amount || user.income || ""));
  const [salaryDate, setSalaryDate] = useState(todayStr());
  const [salaryAllocationMode, setSalaryAllocationMode] = useState("previous");
  const [customSalaryCategories, setCustomSalaryCategories] = useState(null);
  const [carryoverEnabled, setCarryoverEnabled] = useState(true);
  const [carryoverCategoryId, setCarryoverCategoryId] = useState(user.categories[0]?.id || "");
  const [carryoverSubId, setCarryoverSubId] = useState("");
  const [repaymentAmounts, setRepaymentAmounts] = useState(() => {
    const existingPeriod = getSalaryPeriods(user).find((period) => period.startDate === todayStr());
    return Object.fromEntries((existingPeriod?.allocationRepayments || []).map((item) => [
      allocationLoanKey(item.fromCategoryId, item.toCategoryId, item.fromSubId, item.toSubId),
      String(item.amount),
    ]));
  });
  const [editingSalaryAllocation, setEditingSalaryAllocation] = useState(false);
  const [salaryError, setSalaryError] = useState("");
  const [salaryBusy, setSalaryBusy] = useState(false);

  const assetCategories = user.categories.filter((c) => c.isAsset);
  const cat = user.categories.find((c) => c.id === categoryId);
  const previousCategories = activePeriod.categories || user.categories;
  const salaryCategories = salaryAllocationMode === "custom" && customSalaryCategories
    ? customSalaryCategories
    : previousCategories;
  const previousSalaryPeriod = getSalaryPeriods(user)
    .filter((period) => period.startDate < salaryDate)
    .at(-1);
  const availableCarryover = previousSalaryPeriod
    ? getPeriodCashRemainder(user, transactions, previousSalaryPeriod, salaryDate)
    : 0;
  const carryoverCategory = salaryCategories.find((category) => category.id === carryoverCategoryId) || salaryCategories[0];
  const outstandingLoans = getOutstandingAllocationLoans(user, transactions, salaryDate);

  const chooseCategory = (id) => { setCategoryId(id); setSubId(""); };
  const chooseTarget = (nextTarget) => {
    setTarget(nextTarget);
    setSubId("");
    if (nextTarget === "asset" || nextTarget === "asset_opening") {
      setCategoryId(assetCategories[0]?.id || "");
    } else if (nextTarget === "global") {
      setCategoryId(user.categories[0]?.id || "");
    } else if (nextTarget === "salary") {
      setSalaryError("");
    } else if (!user.categories.some((category) => category.id === categoryId)) {
      setCategoryId(user.categories[0]?.id || "");
    }
  };

  const submit = async () => {
    if (target === "salary") {
      const salary = Number(salaryAmount);
      if (!(salary > 0)) { setSalaryError("Nominal gaji harus lebih dari 0."); return; }
      if (!salaryDate || salaryDate > todayStr()) { setSalaryError("Tanggal gaji tidak boleh di masa depan."); return; }
      const allocationRepayments = [];
      const repaymentTotals = new Map();
      const subRepaymentTotals = new Map();
      for (const loan of outstandingLoans) {
        const repaymentAmount = Number(repaymentAmounts[loan.key] || 0);
        const borrowerName = allocationSourceName(user, loan.fromCategoryId, loan.fromSubId);
        if (!Number.isFinite(repaymentAmount) || repaymentAmount < 0 || repaymentAmount > loan.amount) {
          setSalaryError(`Nominal penyesuaian pinjaman ${borrowerName} tidak valid.`);
          return;
        }
        const borrowerCategory = salaryCategories.find((category) => category.id === loan.fromCategoryId);
        const lenderCategory = salaryCategories.find((category) => category.id === loan.toCategoryId);
        const borrowerAllocation = borrowerCategory ? salary * borrowerCategory.percent / 100 : 0;
        const borrowerSub = borrowerCategory?.subs?.find((sub) => sub.id === loan.fromSubId);
        const lenderSub = lenderCategory?.subs?.find((sub) => sub.id === loan.toSubId);
        if (repaymentAmount > 0 && (!borrowerCategory || !lenderCategory ||
            (loan.fromSubId && !borrowerSub) || (loan.toSubId && !lenderSub))) {
          setSalaryError("Aktifkan kembali kategori atau sub-alokasi sumber dan tujuan sebelum menyesuaikan pinjamannya.");
          return;
        }
        const borrowerSubAllocation = borrowerCategory && borrowerSub
          ? borrowerAllocation * borrowerSub.percent / 100
          : borrowerAllocation;
        const repaymentLimit = loan.fromSubId ? borrowerSubAllocation : borrowerAllocation;
        if (repaymentAmount > repaymentLimit) {
          setSalaryError(`Penyesuaian pinjaman melebihi alokasi baru ${borrowerName}.`);
          return;
        }
        if (repaymentAmount > 0) {
          const borrowerRepaymentTotal = (repaymentTotals.get(loan.fromCategoryId) || 0) + repaymentAmount;
          if (borrowerRepaymentTotal > borrowerAllocation) {
            setSalaryError(`Total penyesuaian pinjaman melebihi alokasi baru ${borrowerCategory.name}.`);
            return;
          }
          repaymentTotals.set(loan.fromCategoryId, borrowerRepaymentTotal);
          if (loan.fromSubId) {
            const subKey = JSON.stringify([loan.fromCategoryId, loan.fromSubId]);
            const borrowerSubRepaymentTotal = (subRepaymentTotals.get(subKey) || 0) + repaymentAmount;
            if (borrowerSubRepaymentTotal > borrowerSubAllocation) {
              setSalaryError(`Total penyesuaian pinjaman melebihi alokasi baru ${borrowerName}.`);
              return;
            }
            subRepaymentTotals.set(subKey, borrowerSubRepaymentTotal);
          }
          allocationRepayments.push({
            fromCategoryId: loan.fromCategoryId,
            toCategoryId: loan.toCategoryId,
            fromSubId: loan.fromSubId,
            toSubId: loan.toSubId,
            amount: repaymentAmount,
          });
        }
      }
      setSalaryBusy(true);
      setSalaryError("");
      try {
        const carryover = carryoverEnabled && availableCarryover > 0 && carryoverCategory
          ? { categoryId: carryoverCategory.id, subId: carryoverSubId || null, amount: availableCarryover }
          : null;
        const saved = await onSalarySubmit(salary, salaryDate, salaryCategories, carryover, allocationRepayments);
        if (typeof saved === "string") setSalaryError(`Gagal menyimpan gaji: ${saved}`);
        else if (!saved) setSalaryError("Gaji belum berhasil disimpan. Coba lagi.");
      } catch (error) {
        console.error("Salary save failed", error);
        setSalaryError(friendlyErrorMessage(error, "Gaji belum berhasil disimpan. Coba lagi."));
      } finally {
        setSalaryBusy(false);
      }
      return;
    }
    const amt = Number(amount);
    if (!(amt > 0)) return;
    if ((target === "sub" || target === "asset" || target === "asset_opening") && !categoryId) return;
    if (target === "sub" && !subId) return;
    onSubmit({
      id: uid(),
      type: target === "asset" || target === "asset_opening" ? "asset_opening" : "topup",
      categoryId: target === "global" ? null : categoryId,
      subId: target === "sub" ? subId : null,
      amount: amt,
      note: note.trim(),
      date,
      directAsset: target === "asset" || target === "asset_opening",
    });
  };

  const tabStyle = (active) => active ? { borderColor: "var(--gold)", color: "var(--gold)" } : {};

  return (
    <div className="modal-overlay anim-fade" onClick={onClose}>
      <div
        className={`card p-6 anim-pop add-money-modal${target === "salary" ? " add-money-modal-salary" : ""}`}
        style={{ maxWidth: 440, width: "100%", ...(target === "salary" ? { maxHeight: "min(88dvh, 760px)" } : {}) }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="display" style={{ fontSize: 18, fontWeight: 700 }}>Tambah Uang</h2>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="muted text-sm mb-4">
          Catat gaji baru atau tambahkan dana ke alokasi dan aset.
        </p>

        <div className={`flex flex-col gap-4 add-money-modal-content${target === "salary" ? " add-money-modal-content-salary" : ""}`}>
          <Field label="Tujuan dana">
            <div className={`flex gap-2 flex-wrap${target === "salary" ? " salary-target-list" : ""}`}>
              <button type="button" className="btn-ghost text-sm" style={tabStyle(target === "salary")} onClick={() => chooseTarget("salary")}>Gaji Bulanan</button>
              <button type="button" className="btn-ghost text-sm" style={tabStyle(target === "global")} onClick={() => setTarget("global")}>Seluruh Alokasi</button>
              <button type="button" className="btn-ghost text-sm" style={tabStyle(target === "category")} onClick={() => setTarget("category")}>Kategori Tertentu</button>
              <button type="button" className="btn-ghost text-sm" style={tabStyle(target === "sub")} onClick={() => setTarget("sub")}>Sub-alokasi Tertentu</button>
              <button type="button" className="btn-ghost text-sm" style={tabStyle(target === "asset" || target === "asset_opening")} onClick={() => chooseTarget("asset_opening")}>Saldo Awal Aset</button>
            </div>
          </Field>

          {target === "salary" && (
            <>
              <Field label="Nominal gaji yang diterima">
                <input type="number" value={salaryAmount} onChange={(event) => { setSalaryAmount(event.target.value); setSalaryError(""); }} placeholder="cth. 8000000" />
              </Field>
              <Field label="Tanggal gaji diterima">
                <input
                  type="date"
                  value={salaryDate}
                  max={todayStr()}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    setSalaryDate(nextDate);
                    setSalaryError("");
                    const existingPeriod = getSalaryPeriods(user).find((period) => period.startDate === nextDate);
                    setRepaymentAmounts(Object.fromEntries((existingPeriod?.allocationRepayments || []).map((item) => [
                      allocationLoanKey(item.fromCategoryId, item.toCategoryId, item.fromSubId, item.toSubId),
                      String(item.amount),
                    ])));
                  }}
                />
              </Field>
              <Field label="Alokasi periode baru">
                <div className="flex gap-2 flex-wrap">
                  <button type="button" className="btn-ghost text-sm" style={tabStyle(salaryAllocationMode === "previous")} onClick={() => { setSalaryAllocationMode("previous"); setCarryoverCategoryId(previousCategories[0]?.id || ""); setCarryoverSubId(""); }}>Pakai Persentase Sebelumnya</button>
                  <button type="button" className="btn-ghost text-sm" style={tabStyle(salaryAllocationMode === "custom")} onClick={() => { setSalaryAllocationMode("custom"); setCarryoverCategoryId(salaryCategories[0]?.id || ""); setCarryoverSubId(""); }}>Atur Custom</button>
                </div>
              </Field>
              <p className="muted text-xs">Gaji ini memulai periode baru. Transaksi periode lama tetap tersimpan.</p>
              {outstandingLoans.length > 0 && (
                <div className="card2 p-3 flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-medium">Sesuaikan pinjaman alokasi</p>
                    <p className="muted text-xs">Nominal yang diisi mengurangi alokasi peminjam dan mengembalikan dana ke alokasi atau saldo aset sumber.</p>
                  </div>
                  {outstandingLoans.map((loan) => {
                    const borrower = salaryCategories.find((category) => category.id === loan.fromCategoryId);
                    const lender = salaryCategories.find((category) => category.id === loan.toCategoryId);
                    const borrowerSub = borrower?.subs?.find((sub) => sub.id === loan.fromSubId);
                    const lenderSub = lender?.subs?.find((sub) => sub.id === loan.toSubId);
                    const borrowerAllocation = borrower ? salary * borrower.percent / 100 : 0;
                    const maxRepayment = borrower
                      ? Math.min(loan.amount, loan.fromSubId && borrowerSub
                        ? borrowerAllocation * borrowerSub.percent / 100
                        : borrowerAllocation)
                      : 0;
                    return (
                      <div key={loan.key} className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-sm">
                          {allocationSourceName(user, loan.fromCategoryId, loan.fromSubId)} meminjam dari {allocationSourceName(user, loan.toCategoryId, loan.toSubId)}
                          <span className="muted text-xs"> · sisa {rupiah(loan.amount)}</span>
                        </span>
                        {borrower && lender && (!loan.fromSubId || borrowerSub) && (!loan.toSubId || lenderSub) ? (
                          <input
                            aria-label={`Penyesuaian pinjaman ${allocationSourceName(user, loan.fromCategoryId, loan.fromSubId)} ke ${allocationSourceName(user, loan.toCategoryId, loan.toSubId)}`}
                            type="number"
                            min="0"
                            max={maxRepayment}
                            value={repaymentAmounts[loan.key] || ""}
                            onChange={(event) => {
                              setRepaymentAmounts((current) => ({ ...current, [loan.key]: event.target.value }));
                              setSalaryError("");
                            }}
                            placeholder="0 = tunda"
                            style={{ maxWidth: 150 }}
                          />
                        ) : (
                          <span className="muted text-xs">Kategori pinjaman perlu diaktifkan kembali untuk penyesuaian.</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {availableCarryover > 0 && (
                <div className="card2 p-3 flex flex-col gap-3">
                  <label className="flex items-center gap-2 text-sm" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={carryoverEnabled}
                      onChange={(event) => setCarryoverEnabled(event.target.checked)}
                      style={{ width: "auto" }}
                    />
                    Alokasikan sisa periode sebelumnya ({rupiah(availableCarryover)})
                  </label>
                  {carryoverEnabled && carryoverCategory && (
                    <>
                      <Field label="Tambahkan sisa ke kategori">
                        <select
                          value={carryoverCategory.id}
                          onChange={(event) => { setCarryoverCategoryId(event.target.value); setCarryoverSubId(""); }}
                        >
                          {salaryCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                        </select>
                      </Field>
                      {carryoverCategory.subs.length > 0 && (
                        <Field label="Sub-alokasi tujuan">
                          <select value={carryoverSubId} onChange={(event) => setCarryoverSubId(event.target.value)}>
                            <option value="">Tambahkan ke alokasi kategori</option>
                            {carryoverCategory.subs.map((sub) => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
                          </select>
                        </Field>
                      )}
                    </>
                  )}
                </div>
              )}
              {salaryAllocationMode === "custom" && (
                <button type="button" className="btn-ghost flex items-center justify-center gap-2" onClick={() => setEditingSalaryAllocation(true)}>
                  <Pencil size={14} /> Sesuaikan alokasi & sub-alokasi
                </button>
              )}
              {salaryError && <div className="flex items-center gap-2 text-sm" style={{ color: "var(--rose)" }}><AlertCircle size={14} /> {salaryError}</div>}
              <button className="btn-primary flex items-center justify-center gap-2 mt-1 salary-submit" onClick={submit} disabled={!(Number(salaryAmount) > 0) || salaryBusy}>
                <Check size={16} /> {salaryBusy ? "Menyimpan..." : "Mulai Periode Baru"}
              </button>
            </>
          )}

          {target !== "salary" && <>
          {(target === "category" || target === "sub" || target === "asset" || target === "asset_opening") && (
            <Field label="Kategori">
              <select value={categoryId} onChange={(e) => chooseCategory(e.target.value)}>
               {(target === "asset" || target === "asset_opening" ? assetCategories : user.categories).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
          {target === "asset" && assetCategories.length > 0 && <p className="muted text-xs">Dana ini langsung menambah saldo kategori aset dan tidak dihitung sebagai pemakaian alokasi.</p>}
          {target === "asset_opening" && assetCategories.length > 0 && <p className="muted text-xs">Catat total aset yang sudah kamu miliki. Saldo ini menambah equity dan tidak dihitung sebagai setoran bulan berjalan.</p>}
          {target === "asset" && assetCategories.length === 0 && (
            <p className="text-sm" style={{ color: "var(--rose)" }}>Belum ada kategori Tabungan/Investasi. Tandai kategori sebagai aset lewat Edit Alokasi dulu.</p>
          )}
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
            disabled={!(Number(amount) > 0) || ((target === "sub" || target === "asset" || target === "asset_opening") && !cat) || ((target === "asset" || target === "asset_opening") && !cat?.isAsset)}
          >
            <Plus size={16} /> Tambahkan Dana
          </button>
          </>}
        </div>
      </div>
      {editingSalaryAllocation && (
        <AllocationEditor
          user={{ ...user, categories: salaryCategories }}
          initialCategories={salaryCategories}
          incomeOverride={Number(salaryAmount) || 0}
          embedded
          onCancel={() => setEditingSalaryAllocation(false)}
          onSave={(categories) => {
            setCustomSalaryCategories(categories);
            setCarryoverCategoryId(categories[0]?.id || "");
            setCarryoverSubId("");
            setEditingSalaryAllocation(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Monthly history ---------- */
function MonthlyHistory({ user, transactions, onBack, onUpdateTx, onDeleteTx, onLogout }) {
  const periods = getSalaryPeriods(user);
  const activePeriod = getActivePeriod(user);
  const historyPeriods = periods.length ? periods : [activePeriod];
  const [selectedId, setSelectedId] = useState(activePeriod.id);
  const selectedPeriod = historyPeriods.find((period) => period.id === selectedId) || activePeriod;
  const historyCategories = selectedPeriod.categories || user.categories;
  const [expandedCat, setExpandedCat] = useState(null);
  const [search, setSearch] = useState("");
  const [editingTx, setEditingTx] = useState(null);

  const monthT = transactionsForPeriod(transactions, selectedPeriod, periods);
  const expenses = monthT.filter(isExpenseTx);
  const topups = monthT.filter(isTopupTx);
  const assetTopups = monthT.filter((t) => isAssetTopupTx(t) && !isAssetOpeningTx(t));
  const assetOpenings = monthT.filter(isAssetOpeningTx);
  const globalTopup = topups.filter((t) => !t.categoryId).reduce((s, t) => s + Number(t.amount), 0);
  const totalTopup = topups.reduce((s, t) => s + Number(t.amount), 0);
  const totalAssetTopup = assetTopups.reduce((s, t) => s + Number(t.amount), 0);
  const totalAssetOpening = assetOpenings.reduce((s, t) => s + Number(t.amount), 0);
  const selectedIncome = Number(selectedPeriod.amount || 0);
  const hasIncomeRecord = historyPeriods.some((period) => period.id === selectedPeriod.id);
  const effectiveIncome = selectedIncome + globalTopup;
  const totalSpent = expenses.reduce((s, t) => s + Number(t.amount), 0);
  const cashIncome = selectedIncome + totalTopup;
  const thisMonthNet = cashIncome - expenses.reduce((sum, transaction) =>
    sum + Number(transaction.amount || 0) - transactionBorrowedFromAssetAmount(transaction, user), 0) -
    assetLoanRepaymentTotalForPeriod(user, selectedPeriod);
  const selectedEnd = getPeriodEnd(selectedPeriod, periods) || todayStr();
  const balance = cumulativeBalanceUpTo(user, transactions, selectedEnd);
  const prevCarry = balance - thisMonthNet;

  const directTopupForCat = (catId) => topups.filter((t) => t.categoryId === catId && !t.subId).reduce((s, t) => s + Number(t.amount), 0);
  const topupForSub = (catId, subId) => topups.filter((t) => t.categoryId === catId && t.subId === subId).reduce((s, t) => s + Number(t.amount), 0);
  const spentForCat = (catId) => allocationBudgetSpent(expenses, catId);
  const assetDepositForCat = (catId) =>
    monthT.filter((t) => t.categoryId === catId && isAssetMonthlyDepositTx(t)).reduce((s, t) => s + Number(t.amount), 0) +
    assetLoanRepaymentsForPeriod(selectedPeriod, catId);
  const spentForSub = (catId, subId) => {
    const category = historyCategories.find((item) => item.id === catId);
    return category?.isAsset
      ? monthT.filter((transaction) =>
        transaction.categoryId === catId && transaction.subId === subId && isAssetMonthlyDepositTx(transaction)
      ).reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0) +
        assetLoanRepaymentsForPeriod(selectedPeriod, catId, subId)
      : allocationSubSpent(expenses, catId, subId);
  };

  const monthTxSorted = [...monthT].sort((a, b) => (a.date < b.date ? 1 : -1));
  const filteredTx = search.trim()
    ? monthTxSorted.filter((t) => {
        const cat = historyCategories.find((c) => c.id === t.categoryId) || user.categories.find((c) => c.id === t.categoryId);
        const sub = cat?.subs.find((s) => s.id === t.subId);
        const q = search.trim().toLowerCase();
        return (t.note || "").toLowerCase().includes(q) || (cat?.name || "").toLowerCase().includes(q) || (sub?.name || "").toLowerCase().includes(q) || t.date.includes(q);
      })
    : monthTxSorted;

  const trendPeriods = historyPeriods.slice(-6);
  const trendData = trendPeriods.map((period) => ({
    id: period.id,
    period,
    spent: transactionsForPeriod(transactions, period, periods).filter(isExpenseTx).reduce((s, t) => s + Number(t.amount), 0),
  }));
  const trendMax = Math.max(1, ...trendData.map((d) => d.spent));

  return (
    <div className="min-h-screen">
      <TopBar
        name={user.name}
        onLogout={onLogout}
        right={<button className="btn-ghost text-sm flex items-center gap-2" onClick={onBack}><ArrowLeft size={14} /> Dashboard</button>}
      />
      <div className="p-4 md:p-8 max-w-3xl mx-auto flex flex-col gap-6 anim-fade-up">
        <div>
            <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>Riwayat Periode</h1>
            <p className="muted text-sm mt-1">Pengeluaran, tambahan dana, dan alokasi per periode gaji.</p>
        </div>

        {trendData.length > 1 && (
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={14} className="muted" />
              <p className="muted text-xs uppercase tracking-wide">Tren Pengeluaran ({trendData.length} Periode Terakhir)</p>
            </div>
            <div className="flex items-end gap-3" style={{ height: 120 }}>
              {trendData.map((d) => (
                <div key={d.id} className="flex-1 flex flex-col items-center justify-end gap-1" style={{ height: "100%" }}>
                  <span className="tabular" style={{ fontSize: 10, color: "var(--muted)" }}>{Math.round(d.spent / 1000)}k</span>
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 36,
                      height: `${Math.max(4, (d.spent / trendMax) * 90)}px`,
                      borderRadius: "4px 4px 0 0",
                      background: d.id === selectedPeriod.id ? "var(--gold)" : "var(--surface2)",
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                      transition: "height .3s ease",
                    }}
                    onClick={() => { setSelectedId(d.id); setExpandedCat(null); }}
                  />
                  <span className="muted" style={{ fontSize: 10 }}>
                    {dateAtLocalMidnight(d.period.startDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {historyPeriods.slice().reverse().map((period) => (
            <button
              key={period.id}
              className="btn-ghost text-sm"
              style={period.id === selectedPeriod.id ? { borderColor: "var(--gold)", color: "var(--gold)" } : {}}
              onClick={() => { setSelectedId(period.id); setExpandedCat(null); }}
            >
              {dateLabel(period.startDate)}
            </button>
          ))}
        </div>

        <p className="muted text-xs">Periode {dateLabel(selectedPeriod.startDate)} - {dateLabel(selectedEnd)}</p>

        <div className="card p-6">
            <div className="summary-metrics flex flex-wrap gap-8">
            <div>
              <p className="muted text-xs uppercase tracking-wide">Income efektif</p>
              <p className="tabular" style={{ fontWeight: 700 }}>{rupiah(cashIncome)}</p>
              {totalTopup > 0 && <p className="text-xs mt-0.5" style={{ color: "var(--teal)" }}>termasuk +{rupiah(totalTopup)} tambahan</p>}
              {totalAssetTopup > 0 && <p className="text-xs mt-0.5" style={{ color: "var(--gold)" }}>termasuk +{rupiah(totalAssetTopup)} penambahan aset</p>}
              {totalAssetOpening > 0 && <p className="text-xs mt-0.5" style={{ color: "var(--teal)" }}>+{rupiah(totalAssetOpening)} saldo awal aset</p>}
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
            {historyCategories.map((c, i) => {
              const directTopup = directTopupForCat(c.id);
              const subTopupTotal = topups.filter((t) => t.categoryId === c.id && t.subId).reduce((s, t) => s + Number(t.amount), 0);
              const baseAllocated = effectiveIncome * c.percent / 100 + periodAllocationAdjustment(selectedPeriod, c.id);
              const categoryCarryover = periodCarryoverAmount(selectedPeriod, c.id);
              const allocated = baseAllocated + directTopup + subTopupTotal + categoryCarryover;
              const spent = c.isAsset
                ? assetDepositForCat(c.id) - monthT.filter((t) => t.categoryId === c.id && isWithdrawTx(t)).reduce((s, t) => s + Number(t.amount), 0)
                : spentForCat(c.id);
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
                      {c.isAsset ? <>saldo total {rupiah(assetBalance(transactions, c.id, undefined, user))}</> : <>{rupiah(spent)} / {rupiah(allocated)}</>}
                    </span>
                  </button>
                  <div className="mt-2"><ProgressBar percent={pct} color={pct > 100 ? "var(--rose)" : pct >= 80 ? "#D9A441" : COLORS[i % COLORS.length]} /></div>
                  {expanded && c.subs.length > 0 && (
                    <div className="mt-3 pl-4 flex flex-col gap-2" style={{ borderLeft: "2px solid var(--border)" }}>
                      {c.subs.map((s) => {
                        const subAlloc = baseAllocated * s.percent / 100 +
                          periodSubAllocationAdjustment(selectedPeriod, c.id, s.id) +
                          topupForSub(c.id, s.id) +
                          periodCarryoverAmount(selectedPeriod, c.id, s.id);
                        const subCarryover = periodCarryoverAmount(selectedPeriod, c.id, s.id);
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
                            {subCarryover > 0 && <p className="muted text-xs mb-1">Termasuk {rupiah(subCarryover)} saldo periode lalu</p>}
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
                  {expanded && monthT.some((transaction) => transaction.borrowedFromCategoryId === c.id) && (
                    <div className="mt-3 pl-4 flex flex-col gap-2" style={{ borderLeft: "2px solid var(--border)" }}>
                      <p className="muted text-xs">Pengeluaran kategori lain yang dibiayai alokasi ini</p>
                      {monthT.filter((transaction) => transaction.borrowedFromCategoryId === c.id).map((transaction) => (
                        <div key={transaction.id} className="flex justify-between gap-3 text-xs">
                          <span>{transaction.note || allocationCategoryName(user, transaction.categoryId)}</span>
                          <span className="tabular">{rupiah(transactionBorrowedAmount(transaction))}</span>
                        </div>
                      ))}
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
              const cat = historyCategories.find((c) => c.id === t.categoryId) || user.categories.find((c) => c.id === t.categoryId);
              const sub = cat?.subs.find((s) => s.id === t.subId);
              const topup = isTopupTx(t);
              const assetTopup = isAssetTopupTx(t);
              const assetOpening = isAssetOpeningTx(t);
              const positive = topup || assetTopup || assetOpening;
              return (
                <div key={t.id} className="card2 p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm">{t.note || sub?.name || cat?.name || (assetOpening ? "Saldo awal aset" : assetTopup ? "Penambahan saldo aset" : topup ? "Tambahan dana" : "Pengeluaran")}</p>
                    <p className="muted text-xs">
                      {t.date}
                      {cat ? ` · ${cat.name}` : ""}
                      {sub ? ` · ${sub.name}` : ""}
                      {t.borrowedFromCategoryId
                        ? ` · ${t.borrowedFromCategoryId === t.categoryId ? "Dialihkan" : "Pinjam"} ${rupiah(transactionBorrowedAmount(t))} dari ${allocationSourceName(user, t.borrowedFromCategoryId, t.borrowedFromSubId)}`
                        : ""}
                      {!cat && topup ? " · Seluruh alokasi" : assetOpening ? " · Saldo awal aset" : assetTopup ? " · Penambahan aset" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="transaction-amount tabular" style={{ color: positive ? "var(--teal)" : "var(--rose)" }}>{positive ? "+" : "-"}{rupiah(t.amount)}</span>
                    <button className="icon-btn" onClick={() => setEditingTx(t)}><Pencil size={14} className="muted" /></button>
                    <button className="icon-btn" onClick={() => { if (window.confirm("Hapus transaksi ini?")) onDeleteTx(t.id); }}><X size={15} className="muted" /></button>
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
          cat={historyCategories.find((c) => c.id === editingTx.categoryId) || user.categories.find((c) => c.id === editingTx.categoryId) || null}
          categories={user.categories}
          user={user}
          transactions={transactions}
          period={selectedPeriod}
          onClose={() => setEditingTx(null)}
          onSave={(updated) => { onUpdateTx(updated); setEditingTx(null); }}
        />
      )}
    </div>
  );
}

/* ---------- Forgot password modal ---------- */
function ForgotPasswordModal({ onClose, recoveryMode = false, onRecoveryComplete }) {
  const [step, setStep] = useState(recoveryMode ? "reset" : "email");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const checkEmail = async () => {
    if (!email.trim()) return;
    setBusy(true); setError("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: authRecoveryUrl,
    });
    setBusy(false);
    if (resetError) {
      console.error("Password reset email request failed", resetError);
      setError(friendlyErrorMessage(resetError, "Email reset belum dapat dikirim. Periksa alamat email dan coba lagi."));
      return;
    }
    setStep("done");
  };

  const resetPassword = async () => {
    if (newPassword.length < 6) { setError("Password minimal 6 karakter."); return; }
    if (newPassword !== confirmPassword) { setError("Konfirmasi password tidak sama."); return; }
    setBusy(true); setError("");
    const { error: resetError } = await supabase.auth.updateUser({ password: newPassword });
    if (resetError) {
      console.error("Password update failed", resetError);
      setBusy(false);
      setError(friendlyErrorMessage(resetError, "Password belum dapat diperbarui. Coba lagi."));
      return;
    }
    setBusy(false);
    if (recoveryMode) {
      try {
        await onRecoveryComplete();
      } catch (error) {
        console.error("Password recovery completion failed", error);
        setError("Password berhasil diperbarui, tetapi sesi belum dapat ditutup. Silakan masuk kembali.");
        return;
      }
    }
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
            <p className="muted text-sm mb-4">Masukkan email akunmu. Jika akun tersedia, kami akan mengirim tautan untuk membuat password baru.</p>
            <div className="flex flex-col gap-4">
              <Field label="Email">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={onEnter(checkEmail)}
                  placeholder="contoh@email.com"
                />
              </Field>
              {error && <div className="flex items-center gap-2 text-sm" style={{ color: "var(--rose)" }}><AlertCircle size={14} /> {error}</div>}
              <button className="btn-primary flex items-center justify-center gap-2" onClick={checkEmail} disabled={busy || !email.trim()}>
                Lanjut <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}

        {step === "reset" && (
          <>
            <p className="muted text-sm mb-4">Buat password baru untuk akunmu.</p>
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
            <p className="text-center mt-4" style={{ fontWeight: 600 }}>
              {recoveryMode ? "Password berhasil diperbarui." : "Jika email terdaftar, tautan reset password akan dikirim."}
            </p>
            {!recoveryMode && <p className="muted text-sm text-center mt-1">Buka tautan di email untuk membuat password baru.</p>}
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
    const reset = await onConfirm();
    setBusy(false);
    if (!reset) setError("Data akun belum berhasil direset. Periksa pesan error lalu coba lagi.");
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
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password });
      if (authError) {
        setError(authError.message.includes("Invalid login credentials") ? "Password salah." : friendlyErrorMessage(authError, "Konfirmasi password gagal."));
        return;
      }
      const deleted = await onConfirm();
      if (!deleted) setError("Akun belum berhasil dihapus. Periksa koneksi dan pengaturan Supabase, lalu coba lagi.");
    } catch (error) {
      console.error("Account deletion confirmation failed", error);
      setError(friendlyErrorMessage(error, "Akun belum berhasil dihapus. Coba lagi."));
    } finally {
      setBusy(false);
    }
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
function SettingsPage({ user, transactions, theme, onToggleTheme, onUpdateProfile, onImport, onBack, onOpenReset, onOpenDelete, onLogout }) {
  const [name, setName] = useState(user.name || "");
  const [age, setAge] = useState(user.age || "");
  const [income, setIncome] = useState(user.income || "");
  const [payDay, setPayDay] = useState(String(user.payDay || 1));
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importOk, setImportOk] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [feedbackType, setFeedbackType] = useState("bug");
  const [feedbackDescription, setFeedbackDescription] = useState("");
  const [feedbackFile, setFeedbackFile] = useState(null);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const feedbackFileInputRef = useRef(null);
  const backupFileInputRef = useRef(null);

  const profileValid = name.trim() && Number(age) > 0 && Number(income) > 0 && Number(payDay) >= 1 && Number(payDay) <= 31;
  const saveProfile = async () => {
    if (!profileValid) return;
    setProfileError("");
    setProfileSaved(false);
    try {
      const saved = await onUpdateProfile({
        name: name.trim(), age: Number(age), income: Number(income), payDay: Number(payDay),
      });
      if (!saved) throw new Error("Perubahan profil belum tersimpan.");
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (error) {
      console.error("Profile settings save failed", error);
      setProfileError(friendlyErrorMessage(error, "Perubahan profil belum tersimpan. Periksa koneksi lalu coba lagi."));
    }
  };

  const exportJson = () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      app: "Pundi",
      user: {
        name: user.name, age: user.age, income: user.income,
        monthlyIncomes: user.monthlyIncomes || {},
        salaryPeriods: user.salaryPeriods || [], payDay: user.payDay || 1,
        assetArchive: user.assetArchive || [],
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

  const isValidBackupDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };

  const loadBackupFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setImportError("Ukuran file backup maksimal 20 MB.");
      return;
    }
    try {
      const text = await file.text();
      setImportText(text);
      setImportFileName(file.name);
      setImportError("");
      setImportOk(false);
    } catch (error) {
      console.error("Backup file read failed", error);
      setImportError("File backup tidak dapat dibaca. Coba pilih file JSON lain.");
    }
  };

  const doImport = async () => {
    setImportError(""); setImportOk(false);
    let parsed;
    try {
      parsed = JSON.parse(importText);
      if (!parsed || !parsed.user || !Array.isArray(parsed.transactions)) throw new Error("format");
      const u = parsed.user;
      if (!Array.isArray(u.categories)) throw new Error("format");
      if (parsed.transactions.some((tx) =>
        !tx ||
        (typeof tx.id !== "string" && !(typeof tx.id === "number" && Number.isFinite(tx.id))) ||
        !String(tx.id).trim() ||
        !isValidBackupDate(tx.date) ||
        tx.amount === null ||
        tx.amount === undefined ||
        !Number.isFinite(Number(tx.amount)) ||
        Number(tx.amount) < 0 ||
        (tx.borrowedAmount !== null && tx.borrowedAmount !== undefined &&
          (!Number.isFinite(Number(tx.borrowedAmount)) ||
            Number(tx.borrowedAmount) < 0 ||
            Number(tx.borrowedAmount) > Number(tx.amount) ||
            (Number(tx.borrowedAmount) > 0 && !tx.borrowedFromCategoryId)))
      )) throw new Error("format");
    } catch (error) {
      setImportError("File/teks JSON tidak valid atau formatnya bukan hasil export Pundi.");
      return;
    }

    const u = parsed.user;
    try {
      const normalizedTransactions = parsed.transactions.map((tx) => ({
        ...tx,
        id: String(tx.id),
        amount: Number(tx.amount),
        categoryId: tx.categoryId == null ? null : String(tx.categoryId),
        subId: tx.subId == null ? null : String(tx.subId),
        goalId: tx.goalId == null ? null : String(tx.goalId),
        borrowedFromCategoryId: tx.borrowedFromCategoryId == null ? null : String(tx.borrowedFromCategoryId),
        borrowedFromSubId: tx.borrowedFromSubId == null ? null : String(tx.borrowedFromSubId),
        borrowedAmount: tx.borrowedAmount == null ? null : Number(tx.borrowedAmount),
      }));
      await onImport({
        name: u.name || "", age: u.age || null, income: u.income || null,
        monthlyIncomes: (u.monthlyIncomes && typeof u.monthlyIncomes === "object")
          ? u.monthlyIncomes
          : (u.income ? { [nowMonthKey()]: u.income } : {}),
        salaryPeriods: Array.isArray(u.salaryPeriods) ? u.salaryPeriods : [],
        payDay: Math.max(1, Math.min(31, Number(u.payDay) || 1)),
        assetArchive: Array.isArray(u.assetArchive) ? u.assetArchive : [],
        strategyMode: u.strategyMode || "custom", categories: u.categories,
        recurring: Array.isArray(u.recurring) ? u.recurring : [],
        goals: Array.isArray(u.goals) ? u.goals : [],
        confirmed: true, stage: "dashboard",
      }, normalizedTransactions);
      setImportOk(true);
      setImportText("");
      setImportFileName("");
    } catch (error) {
      console.error("Backup import failed", error);
      setImportError(friendlyErrorMessage(error, error?.message || "Impor gagal disimpan. Periksa koneksi dan konfigurasi database, lalu coba lagi."));
    }
  };

  const handleFeedbackFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setFeedbackError("");
    if (!file) {
      setFeedbackFile(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setFeedbackError("Foto harus berformat JPG, PNG, atau WebP.");
      setFeedbackFile(null);
      event.target.value = "";
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setFeedbackError("Ukuran foto maksimal 4 MB.");
      setFeedbackFile(null);
      event.target.value = "";
      return;
    }
    setFeedbackFile(file);
  };

  const sendFeedback = async (event) => {
    event.preventDefault();
    setFeedbackError("");
    setFeedbackSending(true);
    let attachmentPath = null;
    try {
      if (feedbackFile) {
        const extension = feedbackFile.type === "image/jpeg" ? "jpg" : feedbackFile.type.split("/")[1];
        attachmentPath = `${user.id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("bug-report-attachments")
          .upload(attachmentPath, feedbackFile, { contentType: feedbackFile.type, upsert: false });
        if (uploadError) throw uploadError;
      }

      const { error: insertError } = await supabase.from("bug_reports").insert({
        user_id: user.id,
        type: feedbackType,
        description: feedbackDescription.trim(),
        attachment_path: attachmentPath,
        attachment_name: feedbackFile?.name || null,
        attachment_type: feedbackFile?.type || null,
      });
      if (insertError) {
        if (attachmentPath) {
          const { error: cleanupError } = await supabase.storage
            .from("bug-report-attachments")
            .remove([attachmentPath]);
          if (cleanupError) console.error("feedback attachment cleanup failed", cleanupError);
        }
        throw insertError;
      }

      setFeedbackDescription("");
      setFeedbackFile(null);
      if (feedbackFileInputRef.current) feedbackFileInputRef.current.value = "";
      setFeedbackSent(true);
    } catch (error) {
      console.error("feedback save failed", error);
      setFeedbackError(friendlyErrorMessage(error, "Laporan gagal disimpan. Periksa koneksi dan coba lagi."));
    } finally {
      setFeedbackSending(false);
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
            <Field label="Income acuan (untuk kalkulator)"><input type="number" value={income} onChange={(e) => setIncome(e.target.value)} /></Field>
            <Field label="Tanggal pengingat gajian">
              <input type="number" min="1" max="31" value={payDay} onChange={(e) => setPayDay(e.target.value)} />
            </Field>
            <p className="muted text-xs">Pengingat muncul mulai tanggal ini. Periode anggaran hanya dimulai saat kamu mencatat gaji lewat tombol Input Gaji; tanggal dan nominalnya bisa berbeda setiap periode.</p>
            <p className="muted text-xs">Mengubah income acuan tidak mengubah periode aktif. Input gaji aktual dan alokasinya dilakukan lewat Tambah Uang.</p>
            {profileError && <div role="alert" className="text-sm" style={{ color: "var(--rose)" }}>{profileError}</div>}
            <button className="btn-primary flex items-center justify-center gap-2" onClick={saveProfile} disabled={!profileValid}>
              <Check size={16} /> {profileSaved ? "Tersimpan!" : "Simpan Profil"}
            </button>
          </div>

        </div>

        <div className="card p-6">
          <p className="muted text-xs uppercase tracking-wide mb-3">Tampilan</p>
          <button className="btn-ghost flex items-center gap-2" onClick={onToggleTheme}>
            {theme === "dark" ? <><Sun size={15} /> Ganti ke Tema Terang</> : <><Moon size={15} /> Ganti ke Tema Gelap</>}
          </button>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-2 mb-2">
            <Bug size={16} className="muted" />
            <p className="muted text-xs uppercase tracking-wide">Laporan bug atau masukan</p>
          </div>
          <p className="muted text-sm mb-4">
            Laporan akan langsung disimpan dengan aman di Supabase untuk ditinjau. Pengiriman email tidak digunakan.
          </p>
          <form className="flex flex-col gap-3" onSubmit={sendFeedback}>
            <Field label="Jenis laporan">
              <select value={feedbackType} onChange={(event) => setFeedbackType(event.target.value)}>
                <option value="bug">Laporkan bug</option>
                <option value="feedback">Masukan untuk sistem</option>
              </select>
            </Field>
            <Field label="Deskripsi">
              <textarea
                value={feedbackDescription}
                onChange={(event) => setFeedbackDescription(event.target.value)}
                placeholder="Jelaskan bug yang ditemukan atau masukan yang ingin disampaikan..."
                rows={5}
                maxLength={5000}
                required
                style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", padding: 10, fontSize: 14, resize: "vertical" }}
              />
            </Field>
            <Field label="Foto opsional (JPG/PNG/WebP maks. 4 MB)">
              <input
                ref={feedbackFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFeedbackFileChange}
              />
            </Field>
            {feedbackFile && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="muted flex items-center gap-2"><Image size={14} /> {feedbackFile.name}</span>
                <button type="button" className="icon-btn" onClick={() => {
                  setFeedbackFile(null);
                  if (feedbackFileInputRef.current) feedbackFileInputRef.current.value = "";
                }} aria-label="Hapus foto">
                  <X size={14} />
                </button>
              </div>
            )}
            {feedbackError && <p className="text-sm" role="alert" style={{ color: "var(--rose)" }}>{feedbackError}</p>}
            <button className="btn-primary flex items-center justify-center gap-2" type="submit" disabled={feedbackSending || !feedbackDescription.trim()}>
              <Send size={15} /> {feedbackSending ? "Mengirim..." : "Kirim Laporan"}
            </button>
          </form>
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
            Pilih file backup JSON atau tempel isinya untuk memulihkan alokasi & riwayat transaksi.
            Ini akan menimpa data alokasi & transaksi akun ini — login tidak berubah.
          </p>
          <input
            ref={backupFileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={loadBackupFile}
            style={{ display: "none" }}
          />
          <button
            type="button"
            className="btn-ghost flex items-center gap-2 mb-3"
            onClick={() => backupFileInputRef.current?.click()}
          >
            <Upload size={15} /> Pilih File Backup JSON
          </button>
          {importFileName && <p className="muted text-xs mb-2">File dipilih: {importFileName}</p>}
          <textarea
            value={importText}
            onChange={(e) => { setImportText(e.target.value); setImportFileName(""); }}
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
      {feedbackSent && (
        <div
          role="presentation"
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div className="card p-6 flex flex-col items-center gap-3 text-center" role="dialog" aria-modal="true" aria-labelledby="feedback-success-title" style={{ maxWidth: 420, width: "100%" }}>
            <Check size={28} color="var(--teal)" />
            <h2 id="feedback-success-title" className="display" style={{ fontSize: 20, fontWeight: 700 }}>Laporan berhasil dikirim</h2>
            <p className="muted text-sm">Laporan akan segera di proses, terima kasih atas masukan dan kontribusinya.</p>
            <button type="button" className="btn-primary mt-2" onClick={() => setFeedbackSent(false)}>Tutup</button>
          </div>
        </div>
      )}
    </div>
  );
}

function assistantActionLabel(action, categories) {
  const category = categories.find((item) => item.id === action.categoryId);
  const sub = category?.subs?.find((item) => item.id === action.subId);
  if (action.type === "add_salary_period") {
    return `Catat gaji ${rupiah(action.amount)} pada ${dateLabel(action.date)}`;
  }
  if (action.type === "add_transaction") {
    const kind = action.transactionType === "topup" ? "Tambahan pemasukan" : action.transactionType === "withdraw" ? "Tarik dana aset" : "Pengeluaran";
    return `${kind}: ${rupiah(action.amount)}${category ? ` · ${category.name}` : ""}${sub ? ` / ${sub.name}` : ""} · ${dateLabel(action.date)}${action.note ? ` · ${action.note}` : ""}`;
  }
  if (action.type === "set_allocations") {
    return `Ubah alokasi: ${(action.allocations || []).map((item) => {
      const name = categories.find((categoryItem) => categoryItem.id === item.categoryId)?.name || item.categoryId;
      return `${name} ${item.percent}%`;
    }).join(", ")}`;
  }
  if (action.type === "add_goal") {
    return `Tambah target "${action.goalName}" sebesar ${rupiah(action.goalTarget)}`;
  }
  return "Usulan tindakan keuangan";
}

function AssistantChat({ user, transactions, onApplyAction }) {
  const [open, setOpen] = useState(false);
  const [includeAccountData, setIncludeAccountData] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([{
    id: uid(),
    role: "assistant",
    content: "Hai! Aku asisten Pundi. Aku bisa bantu menjelaskan fitur dan memberi panduan pengelolaan keuangan. Kamu juga bisa meminta usulan pencatatan atau perubahan anggaran; semua perubahan harus kamu konfirmasi dulu.",
    actions: [],
  }]);
  const scrollRef = useRef(null);
  const applyingActionsRef = useRef(new Set());
  const categories = user.categories || [];

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, open, sending]);

  const financialContext = () => {
    const periods = getSalaryPeriods(user);
    const activePeriod = getActivePeriod(user);
    return {
      monthlyReferenceIncome: Number(user.income || 0),
      activeSalaryPeriod: {
        startDate: activePeriod.startDate,
        amount: Number(activePeriod.amount || 0),
      },
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        percent: Number(category.percent || 0),
        isAsset: !!category.isAsset,
        subCategories: (category.subs || []).map((sub) => ({
          id: sub.id,
          name: sub.name,
          percent: Number(sub.percent || 0),
        })),
      })),
      savingsGoals: (user.goals || []).map((goal) => ({
        id: goal.id,
        name: goal.name,
        target: Number(goal.target || 0),
        categoryId: goal.categoryId,
        subId: goal.subId,
      })),
      recentTransactions: transactions.slice(-20).map((transaction) => ({
        type: transaction.type || "expense",
        date: transaction.date,
        amount: Number(transaction.amount || 0),
        categoryId: transaction.categoryId || null,
        subId: transaction.subId || null,
        note: transaction.note || "",
      })),
      salaryPeriodsCount: periods.length,
    };
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setError("");
    setInput("");
    const userMessage = { id: uid(), role: "user", content: text, actions: [] };
    const nextMessages = [...messages, userMessage];
    const recentMessages = nextMessages.slice(1).slice(-12);
    const conversation = recentMessages[0]?.role === "assistant" ? recentMessages.slice(1) : recentMessages;
    setMessages(nextMessages);
    setSending(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("pundi-assistant", {
        body: {
          messages: conversation.map(({ role, content }) => ({ role, content })),
          context: includeAccountData ? financialContext() : null,
        },
      });
      if (invokeError) {
        if (invokeError.context instanceof Response) {
          const responseBody = await invokeError.context.clone().json().catch(() => null);
          if (typeof responseBody?.error === "string") throw new Error(responseBody.error);
        }
        throw invokeError;
      }
      if (typeof data?.reply !== "string" || !Array.isArray(data.actions)) {
        throw new Error("Respons asisten tidak valid. Silakan coba lagi.");
      }
      const allowedTypes = new Set(["add_transaction", "add_salary_period", "set_allocations", "add_goal"]);
      const validActions = data.actions.filter((action) => {
        if (!action || !allowedTypes.has(action.type)) return false;
        if (action.type === "add_salary_period") {
          return Number.isFinite(action.amount) && typeof action.date === "string";
        }
        if (action.type === "add_transaction") {
          return Number.isFinite(action.amount) &&
            ["expense", "topup", "withdraw"].includes(action.transactionType) &&
            typeof action.date === "string";
        }
        if (action.type === "set_allocations") {
          return Array.isArray(action.allocations) &&
            action.allocations.every((item) => item && typeof item.categoryId === "string" && Number.isFinite(item.percent));
        }
        return typeof action.goalName === "string" &&
          Number.isFinite(action.goalTarget) &&
          typeof action.categoryId === "string" &&
          typeof action.subId === "string";
      }).slice(0, 3);
      setMessages((current) => [...current, {
        id: uid(),
        role: "assistant",
        content: data.reply,
        actions: validActions.map((action) => ({ ...action, status: "pending" })),
      }]);
    } catch (requestError) {
      console.error("Pundi assistant request failed", requestError);
      setError(friendlyErrorMessage(requestError, "Asisten sedang tidak tersedia. Coba lagi sebentar."));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const applyAction = async (messageId, actionIndex, action) => {
    const actionKey = `${messageId}:${actionIndex}`;
    if (applyingActionsRef.current.has(actionKey)) return;
    applyingActionsRef.current.add(actionKey);
    setError("");
    setMessages((current) => current.map((message) => message.id !== messageId ? message : {
      ...message,
      actions: message.actions.map((item, index) => index === actionIndex ? { ...item, status: "applying" } : item),
    }));
    try {
      await onApplyAction(action);
      setMessages((current) => current.map((message) => message.id !== messageId ? message : {
        ...message,
        actions: message.actions.map((item, index) => index === actionIndex ? { ...item, status: "applied" } : item),
      }));
    } catch (applyError) {
      console.error("Pundi assistant action failed", applyError);
      setMessages((current) => current.map((message) => message.id !== messageId ? message : {
        ...message,
        actions: message.actions.map((item, index) => index === actionIndex ? { ...item, status: "failed" } : item),
      }));
      setError(friendlyErrorMessage(applyError, "Tindakan belum dapat diterapkan. Periksa data dan coba lagi."));
    } finally {
      applyingActionsRef.current.delete(actionKey);
    }
  };

  const statusForAction = (status) => {
    if (status === "applied") return <p className="text-xs mt-2" style={{ color: "var(--teal)" }}>Diterapkan ke akun</p>;
    if (status === "dismissed") return <p className="muted text-xs mt-2">Usulan ditolak.</p>;
    return null;
  };

  return (
    <>
      {open && (
        <section
          aria-label="Asisten Pundi"
          className="card p-4 anim-pop"
          style={{ position: "fixed", right: 20, bottom: 92, zIndex: 100, width: "min(390px, calc(100vw - 32px))", height: "min(620px, calc(100dvh - 120px))", display: "flex", flexDirection: "column", boxShadow: "0 16px 50px rgba(0,0,0,.4)" }}
        >
          <header className="flex items-center justify-between gap-2 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2">
              <Sparkles size={17} color="var(--gold)" />
              <div>
                <p className="display" style={{ fontWeight: 700 }}>Asisten Pundi</p>
                <p className="muted" style={{ fontSize: 11 }}>Panduan Pundi & keuangan</p>
              </div>
            </div>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Tutup asisten"><X size={18} /></button>
          </header>

          <label className="flex items-start gap-2 py-3 text-xs muted" style={{ lineHeight: 1.45 }}>
            <input
              type="checkbox"
              checked={includeAccountData}
              onChange={(event) => setIncludeAccountData(event.target.checked)}
              style={{ width: 16, minWidth: 16, marginTop: 1 }}
            />
            <span>Sertakan ringkasan anggaran, target, dan 20 transaksi terakhir agar saran lebih personal. Data hanya dikirim saat mengirim pesan dan diproses oleh Google Gemini.</span>
          </label>

          <div aria-live="polite" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, padding: "4px 2px 12px" }}>
            {messages.map((message) => (
              <div key={message.id} style={{ alignSelf: message.role === "user" ? "flex-end" : "flex-start", width: "min(94%, 340px)" }}>
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    fontSize: 13,
                    lineHeight: 1.5,
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: message.role === "user" ? "var(--surface2)" : "var(--surface)",
                    border: "1px solid var(--border)",
                  }}
                >{message.content}</div>
                {message.actions.map((action, index) => (
                  <div key={`${message.id}-${index}`} className="card2 p-3 mt-2">
                    <p className="text-xs" style={{ lineHeight: 1.5 }}>{assistantActionLabel(action, categories)}</p>
                    {statusForAction(action.status)}
                    {!["applied", "dismissed"].includes(action.status) && (
                      <>
                      {action.status === "failed" && <p className="text-xs mt-2" style={{ color: "var(--rose)" }}>Gagal diterapkan. Kamu bisa mencoba lagi.</p>}
                      <div className="flex gap-2 mt-2">
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          style={{ padding: "7px 12px" }}
                          disabled={action.status === "applying"}
                          onClick={() => applyAction(message.id, index, action)}
                        >{action.status === "applying" ? "Menyimpan..." : "Terapkan ke akun"}</button>
                        {action.status === "pending" && <button type="button" className="btn-ghost text-xs" style={{ padding: "7px 12px" }} onClick={() => setMessages((current) => current.map((item) => item.id !== message.id ? item : { ...item, actions: item.actions.map((candidate, actionIndex) => actionIndex === index ? { ...candidate, status: "dismissed" } : candidate) }))}>Tolak</button>}
                      </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {sending && <p className="muted text-xs anim-fade">Asisten sedang menyiapkan jawaban...</p>}
            <div ref={scrollRef} />
          </div>

          {error && <p role="alert" className="text-xs mb-2" style={{ color: "var(--rose)" }}>{error}</p>}
          <form onSubmit={sendMessage} className="flex items-end gap-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage(event);
                }
              }}
              placeholder="Tanya soal Pundi atau keuangan..."
              rows={2}
              maxLength={2000}
              disabled={sending}
              aria-label="Pesan untuk Asisten Pundi"
              style={{ flex: 1, minWidth: 0, resize: "none", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--text)", padding: 10, fontSize: 13 }}
            />
            <button type="submit" className="btn-primary" aria-label="Kirim pesan" disabled={sending || !input.trim()} style={{ padding: 10 }}>
              <Send size={16} />
            </button>
          </form>
          <p className="muted mt-2" style={{ fontSize: 10 }}>Panduan umum, bukan nasihat keuangan profesional. AI bisa keliru; periksa usulan sebelum menerapkan.</p>
        </section>
      )}
      <button
        type="button"
        aria-label="Asisten Pundi sedang dalam pemeliharaan"
        title="Asisten Pundi sedang dalam pemeliharaan"
        disabled
        style={{ position: "fixed", right: 20, bottom: 20, zIndex: 101, width: 58, height: 58, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 24px rgba(0,0,0,.25)", cursor: "not-allowed", opacity: 0.75 }}
      >
        <><MessageCircle size={23} /><Bot size={14} style={{ position: "absolute", marginTop: 22, marginLeft: 22, background: "var(--surface2)", borderRadius: 999 }} /></>
      </button>
      <span
        role="status"
        style={{ position: "fixed", right: 20, bottom: 84, zIndex: 101, padding: "6px 10px", borderRadius: 999, background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", fontSize: 11, boxShadow: "0 4px 14px rgba(0,0,0,.2)" }}
      >
        Asisten dalam pemeliharaan
      </span>
    </>
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
    const goalTransactions = (transactions || []).filter((transaction) => transaction.goalId === goalId);
    const contributed = goalTransactions
      .filter((transaction) => transaction.type === "expense")
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    const withdrawn = goalTransactions
      .filter((transaction) => transaction.type === "withdraw")
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    return Math.max(0, contributed - withdrawn);
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
function EditTransactionModal({ tx, cat, categories = [], user, transactions = [], period, onClose, onSave }) {
  const [amount, setAmount] = useState(String(tx.amount));
  const [subId, setSubId] = useState(tx.subId || "");
  const [borrowedFromCategoryId, setBorrowedFromCategoryId] = useState(tx.borrowedFromCategoryId || "");
  const [borrowedFromSubId, setBorrowedFromSubId] = useState(tx.borrowedFromSubId || "");
  const [note, setNote] = useState(tx.note || "");
  const [date, setDate] = useState(tx.date);
  const [error, setError] = useState("");
  const transactionCategory = categories.find((category) => category.id === tx.categoryId) || cat;
  const canBorrow = isExpenseTx(tx) && !tx.directAsset && transactionCategory && !transactionCategory.isAsset;
  const lenderCategories = categories;
  const topup = isTopupTx(tx);
  const assetOpening = isAssetOpeningTx(tx);
  const withdraw = isWithdrawTx(tx);
  const txLabel = withdraw ? "Tarik Dana" : topup ? "Tambahan Dana" : assetOpening ? "Saldo Awal Aset" : (cat && cat.isAsset) ? "Setor" : "Pengeluaran";

  const submit = () => {
    const amt = Number(amount);
    if (!(amt > 0)) { setError("Jumlah harus lebih dari 0."); return; }
    if (canBorrow && borrowedFromCategoryId) {
      const lender = categories.find((category) => category.id === borrowedFromCategoryId);
      const lenderSub = lender?.subs?.find((sub) => sub.id === borrowedFromSubId);
      if (!lender || (borrowedFromSubId && !lenderSub) ||
          (lender.id === tx.categoryId && (!subId || !lenderSub || lenderSub.id === subId))) {
        setError("Pilih alokasi sumber pinjaman yang valid.");
        return;
      }
      const editPeriod = user && getSalaryPeriods(user).filter((salaryPeriod) => salaryPeriod.startDate <= date).at(-1);
      const transactionPeriod = editPeriod || period;
      const targetSub = transactionCategory.subs?.find((sub) => sub.id === subId);
      const requiredBorrowAmount = user && transactionPeriod
        ? Math.max(0, amt - Math.max(0, targetSub
          ? allocationSubRemaining(user, transactions, transactionPeriod, tx.categoryId, targetSub.id, tx.id)
          : allocationRemaining(user, transactions, transactionPeriod, tx.categoryId, tx.id)))
        : 0;
      const available = user && transactionPeriod
        ? (lender.isAsset
          ? assetBalance(transactions, lender.id, lenderSub?.id, user, tx.id)
          : lenderSub
            ? allocationSubRemaining(user, transactions, transactionPeriod, lender.id, lenderSub.id, tx.id)
            : allocationRemaining(user, transactions, transactionPeriod, lender.id, tx.id))
        : 0;
      if (requiredBorrowAmount > available) {
        setError(`Sisa ${lender.isAsset ? "aset" : "alokasi"} "${allocationSourceName(user, lender.id, lenderSub?.id)}" tidak mencukupi. Sisa saat ini ${rupiah(available)}.`);
        return;
      }
      onSave({
        ...tx,
        amount: amt,
        subId: subId || null,
        note: note.trim(),
        date,
        borrowedFromCategoryId: requiredBorrowAmount > 0 ? lender.id : null,
        borrowedFromSubId: requiredBorrowAmount > 0 ? lenderSub?.id || null : null,
        borrowedAmount: requiredBorrowAmount,
      });
      return;
    }
    onSave({
      ...tx,
      amount: amt,
      subId: subId || null,
      note: note.trim(),
      date,
      borrowedFromCategoryId: canBorrow ? (borrowedFromCategoryId || null) : null,
      borrowedFromSubId: canBorrow ? (borrowedFromSubId || null) : null,
      borrowedAmount: 0,
    });
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
          {transactionCategory && transactionCategory.subs.length > 0 && (
            <Field label="Sub-alokasi">
              <select value={subId} onChange={(e) => setSubId(e.target.value)}>
                <option value="">Tanpa sub-kategori</option>
                {transactionCategory.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          {canBorrow && lenderCategories.some((category) =>
            category.id !== tx.categoryId || (subId && category.subs?.some((sub) => sub.id !== subId))
          ) && (
            <Field label="Sumber pinjaman">
              <select
                value={borrowedFromCategoryId ? JSON.stringify([borrowedFromCategoryId, borrowedFromSubId || null]) : ""}
                onChange={(event) => {
                  if (!event.target.value) {
                    setBorrowedFromCategoryId("");
                    setBorrowedFromSubId("");
                    return;
                  }
                  const [categoryId, sourceSubId] = JSON.parse(event.target.value);
                  setBorrowedFromCategoryId(categoryId);
                  setBorrowedFromSubId(sourceSubId || "");
                }}
              >
                <option value="">Tidak ada pinjaman</option>
                {lenderCategories.flatMap((category) => [
                  ...(category.id !== tx.categoryId
                    ? [<option key={category.id} value={JSON.stringify([category.id, null])}>{category.name}{category.isAsset ? " · aset" : ""}</option>]
                    : []),
                  ...(category.subs || [])
                    .filter((sub) => category.id !== tx.categoryId || (subId && sub.id !== subId))
                    .map((sub) => (
                      <option key={`${category.id}:${sub.id}`} value={JSON.stringify([category.id, sub.id])}>
                        ↳ {category.name}{category.isAsset ? " · aset" : ""} / {sub.name}
                      </option>
                    )),
                ])}
              </select>
            </Field>
          )}
          <Field label="Tanggal">
            <input className="transaction-date-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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

export default function App() {
  const [user, setUser] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState("dashboard"); // dashboard | category | editAlloc | monthlyHistory | settings | goals
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [pendingUser, setPendingUser] = useState(null); // holds new account while welcome modal shows
  const [showAddMoney, setShowAddMoney] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [showResetAccount, setShowResetAccount] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [sessionChecked, setSessionChecked] = useState(false);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const txSaveQueueRef = useRef(Promise.resolve());
  const profileSaveQueueRef = useRef(Promise.resolve());
  const profileMutationQueueRef = useRef(Promise.resolve());
  const accountLoadRef = useRef(null);
  const userRef = useRef(null);
  const signupConfirmationRef = useRef(false);
  const signupConfirmationHandledRef = useRef(false);
  const passwordRecoveryRef = useRef(false);

  useEffect(() => {
    const authFlow = new URLSearchParams(window.location.search).get("auth");
    signupConfirmationRef.current = authFlow === "signup";
    passwordRecoveryRef.current = authFlow === "recovery";
    const completeSignupConfirmation = async (session) => {
      if (signupConfirmationHandledRef.current) return;
      signupConfirmationHandledRef.current = true;
      if (session) {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }
      signupConfirmationRef.current = false;
      window.history.replaceState(null, "", window.location.pathname);
      setAuthError("");
      setAuthNotice("Email berhasil diverifikasi. Silakan masuk dengan akunmu.");
      setSessionChecked(true);
    };

    (async () => {
      const savedTheme = await readKey(THEME_KEY, false);
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);

      const { data: { session } } = await supabase.auth.getSession();
      if (signupConfirmationRef.current) {
        await completeSignupConfirmation(session);
        return;
      }
      if (passwordRecoveryRef.current) {
        setPasswordRecovery(true);
        setShowForgotPassword(true);
        setSessionChecked(true);
        return;
      }
      if (session) await loadAccount(session.user.id);
      setSessionChecked(true);
    })().catch((error) => {
      console.error("Supabase session load failed", error);
      setAuthError(friendlyErrorMessage(error, "Sesi belum dapat dimuat. Silakan muat ulang halaman atau masuk kembali."));
      setSessionChecked(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        passwordRecoveryRef.current = true;
        setPasswordRecovery(true);
        setShowForgotPassword(true);
        setSessionChecked(true);
        return;
      }
      if (passwordRecoveryRef.current) return;
      if (signupConfirmationRef.current && event === "SIGNED_IN" && session) {
        try {
          await completeSignupConfirmation(session);
        } catch (error) {
          console.error("Email verification completion failed", error);
          setAuthError("Email sudah diverifikasi, tetapi sesi belum dapat ditutup. Muat ulang halaman lalu masuk kembali.");
          setSessionChecked(true);
        }
        return;
      }
      if (event === "SIGNED_IN" && session && !user) {
        try {
          await loadAccount(session.user.id);
        } catch (error) {
          console.error("Account load after sign-in failed", error);
          setAuthError(friendlyErrorMessage(error, "Data akun belum dapat dimuat. Coba masuk kembali beberapa saat lagi."));
        }
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    writeKey(THEME_KEY, next, false);
  };

  const loadAccount = async (userId) => {
    if (accountLoadRef.current?.userId === userId && accountLoadRef.current.promise) {
      return accountLoadRef.current.promise;
    }
    const loadPromise = (async () => {
    const [{ data: profile, error: profileError }, { data: tx, error: txError }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      supabase.from("transactions").select("*").eq("user_id", userId).order("date", { ascending: true }),
    ]);
    if (profileError) throw profileError;
    if (txError) throw txError;
    if (!profile || profile.id !== userId) throw new Error("Profil akun tidak ditemukan.");
    const storedMonthlyIncomes = profile.monthly_incomes || {};
    const hasSavedSalaryPeriods = Object.prototype.hasOwnProperty.call(storedMonthlyIncomes, "__pundi_salary_periods");
    const hasSavedPayDay = Object.prototype.hasOwnProperty.call(storedMonthlyIncomes, "__pundi_pay_day");
    const storedCategories = Array.isArray(profile.categories) ? profile.categories : [];
    const knownStages = new Set(["onboarding", "choice", "custom", "resume", "dashboard"]);
    let loadedStage = knownStages.has(profile.stage) ? profile.stage : "onboarding";
    if (["onboarding", "choice", "custom"].includes(loadedStage) && storedCategories.length > 0) {
      loadedStage = profile.confirmed ? "dashboard" : "resume";
    }
    const loadedUser = {
      ...profile,
      categories: storedCategories,
      stage: loadedStage,
      monthlyIncomes: Object.fromEntries(Object.entries(storedMonthlyIncomes).filter(([key]) => /^\d{4}-\d{2}$/.test(key))),
      monthlyIncomePromptDismissed: profile.monthly_income_prompt_dismissed || {},
      salaryPeriods: hasSavedSalaryPeriods
        ? (Array.isArray(storedMonthlyIncomes.__pundi_salary_periods) ? storedMonthlyIncomes.__pundi_salary_periods : [])
        : (Array.isArray(profile.salary_periods) ? profile.salary_periods : []),
      payDay: hasSavedPayDay
        ? Math.max(1, Math.min(31, Number(storedMonthlyIncomes.__pundi_pay_day) || 1))
        : Math.max(1, Math.min(31, Number(profile.pay_day) || 1)),
      assetArchive: Array.isArray(storedMonthlyIncomes.__pundi_asset_archive) ? storedMonthlyIncomes.__pundi_asset_archive : [],
      strategyMode: profile.strategy_mode,
      passwordHash: undefined,
      securityQuestion: profile.security_question,
      securityAnswer: profile.security_answer,
    };
    userRef.current = loadedUser;
    setUser(loadedUser);
    setTransactions((tx || []).map(({ user_id, category_id, sub_id, direct_asset, goal_id, borrowed_from_category_id, borrowed_from_sub_id, borrowed_amount, ...item }) => ({
      ...item,
      categoryId: category_id,
      subId: sub_id,
      directAsset: !!direct_asset,
      goalId: goal_id || null,
      borrowedFromCategoryId: borrowed_from_category_id || null,
      borrowedFromSubId: borrowed_from_sub_id || null,
      borrowedAmount: borrowed_amount == null ? null : Number(borrowed_amount),
      amount: Number(item.amount),
    })));
    setAccountLoaded(true);
    })();
    accountLoadRef.current = { userId, promise: loadPromise };
    try {
      return await loadPromise;
    } catch (error) {
      setAccountLoaded(false);
      throw error;
    } finally {
      if (accountLoadRef.current?.promise === loadPromise) accountLoadRef.current = null;
    }
  };

  const profilePayload = (u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    name: u.name || "",
    age: u.age || null,
    income: u.income || null,
    monthly_incomes: {
      ...(u.monthlyIncomes || {}),
      __pundi_salary_periods: u.salaryPeriods || [],
      __pundi_pay_day: Math.max(1, Math.min(31, Number(u.payDay) || 1)),
      __pundi_asset_archive: u.assetArchive || [],
    },
    monthly_income_prompt_dismissed: u.monthlyIncomePromptDismissed || {},
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
    const save = profileSaveQueueRef.current.then(async () => {
      const { data, error } = await supabase
        .from("profiles")
        .upsert(profilePayload(u))
        .select("id, stage, confirmed, categories")
        .single();
      if (error) throw error;
      if (!data || data.id !== u.id || data.stage !== (u.stage || "onboarding")) {
        throw new Error("Profile save could not be verified.");
      }
    });
    profileSaveQueueRef.current = save.catch(() => {});
    try {
      await save;
    } catch (error) {
      console.error("profile save failed", error);
      setAuthError(friendlyErrorMessage(error, "Perubahan akun belum tersimpan. Periksa koneksi lalu coba lagi."));
      throw error;
    }
  };

  const transactionRow = (userId, item) => ({
    id: item.id,
      user_id: userId,
      date: item.date,
      type: item.type || "expense",
      category_id: item.categoryId || null,
      sub_id: item.subId || null,
      direct_asset: !!item.directAsset,
      goal_id: item.goalId || null,
      borrowed_from_category_id: item.borrowedFromCategoryId || null,
      borrowed_from_sub_id: item.borrowedFromCategoryId ? item.borrowedFromSubId || null : null,
      borrowed_amount: item.borrowedFromCategoryId ? transactionBorrowedAmount(item) : 0,
      note: item.note || null,
      amount: Number(item.amount),
  });

  const enqueueTransactionSave = (userId, operation, { notify = true } = {}) => {
    const save = txSaveQueueRef.current.then(async () => {
      const { error } = await operation();
      if (error) throw error;
    });
    txSaveQueueRef.current = save.catch(() => {});
    return save.catch(async (error) => {
      console.error("transaction save failed", error);
      if (notify) {
        setAuthError(friendlyErrorMessage(error, "Perubahan transaksi belum tersimpan. Periksa koneksi lalu coba lagi."));
      }
      try {
        await loadAccount(userId);
      } catch (reloadError) {
        console.error("Account reload after transaction failure failed", reloadError);
        if (notify) setAuthError("Data akun belum dapat dimuat ulang. Muat ulang halaman sebelum melanjutkan.");
      }
      throw error;
    });
  };

  const replaceTransactions = (userId, tx, notify = true) => enqueueTransactionSave(userId, () =>
    supabase.rpc("replace_my_transactions", {
      replacement_rows: tx.map((item) => transactionRow(userId, item)),
    }),
    { notify }
  );

  const updateUser = (patch) => {
    const save = profileMutationQueueRef.current.then(async () => {
      const current = userRef.current;
      if (!current) return false;
      const next = { ...current, ...patch };
      await persistUser(next);
      userRef.current = next;
      setUser(next);
      setAuthError("");
      return true;
    });
    profileMutationQueueRef.current = save.catch(() => {});
    return save.catch(() => false);
  };

  const handleLogin = async (email, password) => {
    setBusy(true); setAuthError(""); setAuthNotice("");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      console.error("Sign-in failed", error);
      setBusy(false);
      setAuthError(friendlyErrorMessage(error, "Tidak dapat masuk saat ini. Periksa data akun dan coba lagi."));
      return;
    }
    try {
      await loadAccount(data.user.id);
      setPage("dashboard");
    } catch (loadError) {
      console.error("Account load during login failed", loadError);
      setAuthError(friendlyErrorMessage(loadError, "Akun berhasil dikenali, tetapi datanya belum dapat dimuat. Coba lagi."));
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (username, email, password, securityQuestion, securityAnswer) => {
    setBusy(true); setAuthError(""); setAuthNotice("");
    const { data: authData, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: authCallbackUrl,
        data: { username, securityQuestion, securityAnswer },
      },
    });
    if (error) {
      console.error("Registration failed", error);
      setBusy(false);
      setAuthError(error.code === "23505"
        ? "Username atau email sudah digunakan. Coba gunakan username atau email lain."
        : friendlyErrorMessage(error, "Akun belum dapat dibuat. Periksa data dan coba lagi."));
      return;
    }
    if (authData.user?.identities?.length === 0) {
      setBusy(false);
      setAuthError("Email sudah terdaftar. Silakan masuk atau gunakan email lain.");
      return;
    }
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
      salaryPeriods: [], payDay: 1,
      assetArchive: [],
      strategyMode: null,
      categories: [],
      recurring: [],
      goals: [],
      confirmed: false,
      stage: "onboarding",
    };
    const { error: profileError } = await supabase.from("profiles").upsert(profilePayload(newUser));
    if (profileError) {
      console.error("Initial profile creation failed", profileError);
      setBusy(false);
      setAuthError(friendlyErrorMessage(profileError, "Akun berhasil dibuat, tetapi profil belum siap. Coba masuk kembali atau hubungi admin."));
      return;
    }
    setBusy(false);
    setAccountLoaded(true);
    setTransactions([]);
    setPendingUser(newUser); // show welcome notice before entering the app
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Sign-out failed", error);
      setAuthError(friendlyErrorMessage(error, "Belum berhasil keluar. Periksa koneksi lalu coba lagi."));
      return;
    }
    userRef.current = null;
    setUser(null);
    setTransactions([]);
    setAccountLoaded(false);
    setAuthError("");
    setPage("dashboard");
  };

  const handlePasswordRecoveryComplete = async () => {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
    passwordRecoveryRef.current = false;
    setPasswordRecovery(false);
    setShowForgotPassword(false);
    userRef.current = null;
    setUser(null);
    setTransactions([]);
    setAccountLoaded(false);
    setAuthError("");
    setAuthNotice("Password berhasil diperbarui. Silakan masuk dengan password baru.");
    window.history.replaceState(null, "", window.location.pathname);
  };

  const handleImportData = async (userPatch, importedTransactions) => {
    const normalizedTransactions = importedTransactions.map((transaction) => ({
      ...transaction,
      id: String(transaction.id),
      type: transaction.type || "expense",
      amount: Number(transaction.amount),
      categoryId: transaction.categoryId || null,
      subId: transaction.subId || null,
      directAsset: !!transaction.directAsset,
      goalId: transaction.goalId || null,
      borrowedFromCategoryId: transaction.borrowedFromCategoryId || null,
      borrowedAmount: transaction.borrowedAmount == null ? null : Number(transaction.borrowedAmount),
    }));
    try {
      await replaceTransactions(user.id, normalizedTransactions, false);
    } catch (error) {
      if (error?.code === "23505") {
        throw new Error("ID transaksi pada backup sudah digunakan oleh data lain. Pastikan backup berasal dari akun ini atau hapus data duplikat dari file sebelum mengimpor.");
      }
      throw new Error(friendlyErrorMessage(
        error,
        `Transaksi backup gagal disimpan (${error?.message || "kesalahan database"}). Data akun sebelumnya tetap digunakan.`
      ));
    }
    const profileSaved = await updateUser(userPatch);
    if (!profileSaved) {
      try {
        await replaceTransactions(user.id, transactions, false);
      } catch (rollbackError) {
        console.error("Backup transaction rollback failed", rollbackError);
        throw new Error("Profil backup gagal disimpan dan pemulihan transaksi lama juga gagal. Hubungi dukungan sebelum mengubah data lagi.");
      }
      throw new Error("Profil backup belum tersimpan. Transaksi lama telah dipulihkan.");
    }
    setTransactions(normalizedTransactions.sort((a, b) => a.date.localeCompare(b.date)));
    return true;
  };

  const handleAddTx = async (tx) => {
    try {
      await enqueueTransactionSave(user.id, () =>
        supabase.from("transactions").upsert(transactionRow(user.id, tx))
      );
      setTransactions((current) => [...current, tx].sort((a, b) => a.date.localeCompare(b.date)));
    } catch {
      // enqueueTransactionSave reports the failure and reloads the persisted account.
    }
  };
  const handleUpdateTx = async (updatedTx) => {
    try {
      await enqueueTransactionSave(user.id, () =>
        supabase.from("transactions").upsert(transactionRow(user.id, updatedTx))
      );
      setTransactions((current) => current
        .map((transaction) => transaction.id === updatedTx.id ? updatedTx : transaction)
        .sort((a, b) => a.date.localeCompare(b.date)));
    } catch {
      // enqueueTransactionSave reports the failure and reloads the persisted account.
    }
  };
  const handleDeleteTx = async (id) => {
    try {
      await enqueueTransactionSave(user.id, () =>
        supabase.from("transactions").delete().eq("id", id).eq("user_id", user.id)
      );
      setTransactions((current) => current.filter((transaction) => transaction.id !== id));
    } catch {
      // enqueueTransactionSave reports the failure and reloads the persisted account.
    }
  };
  const handleAddRecurring = (item) => updateUser({ recurring: [...(user.recurring || []), item] });
  const handleRemoveRecurring = (id) => updateUser({ recurring: (user.recurring || []).filter((r) => r.id !== id) });

  const handleResetAccount = async () => {
    const resetUser = {
      ...user,
      name: "", age: null, income: null,
      monthlyIncomes: {},
      salaryPeriods: [], payDay: 1,
      assetArchive: [],
      monthlyIncomePromptDismissed: {},
      strategyMode: null,
      categories: [],
      recurring: [],
      goals: [],
      confirmed: false,
      stage: "onboarding",
    };
    try {
      await persistUser(resetUser);
      await replaceTransactions(user.id, []);
    } catch (error) {
      console.error("Account data reset failed", error);
      return false;
    }
    userRef.current = resetUser;
    setUser(resetUser);
    setTransactions([]);
    setPage("dashboard");
    setShowResetAccount(false);
    return true;
  };

  const handleConfirmMonthIncome = async (amount, startDate, categories, carryover = null, allocationRepayments = []) => {
    const periods = getSalaryPeriods(user);
    const existing = periods.find((period) => period.startDate === startDate);
    const nextPeriod = {
      id: existing?.id || uid(),
      startDate,
      amount,
      categories: categories.map((category) => ({
        ...category,
        subs: (category.subs || []).map((sub) => ({ ...sub })),
      })),
      carryovers: carryover ? [{ ...carryover }] : [],
      allocationRepayments: allocationRepayments.map((repayment) => ({ ...repayment })),
    };
    const salaryPeriods = [...periods.filter((period) => period.startDate !== startDate), nextPeriod]
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const nextUser = {
      ...user,
      income: Number(salaryPeriods.at(-1)?.amount || amount),
      salaryPeriods,
      categories,
    };
    try {
      await persistUser(nextUser);
    } catch (error) {
      return friendlyErrorMessage(error, "Profil belum berhasil disimpan. Periksa koneksi lalu coba lagi.");
    }
    userRef.current = nextUser;
    setUser(nextUser);
    setShowAddMoney(false);
    return true;
  };

  const handleAssistantAction = async (action) => {
    if (!user || !accountLoaded) throw new Error("Akun belum siap. Muat ulang halaman lalu coba lagi.");
    const validDate = (value) => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = dateAtLocalMidnight(value);
      return !Number.isNaN(date.getTime()) && dateString(date) === value && value <= todayStr();
    };
    const positiveAmount = (value) => Number.isFinite(value) && value > 0 && value <= 1_000_000_000_000;

    if (action.type === "add_salary_period") {
      if (!positiveAmount(action.amount) || !validDate(action.date)) {
        throw new Error("Nominal atau tanggal gaji tidak valid.");
      }
      if (getSalaryPeriods(user).some((period) => period.startDate === action.date)) {
        throw new Error("Sudah ada periode gaji pada tanggal tersebut. Periksa riwayat periode terlebih dahulu.");
      }
      const result = await handleConfirmMonthIncome(action.amount, action.date, user.categories, null);
      if (result !== true) throw new Error(typeof result === "string" ? result : "Gaji gagal disimpan.");
      return;
    }

    if (action.type === "add_transaction") {
      const { transactionType, amount, date, categoryId, subId, note } = action;
      if (!["expense", "topup", "withdraw"].includes(transactionType) || !positiveAmount(amount) || !validDate(date)) {
        throw new Error("Jenis transaksi, nominal, atau tanggal tidak valid.");
      }
      const category = categoryId ? user.categories.find((item) => item.id === categoryId) : null;
      if (categoryId && !category) throw new Error("Kategori yang diusulkan tidak tersedia di akunmu.");
      if (transactionType !== "topup" && !category) throw new Error("Pilih kategori untuk transaksi ini.");
      if (subId && !category?.subs?.some((sub) => sub.id === subId)) {
        throw new Error("Sub-alokasi yang diusulkan tidak tersedia di kategori tersebut.");
      }
      if (transactionType === "withdraw" && !category?.isAsset) {
        throw new Error("Penarikan hanya bisa dicatat pada kategori aset.");
      }
      if (transactionType === "withdraw" && amount > assetBalance(transactions, category.id, subId || undefined, user)) {
        throw new Error("Nominal melebihi saldo aset yang tersedia.");
      }
      const transaction = {
        id: uid(),
        type: transactionType,
        categoryId: category?.id || null,
        subId: subId || null,
        amount,
        note: typeof note === "string" ? note.trim().slice(0, 200) : "",
        date,
      };
      await enqueueTransactionSave(user.id, () =>
        supabase.from("transactions").insert(transactionRow(user.id, transaction))
      );
      setTransactions((current) => [...current, transaction].sort((a, b) => a.date.localeCompare(b.date)));
      return;
    }

    if (action.type === "set_allocations") {
      const currentCategories = user.categories || [];
      const proposed = action.allocations;
      if (!Array.isArray(proposed) || proposed.length !== currentCategories.length || !currentCategories.length) {
        throw new Error("Usulan harus mencakup semua kategori aktif.");
      }
      const percentages = new Map();
      for (const item of proposed) {
        if (
          !item ||
          !currentCategories.some((category) => category.id === item.categoryId) ||
          !Number.isFinite(item.percent) ||
          item.percent < 0 ||
          item.percent > 100 ||
          percentages.has(item.categoryId)
        ) {
          throw new Error("Persentase atau kategori dalam usulan tidak valid.");
        }
        percentages.set(item.categoryId, item.percent);
      }
      const total = [...percentages.values()].reduce((sum, value) => sum + value, 0);
      if (Math.abs(total - 100) > 0.01) throw new Error("Total alokasi harus tepat 100%.");

      const categories = currentCategories.map((category) => ({
        ...category,
        percent: percentages.get(category.id),
      }));
      const activePeriod = getActivePeriod(user);
      const salaryPeriods = getSalaryPeriods(user).map((period) => period.id === activePeriod.id
        ? { ...period, categories }
        : period);
      const nextUser = { ...user, categories, salaryPeriods };
      await persistUser(nextUser);
      userRef.current = nextUser;
      setUser(nextUser);
      return;
    }

    if (action.type === "add_goal") {
      const category = user.categories.find((item) => item.id === action.categoryId);
      const sub = category?.subs?.find((item) => item.id === action.subId);
      if (
        typeof action.goalName !== "string" ||
        !action.goalName.trim() ||
        action.goalName.length > 80 ||
        !positiveAmount(action.goalTarget) ||
        !category ||
        !sub
      ) {
        throw new Error("Target perlu nama, nominal, kategori, dan sub-alokasi yang valid.");
      }
      const goals = [...(user.goals || []), {
        id: uid(),
        name: action.goalName.trim(),
        target: action.goalTarget,
        categoryId: category.id,
        subId: sub.id,
      }];
      const nextUser = { ...user, goals };
      await persistUser(nextUser);
      userRef.current = nextUser;
      setUser(nextUser);
      return;
    }

    throw new Error("Jenis tindakan tidak didukung.");
  };

  const handleDeleteAccount = async () => {
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      console.error("Account deletion failed", error);
      setAuthError(friendlyErrorMessage(error, "Akun belum dapat dihapus. Coba lagi atau hubungi admin."));
      return false;
    }
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    if (signOutError) console.error("Local sign-out after account deletion failed", signOutError);
    setShowDeleteAccount(false);
    userRef.current = null;
    setUser(null);
    setTransactions([]);
    setAccountLoaded(false);
    setPage("dashboard");
    return true;
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
          notice={authNotice}
          error={authError}
          busy={busy}
        />
        {pendingUser && (
          <WelcomeModal
            name={pendingUser.name}
            onContinue={() => { userRef.current = pendingUser; setUser(pendingUser); setPendingUser(null); }}
          />
        )}
        {showForgotPassword && (
          <ForgotPasswordModal
            recoveryMode={passwordRecovery}
            onRecoveryComplete={handlePasswordRecoveryComplete}
            onClose={() => {
              if (!passwordRecovery) setShowForgotPassword(false);
            }}
          />
        )}
        <AppFooter />
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
          onLogout={handleLogout}
          onSave={(categories) => {
            const activePeriod = getActivePeriod(user);
            const retainedAssetIds = new Set(categories.filter((category) => category.isAsset).map((category) => category.id));
            const archiveById = new Map((user.assetArchive || []).map((category) => [category.id, category]));
            user.categories.filter((category) => category.isAsset && !retainedAssetIds.has(category.id)).forEach((category) => {
              archiveById.set(category.id, category);
            });
            const salaryPeriods = getSalaryPeriods(user).map((period) =>
              period.id === activePeriod.id ? { ...period, categories } : period
            );
            updateUser({ categories, salaryPeriods, assetArchive: [...archiveById.values()] });
            setPage("dashboard");
          }}
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
          onLogout={handleLogout}
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
          onImport={handleImportData}
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
          accountLoaded={accountLoaded}
          onOpenCategory={(id) => { setActiveCategoryId(id); setPage("category"); }}
          onEditAlloc={() => setPage("editAlloc")}
          onAddMoney={() => setShowAddMoney("global")}
          onViewHistory={() => setPage("monthlyHistory")}
          onOpenSettings={() => setPage("settings")}
          onOpenGoals={() => setPage("goals")}
          onOpenCalculator={() => setPage("calculator")}
          onDismissIncomeReminder={() => updateUser({
            monthlyIncomePromptDismissed: {
              ...(user.monthlyIncomePromptDismissed || {}),
              [paydayReminderDismissalKey(user)]: true,
            },
          })}
          onLogout={handleLogout}
        />
      );
    }
  }

  return (
    <div className={"mmp-app" + (theme === "light" ? " theme-light" : "")}>
      <style>{STYLE}</style>
      {authError && (
        <div role="alert" className="card p-3 flex items-start justify-between gap-3" style={{ position: "fixed", top: "max(12px, env(safe-area-inset-top))", left: "50%", transform: "translateX(-50%)", width: "min(760px, calc(100vw - 24px))", zIndex: 2000, borderColor: "var(--rose)", color: "var(--rose)", boxShadow: "0 12px 36px rgba(0,0,0,.35)" }}>
          <span className="text-sm flex items-start gap-2"><AlertCircle size={15} style={{ flex: "0 0 auto", marginTop: 2 }} /> {authError}</span>
          <button className="icon-btn" aria-label="Tutup pesan error" onClick={() => setAuthError("")}><X size={15} /></button>
        </div>
      )}
      {content}
      {user && accountLoaded && !pendingUser && (
        <AssistantChat
          user={user}
          transactions={transactions}
          onApplyAction={handleAssistantAction}
        />
      )}
      {showAddMoney && (
        <AddMoneyModal
          user={user}
          transactions={transactions}
          initialTarget={showAddMoney === "salary" ? "salary" : "global"}
          onClose={() => setShowAddMoney(false)}
          onSubmit={(tx) => { handleAddTx(tx); setShowAddMoney(false); }}
          onSalarySubmit={handleConfirmMonthIncome}
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
      <AppFooter />
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
.mmp-app .transaction-date-input{
  flex:0 1 160px;
  width:160px;
  min-width:0;
  max-width:160px !important;
  height:42px;
  box-sizing:border-box;
  display:block;
  align-self:stretch;
  text-align:left;
  line-height:22px;
  padding:9px 10px;
  font-family:inherit;
  font-size:13px;
  letter-spacing:0;
  white-space:nowrap;
}
.mmp-app .app-footer{
  padding:4px 16px 18px;
  color:var(--muted);
  font-size:11px;
  text-align:center;
}
.mmp-app .app-footer span{ color:var(--gold); }
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
.mmp-app .allocation-value-input{
  width:150px;
  min-width:0;
  flex:0 1 150px;
}
.mmp-app .allocation-value-input > input{
  width:72px;
  min-width:0;
  flex:1 1 72px;
}
.mmp-app .main-allocation-row{
  display:grid;
  grid-template-columns:minmax(0, 1fr) 150px minmax(90px, auto) auto;
  align-items:center;
}
.mmp-app .main-allocation-row > :first-child{ min-width:0; }
.mmp-app .main-allocation-row .main-allocation-name{ min-width:0; }
.mmp-app .main-allocation-row > .tabular{
  min-width:90px;
  text-align:right;
  white-space:nowrap;
}
.mmp-app .card2{ transition: transform .15s ease, border-color .15s ease, background .15s ease; }
.mmp-app .cat-card{ cursor:pointer; }
.mmp-app .dashboard-analytics-grid{ align-items:stretch; }
.mmp-app .dashboard-analytics-card{ min-width:0; display:flex; align-items:stretch; }
.mmp-app .allocation-ring{ width:100%; height:100%; justify-content:space-evenly; }
.mmp-app .allocation-ring-chart{
  width:clamp(150px, 18vw, 176px);
  aspect-ratio:1;
  flex:0 0 auto;
}
.mmp-app .allocation-ring-disc{ width:100%; height:100%; }
.mmp-app .allocation-ring-legend{ max-width:100%; }
.mmp-app .allocation-ring-legend > *{ font-size:12px; }
.mmp-app .spending-trend-chart{ width:100%; height:100%; min-width:0; justify-content:space-between; }
.mmp-app .spending-trend-svg{ display:block; width:100%; height:auto; aspect-ratio:420 / 190; }
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
.mmp-app .add-money-modal-salary{
  display:flex;
  flex-direction:column;
  min-height:0;
  overflow:hidden;
}
.mmp-app .add-money-modal-content-salary{
  flex:1 1 auto;
  min-height:0;
  overflow-y:auto;
  overscroll-behavior:contain;
  scrollbar-width:thin;
  scrollbar-color:var(--border) transparent;
  scroll-behavior:smooth;
  padding:0 6px 4px 0;
  gap:12px;
}
.mmp-app .add-money-modal-content-salary::-webkit-scrollbar{ width:6px; }
.mmp-app .add-money-modal-content-salary::-webkit-scrollbar-track{ background:transparent; }
.mmp-app .add-money-modal-content-salary::-webkit-scrollbar-thumb{ background:var(--border); border-radius:9999px; }
.mmp-app .add-money-modal-content-salary::-webkit-scrollbar-thumb:hover{ background:var(--gold); }
.mmp-app .salary-target-list{
  display:grid;
  grid-template-columns:repeat(2, minmax(0, 1fr));
}
.mmp-app .salary-target-list > button{
  min-width:0;
  text-align:center;
  white-space:normal;
}
.mmp-app .salary-target-list > button:last-child{ grid-column:1 / -1; }
.mmp-app .salary-submit{
  position:sticky;
  bottom:0;
  z-index:1;
  flex-shrink:0;
  box-shadow:0 -8px 14px var(--surface);
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
  .mmp-app .dashboard-analytics-grid{ gap:12px; }
  .mmp-app .dashboard-analytics-card{ padding:16px; }
  .mmp-app .allocation-ring-chart{ width:160px; }
  .mmp-app .spending-trend-svg{ max-height:180px; }

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
  .mmp-app .transaction-form > .transaction-date-input{
    width:100%;
    max-width:100% !important;
    min-width:0;
    height:42px;
    font-size:13px;
  }
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
  .mmp-app .modal-overlay > .add-money-modal-salary{ overflow:hidden; }

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
  .mmp-app .sub-allocation-row{
    display:grid;
    grid-template-columns:minmax(0, 1fr) auto auto;
    align-items:center;
  }
  .mmp-app .sub-allocation-row > .sub-allocation-name{
    grid-column:1 / -1;
    min-width:0;
    width:100%;
  }
  .mmp-app .sub-allocation-row > .flex.items-center.gap-1\\.5:has(.unit-toggle){
    width:auto;
    min-width:0;
    flex:0 1 auto;
  }
  .mmp-app .sub-allocation-row > .allocation-value-input{
    width:auto;
  }
  .mmp-app .sub-allocation-row > .allocation-value-input > input{
    width:clamp(72px, 22vw, 104px);
    min-width:0;
  }
  .mmp-app .sub-allocation-row > .sub-allocation-amount{
    min-width:0 !important;
    white-space:nowrap;
    overflow-wrap:normal;
  }
  .mmp-app .sub-allocation-row > .icon-btn{
    flex-shrink:0;
  }
  .mmp-app .main-allocation-row{
    grid-template-columns:minmax(0, 1fr) auto auto;
    align-items:center;
  }
  .mmp-app .main-allocation-row > .flex.items-center.gap-2{
    grid-column:1 / -1;
    min-width:0;
  }
  .mmp-app .main-allocation-row .main-allocation-name{
    min-width:0;
    width:100%;
  }
  .mmp-app .main-allocation-row > .flex.items-center.gap-1\\.5:has(.unit-toggle){
    width:auto;
    min-width:0;
    flex:0 1 auto;
  }
  .mmp-app .main-allocation-row > .allocation-value-input{
    width:auto;
  }
  .mmp-app .main-allocation-row > .allocation-value-input > input{
    width:clamp(72px, 22vw, 104px);
    min-width:0;
  }
  .mmp-app .main-allocation-row > .tabular{
    min-width:0 !important;
    white-space:nowrap;
  }
  .mmp-app .main-allocation-row > .icon-btn{
    flex-shrink:0;
  }
  .mmp-app .dashboard-summary-metrics{
    display:grid;
    grid-template-columns:repeat(2, minmax(0, 1fr));
    gap:14px 18px;
    width:100%;
  }
  .mmp-app .dashboard-summary-metrics > *{
    min-width:0;
  }
  .mmp-app .dashboard-summary-metrics > :nth-child(2),
  .mmp-app .dashboard-summary-metrics > :nth-child(4){
    text-align:right;
  }
  .mmp-app .dashboard-summary-metrics .tabular{
    white-space:nowrap;
    overflow-wrap:normal;
  }
  .mmp-app .tabular{ overflow-wrap:normal; }
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
