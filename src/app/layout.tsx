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
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230B1538'/%3E%3Ctext x='15.6' y='22' font-family='Arial Black, sans-serif' font-size='18' font-weight='900' fill='%23C7FF3D' text-anchor='middle'%3EL%3C/text%3E%3C/svg%3E",
      },
    ],
    // 🔴 iOS "Add to Home Screen" ONLY honors apple-touch-icon. The manifest
    // icons are ignored outright there, and ours are SVG, which iOS does not
    // accept for this purpose at all. So this PNG is the iPhone home screen
    // icon and nothing else is.
    //
    // ⚠️ It is a RASTER COPY of public/icons/icon.svg and does not track it.
    // The Late Game Academy rename changed the two SVGs and missed this, so the
    // installed app kept a K while every other surface said L. Re-rasterize
    // whenever the brand mark changes: render icon.svg in headless Chrome at
    // 512, then downsample to 180. Rasterize in a BROWSER rather than with
    // sharp, because the glyph offset inside icon.svg was measured from a
    // browser render and a different rasterizer picks a different font and
    // moves it.
    //
    // ⚠️ iOS caches this at install time. An already installed app keeps the
    // old icon until it is removed from the home screen and added again.
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
