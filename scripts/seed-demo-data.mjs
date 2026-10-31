#!/usr/bin/env node
/**
 * Seeds a SAMPLE Jira project ("Harbor Checkout", key HCO) and a SAMPLE Confluence space
 * so that Ship Check has something realistic to analyse on a fresh Atlassian developer site.
 *
 * Everything created here is synthetic demo data. Nothing in it describes a real company or product.
 *
 * Usage:
 *   ATLASSIAN_SITE=your-site.atlassian.net ATLASSIAN_EMAIL=you@example.com ATLASSIAN_API_TOKEN=... \
 *     node scripts/seed-demo-data.mjs
 *
 * The script is idempotent for versions, the project and the Confluence space. It will not create
 * a second copy of issues when the project already contains issues (re-run with SEED_FORCE=1 to
 * force a second batch).
 */
import { writeFile } from 'node:fs/promises';

const SITE = process.env.ATLASSIAN_SITE;
const EMAIL = process.env.ATLASSIAN_EMAIL;
const TOKEN = process.env.ATLASSIAN_API_TOKEN;
if (!SITE || !EMAIL || !TOKEN) {
  console.error('Set ATLASSIAN_SITE, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN.');
  process.exit(1);
}
const BASE = `https://${SITE}`;
const AUTH = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const PROJECT_KEY = process.env.SEED_PROJECT_KEY || 'HCO';

async function call(method, path, body, okStatuses = [200, 201, 204]) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: AUTH, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!okStatuses.includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  }
  return json;
}

