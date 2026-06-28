'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ViewerStatus = 'waiting' | 'connecting' | 'connected';

const ICE_SERVERS: RTCIceServer[] = [
  // Multiple STUN providers for redundancy
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
  // TURN — openrelay (free, best-effort)
  { urls: 'turn:openrelay.metered.ca:80',            username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',           username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

async function signal(room: string, type: string, data?: unknown) {
  await fetch(`/api/signal?room=${encodeURIComponent(room)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, data }),
  });
}

export function useViewer(room: string) {
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ViewerStatus>('waiting');
  const [iceState, setIceState] = useState<string>('');

  const genRef = useRef(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOfferSdpRef = useRef<string>('');

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

  const closePC = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  const loop = useCallback((gen: number) => {
    clearTimer();

    const run = async () => {
      if (genRef.current !== gen) return;

      try {
        const res = await fetch(`/api/signal?room=${encodeURIComponent(room)}`);
        const state = await res.json() as {
          offer: RTCSessionDescriptionInit | null;
          broadcasterCandidates: RTCIceCandidateInit[];
        };

        if (genRef.current !== gen) return;

        if (!state.offer) {
          setStatus('waiting');
          closePC();
          lastOfferSdpRef.current = '';
          timerRef.current = setTimeout(() => loop(gen), 1200);
          return;
        }

        const offerSdp = state.offer.sdp ?? '';

        // Already connected to this exact offer — just keep polling for new ICE
        if (pcRef.current && offerSdp === lastOfferSdpRef.current &&
          (pcRef.current.connectionState === 'connected' || pcRef.current.iceConnectionState === 'connected' || pcRef.current.iceConnectionState === 'completed')) {
          timerRef.current = setTimeout(() => loop(gen), 1000);
          return;
        }

        // New offer — (re)connect
        closePC();
        lastOfferSdpRef.current = offerSdp;
        setStatus('connecting');

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        pc.ontrack = (e) => {
          if (remoteVideoRef.current && e.streams[0]) {
            remoteVideoRef.current.srcObject = e.streams[0];
          }
        };

        pc.onicecandidate = (e) => {
          if (e.candidate && genRef.current === gen) {
            signal(room, 'ice-viewer', e.candidate.toJSON());
          }
        };

        // Listen to BOTH connectionState AND iceConnectionState
        // Some browsers/networks get ICE connected but connectionState stays 'connecting'
        const markConnected = () => {
          if (genRef.current === gen) setStatus('connected');
        };

        pc.onconnectionstatechange = () => {
          if (genRef.current !== gen) return;
          const s = pc.connectionState;
          setIceState(`pc:${s} ice:${pc.iceConnectionState}`);
          if (s === 'connected') markConnected();
          if (s === 'disconnected' || s === 'failed' || s === 'closed') {
            pcRef.current?.close();
            pcRef.current = null;
            lastOfferSdpRef.current = '';
            setStatus('waiting');
            loop(gen);
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (genRef.current !== gen) return;
          const s = pc.iceConnectionState;
          setIceState(`pc:${pc.connectionState} ice:${s}`);
          if (s === 'connected' || s === 'completed') markConnected();
          if (s === 'failed') {
            // ICE failed — try restarting
            pcRef.current?.close();
            pcRef.current = null;
            lastOfferSdpRef.current = '';
            setStatus('waiting');
            timerRef.current = setTimeout(() => loop(gen), 1000);
          }
        };

        await pc.setRemoteDescription(state.offer);

        let knownCandidates = state.broadcasterCandidates.length;
        for (const c of state.broadcasterCandidates) {
          try { await pc.addIceCandidate(c); } catch { /* ok */ }
        }

        const answer = await pc.createAnswer();
        if (genRef.current !== gen) { pc.close(); return; }
        await pc.setLocalDescription(answer);
        await signal(room, 'answer', answer);

        // Poll for new broadcaster ICE candidates
        const pollICE = async () => {
          if (genRef.current !== gen || !pcRef.current) return;
          try {
            const r = await fetch(`/api/signal?room=${encodeURIComponent(room)}`);
            const s = await r.json() as { broadcasterCandidates: RTCIceCandidateInit[]; offer: RTCSessionDescriptionInit | null };
            if (!s.offer || (s.offer.sdp ?? '') !== lastOfferSdpRef.current) {
              lastOfferSdpRef.current = '';
              timerRef.current = setTimeout(() => loop(gen), 300);
              return;
            }
            const newOnes = s.broadcasterCandidates.slice(knownCandidates);
            for (const c of newOnes) { try { await pc.addIceCandidate(c); } catch { /* ok */ } }
            knownCandidates = s.broadcasterCandidates.length;
          } catch { /* ok */ }
          if (genRef.current === gen) timerRef.current = setTimeout(pollICE, 600);
        };
        pollICE();

      } catch (err) {
        console.error(`[Viewer:${room}]`, err);
        if (genRef.current === gen) timerRef.current = setTimeout(() => loop(gen), 2000);
      }
    };

    run();
  }, [room, closePC]);

  const connect = useCallback(() => {
    const gen = ++genRef.current;
    closePC();
    lastOfferSdpRef.current = '';
    setStatus('waiting');
    loop(gen);
  }, [closePC, loop]);

  const disconnect = useCallback(() => {
    ++genRef.current;
    clearTimer();
    closePC();
    lastOfferSdpRef.current = '';
    setStatus('waiting');
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, [closePC]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { status, iceState, remoteVideoRef, connect, disconnect };
}
