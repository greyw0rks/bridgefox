import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({ projectId: v.string(), storageId: v.id("_storage"), bytes: v.number(), touched: v.number(), expires: v.number() }).index("by_project", ["projectId"]).index("by_touched", ["touched"]),
});
