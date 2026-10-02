import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PRODUCT } from "@/lib/product-copy";

const beVN = Be_Vietnam_Pro({
  subsets: ["vietnamese", "latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-vietnam",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "VietScope — Tìm kiếm & trả lời AI cho Việt Nam",
    template: "%s · VietScope",
  },
  description: PRODUCT.description,
  applicationName: PRODUCT.name,
  keywords: ["tìm kiếm", "AI", "Việt Nam", "Search & Answer Engine", "vietscope-1"],
  icons: { icon: "/icon.svg" },
  openGraph: { title: PRODUCT.headline, description: PRODUCT.description, siteName: PRODUCT.name, locale: "vi_VN", type: "website" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={beVN.variable}>
      <body className="min-h-dvh bg-ink font-sans text-paper antialiased">
        <a href="#main-content" className="fixed left-4 top-4 z-[100] -translate-y-32 rounded-xl bg-gold px-4 py-3 text-sm font-medium text-ink focus:translate-y-0">Bỏ qua điều hướng</a>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
