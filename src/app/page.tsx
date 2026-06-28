import Link from 'next/link';

const CAM_ROOMS = ['cam1', 'cam2', 'cam3', 'cam4'];

export default function Landing() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0a] gap-10 p-6">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white tracking-tight">GMI Cam</h1>
        <p className="text-gray-500 mt-2 text-sm">Multi-camera · WebRTC · OBS ready</p>
      </div>

      <div className="flex flex-col gap-6 w-full max-w-sm">
        {/* Broadcast */}
        <div>
          <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Broadcast a camera</p>
          <div className="grid grid-cols-2 gap-2">
            {CAM_ROOMS.map((room) => (
              <Link
                key={room}
                href={`/broadcast?room=${room}`}
                className="flex items-center justify-between bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/50 rounded-xl px-4 py-3 transition-all"
              >
                <span className="text-white font-semibold text-sm uppercase">{room}</span>
                <span className="text-white/30 text-lg">📡</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Watch */}
        <Link
          href="/watch"
          className="flex items-center justify-between bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-500/50 rounded-xl px-5 py-4 transition-all"
        >
          <div>
            <p className="text-white font-bold">Watch</p>
            <p className="text-gray-500 text-xs mt-0.5">See all active cameras</p>
          </div>
          <span className="text-2xl">👁️</span>
        </Link>
      </div>

      <p className="text-gray-700 text-xs text-center max-w-xs">
        Open multiple broadcast tabs for multi-cam. Video is peer-to-peer — never touches the server.
      </p>
    </div>
  );
}
