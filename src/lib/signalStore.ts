// Multi-viewer signaling store.
//
// Each room has one broadcaster and any number of viewers. Every viewer joins
// with its own unique viewerId and its own offer, and the broadcaster answers
// each one on a dedicated peer connection. Data is split into single-writer
// records so concurrent viewers never clobber each other:
//   - broadcaster presence  (written only by the broadcaster)
//   - viewer offer + ICE    (written only by that viewer)
//   - answer + ICE          (written only by the broadcaster, per viewer)

export interface BroadcasterInfo {
  broadcastId: string; // fresh UUID per broadcast session — viewers reconnect when it changes
  lastSeen: number;    // epoch ms, bumped by heartbeat
}

export interface ViewerOffer {
  offer: RTCSessionDescriptionInit;
  candidates: RTCIceCandidateInit[];
  ts: number; // epoch ms — for pruning abandoned join attempts
}

export interface ViewerAnswer {
  answer: RTCSessionDescriptionInit;
  candidates: RTCIceCandidateInit[];
}

// Broadcaster heartbeats every 4s; allow slack for throttled background tabs
const LIVE_TTL_MS = 90_000;

// ── Local dev: in-memory ──────────────────────────────────────────────────────
interface MemRoom {
  broadcaster: BroadcasterInfo | null;
  offers: Record<string, ViewerOffer>;
  answers: Record<string, ViewerAnswer>;
}

const g = globalThis as typeof globalThis & { __rooms?: Record<string, MemRoom> };
if (!g.__rooms) g.__rooms = {};

function memRoom(room: string): MemRoom {
  if (!g.__rooms![room]) g.__rooms![room] = { broadcaster: null, offers: {}, answers: {} };
  return g.__rooms![room];
}

const isNetlify = !!process.env.NETLIFY;

async function getBlobStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore('signal');
}

// Blob keys — segments are URI-encoded so ':' stays an unambiguous separator
const enc = encodeURIComponent;
const roomKey = (room: string) => `room:${enc(room)}`;
const offerKey = (room: string, viewerId: string) => `vo:${enc(room)}:${enc(viewerId)}`;
const answerKey = (room: string, viewerId: string) => `va:${enc(room)}:${enc(viewerId)}`;

// Reads on the handshake path (offer/answer/presence) need the freshest value —
// eventual consistency can serve a stale miss right when a viewer/broadcaster
// just wrote, which reads as "not connected yet" and stalls the connection.
// Not every deploy context supports strong reads (it needs an uncachedEdgeURL),
// so fall back to eventual rather than let the whole read fail.
async function blobGet<T>(key: string): Promise<T | null> {
  const store = await getBlobStore();
  try {
    return (await store.get(key, { type: 'json', consistency: 'strong' })) as T | null;
  } catch (err) {
    console.error(`[signalStore] strong-consistency read failed for ${key}, falling back to eventual:`, err);
    return (await store.get(key, { type: 'json' }).catch(() => null)) as T | null;
  }
}

async function blobSet(key: string, value: unknown): Promise<void> {
  const store = await getBlobStore();
  await store.setJSON(key, value);
}

async function blobDelete(key: string): Promise<void> {
  const store = await getBlobStore();
  await store.delete(key).catch(() => {});
}

// ── Broadcaster presence ──────────────────────────────────────────────────────

export async function setBroadcaster(room: string, broadcastId: string): Promise<void> {
  const info: BroadcasterInfo = { broadcastId, lastSeen: Date.now() };
  if (isNetlify) await blobSet(roomKey(room), info);
  else memRoom(room).broadcaster = info;
}

export async function getBroadcastId(room: string): Promise<string | null> {
  const info = isNetlify
    ? await blobGet<BroadcasterInfo>(roomKey(room))
    : memRoom(room).broadcaster;
  if (!info || Date.now() - info.lastSeen > LIVE_TTL_MS) return null;
  return info.broadcastId;
}

// ── Viewer offers (written by each viewer) ────────────────────────────────────

export async function putViewerOffer(room: string, viewerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
  const entry: ViewerOffer = { offer, candidates: [], ts: Date.now() };
  if (isNetlify) {
    await blobDelete(answerKey(room, viewerId));
    await blobSet(offerKey(room, viewerId), entry);
  } else {
    delete memRoom(room).answers[viewerId];
    memRoom(room).offers[viewerId] = entry;
  }
}

