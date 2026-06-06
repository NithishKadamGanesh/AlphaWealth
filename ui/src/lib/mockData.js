// ui/src/lib/mockData.js
// Mock data used until backend services are wired up
// Replace these with API calls to net-worth-svc, ibkr-sync-svc, teller-banking-svc

export const portfolioHoldings = [
  { ticker: "NVDA",  name: "NVIDIA",            shares: 12, price: 875.20, cost: 480, weight: 22.4, sector: "Tech", change: 2.75 },
  { ticker: "VOO",   name: "Vanguard S&P 500",  shares: 35, price: 498.50, cost: 380, weight: 37.2, sector: "ETF",  change: 0.42 },
  { ticker: "MSFT",  name: "Microsoft",         shares: 22, price: 415.80, cost: 310, weight: 19.5, sector: "Tech", change: -0.51 },
  { ticker: "AAPL",  name: "Apple",             shares: 45, price: 189.30, cost: 142, weight: 18.2, sector: "Tech", change: 0.66 },
  { ticker: "BRK.B", name: "Berkshire B",       shares: 8,  price: 380.20, cost: 290, weight: 6.5,  sector: "Fin",  change: 0.18 },
  { ticker: "AMZN",  name: "Amazon",            shares: 15, price: 185.40, cost: 145, weight: 5.9,  sector: "Cons", change: 1.76 },
];

export const netWorthHistory = (() => {
  let v = 240000;
  return Array.from({ length: 24 }, (_, i) => {
    v += (Math.random() - 0.3) * 6500;
    return {
      month: new Date(2024, i % 12, 1).toLocaleString("default", { month: "short" }),
      v: Math.round(v)
    };
  });
})();

export const transactions = [
  { merchant: "Whole Foods Market",  category: "Groceries",     amount: -84.20, date: "May 3" },
  { merchant: "Shell Gas Station",   category: "Transport",     amount: -62.45, date: "May 3" },
  { merchant: "Salary Deposit",      category: "Income",        amount: 4833.33, date: "May 2" },
  { merchant: "Netflix",             category: "Entertainment", amount: -15.49, date: "May 2" },
  { merchant: "Trader Joe's",        category: "Groceries",     amount: -47.80, date: "May 1" },
  { merchant: "Con Edison",          category: "Utilities",     amount: -98.40, date: "Apr 30" },
  { merchant: "Spotify",             category: "Entertainment", amount:  -9.99, date: "Apr 30" },
  { merchant: "CVS Pharmacy",        category: "Health",        amount: -23.60, date: "Apr 29" },
  { merchant: "Chipotle",            category: "Dining",        amount: -16.80, date: "Apr 28" },
  { merchant: "Amazon",              category: "Shopping",      amount: -156.43, date: "Apr 27" },
];

export const spendingByCategory = [
  { name: "Housing",       value: 1850, budget: 1900, color: "#7c3aed" },
  { name: "Groceries",     value: 420,  budget: 500,  color: "#06b6d4" },
  { name: "Transport",     value: 280,  budget: 300,  color: "#a3e635" },
  { name: "Dining",        value: 340,  budget: 250,  color: "#ef4444" },
  { name: "Entertainment", value: 89,   budget: 150,  color: "#f59e0b" },
  { name: "Utilities",     value: 195,  budget: 200,  color: "#2563eb" },
  { name: "Shopping",      value: 380,  budget: 300,  color: "#ec4899" },
  { name: "Health",        value: 120,  budget: 200,  color: "#06b6d4" },
];

// Asset/liability breakdown for Net Worth page
export const ASSETS = [
  { name: "IBKR Portfolio", value: 46897,  type: "Investment", icon: "briefcase", color: "#a3e635" },
  { name: "Chase Checking", value: 8450,   type: "Cash",       icon: "bank",      color: "#06b6d4" },
  { name: "Chase Savings",  value: 24000,  type: "Cash",       icon: "bank",      color: "#06b6d4" },
  { name: "401k",           value: 38200,  type: "Retirement", icon: "target",    color: "#f59e0b" },
  { name: "Home Value",     value: 185000, type: "Property",   icon: "home",      color: "#7c3aed" },
  { name: "Crypto",         value: 4120,   type: "Investment", icon: "diamond",   color: "#ec4899" },
];

export const LIABILITIES = [
  { name: "Mortgage",      value: 148000, icon: "home" },
  { name: "Student Loans", value: 18200,  icon: "coffee" },
  { name: "Auto Loan",     value: 6037,   icon: "car" },
];
