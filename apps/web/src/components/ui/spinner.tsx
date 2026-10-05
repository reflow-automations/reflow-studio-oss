import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const sizes = { sm: "size-3.5", md: "size-4", lg: "size-6" };

export function Spinner({ className, label = "Loading", size = "md" }: { className?: string; label?: string; size?: keyof typeof sizes }) {
  return (
    <span role="status" aria-label={label} className={cn("inline-flex items-center text-muted", className)}>
      <LoaderCircle className={cn("animate-spin", sizes[size])} aria-hidden />
    </span>
  );
}
