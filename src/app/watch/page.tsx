'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useViewer, ViewerStatus } from '@/hooks/useViewer';

function isOBSBrowser() {
  return typeof navigator !== 'undefined' && /OBS/.test(navigator.userAgent);
}

// Individual camera tile
function CameraTile({ room, onExpand, obsMode }: { room: string; onExpand: (r: string) => void; obsMode: boolean }) {
  const { status, iceState, remoteVideoRef } = useViewer(room);

  const dot: Record<ViewerStatus, string> = {
    waiting: 'bg-yellow-500',
    connecting: 'bg-yellow-400 animate-pulse',
    connected: 'bg-green-500',
  };

  return (
    <div className="relative bg-black rounded-xl overflow-hidden cursor-pointer group" onClick={() => onExpand(room)}>
      {/* Video — always rendered so it can receive the stream even while 'connecting' */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={remoteVideoRef}
        autoPlay playsInline
        className="w-full h-full object-cover"
        style={{ minHeight: 160 }}
        onLoadedMetadata={(e) => (e.currentTarget as HTMLVideoElement).play()}
        onStalled={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
        onSuspend={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
      />

      {/* Waiting overlay — only when truly waiting, not when connecting (video may already be flowing) */}
      {status === 'waiting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 gap-2">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          <span className="text-white/50 text-xs">Waiting for broadcaster…</span>
        </div>
      )}

      {/* Room label + ICE debug */}
      {!obsMode && (
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded-full">
            <span className={`w-1.5 h-1.5 rounded-full ${dot[status]}`} />
            <span className="text-white text-xs font-mono font-bold uppercase">{room}</span>
            <span className="text-white/40 text-xs capitalize ml-1">{status}</span>
          </div>
          {/* ICE state — visible when not connected so we can debug */}
          {status !== 'connected' && iceState && (
            <span className="text-white/30 text-[10px] font-mono bg-black/50 px-2 py-0.5 rounded-full">{iceState}</span>
          )}
        </div>
      )}

      {/* Expand hint */}
      {status === 'connected' && !obsMode && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <span className="text-white text-sm font-semibold bg-black/50 px-3 py-1 rounded-full">Fullscreen</span>
        </div>
      )}
    </div>
  );
}

// Fullscreen single-cam view
function ExpandedView({ room, onClose }: { room: string; onClose: () => void }) {
  const { status, iceState, remoteVideoRef } = useViewer(room);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    containerRef.current?.requestFullscreen().catch(() => {});
    const h = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // OBS URL now points to broadcast page — OBS captures the camera directly, no relay needed
  const copyObsUrl = () => {
    navigator.clipboard.writeText(`${window.location.origin}/broadcast?room=${room}&obs=1`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={remoteVideoRef}
        autoPlay playsInline
        className="flex-1 w-full object-contain"
        onLoadedMetadata={(e) => (e.currentTarget as HTMLVideoElement).play()}
        onStalled={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
        onSuspend={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
      />

      {/* Show connecting state without hiding video */}
      {status === 'waiting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85">
          <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}
      {status === 'connecting' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 px-3 py-1 rounded-full">
          <span className="text-yellow-400 text-xs font-mono">{iceState || 'connecting…'}</span>
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-3 px-4 pb-8 pt-4 bg-gradient-to-t from-black/80 to-transparent">
        <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors">← Back</button>
        <span className="text-white/30 text-xs font-mono uppercase">{room}</span>
        <div className="flex-1" />
        <button onClick={copyObsUrl} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors">
          {copied ? '✓ Copied' : '📋 OBS URL'}
        </button>
        <button
          onClick={() => isFs ? document.exitFullscreen() : containerRef.current?.requestFullscreen()}
          className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors"
        >
          {isFs ? 'Exit FS' : 'Fullscreen'}
        </button>
      </div>
    </div>
  );
}

// OBS single-room clean view
function SingleRoomObs({ room }: { room: string }) {
  const { remoteVideoRef } = useViewer(room);
  return (
    <div className="h-screen w-screen bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={remoteVideoRef}
        autoPlay playsInline
        className="w-full h-full object-cover"
        onLoadedMetadata={(e) => (e.currentTarget as HTMLVideoElement).play()}
        onStalled={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
        onSuspend={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
      />
    </div>
  );
}

export default function WatchPage() {
  const [rooms, setRooms] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const obsMode = isOBSBrowser() || searchParams?.get('obs') === '1';
  const obsRoom = searchParams?.get('room');

  if (obsMode && obsRoom) return <SingleRoomObs room={obsRoom} />;

  const pollRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/signal?list=1');
      const data = await res.json() as { rooms: string[] };
      setRooms(data.rooms);
    } catch { /* ignore */ }
  }, []);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    pollRooms();
    const id = setInterval(pollRooms, 3000);
    return () => clearInterval(id);
  }, [pollRooms]);

  const gridCols =
    rooms.length <= 1 ? 'grid-cols-1' :
    rooms.length <= 2 ? 'grid-cols-2' :
    'grid-cols-2';

  return (
    <div className="h-screen w-screen bg-[#0a0a0a] flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 shrink-0">
        <Link href="/" className="text-white/50 hover:text-white text-sm">←</Link>
        <span className="text-white font-semibold text-sm">Watch</span>
        <span className="text-white/30 text-xs">{rooms.length} camera{rooms.length !== 1 ? 's' : ''} live</span>
        <div className="flex-1" />
        <button onClick={pollRooms} className="text-white/30 hover:text-white text-xs">Refresh</button>
      </div>

      {rooms.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-10 h-10 border-4 border-white/10 border-t-white/40 rounded-full animate-spin" />
          <p className="text-white/40 text-sm">Waiting for a broadcaster…</p>
          <p className="text-white/20 text-xs text-center max-w-xs">Open /broadcast on another device or tab</p>
        </div>
      ) : (
        <div className={`flex-1 grid ${gridCols} gap-2 p-2 overflow-hidden`}>
          {rooms.map((room) => (
            <CameraTile key={room} room={room} onExpand={setExpanded} obsMode={obsMode} />
          ))}
        </div>
      )}

      {expanded && <ExpandedView room={expanded} onClose={() => setExpanded(null)} />}
    </div>
  );
}
