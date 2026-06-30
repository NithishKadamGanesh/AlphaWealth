import { useState, useEffect, useCallback } from "react";
import { T } from "../lib/tokens";
import { Icon } from "../components/Icon";
import { Card } from "../components/ui/Card";
import { Tag, Pulse } from "../components/ui/Tag";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { BrokerConnections } from "../components/BrokerConnections";
import { AvatarUploader } from "../components/AvatarUploader";
import { cn, fmtMoney } from "../lib/cn";
import {
  getDisplayName, setDisplayName,
  getFireTarget,  setFireTarget,
  getApiToken,    setApiToken,
  DEFAULTS as PREF_DEFAULTS,
} from "../lib/userPrefs";

const AI_ADVISOR_URL = import.meta.env.VITE_AI_ADVISOR_URL || "http://localhost:8094";
const SENTIMENT_URL  = import.meta.env.VITE_SENTIMENT_URL  || "http://localhost:8097";
const FINGPT_URL     = import.meta.env.VITE_FINGPT_URL     || "http://localhost:8098";
const ALERTS_URL     = import.meta.env.VITE_ALERTS_URL     || "http://localhost:8095";

const PROVIDER_META = {
  claude: { name: "Anthropic Claude", variant: "warning",  icon: "sparkle", env: "ANTHROPIC_API_KEY" },
  openai: { name: "OpenAI GPT",       variant: "accent",   icon: "cpu",     env: "OPENAI_API_KEY" },
  gemini: { name: "Google Gemini",    variant: "accent",   icon: "layers",  env: "GEMINI_API_KEY" },
  ollama: { name: "Ollama Local",     variant: "positive", icon: "shield",  env: "(no key needed)" },
};

const SERVICES = [
  { name: "live-data-svc",     port: 8096, type: "core", desc: "yfinance bridge — quotes, candles, news" },
  { name: "analysis-svc",      port: 8088, type: "core", desc: "Patterns — S/R — seasonality — options — MTF" },
  { name: "backtest-svc",      port: 8089, type: "core", desc: "Strategy backtester" },
  { name: "model-svc",         port: 8090, type: "core", desc: "Python model server with C++ blending" },
  { name: "ibkr-sync-svc",     port: 8091, type: "core", desc: "Interactive Brokers gateway sync" },
  { name: "teller-banking-svc", port: 8092, type: "core", desc: "Real bank integration via Teller.io" },
  { name: "net-worth-svc",     port: 8093, type: "core", desc: "Net worth aggregator + history" },
  { name: "ai-advisor-svc",    port: 8094, type: "core", desc: "Multi-model LLM advisor" },
  { name: "alerts-svc",        port: 8095, type: "core", desc: "Resend email alerts" },
  { name: "sentiment-svc",     port: 8097, type: "ai",   desc: "FinBERT news sentiment (GPU)" },
  { name: "fingpt-svc",        port: 8098, type: "ai",   desc: "FinGPT-Forecaster (GPU)" },
  { name: "ollama",            port: 11434, type: "ai",  desc: "Llama 3.1 8B Q5 (GPU)" },
  { name: "cpp-signal-engine", port: 9000, type: "core", desc: "Native C++ indicators" },
];

const ALERT_TYPE_LABELS = {
  price_above: "Price above",
  price_below: "Price below",
  budget_exceed: "Budget spend",
  net_worth_change: "Net worth cross",
};

