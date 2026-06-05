const MONEY_MOVEMENT_PATTERNS = [
  "online transfer",
  "internal transfer",
  "transfer to",
  "transfer from",
  "zelle payment",
  "venmo",
  "paypal",
  "cash app",
  "cashapp",
];

export function isMoneyMovement(tx) {
  const category = String(tx?.category || "").toLowerCase();
  const merchant = String(tx?.merchant || tx?.name || "").toLowerCase();

  if (category === "transfer") return true;
  if (merchant.includes("interest payment")) return false;

  return MONEY_MOVEMENT_PATTERNS.some((pattern) => merchant.includes(pattern));
}

export function getCashFlowTransactions(transactions) {
  return (transactions || []).filter((tx) => !tx?.pending && !isMoneyMovement(tx));
}

export function summarizeCashFlow(transactions) {
  const filtered = getCashFlowTransactions(transactions);
  const incomeTransactions = filtered.filter((tx) => Number(tx.amount) > 0);
  const spendingTransactions = filtered.filter((tx) => Number(tx.amount) < 0);

  const income = incomeTransactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const spending = spendingTransactions.reduce((sum, tx) => sum + Math.abs(Number(tx.amount || 0)), 0);
  const netCashFlow = income - spending;
  const saveRate = income > 0 ? (netCashFlow / income) * 100 : 0;

  return {
    filtered,
    incomeTransactions,
    spendingTransactions,
    income,
    spending,
    netCashFlow,
    saveRate,
  };
}

export function computeSpendingCategories(transactions) {
  const totals = {};
  for (const tx of getCashFlowTransactions(transactions)) {
    const amount = Number(tx.amount || 0);
    if (amount >= 0) continue;
    const category = tx.category || "Other";
    totals[category] = (totals[category] || 0) + Math.abs(amount);
  }

  const palette = ["#7c3aed", "#06b6d4", "#a3e635", "#ef4444", "#f59e0b", "#2563eb", "#ec4899", "#10b981"];
  return Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .map(([name, value], i) => ({
      name,
      value: Math.round(value),
      budget: Math.round(value * 1.2),
      color: palette[i % palette.length],
    }));
}

export function buildDailySpend(transactions, days = 30) {
  const byDay = {};
  for (const tx of getCashFlowTransactions(transactions)) {
    const amount = Number(tx.amount || 0);
    if (amount >= 0) continue;
    const dt = tx.rawDate ? new Date(tx.rawDate) : new Date(tx.date);
    const day = dt.getDate();
    if (!day) continue;
    byDay[day] = (byDay[day] || 0) + Math.abs(amount);
  }

  return Array.from({ length: days }, (_, i) => ({ day: i + 1, amount: byDay[i + 1] || 0 }));
}
