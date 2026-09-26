'use client';

/**
 * Condition builder (FE-04).
 *
 * Controlled: the parent owns the condition, so the wizard can persist a
 * draft and restore it without this component holding a second copy that
 * could drift.
 *
 * The live preview is the point of the component. A condition is a claim about
 * the future, and the only way to be sure it says what you meant is to try a
 * price against it — so the builder shows the sentence form and lets you probe
 * an arbitrary price for its YES/NO outcome as you type.
 */

import * as React from 'react';
import {
  CONDITION_KINDS,
  CONDITION_KIND_LABELS,
  conditionSchema,
  conditionThresholds,
  describeCondition,
  evaluateCondition,
  type Condition,
  type ConditionKind,
} from '../lib/condition';
import {
  crosshairYFromPrice,
  percentDelta,
  priceFromCrosshairY,
  projectedPayoutMultiplier,
  type FormattedChartData,
} from '../lib/chart-utils';

export interface ConditionBuilderProps {
  value: Condition;
  onChange: (next: Condition) => void;
  /** Reported on every change so a parent can block submission. */
  onValidityChange?: (valid: boolean) => void;
  /** Seeds the percent-move reference and the preview probe. */
  referencePrice?: number;
  disabled?: boolean;
  /** Historical price series (FE-004). Renders the crosshair pinning chart when given. */
  priceSeries?: FormattedChartData[];
  /** Forwarded to the crosshair chart's payout-multiplier readout, when given. */
  payoutInput?: PriceChartCrosshairPinnerProps['payoutInput'];
}

/**
 * Trim binary floating-point noise from a derived price.
 *
 * `100 * 1.1` is `110.00000000000001`, which would be seeded straight into a
 * visible input. Eight decimals is past any price precision this app shows and
 * well inside what a double represents exactly for these magnitudes.
 */
