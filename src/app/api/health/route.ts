import { apiJson } from "@/lib/api/http";
import { getSessionStore, getStorageHealth } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = getStorageHealth();
  if (!health.ok) {
    return apiJson(health, 500);
  }

  try {
    const store = getSessionStore();
    await store.ping();
    return apiJson(health, 200);
  } catch {
    return apiJson(
      {
        ok: false,
        storage: health.storage,
        error: "Storage unavailable",
      },
      503,
    );
  }
}
