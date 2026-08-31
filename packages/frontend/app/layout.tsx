import type { Metadata } from 'next';
import "./globals.css";
import { Providers } from "@/components/Providers";
import { I18nProvider } from "@/components/I18nProvider";
import { SkipLink } from "@/components/SkipLink";
import '@coinbase/onchainkit/styles.css';

export const metadata: Metadata = {
  title: "Back It (Onchain)",
  description: "Prediction market on Base",
  manifest: "/manifest.json",
  themeColor: "#8b5cf6",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "BackIt",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <SkipLink />
        <I18nProvider>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
