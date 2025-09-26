# AI Coding Practice Platform

A minimal full-stack web app featuring:

- AI-assisted coding recommendations
- In-browser code editor with starter code, indentation, autocomplete, and Format button
- Online judge for JavaScript and Python with per-test results
- Practice list and problem pages served from MongoDB

## Quick Start

Prerequisites:

- Node.js 18+
- (Optional) Python installed and available as `python` in PATH for Python judging
- MongoDB Atlas or local Mongo instance

Setup:

```bash
npm install
cp .env.example .env   # or create .env manually
# set MONGODB_URI, DB_NAME, PORT, SESSION_SECRET, and optional OpenAI/OpenRouter keys

# seed problems into Mongo
npm run seed:problems

# run server (dev or prod are same entrypoint)
npm start
```

Then open http://localhost:3000

## Environment Variables

Copy `.env.example` to `.env` and set values if needed:

- `PORT`: Server port (default 3000)
- `SESSION_SECRET`: Session secret string
- `MONGODB_URI`: Mongo connection string
- `DB_NAME`: Database name (e.g. `ai-coding-practice`)
- `OPENAI_API_KEY` / `OPENAI_MODEL` (optional)
- `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` (optional)

## Project Structure

- `server.js` — Express server, API routes, static file serving
- `src/data/problems.js` — Seed data source for problems
- `src/judge/runner.js` — Judge implementation for JS/Python with timeouts
- `src/db/mongo.js` — Mongoose connection helper
- `src/models/*.js` — Mongoose models for User, Problem, Progress
- `public/` — Frontend pages and assets
  - `index.html` — Dashboard with navbar
  - `practice.html` — Problem list page
  - `problem.html` — Problem detail/editor/judge/AI page
  - `styles.css` — Styling
  - CodeMirror 5 is used for the editor (JS/Python modes, autocomplete, format button)
- `scripts/seed.js` — Seed/ensure 50+ problems in Mongo

## API Overview

- `GET /api/problems` — List problems (id, title, difficulty, tags, slug)
- `GET /api/problems/:idOrSlug` — Get problem details by ID or slug
- `POST /api/judge` — Body: `{ problemId, language: 'javascript'|'python', code }`. Returns per-test results and status.
- `POST /api/llm/suggest` — Body: `{ prompt, language, userCode, problemTitle, problemStatement }`. Uses OpenAI/OpenRouter if configured; otherwise returns mocked suggestions.
- `GET /api/health/db` — MongoDB connectivity check

## Notes on the Judge

- JavaScript runs with Node via `node -e` and expects a `solve` function. You may export via `module.exports = { solve }` or define `function solve(...) {}`.
- Python runs via `python -c` and expects a `solve` function. Make sure `python` command is available in PATH. If your system uses `py`/`python3`, adjust accordingly in `src/judge/runner.js` or your PATH.
- Time limit is per test (default 2s). Long-running or infinite loops will be terminated.
- This is a local prototype. Executing arbitrary code is inherently unsafe; do not expose publicly without sandboxing.

## Extending

- Add more problems by appending to `src/data/problems.js` and re-running the seed script.
- Enhance AI integration by passing richer context and streaming responses.
- Persist editor content per user/problem in Mongo.

## License

MIT
