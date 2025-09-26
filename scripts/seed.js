import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectMongo } from '../src/db/mongo.js';
import Problem from '../src/models/problem.model.js';
import problems from '../src/data/problems.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const cn = await connectMongo();
  if (!cn) {
    console.error('[seed] Could not connect to Mongo. Check MONGODB_URI and DB_NAME in .env');
    process.exit(1);
  }
  try {
    let upserts = 0;
    for (const p of problems) {
      const filter = { $or: [{ id: p.id }, { slug: p.slug }] };
      const update = { $set: p };
      const opts = { upsert: true };
      await Problem.updateOne(filter, update, opts);
      upserts++;
    }
    let count = await Problem.countDocuments();

    // Ensure at least 50 problems of mixed difficulty
    const target = 50;
    if (count < target) {
      const startId = (await Problem.find({}).select('id').sort({ id: -1 }).limit(1).lean()).at(0)?.id || 0;
      const needed = target - count;
      console.log(`[seed] Generating ${needed} additional problems to reach ${target} total.`);

      const templates = [
        {
          key: 'two-sum',
          title: 'Two Sum',
          difficulty: 'Easy',
          tags: ['array', 'hashmap'],
          statement: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.',
          tests: [
            { input: [[2,7,11,15], 9], output: [0,1] },
            { input: [[3,2,4], 6], output: [1,2] }
          ],
        },
        {
          key: 'reverse-string',
          title: 'Reverse String',
          difficulty: 'Easy',
          tags: ['string', 'two-pointers'],
          statement: 'Reverse a string and return the result.',
          tests: [
            { input: ['hello'], output: 'olleh' },
            { input: ['a'], output: 'a' }
          ],
        },
        {
          key: 'valid-parentheses',
          title: 'Valid Parentheses',
          difficulty: 'Medium',
          tags: ['stack'],
          statement: 'Given a string containing just the characters (){}[], determine if the input string is valid.',
          tests: [
            { input: ['()[]{}'], output: true },
            { input: ['(]'], output: false }
          ],
        },
        {
          key: 'merge-intervals',
          title: 'Merge Intervals',
          difficulty: 'Medium',
          tags: ['intervals', 'sorting'],
          statement: 'Given an array of intervals where intervals[i] = [starti, endi], merge all overlapping intervals.',
          tests: [
            { input: [[[1,3],[2,6],[8,10],[15,18]]], output: [[1,6],[8,10],[15,18]] },
            { input: [[[1,4],[4,5]]], output: [[1,5]] }
          ],
        },
        {
          key: 'max-subarray',
          title: 'Maximum Subarray',
          difficulty: 'Medium',
          tags: ['array', 'dp'],
          statement: 'Given an integer array nums, find the contiguous subarray with the largest sum and return its sum.',
          tests: [
            { input: [[-2,1,-3,4,-1,2,1,-5,4]], output: 6 },
            { input: [[1]], output: 1 }
          ],
        },
        {
          key: 'word-ladder',
          title: 'Word Ladder Length',
          difficulty: 'Hard',
          tags: ['bfs', 'graph'],
          statement: 'Return the length of the shortest transformation sequence from beginWord to endWord using a given dictionary.',
          tests: [
            { input: ['hit','cog',['hot','dot','dog','lot','log','cog']], output: 5 }
          ],
        },
      ];

      function starterForJS(name){
        if (name==='two-sum') return `function solve(nums, target){\n  const m=new Map();\n  for(let i=0;i<nums.length;i++){const need=target-nums[i];if(m.has(need))return [m.get(need),i];m.set(nums[i],i);}\n  return [];\n}\nmodule.exports={ solve };`;
        if (name==='reverse-string') return `function solve(s){ return s.split('').reverse().join(''); }\nmodule.exports={ solve };`;
        if (name==='valid-parentheses') return `function solve(s){ const st=[]; const mp={')':'(',']':'[','}':'{'}; for(const c of s){ if(c in mp){ if(st.pop()!==mp[c]) return false;} else st.push(c);} return st.length===0;}\nmodule.exports={ solve };`;
        if (name==='merge-intervals') return `function solve(a){ a.sort((x,y)=>x[0]-y[0]); const out=[]; for(const it of a){ if(!out.length||out.at(-1)[1]<it[0]) out.push(it); else out.at(-1)[1]=Math.max(out.at(-1)[1], it[1]); } return out; }\nmodule.exports={ solve };`;
        if (name==='max-subarray') return `function solve(nums){ let best=nums[0], cur=nums[0]; for(let i=1;i<nums.length;i++){ cur=Math.max(nums[i],cur+nums[i]); best=Math.max(best,cur);} return best;}\nmodule.exports={ solve };`;
        return `function solve(){ /* TODO */ return null;}\nmodule.exports={ solve };`;
      }
      function starterForPy(name){
        if (name==='two-sum') return `def solve(nums, target):\n    m={}\n    for i,x in enumerate(nums):\n        need=target-x\n        if need in m: return [m[need], i]\n        m[x]=i\n    return []\n`;
        if (name==='reverse-string') return `def solve(s):\n    return s[::-1]\n`;
        if (name==='valid-parentheses') return `def solve(s):\n    st=[]; mp={')':'(',']':'[','}':'{'}\n    for c in s:\n        if c in mp:\n            if not st or st.pop()!=mp[c]:\n                return False\n        else:\n            st.append(c)\n    return len(st)==0\n`;
        if (name==='merge-intervals') return `def solve(a):\n    a.sort(key=lambda x:x[0])\n    out=[]\n    for s,e in a:\n        if not out or out[-1][1]<s:\n            out.append([s,e])\n        else:\n            out[-1][1]=max(out[-1][1], e)\n    return out\n`;
        if (name==='max-subarray') return `def solve(nums):\n    best=cur=nums[0]\n    for x in nums[1:]:\n        cur=max(x, cur+x)\n        best=max(best, cur)\n    return best\n`;
        return `def solve(*args, **kwargs):\n    return None\n`;
      }

      const extra = [];
      for (let i=0;i<needed;i++) {
        const t = templates[i % templates.length];
        const id = startId + i + 1;
        const slug = `${t.key}-${id}`;
        extra.push({
          id,
          slug,
          title: `${t.title} #${id}`,
          difficulty: t.difficulty,
          tags: t.tags,
          statement: t.statement,
          tests: t.tests,
          starterCode: {
            javascript: starterForJS(t.key),
            python: starterForPy(t.key),
            cpp: starterForCpp(t.key),
            java: starterForJava(t.key),
            rust: starterForRust(t.key)
          },
          timeLimitMs: 2000
        });
      }
      for (const p of extra) {
        await Problem.updateOne({ $or:[{ id: p.id }, { slug: p.slug }] }, { $set: p }, { upsert: true });
      }
      count = await Problem.countDocuments();
    }
    console.log(`[seed] Upserted ${upserts} from source. Total in DB now: ${count}`);
  } catch (e) {
    console.error('[seed] Error:', e);
  } finally {
    await mongoose.disconnect();
  }
}

main();
