import { publicConfig } from "@/lib/otari";
import { cloudConfigured } from "@/lib/cloud-store";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json({ ...publicConfig(), directUploads: cloudConfigured() }); }
