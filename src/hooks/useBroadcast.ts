'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type BroadcastStatus = 'idle' | 'offering' | 'waiting' | 'connected' | 'error';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

async function signal(type: string, data?: unknown) {
  await fetch('/api/signal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, data }),
  });
}

export function useBroadcast(streamRef: React.RefObject<MediaStream | null>) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [status, setStatus] = useState<BroadcastStatus>('idle');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  const startBroadcast = useCallback(async () => {
    // Read stream from ref at call time — avoids stale closure
    const stream = streamRef.current;
    if (!stream || stream.getTracks().length === 0) {
      console.warn('[Broadcast] No stream available yet');
      return;
    }

    cleanup();
    setStatus('offering');
    await signal('reset');

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) signal('ice-broadcaster', e.candidate.toJSON());
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      console.log('[Broadcast] connection state:', s);
      if (s === 'connected') setStatus('connected');
      if (s === 'disconnected' || s === 'failed') setStatus('waiting');
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await signal('offer', offer);
    setStatus('waiting');

    let knownViewerCandidates = 0;
    let lastVersion = -1;

    const poll = async () => {
      if (!pcRef.current) return;
      try {
        const res = await fetch('/api/signal');
        const state = await res.json() as {
          answer: RTCSessionDescriptionInit | null;
          viewerCandidates: RTCIceCandidateInit[];
          version: number;
        };

        if (state.version !== lastVersion) {
          lastVersion = state.version;

          if (state.answer && pc.remoteDescription === null) {
            await pc.setRemoteDescription(state.answer);
            setStatus('connected');
          }

          const newCandidates = state.viewerCandidates.slice(knownViewerCandidates);
          for (const c of newCandidates) {
            try { await pc.addIceCandidate(c); } catch { /* ignore */ }
          }
          knownViewerCandidates = state.viewerCandidates.length;
        }
      } catch { /* network hiccup */ }

      pollRef.current = setTimeout(poll, 800);
    };

    poll();
  }, [cleanup, streamRef]);

  const stopBroadcast = useCallback(async () => {
    cleanup();
    await signal('reset');
    setStatus('idle');
  }, [cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  return { status, startBroadcast, stopBroadcast };
}