export async function addViewerCandidate(room: string, viewerId: string, candidate: RTCIceCandidateInit): Promise<void> {
  if (isNetlify) {
    const entry = await blobGet<ViewerOffer>(offerKey(room, viewerId));
    if (!entry) return; // join hasn't landed (or was pruned) — drop
    entry.candidates.push(candidate);
    entry.ts = Date.now();
    await blobSet(offerKey(room, viewerId), entry);
  } else {
    const entry = memRoom(room).offers[viewerId];
    if (!entry) return;
    entry.candidates.push(candidate);
    entry.ts = Date.now();
  }
}

export async function listViewerOffers(room: string): Promise<{ id: string; offer: RTCSessionDescriptionInit; candidates: RTCIceCandidateInit[] }[]> {
  if (isNetlify) {
    const store = await getBlobStore();
    const prefix = `vo:${enc(room)}:`;
    const { blobs } = await store.list({ prefix });
    const out: { id: string; offer: RTCSessionDescriptionInit; candidates: RTCIceCandidateInit[] }[] = [];
    for (const blob of blobs) {
      const entry = await blobGet<ViewerOffer>(blob.key);
      if (entry?.offer) out.push({ id: decodeURIComponent(blob.key.slice(prefix.length)), offer: entry.offer, candidates: entry.candidates });
    }
    return out;
  }
  return Object.entries(memRoom(room).offers).map(([id, e]) => ({ id, offer: e.offer, candidates: e.candidates }));
}

// ── Answers (written by the broadcaster, one per viewer) ─────────────────────

export async function putAnswer(room: string, viewerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
  const entry: ViewerAnswer = { answer, candidates: [] };
  if (isNetlify) await blobSet(answerKey(room, viewerId), entry);
  else memRoom(room).answers[viewerId] = entry;
}

export async function addAnswerCandidate(room: string, viewerId: string, candidate: RTCIceCandidateInit): Promise<void> {
  if (isNetlify) {
    const entry = await blobGet<ViewerAnswer>(answerKey(room, viewerId));
    if (!entry) return; // answer hasn't landed — drop
    entry.candidates.push(candidate);
    await blobSet(answerKey(room, viewerId), entry);
  } else {
    const entry = memRoom(room).answers[viewerId];
    if (!entry) return;
    entry.candidates.push(candidate);
  }
}

export async function getAnswer(room: string, viewerId: string): Promise<ViewerAnswer | null> {
  if (isNetlify) return blobGet<ViewerAnswer>(answerKey(room, viewerId));
  return memRoom(room).answers[viewerId] ?? null;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

export async function removeViewer(room: string, viewerId: string): Promise<void> {
  if (isNetlify) {
    await blobDelete(offerKey(room, viewerId));
    await blobDelete(answerKey(room, viewerId));
  } else {
    delete memRoom(room).offers[viewerId];
    delete memRoom(room).answers[viewerId];
  }
}

// Drop signaling records for viewers that stopped posting a while ago.
// Established connections are unaffected — WebRTC no longer needs the store.
export async function pruneViewers(room: string, maxAgeMs: number): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  if (isNetlify) {
    const store = await getBlobStore();
    const prefix = `vo:${enc(room)}:`;
    const { blobs } = await store.list({ prefix });
    for (const blob of blobs) {
      const entry = await blobGet<ViewerOffer>(blob.key);
      if (!entry || entry.ts < cutoff) {
        const id = decodeURIComponent(blob.key.slice(prefix.length));
        await removeViewer(room, id);
      }
    }
  } else {
    const mem = memRoom(room);
    for (const [id, e] of Object.entries(mem.offers)) {
      if (e.ts < cutoff) {
        delete mem.offers[id];
        delete mem.answers[id];
      }
    }
  }
}

export async function resetRoom(room: string): Promise<void> {
  if (isNetlify) {
    const store = await getBlobStore();
    await blobDelete(roomKey(room));
    for (const prefix of [`vo:${enc(room)}:`, `va:${enc(room)}:`]) {
      const { blobs } = await store.list({ prefix });
      for (const blob of blobs) await blobDelete(blob.key);
    }
  } else {
    delete g.__rooms![room];
  }
}

// Rooms whose broadcaster heartbeat is still fresh
export async function listActiveRooms(): Promise<string[]> {
  const now = Date.now();
  if (isNetlify) {
    const store = await getBlobStore();
    const prefix = 'room:';
    const { blobs } = await store.list({ prefix });
    const active: string[] = [];
    for (const blob of blobs) {
      const info = await blobGet<BroadcasterInfo>(blob.key);
      if (info && now - info.lastSeen <= LIVE_TTL_MS) active.push(decodeURIComponent(blob.key.slice(prefix.length)));
    }
    return active;
  }
  return Object.entries(g.__rooms!)
    .filter(([, r]) => r.broadcaster && now - r.broadcaster.lastSeen <= LIVE_TTL_MS)
    .map(([k]) => k);
}
