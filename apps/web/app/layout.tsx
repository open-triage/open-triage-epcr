import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "../components/service-worker-registration";
import "./styles.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";

export const metadata: Metadata = {
  title: "OpenTriage synthetic encounter",
  description: "Synthetic-data-only ePCR usability prototype — not for clinical use",
  manifest: `${basePath}/manifest.webmanifest`
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#123b52" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
