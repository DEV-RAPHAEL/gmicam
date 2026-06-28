'use client';

interface Props {
  uri: string;
  onRetake: () => void;
}

export default function PhotoPreview({ uri, onRetake }: Props) {
  const download = () => {
    const a = document.createElement('a');
    a.href = uri;
    a.download = `gmi-cam-${Date.now()}.jpg`;
    a.click();
  };

  return (
    <div className="flex flex-col h-screen bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={uri} alt="Captured photo" className="flex-1 w-full object-contain" />
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
