import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "../components/service-worker-registration";
import "./styles.css";

export const metadata: Metadata = {
  title: "OpenTriage",
  description: "Electronic patient care reporting",
  manifest: "/manifest.webmanifest"
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
