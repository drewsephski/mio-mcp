import type { Metadata } from "next";
import { getAppwriteHelpers } from "@/lib/appwrite";
import { Geist, Geist_Mono, Manrope } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";
import "./styles/landing.css";
import "./styles/workspace.css";
import "./styles/product.css";
import "./styles/legal.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const displayFont = Manrope({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Mio — A personal assistant you can text", template: "%s · Mio" },
  description: "Text thoughts, reminders, questions, or changes. Mio remembers the rest.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const helpers = getAppwriteHelpers();
  const session = await helpers.readSessionCookie();

  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${displayFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
