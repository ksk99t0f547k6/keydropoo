import { requireAdmin, readJson, errorResponse, HttpError } from "@/lib/server/http";
import { listHandouts, takeCode } from "@/lib/server/handouts";

const noStore = { "Cache-Control": "no-store" };

// 發放紀錄（含碼原文，只給管理員）。
export async function GET(request: Request) {
  try {
    const { env } = await requireAdmin(request);
    if (!env.CODE_ENCRYPTION_KEY) throw new HttpError(503, "ENCRYPTION_NOT_CONFIGURED");
    const params = Object.fromEntries(new URL(request.url).searchParams);
    return Response.json(await listHandouts(env.DB, env.CODE_ENCRYPTION_KEY, params), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

// 取一個碼：顯示即佔用。
export async function POST(request: Request) {
  try {
    const { env, session } = await requireAdmin(request);
    if (!env.CODE_ENCRYPTION_KEY) throw new HttpError(503, "ENCRYPTION_NOT_CONFIGURED");
    return Response.json(await takeCode(env.DB, env.CODE_ENCRYPTION_KEY, session.user.id, await readJson(request, 4096)), { status: 201, headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
