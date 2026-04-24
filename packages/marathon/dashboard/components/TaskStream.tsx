'use client';

import { useEffect, useRef, useState } from 'react';
import { taskStreamUrl } from '@/lib/abacus';

interface Props {
  taskId: string;
}

export function TaskStream({ taskId }: Props) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(taskStreamUrl(taskId), { signal: controller.signal });
        if (!res.ok) throw new Error(`stream: ${res.status}`);
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!cancelled) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) {
            setDone(true);
            break;
          }
          buf += decoder.decode(value, { stream: true });
          const split = buf.split('\n');
          buf = split.pop() ?? '';
          if (split.length > 0) setLines((prev) => [...prev, ...split]);
        }
        if (buf) setLines((prev) => [...prev, buf]);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, taskId]);

  return (
    <div className="rounded-md border border-border bg-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-muted hover:text-zinc-100"
      >
        <span className="font-mono">{taskId}</span>
        <span>{open ? 'hide' : 'show'} log</span>
      </button>
      {open ? (
        <pre className="max-h-64 overflow-auto border-t border-border px-3 py-2 font-mono text-[11px] leading-tight text-zinc-300">
          {lines.length === 0 && !error ? 'connecting…' : null}
          {lines.map((line, i) => (
            <div key={i}>{line || ' '}</div>
          ))}
          {error ? <div className="text-rose-400">error: {error}</div> : null}
          {done ? <div className="text-muted">— end of log —</div> : null}
        </pre>
      ) : null}
    </div>
  );
}
