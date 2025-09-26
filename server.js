import express from 'express';
import morgan from 'morgan';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import problems from './src/data/problems.js';
import { runSubmission } from './src/judge/runner.js';
import axios from 'axios';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectMongo, isMongoConnected } from './src/db/mongo.js';
import UserModel from './src/models/user.model.js';
import ProblemModel from './src/models/problem.model.js';
import ProgressModel from './src/models/progress.model.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '1mb' }));
// Session store: prefer Mongo when URI is provided
const sessionOpts = {
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 },
};
if (process.env.MONGODB_URI) {
  sessionOpts.store = MongoStore.create({ mongoUrl: process.env.MONGODB_URI, dbName: process.env.DB_NAME });
}
app.use(session(sessionOpts));
// Protect certain static pages
app.use(async (req, res, next) => {
  if (req.method === 'GET' && (req.path === '/practice.html' || req.path === '/problem.html' || req.path === '/profile.html')) {
    const user = await getUserById(req.session.userId);
    if (!user) return res.redirect('/login.html');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Connect to Mongo if configured
let mongoReady = false;
(async () => {
  const cn = await connectMongo();
  mongoReady = !!cn;
  if (mongoReady) {
    try {
      await Promise.all([
        UserModel.syncIndexes?.(),
        ProblemModel.syncIndexes?.(),
        ProgressModel.syncIndexes?.()
      ]);
    } catch {}
  }
})();

// In-memory user store (prototype)
const users = new Map(); // key: email, value: { id, email, name, passwordHash }
let nextUserId = 1;

async function getUserById(id) {
  if (!id) return null;
  if (mongoReady) {
    try { return await UserModel.findById(id).lean(); } catch { return null; }
  }
  for (const u of users.values()) if (u.id === id) return u;
  return null;
}

// In-memory progress store: userId -> { solved:Set<number>, tags:Set<string>, points:number }
const progress = new Map();

// Rank tiers (inspired by LeetCode-like tiers)
const rankTiers = [
  { name: 'Newbie', min: 0 },
  { name: 'Bronze', min: 50 },
  { name: 'Silver', min: 150 },
  { name: 'Gold', min: 350 },
  { name: 'Platinum', min: 700 },
  { name: 'Diamond', min: 1200 },
  { name: 'Master', min: 2000 },
];

function getRank(points) {
  let current = rankTiers[0];
  for (const tier of rankTiers) {
    if (points >= tier.min) current = tier; else break;
  }
  const idx = rankTiers.findIndex(t => t.name === current.name);
  const next = rankTiers[idx + 1] || null;
  return { current, next };
}

async function requireAuth(req, res, next) {
  const uid = req.session.userId;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  const user = await getUserById(uid);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const passwordHash = bcrypt.hashSync(password, 10);
    if (mongoReady) {
      const exists = await UserModel.findOne({ email }).lean();
      if (exists) return res.status(409).json({ error: 'User already exists' });
      const created = await UserModel.create({ email, name: name || email.split('@')[0], passwordHash });
      req.session.userId = created._id.toString();
      return res.json({ id: created._id, email: created.email, name: created.name });
    } else {
      if (users.has(email)) return res.status(409).json({ error: 'User already exists' });
      const user = { id: nextUserId++, email, name: name || email.split('@')[0], passwordHash };
      users.set(email, user);
      req.session.userId = user.id;
      return res.json({ id: user.id, email: user.email, name: user.name });
    }
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (mongoReady) {
      const user = await UserModel.findOne({ email });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      const ok = bcrypt.compareSync(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      req.session.userId = user._id.toString();
      return res.json({ id: user._id, email: user.email, name: user.name });
    } else {
      const user = users.get(email);
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      const ok = bcrypt.compareSync(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      req.session.userId = user.id;
      return res.json({ id: user.id, email: user.email, name: user.name });
    }
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', async (req, res) => {
  const user = await getUserById(req.session.userId);
  if (!user) return res.status(401).json({});
  res.json({ id: user.id, email: user.email, name: user.name });
});

// API: Problems list (from file)
app.get('/api/problems', async (req, res) => {
  if (mongoReady) {
    const list = await ProblemModel.find({}, 'id title difficulty tags slug').lean();
    return res.json(list);
  }
  const lite = problems.map(({ id, title, difficulty, tags, slug }) => ({ id, title, difficulty, tags, slug }));
  res.json(lite);
});

// API: Problem by id or slug (from file)
app.get('/api/problems/:idOrSlug', async (req, res) => {
  const key = req.params.idOrSlug;
  if (mongoReady) {
    const byId = Number.isFinite(Number(key)) ? await ProblemModel.findOne({ id: Number(key) }).lean() : null;
    const bySlug = byId ? null : await ProblemModel.findOne({ slug: key }).lean();
    const prob = byId || bySlug;
    if (!prob) return res.status(404).json({ error: 'Problem not found' });
    return res.json(prob);
  }
  const prob = problems.find(p => String(p.id) === key || p.slug === key);
  if (!prob) return res.status(404).json({ error: 'Problem not found' });
  res.json(prob);
});

// API: Judge submission (from file)
app.post('/api/judge', requireAuth, async (req, res) => {
  try {
    const { problemId, language, code } = req.body;
    if (!problemId || !language || !code) {
      return res.status(400).json({ error: 'Missing required fields: problemId, language, code' });
    }
    const problem = mongoReady
      ? await ProblemModel.findOne({ id: problemId }).lean()
      : problems.find(p => p.id === problemId);
    if (!problem) return res.status(404).json({ error: 'Problem not found' });
    const result = await runSubmission({ language, code, tests: problem.tests, timeLimitMs: problem.timeLimitMs || 2000 });
    // Award points if Accepted
    if (result.status === 'Accepted') {
      const uid = req.session.userId;
      if (mongoReady) {
        let pg = await ProgressModel.findOne({ userId: uid });
        if (!pg) pg = await ProgressModel.create({ userId: uid, solved: [], tags: [], points: 0 });
        const solved = new Set(pg.solved);
        const firstSolve = !solved.has(problem.id);
        if (firstSolve) {
          solved.add(problem.id);
          const diff = (problem.difficulty || 'Easy').toLowerCase();
          const add = diff === 'hard' ? 50 : diff === 'medium' ? 30 : 15;
          const tags = new Set(pg.tags);
          (problem.tags || []).forEach(t => tags.add(String(t)));
          pg.solved = Array.from(solved);
          pg.points = (pg.points || 0) + add;
          pg.tags = Array.from(tags);
          pg.updatedAt = new Date();
          await pg.save();
        }
      } else {
        let pg = progress.get(uid);
        if (!pg) { pg = { solved: new Set(), tags: new Set(), points: 0 }; progress.set(uid, pg); }
        const firstSolve = !pg.solved.has(problem.id);
        if (firstSolve) {
          pg.solved.add(problem.id);
          const diff = (problem.difficulty || 'Easy').toLowerCase();
          const add = diff === 'hard' ? 50 : diff === 'medium' ? 30 : 15;
          pg.points += add;
          (problem.tags || []).forEach(t => pg.tags.add(String(t)));
        }
      }
    }
    res.json(result);
  } catch (err) {
    console.error('Judge error:', err);
    res.status(500).json({ error: 'Internal judge error' });
  }
});

// API: Profile - user progress, points, rank, tags
app.get('/api/profile', requireAuth, async (req, res) => {
  const uid = req.session.userId;
  if (mongoReady) {
    const pg = await ProgressModel.findOne({ userId: uid }).lean();
    const points = pg?.points || 0;
    const solved = pg?.solved || [];
    const tags = pg?.tags || [];
    const { current, next } = getRank(points);
    const totalProblems = await ProblemModel.countDocuments({});
    return res.json({
      solvedCount: solved.length,
      totalProblems,
      solvedProblems: solved,
      tags,
      points,
      rank: current.name,
      nextRank: next ? { name: next.name, atPoints: next.min, remaining: Math.max(0, next.min - points) } : null,
    });
  }
  const pg = progress.get(uid) || { solved: new Set(), tags: new Set(), points: 0 };
  const solved = Array.from(pg.solved);
  const tags = Array.from(pg.tags);
  const { current, next } = getRank(pg.points);
  const totalProblems = problems.length;
  res.json({
    solvedCount: solved.length,
    totalProblems,
    solvedProblems: solved,
    tags,
    points: pg.points,
    rank: current.name,
    nextRank: next ? { name: next.name, atPoints: next.min, remaining: Math.max(0, next.min - pg.points) } : null,
  });
});

// API: LLM Suggestion (Gemini/OpenAI/OpenRouter, else mock)
app.post('/api/llm/suggest', requireAuth, async (req, res) => {
  try {
    const { prompt, language, userCode, problemTitle, problemStatement, includeProblemContext } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const openAiKey = process.env.OPENAI_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    // Provider selection: Gemini first when configured
    const sys = 'You are an expert coding assistant. Provide concise, actionable hints and a short code snippet tailored to the user\'s query and code. Prefer correctness and clarity.';
    const useContext = !!includeProblemContext && !!problemTitle;
    const userMsg = useContext
      ? `Problem: ${problemTitle || 'N/A'}\nLanguage: ${language || 'N/A'}\nStatement:\n${problemStatement || 'N/A'}\n\nUser prompt: ${prompt}\n\nCurrent code:\n${(userCode || '').slice(0, 4000)}\n\nPlease provide:\n- 3-5 specific recommendations (bulleted)\n- A short, self-contained snippet for the core idea`
      : `Language: ${language || 'N/A'}\n\nUser prompt: ${prompt}\n\nCurrent code (if any):\n${(userCode || '').slice(0, 4000)}\n\nPlease provide:\n- 3-5 specific, actionable recommendations (bulleted)\n- A short, self-contained snippet for the core idea`;

    if (geminiKey) {
      try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: sys });
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: userMsg }]}],
          generationConfig: { temperature: 0.4 },
        });
        const text = result?.response?.text?.() || result?.response?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || '';
        return res.json({ model: modelName, content: text || '' });
      } catch (gErr) {
        console.warn('Gemini API failed, falling through to other providers:', gErr?.response?.data || gErr.message);
      }
    }

    // If neither OpenAI nor OpenRouter is configured, return tailored mock
    if (!openAiKey && !openRouterKey) {
      // Tailored mock based on title/statement/code/language
      const lang = (language || '').toLowerCase();
      const isJS = lang === 'javascript' || lang === 'js';
      const isPy = lang === 'python' || lang === 'py';
      const title = (problemTitle || '').toLowerCase();
      const probKey = (!!includeProblemContext && title)
        ? (title.includes('two sum') ? 'two-sum'
          : title.includes('reverse') ? 'reverse-string'
          : title.includes('fizz') ? 'fizz-buzz'
          : 'generic')
        : 'generic';

      function snippetFor(name) {
        if (name === 'two-sum') {
          return isPy
            ? "def solve(nums, target):\n    m = {}\n    for i, x in enumerate(nums):\n        need = target - x\n        if need in m: return [m[need], i]\n        m[x] = i\n    return []\n"
            : "function solve(nums, target){\n  const m = new Map();\n  for (let i=0;i<nums.length;i++){\n    const need = target - nums[i];\n    if (m.has(need)) return [m.get(need), i];\n    m.set(nums[i], i);\n  }\n  return [];\n}\nmodule.exports = { solve };";
        }
        if (name === 'reverse-string') {
          return isPy
            ? "def solve(s):\n    return s[::-1]\n"
            : "function solve(s){\n  return s.split('').reverse().join('');\n}\nmodule.exports = { solve };";
        }
        if (name === 'fizz-buzz') {
          return isPy
            ? "def solve(n):\n    out = []\n    for i in range(1, n+1):\n        s = ''\n        if i % 3 == 0: s += 'Fizz'\n        if i % 5 == 0: s += 'Buzz'\n        out.append(s or str(i))\n    return out\n"
            : "function solve(n){\n  const out = [];\n  for (let i=1;i<=n;i++){\n    let s='';\n    if (i%3===0) s+='Fizz';\n    if (i%5===0) s+='Buzz';\n    out.push(s||String(i));\n  }\n  return out;\n}\nmodule.exports = { solve };";
        }
        // Generic scaffold
        return isPy
          ? "def solve(*args, **kwargs):\n    # TODO: implement\n    return None\n"
          : "function solve(...args){\n  // TODO: implement\n  return null;\n}\nmodule.exports = { solve };";
      }

      let suggestions = [];
      if (useContext && probKey !== 'generic') {
        // lightweight problem-aware suggestions
        if (probKey === 'two-sum') {
          suggestions = [
            'Use a hash map for complement lookups to keep O(n) time.',
            'Insert current value after checking to avoid using the same index twice.',
            'Return indices immediately once a match is found.'
          ];
        } else if (probKey === 'reverse-string') {
          suggestions = [
            'Use built-in reverse operations or two-pointer swap.',
            'Handle empty and single-character strings gracefully.',
            'Keep it O(n) time; avoid unnecessary copies if constraints require.'
          ];
        } else if (probKey === 'fizz-buzz') {
          suggestions = [
            'Iterate 1..n and build output strings.',
            'Append "Fizz" for multiples of 3 and "Buzz" for multiples of 5.',
            'Append the number string if neither applies.'
          ];
        }
      }
      if (suggestions.length === 0) {
        // prompt-oriented generic advice
        suggestions = [
          'Break your request into smaller subproblems and implement step by step.',
          'Start with a minimal working version and then optimize hot spots.',
          'Write small tests or log statements to validate each piece.',
        ];
        if (userCode && /TODO|pass\b|return null|return None/.test(userCode)) {
          suggestions.unshift('Begin with a minimal working function and handle the simplest inputs first.');
        }
        if (userCode && /while\s*\(true\)|for\s*\(;;\)/.test(userCode)) {
          suggestions.push('Avoid unbounded loops; ensure a clear termination condition to prevent hangs.');
        }
      }
      return res.json({ model: 'mock-suggester', suggestions, snippet: snippetFor(probKey) });
    }

    // Provider selection: OpenAI first, then OpenRouter
    try {
      if (openAiKey) {
        const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userMsg }
          ],
          temperature: 0.4,
        }, {
          headers: {
            'Authorization': `Bearer ${openAiKey}`,
            'Content-Type': 'application/json'
          }
        });
        const content = resp.data.choices?.[0]?.message?.content || '';
        return res.json({ model: resp.data.model || 'openai', content });
      }

      // OpenRouter path
      const orModel = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
      const referer = process.env.SITE_URL || `http://localhost:${PORT}`;
      const title = process.env.SITE_TITLE || 'AI Coding Practice';
      const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: orModel,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userMsg }
        ],
        temperature: 0.4,
      }, {
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'HTTP-Referer': referer,
          'X-Title': title,
          'Content-Type': 'application/json'
        }
      });
      const content = resp.data.choices?.[0]?.message?.content || '';
      return res.json({ model: resp.data.model || orModel, content });
    } catch (apiErr) {
      console.warn('LLM API failed, falling back to mock:', apiErr?.response?.data || apiErr.message);
      // Fallback to the same tailored mock as above
      const lang = (language || '').toLowerCase();
      const isJS = lang === 'javascript' || lang === 'js';
      const isPy = lang === 'python' || lang === 'py';
      const title = (problemTitle || '').toLowerCase();
      const probKey = (!!includeProblemContext && title)
        ? (title.includes('two sum') ? 'two-sum'
          : title.includes('reverse') ? 'reverse-string'
          : title.includes('fizz') ? 'fizz-buzz'
          : 'generic')
        : 'generic';
      function snippetFor(name) {
        if (name === 'two-sum') return isPy ? "def solve(nums, target):\n    m = {}\n    for i, x in enumerate(nums):\n        need = target - x\n        if need in m: return [m[need], i]\n        m[x] = i\n    return []\n" : "function solve(nums, target){\n  const m = new Map();\n  for (let i=0;i<nums.length;i++){\n    const need = target - nums[i];\n    if (m.has(need)) return [m.get(need), i];\n    m.set(nums[i], i);\n  }\n  return [];\n}\nmodule.exports = { solve };";
        if (name === 'reverse-string') return isPy ? "def solve(s):\n    return s[::-1]\n" : "function solve(s){\n  return s.split('').reverse().join('');\n}\nmodule.exports = { solve };";
        if (name === 'fizz-buzz') return isPy ? "def solve(n):\n    out = []\n    for i in range(1, n+1):\n        s = ''\n        if i % 3 == 0: s += 'Fizz'\n        if i % 5 == 0: s += 'Buzz'\n        out.append(s or str(i))\n    return out\n" : "function solve(n){\n  const out = [];\n  for (let i=1;i<=n;i++){\n    let s='';\n    if (i%3===0) s+='Fizz';\n    if (i%5===0) s+='Buzz';\n    out.push(s||String(i));\n  }\n  return out;\n}\nmodule.exports = { solve };";
        return isPy ? "def solve(*args, **kwargs):\n    # TODO: implement\n    return None\n" : "function solve(...args){\n  // TODO: implement\n  return null;\n}\nmodule.exports = { solve };";
      }
      let suggestions = [];
      if (useContext && probKey !== 'generic') {
        if (probKey === 'two-sum') suggestions = [
          'Use a hash map for complement lookups to keep O(n) time.',
          'Insert current value after checking to avoid duplicate index.',
          'Return indices immediately once a match is found.'
        ];
        else if (probKey === 'reverse-string') suggestions = [
          'Use built-ins or two pointers to reverse characters.',
          'Handle empty strings properly.',
          'Keep it O(n) time.'
        ];
        else if (probKey === 'fizz-buzz') suggestions = [
          'Iterate 1..n creating output strings.',
          'Concatenate Fizz/Buzz for divisibility.',
          'Use the number string otherwise.'
        ];
      }
      if (suggestions.length === 0) {
        suggestions = [
          'Decompose your goal and implement pieces iteratively.',
          'Start with a simple, correct version then refine.',
          'Add basic tests or logs to validate behavior.'
        ];
      }
      return res.json({ model: 'mock-fallback', suggestions, snippet: snippetFor(probKey) });
    }
  } catch (err) {
    console.error('LLM suggest error:', err);
    res.status(500).json({ error: 'Internal LLM error' });
  }
});

// Fallback to index.html for root
app.get('/', async (req, res) => {
  // If not logged in, redirect to login page
  const user = await getUserById(req.session.userId);
  if (!user) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Health: DB connectivity
app.get('/api/health/db', async (req, res) => {
  try {
    const state = mongoose.connection?.readyState; // 1=connected, 2=connecting
    let ping = null;
    if (state === 1) {
      try {
        const admin = mongoose.connection.db.admin();
        const pong = await admin.command({ ping: 1 });
        ping = pong?.ok === 1 ? 'ok' : 'unknown';
      } catch (e) {
        ping = 'failed';
      }
    }
    res.json({ mongoReady, readyState: state, ping });
  } catch (e) {
    res.status(500).json({ mongoReady: false, error: String(e.message || e) });
  }
});


app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
