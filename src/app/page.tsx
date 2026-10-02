import { getBackend } from "@/core/backend";
import { HomeClient, type HomeStats } from "@/components/home-client";

export const dynamic = "force-dynamic";

/** Landing đọc thông tin công khai qua backend. Không chạy benchmark trong request của người dùng. */
async function getStats(): Promise<HomeStats> {
  const empty = { places: 0, adminUnits: 0, documents: 0, provinces: 0, metrics: null, evalName: "vn-golden", evalCount: 0 };
  try {
    const backend = await getBackend();
    const stats = backend.capabilities.stats && backend.stats ? await backend.stats().catch(() => null) : null;
    return { ...empty, available: !!stats, backend: backend.id, ...(stats ?? {}) };
  } catch {
    return { ...empty, available: false, backend: "unavailable" };
  }
}

export default async function HomePage() {
  return <HomeClient stats={await getStats()} />;
}
