/**
 * Ship Check readiness engine.
 *
 * Pure functions only: no Forge, no network, no clock access except through the `now` argument.
 * That keeps every rule unit-testable with plain fixtures (see test/readiness.test.js).
 *
 * Input issue shape (produced by src/jira.js from the Jira REST API):
 *   {
 *     key, summary, type, priority, status,
 *     category: 'todo' | 'in_progress' | 'done',
 *     assignee: string | null,
 *     updated: ISO string,
 *     links: [{ type, relation, other: { key, summary, status, category, priority } }]
 *   }
 *
 * `relation` is the text Jira shows from THIS issue's point of view, for example
 * "blocks", "is blocked by", "causes", "is caused by", "relates to".
 */

export const DEFAULT_CONFIG = Object.freeze({
  hardBlockerPriorities: ['Highest', 'Blocker', 'Critical'],
  highPriorities: ['High', 'Highest', 'Blocker', 'Critical'],
  staleDays: 7,
  nearReleaseDays: 7,
  completionFailBelow: 0.7,
  releaseNotesFailWithinDays: 3,
  releaseNotesPattern: /release\s*notes?/i,
});

const DAY_MS = 24 * 60 * 60 * 1000;

export const isOpen = (issue) => issue.category !== 'done';

/** Map a Jira status category key to the three buckets used by the engine. */
export function categoryFromJira(statusCategoryKey) {
  if (statusCategoryKey === 'done') return 'done';
  if (statusCategoryKey === 'indeterminate') return 'in_progress';
  return 'todo';
}

/** Whole days from `now` until `dateString` (negative when the date has passed). Null when no date. */
export function daysUntil(dateString, now = new Date()) {
  if (!dateString) return null;
  const target = Date.parse(`${dateString}T23:59:59Z`);
  if (Number.isNaN(target)) return null;
  return Math.floor((target - now.getTime()) / DAY_MS);
}

function check(id, title, status, summary, extra = {}) {
  return { id, title, status, summary, issueKeys: [], evidence: [], ...extra };
}

/**
 * Follow "is blocked by" links from an open issue until the chain ends in work that has no
 * unresolved blocker of its own. Returns every chain from the root blocker to the issue.
 * Cycles are cut so a bad link graph can never loop.
 */
export function traceBlockerChains(startKey, known) {
  const chains = [];
  const walk = (key, path) => {
    const issue = known.get(key);
    const blockers = (issue?.links || [])
      .filter((l) => l.relation === 'is blocked by' && l.other.category !== 'done')
      .map((l) => l.other.key)
      .filter((k) => !path.includes(k));
    if (blockers.length === 0) {
      if (path.length > 1) chains.push([...path].reverse());
      return;
    }
    for (const b of blockers) walk(b, [...path, b]);
  };
  walk(startKey, [startKey]);
  return chains;
}

/**
 * Assess one release.
 *
 * @param {object} input
 * @param {{ name: string, releaseDate?: string|null, released?: boolean }} input.version
 * @param {object[]} input.issues            Issues whose fix version is this release.
 * @param {object[]} [input.externalIssues]  Issues outside the release that block release issues.
 * @param {Record<string, {title:string,url:string}[]>|null} input.docsByKey
 *        Documents linked to each issue by Teamwork Graph. Null when the graph could not be read.
 * @param {Date} [input.now]
 * @param {object} [input.config]
 */