const adf = (text) => ({
  type: 'doc', version: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
};

// ---- Sample data ---------------------------------------------------------------------------
const VERSIONS = [
  { name: '2.3.2', description: 'Hotfix for tax rounding and TLS pinning.', releaseDate: day(1) },
  { name: '2.4.0', description: 'Wallet payments v2: vault tokens, Apple Pay sheet, 3DS2.', releaseDate: day(4) },
  { name: '2.5.0', description: 'Next minor release, planning only.', releaseDate: day(30) },
];

// status: todo | progress | done ; me: assign to the seeding user ; v: fix version
const ISSUES = [
  { k: 1, v: '2.4.0', t: 'Epic', p: 'Medium', s: 'progress', me: true, sum: 'Wallet payments v2' },
  { k: 2, v: '2.4.0', t: 'Story', p: 'High', s: 'done', me: true, sum: 'Tokenize saved cards through the vault service' },
  { k: 3, v: '2.4.0', t: 'Story', p: 'Medium', s: 'done', me: true, sum: 'Redesign the Apple Pay sheet for iOS 19' },
  { k: 4, v: '2.4.0', t: 'Story', p: 'Low', s: 'done', me: true, sum: 'Address autocomplete on the shipping step' },
  { k: 5, v: '2.4.0', t: 'Story', p: 'High', s: 'done', me: true, sum: 'Guest checkout without account creation' },
  { k: 6, v: '2.4.0', t: 'Bug', p: 'Medium', s: 'done', me: true, sum: 'Round JPY totals to whole yen' },
  { k: 7, v: '2.4.0', t: 'Task', p: 'High', s: 'todo', me: false, sum: 'Upgrade the payment gateway SDK to 9.x' },
  { k: 8, v: '2.4.0', t: 'Story', p: 'Highest', s: 'progress', me: true, sum: '3DS2 challenge flow for EU cards' },
  { k: 9, v: '2.4.0', t: 'Story', p: 'High', s: 'progress', me: true, sum: 'Retry gateway timeouts with idempotency keys' },
  { k: 10, v: '2.4.0', t: 'Bug', p: 'Highest', s: 'progress', me: true, sum: 'Double charge when a retry follows a timeout' },
  { k: 11, v: '2.4.0', t: 'Bug', p: 'Highest', s: 'todo', me: false, sum: 'Cart crashes with more than 50 line items' },
  { k: 12, v: '2.4.0', t: 'Task', p: 'Medium', s: 'todo', me: false, sum: 'German and French checkout strings' },
  { k: 13, v: '2.4.0', t: 'Task', p: 'Medium', s: 'todo', me: true, sum: 'Update the PCI scope diagram for the vault flow' },
  { k: 14, v: '2.4.0', t: 'Task', p: 'High', s: 'todo', me: false, sum: 'Load test checkout at three times Black Friday traffic' },
  { k: 15, v: '2.4.0', t: 'Task', p: 'Low', s: 'done', me: true, sum: 'Remove the feature flag for the legacy card form' },
  { k: 16, v: '2.4.0', t: 'Story', p: 'Low', s: 'done', me: true, sum: 'Receipt email redesign' },
  { k: 17, v: '2.4.0', t: 'Story', p: 'Medium', s: 'done', me: true, sum: 'Gift card balance lookup' },
  { k: 18, v: '2.4.0', t: 'Story', p: 'Medium', s: 'progress', me: true, sum: 'Saved address book' },
  { k: 19, v: '2.4.0', t: 'Story', p: 'Medium', s: 'todo', me: false, sum: 'Add Klarna as a payment option' },
  { k: 20, v: '2.4.0', t: 'Task', p: 'High', s: 'done', me: true, sum: 'Screen reader labels on the payment form' },
  { k: 21, v: '2.3.2', t: 'Bug', p: 'High', s: 'done', me: true, sum: 'Fix tax rounding on mixed carts' },
  { k: 22, v: '2.3.2', t: 'Bug', p: 'Medium', s: 'done', me: true, sum: 'Fix crash on an empty coupon code' },
  { k: 23, v: '2.3.2', t: 'Task', p: 'High', s: 'done', me: true, sum: 'Refresh the TLS pinning list' },
  { k: 24, v: null, t: 'Task', p: 'High', s: 'progress', me: false, sum: 'Vendor: request gateway sandbox access for SDK 9.x' },
];

// [from, type, to]: "blocks" means from blocks to; "causes" means from causes to.
const LINKS = [
  [24, 'Blocks', 7],
  [7, 'Blocks', 8],
  [9, 'Problem/Incident', 10],
  [11, 'Relates', 14],
  [1, 'Relates', 8],
];

// Confluence pages: title, body paragraphs, issue keys referenced.
const PAGES = [
  {
    title: 'Design: 3DS2 challenge flow',
    text: 'Decision record for the EU card challenge flow, including the gateway SDK upgrade it depends on.',
    keys: [8, 7],
  },
  {
    title: 'ADR-012: Move saved cards to the vault service',
    text: 'Why saved cards are tokenized by the vault service and what the PCI scope diagram must show.',
    keys: [2, 13],
  },
  {
    title: 'Runbook: Checkout rollback and kill switches',
    text: 'How to roll back checkout, which kill switches exist and who owns the retry path.',
    keys: [9, 10],
  },
  {
    title: 'Test plan: Wallet payments v2',
    text: 'Manual and automated coverage for the wallet release.',
    keys: [1, 3, 5],
  },
  {
    title: 'Release Notes 2.3.2',
    text: 'Customer facing notes for the 2.3.2 hotfix.',
    keys: [21, 22, 23],
  },
];

// ---- Run ------------------------------------------------------------------------------------
const out = { project: PROJECT_KEY, issues: {}, pages: {} };

const me = await call('GET', '/rest/api/3/myself');
console.log('Seeding as', me.displayName);

const proj = await call('GET', `/rest/api/3/project/${PROJECT_KEY}`, undefined, [200, 404]);
if (!proj.id) {
  throw new Error(`Project ${PROJECT_KEY} does not exist. Create a company-managed Scrum project with that key first.`);
}

// Versions
const existingVersions = await call('GET', `/rest/api/3/project/${PROJECT_KEY}/versions`);
for (const v of VERSIONS) {
  if (!existingVersions.find((x) => x.name === v.name)) {
    await call('POST', '/rest/api/3/version', { ...v, projectId: Number(proj.id), released: false });
    console.log('version', v.name);
  }
}

// Issues
const existing = await call('POST', '/rest/api/3/search/jql', { jql: `project = ${PROJECT_KEY}`, maxResults: 1, fields: ['summary'] });
if (existing.issues?.length && !process.env.SEED_FORCE) {
  console.log('Project already has issues; skipping issue creation (SEED_FORCE=1 to override).');
} else {
  const types = await call('GET', '/rest/api/3/issuetype');
  const typeId = (n) => types.find((t) => t.name === n)?.id;
  for (const i of ISSUES) {
    const fields = {
      project: { key: PROJECT_KEY },
      issuetype: { id: typeId(i.t) },
      summary: i.sum,
      priority: { name: i.p },
      description: adf(`Sample issue for the Ship Check demo (${i.sum}).`),
    };
    if (i.me) fields.assignee = { accountId: me.accountId };
    let created;
    try {
      created = await call('POST', '/rest/api/3/issue', { fields: { ...fields, ...(i.v ? { fixVersions: [{ name: i.v }] } : {}) } });
    } catch (e) {
      // Some company-managed screens do not carry "Fix versions" on create. Retry without and set it by edit.
      created = await call('POST', '/rest/api/3/issue', { fields });
      if (i.v) await call('PUT', `/rest/api/3/issue/${created.key}`, { fields: { fixVersions: [{ name: i.v }] } });
    }
    out.issues[i.k] = created.key;
    // Move to target status
    if (i.s !== 'todo') {
      const wanted = i.s === 'progress' ? ['in progress'] : ['in progress', 'done'];
      for (const target of wanted) {
        const tr = await call('GET', `/rest/api/3/issue/${created.key}/transitions`);
        const t = tr.transitions.find((x) => x.name.toLowerCase() === target || x.to?.name?.toLowerCase() === target);
        if (t) await call('POST', `/rest/api/3/issue/${created.key}/transitions`, { transition: { id: t.id } });
      }
    }
    console.log(created.key, i.sum);
  }
  // Links
  for (const [a, type, b] of LINKS) {
    await call('POST', '/rest/api/3/issueLink', {
      type: { name: type },
      inwardIssue: { key: out.issues[b] },
      outwardIssue: { key: out.issues[a] },
    });
  }
  console.log('links created');
}

// Confluence space and pages
let space = (await call('GET', '/wiki/api/v2/spaces?keys=HCOENG')).results?.[0];
if (!space) {
  await call('POST', '/wiki/rest/api/space', { key: 'HCOENG', name: 'Harbor Checkout Engineering', description: { plain: { value: 'Sample space for the Ship Check demo.', representation: 'plain' } } });
  space = (await call('GET', '/wiki/api/v2/spaces?keys=HCOENG')).results?.[0];
}
const keyOf = (n) => out.issues[n] || `${PROJECT_KEY}-${n}`;
for (const p of PAGES) {
  const macros = p.keys
    .map((n) => `<p><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">${keyOf(n)}</ac:parameter></ac:structured-macro> <a href="${BASE}/browse/${keyOf(n)}">${keyOf(n)}</a></p>`)
    .join('');
  const body = `<p>${p.text}</p><h2>Related work</h2>${macros}<p>Sample content generated by the Ship Check seed script.</p>`;
  try {
    const page = await call('POST', '/wiki/api/v2/pages', { spaceId: space.id, status: 'current', title: p.title, body: { representation: 'storage', value: body } });
    out.pages[p.title] = page.id;
    console.log('page', p.title);
  } catch (e) {
    console.log('page skipped:', p.title, String(e.message).slice(0, 120));
  }
}

await writeFile(new URL('./.seed-output.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('done');
