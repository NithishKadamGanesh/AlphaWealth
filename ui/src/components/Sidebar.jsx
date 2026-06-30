import {
  LayoutDashboard, TrendingUp, Briefcase, LineChart, Wallet,
  Zap, Sparkles, Target, Settings as SettingsIcon, Search, Moon, Sun, X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { AvatarUploader } from "./AvatarUploader";
import { getDisplayName, DEFAULTS } from "../lib/userPrefs";

const NAV = [
  { section: "Workspace" },
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { id: "networth",  icon: TrendingUp,      label: "Net Worth" },
  { id: "portfolio", icon: Briefcase,       label: "Portfolio" },
  { id: "markets",   icon: LineChart,       label: "Markets",   live: true },
  { id: "banking",   icon: Wallet,          label: "Banking" },
  { section: "Research" },
  { id: "opportunities", icon: Zap, label: "Opportunities" },
  { section: "Tools" },
  { id: "ai",        icon: Sparkles,        label: "AI Advisor" },
  { id: "fire",      icon: Target,          label: "FIRE" },
  { id: "settings",  icon: SettingsIcon,    label: "Settings" },
];

export const Sidebar = ({ active, onNav, onCommand, mobileOpen, onMobileClose }) => {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined" && document.documentElement.classList.contains("dark"));

  useEffect(() => {
    if (dark) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    localStorage.setItem("aw_theme", dark ? "dark" : "light");
  }, [dark]);

  // Load saved theme
  useEffect(() => {
    const saved = localStorage.getItem("aw_theme");
    if (saved === "dark") setDark(true);
  }, []);

  const dn = getDisplayName();
  const profileName = dn && dn !== DEFAULTS.displayName ? dn : "Nithish";

  return (
    <aside className={cn(
      "fixed inset-y-0 left-0 w-60 bg-canvas border-r border-line flex flex-col z-50",
      "transition-transform duration-300 ease-out",
      "lg:translate-x-0",
      mobileOpen ? "translate-x-0" : "-translate-x-full",
    )}>
      {/* Brand */}
      <div className="px-5 pt-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src="/alphawealth-symbol.png"
            alt="AlphaWealth"
            className="w-9 h-9 rounded-lg object-contain shrink-0"
          />
          <div>
            <div className="text-sm font-semibold tracking-tight text-ink">AlphaWealth</div>
            <div className="text-2xs text-subtle font-mono">command center</div>
          </div>
        </div>
        {/* Mobile close */}
        <button
          onClick={onMobileClose}
          className="lg:hidden p-1 rounded-md text-muted hover:text-ink hover:bg-surface transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Search trigger */}
      {onCommand && (
        <div className="px-3 pb-3">
          <button
            onClick={() => onCommand()}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg",
              "bg-surface border border-line text-muted text-sm",
              "hover:border-subtle/50 transition-colors group",
            )}
          >
            <Search size={14} />
            <span className="flex-1 text-left">Search...</span>
            <kbd className="text-2xs px-1.5 py-0.5 rounded border border-line text-subtle font-mono hidden sm:inline">
              Ctrl+K
            </kbd>
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 overflow-y-auto">
        {NAV.map((item, i) => {
          if (item.section) {
            return (
              <div key={`sec-${i}`} className="px-3 pt-5 pb-2">
                <div className="text-2xs uppercase tracking-wider text-subtle font-medium">
                  {item.section}
                </div>
              </div>
            );
          }
          const isActive = active === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onNav(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm relative",
                "transition-all duration-150",
                isActive
                  ? "text-ink bg-surface font-medium border border-line shadow-subtle"
                  : "text-muted hover:text-ink hover:bg-surface/60 border border-transparent",
              )}
            >
              <Icon size={15} strokeWidth={isActive ? 2.25 : 1.75} />
              <span className="flex-1 text-left">{item.label}</span>
              {item.live && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-positive opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-positive" />
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-line space-y-2">
        <button
          onClick={() => setDark(d => !d)}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted hover:text-ink hover:bg-surface/60 transition-colors"
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
          <span>{dark ? "Light mode" : "Dark mode"}</span>
        </button>

        <div className="flex items-center gap-2.5 px-3 py-2">
          <AvatarUploader size={28} name={profileName} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink truncate">{profileName}</div>
            <div className="text-2xs text-subtle truncate font-mono">nithishkadam@</div>
          </div>
        </div>
      </div>
    </aside>
  );
};