function roundPrice(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/** A blank condition of the given kind, seeded from a reference price. */
export function defaultConditionFor(kind: ConditionKind, referencePrice = 100): Condition {
  const base = Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : 100;

  switch (kind) {
    case 'target_price':
      return { kind: 'target_price', direction: 'above', price: roundPrice(base) };
    case 'percent_move':
      return { kind: 'percent_move', direction: 'up', percent: 10, basePrice: roundPrice(base) };
    case 'range':
      return {
        kind: 'range',
        lower: roundPrice(base * 0.9),
        upper: roundPrice(base * 1.1),
        inclusive: true,
      };
  }
}

/** First validation message for a field, if any. */
function errorFor(condition: Condition, field: string): string | undefined {
  const result = conditionSchema.safeParse(condition);

  if (result.success) return undefined;

  return result.error.issues.find((issue) => issue.path[0] === field)?.message;
}

/**
 * A number input that keeps what the user typed.
 *
 * Storing the raw string matters: binding an input straight to a number makes
 * "0." or an empty field impossible to type through, because each keystroke is
 * parsed and written back.
 */
function NumberField({
  label,
  value,
  onChange,
  error,
  disabled,
  testId,
  step = 'any',
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  error?: string;
  disabled?: boolean;
  testId: string;
  step?: string;
}) {
  const [draft, setDraft] = React.useState(String(value));

  // Follow the parent when it changes the value from outside (a kind switch,
  // or a restored draft) without fighting the user mid-keystroke.
  React.useEffect(() => {
    setDraft((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-gray-600">{label}</span>
      <input
        type="number"
        step={step}
        inputMode="decimal"
        aria-label={label}
        data-testid={testId}
        disabled={disabled}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);

          const parsed = Number.parseFloat(event.target.value);
          onChange(Number.isNaN(parsed) ? Number.NaN : parsed);
        }}
        className="rounded border px-2 py-1"
      />
      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function TargetPriceFields({
  value,
  onChange,
  disabled,
}: {
  value: Extract<Condition, { kind: 'target_price' }>;
  onChange: (next: Condition) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-600">Direction</span>
        <select
          aria-label="Direction"
          data-testid="target-direction"
          disabled={disabled}
          value={value.direction}
          onChange={(event) =>
            onChange({ ...value, direction: event.target.value as 'above' | 'below' })
          }
          className="rounded border px-2 py-1"
        >
          <option value="above">Above</option>
          <option value="below">Below</option>
        </select>
      </label>

      <NumberField
        label="Target price"
        testId="target-price"
        disabled={disabled}
        value={value.price}
        error={errorFor(value, 'price')}
        onChange={(price) => onChange({ ...value, price })}
      />
    </div>
  );
}

export function PercentMoveFields({
  value,
  onChange,
  disabled,
}: {
  value: Extract<Condition, { kind: 'percent_move' }>;
  onChange: (next: Condition) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-600">Direction</span>
        <select
          aria-label="Direction"
          data-testid="percent-direction"
          disabled={disabled}
          value={value.direction}
          onChange={(event) => onChange({ ...value, direction: event.target.value as 'up' | 'down' })}
          className="rounded border px-2 py-1"
        >
          <option value="up">Up</option>
          <option value="down">Down</option>
        </select>
      </label>

      <NumberField
        label="Percent"
        testId="percent-amount"
        disabled={disabled}
        value={value.percent}
        error={errorFor(value, 'percent')}
        onChange={(percent) => onChange({ ...value, percent })}
      />

      <NumberField
        label="Reference price"
        testId="percent-base"
        disabled={disabled}
        value={value.basePrice}
        error={errorFor(value, 'basePrice')}
        onChange={(basePrice) => onChange({ ...value, basePrice })}
      />
    </div>
  );
}

export function RangeFields({
  value,
  onChange,
  disabled,
}: {
  value: Extract<Condition, { kind: 'range' }>;
  onChange: (next: Condition) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <NumberField
        label="Lower bound"
        testId="range-lower"
        disabled={disabled}
        value={value.lower}
        error={errorFor(value, 'lower')}
        onChange={(lower) => onChange({ ...value, lower })}
      />

      <NumberField
        label="Upper bound"
        testId="range-upper"
        disabled={disabled}
        value={value.upper}
        error={errorFor(value, 'upper')}
        onChange={(upper) => onChange({ ...value, upper })}
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          aria-label="Include bounds"
          data-testid="range-inclusive"
          disabled={disabled}
          checked={value.inclusive}
          onChange={(event) => onChange({ ...value, inclusive: event.target.checked })}
        />
        <span className="text-gray-600">Include bounds</span>
      </label>
    </div>
  );
}

/**
 * Sentence form plus a probe: type a price, see the outcome.
 */
export function ConditionPreview({
  condition,
  probePrice,
  onProbeChange,
}: {
  condition: Condition;
  probePrice: number;
  onProbeChange: (next: number) => void;
}) {
  const valid = conditionSchema.safeParse(condition).success;

  if (!valid) {
    return (
      <p data-testid="condition-preview-invalid" className="text-sm text-gray-500">
        Finish the condition to see a preview.
      </p>
    );
  }

  const outcome = evaluateCondition(condition, probePrice);

  return (
    <div className="flex flex-col gap-2">
      <p data-testid="condition-summary" className="text-sm font-medium">
        {describeCondition(condition)}
      </p>

      <p data-testid="condition-thresholds" className="text-xs text-gray-500">
        Resolves at {conditionThresholds(condition).map((t) => `$${t}`).join(' – ')}
      </p>

      <div className="flex items-end gap-3">
        <NumberField
          label="If the price were"
          testId="condition-probe"
          value={probePrice}
          onChange={onProbeChange}
        />

        <span
          data-testid="condition-outcome"
          className={
            outcome
              ? 'rounded bg-green-100 px-2 py-1 text-sm font-semibold text-green-800'
              : 'rounded bg-red-100 px-2 py-1 text-sm font-semibold text-red-800'
          }
        >
          {outcome ? 'YES' : 'NO'}
        </span>
      </div>
    </div>
  );
}

/** A single price the crosshair chart can pin, and the price it currently holds. */
export interface PinnableTarget {
  id: string;
  label: string;
  price: number;
}

/**
 * Which of a condition's numeric fields are pinnable on the price chart.
 *
 * A range has two independent thresholds; the other two kinds have one each.
 * `percent_move`'s reference price counts too, since it is still a price the
 * chart can set, even though it is not itself the resolution threshold.
 */
export function pinnableTargetsFor(condition: Condition): PinnableTarget[] {
  switch (condition.kind) {
    case 'target_price':
      return [{ id: 'price', label: 'Target price', price: condition.price }];

    case 'percent_move':
      return [{ id: 'basePrice', label: 'Reference price', price: condition.basePrice }];

    case 'range':
      return [
        { id: 'lower', label: 'Lower bound', price: condition.lower },
        { id: 'upper', label: 'Upper bound', price: condition.upper },
      ];
  }
}

/** Apply a pinned target's new price back onto the condition it came from. */
export function applyPinnedTarget(
  condition: Condition,
  targetId: string,
  price: number,
): Condition {
  switch (condition.kind) {
    case 'target_price':
      return targetId === 'price' ? { ...condition, price } : condition;

    case 'percent_move':
      return targetId === 'basePrice' ? { ...condition, basePrice: price } : condition;

    case 'range':
      if (targetId === 'lower') return { ...condition, lower: price };
      if (targetId === 'upper') return { ...condition, upper: price };
      return condition;
  }
}

export interface PriceChartCrosshairPinnerProps {
  /** Historical price series shown as the reference line. */
  data: FormattedChartData[];
  targets: PinnableTarget[];
  onTargetChange: (targetId: string, price: number) => void;
  /** Used for the delta% readout; falls back to the series' last point. */
  referencePrice?: number;
  /** When given, each target also shows a projected payout multiplier. */
  payoutInput?: {
    userStake: number;
    winningPoolTotal: number;
    losingPoolTotal: number;
    feeBps?: number;
  };
  disabled?: boolean;
  height?: number;
}

/**
 * Historical price line with one draggable horizontal crosshair per pinnable
 * target (FE-004).
 *
 * Drawn as plain SVG rather than through a canvas charting library: the drag
 * interaction is the feature, and a hand-rolled polyline keeps the pixel math
 * (drag position to price, and back) in two pure, independently testable
 * functions in `chart-utils`, instead of behind a third-party chart's
 * internal coordinate system.
 *
 * Dragging updates the same condition fields the number inputs above write
 * to, and moving those inputs moves the line here: both read from `targets`,
 * which the parent derives from one source of truth, the condition itself.
 */
export function PriceChartCrosshairPinner({
  data,
  targets,
  onTargetChange,
  referencePrice,
  payoutInput,
  disabled,
  height = 220,
}: PriceChartCrosshairPinnerProps) {
  const width = 600;
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  const values = data.map((point) => point.value);
  const targetPrices = targets.map((target) => target.price);
  const allPrices = [...values, ...targetPrices].filter(Number.isFinite);

  const rawMin = allPrices.length > 0 ? Math.min(...allPrices) : 0;
  const rawMax = allPrices.length > 0 ? Math.max(...allPrices) : 1;
  const padding = Math.max((rawMax - rawMin) * 0.1, rawMax * 0.01, 1e-6);
  const minPrice = rawMin - padding;
  const maxPrice = rawMax + padding;

  const effectiveReference = referencePrice ?? values[values.length - 1] ?? 0;

  const priceAtClientY = React.useCallback(
    (clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const top = rect?.top ?? 0;
      const rectHeight = rect?.height || height;
      const localY = ((clientY - top) / rectHeight) * height;

      return priceFromCrosshairY(localY, height, minPrice, maxPrice);
    },
    [height, minPrice, maxPrice],
  );

  React.useEffect(() => {
    if (!draggingId) return;

    function handleMove(event: MouseEvent | TouchEvent) {
      const clientY = 'touches' in event ? event.touches[0]?.clientY : event.clientY;
      if (clientY === undefined) return;

      onTargetChange(draggingId as string, priceAtClientY(clientY));
    }

    function handleUp() {
      setDraggingId(null);
    }

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [draggingId, onTargetChange, priceAtClientY]);

  const linePoints = data
    .map((point, index) => {
      const x = data.length <= 1 ? 0 : (index / (data.length - 1)) * width;
      const y = crosshairYFromPrice(point.value, height, minPrice, maxPrice);

      return `${x},${y}`;
    })
    .join(' ');

  const step = (maxPrice - minPrice) / 100 || 1;

  return (
    <div data-testid="crosshair-chart" className="flex flex-col gap-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="group"
        aria-label="Price history with draggable target lines"
        className="rounded border bg-white"
      >
        {values.length > 1 ? (
          <polyline
            data-testid="crosshair-price-line"
            points={linePoints}
            fill="none"
            stroke="#9ca3af"
            strokeWidth={1.5}
          />
        ) : null}

        {targets.map((target, index) => {
          const y = crosshairYFromPrice(target.price, height, minPrice, maxPrice);
          const color = index === 0 ? '#2563eb' : '#dc2626';

          return (
            <g key={target.id} data-testid={`crosshair-target-${target.id}`}>
              <line x1={0} x2={width} y1={y} y2={y} stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
              {/* Wide, mostly-transparent hit area: easier to grab than the 1.5px line itself. */}
              <rect
                x={0}
                y={y - 8}
                width={width}
                height={16}
                fill="transparent"
                style={{ cursor: disabled ? 'default' : 'ns-resize' }}
                data-testid={`crosshair-hitarea-${target.id}`}
                tabIndex={disabled ? -1 : 0}
                role="slider"
                aria-label={target.label}
                aria-valuemin={Math.round(minPrice)}
                aria-valuemax={Math.round(maxPrice)}
                aria-valuenow={Math.round(target.price)}
                aria-valuetext={`$${target.price.toFixed(2)}`}
                onMouseDown={() => !disabled && setDraggingId(target.id)}
                onTouchStart={() => !disabled && setDraggingId(target.id)}
                onKeyDown={(event) => {
                  if (disabled) return;

                  if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    onTargetChange(target.id, target.price + step);
                  } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    onTargetChange(target.id, target.price - step);
                  } else if (event.key === 'Home') {
                    event.preventDefault();
                    onTargetChange(target.id, minPrice);
                  } else if (event.key === 'End') {
                    event.preventDefault();
                    onTargetChange(target.id, maxPrice);
                  }
                }}
              />
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap gap-4 text-xs">
        {targets.map((target, index) => {
          const delta = percentDelta(target.price, effectiveReference);
          const multiplier = payoutInput
            ? projectedPayoutMultiplier({ ...payoutInput, userStake: payoutInput.userStake })
            : null;
          const color = index === 0 ? 'text-blue-700' : 'text-red-700';

          return (
            <div key={target.id} data-testid={`crosshair-readout-${target.id}`} className={color}>
              <span className="font-medium">{target.label}:</span> ${target.price.toFixed(2)} ·{' '}
              <span data-testid={`crosshair-delta-${target.id}`}>
                {delta >= 0 ? '+' : ''}
                {delta.toFixed(1)}%
              </span>
              {multiplier !== null ? (
                <>
                  {' '}
                  ·{' '}
                  <span data-testid={`crosshair-multiplier-${target.id}`}>
                    {multiplier.toFixed(2)}x payout
                  </span>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ConditionBuilder({
  value,
  onChange,
  onValidityChange,
  referencePrice = 100,
  disabled,
  priceSeries,
  payoutInput,
}: ConditionBuilderProps) {
  const [probePrice, setProbePrice] = React.useState(referencePrice);

  const valid = conditionSchema.safeParse(value).success;

  React.useEffect(() => {
    onValidityChange?.(valid);
  }, [valid, onValidityChange]);

  const pinnableTargets = pinnableTargetsFor(value);

  return (
    <section className="flex flex-col gap-4" data-testid="condition-builder">
      {priceSeries ? (
        <PriceChartCrosshairPinner
          data={priceSeries}
          targets={pinnableTargets}
          referencePrice={referencePrice}
          payoutInput={payoutInput}
          disabled={disabled}
          onTargetChange={(targetId, price) => onChange(applyPinnedTarget(value, targetId, price))}
        />
      ) : null}

      <div role="tablist" aria-label="Condition type" className="flex gap-2">
        {CONDITION_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={value.kind === kind}
            data-testid={`condition-kind-${kind}`}
            disabled={disabled}
            onClick={() => onChange(defaultConditionFor(kind, referencePrice))}
            className={
              value.kind === kind
                ? 'rounded bg-black px-3 py-1 text-sm text-white'
                : 'rounded border px-3 py-1 text-sm'
            }
          >
            {CONDITION_KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      {value.kind === 'target_price' ? (
        <TargetPriceFields value={value} onChange={onChange} disabled={disabled} />
      ) : null}
      {value.kind === 'percent_move' ? (
        <PercentMoveFields value={value} onChange={onChange} disabled={disabled} />
      ) : null}
      {value.kind === 'range' ? (
        <RangeFields value={value} onChange={onChange} disabled={disabled} />
      ) : null}

      <ConditionPreview
        condition={value}
        probePrice={probePrice}
        onProbeChange={setProbePrice}
      />
    </section>
  );
}

export default ConditionBuilder;
