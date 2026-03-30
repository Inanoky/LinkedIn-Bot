import fs from "fs/promises";
import path from "path";
import Parser from "rss-parser";
import googleTrends from "google-trends-api";
import OpenAI from "openai";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";

// User-requested hardcoded constant.
const postsToCrete = "3";

const MODEL = "gpt-5";
const IMAGE_MODEL = "gpt-image-1";
const MAX_TREND_TERMS = 12;
const MAX_NEWS_PER_TERM = 3;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const parser = new Parser();

function formatDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function getNextRunNumber(baseOutputDir, dateString) {
  await ensureDirectory(baseOutputDir);
  const entries = await fs.readdir(baseOutputDir, { withFileTypes: true });
  const prefix = `${dateString}-run-`;
  const runNumbers = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => Number.parseInt(entry.name.replace(prefix, ""), 10))
    .filter((value) => Number.isFinite(value));

  return runNumbers.length === 0 ? 1 : Math.max(...runNumbers) + 1;
}

function pickConstructionAiTerms(queries) {
  const keywords = [
    "ai",
    "artificial intelligence",
    "construction",
    "robot",
    "automation",
    "building",
    "bim",
    "infrastructure",
    "engineering",
    "digital twin",
  ];

  const unique = [...new Set(queries.map((q) => q?.trim()).filter(Boolean))];

  const scored = unique
    .map((term) => {
      const lower = term.toLowerCase();
      const score = keywords.reduce((acc, keyword) => (lower.includes(keyword) ? acc + 1 : acc), 0);
      return { term, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TREND_TERMS);

  return scored.map((item) => item.term);
}

async function fetchTrendTerms() {
  const raw = await googleTrends.dailyTrends({
    trendDate: new Date(),
    geo: "US",
  });

  const parsed = JSON.parse(raw);
  const days = parsed.default?.trendingSearchesDays ?? [];

  const terms = days.flatMap((day) =>
    (day.trendingSearches ?? []).map((search) => search.title?.query).filter(Boolean)
  );

  return pickConstructionAiTerms(terms);
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 60);
}

async function fetchNewsForTerm(term) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
    `${term} AI construction technology`
  )}&hl=en-US&gl=US&ceid=US:en`;

  const feed = await parser.parseURL(rssUrl);
  return (feed.items ?? []).slice(0, MAX_NEWS_PER_TERM).map((item) => ({
    title: item.title,
    link: item.link,
    pubDate: item.pubDate,
    contentSnippet: item.contentSnippet,
    source: item.source?.name ?? "Google News",
    term,
  }));
}

async function collectNewsCandidates() {
  const terms = await fetchTrendTerms();
  const bundles = await Promise.all(terms.map((term) => fetchNewsForTerm(term).catch(() => [])));

  const flattened = bundles.flat();
  const deduped = [];
  const seen = new Set();

  for (const item of flattened) {
    const key = `${item.title}|${item.link}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  return deduped;
}

async function generatePostAndSlides(newsItem) {
  const prompt = `
You are a LinkedIn growth strategist specialized in AEC (architecture, engineering, construction).
Create one highly engaging LinkedIn post in JSON only.

Requirements:
- Topic: latest AI + construction technology news.
- Use strong viral hooks (pattern interrupt opening, curiosity, practical insight, clear CTA).
- Keep tone professional but energetic.
- Include: hook, postBody, bulletTakeaways (3-5), cta, hashtags (8-12), carouselSlides (exactly 5).
- Each carousel slide: title, body (max 25 words), imagePrompt.
- No markdown fences. Return valid JSON only.

News context:
Title: ${newsItem.title}
Snippet: ${newsItem.contentSnippet ?? "N/A"}
Source: ${newsItem.source}
Published: ${newsItem.pubDate ?? "N/A"}
URL: ${newsItem.link}
Trend term: ${newsItem.term}
`;

  const response = await openai.responses.create({
    model: MODEL,
    input: prompt,
  });

  const text = response.output_text?.trim();
  if (!text) {
    throw new Error("OpenAI returned empty text for post generation.");
  }

  return JSON.parse(text);
}

