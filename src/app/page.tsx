import Link from 'next/link';

export default function Landing() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0a] gap-8 p-6">
      <div className="text-center mb-4">
        <h1 className="text-4xl font-bold text-white tracking-tight">GMI Cam</h1>
        <p className="text-gray-400 mt-2">Who are you?</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
        <Link
          href="/broadcast"
          className="flex-1 flex flex-col items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/60 rounded-2xl p-8 transition-all group"
        >
          <span className="text-5xl">📡</span>
          <span className="text-white font-bold text-xl">Broadcast</span>
          <span className="text-gray-400 text-sm text-center leading-relaxed">
            Share your camera.<br />Others watch your feed.
          </span>
        </Link>

        <Link
          href="/watch"
          className="flex-1 flex flex-col items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-500/60 rounded-2xl p-8 transition-all group"
        >
          <span className="text-5xl">👁️</span>
          <span className="text-white font-bold text-xl">Watch</span>
          <span className="text-gray-400 text-sm text-center leading-relaxed">
            View the broadcaster&apos;s<br />live camera feed.
          </span>
        </Link>
      </div>

      <p className="text-gray-600 text-xs text-center max-w-xs">
        Peer-to-peer via WebRTC — your video never touches our servers.
      </p>
    </div>
  );
}
