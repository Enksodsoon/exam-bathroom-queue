import { apiJson } from "@/lib/api/http";
import { getStorageHealth } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = getStorageHealth();
  return apiJson(health, health.ok ? 200 : 500);
}
