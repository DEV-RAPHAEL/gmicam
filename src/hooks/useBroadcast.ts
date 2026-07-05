'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchIceServers } from '@/lib/ice';

export type BroadcastStatus = 'idle' | 'offering' | 'waiting' | 'connected' | 'error';

async function signal(room: string, type: string, viewerId?: string, data?: unknown) {
  await fetch(`/api/signal?room=${encodeURIComponent(room)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, viewerId, data }),
  });
}

interface PeerEntry {
  pc: RTCPeerConnection | null;
  seenCandidates: number;
  ready: boolean; // answer posted — safe to trickle further candidates
}

// Broadcasts the camera stream to any number of viewers. Each viewer joins the
// room with its own offer; we answer each on a dedicated RTCPeerConnection.
export function useBroadcast(room: string, streamRef: React.RefObject<MediaStream | null>) {
  const [status, setStatus] = useState<BroadcastStatus>('idle');
  const genRef = useRef(0);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Serialize our signal writes so 'answer' always lands before its ICE candidates
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const post = useCallback((type: string, viewerId?: string, data?: unknown) => {
    sendQueueRef.current = sendQueueRef.current
      .then(() => signal(room, type, viewerId, data))
      .catch(() => {});
    return sendQueueRef.current;
  }, [room]);

  const clearTimers = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
  };

  const closeAllPeers = useCallback(() => {
    peersRef.current.forEach((e) => e.pc?.close());
    peersRef.current.clear();
  }, []);

  const updateStatus = useCallback((gen: number) => {
    if (genRef.current !== gen) return;
    const anyConnected = [...peersRef.current.values()].some((e) => e.pc?.connectionState === 'connected');
    setStatus(anyConnected ? 'connected' : 'waiting');
  }, []);

  const createPeer = useCallback(async (
    gen: number,
    viewerId: string,
    offer: RTCSessionDescriptionInit,
    candidates: RTCIceCandidateInit[],
  ) => {
    const stream = streamRef.current;
    if (!stream) return;

    const entry: PeerEntry = { pc: null, seenCandidates: 0, ready: false };
    peersRef.current.set(viewerId, entry);

    try {
      const iceServers = await fetchIceServers();
      if (genRef.current !== gen) return;

      const pc = new RTCPeerConnection({ iceServers });
      entry.pc = pc;

      pc.onicecandidate = (e) => {
        if (e.candidate && genRef.current === gen) {
          post('ice-broadcaster', viewerId, e.candidate.toJSON());
        }
      };

      pc.onconnectionstatechange = () => {
        if (genRef.current !== gen) return;
        const s = pc.connectionState;
        if (s === 'connected') {
          // Cap bitrate and prefer dropping resolution over frames on poor networks
          pc.getSenders().forEach(async (sender) => {
            if (sender.track?.kind !== 'video') return;
            try {
              const params = sender.getParameters();
              if (!params.encodings?.length) params.encodings = [{}];
              params.encodings[0].maxBitrate = 4_000_000; // 4 Mbps ceiling
              await sender.setParameters(params);
            } catch { /* not all browsers support this */ }
          });
        }
        if (s === 'disconnected' || s === 'failed' || s === 'closed') {
          pc.close();
          if (peersRef.current.get(viewerId)?.pc === pc) peersRef.current.delete(viewerId);
          post('leave', viewerId); // viewer rejoins with a fresh ID if it's still there
        }
        updateStatus(gen);
      };

      await pc.setRemoteDescription(offer);

      // Attach our tracks to the recvonly transceivers the viewer offered
      for (const t of pc.getTransceivers()) {
        const kind = t.receiver.track?.kind;
        const local = stream.getTracks().find((tr) => tr.kind === kind);
        if (local) {
          await t.sender.replaceTrack(local);
          t.direction = 'sendonly';
        }
      }

      for (const c of candidates) { try { await pc.addIceCandidate(c); } catch { /* ok */ } }
      entry.seenCandidates = candidates.length;

      const answer = await pc.createAnswer();
      if (genRef.current !== gen) { pc.close(); return; }
      await pc.setLocalDescription(answer);
      await post('answer', viewerId, answer);
      entry.ready = true;
    } catch (err) {
      console.error(`[Broadcast:${room}] viewer ${viewerId}`, err);
      entry.pc?.close();
      if (peersRef.current.get(viewerId) === entry) peersRef.current.delete(viewerId);
    }
  }, [room, streamRef, post, updateStatus]);

  const poll = useCallback(async (gen: number) => {
    if (genRef.current !== gen) return;
    try {
      const res = await fetch(`/api/signal?room=${encodeURIComponent(room)}`);
      const state = await res.json() as {
        viewers: { id: string; offer: RTCSessionDescriptionInit; candidates: RTCIceCandidateInit[] }[];
      };
      if (genRef.current !== gen) return;

      for (const v of state.viewers) {
        const entry = peersRef.current.get(v.id);
        if (!entry) {
          createPeer(gen, v.id, v.offer, v.candidates); // async — entry registered synchronously inside
          continue;
        }
        if (!entry.ready || !entry.pc) continue; // still answering — its candidates get picked up next poll
        const fresh = v.candidates.slice(entry.seenCandidates);
        entry.seenCandidates = v.candidates.length;
        for (const c of fresh) { try { await entry.pc.addIceCandidate(c); } catch { /* ok */ } }
      }
    } catch { /* ok */ }
    if (genRef.current === gen) timerRef.current = setTimeout(() => poll(gen), 800);
  }, [room, createPeer]);

  const start = useCallback(() => {
    const gen = ++genRef.current;
    clearTimers();
    closeAllPeers();

    const begin = async () => {
      if (genRef.current !== gen) return;

      const stream = streamRef.current;
      if (!stream || stream.getTracks().length === 0) {
        // Stream not ready yet — retry shortly
        timerRef.current = setTimeout(begin, 500);
        return;
      }

      setStatus('offering');
      const broadcastId = crypto.randomUUID();
      try {
        await signal(room, 'reset');
        await signal(room, 'announce', undefined, { broadcastId });
      } catch {
        if (genRef.current === gen) {
          setStatus('error');
          timerRef.current = setTimeout(begin, 2000);
        }
        return;
      }
      if (genRef.current !== gen) return;
      setStatus('waiting');

      // Heartbeat keeps the room listed as live — every 4s so a few failures don't expire it
      heartbeatRef.current = setInterval(() => {
        if (genRef.current === gen) signal(room, 'announce', undefined, { broadcastId }).catch(() => {});
      }, 4_000);

      poll(gen);
    };

    begin();
  }, [room, streamRef, poll, closeAllPeers]);

  const stop = useCallback(async () => {
    ++genRef.current;
    clearTimers();
    closeAllPeers();
    await signal(room, 'reset').catch(() => {});
    setStatus('idle');
  }, [room, closeAllPeers]);

  // Replace video track on every viewer connection without renegotiating
  const replaceTrack = useCallback(async (newStream: MediaStream) => {
    const track = newStream.getVideoTracks()[0];
    if (!track) return;
    for (const { pc } of peersRef.current.values()) {
      if (!pc) continue;
      const tx = pc.getTransceivers().find((t) => t.receiver.track?.kind === 'video');
      if (tx) await tx.sender.replaceTrack(track);
    }
  }, []);

  useEffect(() => () => { stop(); }, [stop]);

  return { status, start, stop, replaceTrack };
}
