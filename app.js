/* eslint-disable no-use-before-define */

const els = {
  leftInput: document.getElementById("leftInput"),
  rightInput: document.getElementById("rightInput"),
  leftPasteBtn: document.getElementById("leftPasteBtn"),
  rightPasteBtn: document.getElementById("rightPasteBtn"),
  diffBtn: document.getElementById("diffBtn"),
  swapBtn: document.getElementById("swapBtn"),
  sampleBtn: document.getElementById("sampleBtn"),
  ignoreCase: document.getElementById("ignoreCase"),
  trimWhitespace: document.getElementById("trimWhitespace"),
  collapseWhitespace: document.getElementById("collapseWhitespace"),
  inlineDiff: document.getElementById("inlineDiff"),
  summary: document.getElementById("summary"),
  leftPane: document.getElementById("leftPane"),
  rightPane: document.getElementById("rightPane"),
};

function isEffectivelyEmpty(text) {
  return text.trim().length === 0;
}

function updatePasteButtons() {
  const leftEmpty = isEffectivelyEmpty(els.leftInput.value);
  const rightEmpty = isEffectivelyEmpty(els.rightInput.value);
  els.leftPasteBtn.hidden = !leftEmpty;
  els.rightPasteBtn.hidden = !rightEmpty;
}

async function pasteFromClipboard(which) {
  if (!navigator.clipboard?.readText) {
    alert("Clipboard paste isn't available in this browser/context. Try serving this page over http://localhost.");
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (which === "left") els.leftInput.value = text;
    else els.rightInput.value = text;
    updatePasteButtons();
    runDiff();
  } catch (e) {
    alert(
      "Clipboard paste was blocked. If you're opening this as a file, try running `python3 -m http.server` and using http://localhost.",
    );
  }
}

function splitLines(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function normalizeLine(line, options) {
  let out = line;
  if (options.trimWhitespace) out = out.trimEnd();
  if (options.collapseWhitespace) out = out.replace(/\s+/g, " ").trim();
  if (options.ignoreCase) out = out.toLowerCase();
  return out;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function tokenizePreserveWhitespace(text) {
  if (text.length === 0) return [];
  // Split into: whitespace runs, "word" runs, or single non-whitespace chars (punctuation).
  // This avoids treating `greet('Erik');` as a single token, enabling finer inline diffs.
  try {
    return text.match(/(\s+|[\p{L}\p{N}_]+|[^\s])/gu) ?? [];
  } catch {
    return text.match(/(\s+|[A-Za-z0-9_]+|[^\s])/g) ?? [];
  }
}

// Myers diff over arrays of strings; returns operations with indices.
function myersDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Map();
  v.set(1, 0);

  const trace = [];

  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      const kPlus = v.get(k + 1);
      const kMinus = v.get(k - 1);
      let x;
      if (k === -d || (k !== d && (kMinus ?? -1) < (kPlus ?? -1))) {
        x = kPlus ?? 0; // down: insert
      } else {
        x = (kMinus ?? 0) + 1; // right: delete
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x >= n && y >= m) {
        trace.push(new Map(v));
        return backtrack(trace, a, b);
      }
    }
    trace.push(new Map(v));
  }
  return [];
}

function longestIncreasingSubsequenceIndices(values) {
  // Returns indices of `values` forming a strictly increasing subsequence of max length.
  const n = values.length;
  const tails = [];
  const tailsIndices = [];
  const prev = new Int32Array(n);
  prev.fill(-1);

  for (let i = 0; i < n; i++) {
    const x = values[i];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tailsIndices[lo - 1];
    if (lo === tails.length) {
      tails.push(x);
      tailsIndices.push(i);
    } else {
      tails[lo] = x;
      tailsIndices[lo] = i;
    }
  }

  const out = [];
  let k = tailsIndices[tailsIndices.length - 1];
  while (k !== -1) {
    out.push(k);
    k = prev[k];
  }
  out.reverse();
  return out;
}

