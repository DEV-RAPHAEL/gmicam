'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useCamera } from '@/hooks/useCamera';
import { useBroadcast } from '@/hooks/useBroadcast';

function isOBSBrowser() {
  return typeof navigator !== 'undefined' && /OBS/.test(navigator.userAgent);
}

function BroadcastInner() {
  const params = useSearchParams();
  const room = params.get('room') ?? 'cam1';

  const cam = useCamera();
  const { status, turnInfo, start, replaceTrack } = useBroadcast(room, cam.stream);

  const [obsMode] = useState(() => isOBSBrowser() || params.get('obs') === '1');
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  // Auto-request camera on mount
  useEffect(() => {
    cam.requestPermission();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start broadcast as soon as camera is ready
  useEffect(() => {
    if (cam.permission === 'granted' && !startedRef.current) {
      startedRef.current = true;
      start();
    }
  }, [cam.permission, start]);

  // When camera switches, replace track in existing peer connection
  const handleDeviceSwitch = async (deviceId: string) => {
    if (status === 'connected') return; // locked while viewer is watching
    await cam.switchDevice(deviceId);
    // replaceTrack is called in the next effect once stream updates
  };

  // When the underlying stream track changes, push it to the peer connection
  const lastTrackId = useRef<string>('');
  useEffect(() => {
    const track = cam.stream.current?.getVideoTracks()[0];
    if (track && track.id !== lastTrackId.current) {
      lastTrackId.current = track.id;
      if (cam.stream.current) replaceTrack(cam.stream.current);
    }
  });

  // Scroll-wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY * 0.002)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Pinch zoom
  useEffect(() => {
    let lastDist = 0;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2)
        lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        setZoom((z) => Math.min(4, Math.max(1, z + (d - lastDist) * 0.01)));
        lastDist = d;
      }
    };
    window.addEventListener('touchstart', onStart);
    window.addEventListener('touchmove', onMove);
    return () => { window.removeEventListener('touchstart', onStart); window.removeEventListener('touchmove', onMove); };
  }, []);

  const statusColor = { idle: '#6b7280', offering: '#f59e0b', waiting: '#f59e0b', connected: '#22c55e', error: '#ef4444' }[status];
  const isLocked = status === 'connected';

  return (
    <div ref={containerRef} className="relative h-screen w-screen bg-black overflow-hidden">
      {/* Camera feed */}
      {cam.permission === 'granted' && (
        <video
          ref={cam.videoRef}
          autoPlay playsInline muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: `${cam.mirror ? 'scaleX(-1) ' : ''}scale(${zoom})`, transformOrigin: 'center' }}
          onLoadedMetadata={(e) => (e.currentTarget as HTMLVideoElement).play()}
        />
      )}

      {/* Permission / error states */}
      {cam.permission !== 'granted' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10">
          {cam.permission === 'idle' && (
            <button onClick={cam.requestPermission} className="bg-white text-black font-semibold px-8 py-3 rounded-xl">
              Allow Camera
            </button>
          )}
          {cam.permission === 'requesting' && <p className="text-gray-400">Requesting camera…</p>}
          {cam.permission === 'denied' && <p className="text-red-400">Camera denied. Check browser settings.</p>}
          {cam.permission === 'unavailable' && <p className="text-gray-400">No camera found.</p>}
        </div>
      )}

      {!obsMode && (
        <>
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-4 pt-4 pb-3 bg-gradient-to-b from-black/80 to-transparent">
            <Link href="/" className="text-white/50 hover:text-white text-sm mr-1">←</Link>

            {/* Room badge */}
            <div className="flex items-center gap-1.5 bg-black/50 px-3 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full" style={{ background: statusColor }} />
              <span className="text-white text-xs font-mono font-bold uppercase">{room}</span>
            </div>

            {/* Resolution info */}
            {cam.actualResolution && (
              <span className="text-white/40 text-xs font-mono">
                {cam.actualResolution.w}×{cam.actualResolution.h}
              </span>
            )}

            <div className="flex-1" />

            {/* Mirror */}
            <button
              onClick={() => cam.setMirror(!cam.mirror)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${cam.mirror ? 'bg-white/20 text-white' : 'bg-white/5 text-white/40'}`}
            >
              Mirror
            </button>
          </div>

          {/* Camera selector — locked while connected */}
          {cam.devices.length > 1 && (
            <div className="absolute top-14 left-4 right-4 z-20">
              <select
                value={cam.selectedDeviceId}
                onChange={(e) => handleDeviceSwitch(e.target.value)}
                disabled={isLocked}
                className="w-full bg-black/70 text-white text-sm border border-white/20 rounded-lg px-3 py-2 outline-none disabled:opacity-40"
              >
                {cam.devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
              </select>
              {isLocked && (
                <p className="text-white/30 text-xs mt-1 text-center">Locked while viewer is connected</p>
              )}
            </div>
          )}

          {/* Zoom slider — bottom left */}
          {zoom > 1 && (
            <div className="absolute bottom-8 left-4 z-20 flex items-center gap-2">
              <input type="range" min={1} max={4} step={0.05} value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-28 accent-white" />
              <button onClick={() => setZoom(1)} className="text-white/40 text-xs hover:text-white">×{zoom.toFixed(1)}</button>
            </div>
          )}

          {/* Status — bottom right */}
          <div className="absolute bottom-8 right-4 z-20 flex flex-col items-end gap-0.5">
            <span className="text-xs font-semibold" style={{ color: statusColor }}>
              {{
                idle: 'Starting…',
                offering: 'Setting up…',
                waiting: 'Waiting for viewer',
                connected: 'Viewer connected',
                error: 'Error',
              }[status]}
            </span>
            {/* TURN status — if this ever reads "no", cross-network viewers can't connect */}
            {turnInfo && (
              <span className={`text-[10px] font-mono ${turnInfo.turn ? 'text-white/30' : 'text-red-400'}`}>
                {turnInfo.turn ? 'turn:yes' : `turn:no (${turnInfo.reason ?? 'unknown'})`}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function BroadcastPage() {
  return (
    <Suspense>
      <BroadcastInner />
    </Suspense>
  );
}
