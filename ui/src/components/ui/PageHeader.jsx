import { cn } from "../../lib/cn";

export const PageHeader = ({ title, subtitle, badge, className }) => (
  <div className={cn("flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6 lg:mb-8", className)}>
    <div>
      <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tighter text-ink">
        {title}
      </h1>
      {subtitle && (
        <p className="text-xs sm:text-sm text-muted mt-1.5 max-w-xl">{subtitle}</p>
      )}
    </div>
    {badge && (
      <div className="flex items-center gap-2 flex-wrap">{badge}</div>
    )}
  </div>
);
