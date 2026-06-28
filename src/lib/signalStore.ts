export interface RoomState {
  offer: RTCSessionDescriptionInit | null;
  answer: RTCSessionDescriptionInit | null;
  broadcasterCandidates: RTCIceCandidateInit[];
  viewerCandidates: RTCIceCandidateInit[];
  version: number;
  lastSeen: number; // epoch ms — for room expiry
}

function defaultRoom(): RoomState {
  return {
    offer: null,
    answer: null,
    broadcasterCandidates: [],
    viewerCandidates: [],
    version: 0,
    lastSeen: Date.now(),
  };
}

// ── Local dev: in-memory ──────────────────────────────────────────────────────
const g = globalThis as typeof globalThis & { __rooms?: Record<string, RoomState> };
if (!g.__rooms) g.__rooms = {};

const isNetlify = !!process.env.NETLIFY;

async function getBlobStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore('signal');
}

export async function readRoom(room: string): Promise<RoomState> {
  if (isNetlify) {
    const store = await getBlobStore();
    const data = await store.get(room, { type: 'json' }).catch(() => null);
    return (data as RoomState | null) ?? defaultRoom();
  }
  return g.__rooms![room] ?? defaultRoom();
}

export async function writeRoom(room: string, state: RoomState): Promise<void> {
  state.lastSeen = Date.now();
  if (isNetlify) {
    const store = await getBlobStore();
    await store.setJSON(room, state);
  } else {
    g.__rooms![room] = state;
  }
}

export async function deleteRoom(room: string): Promise<void> {
  if (isNetlify) {
    const store = await getBlobStore();
    await store.delete(room).catch(() => {});
  } else {
    delete g.__rooms![room];
  }
}

// Returns rooms with an active offer seen in the last 60 seconds
export async function listActiveRooms(): Promise<string[]> {
  const cutoff = Date.now() - 60_000;
  if (isNetlify) {
    const store = await getBlobStore();
    const { blobs } = await store.list();
    const active: string[] = [];
    for (const blob of blobs) {
      const data = await store.get(blob.key, { type: 'json' }).catch(() => null) as RoomState | null;
      if (data?.offer && data.lastSeen > cutoff) active.push(blob.key);
    }
    return active;
  }
  return Object.entries(g.__rooms!)
    .filter(([, s]) => s.offer && s.lastSeen > cutoff)
    .map(([k]) => k);
}
