import { AppwriteException } from "node-appwrite";
import { unstable_rethrow } from "next/navigation";
import { getActionError } from "@/lib/errors";
import { getNotesService } from "@/lib/notes";
import { NotesError } from "@/lib/notes-service";
import { downloadDisposition, resourceIdSchema } from "@/lib/notes-validation";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  try {
    const { attachmentId } = await context.params;
    const parsed = resourceIdSchema.safeParse(attachmentId);
    if (!parsed.success) return Response.json({ error: "Invalid attachment ID." }, { status: 400 });
    const { attachment, content } = await (await getNotesService()).downloadAttachment(parsed.data);
    return new Response(content, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": downloadDisposition(attachment.name),
        "Content-Length": String(content.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    unstable_rethrow(error);
    const status = error instanceof NotesError ? error.status : error instanceof AppwriteException && [401, 403, 404, 429].includes(error.code) ? error.code : 503;
    return Response.json({ error: getActionError(error) }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
