'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCamera } from '@/hooks/useCamera';
import { useBroadcast } from '@/hooks/useBroadcast';
import PhotoPreview from '@/components/PhotoPreview';
import VideoPreview from '@/components/VideoPreview';

function isOBSBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /OBS/.test(navigator.userAgent);
}

export default function BroadcastPage() {
  const cam = useCamera();
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  // Pass the stream ref directly so startBroadcast always reads the latest stream
  const { status: bcStatus, startBroadcast, stopBroadcast } = useBroadcast(cam.stream);
  const [broadcasting, setBroadcasting] = useState(false);

  // OBS clean mode: detected via user agent or ?obs=1 param
  const [obsMode, setObsMode] = useState(false);
  // Zoom: 1.0 – 4.0
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Fullscreen
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Chroma key bg
  const [chromaKey, setChromaKey] = useState<string>('none');
  // UI visibility toggle (double-click to hide/show in OBS mode)
  const [showUI, setShowUI] = useState(true);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const obs = isOBSBrowser() || params.get('obs') === '1';
    setObsMode(obs);
    if (obs) setShowUI(false);
  }, []);

  // Auto-request permission on mount
  useEffect(() => {
    cam.requestPermission();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll wheel zoom
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

  // Pinch-to-zoom
  useEffect(() => {
    let lastDist = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        lastDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const delta = dist - lastDist;
        lastDist = dist;
        setZoom((z) => Math.min(4, Math.max(1, z + delta * 0.01)));
      }
    };
    window.addEventListener('touchstart', onTouchStart);
    window.addEventListener('touchmove', onTouchMove);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  // Fullscreen listener
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const toggleBroadcast = async () => {
    if (broadcasting) {
      await stopBroadcast();
      setBroadcasting(false);
    } else {
      await startBroadcast();
      setBroadcasting(true);
    }
  };


  if (cam.capturedPhoto) return <PhotoPreview uri={cam.capturedPhoto} onRetake={() => cam.setCapturedPhoto(null)} />;
  if (cam.capturedVideo) return <VideoPreview uri={cam.capturedVideo} onRetake={() => cam.setCapturedVideo(null)} />;

  const bgStyle: React.CSSProperties =
    chromaKey !== 'none' ? { background: chromaKey } : { background: '#000' };

  const mm = String(Math.floor(cam.elapsed / 60)).padStart(2, '0');
  const ss = String(cam.elapsed % 60).padStart(2, '0');

  const bcLabel: Record<typeof bcStatus, string> = {
    idle: 'Go Live', offering: 'Setting up…',
    waiting: 'Waiting for viewer…', connected: 'Live ✓', error: 'Retry',
  };

  return (
    <div ref={containerRef} className="relative h-screen w-screen overflow-hidden flex flex-col" style={bgStyle}>

      {/* ── Video feed ── */}
      {cam.permission === 'granted' && (
        <video
          ref={cam.videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            transform: `${cam.mirror ? 'scaleX(-1) ' : ''}scale(${zoom})`,
            transformOrigin: 'center center',
          }}
          onLoadedMetadata={(e) => (e.currentTarget as HTMLVideoElement).play()}
        />
      )}

      {/* ── Permission states (non-granted) ── */}
      {cam.permission !== 'granted' && !obsMode && (
        <div className="flex flex-col items-center justify-center h-full gap-4 z-10">
          {cam.permission === 'idle' && (
            <button onClick={cam.requestPermission} className="bg-blue-500 hover:bg-blue-400 text-white font-semibold px-8 py-3 rounded-xl">
              Grant Camera Access
            </button>
          )}
          {cam.permission === 'requesting' && <p className="text-gray-400">Requesting access…</p>}
          {cam.permission === 'denied' && (
            <>
              <span className="text-4xl">🚫</span>
              <p className="text-white font-bold">Camera permission denied</p>
              <p className="text-gray-400 text-sm">Enable it in browser / OBS settings then reload.</p>
            </>
          )}
          {cam.permission === 'unavailable' && (
            <>
              <span className="text-4xl">📵</span>
              <p className="text-white">No camera found</p>
            </>
          )}
        </div>
      )}

      {/* ── Double-click to toggle UI in OBS mode ── */}
      {obsMode && (
        <div className="absolute inset-0 z-5" onDoubleClick={() => setShowUI((v) => !v)} />
      )}

      {/* ── Overlays (hidden in OBS clean mode unless showUI) ── */}
      {showUI && (
        <>
          {/* Back button */}
          {!obsMode && (
            <Link href="/" className="absolute top-4 left-4 z-30 text-white/60 hover:text-white text-sm">
              ← Back
            </Link>
          )}

          {/* LIVE badge */}
          {bcStatus === 'connected' && (
            <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-red-600 px-3 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="text-white text-xs font-bold tracking-wide">LIVE</span>
            </div>
          )}
          {bcStatus === 'waiting' && (
            <div className="absolute top-4 right-4 z-20 bg-yellow-600/80 px-3 py-1 rounded-full">
              <span className="text-white text-xs font-semibold">Waiting for viewer…</span>
            </div>
          )}

          {/* REC badge */}
          {cam.isRecording && (
            <div className="absolute top-14 right-4 z-20 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white text-sm font-semibold">REC {mm}:{ss}</span>
            </div>
          )}

          {/* Resolution + zoom info */}
          {cam.actualResolution && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-black/50 px-3 py-1 rounded-full text-white/70 text-xs font-mono">
              {cam.actualResolution.w}×{cam.actualResolution.h}
              {zoom > 1 ? `  ×${zoom.toFixed(1)}` : ''}
            </div>
          )}

          {/* Top bar */}
          {cam.permission === 'granted' && (
            <div className="absolute top-0 left-0 right-0 z-10 flex flex-col gap-2 px-4 pt-14 pb-3 bg-gradient-to-b from-black/70 to-transparent">
              <div className="flex items-center justify-between gap-3">
                {/* Mirror */}
                <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
                  <span className="text-white text-sm">Mirror</span>
                  <button
                    role="switch" aria-checked={cam.mirror}
                    onClick={() => cam.setMirror(!cam.mirror)}
                    className={`relative w-10 h-6 rounded-full transition-colors ${cam.mirror ? 'bg-blue-500' : 'bg-gray-600'}`}
                  >
                    <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${cam.mirror ? 'translate-x-4' : ''}`} />
                  </button>
                </label>

                {/* FPS */}
                <div className="flex gap-1">
                  {([30, 60] as const).map((f) => (
                    <button key={f}
                      onClick={() => cam.switchFps(f)}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${cam.fps === f ? 'bg-blue-500 text-white' : 'bg-white/15 text-white/70'}`}
                    >
                      {f}fps
                    </button>
                  ))}
                </div>

                {/* Fullscreen */}
                <button onClick={toggleFullscreen} className="text-white bg-white/20 hover:bg-white/30 rounded-full p-2 transition-colors" title="Fullscreen">
                  {isFullscreen
                    ? <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" /></svg>
                    : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" /></svg>
                  }
                </button>

                {/* Flip camera */}
                <button onClick={cam.toggleFacing} className="text-white bg-white/20 hover:bg-white/30 rounded-full p-2 transition-colors">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 12h16M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4" />
                  </svg>
                </button>
              </div>

              {/* Device picker */}
              {cam.devices.length > 1 && (
                <select value={cam.selectedDeviceId} onChange={(e) => cam.switchDevice(e.target.value)}
                  className="w-full bg-black/60 text-white text-sm border border-white/20 rounded-lg px-3 py-1.5 outline-none">
                  {cam.devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                  ))}
                </select>
              )}

              {/* Zoom slider */}
              <div className="flex items-center gap-2">
                <span className="text-white/60 text-xs w-8">Zoom</span>
                <input type="range" min={1} max={4} step={0.1} value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="flex-1 accent-blue-500" />
                <button onClick={() => setZoom(1)} className="text-white/50 text-xs hover:text-white">Reset</button>
              </div>

              {/* Chroma key */}
              <div className="flex items-center gap-2">
                <span className="text-white/60 text-xs shrink-0">BG</span>
                {[
                  { label: 'None', value: 'none', cls: 'bg-white/10 text-white' },
                  { label: '', value: '#00ff00', cls: 'bg-[#00ff00]' },
                  { label: '', value: '#0000ff', cls: 'bg-blue-600' },
                  { label: '', value: '#000000', cls: 'bg-black border border-white/30' },
                  { label: '', value: '#ffffff', cls: 'bg-white' },
                ].map((opt) => (
                  <button key={opt.value} onClick={() => setChromaKey(opt.value)}
                    title={opt.value}
                    className={`w-7 h-7 rounded-full transition-all ${opt.cls} ${chromaKey === opt.value ? 'ring-2 ring-white scale-110' : ''}`}>
                    {opt.label && <span className="text-xs">{opt.label}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Bottom controls */}
          {cam.permission === 'granted' && (
            <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col gap-3 px-4 pb-8 pt-4 bg-gradient-to-t from-black/80 to-transparent">
              {/* Go Live */}
              <div className="flex gap-2">
                <button onClick={toggleBroadcast}
                  className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-colors ${broadcasting ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-white/15 hover:bg-white/25 text-white'}`}>
                  {broadcasting ? `Stop — ${bcLabel[bcStatus]}` : bcLabel[bcStatus]}
                </button>
              </div>

              {/* Mode + shutter */}
              <div className="flex justify-center gap-2">
                {(['photo', 'video'] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`px-5 py-1.5 rounded-full text-sm font-semibold capitalize transition-colors ${mode === m ? 'bg-blue-500 text-white' : 'bg-white/15 text-white/80'}`}>
                    {m === 'video' ? 'Video (exp)' : 'Photo'}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-center pb-2">
                {mode === 'photo' ? (
                  <button onClick={cam.takePhoto}
                    className="w-[72px] h-[72px] rounded-full bg-white border-4 border-white/40 hover:scale-95 active:scale-90 transition-transform"
                    aria-label="Take photo" />
                ) : cam.recordingSupported ? (
                  <button
                    onClick={cam.isRecording ? cam.stopRecording : cam.startRecording}
                    className={`flex items-center justify-center w-[72px] h-[72px] rounded-full border-4 border-white/40 transition-all hover:scale-95 active:scale-90 ${cam.isRecording ? 'bg-red-500' : 'bg-white'}`}
                    aria-label={cam.isRecording ? 'Stop' : 'Record'}>
                    {cam.isRecording && <span className="w-6 h-6 bg-white rounded-sm" />}
                  </button>
                ) : (
                  <div className="flex items-center justify-center w-[72px] h-[72px] rounded-full bg-white/10 border-2 border-white/20">
                    <span className="text-gray-400 text-[10px] text-center px-1">Not supported</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Hint when UI is hidden in OBS mode */}
      {obsMode && !showUI && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/20 text-xs select-none pointer-events-none">
          double-click to show controls
        </div>
      )}
    </div>
  );
}
