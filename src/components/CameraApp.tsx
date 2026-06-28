'use client';

import { useEffect, useState } from 'react';
import { useCamera } from '@/hooks/useCamera';
import PhotoPreview from './PhotoPreview';
import VideoPreview from './VideoPreview';

function isSecureContext(): boolean {
  if (typeof window === 'undefined') return true;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return window.isSecureContext;
}

export default function CameraApp() {
  const cam = useCamera();
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [secure, setSecure] = useState(true);

  useEffect(() => {
    setSecure(isSecureContext());
  }, []);

  // ── Secure context guard ──────────────────────────────────────────────────
  if (!secure) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-8 gap-4 text-center">
        <span className="text-5xl">🔒</span>
        <h1 className="text-2xl font-bold">HTTPS Required</h1>
        <p className="text-gray-400 leading-relaxed max-w-sm">
          Camera access requires a secure connection. Open the app over HTTPS or use a tunnel:
        </p>
        <code className="bg-gray-900 text-blue-400 text-xs px-4 py-2 rounded-lg">
          npx cloudflared tunnel --url http://localhost:3000
        </code>
      </div>
    );
  }

  // ── Photo preview ─────────────────────────────────────────────────────────
  if (cam.capturedPhoto) {
    return (
      <PhotoPreview
        uri={cam.capturedPhoto}
        onRetake={() => cam.setCapturedPhoto(null)}
      />
    );
  }

  // ── Video preview ─────────────────────────────────────────────────────────
  if (cam.capturedVideo) {
    return (
      <VideoPreview
        uri={cam.capturedVideo}
        onRetake={() => cam.setCapturedVideo(null)}
      />
    );
  }

  // ── Permission: idle / requesting ─────────────────────────────────────────
  if (cam.permission === 'idle' || cam.permission === 'requesting') {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-8 gap-6 text-center">
        <span className="text-6xl">📷</span>
        <h1 className="text-3xl font-bold">GMI Cam</h1>
        <p className="text-gray-400 max-w-xs leading-relaxed">
          Multi-camera webcam app. Works as an OBS browser source.
        </p>
        {cam.permission === 'requesting' ? (
          <div className="flex items-center gap-2 text-gray-400">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Requesting access…
          </div>
        ) : (
          <button
            onClick={cam.requestPermission}
            className="bg-blue-500 hover:bg-blue-400 text-white font-semibold px-8 py-3 rounded-xl transition-colors"
          >
            Grant Camera Access
          </button>
        )}
      </div>
    );
  }

  // ── Permission denied ─────────────────────────────────────────────────────
  if (cam.permission === 'denied') {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-8 gap-4 text-center">
        <span className="text-5xl">🚫</span>
        <h1 className="text-2xl font-bold">Permission Denied</h1>
        <p className="text-gray-400 leading-relaxed max-w-sm">
          Enable camera access in your browser settings and reload.
        </p>
        <p className="text-gray-500 text-sm max-w-sm">
          <strong>OBS users:</strong> Go to{' '}
          <em>Settings → Advanced → Browser</em> and enable camera permissions.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 border border-white/30 text-white px-6 py-2 rounded-lg hover:bg-white/10 transition-colors"
        >
          Reload
        </button>
      </div>
    );
  }

  // ── No camera hardware ────────────────────────────────────────────────────
  if (cam.permission === 'unavailable') {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-8 gap-4 text-center">
        <span className="text-5xl">📵</span>
        <h1 className="text-2xl font-bold">No Camera Found</h1>
        <p className="text-gray-400 max-w-sm leading-relaxed">
          No video input devices were detected. Connect a webcam and reload.
        </p>
      </div>
    );
  }

  // ── Live preview ──────────────────────────────────────────────────────────
  const mm = String(Math.floor(cam.elapsed / 60)).padStart(2, '0');
  const ss = String(cam.elapsed % 60).padStart(2, '0');

  return (
    <div className="relative h-screen w-screen bg-black overflow-hidden flex flex-col">
      {/* Video */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={cam.videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: cam.mirror ? 'scaleX(-1)' : 'none' }}
        onLoadedMetadata={(e) => (e.currentTarget as HTMLVideoElement).play()}
      />

      {/* Recording badge */}
      {cam.isRecording && (
        <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full z-20">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-white text-sm font-semibold">REC {mm}:{ss}</span>
        </div>
      )}

      {/* Top bar: mirror + device picker */}
      <div className="absolute top-0 left-0 right-0 z-10 flex flex-col gap-2 px-4 pt-safe pb-3 bg-gradient-to-b from-black/70 to-transparent">
        <div className="flex items-center justify-between">
          {/* Mirror toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-white text-sm">Mirror</span>
            <button
              role="switch"
              aria-checked={cam.mirror}
              onClick={() => cam.setMirror(!cam.mirror)}
              className={`relative w-10 h-6 rounded-full transition-colors ${cam.mirror ? 'bg-blue-500' : 'bg-gray-600'}`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${cam.mirror ? 'translate-x-4' : ''}`}
              />
            </button>
          </label>

          {/* Toggle facing (mobile) */}
          <button
            onClick={cam.toggleFacing}
            className="text-white bg-white/20 hover:bg-white/30 rounded-full p-2 transition-colors"
            title="Flip camera"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 12h16M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4" />
            </svg>
          </button>
        </div>

        {/* Device picker — shown when 2+ cameras */}
        {cam.devices.length > 1 && (
          <select
            value={cam.selectedDeviceId}
            onChange={(e) => cam.switchDevice(e.target.value)}
            className="w-full bg-black/60 text-white text-sm border border-white/20 rounded-lg px-3 py-1.5 outline-none"
          >
            {cam.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col gap-3 px-4 pb-safe pt-4 bg-gradient-to-t from-black/80 to-transparent">
        {/* Mode tabs */}
        <div className="flex justify-center gap-2">
          {(['photo', 'video'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-5 py-1.5 rounded-full text-sm font-semibold capitalize transition-colors ${
                mode === m ? 'bg-blue-500 text-white' : 'bg-white/15 text-white/80'
              }`}
            >
              {m === 'video' ? 'Video (exp)' : 'Photo'}
            </button>
          ))}
        </div>

        {/* Shutter row */}
        <div className="flex items-center justify-center pb-6">
          {mode === 'photo' ? (
            <button
              onClick={cam.takePhoto}
              className="w-18 h-18 rounded-full bg-white border-4 border-white/40 hover:scale-95 active:scale-90 transition-transform"
              style={{ width: 72, height: 72 }}
              aria-label="Take photo"
            />
          ) : cam.recordingSupported ? (
            <button
              onClick={cam.isRecording ? cam.stopRecording : cam.startRecording}
              className={`flex items-center justify-center rounded-full border-4 border-white/40 transition-all hover:scale-95 active:scale-90 ${
                cam.isRecording ? 'bg-red-500' : 'bg-white'
              }`}
              style={{ width: 72, height: 72 }}
              aria-label={cam.isRecording ? 'Stop recording' : 'Start recording'}
            >
              {cam.isRecording && (
                <span className="w-6 h-6 bg-white rounded-sm" />
              )}
            </button>
          ) : (
            <div className="flex items-center justify-center rounded-full bg-white/10 border-2 border-white/20 text-center"
              style={{ width: 72, height: 72 }}>
              <span className="text-gray-400 text-[10px] leading-tight px-1">Not supported</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
