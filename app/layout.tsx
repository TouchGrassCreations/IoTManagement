import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";

const bodyFont = DM_Sans({ variable: "--font-body", subsets: ["latin"] });
const displayFont = Space_Grotesk({ variable: "--font-display", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Parts Cabinet — IoT Inventory & Project Planner",
  description: "Catalog your hobby electronics, identify mystery modules, and see which IoT projects you can build next.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Parts Cabinet",
    description: "Know what you have. Build what you imagine.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Parts Cabinet IoT inventory" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Parts Cabinet",
    description: "Know what you have. Build what you imagine.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${bodyFont.variable} ${displayFont.variable}`}>{children}</body></html>;
}
