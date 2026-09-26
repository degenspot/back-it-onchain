'use client';

/**
 * Position sizing & profit projection matrix (FE-006).
 *
 * A pre-stake calculator: the person hasn't placed a position yet and is
 * deciding how much to risk. Everything here is a pure client-side
 * projection from `payout-utils` — no network calls, no dependency beyond
 * React itself, so the numbers update on every slider tick with nothing to
 * wait on.
 */

import * as React from 'react';
import {
  defaultScenarios,
  projectPosition,
  projectScenarios,
  type PoolScenario,
} from '../lib/payout-utils';

export interface ProfitMatrixProps {
  stakeAmount: number;
  onStakeAmountChange: (value: number) => void;
  existingWinningPoolTotal: number;
  existingLosingPoolTotal: number;
  protocolFeeBps?: number;
  /** When given alongside a handler, the surge fee becomes a second slider. */
  surgeFeeBps?: number;
  onSurgeFeeBpsChange?: (value: number) => void;
  /** Upper bound for the stake slider. Defaults to 10x the existing winning pool, or $10,000. */
  maxStake?: number;
  scenarios?: PoolScenario[];
  disabled?: boolean;
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';

  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—';

  return `${(fraction * 100).toFixed(1)}%`;
}

export function ProfitMatrix({
  stakeAmount,
  onStakeAmountChange,
  existingWinningPoolTotal,
  existingLosingPoolTotal,
  protocolFeeBps = 0,
  surgeFeeBps = 0,
  onSurgeFeeBpsChange,
  maxStake,
  scenarios,
  disabled,
}: ProfitMatrixProps) {
  const stakeCeiling = maxStake ?? Math.max(existingWinningPoolTotal * 10, 10_000);
  const activeScenarios = scenarios ?? defaultScenarios();

  const current = React.useMemo(
    () =>
      projectPosition({
        stakeAmount,
        existingWinningPoolTotal,
        existingLosingPoolTotal,
        protocolFeeBps,
        surgeFeeBps,
      }),
    [stakeAmount, existingWinningPoolTotal, existingLosingPoolTotal, protocolFeeBps, surgeFeeBps],
  );

  const matrix = React.useMemo(
    () =>
      projectScenarios(
        { stakeAmount, existingWinningPoolTotal, existingLosingPoolTotal, protocolFeeBps, surgeFeeBps },
        activeScenarios,
      ),
    [stakeAmount, existingWinningPoolTotal, existingLosingPoolTotal, protocolFeeBps, surgeFeeBps, activeScenarios],
  );

  return (
    <section className="flex flex-col gap-4" data-testid="profit-matrix">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center justify-between text-gray-600">
            <span>Stake amount</span>
            <span data-testid="stake-amount-value" className="font-medium tabular-nums text-gray-900">
              {formatUsd(stakeAmount)}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={stakeCeiling}
            step={Math.max(1, Math.round(stakeCeiling / 200))}
            value={stakeAmount}
            disabled={disabled}
            aria-label="Stake amount"
            data-testid="stake-amount-slider"
            onChange={(event) => onStakeAmountChange(Number(event.target.value))}
          />
        </label>

        {onSurgeFeeBpsChange ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center justify-between text-gray-600">
              <span>Surge fee</span>
              <span data-testid="surge-fee-value" className="font-medium tabular-nums text-gray-900">
                {(surgeFeeBps / 100).toFixed(2)}%
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={500}
              step={5}
              value={surgeFeeBps}
              disabled={disabled}
              aria-label="Surge fee"
              data-testid="surge-fee-slider"
              onChange={(event) => onSurgeFeeBpsChange(Number(event.target.value))}
            />
          </label>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 rounded border p-3 sm:grid-cols-4" data-testid="current-projection">
        <div>
          <p className="text-xs text-gray-500">Net payout</p>
          <p data-testid="current-net" className="text-lg font-semibold tabular-nums">
            {formatUsd(current.payout.net)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Profit</p>
          <p
            data-testid="current-profit"
            className={`text-lg font-semibold tabular-nums ${
              current.payout.profit >= 0 ? 'text-green-700' : 'text-red-700'
            }`}
          >
            {formatUsd(current.payout.profit)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Multiplier</p>
          <p data-testid="current-multiplier" className="text-lg font-semibold tabular-nums">
            {current.multiplier.toFixed(2)}x
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Break-even probability</p>
          <p data-testid="current-breakeven" className="text-lg font-semibold tabular-nums">
            {formatPercent(current.breakEvenProbability)}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm" data-testid="scenario-matrix">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="py-1 pr-2 font-medium">Scenario</th>
              <th className="py-1 pr-2 font-medium">Net payout</th>
              <th className="py-1 pr-2 font-medium">Profit</th>
              <th className="py-1 pr-2 font-medium">Multiplier</th>
              <th className="py-1 pr-2 font-medium">Break-even</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.scenario.id} data-testid={`scenario-row-${row.scenario.id}`} className="border-b">
                <td className="py-1 pr-2">{row.scenario.label}</td>
                <td className="py-1 pr-2 tabular-nums" data-testid={`scenario-net-${row.scenario.id}`}>
                  {formatUsd(row.payout.net)}
                </td>
                <td
                  className={`py-1 pr-2 tabular-nums ${row.payout.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}
                  data-testid={`scenario-profit-${row.scenario.id}`}
                >
                  {formatUsd(row.payout.profit)}
                </td>
                <td className="py-1 pr-2 tabular-nums" data-testid={`scenario-multiplier-${row.scenario.id}`}>
                  {row.multiplier.toFixed(2)}x
                </td>
                <td className="py-1 pr-2 tabular-nums" data-testid={`scenario-breakeven-${row.scenario.id}`}>
                  {formatPercent(row.breakEvenProbability)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default ProfitMatrix;
