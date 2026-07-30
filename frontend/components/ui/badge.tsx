import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium font-mono tracking-wide",
  {
    variants: {
      variant: {
        default: "bg-surface-hover text-muted border border-border",
        primary: "bg-primary/15 text-primary border border-primary/30",
        accent: "bg-accent/15 text-accent border border-accent/30",
        // Confidence levels shown on source cards / answer footers.
        high: "bg-success/15 text-success border border-success/30",
        medium: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
        low: "bg-red-500/15 text-red-400 border border-red-500/30",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
