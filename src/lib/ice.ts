'use client';

// Fetches ICE servers (STUN + TURN credentials) from our API.
// TURN credentials are short-lived, so re-fetch per connection attempt
// but keep a small client-side cache to avoid hammering the endpoint.

const FALLBACK: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

let cached: { servers: RTCIceServer[]; at: number } | null = null;
const CACHE_MS = 2 * 60 * 1000;

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.servers;
  try {
    const res = await fetch('/api/ice-servers');
    const data = (await res.json()) as { iceServers: RTCIceServer[] };
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      cached = { servers: data.iceServers, at: Date.now() };
      return data.iceServers;
    }
  } catch { /* fall through */ }
  return FALLBACK;
}
