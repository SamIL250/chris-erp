import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Chris ERP",
    template: "%s · Chris ERP",
  },
  description: "ERP + ecommerce for equipment distributors",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/*
          Auth state for SSR + the /api/auth fetch client.
          `shouldHandleCode={false}`: `?code=` links are handled by the proxy
          (proxy.ts) on the server — except password-reset links, which our
          /reset-password page completes manually (the flow needs the new
          password, so nothing may consume the code before we read it).
        */}
        <ConvexAuthNextjsServerProvider shouldHandleCode={false}>
          <ConvexClientProvider>
            {children}
            <Toaster />
          </ConvexClientProvider>
        </ConvexAuthNextjsServerProvider>
      </body>
    </html>
  );
}
