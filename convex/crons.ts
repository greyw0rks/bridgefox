import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval("remove abandoned uploads and exports", { minutes: 30 }, internal.projects.cleanupFiles);
export default crons;
