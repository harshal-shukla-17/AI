import { execFile } from 'child_process';
import axios from 'axios';

// Piston API configuration and runtime version discovery
const PISTON_URL = process.env.PISTON_URL || 'https://emkc.org/api/v2/piston';
const PISTON_CPP_VERSION = process.env.PISTON_CPP_VERSION || null;
const PISTON_JAVA_VERSION = process.env.PISTON_JAVA_VERSION || null;
const PISTON_RUST_VERSION = process.env.PISTON_RUST_VERSION || null;

const pistonVersionCache = new Map(); // key: lang -> version

async function getPistonVersion(lang) {
  if (lang === 'javascript' || lang === 'python') return null;
  if (pistonVersionCache.has(lang)) return pistonVersionCache.get(lang);
  const envPreferred = lang === 'cpp' ? PISTON_CPP_VERSION : lang === 'java' ? PISTON_JAVA_VERSION : lang === 'rust' ? PISTON_RUST_VERSION : null;
  if (envPreferred) { pistonVersionCache.set(lang, envPreferred); return envPreferred; }
  try {
    const { data } = await axios.get(`${PISTON_URL}/runtimes`, { timeout: 8000 });
    const targets = Array.isArray(data) ? data : [];
    function pick(nameList) {
      const list = targets.filter(r => nameList.includes(String(r.language).toLowerCase()));
      if (!list.length) return null;
      list.sort((a, b) => String(b.version).localeCompare(String(a.version)));
      return list[0].version;
    }
    let version = null;
    if (lang === 'cpp') version = pick(['c++','cpp','gcc']);
    else if (lang === 'java') version = pick(['java']);
    else if (lang === 'rust') version = pick(['rust']);
    if (!version) version = 'latest';
    pistonVersionCache.set(lang, version);
    return version;
  } catch {
    const fallback = 'latest';
    pistonVersionCache.set(lang, fallback);
    return fallback;
  }
}

