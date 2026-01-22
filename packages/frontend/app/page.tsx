import Link from "next/link";
import { ArrowRight, TrendingUp, ShieldCheck, Users } from "lucide-react";
import { Logo } from "@/components/logo";
import { WalletConnectButton } from "@/components/WalletConnectButton";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-4">
            <Link
              href="/feed"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Explore
            </Link>
            <WalletConnectButton />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative py-20 md:py-32 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/20 via-background to-background z-0" />

          <div className="container mx-auto px-4 relative z-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/50 border border-border mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
              <span className="text-xs font-medium text-muted-foreground">
                Live on Base Sepolia
              </span>
            </div>

            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
              Put Your Stake <br />
              Where Your Mouth Is
            </h1>

            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              BackIT is the onchain prediction marketplace where reputation is
              earned, not claimed. Make calls, stake tokens, and prove your
              alpha.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/onboarding"
                className="w-full sm:w-auto px-8 py-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-semibold text-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/25"
              >
                Start Backing
                <ArrowRight className="h-5 w-5" />
              </Link>
              <Link
                href="/feed"
                className="w-full sm:w-auto px-8 py-4 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-xl font-semibold text-lg transition-all border border-border"
              >
                View Market
              </Link>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-20 border-t border-border/40 bg-secondary/20">
          <div className="container mx-auto px-4">
            <div className="grid md:grid-cols-3 gap-8">
              <FeatureCard
                icon={<TrendingUp className="h-8 w-8 text-primary" />}
                title="Market Predictions"
                description="Create calls on any asset with specific price targets and timeframes. Your prediction is immutable onchain."
              />
              <FeatureCard
                icon={<ShieldCheck className="h-8 w-8 text-accent" />}
                title="Skin in the Game"
                description="Back your calls with real value. Stakes are locked in smart contracts until the outcome is determined."
              />
              <FeatureCard
                icon={<Users className="h-8 w-8 text-blue-500" />}
                title="Social Consensus"
                description="Join call groups, discuss thesis, and build your reputation score based on successful predictions."
              />
            </div>
          </div>
        </section>
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
