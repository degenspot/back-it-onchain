import { Nav } from "@/components/nav";
import { OfflineBanner } from "@/src/components/OfflineBanner";
import { RpcHealthIndicator } from "@/src/components/RpcHealthIndicator";

export function AppLayout({
    children,
    rightSidebar
}: {
    children: React.ReactNode,
    rightSidebar?: React.ReactNode
}) {
    const rpcEndpoints = [
        process.env.NEXT_PUBLIC_SOROBAN_RPC,
        process.env.NEXT_PUBLIC_SOROBAN_RPC_FALLBACK,
    ].filter((url): url is string => Boolean(url)).map((url, index) => ({ id: index === 0 ? 'primary' : 'fallback', url, network: 'TESTNET' }));

    return (
        <div className="min-h-screen bg-background">
            <OfflineBanner />
            {rpcEndpoints.length > 0 ? <div className="flex justify-end px-4 py-1"><RpcHealthIndicator endpoints={rpcEndpoints} /></div> : null}
            <div className="max-w-7xl mx-auto flex justify-center min-h-screen">
                <Nav />

                <main id="main-content" className="flex-1 max-w-2xl w-full border-x border-border min-h-screen">
                    {children}
                </main>

                {rightSidebar && (
                    <aside className="hidden lg:block sticky top-0 h-screen w-80 p-6 overflow-y-auto">
                        {rightSidebar}
                    </aside>
                )}
            </div>
        </div>
    );
}
