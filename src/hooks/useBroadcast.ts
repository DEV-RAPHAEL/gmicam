'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type BroadcastStatus = 'idle' | 'offering' | 'waiting' | 'connected' | 'error';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

async function signal(room: string, type: string, data?: unknown) {
  await fetch(`/api/signal?room=${encodeURIComponent(room)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, data }),
  });
}

export function useBroadcast(room: string, streamRef: React.RefObject<MediaStream | null>) {
  const [status, setStatus] = useState<BroadcastStatus>('idle');
  const genRef = useRef(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
  };

  const offer = useCallback(async (gen: number) => {
    if (genRef.current !== gen) return;

    const stream = streamRef.current;
    if (!stream || stream.getTracks().length === 0) {
      // Stream not ready yet — retry shortly
      timerRef.current = setTimeout(() => offer(gen), 500);
      return;
    }

    setStatus('offering');
    await signal(room, 'reset');
    if (genRef.current !== gen) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate && genRef.current === gen) {
        signal(room, 'ice-broadcaster', e.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      if (genRef.current !== gen) return;
      const s = pc.connectionState;
      if (s === 'connected') setStatus('connected');
      if (s === 'disconnected' || s === 'failed' || s === 'closed') {
        // Clean up and re-offer automatically — viewer can reconnect at any time
        pc.close();
        if (pcRef.current === pc) pcRef.current = null;
        clearTimers();
        setStatus('waiting');
        timerRef.current = setTimeout(() => offer(gen), 800);
      }
    };

    const sdpOffer = await pc.createOffer();
    if (genRef.current !== gen) { pc.close(); return; }
    await pc.setLocalDescription(sdpOffer);
    await signal(room, 'offer', sdpOffer);
    setStatus('waiting');

    // Heartbeat keeps room alive
    heartbeatRef.current = setInterval(() => {
      if (genRef.current === gen) signal(room, 'heartbeat');
    }, 10_000);

    let knownViewerCandidates = 0;
    let lastVersion = -1;

    const poll = async () => {
      if (genRef.current !== gen || !pcRef.current) return;
      try {
        const res = await fetch(`/api/signal?room=${encodeURIComponent(room)}`);
        const state = await res.json() as {
          answer: RTCSessionDescriptionInit | null;
          viewerCandidates: RTCIceCandidateInit[];
          version: number;
        };

        if (genRef.current !== gen) return;

        if (state.version !== lastVersion) {
          lastVersion = state.version;
          if (state.answer && pc.remoteDescription === null) {
            await pc.setRemoteDescription(state.answer);
          }
          const newOnes = state.viewerCandidates.slice(knownViewerCandidates);
          for (const c of newOnes) { try { await pc.addIceCandidate(c); } catch { /* ok */ } }
          knownViewerCandidates = state.viewerCandidates.length;
        }
      } catch { /* ok */ }
      if (genRef.current === gen) timerRef.current = setTimeout(poll, 800);
    };

    poll();
  }, [room, streamRef]);

  const start = useCallback(() => {
    const gen = ++genRef.current;
    clearTimers();
    pcRef.current?.close();
    pcRef.current = null;
    offer(gen);
  }, [offer]);

  const stop = useCallback(async () => {
    ++genRef.current;
    clearTimers();
    pcRef.current?.close();
    pcRef.current = null;
    await signal(room, 'reset').catch(() => {});
    setStatus('idle');
  }, [room]);

  // Replace video track without renegotiating
  const replaceTrack = useCallback(async (newStream: MediaStream) => {
    const pc = pcRef.current;
    if (!pc) return;
    const track = newStream.getVideoTracks()[0];
    if (!track) return;
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(track);
  }, []);

  useEffect(() => () => { stop(); }, [stop]);

  return { status, start, stop, replaceTrack };
}
