// ui/src/components/CommandPalette.jsx
// Linear/Raycast style command palette — ⌘K to open

import { Command } from "cmdk";
import { useEffect } from "react";
import {
  LayoutDashboard, TrendingUp, Briefcase, LineChart, Wallet,
  Sparkles, Target, Settings as SettingsIcon, Zap, Search,
} from "lucide-react";

const COMMANDS = [
  { group: "Navigate", id: "dashboard", label: "Go to Dashboard", icon: LayoutDashboard },
  { group: "Navigate", id: "networth",  label: "Go to Net Worth", icon: TrendingUp },
  { group: "Navigate", id: "portfolio", label: "Go to Portfolio", icon: Briefcase },
  { group: "Navigate", id: "markets",   label: "Go to Markets",   icon: LineChart },
  { group: "Navigate", id: "banking",   label: "Go to Banking",   icon: Wallet },
  { group: "Navigate", id: "ai",        label: "Open AI Advisor", icon: Sparkles, hint: "Ask anything" },
  { group: "Navigate", id: "fire",      label: "FIRE calculator", icon: Target },
  { group: "Research", id: "opportunities", label: "Find opportunities", icon: Zap },
  { group: "System",   id: "settings",    label: "Settings",          icon: SettingsIcon },
];

export const CommandPalette = ({ open, onOpenChange, onNav }) => {
  // Bind ⌘K / Ctrl+K
  useEffect(() => {
    const down = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(o => !o);
      }
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [onOpenChange]);

  if (!open) return null;

  const groups = COMMANDS.reduce((acc, c) => {
    (acc[c.group] = acc[c.group] || []).push(c); return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-[100] bg-ink/40 backdrop-blur-sm flex items-start justify-center pt-[15vh] animate-fade-in"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-xl mx-4 bg-elevated rounded-xl border border-line shadow-lift overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <Command shouldFilter>
          <div className="flex items-center gap-3 px-4 border-b border-line">
            <Search size={16} className="text-subtle" />
            <Command.Input
              autoFocus
              placeholder="Type a command or search…"
              className="flex-1 h-12 bg-transparent border-0 outline-none text-sm text-ink placeholder:text-subtle"
            />
            <kbd className="text-2xs px-1.5 py-0.5 rounded border border-line text-subtle font-mono">
              ESC
            </kbd>
          </div>
          <Command.List className="max-h-96 overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-subtle">
              No results found.
            </Command.Empty>
            {Object.entries(groups).map(([groupName, items]) => (
              <Command.Group
                key={groupName}
                heading={groupName}
                className="text-2xs uppercase tracking-wider text-subtle font-medium px-2 pt-2 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2"
              >
                {items.map(c => {
                  const Icon = c.icon;
                  return (
                    <Command.Item
                      key={c.id}
                      value={c.label}
                      onSelect={() => { onNav(c.id); onOpenChange(false); }}
                      className="flex items-center gap-3 px-2 py-2 rounded-lg text-sm text-muted cursor-pointer
                        data-[selected=true]:bg-canvas data-[selected=true]:text-ink"
                    >
                      <Icon size={15} className="text-subtle" />
                      <span className="flex-1">{c.label}</span>
                      {c.hint && <span className="text-2xs text-subtle">{c.hint}</span>}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
};
