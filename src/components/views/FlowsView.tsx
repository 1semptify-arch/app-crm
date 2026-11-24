import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, PrimaryButton, inputClass } from '../ui';

// Packet flows — the send_center waypoint engine, served by crm_store.py
// over /api/flows*. The ops_state `flows` doc is shared with :8777, so
// progress walked here shows on the Send Center board and vice versa.
// Actions complete in place: every button POSTs, the payload that comes
// back IS the next render — no navigation, no lost position.

interface FlowListRow {
  key: string;
  label: string;
  channel: string;
  how: string | null;
  sent: { date?: string; method?: string; conf?: string } | null;
  at: number;
  total: number;
  current_title: string | null;
  artifacts: { path: string; note: string }[];
}

interface FlowOption {
  label: string;
  goto: string | number;
  note?: string;
}

interface FlowField {
  name: string;
  label: string;
  placeholder?: string;
}

interface FlowStep {
  key?: string;
  title: string;
  detail?: string;
  text?: string;
  file_list?: string[];
  dir_list?: string[];
  files?: string;
  attach_dir?: string;
  link?: string;
  options?: FlowOption[];
  form?: { fields: FlowField[]; repeat?: boolean };
  entries?: Record<string, string>[];
  input?: string;
  send?: boolean;
  next?: string | number;
}

interface FlowPayload {
  key: string;
  label: string;
  channel: string;
  how: string | null;
  sent: { date?: string; method?: string; conf?: string } | null;
  email_to: string | null;
  state: {
    at: number;
    path: string[];
    notes: string[];
    data: Record<string, Record<string, string>[]>;
    trail: number[];
  };
  total: number;
  done: boolean;
  current: { index: number; step: FlowStep } | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error || `${r.status}`);
  return body;
}