function patienceDiff(a, b) {
  // Patience-style anchoring using lines that are unique in both sequences.
  // Improves alignment in the presence of repeated lines, then falls back to Myers for gaps.
  const aPositions = new Map();
  const bPositions = new Map();

  for (let i = 0; i < a.length; i++) {
    const line = a[i];
    const list = aPositions.get(line);
    if (list) list.push(i);
    else aPositions.set(line, [i]);
  }
  for (let i = 0; i < b.length; i++) {
    const line = b[i];
    const list = bPositions.get(line);
    if (list) list.push(i);
    else bPositions.set(line, [i]);
  }

  const pairs = [];
  for (const [line, aIdxs] of aPositions) {
    if (aIdxs.length !== 1) continue;
    const bIdxs = bPositions.get(line);
    if (!bIdxs || bIdxs.length !== 1) continue;
    pairs.push({ aIndex: aIdxs[0], bIndex: bIdxs[0] });
  }
  if (pairs.length === 0) return myersDiff(a, b);

  pairs.sort((p1, p2) => p1.aIndex - p2.aIndex);
  const lis = longestIncreasingSubsequenceIndices(pairs.map((p) => p.bIndex));
  const anchors = lis.map((i) => pairs[i]);

  function diffRange(aStart, aEnd, bStart, bEnd) {
    const sliceOps = myersDiff(a.slice(aStart, aEnd), b.slice(bStart, bEnd));
    const out = [];
    for (const op of sliceOps) {
      if (op.type === "equal") out.push({ type: "equal", aIndex: aStart + op.aIndex, bIndex: bStart + op.bIndex });
      else if (op.type === "delete") out.push({ type: "delete", aIndex: aStart + op.aIndex });
      else out.push({ type: "insert", bIndex: bStart + op.bIndex });
    }
    return out;
  }

  const ops = [];
  let aPos = 0;
  let bPos = 0;
  for (const anchor of anchors) {
    if (aPos <= anchor.aIndex - 1 || bPos <= anchor.bIndex - 1) {
      ops.push(...diffRange(aPos, anchor.aIndex, bPos, anchor.bIndex));
    }
    ops.push({ type: "equal", aIndex: anchor.aIndex, bIndex: anchor.bIndex });
    aPos = anchor.aIndex + 1;
    bPos = anchor.bIndex + 1;
  }
  ops.push(...diffRange(aPos, a.length, bPos, b.length));
  return ops;
}

function lineSimilarity(normA, normB) {
  if (normA === normB) return 1;
  if (normA.length === 0 || normB.length === 0) return 0;

  const aTokens = tokenizePreserveWhitespace(normA);
  const bTokens = tokenizePreserveWhitespace(normB);
  const ops = myersDiff(aTokens, bTokens);

  let equalChars = 0;
  let aChars = 0;
  let bChars = 0;
  for (const op of ops) {
    if (op.type === "equal") {
      const t = aTokens[op.aIndex] ?? "";
      equalChars += t.length;
      aChars += t.length;
      bChars += t.length;
    } else if (op.type === "delete") {
      aChars += (aTokens[op.aIndex] ?? "").length;
    } else if (op.type === "insert") {
      bChars += (bTokens[op.bIndex] ?? "").length;
    }
  }

  const denom = Math.max(aChars, bChars, 1);
  return equalChars / denom;
}

function alignChangeHunk(deletes, inserts) {
  const n = deletes.length;
  const m = inserts.length;

  const maxPairs = 40_000;
  if (n * m > maxPairs) {
    const rows = [];
    const max = Math.max(n, m);
    for (let i = 0; i < max; i++) {
      const left = deletes[i] ?? null;
      const right = inserts[i] ?? null;
      if (left && right) rows.push({ kind: "replace", left, right });
      else if (left) rows.push({ kind: "delete", left, right: null });
      else rows.push({ kind: "insert", left: null, right });
    }
    return rows;
  }

  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const prev = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1=del, 2=ins, 3=pair

  for (let i = 1; i <= n; i++) {
    dp[i][0] = i;
    prev[i][0] = 1;
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = j;
    prev[0][j] = 2;
  }

  // Only pair lines into a single "replace" row when they're genuinely similar.
  // Otherwise prefer insert/delete rows (with padding) so later matching lines align.
  const minPairSimilarity = 0.6;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const delCost = dp[i - 1][j] + 1;
      const insCost = dp[i][j - 1] + 1;
      const sim = lineSimilarity(deletes[i - 1].norm, inserts[j - 1].norm);
      const pairCost = sim >= minPairSimilarity ? dp[i - 1][j - 1] + (1 - sim) : Number.POSITIVE_INFINITY;

      let best = delCost;
      let bestMove = 1;
      if (insCost < best) {
        best = insCost;
        bestMove = 2;
      }
      if (pairCost < best) {
        best = pairCost;
        bestMove = 3;
      }
      dp[i][j] = best;
      prev[i][j] = bestMove;
    }
  }

  const rows = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const move = prev[i][j];
    if (move === 3) {
      rows.push({ kind: "replace", left: deletes[i - 1], right: inserts[j - 1] });
      i--;
      j--;
    } else if (move === 1) {
      rows.push({ kind: "delete", left: deletes[i - 1], right: null });
      i--;
    } else {
      rows.push({ kind: "insert", left: null, right: inserts[j - 1] });
      j--;
    }
  }

  rows.reverse();
  return rows;
}

