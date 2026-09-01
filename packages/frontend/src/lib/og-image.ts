export interface OGMetadata {
  title: string;
  description: string;
  image?: string;
}

export function generateOGMeta(callId: string, title: string, description: string): OGMetadata {
  return {
    title: `${title} | BackIT`,
    description,
    image: `/api/og?callId=${callId}`,
  };
}

export function getShareUrl(callId: string): string {
  if (typeof window === "undefined") return "";
  const base = window.location.origin;
  return `${base}/calls/${callId}`;
}

export function getShareText(title: string, callId: string): string {
  const url = getShareUrl(callId);
  return `Check out this prediction: ${title} — ${url}`;
}
