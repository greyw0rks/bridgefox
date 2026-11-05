import { publicConfig } from "@/lib/otari";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json(publicConfig()); }
