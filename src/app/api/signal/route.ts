import { NextRequest, NextResponse } from 'next/server';
import { readState, writeState, resetState, SignalState } from '@/lib/signalStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await readState();
  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    type: 'offer' | 'answer' | 'ice-broadcaster' | 'ice-viewer' | 'reset';
    data?: RTCSessionDescriptionInit | RTCIceCandidateInit;
  };

  if (body.type === 'reset') {
    await resetState();
    return NextResponse.json({ ok: true });
  }

  const state: SignalState = await readState();

  switch (body.type) {
    case 'offer':
      state.offer = body.data as RTCSessionDescriptionInit;
      state.answer = null;
      state.viewerCandidates = [];
      state.broadcasterCandidates = [];
      break;
    case 'answer':
      state.answer = body.data as RTCSessionDescriptionInit;
      break;
    case 'ice-broadcaster':
      state.broadcasterCandidates.push(body.data as RTCIceCandidateInit);
      break;
    case 'ice-viewer':
      state.viewerCandidates.push(body.data as RTCIceCandidateInit);
      break;
  }

  state.version++;
  await writeState(state);
  return NextResponse.json({ ok: true, version: state.version });
}
