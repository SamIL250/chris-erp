import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Scheduled jobs. Low stock runs once a day at 06:00 UTC (08:00 in
 * UTC+2) and notifies inventory editors about slices that have newly
 * fallen to their reorder point (PH1-24).
 */
const crons = cronJobs();

crons.daily("low stock", { hourUTC: 6, minuteUTC: 0 }, internal.inventory.lowStock.scan);

export default crons;
