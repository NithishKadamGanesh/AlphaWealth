import { useState, useEffect, useCallback, useRef } from "react";

const NET_WORTH_URL = import.meta.env.VITE_NET_WORTH_URL || "http://localhost:8093";
const BANKING_URL = import.meta.env.VITE_PLAID_URL || "http://localhost:8092";
const IBKR_URL = import.meta.env.VITE_IBKR_URL || "http://localhost:8091";
const TIMEOUT_MS = 4000;

const tf = (ms) => AbortSignal.timeout(ms);

const EMPTY_SNAPSHOT = {
  totalAssets: 0,
  totalLiabilities: 0,
  netWorth: 0,
  cash: 0,
  investments: 0,
  property: 0,
  retirement: 0,
  crypto: 0,
  otherAssets: 0,
  timestamp: null,
};

const EMPTY_BREAKDOWN = {
  assets: [],
  liabilities: [],
  manualAssets: [],
  manualLiabilities: [],
};

const ASSET_ICON = {
  property: "home",
  retirement: "target",
  crypto: "diamond",
  other: "briefcase",
};

const LIABILITY_ICON = {
  mortgage: "home",
  "student-loan": "coffee",
  auto: "car",
  "credit-card": "dollar",
  other: "bank",
};

const titleize = (value, fallback) => {
  if (!value) return fallback;
  return String(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
};

const numberOrZero = (value) => Number(value) || 0;

const normalizeSnapshot = (cur) => ({
  totalAssets: numberOrZero(cur?.totalAssets),
  totalLiabilities: numberOrZero(cur?.totalLiabilities),
  netWorth: numberOrZero(cur?.netWorth),
  cash: numberOrZero(cur?.cash),
  investments: numberOrZero(cur?.investments),
  property: numberOrZero(cur?.property),
  retirement: numberOrZero(cur?.retirement),
  crypto: numberOrZero(cur?.crypto),
  otherAssets: numberOrZero(cur?.otherAssets),
  timestamp: cur?.timestamp || null,
});

const normalizeManualAsset = (asset) => ({
  id: asset.id ? `manual-asset:${asset.id}` : `manual-asset:${asset.name}`,
  name: asset.name || "Manual Asset",
  type: titleize(asset.type, "Asset"),
  icon: ASSET_ICON[asset.type] || "briefcase",
  value: numberOrZero(asset.value),
  source: "manual",
});

const normalizeManualLiability = (liability) => ({
  id: liability.id ? `manual-liability:${liability.id}` : `manual-liability:${liability.name}`,
  name: liability.name || "Manual Liability",
  type: titleize(liability.type, "Liability"),
  icon: LIABILITY_ICON[liability.type] || "bank",
  value: numberOrZero(liability.value),
  source: "manual",
});

const normalizeBrokerAsset = (account) => ({
  id: `ibkr:${account.account || "primary"}`,
  name: "IBKR Portfolio",
  type: "Investment",
  icon: "briefcase",
  value: numberOrZero(account.netLiquidation || account.grossPositionValue),
  source: "ibkr",
});

const normalizeBankAsset = (account) => ({
  id: `bank:${account.id}`,
  name: account.name || account.institution || "Bank Account",
  type: titleize(account.subtype || account.type, "Cash"),
  icon: "bank",
  value: numberOrZero(account.balance),
  source: "banking",
});

const normalizeHistory = (arr, currentSnapshot) => {
  if (Array.isArray(arr) && arr.length > 0) {
    return arr
      .slice()
      .reverse()
      .map(s => ({
        month: new Date(s.timestamp).toLocaleString("default", { month: "short", day: "numeric" }),
        v: numberOrZero(s.netWorth),
      }));
  }

  if (currentSnapshot?.timestamp) {
    return [{
      month: new Date(currentSnapshot.timestamp).toLocaleString("default", { month: "short", day: "numeric" }),
      v: numberOrZero(currentSnapshot.netWorth),
    }];
  }

  return [];
};

const buildAssets = ({ snapshot, ibkrAccounts, bankAccounts, manualAssets }) => {
  const assets = [];

  if (Array.isArray(ibkrAccounts) && ibkrAccounts.length > 0) {
    assets.push(normalizeBrokerAsset(ibkrAccounts[0]));
  } else if (numberOrZero(snapshot?.investments) > 0) {
    assets.push({
      id: "snapshot:investments",
      name: "Investments",
      type: "Investment",
      icon: "briefcase",
      value: numberOrZero(snapshot.investments),
      source: "snapshot",
    });
  }

  if (Array.isArray(bankAccounts)) {
    assets.push(...bankAccounts.map(normalizeBankAsset));
  } else if (numberOrZero(snapshot?.cash) > 0) {
    assets.push({
      id: "snapshot:cash",
      name: "Cash Accounts",
      type: "Cash",
      icon: "bank",
      value: numberOrZero(snapshot.cash),
      source: "snapshot",
    });
  }

  if (Array.isArray(manualAssets)) {
    assets.push(...manualAssets.map(normalizeManualAsset));
  }

  return assets
    .filter(asset => asset.value > 0)
    .sort((a, b) => b.value - a.value);
};

const buildLiabilities = (manualLiabilities) =>
  (Array.isArray(manualLiabilities) ? manualLiabilities : [])
    .map(normalizeManualLiability)
    .filter(liability => liability.value > 0)
    .sort((a, b) => b.value - a.value);

export function useNetWorth() {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [history, setHistory] = useState([]);
  const [breakdown, setBreakdown] = useState(EMPTY_BREAKDOWN);
  const [dataMode, setDataMode] = useState("loading");
  const [lastError, setLastError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const failsRef = useRef(0);
  const snapshotRef = useRef(EMPTY_SNAPSHOT);

  const refresh = useCallback(async () => {
    try {
      const [curRes, histRes, brkRes, ibkrRes, bankRes] = await Promise.all([
        fetch(`${NET_WORTH_URL}/networth/current`, { signal: tf(TIMEOUT_MS) }),
        fetch(`${NET_WORTH_URL}/networth/history?days=730`, { signal: tf(TIMEOUT_MS) }),
        fetch(`${NET_WORTH_URL}/networth/breakdown`, { signal: tf(TIMEOUT_MS) }),
        fetch(`${IBKR_URL}/ibkr/accounts`, { signal: tf(TIMEOUT_MS) }).catch(() => null),
        fetch(`${BANKING_URL}/banking/accounts`, { signal: tf(TIMEOUT_MS) }).catch(() => null),
      ]);

      if (!curRes.ok) throw new Error(`HTTP ${curRes.status} from net-worth-svc`);
      const current = normalizeSnapshot(await curRes.json());
      snapshotRef.current = current;
      setSnapshot(current);

      let historyPayload = [];
      if (histRes.ok) {
        try {
          historyPayload = await histRes.json();
        } catch {
          historyPayload = [];
        }
      }
      setHistory(normalizeHistory(historyPayload, current));

      let breakdownPayload = { manualAssets: [], manualLiabilities: [] };
      if (brkRes.ok) {
        try {
          breakdownPayload = await brkRes.json();
        } catch {
          breakdownPayload = { manualAssets: [], manualLiabilities: [] };
        }
      }

      const manualAssets = Array.isArray(breakdownPayload.manualAssets) ? breakdownPayload.manualAssets : [];
      const manualLiabilities = Array.isArray(breakdownPayload.manualLiabilities) ? breakdownPayload.manualLiabilities : [];

      let ibkrAccounts = [];
      if (ibkrRes?.ok) {
        try {
          const parsed = await ibkrRes.json();
          ibkrAccounts = Array.isArray(parsed) ? parsed : [];
        } catch {
          ibkrAccounts = [];
        }
      }

      let bankAccounts = [];
      if (bankRes?.ok) {
        try {
          const parsed = await bankRes.json();
          bankAccounts = Array.isArray(parsed) ? parsed : [];
        } catch {
          bankAccounts = [];
        }
      }

      setBreakdown({
        assets: buildAssets({ snapshot: current, ibkrAccounts, bankAccounts, manualAssets }),
        liabilities: buildLiabilities(manualLiabilities),
        manualAssets,
        manualLiabilities,
      });

      setDataMode("live");
      setLastError(null);
      setLastUpdate(Date.now());
      failsRef.current = 0;
    } catch (e) {
      failsRef.current += 1;
      const msg = String(e.message || e);
      setLastError(msg);
      setDataMode(snapshotRef.current.timestamp ? "stale" : "error");
      if (failsRef.current >= 2) {
        console.warn(`[useNetWorth] net-worth-svc refresh failed: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    snapshot,
    history,
    breakdown,
    dataMode,
    isReal: dataMode === "live",
    lastError,
    lastUpdate,
    loading,
    refresh,
  };
}