const post = (key: string, action: string, body: unknown) =>
  api<FlowPayload | { ok: boolean }>(`/api/flows/${encodeURIComponent(key)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

function fileHref(dir: string, name: string): string {
  return `/api/file?p=${encodeURIComponent(`${dir}/${name}`)}`;
}

export function FlowsView({
  reloadKey,
  initialKey,
}: {
  reloadKey: number;
  // Deep link (/flow?key=… → /?view=flows&flow=key): preselect that packet.
  initialKey?: string | null;
}) {
  const [flows, setFlows] = useState<FlowListRow[]>([]);
  const [selected, setSelected] = useState<string | null>(initialKey ?? null);
  const [flow, setFlow] = useState<FlowPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ flows: FlowListRow[] }>('/api/flows')
      .then((r) => setFlows(r.flows))
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  const loadFlow = useCallback((key: string) => {
    api<FlowPayload>(`/api/flows/${encodeURIComponent(key)}`)
      .then(setFlow)
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  useEffect(load, [load, reloadKey]);
  useEffect(() => {
    if (selected) loadFlow(selected);
  }, [selected, loadFlow, reloadKey]);

  function act(action: string, body?: unknown) {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    post(selected, action, body)
      .then((r) => {
        if ('key' in r) setFlow(r);
        else setFlow(null);
        load();
        if (!('key' in r)) loadFlow(selected);
      })
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setBusy(false));
  }

  const pending = flows.filter((f) => !f.sent);
  const sent = flows.filter((f) => f.sent);

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="text-xl font-semibold tracking-tight text-gray-900">Send</h2>
      <p className="mt-1 text-base text-gray-500">
        Packets and filings — each one is a route of waypoints. Progress saves
        as you walk; the board on :8777 sees the same state.
      </p>

      {err && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </p>
      )}

      <ul className="mt-5 space-y-1.5">
        {pending.map((f) => (
          <li key={f.key}>
            <button
              type="button"
              onClick={() => setSelected(f.key === selected ? null : f.key)}
              aria-expanded={f.key === selected}
              className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg border px-3 py-2 text-left ${
                f.key === selected
                  ? 'border-indigo-200 bg-indigo-50/50'
                  : 'border-gray-100 bg-white hover:bg-gray-50'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium text-gray-900">
                  {f.label}
                </span>
                <span className="block truncate text-sm text-gray-500">
                  {f.current_title
                    ? `step ${f.at + 1} of ${f.total} — ${f.current_title}`
                    : f.total
                      ? `${f.total} waypoints — not started`
                      : 'no route'}
                  {f.how ? ` · ${f.how}` : ''}
                </span>
              </span>
              <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {f.channel}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected && flow && (
        <FlowCard flow={flow} busy={busy} onAct={act} onErr={setErr} />
      )}

      {sent.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-gray-500">
            Sent ({sent.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {sent.map((f) => (
              <li key={f.key} className="px-3 py-1.5 text-sm text-gray-400">
                <span className="font-medium text-gray-500">{f.label}</span>
                {f.sent?.date ? ` — ${f.sent.date}` : ''}
                {f.sent?.method ? ` via ${f.sent.method}` : ''}
                {f.sent?.conf ? ` (${f.sent.conf})` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FlowCard({
  flow,
  busy,
  onAct,
  onErr,
}: {
  flow: FlowPayload;
  busy: boolean;
  onAct: (action: string, body?: unknown) => void;
  onErr: (e: string | null) => void;
}) {
  const crumbs = flow.state.path.slice(-3);
  const step = flow.current?.step;

  if (flow.sent) {
    return (
      <section className="mt-4 rounded-xl border border-green-100 bg-green-50/40 p-4">
        <h3 className="text-lg font-semibold text-green-800">
          Done — {flow.label}
        </h3>
        <p className="mt-1 text-base text-gray-600">
          Sent {flow.sent.date} via {flow.sent.method}
          {flow.sent.conf ? ` — ${flow.sent.conf}` : ''}
        </p>
      </section>
    );
  }

  if (flow.done || !step) {
    return (
      <FinalReview flow={flow} busy={busy} onAct={onAct} />
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      {/* WHERE IT STANDS */}
      <p className="text-sm text-gray-500">
        Waypoint {flow.state.path.length + 1} of {flow.total}
        {crumbs.length > 0 && (
          <span className="block text-xs text-gray-400">
            {crumbs.join(' → ')} → <b>here</b>
          </span>
        )}
      </p>

      {/* NEXT ACTION — the current waypoint, executable in place */}
      <h3 className="mt-2 text-lg font-semibold text-gray-900">{step.title}</h3>
      {step.detail && <p className="mt-1 text-base text-gray-600">{step.detail}</p>}

      {/* EVIDENCE — text, files, links the step needs in front of you */}
      {step.text && (
        <details className="mt-3" open={step.text.length < 4000}>
          <summary className="cursor-pointer text-sm font-medium text-gray-500">
            The text
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-800">
            {step.text}
          </pre>
        </details>
      )}
      {step.file_list && step.files && (
        <ul className="mt-2 space-y-0.5 text-sm">
          {step.file_list.map((f) => (
            <li key={f}>
              <a
                className="text-indigo-600 hover:underline"
                href={fileHref(step.files!, f)}
                target="_blank"
                rel="noreferrer"
              >
                {f}
              </a>
            </li>
          ))}
        </ul>
      )}
      {step.link && (
        <p className="mt-3">
          <a
            className="inline-flex min-h-[44px] items-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
            href={step.link}
            target="_blank"
            rel="noreferrer"
          >
            Open: {step.link}
          </a>
        </p>
      )}

      {step.options ? (
        <div className="mt-4 space-y-2">
          {step.options.map((o) => (
            <button
              key={String(o.goto)}
              type="button"
              disabled={busy}
              onClick={() => onAct('option', { goto: o.goto })}
              className="block w-full rounded-lg border border-gray-200 px-4 py-2.5 text-left text-base text-gray-800 hover:border-indigo-300 hover:bg-indigo-50/40 disabled:opacity-50"
            >
              {o.label}
              {o.note && (
                <span className="block text-sm text-gray-500">{o.note}</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <>
          {step.form && (
            <FormWaypoint
              step={step}
              busy={busy}
              onAct={onAct}
            />
          )}
          {step.attach_dir && (
            <AttachWaypoint
              flowKey={flow.key}
              step={step}
              busy={busy}
              onErr={onErr}
              onDone={() => onAct('step')}
            />
          )}
          {!step.form && (
            <StepAdvance step={step} busy={busy} onAct={onAct} />
          )}
          {step.form && (
            <p className="mt-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => onAct('step')}
                className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Done with this step — next waypoint
              </button>
            </p>
          )}
        </>
      )}

      {flow.state.trail.length > 0 && (
        <p className="mt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => onAct('back')}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            ← back a waypoint
          </button>
        </p>
      )}
    </section>
  );
}

function StepAdvance({
  step,
  busy,
  onAct,
}: {
  step: FlowStep;
  busy: boolean;
  onAct: (action: string, body?: unknown) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="mt-4">
      {step.input && (
        <input
          className={inputClass}
          placeholder={step.input}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      <div className="mt-2">
        <PrimaryButton disabled={busy} onClick={() => onAct('step', { note })}>
          Done — next waypoint
        </PrimaryButton>
      </div>
    </div>
  );
}

function FormWaypoint({
  step,
  busy,
  onAct,
}: {
  step: FlowStep;
  busy: boolean;
  onAct: (action: string, body?: unknown) => void;
}) {
  const fields = step.form?.fields ?? [];
  const entries = step.entries ?? [];
  const repeat = step.form?.repeat !== false;
  const [mode, setMode] = useState<'view' | 'edit' | 'add'>('view');
  const [values, setValues] = useState<Record<string, string>>({});

  if (entries.length > 0 && mode === 'view') {
    return (
      <div className="mt-3">
        <table className="w-full text-sm">
          <tbody>
            {entries.map((entry, i) =>
              fields.map((f) => (
                <tr key={`${i}-${f.name}`} className="border-b border-gray-50">
                  <td className="py-1.5 pr-3 text-gray-400">{f.label}</td>
                  <td className="py-1.5 font-medium text-gray-800">
                    {entry[f.name] || '—'}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        <div className="mt-2 flex gap-4 text-sm">
          <button
            type="button"
            className="text-indigo-600 hover:underline"
            onClick={() => {
              setValues(entries[entries.length - 1] ?? {});
              setMode('edit');
            }}
          >
            edit
          </button>
          {repeat && (
            <button
              type="button"
              className="text-indigo-600 hover:underline"
              onClick={() => {
                setValues({});
                setMode('add');
              }}
            >
              + add another
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onAct('form', { values, mode: mode === 'edit' ? 'edit' : undefined });
        setMode('view');
        setValues({});
      }}
    >
      {fields.map((f) => (
        <label key={f.name} className="block">
          <span className="mb-1 block text-sm font-medium text-gray-600">
            {f.label}
          </span>
          <input
            className={inputClass}
            name={f.name}
            placeholder={f.placeholder}
            value={values[f.name] ?? ''}
            onChange={(e) =>
              setValues((v) => ({ ...v, [f.name]: e.target.value }))
            }
          />
        </label>
      ))}
      <PrimaryButton type="submit" disabled={busy}>
        Save — show me what I entered
      </PrimaryButton>
    </form>
  );
}

function AttachWaypoint({
  flowKey,
  step,
  busy,
  onErr,
  onDone,
}: {
  flowKey: string;
  step: FlowStep;
  busy: boolean;
  onErr: (e: string | null) => void;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  function upload(file: File) {
    const fd = new FormData();
    fd.set('doc', file, file.name);
    setUploading(true);
    fetch(`/api/flows/${encodeURIComponent(flowKey)}/attach`, {
      method: 'POST',
      body: fd,
    })
      .then(async (r) => {
        if (!r.ok) {
          const b = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error || `${r.status}`);
        }
        onDone(); // parent refetches the payload — the new file shows
      })
      .catch((e) => onErr(String(e.message || e)))
      .finally(() => {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      });
  }

  return (
    <div className="mt-3">
      {step.dir_list && step.dir_list.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-sm text-gray-600">
          {step.dir_list.map((f) => (
            <li key={f}>
              <a
                className="text-indigo-600 hover:underline"
                href={fileHref(step.attach_dir!, f)}
                target="_blank"
                rel="noreferrer"
              >
                {f}
              </a>
            </li>
          ))}
        </ul>
      )}
      <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
        <Icon name="plus" className="h-4 w-4" />
        {uploading ? 'Adding…' : 'Add a document'}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          disabled={busy || uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
      </label>
    </div>
  );
}

function FinalReview({
  flow,
  busy,
  onAct,
}: {
  flow: FlowPayload;
  busy: boolean;
  onAct: (action: string, body?: unknown) => void;
}) {
  const [sign, setSign] = useState(true);
  const notes = flow.state.notes.join(' · ');
  return (
    <section className="mt-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">
        Final review — {flow.label}
      </h3>
      <p className="mt-1 text-sm text-gray-500">
        All {flow.total} waypoints complete.
      </p>
      <p className="mt-3 text-base text-gray-700">
        {flow.email_to ? (
          <>
            On complete this <b>sends the real email to {flow.email_to}</b>,
            then records the contact, sets the follow-up, and updates the
            tracker, mail queue, case state, and changelog.
          </>
        ) : (
          <>
            On complete this marks the item sent and records the contact —
            tracker, mail queue, case state, and changelog all update.
          </>
        )}
      </p>
      {notes && (
        <p className="mt-2 text-sm text-gray-500">
          Your notes: <i>{notes}</i>
        </p>
      )}
      {flow.email_to && (
        <label className="mt-3 flex items-start gap-2 text-base text-gray-700">
          <input
            type="checkbox"
            checked={sign}
            onChange={(e) => setSign(e.target.checked)}
            className="mt-1.5 h-4 w-4"
          />
          Sign electronically — the letter goes out with /s/ Bradley Crowe and
          /s/ Dena Sazama on the signature lines.
        </label>
      )}
      <div className="mt-4 flex items-center gap-3">
        <PrimaryButton
          disabled={busy}
          onClick={() =>
            onAct('complete', {
              sign,
              method: flow.email_to ? 'email' : 'form/phone/mail',
            })
          }
        >
          {busy ? 'Working…' : 'Complete — send & record'}
        </PrimaryButton>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAct('reset')}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          Start over
        </button>
      </div>
    </section>
  );
}
