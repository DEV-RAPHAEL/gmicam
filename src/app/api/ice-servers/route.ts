import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Static fallback — STUN only works when a direct P2P path exists (same network
// or friendly NATs). Cross-network reliability requires the TURN servers below.
const FALLBACK: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// Cache TURN credentials for 5 minutes so every viewer tile doesn't hit the API
let cached: { servers: RTCIceServer[]; at: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function GET() {
  // Env vars take precedence; fallbacks keep this working without Netlify env setup.
  // Note: repo is public — rotate the key at dashboard.metered.ca if quota gets abused.
  const domain = process.env.METERED_DOMAIN ?? 'gmimedia.metered.live';
  const apiKey = process.env.METERED_API_KEY ?? 'a4c4e72fbc9a1f8b5be4d3ac52bf8567ae1c';

  if (!domain || !apiKey) {
    return NextResponse.json({ iceServers: FALLBACK, turn: false });
  }

  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json({ iceServers: cached.servers, turn: true });
  }

  try {
    const res = await fetch(
      `https://${domain}/api/v1/turn/credentials?apiKey=${apiKey}`,
      { cache: 'no-store' }
    );
    if (!res.ok) throw new Error(`Metered API ${res.status}`);
    const servers = (await res.json()) as RTCIceServer[];
    cached = { servers, at: Date.now() };
    return NextResponse.json({ iceServers: servers, turn: true });
  } catch (err) {
    console.error('[ice-servers] TURN credential fetch failed:', err);
    return NextResponse.json({ iceServers: FALLBACK, turn: false });
  }
}
