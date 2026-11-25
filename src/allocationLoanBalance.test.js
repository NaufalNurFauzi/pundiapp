import assert from "node:assert/strict";
import test from "node:test";
import { resolveAllocationLoanBalances } from "./allocationLoanBalance.js";

test("keeps the unpaid balance after a partial repayment", () => {
  const balances = resolveAllocationLoanBalances([
    { key: "loan", type: "loan", date: "2026-01-01", amount: 100 },
    { key: "loan", type: "repayment", date: "2026-02-01", amount: 35 },
  ]);

  assert.equal(balances.get("loan"), 65);
});

test("removes a fully repaid loan and ignores repayment beyond its balance", () => {
  const balances = resolveAllocationLoanBalances([
    { key: "loan", type: "loan", date: "2026-01-01", amount: 100 },
    { key: "loan", type: "repayment", date: "2026-02-01", amount: 120 },
  ]);

  assert.equal(balances.get("loan"), 0);
});

test("rounds fractional amounts to rupiah so fully repaid loans leave no residue", () => {
  const balances = resolveAllocationLoanBalances([
    { key: "loan", type: "loan", date: "2026-01-01", amount: 100.4 },
    { key: "loan", type: "repayment", date: "2026-02-01", amount: 100.4 },
  ]);

  assert.equal(balances.get("loan"), 0);
});

test("applies category-level repayments in a stable order for sub-allocation loans", () => {
  const events = [
    {
      key: "sub-b",
      type: "loan",
      date: "2026-01-01",
      amount: 80,
      fromCategoryId: "borrower",
      toCategoryId: "lender",
      fromSubId: "b",
      tieBreaker: "loan-b",
    },
    {
      key: "sub-a",
      type: "loan",
      date: "2026-01-01",
      amount: 60,
      fromCategoryId: "borrower",
      toCategoryId: "lender",
      fromSubId: "a",
      tieBreaker: "loan-a",
    },
    {
      key: "category",
      type: "repayment",
      date: "2026-02-01",
      amount: 50,
      fromCategoryId: "borrower",
      toCategoryId: "lender",
    },
  ];

  const balances = resolveAllocationLoanBalances(events);

  assert.equal(balances.get("sub-a"), 10);
  assert.equal(balances.get("sub-b"), 80);
});
