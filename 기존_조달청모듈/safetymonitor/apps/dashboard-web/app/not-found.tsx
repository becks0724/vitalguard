export default function NotFound() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#0b0f17] text-white">
      <div className="text-center">
        <h2 className="text-2xl font-bold">404 - Not Found</h2>
        <p className="mt-2 text-zinc-400">요청하신 페이지를 찾을 수 없습니다.</p>
      </div>
    </div>
  );
}
