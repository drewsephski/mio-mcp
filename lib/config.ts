import "server-only";
import { z } from "zod";
import { resourceIdSchema } from "./notes-validation";

const publicConfigSchema = z.object({
  endpoint: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost");
  }, "Appwrite endpoint must use HTTPS"),
  projectId: resourceIdSchema,
});

const resourceIdsSchema = z.object({
  databaseId: resourceIdSchema.default("mio"),
  notesTableId: resourceIdSchema.default("notes"),
  attachmentsTableId: resourceIdSchema.default("attachments"),
  attachmentsBucketId: resourceIdSchema.default("68d143bf001b9a793c30"),
});

export function getPublicAppwriteConfig() {
  return publicConfigSchema.parse({
    endpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT,
    projectId: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID,
  });
}

export function getServerAppwriteConfig() {
  return {
    ...getPublicAppwriteConfig(),
    apiKey: z.string().min(1, "APPWRITE_API_KEY is required").parse(process.env.APPWRITE_API_KEY),
  };
}

export function getResourceIds() {
  return resourceIdsSchema.parse({
    databaseId: process.env.APPWRITE_DATABASE_ID,
    notesTableId: process.env.APPWRITE_NOTES_TABLE_ID,
    attachmentsTableId: process.env.APPWRITE_ATTACHMENTS_TABLE_ID,
    attachmentsBucketId: process.env.APPWRITE_ATTACHMENTS_BUCKET_ID,
  });
}
