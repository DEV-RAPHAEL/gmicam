import { NextRequest, NextResponse } from 'next/server';
import {
  setBroadcaster, getBroadcastId, resetRoom, listActiveRooms,
  putViewerOffer, addViewerCandidate, listViewerOffers,
  putAnswer, addAnswerCandidate, getAnswer,
  removeViewer, pruneViewers,
} from '@/lib/signalStore';

export const dynamic = 'force-dynamic';

// Viewer join records older than this are considered abandoned
const VIEWER_TTL_MS = 3 * 60_000;

// GET /api/signal?list=1                 — list active room IDs
// GET /api/signal?room=cam1              — broadcaster poll: pending viewer offers
// GET /api/signal?room=cam1&viewer=<id>  — viewer poll: answer + broadcaster ICE
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get('list') === '1') {
    const rooms = await listActiveRooms();
    return NextResponse.json({ rooms });
  }

  const room = searchParams.get('room') ?? 'default';
  const broadcastId = await getBroadcastId(room);

  if (searchParams.has('viewer')) {
    const viewerId = searchParams.get('viewer') ?? '';
    const entry = viewerId && broadcastId ? await getAnswer(room, viewerId) : null;
    return NextResponse.json({
      broadcastId,
      answer: entry?.answer ?? null,
      candidates: entry?.candidates ?? [],
    });
  }

  const viewers = broadcastId ? await listViewerOffers(room) : [];
  return NextResponse.json({ broadcastId, viewers });
}

// POST /api/signal?room=cam1 — write a signal message
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const room = searchParams.get('room') ?? 'default';

  const body = await req.json() as {
    type: 'announce' | 'reset' | 'join' | 'ice-viewer' | 'answer' | 'ice-broadcaster' | 'leave';
    viewerId?: string;
    data?: unknown;
  };

  switch (body.type) {
    case 'announce': {
      const { broadcastId } = (body.data ?? {}) as { broadcastId?: string };
      if (!broadcastId) return NextResponse.json({ error: 'broadcastId required' }, { status: 400 });
      await setBroadcaster(room, broadcastId);
      await pruneViewers(room, VIEWER_TTL_MS);
      return NextResponse.json({ ok: true });
    }
    case 'reset':
      await resetRoom(room);
      return NextResponse.json({ ok: true });
  }

  const viewerId = body.viewerId;
  if (!viewerId) return NextResponse.json({ error: 'viewerId required' }, { status: 400 });

  switch (body.type) {
    case 'join':
      await putViewerOffer(room, viewerId, body.data as RTCSessionDescriptionInit);
      break;
    case 'ice-viewer':
      await addViewerCandidate(room, viewerId, body.data as RTCIceCandidateInit);
      break;
    case 'answer':
      await putAnswer(room, viewerId, body.data as RTCSessionDescriptionInit);
      break;
    case 'ice-broadcaster':
      await addAnswerCandidate(room, viewerId, body.data as RTCIceCandidateInit);
      break;
    case 'leave':
      await removeViewer(room, viewerId);
      break;
    default:
      return NextResponse.json({ error: 'unknown type' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
