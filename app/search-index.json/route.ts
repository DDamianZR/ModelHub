import { getSearchIndex } from "@/lib/views";

// Built once at build time from /data; the command palette fetches it on first open.
export const dynamic = "force-static";

export function GET() {
  return Response.json(getSearchIndex());
}