function backtrack(trace, a, b) {
  let x = a.length;
  let y = b.length;
  const ops = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const kPlus = v.get(k + 1);
    const kMinus = v.get(k - 1);

    let prevK;
    if (k === -d || (k !== d && (kMinus ?? -1) < (kPlus ?? -1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = v.get(prevK) ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: "equal", aIndex: x - 1, bIndex: y - 1 });
      x--;
      y--;
    }

    if (d === 0) break;

    if (x === prevX) {
      ops.push({ type: "insert", bIndex: y - 1 });
      y--;
    } else {
      ops.push({ type: "delete", aIndex: x - 1 });
      x--;
    }
  }

  ops.reverse();
  return ops;
}

function buildAlignedRows(leftLines, rightLines, options) {
  const left = leftLines.map((orig) => ({ orig, norm: normalizeLine(orig, options) }));
  const right = rightLines.map((orig) => ({ orig, norm: normalizeLine(orig, options) }));

  const ops = patienceDiff(
    left.map((x) => x.norm),
    right.map((x) => x.norm),
  );

  const rows = [];
  let pendingDeletes = [];
  let pendingInserts = [];

  function flushPending() {
    if (pendingDeletes.length > 0 && pendingInserts.length > 0) {
      rows.push(...alignChangeHunk(pendingDeletes, pendingInserts));
    } else {
      for (const del of pendingDeletes) rows.push({ kind: "delete", left: del, right: null });
      for (const ins of pendingInserts) rows.push({ kind: "insert", left: null, right: ins });
    }
    pendingDeletes = [];
    pendingInserts = [];
  }

  for (const op of ops) {
    if (op.type === "equal") {
      flushPending();
      rows.push({ kind: "equal", left: left[op.aIndex], right: right[op.bIndex] });
      continue;
    }
    if (op.type === "delete") pendingDeletes.push(left[op.aIndex]);
    if (op.type === "insert") pendingInserts.push(right[op.bIndex]);
  }
  flushPending();
  return rows;
}

function inlineDiffHtml(leftText, rightText) {
  const aTokens = tokenizePreserveWhitespace(leftText);
  const bTokens = tokenizePreserveWhitespace(rightText);
  const ops = myersDiff(aTokens, bTokens);

  const leftParts = [];
  const rightParts = [];

  for (const op of ops) {
    if (op.type === "equal") {
      const t = aTokens[op.aIndex] ?? "";
      leftParts.push(escapeHtml(t));
      rightParts.push(escapeHtml(t));
    } else if (op.type === "delete") {
      const t = aTokens[op.aIndex] ?? "";
      leftParts.push(`<span class="inline inline--del">${escapeHtml(t)}</span>`);
    } else if (op.type === "insert") {
      const t = bTokens[op.bIndex] ?? "";
      rightParts.push(`<span class="inline inline--ins">${escapeHtml(t)}</span>`);
    }
  }

  return {
    leftHtml: leftParts.join(""),
    rightHtml: rightParts.join(""),
  };
}