// --- Literal helpers for harness generation (limited to current problems) ---
function escStr(s){ return String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"'); }
function isNum(x){ return typeof x === 'number' && isFinite(x); }
function isStr(x){ return typeof x === 'string'; }
function isArr(x){ return Array.isArray(x); }

function cppLiteral(v){
  if (isNum(v)) return String(Math.trunc(v));
  if (isStr(v)) return `"${escStr(v)}"`;
  if (isArr(v)){
    if (v.every(isNum)) return `{ ${v.map(cppLiteral).join(', ')} }`;
    if (v.every(isStr)) return `{ ${v.map(cppLiteral).join(', ')} }`;
  }
  return '{}';
}

function javaLiteral(v){
  if (isNum(v)) return String(Math.trunc(v));
  if (isStr(v)) return `"${escStr(v)}"`;
  if (isArr(v)){
    if (v.every(isNum)) return `new int[]{ ${v.map(javaLiteral).join(', ')} }`;
    if (v.every(isStr)) return `java.util.Arrays.asList(${v.map(javaLiteral).join(', ')})`;
  }
  return 'null';
}

function rustLiteral(v){
  if (isNum(v)) return `${Math.trunc(v)}`;
  if (isStr(v)) return `"${escStr(v)}".to_string()`;
  if (isArr(v)){
    if (v.every(isNum)) return `vec![${v.map(rustLiteral).join(', ')}]`;
    if (v.every(isStr)) return `vec![${v.map(rustLiteral).join(', ')}]`;
  }
  return `Default::default()`;
}

function genCppSource(userCode, args){
  let callExpr = '';
  let printer = 'null'; // one of: vec_int, vec_str, str, int
  if (isArr(args) && args.length === 2 && isArr(args[0]) && args[0].every(isNum) && isNum(args[1])) {
    callExpr = `solve(vector<int>${cppLiteral(args[0])}, ${cppLiteral(args[1])})`;
    printer = 'vec_int';
  } else if (isStr(args)) {
    callExpr = `solve(${cppLiteral(args)})`;
    printer = 'str';
  } else if (isNum(args)) {
    callExpr = `solve(${cppLiteral(args)})`;
    printer = 'vec_str';
  } else {
    callExpr = `solve(${cppLiteral(args)})`;
    printer = 'str';
  }
  const src = `#include <iostream>\n#include <vector>\n#include <string>\n#include <unordered_map>\n#include <algorithm>\nusing namespace std;\n${userCode}\n\nstatic void json_print_vec_int(const vector<int>& a){ cout<<"["; for(size_t i=0;i<a.size();++i){ if(i) cout<<","; cout<<a[i]; } cout<<"]"; }\nstatic void json_print_str(const string& s){ cout<<"\""; for(char c:s){ if(c=='\\\\'){ cout<<"\\\\\\\\"; } else if(c=='\"'){ cout<<"\\\\\""; } else { cout<<c; } } cout<<"\""; }\nstatic void json_print_vec_str(const vector<string>& a){ cout<<"["; for(size_t i=0;i<a.size();++i){ if(i) cout<<","; json_print_str(a[i]); } cout<<"]"; }\nint main(){\n  try{\n    auto ans = ${callExpr};\n    cout<<"{\\\"__result\\\":";\n    ${printer==='vec_int' ? 'json_print_vec_int(ans);' : printer==='vec_str' ? 'json_print_vec_str(ans);' : printer==='str' ? 'json_print_str(ans);' : 'cout<<ans;'}\n    cout<<"}";\n  } catch(const exception& e) { cout<<"{\\\"__error\\\":\\\""<<e.what()<<"\\\"}"; } catch(...) { cout<<"{\\\"__error\\\":\\\"Runtime Error\\\"}"; }\n  return 0;\n}\n`;
  return src;
}

function genJavaFiles(userCode, args){
  let call;
  if (isArr(args) && args.length === 2 && isArr(args[0]) && args[0].every(isNum) && isNum(args[1])) {
    call = `Solution.solve(new int[]{ ${args[0].map(v=>Math.trunc(v)).join(', ')} }, ${Math.trunc(args[1])})`;
  } else if (isStr(args)) {
    call = `Solution.solve("${escStr(args)}")`;
  } else if (isNum(args)) {
    call = `Solution.solve(${Math.trunc(args)})`;
  } else {
    call = `Solution.solve(null)`;
  }
  const main = `import java.util.*;\npublic class Main {\n  private static void printJson(Object ans){\n    StringBuilder sb=new StringBuilder();\n    if(ans instanceof int[]){\n      sb.append("["); int[] a=(int[])ans; for(int i=0;i<a.length;i++){ if(i>0) sb.append(","); sb.append(a[i]); } sb.append("]");\n    } else if(ans instanceof java.util.List){\n      sb.append("["); List<?> a=(List<?>)ans; for(int i=0;i<a.size();i++){ if(i>0) sb.append(","); Object x=a.get(i); sb.append("\"").append(x.toString().replace("\\\\","\\\\\\\\").replace("\"","\\\\\"")); sb.append("\""); } sb.append("]");\n    } else if(ans instanceof String){\n      sb.append("\"").append(((String)ans).replace("\\\\","\\\\\\\\").replace("\"","\\\\\"")); sb.append("\"");\n    } else if(ans instanceof Number){ sb.append(ans.toString()); } else { sb.append("null"); }\n    System.out.print("{\\\"__result\\\":"+sb.toString()+"}");\n  }\n  public static void main(String[] args){ try{ Object ans = ${call}; printJson(ans); } catch(Exception e){ System.out.print("{\\\"__error\\\":\\\""+e.toString().replace("\\\\","\\\\\\\\").replace("\"","\\\\\"")+"\\\"}"); } }\n}`;
  return [
    { name: 'Solution.java', content: userCode },
    { name: 'Main.java', content: main }
  ];
}

function genRustSource(userCode, args){
  let call_expr = '';
  let expect = 'string'; // one of: vec_usize, vec_string, string, i32
  if (isArr(args) && args.length === 2 && isArr(args[0]) && args[0].every(isNum) && isNum(args[1])) {
    call_expr = `solve(${rustLiteral(args[0])}, ${rustLiteral(args[1])})`;
    expect = 'vec_usize';
  } else if (isStr(args)) {
    call_expr = `solve(${rustLiteral(args)})`;
    expect = 'string';
  } else if (isNum(args)) {
    call_expr = `solve(${rustLiteral(args)})`;
    expect = 'vec_string';
  } else {
    call_expr = `solve(${rustLiteral(args)})`;
    expect = 'string';
  }
  const src = `${userCode}\n\nfn json_escape(s:&str)->String{ let mut out=String::new(); for ch in s.chars(){ if ch=='\\' || ch=='\"' { out.push('\\'); } out.push(ch); } out }\nfn print_json_string(s:&str){ print!("\"{}\"", json_escape(s)); }\nfn print_vec_usize(v:&Vec<usize>){ print!("["); for (i, x) in v.iter().enumerate(){ if i>0 { print!(","); } print!("{}", x); } print!("]"); }\nfn print_vec_string(v:&Vec<String>){ print!("["); for (i, s) in v.iter().enumerate(){ if i>0 { print!(","); } print_json_string(s); } print!("]"); }\nfn main(){\n  let ans = ${call_expr};\n  print!("{{\\\"__result\\\":");\n  ${expect==='vec_usize' ? 'print_vec_usize(&ans);' : expect==='vec_string' ? 'print_vec_string(&ans);' : expect==='i32' ? 'print!("{}", ans);' : 'print_json_string(&ans);'}\n  print!("}}");\n}\n`;
  return src;
}

async function runPiston({ language, code, args, timeLimitMs }){
  const version = await getPistonVersion(language);
  const req = { language: language === 'cpp' ? 'c++' : language, version, files: [], compile_timeout: 10000, run_timeout: Math.max(1, Math.floor((timeLimitMs||2000)/1000)) };
  if (language === 'cpp') {
    req.files = [{ name: 'main.cpp', content: genCppSource(code, args) }];
  } else if (language === 'java') {
    req.files = genJavaFiles(code, args);
  } else if (language === 'rust') {
    req.files = [{ name: 'main.rs', content: genRustSource(code, args) }];
  } else {
    return { error: 'Unsupported language' };
  }
  try {
    const timeoutMs = Math.max(5000, (timeLimitMs || 2000) + 4000);
    const { data } = await axios.post(`${PISTON_URL}/execute`, req, { timeout: timeoutMs });
    const out = String(data?.run?.stdout || '').trim();
    const err = String(data?.run?.stderr || data?.compile?.stderr || '').trim();
    if (!out) return { error: err || 'Runtime Error' };
    try {
      const parsed = JSON.parse(out);
      if (parsed.__error) return { error: parsed.__error };
      return { result: parsed.__result };
    } catch {
      return { error: err || 'Invalid output' };
    }
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'Piston error';
    return { error: `Piston: ${msg}` };
  }
}

function runNodeTest(code, args, timeLimitMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const script = `
      (async () => {
        try {
          const MOD = {};
          let module = { exports: MOD };
          let exports = MOD;
          ${code}\n
          const res = (typeof solve === 'function' ? solve : (module && module.exports && module.exports.solve));
          if (!res) {
            console.log(JSON.stringify({ __error: 'No solve() function exported' }));
            return;
          }
          const input = ${JSON.stringify(args)};
          const output = await res.apply(null, Array.isArray(input) ? input : [input]);
          console.log(JSON.stringify({ __result: output }));
        } catch (e) {
          console.log(JSON.stringify({ __error: String(e && e.stack || e) }));
        }
      })();
    `;

    const child = execFile('node', ['-e', script], { timeout: timeLimitMs }, (error, stdout, stderr) => {
      const timeMs = Date.now() - start;
      if (error && error.killed) {
        return resolve({ error: 'Time Limit Exceeded', timeMs });
      }
      let out;
      try {
        out = JSON.parse(stdout.trim());
      } catch (e) {
        return resolve({ error: stderr || stdout || 'Runtime Error', timeMs });
      }
      if (out.__error) return resolve({ error: out.__error, timeMs });
      return resolve({ result: out.__result, timeMs });
    });
  });
}

