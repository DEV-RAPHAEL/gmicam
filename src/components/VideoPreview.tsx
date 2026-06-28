'use client';

interface Props {
  uri: string;
  onRetake: () => void;
}

export default function VideoPreview({ uri, onRetake }: Props) {
  const download = () => {
    const ext = uri.includes('mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = uri;
    a.download = `gmi-cam-${Date.now()}.${ext}`;
    a.click();
  };

  return (
    <div className="flex flex-col h-screen bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        src={uri}
        className="flex-1 w-full object-contain"
        controls
        autoPlay
        loop
        playsInline
      />
      <div className="flex gap-3 p-5 pb-10 bg-black/70">
        <button
          onClick={onRetake}
          className="flex-1 py-3 rounded-xl border border-white/40 text-white font-semibold hover:bg-white/10 transition-colors"
        >
          Retake
        </button>
        <button
          onClick={download}
          className="flex-1 py-3 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-bold transition-colors"
        >
          Download
        </button>
      </div>
    </div>
  );
}
