export interface SignalState {
  offer: RTCSessionDescriptionInit | null;
  answer: RTCSessionDescriptionInit | null;
  broadcasterCandidates: RTCIceCandidateInit[];
  viewerCandidates: RTCIceCandidateInit[];
  version: number;
}

function defaultState(): SignalState {
  return {
    offer: null,
    answer: null,
    broadcasterCandidates: [],
    viewerCandidates: [],
    version: 0,
  };
}

// ── Local dev: in-memory store ────────────────────────────────────────────────
const g = globalThis as typeof globalThis & { __signal?: SignalState };
if (!g.__signal) g.__signal = defaultState();

async function getBlobStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore('signal');
}

const isNetlify = !!process.env.NETLIFY;

export async function readState(): Promise<SignalState> {
  if (isNetlify) {
    const store = await getBlobStore();
    const data = await store.get('state', { type: 'json' }).catch(() => null);
    return (data as SignalState | null) ?? defaultState();
  }
  return g.__signal!;
}

export async function writeState(state: SignalState): Promise<void> {
  if (isNetlify) {
    const store = await getBlobStore();
    await store.setJSON('state', state);
  } else {
    g.__signal = state;
  }
}

export async function resetState(): Promise<void> {
  await writeState(defaultState());
}
