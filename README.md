# LinkedIn Bot (AI Construction Tech)

This bot runs locally and creates LinkedIn-ready posts based on **Google Trends + fresh Google News** about AI and construction tech.

## What it does on each run

1. Reads US daily Google Trends terms.
2. Finds recent Google News stories for AI construction technology.
3. Uses the latest OpenAI text model (`gpt-5`) to generate viral-style LinkedIn posts.
4. Uses OpenAI image generation (`gpt-image-1`) to create 5 carousel images per post.
5. Creates a run folder: `runs/YYYY-MM-DD-run-###`.
6. Stores a `.docx` file per post with the final post text, hashtags, source link, and image paths.

## Configure number of posts per run

In `src/index.js`, set this constant:

```js
const postsToCrete = "3";
```

> Keep it a number-like string (e.g., `"1"`, `"5"`).

## Local setup

```bash
npm install
export OPENAI_API_KEY="your_api_key_here"
npm start
```

On Windows PowerShell:

```powershell
npm install
$env:OPENAI_API_KEY="your_api_key_here"
npm start
```

## Output example

```text
runs/
  2026-03-30-run-001/
    post-01-....docx
    post-01-....-slide-01.png
    post-01-....-slide-02.png
    ...
```

## Notes

- This is designed for **manual local runs**.
- If Google Trends or Google News has temporary issues, rerun later.
- Generated content should always be reviewed by a human before publishing.
