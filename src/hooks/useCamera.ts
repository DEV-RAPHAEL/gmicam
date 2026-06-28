'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type PermissionState = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';
export type FacingMode = 'user' | 'environment';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export type FpsOption = 30 | 60;

function getSupportedMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const [permission, setPermission] = useState<PermissionState>('idle');
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [facingMode, setFacingMode] = useState<FacingMode>('user');
  const [mirror, setMirror] = useState(false);
  const [fps, setFps] = useState<FpsOption>(30);
  const [actualResolution, setActualResolution] = useState<{ w: number; h: number } | null>(null);

  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [capturedVideo, setCapturedVideo] = useState<string | null>(null);
  const [recordingSupported] = useState(() => getSupportedMime() !== '');
  const recordingMime = useRef(getSupportedMime());

  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const acquireWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock.request('screen');
    } catch { /* not critical */ }
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const enumerateDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = all
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
    setDevices(videoInputs);
    return videoInputs;
  }, []);

  const startStream = useCallback(
    async (deviceId?: string, facing?: FacingMode, targetFps?: FpsOption) => {
      stopStream();

      const useFps = targetFps ?? fps;
      const videoConstraints: MediaTrackConstraints = deviceId
        ? {
            deviceId: { exact: deviceId },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
            frameRate: { ideal: useFps, max: useFps },
          }
        : {
            facingMode: facing ?? facingMode,
            width: { ideal: 3840 },
            height: { ideal: 2160 },
            frameRate: { ideal: useFps, max: useFps },
          };

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraints,
        });
        streamRef.current = stream;

        if (videoRef.current) videoRef.current.srcObject = stream;

        // Read actual resolution from track
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        if (settings.width && settings.height) {
          setActualResolution({ w: settings.width, h: settings.height });
        }

        setPermission('granted');
        await acquireWakeLock();

        const listed = await enumerateDevices();
        if (!deviceId && listed.length > 0) {
          const matched = listed.find((d) => d.deviceId === settings.deviceId);
          setSelectedDeviceId(matched?.deviceId ?? listed[0].deviceId);
        } else if (deviceId) {
          setSelectedDeviceId(deviceId);
        }
      } catch (err: unknown) {
        stopStream();
        if (err instanceof DOMException) {
          if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') setPermission('unavailable');
          else setPermission('denied');
        }
      }
    },
    [acquireWakeLock, enumerateDevices, facingMode, fps, stopStream]
  );

  const requestPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setPermission('unavailable'); return; }
    setPermission('requesting');
    await startStream();
  }, [startStream]);

  const switchDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    startStream(deviceId);
  }, [startStream]);

  const switchFps = useCallback((newFps: FpsOption) => {
    setFps(newFps);
    if (permission === 'granted') startStream(selectedDeviceId || undefined, facingMode, newFps);
  }, [facingMode, permission, selectedDeviceId, startStream]);

  const toggleFacing = useCallback(() => {
    const next: FacingMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    setSelectedDeviceId('');
    startStream(undefined, next);
  }, [facingMode, startStream]);

  useEffect(() => () => { stopStream(); if (timerRef.current) clearInterval(timerRef.current); }, [stopStream]);

  useEffect(() => {
    if (!navigator.mediaDevices) return;
    const handler = () => enumerateDevices();
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
  }, [enumerateDevices]);

  // Re-acquire wake lock if released by system
  useEffect(() => {
    const handler = async () => {
      if (permission === 'granted') await acquireWakeLock();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [acquireWakeLock, permission]);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0);
    setCapturedPhoto(canvas.toDataURL('image/jpeg', 0.95));
  }, [mirror]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !recordingMime.current || isRecording) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: recordingMime.current });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recordingMime.current });
      setCapturedVideo(URL.createObjectURL(blob));
    };
    mediaRecorderRef.current = recorder;
    recorder.start(100);
    setIsRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  return {
    videoRef,
    permission,
    requestPermission,
    devices,
    selectedDeviceId,
    switchDevice,
    facingMode,
    toggleFacing,
    mirror,
    setMirror,
    fps,
    switchFps,
    actualResolution,
    capturedPhoto, setCapturedPhoto, takePhoto,
    isRecording, startRecording, stopRecording, recordingSupported,
    capturedVideo, setCapturedVideo,
    elapsed,
    stream: streamRef,
  };
}
