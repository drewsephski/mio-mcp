import type { Metadata } from "next";
import { getAppwriteHelpers } from "@/lib/appwrite";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";
import "./styles/landing.css";
import "./styles/workspace.css";
import "./styles/product.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div hidden dangerouslySetInnerHTML={{ __html: "<!-- user-pinned-blue-code | THESIS: private notes and context together. OWN-WORLD: crisp white, compact layouts, blue accents, Geist. STORY: understand, sign up, write, attach. FIRST VIEWPORT: editorial copy beside a labeled example workspace; three-column dashboard. FORM: user-pinned, code-first. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance -->" }} />
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
