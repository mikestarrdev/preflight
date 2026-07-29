import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const SITE_URL = "https://preflightads.com";
const TITLE = "Preflight | Meta ad policy checker";
const DESCRIPTION =
  "Check ad copy, creatives, and landing pages against Meta advertising policy before you spend a dollar on media. Findings cited to the exact clause, plus a compliant rewrite.";

// Resolves the stored preference to a concrete light/dark value and stamps it
// on <html> before the first paint, so the page never flashes the wrong theme.
// Stays in sync with THEME_STORAGE_KEY in components/ThemeToggle.tsx.
const THEME_SCRIPT = `
(function () {
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var dark = prefersDark;
  try {
    var stored = localStorage.getItem('preflight-theme');
    if (stored === 'dark') dark = true;
    else if (stored === 'light') dark = false;
  } catch (e) {
    // Storage unavailable (private mode, blocked cookies): fall back to the OS.
  }
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "Meta ad policy checker",
    "Facebook ad compliance",
    "Instagram ad compliance",
    "ad policy review",
    "ad copy compliance checker",
    "Meta advertising standards",
    "ad disapproval prevention",
    "ad account ban prevention",
  ],
  authors: [{ name: "Mike Starr" }],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "Preflight",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Preflight | Meta ad policy checker",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edf1f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1118" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${archivo.variable} ${plexMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
