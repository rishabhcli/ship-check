import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Box, Button, DynamicTable, Heading, Inline, Link, Lozenge, ProgressBar, SectionMessage, Select, Spinner, Stack, Text, Strong } from '@forge/react';
import { invoke, router, view } from '@forge/bridge';

const VERDICT = {
  SHIP: { label: 'SHIP', appearance: 'success', blurb: 'Nothing on the checklist is in the way.' },
  AT_RISK: { label: 'AT RISK', appearance: 'inprogress', blurb: 'Shippable, but there are open warnings.' },
  HOLD: { label: 'HOLD', appearance: 'removed', blurb: 'At least one check fails. Do not ship yet.' },
};
const STATUS = { pass: 'success', warn: 'inprogress', fail: 'removed', unknown: 'default' };

const App = () => {
  const [versions, setVersions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  useEffect(() => {
    invoke('getReleases')
      .then((r) => {
        setVersions(r.versions);
        const next = r.versions.find((v) => !v.released) || r.versions[0];
        if (next) setSelected(next.name);
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  const run = async (name) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setData(await invoke('assess', { versionName: name }));
    } catch (e) {
      setError(String(e.message || e));
    }
    setBusy(false);
  };

  useEffect(() => {
    if (selected) run(selected);
  }, [selected]);

  const openIssue = async (key) => {
    const context = await view.getContext();
    router.open(`${context.siteUrl}/browse/${key}`);
  };

  const postNote = async () => {
    const epic = data.report.flagged[0]?.key;
    if (!epic) return;
    const r = await invoke('postNote', { versionName: selected, issueKey: epic });
    setNote(`Posted readiness note to ${r.issueKey}.`);
  };

  if (error && !data) return <SectionMessage appearance="error" title="Ship Check could not load"><Text>{error}</Text></SectionMessage>;
  if (!versions) return <Spinner label="Loading releases" />;
  if (versions.length === 0) return <SectionMessage title="No versions yet"><Text>Create a version in Project settings, then assign it as the fix version of some issues.</Text></SectionMessage>;

  const report = data?.report;
  const v = report ? VERDICT[report.verdict] : null;

  return (
    <Stack space="space.200">
      <Inline space="space.200" alignBlock="center">
        <Box>
          <Select
            appearance="default"
            spacing="compact"
            options={versions.map((x) => ({ label: `${x.name}${x.released ? ' (released)' : ''}${x.releaseDate ? `, ${x.releaseDate}` : ''}`, value: x.name }))}
            value={selected ? { label: selected, value: selected } : undefined}
            onChange={(o) => setSelected(o.value)}
          />
        </Box>
        <Button onClick={() => run(selected)} isLoading={busy}>Re-check</Button>
      </Inline>

      {error && <SectionMessage appearance="error" title="Check failed"><Text>{error}</Text></SectionMessage>}
      {busy && !report && <Spinner label="Reading Jira and the Teamwork Graph" />}

      {report && (
        <Stack space="space.200">
          <Inline space="space.200" alignBlock="center">
            <Lozenge appearance={v.appearance} isBold>{v.label}</Lozenge>
            <Text><Strong>{report.version.name}</Strong> · score {report.score}/100 · {report.counts.done} of {report.counts.total} issues done{report.version.releaseDate ? ` · ${report.version.daysToRelease} day(s) to ${report.version.releaseDate}` : ''}</Text>
          </Inline>
          <ProgressBar value={report.score / 100} appearance={report.verdict === 'HOLD' ? 'default' : 'success'} />
          <Text>{v.blurb}{report.confidence === 'partial' ? ' Some checks could not run (marked unknown).' : ''}</Text>

          {data.delta && !data.delta.first && (
            <SectionMessage appearance="information" title={`Since the last check (${data.delta.since.slice(0, 16).replace('T', ' ')} UTC)`}>
              <Text>
                {data.delta.verdictChanged ? `Verdict ${data.delta.verdictChanged.from} to ${data.delta.verdictChanged.to}. ` : 'Verdict unchanged. '}
                Score {data.delta.scoreDelta >= 0 ? '+' : ''}{data.delta.scoreDelta}. Resolved: {data.delta.resolved.join(', ') || 'none'}. Newly open: {data.delta.newlyOpen.join(', ') || 'none'}.
              </Text>
            </SectionMessage>
          )}

          <Heading size="medium">Checks</Heading>
          <DynamicTable
            head={{ cells: [{ key: 'status', content: 'Status' }, { key: 'check', content: 'Check' }, { key: 'finding', content: 'Finding' }] }}
            rows={report.checks.map((c) => ({
              key: c.id,
              cells: [
                { key: 'status', content: <Lozenge appearance={STATUS[c.status]} isBold>{c.status.toUpperCase()}</Lozenge> },
                { key: 'check', content: <Strong>{c.title}</Strong> },
                { key: 'finding', content: <Text>{c.summary}</Text> },
              ],
            }))}
          />

          {report.nextActions.length > 0 && (
            <Stack space="space.100">
              <Heading size="medium">Do next</Heading>
              {report.nextActions.map((a, i) => <Text key={i}>{i + 1}. {a}</Text>)}
            </Stack>
          )}

          <Heading size="medium">What is in the way</Heading>
          <DynamicTable
            head={{ cells: [{ key: 'key', content: 'Issue' }, { key: 'summary', content: 'Summary' }, { key: 'owner', content: 'Owner' }, { key: 'why', content: 'Flagged by' }] }}
            emptyView={<Text>Nothing is flagged.</Text>}
            rows={report.flagged.map((f) => ({
              key: f.key,
              cells: [
                { key: 'key', content: <Link onClick={() => openIssue(f.key)}>{f.key}</Link> },
                { key: 'summary', content: <Text>{f.summary} ({f.priority}, {f.status})</Text> },
                { key: 'owner', content: <Text>{f.assignee || 'Unassigned'}</Text> },
                { key: 'why', content: <Inline space="space.050">{f.reasons.map((r) => <Lozenge key={r.check} appearance={STATUS[r.status]}>{r.title}</Lozenge>)}</Inline> },
              ],
            }))}
          />

          <Heading size="medium">Context trail from the Teamwork Graph</Heading>
          <Text>{data.diagnostics.errors.length ? `Graph degraded: ${data.diagnostics.errors.join('; ')}` : `${data.diagnostics.rows} issue-to-page link(s) read from the graph.`}</Text>
          <DynamicTable
            head={{ cells: [{ key: 'issue', content: 'Issue' }, { key: 'page', content: 'Linked page' }] }}
            emptyView={<Text>No linked pages found for this release.</Text>}
            rows={data.docs.map((d, i) => ({
              key: `${d.issueKey}-${i}`,
              cells: [
                { key: 'issue', content: <Link onClick={() => openIssue(d.issueKey)}>{d.issueKey}</Link> },
                { key: 'page', content: <Link href={d.url} openNewTab>{d.title}</Link> },
              ],
            }))}
          />

          <Inline space="space.200" alignBlock="center">
            <Button onClick={postNote} isDisabled={!report.flagged.length}>Post readiness note to {report.flagged[0]?.key || 'an issue'}</Button>
            {note && <Text>{note}</Text>}
          </Inline>
        </Stack>
      )}
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