export function assessRelease({ version, issues, externalIssues = [], docsByKey, now = new Date(), config = {} }) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const days = daysUntil(version.releaseDate, now);
  const known = new Map([...externalIssues, ...issues].map((i) => [i.key, i]));
  const open = issues.filter(isOpen);
  const done = issues.filter((i) => !isOpen(i));
  const checks = [];

  // 1. Completion -------------------------------------------------------------------------
  if (issues.length === 0) {
    checks.push(check('completion', 'Work completed', 'unknown', 'No issues carry this fix version.'));
  } else {
    const ratio = done.length / issues.length;
    const near = days !== null && days <= cfg.nearReleaseDays;
    const status = ratio === 1 ? 'pass' : near && ratio < cfg.completionFailBelow ? 'fail' : 'warn';
    const dayText = days === null ? 'no release date set' : days < 0 ? `${-days} day(s) past the release date` : `${days} day(s) to the release date`;
    checks.push(
      check('completion', 'Work completed', status, `${done.length} of ${issues.length} issues are done (${Math.round(ratio * 100)}%), ${dayText}.`, {
        issueKeys: open.map((i) => i.key),
        metrics: { done: done.length, total: issues.length, ratio },
      }),
    );
  }

  // 2. Hard blockers ----------------------------------------------------------------------
  const hardBugs = open.filter((i) => i.type === 'Bug' && cfg.hardBlockerPriorities.includes(i.priority));
  const hardOther = open.filter((i) => i.type !== 'Bug' && cfg.hardBlockerPriorities.includes(i.priority));
  checks.push(
    check(
      'hard-blockers',
      'Critical bugs',
      hardBugs.length ? 'fail' : hardOther.length ? 'warn' : 'pass',
      hardBugs.length
        ? `${hardBugs.length} open bug(s) at ${[...new Set(hardBugs.map((b) => b.priority))].join('/')} priority: ${hardBugs.map((b) => b.key).join(', ')}.`
        : hardOther.length
          ? `No critical bugs, but ${hardOther.length} top-priority item(s) are still open: ${hardOther.map((b) => b.key).join(', ')}.`
          : 'No open critical bugs.',
      { issueKeys: [...hardBugs, ...hardOther].map((i) => i.key), evidence: [...hardBugs, ...hardOther].map((i) => `${i.key} ${i.priority} ${i.type}, ${i.status}: ${i.summary}`) },
    ),
  );

  // 3. Dependency chains ------------------------------------------------------------------
  const blockedIssues = [];
  const rootBlockers = new Map();
  for (const issue of open) {
    const chains = traceBlockerChains(issue.key, known);
    if (chains.length === 0) continue;
    blockedIssues.push({ issue, chains });
    for (const chain of chains) {
      const root = chain[0];
      rootBlockers.set(root, (rootBlockers.get(root) || new Set()).add(issue.key));
    }
  }
  checks.push(
    check(
      'dependencies',
      'Dependency chains',
      blockedIssues.length ? 'fail' : 'pass',
      blockedIssues.length
        ? `${blockedIssues.length} open issue(s) wait on unresolved work. Start with ${[...rootBlockers.keys()].join(', ')}.`
        : 'No open issue is waiting on unresolved blockers.',
      {
        issueKeys: blockedIssues.map((b) => b.issue.key),
        evidence: blockedIssues.flatMap((b) => b.chains.map((c) => c.join(' -> '))),
        rootBlockers: [...rootBlockers.entries()].map(([key, unblocks]) => ({ key, summary: known.get(key)?.summary || '', unblocks: [...unblocks] })),
      },
    ),
  );

  // 4. Ownership --------------------------------------------------------------------------
  const unassigned = open.filter((i) => !i.assignee);
  const unassignedHigh = unassigned.filter((i) => cfg.highPriorities.includes(i.priority));
  const near = days !== null && days <= cfg.nearReleaseDays;
  checks.push(
    check(
      'ownership',
      'Owners assigned',
      unassigned.length === 0 ? 'pass' : unassignedHigh.length && near ? 'fail' : 'warn',
      unassigned.length === 0
        ? 'Every open issue has an assignee.'
        : `${unassigned.length} open issue(s) have no assignee, ${unassignedHigh.length} of them at High or above: ${unassigned.map((i) => i.key).join(', ')}.`,
      { issueKeys: unassigned.map((i) => i.key) },
    ),
  );

  // 5. Regression risk --------------------------------------------------------------------
  const regressions = [];
  for (const bug of open.filter((i) => i.type === 'Bug')) {
    for (const link of bug.links) {
      if (link.relation === 'is caused by' && known.has(link.other.key)) {
        regressions.push({ bug, cause: known.get(link.other.key) });
      }
    }
  }
  checks.push(
    check(
      'regression-risk',
      'Regression risk',
      regressions.length ? 'warn' : 'pass',
      regressions.length
        ? `${regressions.length} open bug(s) are caused by work in this release: ${regressions.map((r) => `${r.bug.key} is caused by ${r.cause.key} (${r.cause.status})`).join('; ')}.`
        : 'No open bug traces back to work in this release.',
      { issueKeys: regressions.map((r) => r.bug.key) },
    ),
  );

  // 6. Stale work -------------------------------------------------------------------------
  const stale = open.filter((i) => i.category === 'in_progress' && i.updated && (now.getTime() - new Date(i.updated).getTime()) / DAY_MS > cfg.staleDays);
  checks.push(
    check(
      'stale-work',
      'Stalled work',
      stale.length ? 'warn' : 'pass',
      stale.length ? `${stale.length} in-progress issue(s) have not changed for over ${cfg.staleDays} days: ${stale.map((i) => i.key).join(', ')}.` : `No in-progress issue is older than ${cfg.staleDays} days.`,
      { issueKeys: stale.map((i) => i.key) },
    ),
  );

  // 7 and 8 need the Teamwork Graph --------------------------------------------------------
  if (!docsByKey) {
    checks.push(check('context-trail', 'Context trail', 'unknown', 'Teamwork Graph could not be read, so linked documents are unknown.'));
    checks.push(check('release-notes', 'Release notes', 'unknown', 'Teamwork Graph could not be read, so release notes cannot be located.'));
  } else {
    const important = issues.filter((i) => cfg.highPriorities.includes(i.priority) || i.type === 'Epic');
    const gaps = important.filter((i) => !(docsByKey[i.key] || []).length);
    const covered = important.length - gaps.length;
    checks.push(
      check(
        'context-trail',
        'Context trail',
        gaps.length ? 'warn' : 'pass',
        important.length === 0
          ? 'No high-priority issues to cover.'
          : gaps.length
            ? `${covered} of ${important.length} high-priority issues link to a design, decision or runbook page. Missing: ${gaps.map((i) => i.key).join(', ')}.`
            : `All ${important.length} high-priority issues link to at least one document.`,
        { issueKeys: gaps.map((i) => i.key), metrics: { covered, total: important.length } },
      ),
    );
    const allDocs = Object.values(docsByKey).flat();
    const notes = allDocs.find((d) => cfg.releaseNotesPattern.test(d.title) && d.title.includes(version.name));
    const soon = days !== null && days <= cfg.releaseNotesFailWithinDays;
    checks.push(
      check(
        'release-notes',
        'Release notes',
        notes ? 'pass' : soon ? 'fail' : 'warn',
        notes ? `Release notes found: "${notes.title}".` : `No release notes page for ${version.name} is linked to any issue in the release.`,
        { evidence: notes ? [notes.url || notes.title] : [] },
      ),
    );
  }

  // Verdict, score and next actions --------------------------------------------------------
  const known_ = checks.filter((c) => c.status !== 'unknown');
  const points = { pass: 1, warn: 0.5, fail: 0 };
  const score = known_.length ? Math.round((known_.reduce((s, c) => s + points[c.status], 0) / known_.length) * 100) : 0;
  const verdict = checks.some((c) => c.status === 'fail') ? 'HOLD' : checks.some((c) => c.status === 'warn') ? 'AT_RISK' : 'SHIP';

  const nextActions = [];
  for (const rb of checks.find((c) => c.id === 'dependencies').rootBlockers) {
    nextActions.push(`Unblock ${rb.key}${rb.summary ? ` (${rb.summary})` : ''}; it holds up ${rb.unblocks.join(', ')}.`);
  }
  for (const bug of hardBugs) nextActions.push(`Resolve or consciously defer ${bug.key} (${bug.priority} bug, ${bug.status}).`);
  for (const i of unassignedHigh) nextActions.push(`Assign an owner to ${i.key} (${i.priority}).`);
  if (docsByKey && !checks.find((c) => c.id === 'release-notes').status.startsWith('pass')) nextActions.push(`Write and link the ${version.name} release notes page.`);
  if (docsByKey && checks.find((c) => c.id === 'context-trail').issueKeys.length) {
    nextActions.push(`Link a decision or design page to ${checks.find((c) => c.id === 'context-trail').issueKeys.join(', ')}.`);
  }

  return {
    version: { name: version.name, releaseDate: version.releaseDate || null, daysToRelease: days },
    verdict,
    score,
    confidence: checks.some((c) => c.status === 'unknown') ? 'partial' : 'full',
    counts: { total: issues.length, done: done.length, open: open.length },
    checks,
    nextActions: nextActions.slice(0, 8),
    flagged: flaggedIssues(issues, checks),
    generatedAt: now.toISOString(),
  };
}

