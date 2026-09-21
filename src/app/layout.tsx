import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Late Game Academy | Fortnite Coaching",
  description:
    "Personalized Fortnite coaching from Late Game Academy, Unreal ranked tournament player. A live 30 minute Discord call each week, then personal advice and a training routine to work between calls. First call free.",
  manifest: "/manifest.json",
  applicationName: "Late Game Academy",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Late Game Academy",
  },
  icons: {
    icon: [
      {
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230B1538'/%3E%3Ctext x='16' y='22' font-family='Arial Black, sans-serif' font-size='18' font-weight='900' fill='%23C7FF3D' text-anchor='middle'%3EK%3C/text%3E%3C/svg%3E",
      },
    ],
    // iOS "Add to Home Screen" only honors apple-touch-icon (manifest
    // icons are ignored). Rasterized from public/icons/icon.svg via
    // sharp; re-run that one-off script if the brand mark ever changes.
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#0B1538",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
