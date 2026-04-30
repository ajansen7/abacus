'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoachMessage } from '@/lib/abacus';
import { webhookPost } from '@/lib/abacus';

interface CoachChatProps {
  coachMessages: CoachMessage[];
  planId: string | undefined;
  isCoachReplying: boolean;
  onRefresh: () => void;
}

export function CoachChat({ coachMessages, planId, isCoachReplying, onRefresh }: CoachChatProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [coachMessages, open, isCoachReplying]);

  async function send() {
    const text = input.trim();
    if (!text || !planId || sending) return;
    setSending(true);
    try {
      await webhookPost('coach-message', { message: text });
      setInput('');
      onRefresh();
    } finally {
      setSending(false);
    }
  }

  const hasNewCoachReply = coachMessages.some((m) => m.role === 'coach') && !open;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div
          className="flex w-80 flex-col rounded-xl border border-indigo-500/30 bg-zinc-900/95 shadow-2xl backdrop-blur-md"
          style={{ height: '420px' }}
        >
          <div className="flex items-center justify-between border-b border-zinc-700/50 px-4 py-3">
            <span className="text-sm font-semibold text-indigo-300">Coach</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
            {coachMessages.length === 0 && !isCoachReplying && (
              <p className="pt-4 text-center text-xs text-zinc-500">
                Tell your coach about schedule changes, injuries, or how training is feeling.
              </p>
            )}
            {coachMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-700 text-zinc-100'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isCoachReplying && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-zinc-700 px-3 py-2 text-sm text-zinc-400">
                  <span className="animate-pulse">Coach is thinking…</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-zinc-700/50 p-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Message your coach…"
                className="flex-1 rounded-lg border border-border bg-zinc-800/80 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500/50"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || !input.trim() || !planId}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition-transform hover:scale-105 hover:bg-indigo-500 active:scale-95"
      >
        <span className="text-2xl leading-none">💬</span>
        {hasNewCoachReply && (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-zinc-900" />
        )}
      </button>
    </div>
  );
}
