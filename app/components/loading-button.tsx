import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { DotsRing } from "./ui/dots-ring";

type LoadingButtonProps = ComponentProps<"button"> & { loading: boolean };

export function LoadingButton({ loading, disabled, className, children, ...props }: LoadingButtonProps) {
  return (
    <button {...props} className={cn("loading-button", className)} disabled={disabled || loading} aria-busy={loading}>
      <span className="loading-button-content" style={{ opacity: loading ? 0 : undefined }}>{children}</span>
      {loading && <span className="loading-button-indicator" aria-hidden="true"><DotsRing /></span>}
    </button>
  );
}
