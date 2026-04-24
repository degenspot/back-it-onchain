import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatJoinedDate(
    date?: string | Date | null,
    locale: string = "en-US",
): string | null {
    if (!date) return null;
    const parsed = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsed.getTime())) return null;
    const formatted = new Intl.DateTimeFormat(locale, {
        month: "short",
        year: "numeric",
    }).format(parsed);
    return `Joined ${formatted}`;
}