async function generateCarouselImages(slides, outputDir, prefix) {
  const paths = [];

  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i];
    const imageResponse = await openai.images.generate({
      model: IMAGE_MODEL,
      prompt: `LinkedIn carousel image, clean modern visual style, 1:1 composition. ${slide.imagePrompt}`,
      size: "1024x1024",
    });

    const b64 = imageResponse.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error(`Missing image data for slide ${i + 1}.`);
    }

    const filePath = path.join(outputDir, `${prefix}-slide-${String(i + 1).padStart(2, "0")}.png`);
    await fs.writeFile(filePath, Buffer.from(b64, "base64"));
    paths.push(filePath);
  }

  return paths;
}

async function createDocx(postData, newsItem, imagePaths, outputDocPath) {
  const lines = [
    new Paragraph({ text: postData.hook ?? "", heading: HeadingLevel.HEADING_1 }),
    new Paragraph(postData.postBody ?? ""),
    new Paragraph({ text: "Key Takeaways", heading: HeadingLevel.HEADING_2 }),
    ...(postData.bulletTakeaways ?? []).map((t) =>
      new Paragraph({
        children: [new TextRun(`• ${t}`)],
      })
    ),
    new Paragraph({ text: "Call To Action", heading: HeadingLevel.HEADING_2 }),
    new Paragraph(postData.cta ?? ""),
    new Paragraph({ text: "Hashtags", heading: HeadingLevel.HEADING_2 }),
    new Paragraph((postData.hashtags ?? []).join(" ")),
    new Paragraph({ text: "Source News", heading: HeadingLevel.HEADING_2 }),
    new Paragraph(`${newsItem.title}`),
    new Paragraph(`${newsItem.link}`),
    new Paragraph({ text: "Carousel Assets", heading: HeadingLevel.HEADING_2 }),
    ...imagePaths.map((p, idx) => new Paragraph(`Slide ${idx + 1}: ${p}`)),
  ];

  const doc = new Document({ sections: [{ children: lines }] });
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outputDocPath, buffer);
}

async function run() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }

  const postCount = Number.parseInt(postsToCrete, 10);
  if (!Number.isFinite(postCount) || postCount <= 0) {
    throw new Error(`postsToCrete must be a positive number string. Received: ${postsToCrete}`);
  }

  const today = formatDate();
  const baseOutputDir = path.join(process.cwd(), "runs");
  const runNumber = await getNextRunNumber(baseOutputDir, today);
  const runDir = path.join(baseOutputDir, `${today}-run-${String(runNumber).padStart(3, "0")}`);
  await ensureDirectory(runDir);

  console.log(`Starting LinkedIn bot run in: ${runDir}`);

  const newsCandidates = await collectNewsCandidates();
  if (newsCandidates.length === 0) {
    throw new Error("No news candidates found from Google Trends + Google News.");
  }

  for (let i = 0; i < postCount; i += 1) {
    const newsItem = newsCandidates[i % newsCandidates.length];
    const postData = await generatePostAndSlides(newsItem);

    const safeTitle = sanitizeName(newsItem.title ?? `post-${i + 1}`);
    const postPrefix = `post-${String(i + 1).padStart(2, "0")}-${safeTitle}`;

    const imagePaths = await generateCarouselImages(postData.carouselSlides ?? [], runDir, postPrefix);

    const outputDocPath = path.join(runDir, `${postPrefix}.docx`);
    await createDocx(postData, newsItem, imagePaths, outputDocPath);

    console.log(`Created post ${i + 1}/${postCount}: ${outputDocPath}`);
  }

  console.log("LinkedIn bot run completed successfully.");
}

run().catch((error) => {
  console.error("Bot run failed:", error.message);
  process.exitCode = 1;
});
