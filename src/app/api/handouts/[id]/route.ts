import { requireAdmin, readJson, errorResponse, HttpError } from "@/lib/server/http";
import { undoHandout, updateHandout } from "@/lib/server/handouts";

const noStore = { "Cache-Control": "no-store" };

// 補填或修改收件人、管道與備註。
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { env } = await requireAdmin(request);
    if (!env.CODE_ENCRYPTION_KEY) throw new HttpError(503, "ENCRYPTION_NOT_CONFIGURED");
    return Response.json(await updateHandout(env.DB, env.CODE_ENCRYPTION_KEY, (await params).id, await readJson(request, 4096)), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

// 撤回發放：碼若沒被兌換或交給別人就放回庫存。
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { env } = await requireAdmin(request);
    if (!env.CODE_ENCRYPTION_KEY) throw new HttpError(503, "ENCRYPTION_NOT_CONFIGURED");
    return Response.json(await undoHandout(env.DB, env.CODE_ENCRYPTION_KEY, (await params).id), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
