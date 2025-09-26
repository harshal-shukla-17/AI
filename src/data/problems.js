const problems = [
  {
    id: 1,
    slug: 'two-sum',
    title: 'Two Sum',
    difficulty: 'Easy',
    tags: ['array', 'hash-map'],
    timeLimitMs: 2000,
    statement: `Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.
You may assume that each input would have exactly one solution, and you may not use the same element twice.
Return the answer in any order.

Implement function solve(nums, target) and return an array [i, j].`,
    starterCode: {
      javascript: `// Return indices [i, j]
function solve(nums, target) {
  // TODO: implement
  const map = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (map.has(need)) return [map.get(need), i];
    map.set(nums[i], i);
  }
  return [];
}

module.exports = { solve };`,
      python: `# Return indices [i, j]
def solve(nums, target):
    # TODO: implement
    m = {}
    for i, x in enumerate(nums):
        need = target - x
        if need in m:
            return [m[need], i]
        m[x] = i
    return []
`
    },
    tests: [
      { input: [[2,7,11,15], 9], output: [0,1] },
      { input: [[3,2,4], 6], output: [1,2] },
      { input: [[3,3], 6], output: [0,1] },
    ],
  },
  {
    id: 2,
    slug: 'reverse-string',
    title: 'Reverse String',
    difficulty: 'Easy',
    tags: ['string', 'two-pointers'],
    timeLimitMs: 2000,
    statement: `Given a string s, return the string reversed.
Implement solve(s) -> string.`,
    starterCode: {
      javascript: `function solve(s) {
  // TODO: implement
  return s.split('').reverse().join('');
}
module.exports = { solve };`,
      python: `def solve(s):
    # TODO: implement
    return s[::-1]
`
    },
    tests: [
      { input: ['hello'], output: 'olleh' },
      { input: ['ab'], output: 'ba' },
      { input: [''], output: '' },
    ],
  },
  {
    id: 3,
    slug: 'fizz-buzz',
    title: 'Fizz Buzz',
    difficulty: 'Easy',
    tags: ['math'],
    timeLimitMs: 2000,
    statement: `Given an integer n, return a list of strings with numbers from 1..n, but for multiples of three use "Fizz", for multiples of five use "Buzz", and for multiples of both use "FizzBuzz".
Implement solve(n) -> string[].`,
    starterCode: {
      javascript: `function solve(n) {
  // TODO: implement
  const out = [];
  for (let i = 1; i <= n; i++) {
    let s = '';
    if (i % 3 === 0) s += 'Fizz';
    if (i % 5 === 0) s += 'Buzz';
    out.push(s || String(i));
  }
  return out;
}
module.exports = { solve };`,
      python: `def solve(n):
    # TODO: implement
    out = []
    for i in range(1, n+1):
        s = ''
        if i % 3 == 0:
            s += 'Fizz'
        if i % 5 == 0:
            s += 'Buzz'
        out.append(s or str(i))
    return out
`
    },
    tests: [
      { input: [3], output: ['1','2','Fizz'] },
      { input: [5], output: ['1','2','Fizz','4','Buzz'] },
    ],
  }
];

export default problems;