/** Per-issue view: which checks does each issue appear in? */
function flaggedIssues(issues, checks) {
  const byKey = new Map();
  for (const c of checks) {
    if (c.status === 'pass' || c.status === 'unknown') continue;
    if (c.id === 'completion') continue; // every open issue appears here, which adds no signal
    for (const key of c.issueKeys) {
      const entry = byKey.get(key) || { key, reasons: [] };
      entry.reasons.push({ check: c.id, title: c.title, status: c.status });
      byKey.set(key, entry);
    }
  }
  const index = new Map(issues.map((i) => [i.key, i]));
  return [...byKey.values()]
    .map((e) => ({ ...e, summary: index.get(e.key)?.summary || '', priority: index.get(e.key)?.priority || '', status: index.get(e.key)?.status || '', assignee: index.get(e.key)?.assignee || null }))
    .sort((a, b) => b.reasons.filter((r) => r.status === 'fail').length - a.reasons.filter((r) => r.status === 'fail').length || b.reasons.length - a.reasons.length);
}

/** What changed since the previous snapshot of the same release. */
export function diffSnapshots(previous, report) {
  const snapshot = toSnapshot(report);
  if (!previous) return { first: true, snapshot };
  const prevOpen = new Set(previous.openKeys);
  const nowOpen = new Set(snapshot.openKeys);
  return {
    first: false,
    since: previous.at,
    verdictChanged: previous.verdict !== snapshot.verdict ? { from: previous.verdict, to: snapshot.verdict } : null,
    scoreDelta: snapshot.score - previous.score,
    resolved: [...prevOpen].filter((k) => !nowOpen.has(k)),
    newlyOpen: [...nowOpen].filter((k) => !prevOpen.has(k)),
    snapshot,
  };
}

export function toSnapshot(report) {
  return {
    at: report.generatedAt,
    verdict: report.verdict,
    score: report.score,
    openKeys: report.checks.find((c) => c.id === 'completion')?.issueKeys || [],
  };
}

/** Compact plain-text rendering that a language model can quote without inventing details. */
export function renderReport(report) {
  const lines = [];
  const label = { SHIP: 'SHIP', AT_RISK: 'AT RISK', HOLD: 'HOLD' }[report.verdict];
  lines.push(`Release ${report.version.name}: ${label} (score ${report.score}/100, ${report.confidence} confidence)`);
  lines.push(`Issues: ${report.counts.done} done, ${report.counts.open} open, ${report.counts.total} total.` + (report.version.releaseDate ? ` Release date ${report.version.releaseDate}.` : ''));
  for (const c of report.checks) lines.push(`- [${c.status.toUpperCase()}] ${c.title}: ${c.summary}`);
  if (report.nextActions.length) {
    lines.push('Do next:');
    report.nextActions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  }
  return lines.join('\n');
}
