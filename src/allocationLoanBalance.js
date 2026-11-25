export function normalizeAllocationAmount(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

export function resolveAllocationLoanBalances(events) {
  const orderedEvents = [...events].sort((a, b) =>
    String(a.date || "").localeCompare(String(b.date || "")) ||
    (Date.parse(a.createdAt || "") || 0) - (Date.parse(b.createdAt || "") || 0) ||
    Number(a.type !== "repayment") - Number(b.type !== "repayment") ||
    String(a.tieBreaker || a.key).localeCompare(String(b.tieBreaker || b.key))
  );
  const balances = new Map();
  const loanOrder = [];
  const loanDetails = new Map();

  orderedEvents.forEach((event) => {
    const amount = normalizeAllocationAmount(event.amount);
    if (event.type === "loan") {
      if (!(amount > 0)) return;
      if (!balances.has(event.key)) loanOrder.push(event.key);
      balances.set(event.key, normalizeAllocationAmount((balances.get(event.key) || 0) + amount));
      loanDetails.set(event.key, event);
      return;
    }

    const repaymentKeys = event.fromSubId || event.toSubId
      ? [event.key]
      : [
          event.key,
          ...loanOrder.filter((key) => {
            const loan = loanDetails.get(key);
            return key !== event.key &&
              loan.fromCategoryId === event.fromCategoryId &&
              loan.toCategoryId === event.toCategoryId;
          }),
        ];
    let remainingRepayment = amount;
    repaymentKeys.forEach((key) => {
      if (!(remainingRepayment > 0)) return;
      const outstanding = balances.get(key) || 0;
      const applied = Math.min(outstanding, remainingRepayment);
      balances.set(key, outstanding - applied);
      remainingRepayment -= applied;
    });
  });

  return balances;
}
