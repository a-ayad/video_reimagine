import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "video_reimagine — re-imagine your video's colors",
  description: "Apply curated film looks or AI-generated color grades to your videos.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body
        className="min-h-full bg-zinc-950 text-zinc-100 antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
