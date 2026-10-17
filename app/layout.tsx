import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sentry · Home safety monitor",
  description: "Local AI fall detection with Nemotron on the GIGABYTE AI TOP ATOM",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-bg font-sans text-text">{children}</body>
    </html>
  );
}