function render(rows, config) {
  const leftFrag = document.createDocumentFragment();
  const rightFrag = document.createDocumentFragment();

  let leftLn = 0;
  let rightLn = 0;

  let inserts = 0;
  let deletes = 0;
  let replaces = 0;

  for (const row of rows) {
    const leftLine = row.left?.orig ?? null;
    const rightLine = row.right?.orig ?? null;

    if (row.kind === "insert") inserts++;
    if (row.kind === "delete") deletes++;
    if (row.kind === "replace") replaces++;

    const leftRow = document.createElement("div");
    const rightRow = document.createElement("div");

    const leftClasses = ["row"];
    const rightClasses = ["row"];
    if (row.kind === "replace") {
      leftClasses.push("row--replace");
      rightClasses.push("row--replace");
    } else if (row.kind === "delete") {
      leftClasses.push("row--delete");
      if (rightLine == null) rightClasses.push("row--pad");
    } else if (row.kind === "insert") {
      rightClasses.push("row--insert");
      if (leftLine == null) leftClasses.push("row--pad");
    }
    leftRow.className = leftClasses.join(" ");
    rightRow.className = rightClasses.join(" ");

    const leftLnEl = document.createElement("div");
    leftLnEl.className = "row__ln";
    leftLnEl.textContent = leftLine == null ? "" : String(++leftLn);

    const rightLnEl = document.createElement("div");
    rightLnEl.className = "row__ln";
    rightLnEl.textContent = rightLine == null ? "" : String(++rightLn);

    const leftTextEl = document.createElement("div");
    leftTextEl.className = "row__text";
    const rightTextEl = document.createElement("div");
    rightTextEl.className = "row__text";

    if (row.kind === "replace" && leftLine != null && rightLine != null && config.inlineDiff) {
      const inlined = inlineDiffHtml(leftLine, rightLine);
      leftTextEl.innerHTML = inlined.leftHtml;
      rightTextEl.innerHTML = inlined.rightHtml;
    } else {
      leftTextEl.textContent = leftLine ?? "";
      rightTextEl.textContent = rightLine ?? "";
    }

    leftRow.append(leftLnEl, leftTextEl);
    rightRow.append(rightLnEl, rightTextEl);
    leftFrag.append(leftRow);
    rightFrag.append(rightRow);
  }

  els.leftPane.replaceChildren(leftFrag);
  els.rightPane.replaceChildren(rightFrag);

  const equalish = Math.max(0, rows.length - inserts - deletes - replaces);
  els.summary.textContent = `Rows: ${rows.length} · Equal: ${equalish} · Changed: ${replaces} · Added: ${inserts} · Removed: ${deletes}`;
}

function syncScroll(a, b) {
  let syncing = false;
  function onScroll(from, to) {
    if (syncing) return;
    syncing = true;
    const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
    syncing = false;
  }
  a.addEventListener("scroll", () => onScroll(a, b));
  b.addEventListener("scroll", () => onScroll(b, a));
}

function runDiff() {
  const leftLines = splitLines(els.leftInput.value);
  const rightLines = splitLines(els.rightInput.value);

  const options = {
    ignoreCase: els.ignoreCase.checked,
    trimWhitespace: els.trimWhitespace.checked,
    collapseWhitespace: els.collapseWhitespace.checked,
  };

  const rows = buildAlignedRows(leftLines, rightLines, options);
  render(rows, {
    inlineDiff: els.inlineDiff.checked,
  });
}

function swap() {
  const tmp = els.leftInput.value;
  els.leftInput.value = els.rightInput.value;
  els.rightInput.value = tmp;
  runDiff();
}

function clearText() {
  els.leftInput.value = "";
  els.rightInput.value = "";
  updatePasteButtons();
  runDiff();
}

function init() {
  syncScroll(els.leftPane, els.rightPane);

  els.diffBtn.addEventListener("click", runDiff);
  els.swapBtn.addEventListener("click", swap);
  els.sampleBtn.addEventListener("click", clearText);
  for (const el of [els.ignoreCase, els.trimWhitespace, els.collapseWhitespace, els.inlineDiff]) {
    el.addEventListener("change", runDiff);
  }

  for (const el of [els.leftInput, els.rightInput]) {
    el.addEventListener("input", () => {
      updatePasteButtons();
    });
  }
  els.leftPasteBtn.addEventListener("click", () => pasteFromClipboard("left"));
  els.rightPasteBtn.addEventListener("click", () => pasteFromClipboard("right"));

  const onCtrlEnter = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") runDiff();
  };
  els.leftInput.addEventListener("keydown", onCtrlEnter);
  els.rightInput.addEventListener("keydown", onCtrlEnter);

  clearText();
}

init();
