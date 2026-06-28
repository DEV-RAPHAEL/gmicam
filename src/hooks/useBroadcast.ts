'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type BroadcastStatus = 'idle' | 'offering' | 'waiting' | 'connected' | 'error';

// Public STUN + free TURN via OpenRelay for cross-network connectivity
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

async function signal(room: string, type: string, data?: unknown) {
  await fetch(`/api/signal?room=${encodeURIComponent(room)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, data }),
  });
}

export function useBroadcast(room: string, streamRef: React.RefObject<MediaStream | null>) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [status, setStatus] = useState<BroadcastStatus>('idle');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);

  const cleanup = useCallback(async () => {
    activeRef.current = false;
    if (pollRef.current) clearTimeout(pollRef.current);
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    pcRef.current?.close();
    pcRef.current = null;
    await signal(room, 'reset').catch(() => {});
  }, [room]);

  const start = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream || stream.getTracks().length === 0) return;

    if (pcRef.current) {
      // Already running — don't restart
      return;
    }

    setStatus('offering');
    activeRef.current = true;
    await signal(room, 'reset');

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) signal(room, 'ice-broadcaster', e.candidate.toJSON());
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') setStatus('connected');
      if (s === 'disconnected' || s === 'failed') {
        setStatus('waiting');
        // Viewer dropped — re-offer so they can reconnect
        pcRef.current?.close();
        pcRef.current = null;
        if (activeRef.current) setTimeout(() => start(), 1000);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await signal(room, 'offer', offer);
    setStatus('waiting');

    // Heartbeat keeps room alive in the store
    heartbeatRef.current = setInterval(() => {
      if (activeRef.current) signal(room, 'heartbeat');
    }, 10_000);

    let knownViewerCandidates = 0;
    let lastVersion = -1;

    const poll = async () => {
      if (!pcRef.current || !activeRef.current) return;
      try {
        const res = await fetch(`/api/signal?room=${encodeURIComponent(room)}`);
        const state = await res.json() as {
          answer: RTCSessionDescriptionInit | null;
          viewerCandidates: RTCIceCandidateInit[];
          version: number;
        };

        if (state.version !== lastVersion) {
          lastVersion = state.version;

          if (state.answer && pc.remoteDescription === null) {
            await pc.setRemoteDescription(state.answer);
          }

          const newCandidates = state.viewerCandidates.slice(knownViewerCandidates);
          for (const c of newCandidates) {
            try { await pc.addIceCandidate(c); } catch { /* ignore */ }
          }
          knownViewerCandidates = state.viewerCandidates.length;
        }
      } catch { /* network hiccup */ }

      if (activeRef.current) pollRef.current = setTimeout(poll, 800);
    };

    poll();
  }, [room, streamRef]);

  // Replace the video track in the existing peer connection (no renegotiation)
  const replaceTrack = useCallback(async (newStream: MediaStream) => {
    const pc = pcRef.current;
    if (!pc) return;
    const newTrack = newStream.getVideoTracks()[0];
    if (!newTrack) return;
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (sender) {
      await sender.replaceTrack(newTrack);
    }
  }, []);

  const stop = useCallback(async () => {
    await cleanup();
    setStatus('idle');
  }, [cleanup]);

  useEffect(() => () => { cleanup(); }, [cleanup]);

  return { status, start, stop, replaceTrack };
}
