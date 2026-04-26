"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { TrendingUp, ShieldCheck, Users } from "lucide-react";
import { Logo } from "@/components/logo";
import { ChainSelector } from "@/components/ChainSelector";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import MarketTicker from "@/components/MarketTicker";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { TrendingSidebar } from "@/components/TrendingSidebar";

export default function LandingPage() {
  const t = useTranslations("Landing");
  const commonT = useTranslations("Common");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <ChainSelector />
            <Link
              href="/feed"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {commonT("explore")}
            </Link>
            <WalletConnectButton />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative py-20 md:py-32 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--tw-gradient-stops))] from-primary/20 via-background to-background z-0" />

          <div className="container mx-auto px-4 relative z-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/50 border border-border mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
              <span className="text-xs font-medium text-muted-foreground">
                {t("live")}
              </span>
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight mb-4 leading-tight">
              {t("heroTitle")}
            </h1>

            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-6">
              {t("heroSub")}
            </p>

            <div className="mb-8">
              <MarketTicker />
            </div>

            <div className="flex items-center justify-center">
              <div className="w-full sm:w-auto [&>button]:w-full [&>button]:px-8 [&>button]:py-4 [&>button]:rounded-xl [&>button]:font-semibold [&>button]:text-lg [&>button]:shadow-xl [&>button]:transition-transform [&>button]:hover:-translate-y-0.5">
                <WalletConnectButton />
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-20 border-t border-border/40 bg-secondary/20">
          <div className="container mx-auto px-4">
            <div className="grid md:grid-cols-3 gap-8">
              <FeatureCard
                icon={<TrendingUp className="h-8 w-8 text-primary" />}
                title={t("features.create.title")}
                description={t("features.create.description")}
              />
              <FeatureCard
                icon={<ShieldCheck className="h-8 w-8 text-accent" />}
                title={t("features.stake.title")}
                description={t("features.stake.description")}
              />
              <FeatureCard
                icon={<Users className="h-8 w-8 text-blue-500" />}
                title={t("features.earn.title")}
                description={t("features.earn.description")}
              />
            </div>
          </div>
        </section>
        <TrendingSidebar />
      </main>

      <footer className="border-t border-border py-8 bg-card">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <Logo size="default" />
          <p className="text-sm text-muted-foreground">
            © 2025 BackIT Protocol. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 rounded-2xl bg-card border border-border hover:border-primary/50 transition-colors group">
      <div className="mb-4 p-3 rounded-xl bg-secondary w-fit group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>
      <h3 className="text-xl font-bold mb-2">{title}</h3>
      <p className="text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
