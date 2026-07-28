import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://preflightads.com";
const TITLE = "Preflight — Meta ad policy checker";
const DESCRIPTION =
  "Check ad copy, creatives, and landing pages against Meta advertising policy before you spend a dollar on media. Findings cited to the exact clause, plus a compliant rewrite.";

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
        alt: "Preflight — Meta ad policy checker",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
