"use client";

import type { ReactNode } from "react";

/** Centered heading used at the top of every auth card. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  return (
    <div className="mb-6 text-center">
      <h1 className="text-display-xs text-primary font-semibold">{title}</h1>
      <p className="text-md text-secondary mt-1">{subtitle}</p>
    </div>
  );
}
