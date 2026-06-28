'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ViewerStatus = 'waiting' | 'connecting' | 'connected' | 'error';

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

export function useViewer(room: string) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ViewerStatus>('waiting');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectingRef = useRef(false);
  const activeRef = useRef(true);
  const lastOfferRef = useRef<string>('');

  const cleanup = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    connectingRef.current = false;
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  const connect = useCallback(() => {
    cleanup();
    activeRef.current = true;
    setStatus('waiting');
    lastOfferRef.current = '';

    let knownBroadcasterCandidates = 0;

    const tryConnect = async () => {
      if (!activeRef.current) return;
      try {
        const res = await fetch(`/api/signal?room=${encodeURIComponent(room)}`);
        const state = await res.json() as {
          offer: RTCSessionDescriptionInit | null;
          broadcasterCandidates: RTCIceCandidateInit[];
          version: number;
        };

        if (!state.offer) {
          pollRef.current = setTimeout(tryConnect, 1200);
          return;
        }

        // Fingerprint the offer to detect when broadcaster restarts
        const offerKey = JSON.stringify(state.offer).slice(0, 80);
        if (offerKey === lastOfferRef.current && pcRef.current) {
          // Same offer, we're already connected — poll for ICE only
          const newCandidates = state.broadcasterCandidates.slice(knownBroadcasterCandidates);
          for (const c of newCandidates) {
            try { await pcRef.current.addIceCandidate(c); } catch { /* ignore */ }
          }
          knownBroadcasterCandidates = state.broadcasterCandidates.length;
          pollRef.current = setTimeout(tryConnect, 1000);
          return;
        }

        if (connectingRef.current) {
          pollRef.current = setTimeout(tryConnect, 1200);
          return;
        }

        // New offer — (re)connect
        pcRef.current?.close();
        pcRef.current = null;
        connectingRef.current = true;
        lastOfferRef.current = offerKey;
        knownBroadcasterCandidates = 0;
        setStatus('connecting');

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        pc.ontrack = (e) => {
          if (remoteVideoRef.current && e.streams[0]) {
            remoteVideoRef.current.srcObject = e.streams[0];
          }
        };

        pc.onicecandidate = (e) => {
          if (e.candidate) signal(room, 'ice-viewer', e.candidate.toJSON());
        };

        pc.onconnectionstatechange = () => {
          const s = pc.connectionState;
          if (s === 'connected') { setStatus('connected'); connectingRef.current = false; }
          if (s === 'disconnected' || s === 'failed') {
            connectingRef.current = false;
            setStatus('waiting');
            if (activeRef.current) pollRef.current = setTimeout(tryConnect, 1500);
          }
        };

        await pc.setRemoteDescription(state.offer);

        for (const c of state.broadcasterCandidates) {
          try { await pc.addIceCandidate(c); } catch { /* ignore */ }
        }
        knownBroadcasterCandidates = state.broadcasterCandidates.length;

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await signal(room, 'answer', answer);
        connectingRef.current = false;

      } catch (err) {
        console.error(`[Viewer:${room}]`, err);
        connectingRef.current = false;
        if (activeRef.current) pollRef.current = setTimeout(tryConnect, 2000);
      }

      if (activeRef.current && pollRef.current === null) {
        pollRef.current = setTimeout(tryConnect, 1000);
      }
    };

    tryConnect();
  }, [cleanup, room]);

  const disconnect = useCallback(() => {
    activeRef.current = false;
    cleanup();
    setStatus('waiting');
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, [cleanup]);

  useEffect(() => {
    connect();
    return () => { activeRef.current = false; cleanup(); };
  }, [connect, cleanup]);

  return { status, remoteVideoRef, connect, disconnect };
}
