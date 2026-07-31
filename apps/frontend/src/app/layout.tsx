import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";

// Fuentes AUTOALOJADAS, no desde Google Fonts. Dos razones: la CSP declara
// `font-src 'self'` y ninguna petición del producto debe salir a un tercero,
// y así la tipografía no depende de la disponibilidad de un servicio ajeno.
// Ambas familias son OFL 1.1 (ver `src/app/fonts/*-OFL.txt`).

// Archivo: marca y titulares. El wordmark usa ExtraBold (800).
const archivo = localFont({
  src: [
    { path: "./fonts/Archivo-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Archivo-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/Archivo-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/Archivo-Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/Archivo-ExtraBold.ttf", weight: "800", style: "normal" },
  ],
  variable: "--font-archivo",
  display: "swap",
});

// IBM Plex Sans: interfaz y cuerpo.
const plexSans = localFont({
  src: [
    { path: "./fonts/IBMPlexSans-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexSans-Medium.ttf", weight: "500", style: "normal" },
    {
      path: "./fonts/IBMPlexSans-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    { path: "./fonts/IBMPlexSans-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
});

// IBM Plex Mono: cifras, montos e identificadores. Es lo que hace que una
// columna de precios quede alineada en vertical.
const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-Medium.ttf", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "TAKTO",
    template: "%s · TAKTO",
  },
  description: "CRM conversacional multiempresa para vender por WhatsApp.",
  applicationName: "TAKTO",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon-180.png",
  },
  openGraph: {
    type: "website",
    siteName: "TAKTO",
    title: "TAKTO",
    description: "CRM conversacional multiempresa para vender por WhatsApp.",
    images: [{ url: "/og-image-1200x630.png", width: 1200, height: 630 }],
    locale: "es_CO",
  },
  twitter: {
    card: "summary_large_image",
    title: "TAKTO",
    description: "CRM conversacional multiempresa para vender por WhatsApp.",
    images: ["/og-image-1200x630.png"],
  },
  // Herramienta interna: no debe aparecer en buscadores.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Navy de marca: tiñe la barra del navegador en móvil y la pantalla de
  // arranque cuando se instala como aplicación.
  themeColor: "#131C4A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
