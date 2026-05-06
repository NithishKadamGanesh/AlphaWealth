import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "../../lib/cn";
import { X } from "lucide-react";

const ToastContext = createContext({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

const variants = {
  default:  "bg-surface border-line text-ink",
  positive: "bg-positive/10 border-positive/30 text-positive",
  negative: "bg-negative/10 border-negative/30 text-negative",
  warning:  "bg-warning/10 border-warning/30 text-warning",
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, variant = "default", duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, variant }]);
    if (duration > 0) {
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
    }
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lift",
              "animate-slide-up text-sm font-medium max-w-sm",
              variants[t.variant],
            )}
          >
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="text-muted hover:text-ink transition-colors flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
