'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ViewerStatus = 'idle' | 'waiting' | 'connecting' | 'connected' | 'error';

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

export function useViewer() {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ViewerStatus>('idle');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectingRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    connectingRef.current = false;
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  const connect = useCallback(() => {
    cleanup();
    setStatus('waiting');

    let knownBroadcasterCandidates = 0;
    let lastSeenVersion = -1;

    const tryConnect = async () => {
      try {
        const res = await fetch('/api/signal');
        const state = await res.json() as {
          offer: RTCSessionDescriptionInit | null;
          broadcasterCandidates: RTCIceCandidateInit[];
          version: number;
        };

        console.log('[Viewer] poll — version:', state.version, 'has offer:', !!state.offer);

        if (!state.offer) {
          pollRef.current = setTimeout(tryConnect, 1200);
          return;
        }

        // Avoid re-connecting if we already processed this offer
        if (state.version === lastSeenVersion) {
          pollRef.current = setTimeout(tryConnect, 1200);
          return;
        }
        lastSeenVersion = state.version;

        if (connectingRef.current || pcRef.current) {
          pollRef.current = setTimeout(tryConnect, 1200);
          return;
        }

        connectingRef.current = true;
        setStatus('connecting');

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        pc.ontrack = (e) => {
          console.log('[Viewer] got remote track');
          if (remoteVideoRef.current && e.streams[0]) {
            remoteVideoRef.current.srcObject = e.streams[0];
          }
        };

        pc.onicecandidate = (e) => {
          if (e.candidate) signal('ice-viewer', e.candidate.toJSON());
        };

        pc.onconnectionstatechange = () => {
          const s = pc.connectionState;
          console.log('[Viewer] connection state:', s);
          if (s === 'connected') setStatus('connected');
          if (s === 'disconnected' || s === 'failed') {
            connectingRef.current = false;
            pcRef.current = null;
            setStatus('waiting');
            pollRef.current = setTimeout(tryConnect, 1500);
          }
        };

        await pc.setRemoteDescription(state.offer);

        // Add broadcaster ICE candidates we already know about
        for (const c of state.broadcasterCandidates) {
          try { await pc.addIceCandidate(c); } catch { /* ignore */ }
        }
        knownBroadcasterCandidates = state.broadcasterCandidates.length;

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await signal('answer', answer);
        connectingRef.current = false;

        // Poll for new broadcaster ICE candidates
        const pollIce = async () => {
          if (!pcRef.current) return;
          try {
            const r = await fetch('/api/signal');
            const s = await r.json() as { broadcasterCandidates: RTCIceCandidateInit[]; version: number };
            const newOnes = s.broadcasterCandidates.slice(knownBroadcasterCandidates);
            for (const c of newOnes) {
              try { await pc.addIceCandidate(c); } catch { /* ignore */ }
            }
            knownBroadcasterCandidates = s.broadcasterCandidates.length;
          } catch { /* ignore */ }
          if (pcRef.current) pollRef.current = setTimeout(pollIce, 800);
        };
        pollIce();

      } catch (err) {
        console.error('[Viewer] error:', err);
        connectingRef.current = false;
        pollRef.current = setTimeout(tryConnect, 2000);
      }
    };

    tryConnect();
  }, [cleanup]);

  const disconnect = useCallback(() => {
    cleanup();
    setStatus('idle');
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, [cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  return { status, connect, disconnect, remoteVideoRef };
}
