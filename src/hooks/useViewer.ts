'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchIceServers } from '@/lib/ice';

export type ViewerStatus = 'waiting' | 'connecting' | 'connected';

async function signal(room: string, type: string, viewerId?: string, data?: unknown) {
  await fetch(`/api/signal?room=${encodeURIComponent(room)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, viewerId, data }),
  });
}

interface Session {
  id: string;          // our unique viewerId — many viewers can watch one room
  broadcastId: string; // which broadcast we joined; reconnect when it changes
  pc: RTCPeerConnection;
  seenCandidates: number;
}

// Watches a room by sending our own recvonly offer under a fresh viewerId,
// then polling for the broadcaster's answer + trickled ICE candidates.
export function useViewer(room: string) {
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ViewerStatus>('waiting');
  const [iceState, setIceState] = useState<string>('');

  const genRef = useRef(0);
  const sessionRef = useRef<Session | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Serialize our signal writes so 'join' always lands before its ICE candidates
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const post = useCallback((type: string, viewerId: string, data?: unknown) => {
    sendQueueRef.current = sendQueueRef.current
      .then(() => signal(room, type, viewerId, data))
      .catch(() => {});
    return sendQueueRef.current;
  }, [room]);

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

  const teardown = useCallback(() => {
    const sess = sessionRef.current;
    if (sess) {
      sess.pc.close();
      post('leave', sess.id);
    }
    sessionRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, [post]);

  const loop = useCallback((gen: number) => {
    clearTimer();

    const run = async () => {
      if (genRef.current !== gen) return;

      try {
        const sess = sessionRef.current;
        const res = await fetch(
          `/api/signal?room=${encodeURIComponent(room)}&viewer=${encodeURIComponent(sess?.id ?? '')}`
        );
        const state = await res.json() as {
          broadcastId: string | null;
          answer: RTCSessionDescriptionInit | null;
          candidates: RTCIceCandidateInit[];
        };

        if (genRef.current !== gen) return;

        if (!state.broadcastId) {
          if (sess) teardown();
          setStatus('waiting');
          timerRef.current = setTimeout(() => loop(gen), 1200);
          return;
        }

        // No session yet, or the broadcaster restarted — join with a fresh viewerId
        if (!sess || sess.broadcastId !== state.broadcastId) {
          teardown();
          setStatus('connecting');

          const id = crypto.randomUUID();
          const iceServers = await fetchIceServers();
          if (genRef.current !== gen) return;

          const pc = new RTCPeerConnection({ iceServers });
          const newSess: Session = { id, broadcastId: state.broadcastId, pc, seenCandidates: 0 };
          sessionRef.current = newSess;

          pc.addTransceiver('video', { direction: 'recvonly' });
          pc.addTransceiver('audio', { direction: 'recvonly' });

          pc.ontrack = (e) => {
            const video = remoteVideoRef.current;
            if (!video) return;
            if (e.streams[0]) { video.srcObject = e.streams[0]; return; }
            // Broadcaster attaches tracks via replaceTrack, so there may be no stream association
            let ms = video.srcObject as MediaStream | null;
            if (!ms) { ms = new MediaStream(); video.srcObject = ms; }
            ms.addTrack(e.track);
          };

          pc.onicecandidate = (e) => {
            if (e.candidate && genRef.current === gen && sessionRef.current === newSess) {
              post('ice-viewer', id, e.candidate.toJSON());
            }
          };

          // Listen to BOTH connectionState AND iceConnectionState
          // Some browsers/networks get ICE connected but connectionState stays 'connecting'
          const markConnected = () => {
            if (genRef.current === gen) setStatus('connected');
          };

          const restart = () => {
            if (genRef.current !== gen || sessionRef.current !== newSess) return;
            teardown();
            setStatus('waiting');
            clearTimer();
            timerRef.current = setTimeout(() => loop(gen), 800);
          };

          pc.onconnectionstatechange = () => {
            if (genRef.current !== gen) return;
            const s = pc.connectionState;
            setIceState(`pc:${s} ice:${pc.iceConnectionState}`);
            if (s === 'connected') markConnected();
            if (s === 'disconnected' || s === 'failed' || s === 'closed') restart();
          };

          pc.oniceconnectionstatechange = () => {
            if (genRef.current !== gen) return;
            const s = pc.iceConnectionState;
            setIceState(`pc:${pc.connectionState} ice:${s}`);
            if (s === 'connected' || s === 'completed') markConnected();
            if (s === 'failed') restart();
          };

          const offer = await pc.createOffer();
          if (genRef.current !== gen || sessionRef.current !== newSess) { pc.close(); return; }
          await pc.setLocalDescription(offer);
          await post('join', id, offer);

          timerRef.current = setTimeout(() => loop(gen), 500);
          return;
        }

        // Existing session — apply the answer once, then trickle new candidates
        const pc = sess.pc;
        if (state.answer && !pc.remoteDescription) {
          await pc.setRemoteDescription(state.answer);
        }
        if (pc.remoteDescription) {
          const fresh = state.candidates.slice(sess.seenCandidates);
          sess.seenCandidates = state.candidates.length;
          for (const c of fresh) { try { await pc.addIceCandidate(c); } catch { /* ok */ } }
        }

        const connected =
          pc.connectionState === 'connected' ||
          pc.iceConnectionState === 'connected' ||
          pc.iceConnectionState === 'completed';
        // Once connected, poll slowly just to notice broadcaster restarts
        timerRef.current = setTimeout(() => loop(gen), connected ? 2000 : 700);

      } catch (err) {
        console.error(`[Viewer:${room}]`, err);
        if (genRef.current === gen) timerRef.current = setTimeout(() => loop(gen), 2000);
      }
    };

    run();
  }, [room, post, teardown]);

  const connect = useCallback(() => {
    const gen = ++genRef.current;
    clearTimer();
    teardown();
    setStatus('waiting');
    loop(gen);
  }, [teardown, loop]);

  const disconnect = useCallback(() => {
    ++genRef.current;
    clearTimer();
    teardown();
    setStatus('waiting');
  }, [teardown]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { status, iceState, remoteVideoRef, connect, disconnect };
}