function runPythonTest(code, args, timeLimitMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const py = `
import json
import sys

${code}

def __main():
    try:
        args = json.loads('${JSON.stringify(args)}')
        if type(args) is list:
            res = solve(*args)
        else:
            res = solve(args)
        print(json.dumps({"__result": res}))
    except Exception as e:
        print(json.dumps({"__error": str(e)}))

__main()
`;
    const child = execFile('python', ['-c', py], { timeout: timeLimitMs }, (error, stdout, stderr) => {
      const timeMs = Date.now() - start;
      if (error && error.killed) {
        return resolve({ error: 'Time Limit Exceeded', timeMs });
      }
      let out;
      try {
        out = JSON.parse(stdout.trim());
      } catch (e) {
        return resolve({ error: stderr || stdout || 'Runtime Error', timeMs });
      }
      if (out.__error) return resolve({ error: out.__error, timeMs });
      return resolve({ result: out.__result, timeMs });
    });
  });
}

export async function runSubmission({ language, code, tests, timeLimitMs = 2000 }) {
  const results = [];
  let passed = 0;

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    let single;
    if (language === 'javascript') {
      single = await runNodeTest(code, t.input, timeLimitMs);
    } else if (language === 'python') {
      single = await runPythonTest(code, t.input, timeLimitMs);
    } else if (language === 'cpp' || language === 'java' || language === 'rust') {
      single = await runPiston({ language, code, args: t.input, timeLimitMs });
    } else {
      single = { error: 'Unsupported language' };
    }
    const expect = t.output;
    const got = single.result;
    const pass = single.error ? false : JSON.stringify(got) === JSON.stringify(expect);
    if (pass) passed++;
    results.push({
      test: i + 1,
      input: t.input,
      expected: expect,
      got: single.error ? null : got,
      error: single.error || null,
      timeMs: single.timeMs || null,
      pass,
    });
  }

  return {
    total: tests.length,
    passed,
    results,
    status: passed === tests.length ? 'Accepted' : (passed > 0 ? 'Partial' : 'Wrong Answer')
  };
}
