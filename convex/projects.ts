import { mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const TTL = 30 * 60 * 1000;
function authorize(secret: string) {
  const expected = process.env.BRIDGEFOX_STORAGE_SECRET;
  if (!expected || secret !== expected) throw new Error("Unauthorized storage access");
}
export const uploadUrl = mutation({ args: { secret: v.string() }, handler: async (ctx, args) => {
  authorize(args.secret);
  return await ctx.storage.generateUploadUrl();
} });
export const register = mutation({ args: { secret: v.string(), projectId: v.string(), storageId: v.id("_storage"), bytes: v.number() }, handler: async (ctx, args) => {
  authorize(args.secret);
  const metadata = await ctx.db.system.get(args.storageId);
  if (!metadata || metadata.size > 512 * 1024 * 1024 || args.bytes < 0 || args.bytes > 256 * 1024 * 1024) throw new Error("Invalid stored project");
  const previous = await ctx.db.query("projects").withIndex("by_project", q => q.eq("projectId", args.projectId)).unique();
  if (previous) { await ctx.storage.delete(previous.storageId); await ctx.db.delete(previous._id); }
  const now = Date.now();
  const id = await ctx.db.insert("projects", { projectId: args.projectId, storageId: args.storageId, bytes: args.bytes, touched: now, expires: now + TTL });
  await ctx.scheduler.runAfter(TTL, internal.projects.expire, { id });
  const entries = await ctx.db.query("projects").withIndex("by_touched").collect();
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  let count = entries.length;
  for (const entry of entries) {
    if (entry.expires <= now || count > 4 || bytes > 512 * 1024 * 1024) {
      await ctx.storage.delete(entry.storageId); await ctx.db.delete(entry._id);
      count--; bytes -= entry.bytes;
    }
  }
  return args.projectId;
} });
export const recall = mutation({ args: { secret: v.string(), projectId: v.string() }, handler: async (ctx, args) => {
  authorize(args.secret);
  const entry = await ctx.db.query("projects").withIndex("by_project", q => q.eq("projectId", args.projectId)).unique();
  if (!entry || entry.expires <= Date.now()) return null;
  await ctx.db.patch(entry._id, { touched: Date.now(), expires: Date.now() + TTL });
  return await ctx.storage.getUrl(entry.storageId);
} });
export const uploadedFile = mutation({ args: { secret: v.string(), storageId: v.id("_storage"), maxBytes: v.number() }, handler: async (ctx, args) => {
  authorize(args.secret);
  const metadata = await ctx.db.system.get(args.storageId);
  if (!metadata || args.maxBytes > 512 * 1024 * 1024 || metadata.size > args.maxBytes) throw new Error("Upload exceeds file limits or is missing");
  return await ctx.storage.getUrl(args.storageId);
} });
export const removeFile = mutation({ args: { secret: v.string(), storageId: v.id("_storage") }, handler: async (ctx, args) => {
  authorize(args.secret); await ctx.storage.delete(args.storageId);
} });
export const expire = internalMutation({ args: { id: v.id("projects") }, handler: async (ctx, { id }) => {
  const entry = await ctx.db.get(id);
  if (!entry) return;
  if (entry.expires > Date.now()) { await ctx.scheduler.runAfter(entry.expires - Date.now(), internal.projects.expire, { id }); return; }
  await ctx.storage.delete(entry.storageId); await ctx.db.delete(id);
} });
export const cleanupFiles = internalMutation({ args: {}, handler: async ctx => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const retained = new Set((await ctx.db.query("projects").collect()).map(entry => entry.storageId));
  const files = await ctx.db.system.query("_storage").order("asc").take(100);
  for (const file of files) if (file._creationTime < cutoff && !retained.has(file._id)) await ctx.storage.delete(file._id);
} });
