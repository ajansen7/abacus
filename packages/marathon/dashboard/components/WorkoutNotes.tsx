'use client';

const ICON_RULES: Array<{ pattern: RegExp; icon: string }> = [
  { pattern: /^RACE DAY/i, icon: '🏆' },
  { pattern: /^Effort:/i, icon: '🔥' },
  { pattern: /^Trail:/i, icon: '⛰️' },
  { pattern: /^Knee:/i, icon: '🦵' },
  { pattern: /^Buddy:/i, icon: '👥' },
  { pattern: /^Fuel|^Eat|^Nutrition/i, icon: '⚡' },
  { pattern: /^Focus:/i, icon: '🎯' },
  { pattern: /Zone [1-5]|heart rate|HR zone/i, icon: '❤️' },
  { pattern: /\d+[×x]\d+|\bsets\b|\breps\b/i, icon: '💪' },
  { pattern: /~\d+.*mile|estimated distance|target distance/i, icon: '📏' },
  { pattern: /walk.?run|run.?walk|\d+ min run|\d+ min walk/i, icon: '🏃' },
  { pattern: /hill|climb|elevation|gain/i, icon: '⛰️' },
  { pattern: /pace|\/mi|\/km/i, icon: '⏱️' },
  { pattern: /trust|you('ve| have) got|start easy|race day/i, icon: '✨' },
];

function lineIcon(text: string): string {
  for (const rule of ICON_RULES) {
    if (rule.pattern.test(text)) return rule.icon;
  }
  return '·';
}

interface Props {
  notes: string;
  className?: string;
}

export function WorkoutNotes({ notes, className = '' }: Props) {
  const lines = notes
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  // First line is the title/summary — render slightly more prominent, no bullet
  const [title, ...rest] = lines;

  return (
    <div className={`mt-2 text-xs text-muted ${className}`}>
      <div className="mb-1 font-medium text-zinc-400">{title}</div>
      {rest.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {rest.map((line, i) => {
            const icon = lineIcon(line);
            return (
              <li key={i} className="flex items-start gap-1.5 leading-relaxed">
                <span className="mt-px shrink-0 select-none text-[11px]" aria-hidden>
                  {icon}
                </span>
                <span>{line}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
