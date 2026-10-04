import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared chrome for the (auth) route group — centered card on a muted
 * background with the brand above it.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-secondary flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-[440px]">
        <Link href="/" className="text-primary mb-8 flex items-center justify-center gap-2.5">
          <span className="bg-brand-solid flex size-9 items-center justify-center rounded-lg">
            <span className="text-display-xs font-semibold text-white">C</span>
          </span>
          <span className="text-display-xs font-semibold">Chris ERP</span>
        </Link>
        <div className="border-tertiary bg-primary rounded-2xl border p-6 shadow-xs sm:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
