import { cn } from "../../lib/cn";
import { isValidElement } from "react";

export const EmptyState = ({
  icon,
  title,
  description,
  action,
  className,
}) => {
  const Icon = icon;

  return (
    <div className={cn("flex flex-col items-center justify-center py-16 px-6 text-center", className)}>
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-line/40 flex items-center justify-center mb-5">
          {isValidElement(Icon) ? Icon : <Icon size={28} className="text-subtle" strokeWidth={1.5} />}
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
};