export const Settings = () => {
  const [providers, setProviders] = useState(null);
  const [healthMap, setHealthMap] = useState({});
  const [activeProvider, setActiveProvider] = useState(localStorage.getItem("alphawealth.provider") || null);
  const [gpuStatus, setGpuStatus] = useState({ sentiment: null, fingpt: null });
  const [displayNameInput, setDisplayNameInput] = useState(() => {
    const n = getDisplayName();
    return n === PREF_DEFAULTS.displayName ? "" : n;
  });
  const [fireTargetInput, setFireTargetInput] = useState(() => String(getFireTarget()));
  const [apiTokenInput, setApiTokenInput] = useState(() => getApiToken());
  const [profileSaved, setProfileSaved] = useState(false);
  const [alertRules, setAlertRules] = useState([]);
  const [alertHistory, setAlertHistory] = useState([]);
  const [alertsStatus, setAlertsStatus] = useState("idle");
  const [alertForm, setAlertForm] = useState({
    name: "AAPL price alert",
    type: "price_above",
    target: "AAPL",
    threshold: "200",
  });

  useEffect(() => {
    fetch(`${AI_ADVISOR_URL}/providers`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setProviders(d); if (!activeProvider) setActiveProvider(d.active); } })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const probeService = async (svc) => {
      const url = svc.name === "ollama" ? `http://localhost:${svc.port}/api/tags` : `http://localhost:${svc.port}/health`;
      try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return r.ok ? "healthy" : "warn"; }
      catch { return "down"; }
    };
    Promise.all(SERVICES.map(s => probeService(s).then(status => [s.name, status])))
      .then(results => setHealthMap(Object.fromEntries(results)));
  }, []);

  useEffect(() => {
    const probeGpu = async (url) => {
      try { const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) }); return r.ok ? await r.json() : null; }
      catch { return null; }
    };
    probeGpu(SENTIMENT_URL).then(d => setGpuStatus(s => ({ ...s, sentiment: d })));
    probeGpu(FINGPT_URL).then(d => setGpuStatus(s => ({ ...s, fingpt: d })));
  }, []);

  const refreshAlerts = useCallback(async () => {
    setAlertsStatus("loading");
    try {
      const [rulesRes, historyRes] = await Promise.all([
        fetch(`${ALERTS_URL}/alerts/rules`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${ALERTS_URL}/alerts/history`, { signal: AbortSignal.timeout(5000) }),
      ]);
      setAlertRules(rulesRes.ok ? await rulesRes.json() : []);
      setAlertHistory(historyRes.ok ? await historyRes.json() : []);
      setAlertsStatus("ready");
    } catch {
      setAlertRules([]);
      setAlertHistory([]);
      setAlertsStatus("error");
    }
  }, []);

  useEffect(() => { refreshAlerts(); }, [refreshAlerts]);

  const setProvider = (key) => { setActiveProvider(key); localStorage.setItem("alphawealth.provider", key); };

  const createAlertRule = async () => {
    const threshold = Number(alertForm.threshold);
    if (!alertForm.name.trim() || !alertForm.target.trim() || !Number.isFinite(threshold)) return;
    setAlertsStatus("saving");
    try {
      const res = await fetch(`${ALERTS_URL}/alerts/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: alertForm.name.trim(),
          type: alertForm.type,
          target: alertForm.target.trim().toUpperCase(),
          threshold,
          enabled: true,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshAlerts();
    } catch {
      setAlertsStatus("error");
    }
  };

  const deleteAlertRule = async (id) => {
    setAlertsStatus("saving");
    try {
      await fetch(`${ALERTS_URL}/alerts/rules/${id}`, { method: "DELETE" });
      await refreshAlerts();
    } catch {
      setAlertsStatus("error");
    }
  };

  const healthyCount = Object.values(healthMap).filter(s => s === "healthy").length;
  const gpuName = gpuStatus.sentiment?.gpu || gpuStatus.fingpt?.gpu;
  const gpuOnDevice = gpuStatus.sentiment?.device === "cuda" || gpuStatus.fingpt?.device === "cuda";

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader title="Settings & Connections" subtitle="LLM provider — service health — GPU status — integrations" />

      {/* User Profile (photo + display name + FIRE target) */}
      <Card className="animate-fade-in">
        <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4 flex items-center gap-2">
          <Icon name="user" size={11} color={T.muted} /> Profile
        </div>
        <div className="flex items-center gap-4 mb-4">
          <AvatarUploader size={64} name={displayNameInput || "Nithish"} />
          <div className="text-xs text-zinc-500">
            <div className="text-ink font-medium text-sm">Profile photo</div>
            Click the avatar to upload a photo (stored locally on this device).
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <div className="text-2xs text-zinc-500 font-mono mb-1">DISPLAY NAME</div>
            <input
              type="text"
              value={displayNameInput}
              onChange={(e) => { setDisplayNameInput(e.target.value); setProfileSaved(false); }}
              placeholder="e.g. Alex"
              className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
            <div className="text-2xs text-zinc-500 mt-1">Used in the dashboard greeting & AI Advisor</div>
          </label>
          <label className="block">
            <div className="text-2xs text-zinc-500 font-mono mb-1">FIRE TARGET ($)</div>
            <input
              type="number"
              min="0"
              step="10000"
              value={fireTargetInput}
              onChange={(e) => { setFireTargetInput(e.target.value); setProfileSaved(false); }}
              className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
            />
            <div className="text-2xs text-zinc-500 mt-1">Net-worth goal driving the dashboard progress bar</div>
          </label>
          <label className="block sm:col-span-2">
            <div className="text-2xs text-zinc-500 font-mono mb-1">API TOKEN</div>
            <input
              type="password"
              autoComplete="off"
              value={apiTokenInput}
              onChange={(e) => { setApiTokenInput(e.target.value); setProfileSaved(false); }}
              placeholder="Leave blank if services run without API_TOKEN"
              className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
            />
            <div className="text-2xs text-zinc-500 mt-1">
              Must match the <code>API_TOKEN</code> env set on the backend services. Sent as a bearer token on every request.
            </div>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={() => {
              setDisplayName(displayNameInput.trim());
              const n = Number(fireTargetInput);
              if (Number.isFinite(n) && n > 0) setFireTarget(n);
              setApiToken(apiTokenInput.trim());
              setProfileSaved(true);
              // Trigger a re-render of pages that read prefs at mount time.
              window.dispatchEvent(new Event("storage"));
            }}
          >
            Save profile
          </Button>
          {profileSaved && <Tag variant="positive" dot>Saved — reload other tabs to see changes</Tag>}
        </div>
      </Card>

      {/* Broker Integrations */}
      <div>
        <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-3">Broker Connections</div>
        <BrokerConnections />
      </div>

      {/* Alerts */}
      <Card className="animate-fade-in">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div className="lg:w-[320px]">
            <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono mb-4 flex items-center gap-2">
              <Icon name="bell" size={11} color={T.muted} /> Alerts
            </div>
            <div className="grid grid-cols-1 gap-3">
              <label className="block">
                <div className="text-2xs text-zinc-500 font-mono mb-1">NAME</div>
                <input
                  value={alertForm.name}
                  onChange={(e) => setAlertForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-2xs text-zinc-500 font-mono mb-1">TYPE</div>
                  <select
                    value={alertForm.type}
                    onChange={(e) => setAlertForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                  >
                    {Object.entries(ALERT_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <div className="text-2xs text-zinc-500 font-mono mb-1">TARGET</div>
                  <input
                    value={alertForm.target}
                    onChange={(e) => setAlertForm(f => ({ ...f, target: e.target.value }))}
                    className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:border-accent"
                  />
                </label>
              </div>
              <label className="block">
                <div className="text-2xs text-zinc-500 font-mono mb-1">THRESHOLD</div>
                <input
                  type="number"
                  value={alertForm.threshold}
                  onChange={(e) => setAlertForm(f => ({ ...f, threshold: e.target.value }))}
                  className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
                />
              </label>
              <div className="flex gap-2">
                <Button onClick={createAlertRule} disabled={alertsStatus === "saving"} className="gap-1.5">
                  <Icon name="plus" size={12} /> Create alert
                </Button>
                <Button variant="secondary" onClick={refreshAlerts} disabled={alertsStatus === "loading"}>
                  Refresh
                </Button>
              </div>
              {alertsStatus === "error" && <Tag variant="negative">alerts-svc unavailable</Tag>}
            </div>
          </div>

          <div className="flex-1 grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div>
              <div className="text-2xs uppercase tracking-wider text-subtle font-medium font-mono mb-2">Rules</div>
              <div className="space-y-2">
                {alertRules.length === 0 && (
                  <div className="text-sm text-muted bg-canvas border border-line rounded-lg p-4">No alert rules yet.</div>
                )}
                {alertRules.map(rule => (
                  <div key={rule.id} className="bg-canvas border border-line rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-sm text-ink">{rule.name}</div>
                        <div className="text-xs text-muted mt-1">
                          {ALERT_TYPE_LABELS[rule.type] || rule.type} · {rule.target} · {fmtMoney(Number(rule.threshold || 0))}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteAlertRule(rule.id)}
                        className="text-xs text-negative hover:text-negative/80 px-2 py-1 rounded-md hover:bg-negative/10"
                      >
                        Delete
                      </button>
                    </div>
                    <div className="mt-2">
                      <Tag variant={rule.enabled ? "positive" : "default"}>{rule.enabled ? "Enabled" : "Disabled"}</Tag>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-2xs uppercase tracking-wider text-subtle font-medium font-mono mb-2">Recent Triggers</div>
              <div className="space-y-2">
                {alertHistory.length === 0 && (
                  <div className="text-sm text-muted bg-canvas border border-line rounded-lg p-4">No triggered alerts yet.</div>
                )}
                {alertHistory.slice(0, 8).map(event => (
                  <div key={event.id} className="bg-canvas border border-line rounded-lg p-3">
                    <div className="text-sm text-ink">{event.message}</div>
                    <div className="flex items-center gap-2 mt-2 text-2xs text-muted font-mono">
                      <span>{event.triggeredAt ? new Date(event.triggeredAt).toLocaleString() : "recent"}</span>
                      <span>{fmtMoney(Number(event.currentValue || 0))}</span>
                      <Tag variant={event.emailSent ? "positive" : "default"}>{event.emailSent ? "Email sent" : "Logged"}</Tag>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* GPU Status */}
      <Card className={cn("animate-fade-in", gpuOnDevice ? "bg-ink text-white border-ink" : "")}>
        <div className="flex justify-between items-center mb-4">
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono flex items-center gap-2">
            <Icon name="cpu" size={11} color={gpuOnDevice ? T.lime : T.muted} /> GPU Status
          </div>
          {gpuOnDevice
            ? <Tag variant="positive" dot>CUDA — ACTIVE</Tag>
            : <Tag variant="warning">CPU MODE</Tag>
          }
        </div>

        {gpuOnDevice ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="text-2xs text-zinc-500 font-mono mb-1">DETECTED</div>
              <div className="font-display text-lg font-bold text-positive">{gpuName || "NVIDIA GPU"}</div>
              <div className="text-xs text-zinc-400 mt-1">
                {gpuStatus.sentiment?.vram_gb ? `${gpuStatus.sentiment.vram_gb} GB VRAM` : "VRAM unknown"}
              </div>
            </div>
            <div>
              <div className="text-2xs text-zinc-500 font-mono mb-1">SENTIMENT-SVC (FINBERT)</div>
              {gpuStatus.sentiment ? (
                <div className="font-mono text-sm font-bold text-accent">
                  {gpuStatus.sentiment.device === "cuda" ? "GPU" : "CPU"}
                  {gpuStatus.sentiment.vram_used_mb !== undefined && (
                    <span className="text-xs text-zinc-400 ml-2">{gpuStatus.sentiment.vram_used_mb} MB</span>
                  )}
                </div>
              ) : <div className="text-xs text-warning">service offline</div>}
            </div>
            <div>
              <div className="text-2xs text-zinc-500 font-mono mb-1">FINGPT-SVC (FORECASTER)</div>
              {gpuStatus.fingpt ? (
                <div className="font-mono text-sm font-bold text-accent">
                  {gpuStatus.fingpt.device === "cuda" ? "GPU" : "CPU"}
                  {!gpuStatus.fingpt.model_loaded && " — idle"}
                </div>
              ) : <div className="text-xs text-warning">service offline</div>}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted leading-relaxed">
            <strong>GPU not detected.</strong> Services running in CPU fallback (slower).
            <div className="mt-3 text-xs space-y-1">
              <div>1. Docker Desktop → Settings → Resources → enable WSL Integration</div>
              <div>2. Install NVIDIA Container Toolkit in WSL2</div>
              <div>3. Verify: <code className="bg-canvas px-1.5 py-0.5 rounded text-2xs">docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi</code></div>
              <div>4. Restart sentiment-svc and fingpt-svc</div>
            </div>
          </div>
        )}
      </Card>

      {/* LLM Provider */}
      <Card className="animate-slide-up" style={{ animationDelay: "100ms" }}>
        <div className="flex flex-col sm:flex-row sm:justify-between gap-3 mb-5">
          <div>
            <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">LLM Provider</div>
            <div className="text-xs text-muted mt-1">Choose which model powers the AI Advisor. Local Ollama is 100% free and private.</div>
          </div>
          {providers?.active && (
            <Tag variant={PROVIDER_META[providers.active]?.variant || "default"}>
              Active: {PROVIDER_META[providers.active]?.name}
            </Tag>
          )}
        </div>

        {!providers && (
          <div className="flex items-center gap-2 text-muted text-sm py-6">
            <Pulse color="accent" /> Loading provider info...
          </div>
        )}

        {providers && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(providers.available).map(([key, info]) => {
              const meta = PROVIDER_META[key];
              const isActive = activeProvider === key;
              const isAvailable = info.configured;
              return (
                <button key={key} disabled={!isAvailable} onClick={() => isAvailable && setProvider(key)}
                  className={cn(
                    "p-4 rounded-xl text-left transition-all border-2 relative",
                    isActive ? "border-ink bg-ink text-white" : "border-line bg-surface hover:border-ink/30",
                    !isAvailable && "opacity-50 cursor-not-allowed"
                  )}>
                  <div className="flex justify-between items-start mb-2.5">
                    <Icon name={meta.icon} size={22} color={isActive ? "#fff" : T.ink} stroke={2.5} />
                    <div className="flex gap-1">
                      {info.free && <Tag variant="positive">FREE</Tag>}
                      {!isAvailable && <Tag variant="warning">NO KEY</Tag>}
                      {isAvailable && !info.free && <Tag variant="default">PAID</Tag>}
                    </div>
                  </div>
                  <div className="font-bold text-sm">{meta.name}</div>
                  <div className="text-xs font-mono mt-1 opacity-70">{info.model}</div>
                  <div className="text-xs mt-1.5 opacity-85">{info.description}</div>
                  {!isAvailable && (
                    <div className="text-2xs font-mono text-warning mt-2">Set {meta.env} in .env</div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {providers && (
          <div className="mt-4 p-3 bg-canvas rounded-lg text-xs text-muted font-mono">
            To switch the default backend, set <strong>LLM_PROVIDER=ollama</strong> in .env and restart ai-advisor-svc.
          </div>
        )}
      </Card>

      {/* Service Health */}
      <Card className="animate-slide-up" style={{ animationDelay: "200ms" }}>
        <div className="flex justify-between items-center mb-5">
          <div className="text-xs uppercase tracking-wider text-subtle font-medium font-mono">
            Service Health — {SERVICES.length} services
          </div>
          <Tag variant={healthyCount === SERVICES.length ? "positive" : "warning"} dot>
            {healthyCount}/{SERVICES.length} healthy
          </Tag>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SERVICES.map(svc => {
            const health = healthMap[svc.name];
            const variant = health === "healthy" ? "positive" : health === "warn" ? "warning" : "negative";
            const label = health === "healthy" ? "ONLINE" : health === "warn" ? "DEGRADED" : health === "down" ? "OFFLINE" : "PROBING";
            return (
              <div key={svc.name} className={cn(
                "p-3.5 bg-canvas rounded-lg border-l-[3px]",
                `border-${variant}`
              )}>
                <div className="flex justify-between mb-1.5">
                  <span className="font-mono text-sm font-bold">{svc.name}</span>
                  <div className="flex gap-1">
                    {svc.type === "ai" && <Tag variant="accent">AI</Tag>}
                    <Tag variant={variant}>:{svc.port}</Tag>
                  </div>
                </div>
                <div className="text-xs text-muted mb-2">{svc.desc}</div>
                <div className="flex items-center gap-1.5">
                  <div className={cn("w-1.5 h-1.5 rounded-full", `bg-${variant}`)} />
                  <span className={cn("text-2xs font-mono font-bold", `text-${variant}`)}>{label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Integrations */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "300ms" }}>
        {[
          { name: "yfinance",            desc: "Free real-time quotes, historicals, news",   status: "live",   variant: "positive", icon: "pulse",     setup: "No setup — works immediately" },
          { name: "FinBERT (local GPU)", desc: "Financial news sentiment, ~10ms/article",     status: "live",   variant: "accent",   icon: "sparkle",   setup: "Auto-downloads on first run (~430MB)" },
          { name: "FinGPT-Forecaster",   desc: "Next-week directional predictions on GPU",    status: "live",   variant: "accent",   icon: "target",    setup: "Auto-downloads on first /forecast (~13GB)" },
          { name: "Ollama (local GPU)",  desc: "Free local LLM (Llama 3.1 8B Q5_K_M)",       status: "live",   variant: "positive", icon: "shield",    setup: "First start pulls ~5.7GB model" },
          { name: "Interactive Brokers", desc: "Client Portal gateway — read-only snapshot sync", status: "config", variant: "warning",  icon: "briefcase", setup: "Start the Client Portal gateway and sign in from Broker Connections" },
          { name: "Teller — Banking",     desc: "Real bank transactions, balances, spending",  status: "config", variant: "warning",  icon: "bank",      setup: "Add TELLER_APP_ID + cert to secrets/teller/" },
          { name: "Claude API",          desc: "Premium AI Advisor (paid)",                  status: "config", variant: "warning",  icon: "sparkle",   setup: "Add ANTHROPIC_API_KEY (or use free Ollama)" },
          { name: "C++ Signal Engine",   desc: "Native indicators — ZMQ pub :5555",          status: "live",   variant: "positive", icon: "cpu",       setup: "Auto-builds in Docker" },
          { name: "Resend",              desc: "Email alerts — 3000/mo free tier",           status: "config", variant: "warning",  icon: "bell",      setup: "Add RESEND_API_KEY (optional)" },
          { name: "Prometheus + Grafana",desc: "Metrics + dashboards :3001",                 status: "live",   variant: "positive", icon: "chart",     setup: "Auto-running" },
        ].map(s => (
          <Card key={s.name}>
            <div className="flex items-start gap-3">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                `bg-${s.variant}/10`)}>
                <Icon name={s.icon} size={18} color={T[s.variant === "positive" ? "lime" : s.variant === "accent" ? "cyan" : "amber"]} stroke={2.5} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-display text-sm font-bold truncate">{s.name}</span>
                  <Tag variant={s.variant}>{s.status}</Tag>
                </div>
                <div className="text-xs text-muted mb-1.5">{s.desc}</div>
                <div className="text-2xs text-muted font-mono">{s.setup}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Architecture */}
      <Card className="bg-ink text-white border-ink animate-slide-up" style={{ animationDelay: "400ms" }}>
        <div className="text-2xs uppercase tracking-wider text-zinc-500 font-medium font-mono mb-4">
          3-Model AI Stack — GPU-Accelerated
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { name: "FinBERT", color: "accent", size: "~0.5GB", desc: "110M params, classification model for headline sentiment. GPU-accelerated: ~10ms/article." },
            { name: "Llama 3.1 8B Q5", color: "positive", size: "~5.7GB", desc: "Free local LLM via Ollama for AI Advisor chat. Full RAG context." },
            { name: "FinGPT-Forecaster", color: "accent", size: "~5GB", desc: "Llama-2 7B + FinGPT LoRA, 4-bit quantized. Next-week directional prediction." },
          ].map(m => (
            <div key={m.name} className="p-4 bg-zinc-900 rounded-xl border border-zinc-800">
              <div className="flex justify-between mb-2">
                <span className={cn("font-display text-sm font-bold", `text-${m.color}`)}>{m.name}</span>
                <Tag variant={m.color}>{m.size}</Tag>
              </div>
              <div className="text-xs text-zinc-400 leading-relaxed">{m.desc}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 bg-zinc-900 rounded-lg text-xs text-zinc-400 font-mono">
          Both LLMs (Llama 3.1 + FinGPT) cannot fit in 8GB simultaneously.
          Ollama auto-swaps when you switch tasks (~5-10s warmup).
        </div>
      </Card>
    </div>
  );
};
