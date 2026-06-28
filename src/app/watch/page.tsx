'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useViewer } from '@/hooks/useViewer';

function isOBSBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /OBS/.test(navigator.userAgent);
}

const statusLabel = {
  idle: '',
  waiting: 'Waiting for broadcaster…',
  connecting: 'Connecting…',
  connected: '',
  error: 'Connection error — retrying…',
};

export default function WatchPage() {
  const { status, connect, disconnect, remoteVideoRef } = useViewer();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [obsMode, setObsMode] = useState(false);
  const [showUI, setShowUI] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const obs = isOBSBrowser() || params.get('obs') === '1';
    setObsMode(obs);
    if (obs) setShowUI(false);
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-fullscreen when stream connects (non-OBS only)
  useEffect(() => {
    if (status === 'connected' && !obsMode && !document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {
        // Fullscreen requires a user gesture on some browsers — silently ignore
      });
    }
  }, [status, obsMode]);

  // Track fullscreen state
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

  const copyObsUrl = () => {
    const url = `${window.location.origin}/watch?obs=1`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isWaiting = status === 'idle' || status === 'waiting' || status === 'connecting';

  return (
    <div ref={containerRef} className="relative h-screen w-screen bg-black overflow-hidden">
      {/* Remote video */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-contain"
        onLoadedMetadata={(e) => (e.currentTarget as HTMLVideoElement).play()}
      />

      {/* Double-click to toggle UI in OBS mode */}
      {obsMode && (
        <div className="absolute inset-0 z-5" onDoubleClick={() => setShowUI((v) => !v)} />
      )}

      {showUI && (
        <>
          {/* Back */}
          {!obsMode && (
            <Link href="/" className="absolute top-4 left-4 z-30 text-white/60 hover:text-white text-sm">
              ← Back
            </Link>
          )}

          {/* Connected badge */}
          {status === 'connected' && (
            <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-green-600/80 px-3 py-1 rounded-full">
              <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
              <span className="text-white text-xs font-semibold">Live</span>
            </div>
          )}

          {/* Waiting overlay */}
          {isWaiting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85 z-10">
              <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
              <p className="text-white font-semibold">{statusLabel[status]}</p>
              <p className="text-gray-500 text-sm text-center max-w-xs">
                Open the broadcaster&apos;s device and press <strong className="text-white">Go Live</strong>.
              </p>
              <button
                onClick={connect}
                className="mt-2 px-6 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors"
              >
                Reconnect
              </button>
            </div>
          )}

          {/* Bottom bar */}
          <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between gap-3 px-4 pb-8 pt-4 bg-gradient-to-t from-black/70 to-transparent">
            {/* OBS URL copy */}
            <button
              onClick={copyObsUrl}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors"
            >
              {copied ? '✓ Copied!' : '📋 Copy OBS URL'}
            </button>

            {/* Fullscreen toggle */}
            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors"
            >
              {isFullscreen ? (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" />
                  </svg>
                  Exit Fullscreen
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
                  </svg>
                  Fullscreen
                </>
              )}
            </button>

            {/* Disconnect */}
            {status === 'connected' && (
              <button
                onClick={disconnect}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors"
              >
                Disconnect
              </button>
            )}
          </div>
        </>
      )}

      {/* OBS mode hint */}
      {obsMode && !showUI && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/15 text-xs select-none pointer-events-none">
          double-click to show controls
        </div>
      )}
    </div>
  );
}
