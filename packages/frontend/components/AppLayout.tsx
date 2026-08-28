import { Nav } from "@/components/nav";

export function AppLayout({
    children,
    rightSidebar
}: {
    children: React.ReactNode,
    rightSidebar?: React.ReactNode
}) {
    return (
        <div className="min-h-screen bg-background">
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
