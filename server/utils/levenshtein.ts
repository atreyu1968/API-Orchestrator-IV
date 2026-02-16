export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

export function calcularConvergencia(v1: string, v2: string): boolean {
  const maxLen = Math.max(v1.length, v2.length);
  if (maxLen === 0) return true;

  const sampleSize = Math.min(5000, maxLen);
  const s1 = v1.substring(0, sampleSize);
  const s2 = v2.substring(0, sampleSize);

  const diff = levenshtein(s1, s2);
  const ratio = diff / sampleSize;
  return ratio < 0.01;
}
