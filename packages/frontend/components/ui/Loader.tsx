"use client";

export function Loader({ text = "Processing..." }: { text?: string }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div role="status" aria-live="polite" aria-label="Loading" className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-card border border-border shadow-2xl animate-in fade-in zoom-in duration-300">
                <div className="relative" aria-hidden="true">
                    <div className="h-12 w-12 rounded-full border-4 border-primary/30 border-t-primary animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="h-2 w-2 rounded-full bg-primary animate-pulse"></div>
                    </div>
                </div>
                <p className="font-bold text-lg animate-pulse">{text}</p>
            </div>
        </div>
    );
}
