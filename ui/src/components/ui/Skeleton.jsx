import { cn } from "../../lib/cn";

export const Skeleton = ({ className, ...props }) => (
  <div className={cn("skeleton", className)} {...props} />
);

export const SkeletonText = ({ lines = 3, className }) => (
  <div className={cn("space-y-2", className)}>
    {Array.from({ length: lines }, (_, i) => (
      <div
        key={i}
        className="skeleton h-3.5 rounded"
        style={{ width: i === lines - 1 ? "60%" : "100%" }}
      />
    ))}
  </div>
);

export const SkeletonCard = ({ className }) => (
  <div className={cn("bg-surface rounded-xl border border-line p-6 space-y-4", className)}>
    <div className="flex items-center justify-between">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-5 w-16 rounded-md" />
    </div>
    <Skeleton className="h-8 w-32" />
    <Skeleton className="h-20 w-full rounded-lg" />
  </div>
);

export const SkeletonChart = ({ className, height = "h-64" }) => (
  <div className={cn("bg-surface rounded-xl border border-line p-6", className)}>
    <div className="flex items-center justify-between mb-4">
      <Skeleton className="h-3 w-32" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-10 rounded-md" />
        <Skeleton className="h-6 w-10 rounded-md" />
        <Skeleton className="h-6 w-10 rounded-md" />
      </div>
    </div>
    <Skeleton className={cn("w-full rounded-lg", height)} />
  </div>
);

export const SkeletonTable = ({ rows = 5, cols = 4, className }) => (
  <div className={cn("bg-surface rounded-xl border border-line overflow-hidden", className)}>
    <div className="bg-canvas px-6 py-3 flex gap-4">
      {Array.from({ length: cols }, (_, i) => (
        <Skeleton key={i} className="h-3 flex-1" style={{ maxWidth: i === 0 ? 120 : 80 }} />
      ))}
    </div>
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="px-6 py-4 flex gap-4 border-t border-line">
        {Array.from({ length: cols }, (_, j) => (
          <Skeleton key={j} className="h-4 flex-1" style={{ maxWidth: j === 0 ? 120 : 80 }} />
        ))}
      </div>
    ))}
  </div>
);
