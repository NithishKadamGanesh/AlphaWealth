import { useState, useEffect, createContext, useContext, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { TickerTape } from "./components/TickerTape";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider, useToast } from "./components/ui/Toast";
import { Dashboard } from "./pages/Dashboard";
import { NetWorth } from "./pages/NetWorth";
import { Portfolio } from "./pages/Portfolio";
import { Markets } from "./pages/Markets";
import { Banking } from "./pages/Banking";
import { AIAdvisor } from "./pages/AIAdvisor";
import { FIRE } from "./pages/FIRE";
import { Settings } from "./pages/Settings";
import { Opportunities } from "./pages/Opportunities";
import { useLiveQuotes } from "./hooks/useLiveQuotes";

export const NavContext = createContext({ page: "dashboard", setPage: () => {} });

function AppShell() {
  const [page, setPage] = useState("dashboard");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { quotes, dataMode, isLive, lastError, lastUpdate } = useLiveQuotes();

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Close mobile sidebar on navigation
  const navigate = useCallback((p) => {
    setPage(p);
    setSidebarOpen(false);
  }, []);

  const pages = {
    dashboard:   <Dashboard onNav={navigate} quotes={quotes} isLive={isLive} dataMode={dataMode} />,
    networth:    <NetWorth />,
    portfolio:   <Portfolio />,
    markets:     <Markets quotes={quotes} dataMode={dataMode} />,
    banking:     <Banking />,
    ai:          <AIAdvisor />,
    fire:        <FIRE />,
    settings:    <Settings />,
    opportunities: <Opportunities onNav={navigate} />,
  };

  return (
    <NavContext.Provider value={{ page, setPage: navigate }}>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-40 lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        active={page}
        onNav={navigate}
        onCommand={() => setPaletteOpen(true)}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />

      <div className="lg:ml-60 min-h-screen flex flex-col transition-[margin] duration-300">
        <TickerTape
          quotes={quotes}
          dataMode={dataMode}
          isLive={isLive}
          lastError={lastError}
          lastUpdate={lastUpdate}
          onMenuToggle={() => setSidebarOpen(o => !o)}
        />
        <main className="flex-1 px-4 sm:px-6 lg:px-9 py-6 lg:py-8 pb-12">
          {/* Page-level error boundary: keyed by page so the boundary resets
              when the user navigates away from a broken page. */}
          <ErrorBoundary key={page}>
            <div className="animate-fade-in">
              {pages[page]}
            </div>
          </ErrorBoundary>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNav={navigate}
      />
    </NavContext.Provider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </ErrorBoundary>
  );
}
