import type { Metadata } from "next";
import {
  JetBrains_Mono,
  Noto_Sans_Thai,
  Plus_Jakarta_Sans,
} from "next/font/google";
import { AppPreferencesProvider } from "@/components/AppPreferencesProvider";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai"],
  variable: "--font-noto-thai",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('examq_theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}var l=localStorage.getItem('examq_locale');if(l==='th'||l==='en'){document.documentElement.lang=l;}}catch(e){}})();`;

export const metadata: Metadata = {
  title: "ExamQ · Bathroom Queue",
  description: "Minimal live exam bathroom queue coordination.",
  authors: [{ name: "Piyakawin Sodsoon", url: "https://github.com/Enksodsoon" }],
  creator: "Piyakawin Sodsoon",
  appleWebApp: {
    capable: true,
    title: "ExamQ",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`h-full antialiased ${plusJakarta.variable} ${notoSansThai.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-[#F6F8FA] font-sans text-slate-900 transition-colors selection:bg-emerald-200/60 dark:bg-[#0B1120] dark:text-slate-100 dark:selection:bg-emerald-500/30">
        <AppPreferencesProvider>{children}</AppPreferencesProvider>
      </body>
    </html>
  );
}
