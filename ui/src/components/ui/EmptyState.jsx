import { cn } from "../../lib/cn";

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
  className,
}) => (
  <div className={cn("flex flex-col items-center justify-center py-16 px-6 text-center", className)}>
    {Icon && (
      <div className="w-16 h-16 rounded-2xl bg-line/40 flex items-center justify-center mb-5">
        <Icon size={28} className="text-subtle" strokeWidth={1.5} />
      </div>
    )}
    {title && (
      <h3 className="text-base font-medium text-ink mb-1.5">{title}</h3>
    )}
    {description && (
      <p className="text-sm text-muted max-w-xs">{description}</p>
    )}
    {action && <div className="mt-5">{action}</div>}
  </div>
);
