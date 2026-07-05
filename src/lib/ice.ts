'use client';

// Fetches ICE servers (STUN + TURN credentials) from our API.
// TURN credentials are short-lived, so re-fetch per connection attempt
// but keep a small client-side cache to avoid hammering the endpoint.

export interface IceServersResult {
  servers: RTCIceServer[];
  turn: boolean;
  reason?: string; // why TURN wasn't obtained, e.g. "Metered API 401: ..."
}

const FALLBACK: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

let cached: (IceServersResult & { at: number }) | null = null;
const CACHE_MS = 2 * 60 * 1000;

export async function fetchIceServersInfo(): Promise<IceServersResult> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  try {
    const res = await fetch('/api/ice-servers');
    const data = (await res.json()) as { iceServers: RTCIceServer[]; turn: boolean; reason?: string };
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      const result = { servers: data.iceServers, turn: data.turn, reason: data.reason };
      cached = { ...result, at: Date.now() };
      return result;
    }
  } catch { /* fall through */ }
  return { servers: FALLBACK, turn: false, reason: 'ice-servers request failed' };
}

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  return (await fetchIceServersInfo()).servers;
}
