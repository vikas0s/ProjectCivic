/**
 * Sarkari Result Scraper — fetches and parses job data from sarkariresult.com.cm via ZenRows
 */
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "data", "jobs.json");

// Ensure data directory exists
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/** Extract status tag from a job title */
function extractTag(title) {
  const lower = title.toLowerCase();
  if (lower.includes("last date today")) return "Last Date Today";
  if (lower.includes("– start") || lower.includes("- start") || lower.endsWith("start")) return "Start";
  if (lower.includes("– out") || lower.includes("- out") || lower.endsWith("out")) return "Out";
  if (lower.includes("– soon") || lower.includes("- soon") || lower.endsWith("soon")) return "Soon";
  if (lower.includes("– updated") || lower.includes("- updated") || lower.endsWith("updated")) return "Updated";
  if (lower.includes("date extend")) return "Date Extend";
  if (lower.includes("link active")) return "Link Active";
  return null;
}

/**
 * Category detection by section heading found above the <ul>
 * The HTML has headings like "Results", "Admit Cards", "Latest Jobs", "Answer Key", "Documents", "Admission"
 */
const SECTION_MAP = {
  results: "results",
  result: "results",
  "admit cards": "admit-card",
  "admit card": "admit-card",
  "latest jobs": "latest-jobs",
  "latest job": "latest-jobs",
  "answer key": "answer-key",
  "answer keys": "answer-key",
  documents: "documents",
  document: "documents",
  admission: "admission",
  admissions: "admission",
};

function detectCategory(headingText) {
  const lower = (headingText || "").toLowerCase().trim();
  for (const [key, value] of Object.entries(SECTION_MAP)) {
    if (lower.includes(key)) return value;
  }
  return "latest-jobs"; // default
}

/**
 * Fetch HTML from Sarkari Result via ZenRows
 */
async function fetchHTML(apiKey) {
  const targetUrl = "https://sarkariresult.com.cm/";
  const zenrowsUrl = `https://api.zenrows.com/v1/?apikey=${apiKey}&url=${encodeURIComponent(targetUrl)}&js_render=false`;

  console.log(`[Scraper] Fetching ${targetUrl} via ZenRows...`);
  const response = await axios.get(zenrowsUrl, { timeout: 30000 });
  return response.data;
}

/**
 * Parse HTML and extract job listings
 */
function parseJobs(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  // The main content area has sections with headings followed by <ul class="wp-block-latest-posts__list">
  // Each section is inside a gb-container with a gb-headline (category name) followed by the list
  $(".gb-grid-wrapper-180dce95 .gb-grid-column").each((_, column) => {
    const $col = $(column);

    // Find the heading text
    const headingText = $col.find(".gb-headline-text").first().text().trim();
    const category = detectCategory(headingText);

    // Find all links in the latest-posts list
    $col.find(".wp-block-latest-posts__list a, ul.wp-block-latest-posts a").each((__, link) => {
      const $link = $(link);
      const title = $link.text().trim();
      const href = $link.attr("href");

      if (title && href) {
        jobs.push({
          title,
          link: href,
          category,
          tag: extractTag(title),
        });
      }
    });
  });

  // Also parse the highlighted/featured jobs at the top (gb-container-0d9861a2)
  $(".gb-container-0d9861a2 .gb-headline-text a").each((_, link) => {
    const $link = $(link);
    const title = $link.text().trim();
    const href = $link.attr("href");

    if (title && href) {
      jobs.push({
        title,
        link: href,
        category: "latest-jobs",
        tag: extractTag(title) || "New",
      });
    }
  });

  return jobs;
}

/**
 * Deduplicate jobs by link URL
 */
function deduplicateJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    // Normalize link: remove trailing slash for comparison
    const normalizedLink = job.link.replace(/\/$/, "").toLowerCase();
    if (seen.has(normalizedLink)) return false;
    seen.add(normalizedLink);
    return true;
  });
}

/**
 * Load existing jobs from disk
 */
function loadExistingJobs() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error("[Scraper] Error loading existing jobs:", err.message);
  }
  return { lastUpdated: null, totalJobs: 0, jobs: [] };
}

/**
 * Save jobs to disk
 */
function saveJobs(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Main scrape function — fetches, parses, deduplicates, and saves
 * @returns {{ newCount: number, totalJobs: number }} stats
 */
export async function scrapeAndUpdate(apiKey) {
  const startTime = Date.now();

  try {
    // 1. Fetch HTML from ZenRows
    const html = await fetchHTML(apiKey);
    console.log(`[Scraper] Fetched HTML (${html.length} chars) in ${Date.now() - startTime}ms`);

    // 2. Parse jobs from HTML
    const freshJobs = parseJobs(html);
    console.log(`[Scraper] Parsed ${freshJobs.length} jobs from HTML`);

    // 3. Load existing data
    const existing = loadExistingJobs();
    const existingLinks = new Set(
      existing.jobs.map((j) => j.link.replace(/\/$/, "").toLowerCase())
    );

    // 4. Find truly new jobs
    const newJobs = freshJobs.filter(
      (j) => !existingLinks.has(j.link.replace(/\/$/, "").toLowerCase())
    );

    // 5. Merge: new jobs first, then existing (deduped)
    const merged = deduplicateJobs([...newJobs, ...freshJobs, ...existing.jobs]);

    // 6. Mark new jobs
    const now = new Date().toISOString();
    const markedJobs = merged.map((job) => {
      const isNew = newJobs.some(
        (nj) => nj.link.replace(/\/$/, "").toLowerCase() === job.link.replace(/\/$/, "").toLowerCase()
      );
      return {
        ...job,
        isNew: isNew || false,
        lastSeen: now,
      };
    });

    // 7. Save
    const data = {
      lastUpdated: now,
      totalJobs: markedJobs.length,
      scrapeTimeMs: Date.now() - startTime,
      jobs: markedJobs,
    };
    saveJobs(data);

    console.log(
      `[Scraper] Done! ${newJobs.length} new jobs, ${markedJobs.length} total. Took ${Date.now() - startTime}ms`
    );

    return { newCount: newJobs.length, totalJobs: markedJobs.length };
  } catch (err) {
    console.error("[Scraper] Error during scrape:", err.message);
    throw err;
  }
}

/**
 * Get all stored jobs (read from disk)
 */
export function getStoredJobs() {
  return loadExistingJobs();
}
