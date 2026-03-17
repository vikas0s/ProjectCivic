/**
 * Cron job — runs the scraper every 10 minutes
 */
import cron from "node-cron";
import { scrapeAndUpdate } from "./scraper.js";

let isRunning = false;

export function startCronJob(apiKey) {
  if (!apiKey) {
    console.error("[Cron] ZENROWS_API_KEY is not set. Cron job will not start.");
    return;
  }

  // Run immediately on startup
  console.log("[Cron] Running initial scrape...");
  runScrape(apiKey);

  // Schedule every 10 minutes: "*/10 * * * *"
  cron.schedule("*/10 * * * *", () => {
    console.log(`[Cron] Scheduled scrape triggered at ${new Date().toLocaleString()}`);
    runScrape(apiKey);
  });

  console.log("[Cron] Scheduled scrape every 10 minutes.");
}

async function runScrape(apiKey) {
  if (isRunning) {
    console.log("[Cron] Scrape already in progress, skipping...");
    return;
  }

  isRunning = true;
  try {
    const result = await scrapeAndUpdate(apiKey);
    console.log(
      `[Cron] Scrape complete: ${result.newCount} new jobs, ${result.totalJobs} total`
    );
  } catch (err) {
    console.error("[Cron] Scrape failed:", err.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Manually trigger a scrape (for the /api/scrape endpoint)
 */
export async function triggerManualScrape(apiKey) {
  if (isRunning) {
    return { status: "already_running", message: "A scrape is already in progress" };
  }
  isRunning = true;
  try {
    const result = await scrapeAndUpdate(apiKey);
    return { status: "success", ...result };
  } catch (err) {
    return { status: "error", message: err.message };
  } finally {
    isRunning = false;
  }
}
