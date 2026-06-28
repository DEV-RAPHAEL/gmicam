import { NextRequest, NextResponse } from 'next/server';
import { readRoom, writeRoom, deleteRoom, listActiveRooms, RoomState } from '@/lib/signalStore';

export const dynamic = 'force-dynamic';

// GET /api/signal?room=cam1        — state for one room
// GET /api/signal?list=1           — list active room IDs
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get('list') === '1') {
    const rooms = await listActiveRooms();
    return NextResponse.json({ rooms });
  }

  const room = searchParams.get('room') ?? 'default';
  const state = await readRoom(room);
  return NextResponse.json(state);
}

// POST /api/signal?room=cam1       — write a signal message
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const room = searchParams.get('room') ?? 'default';

  const body = await req.json() as {
    type: 'offer' | 'answer' | 'ice-broadcaster' | 'ice-viewer' | 'reset' | 'heartbeat';
    data?: RTCSessionDescriptionInit | RTCIceCandidateInit;
  };

  if (body.type === 'reset') {
    await deleteRoom(room);
    return NextResponse.json({ ok: true });
  }

  const state: RoomState = await readRoom(room);

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
    case 'heartbeat':
      // just bumps lastSeen
      break;
  }

  state.version++;
  await writeRoom(room, state);
  return NextResponse.json({ ok: true, version: state.version });
}
