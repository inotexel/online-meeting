import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type CollapsibleBadgeVariant = "default" | "success" | "warning" | "muted";

interface CollapsibleCardProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  badge?: string;
  badgeVariant?: CollapsibleBadgeVariant;
  defaultOpen?: boolean;
  disabled?: boolean;
  highlight?: boolean;
  children: ReactNode;
  className?: string;
}

const badgeStyles: Record<CollapsibleBadgeVariant, string> = {
  default: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-700",
  warning: "bg-amber-500/10 text-amber-800",
  muted: "bg-muted text-muted-foreground",
};

export function CollapsibleCard({
  title,
  subtitle,
  icon: Icon,
  badge,
  badgeVariant = "muted",
  defaultOpen = false,
  disabled = false,
  highlight = false,
  children,
  className,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-sm transition-colors",
        highlight ? "border-primary/30 ring-1 ring-primary/10" : "border-border/60",
        className
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
          "hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
        )}
      >
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            highlight ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            {badge && (
              <span
                className={cn(
                  "truncate rounded-full px-2 py-0.5 text-[10px] font-medium",
                  badgeStyles[badgeVariant]
                )}
              >
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
              {subtitle}
            </p>
          )}
        </div>

        <ChevronDownIcon
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="border-t border-border/50 bg-muted/15 px-3 py-3">
          {children}
        </div>
      )}
    </div>
  );
}
