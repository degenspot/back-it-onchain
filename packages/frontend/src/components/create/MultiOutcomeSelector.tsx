'use client';

/**
 * Multi-outcome selector & distribution donut (FE-001).
 *
 * Controlled, like the rest of the create flow: the parent owns the list of
 * outcomes so it can validate, persist a draft, and serialize alongside the
 * condition without this component holding a second copy that could drift.
 *
 * Percentages are derived from pool reserves, not typed in directly. A
 * creator adjusting outcome labels should never be able to make the
 * distribution say something the pool doesn't back.
 */

import * as React from 'react';
import {
  normalizeOutcomePercentages,
  outcomeColor,
  type OutcomeReserve,
} from '../../lib/condition';

/** Below this, a market stops being meaningfully multi-way. */
export const MIN_OUTCOMES = 2;
/** Above this, labels and the donut both stop being legible. */
export const MAX_OUTCOMES = 32;

export interface OutcomeOption {
  id: string;
  label: string;
  /** Staked reserve backing this outcome, for the live distribution preview. */
  reserve?: number;
}

export interface MultiOutcomeSelectorProps {
  value: OutcomeOption[];
  onChange: (next: OutcomeOption[]) => void;
  disabled?: boolean;
}

let idCounter = 0;

/** A reasonably unique id, since outcomes are reordered/removed by id, not index. */
function makeOutcomeId(): string {
  idCounter += 1;

  return `outcome-${Date.now()}-${idCounter}`;
}

/** A default set of `count` blank outcomes, clamped to the allowed range. */
export function defaultOutcomes(count = 2): OutcomeOption[] {
  const clamped = Math.max(MIN_OUTCOMES, Math.min(count, MAX_OUTCOMES));

  return Array.from({ length: clamped }, (_, index) => ({
    id: makeOutcomeId(),
    label: `Outcome ${index + 1}`,
    reserve: 0,
  }));
}

/**
 * Animated SVG donut of the current distribution.
 *
 * Built from stroke-dasharray segments on stacked circles rather than
 * `<path>` arcs, so segment length is a plain percentage-of-circumference
 * calculation. This keeps 2-outcome and 32-outcome markets on the same code
 * path with no arc-geometry edge cases at 0% or 100%.
 */
function DistributionDonut({
  outcomes,
  percentages,
}: {
  outcomes: OutcomeOption[];
  percentages: number[];
}) {
  const size = 160;
  const radius = 60;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;

  const label = outcomes
    .map((outcome, index) => `${outcome.label || `Outcome ${index + 1}`} ${percentages[index].toFixed(1)}%`)
    .join(', ');

  let offset = 0;

  return (
    <svg
      role="img"
      aria-label={`Outcome distribution: ${label}`}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      data-testid="outcome-donut"
    >
      <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
        <circle r={radius} fill="none" stroke="currentColor" className="text-gray-100" strokeWidth={strokeWidth} />
        {outcomes.map((outcome, index) => {
          const percent = percentages[index] ?? 0;
          const dash = (percent / 100) * circumference;
          const segmentOffset = offset;

          offset += dash;

          return (
            <circle
              key={outcome.id}
              data-testid={`donut-segment-${outcome.id}`}
              r={radius}
              fill="none"
              stroke={outcomeColor(index, outcomes.length)}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-segmentOffset}
              style={{ transition: 'stroke-dasharray 300ms ease, stroke-dashoffset 300ms ease' }}
            />
          );
        })}
      </g>
    </svg>
  );
}

/**
 * List of outcomes with inline labels, live percentages, and add/remove
 * controls, plus the distribution donut.
 *
 * Keyboard navigation moves focus between outcome rows with Up/Down, since the
 * arrow keys are free for that purpose on a single-line text input, unlike
 * Left/Right which the user needs for editing the label itself.
 */
export function MultiOutcomeSelector({ value, onChange, disabled }: MultiOutcomeSelectorProps) {
  const rowInputs = React.useRef<Array<HTMLInputElement | null>>([]);

  const percentages = React.useMemo(() => {
    const reserves: OutcomeReserve[] = value.map((outcome) => ({
      id: outcome.id,
      total: outcome.reserve ?? 0,
    }));
    const normalized = normalizeOutcomePercentages(reserves);
    const byId = new Map(normalized.map((entry) => [entry.id, entry.percent]));

    return value.map((outcome) => byId.get(outcome.id) ?? 0);
  }, [value]);

  const canAdd = value.length < MAX_OUTCOMES;
  const canRemove = value.length > MIN_OUTCOMES;

  function updateLabel(id: string, label: string) {
    onChange(value.map((outcome) => (outcome.id === id ? { ...outcome, label } : outcome)));
  }

  function addOutcome() {
    if (!canAdd) return;

    onChange([...value, { id: makeOutcomeId(), label: `Outcome ${value.length + 1}`, reserve: 0 }]);
  }

  function removeOutcome(id: string) {
    if (!canRemove) return;

    onChange(value.filter((outcome) => outcome.id !== id));
  }

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      rowInputs.current[index + 1]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      rowInputs.current[index - 1]?.focus();
    }
  }

  return (
    <section className="flex flex-col gap-4" data-testid="multi-outcome-selector">
      <div role="list" aria-label="Outcomes" className="flex flex-col gap-2">
        {value.map((outcome, index) => (
          <div
            key={outcome.id}
            role="listitem"
            data-testid={`outcome-row-${outcome.id}`}
            className="flex items-center gap-2 rounded border px-2 py-1"
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: outcomeColor(index, value.length) }}
            />

            <input
              ref={(element) => {
                rowInputs.current[index] = element;
              }}
              type="text"
              aria-label={`Outcome ${index + 1} label`}
              data-testid={`outcome-label-${outcome.id}`}
              disabled={disabled}
              value={outcome.label}
              onChange={(event) => updateLabel(outcome.id, event.target.value)}
              onKeyDown={(event) => handleRowKeyDown(event, index)}
              className="flex-1 rounded border px-2 py-1 text-sm"
            />

            <span
              data-testid={`outcome-percent-${outcome.id}`}
              className="w-16 shrink-0 text-right text-sm tabular-nums text-gray-600"
            >
              {percentages[index].toFixed(1)}%
            </span>

            <button
              type="button"
              aria-label={`Remove ${outcome.label || `outcome ${index + 1}`}`}
              data-testid={`outcome-remove-${outcome.id}`}
              disabled={disabled || !canRemove}
              onClick={() => removeOutcome(outcome.id)}
              className="rounded border px-2 py-1 text-xs text-red-600 disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        data-testid="outcome-add"
        disabled={disabled || !canAdd}
        onClick={addOutcome}
        className="self-start rounded border px-3 py-1 text-sm disabled:opacity-40"
      >
        Add outcome
      </button>

      <DistributionDonut outcomes={value} percentages={percentages} />

      <p data-testid="outcome-count-hint" className="text-xs text-gray-500">
        {value.length} of {MAX_OUTCOMES} outcomes ({MIN_OUTCOMES} minimum)
      </p>
    </section>
  );
}

export default MultiOutcomeSelector;
