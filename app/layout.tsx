import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChatTube.ai — Chat with any YouTube video",
  description:
    "Paste any YouTube video and chat with it. RAG-powered Q&A, topic timeline, and dynamic visuals.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
