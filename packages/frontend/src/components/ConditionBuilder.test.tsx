import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import {
  ConditionBuilder,
  PriceChartCrosshairPinner,
  applyPinnedTarget,
  defaultConditionFor,
  pinnableTargetsFor,
} from './ConditionBuilder';
import type { FormattedChartData } from '../lib/chart-utils';
import type { Condition } from '../lib/condition';

/** Renders the builder as a controlled component with real state. */
function Harness({ initial }: { initial?: Condition }) {
  const [condition, setCondition] = React.useState<Condition>(
    initial ?? { kind: 'target_price', direction: 'above', price: 100 },
  );

  return <ConditionBuilder value={condition} onChange={setCondition} referencePrice={100} />;
}

describe('ConditionBuilder', () => {
  it('offers all three condition kinds', () => {
    render(<Harness />);

    expect(screen.getByTestId('condition-kind-target_price')).toBeInTheDocument();
    expect(screen.getByTestId('condition-kind-percent_move')).toBeInTheDocument();
    expect(screen.getByTestId('condition-kind-range')).toBeInTheDocument();
  });

  it('marks the active kind as the selected tab', () => {
    render(<Harness />);

    expect(screen.getByTestId('condition-kind-target_price')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('condition-kind-range')).toHaveAttribute('aria-selected', 'false');
  });

  it('switches fields when the kind changes', () => {
    render(<Harness />);

    expect(screen.getByTestId('target-price')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('condition-kind-range'));

    expect(screen.queryByTestId('target-price')).not.toBeInTheDocument();
    expect(screen.getByTestId('range-lower')).toBeInTheDocument();
    expect(screen.getByTestId('range-upper')).toBeInTheDocument();
  });

  it('shows the condition as a sentence', () => {
    render(<Harness />);

    expect(screen.getByTestId('condition-summary')).toHaveTextContent('above');
    expect(screen.getByTestId('condition-summary')).toHaveTextContent('100');
  });

  // The live preview is the feature: a condition is only checkable by trying a
  // price against it.
  it('previews the outcome for a probed price and updates as it changes', () => {
    render(<Harness />);

    // Probe seeds from the reference price (100), which is not above 100.
    expect(screen.getByTestId('condition-outcome')).toHaveTextContent('NO');

    fireEvent.change(screen.getByTestId('condition-probe'), { target: { value: '150' } });
    expect(screen.getByTestId('condition-outcome')).toHaveTextContent('YES');

    fireEvent.change(screen.getByTestId('condition-probe'), { target: { value: '50' } });
    expect(screen.getByTestId('condition-outcome')).toHaveTextContent('NO');
  });

  it('reflects an edited target price in the preview', () => {
    render(<Harness />);

    fireEvent.change(screen.getByTestId('condition-probe'), { target: { value: '150' } });
    expect(screen.getByTestId('condition-outcome')).toHaveTextContent('YES');

    // Move the target above the probe; the outcome must flip.
    fireEvent.change(screen.getByTestId('target-price'), { target: { value: '200' } });
    expect(screen.getByTestId('condition-outcome')).toHaveTextContent('NO');
  });

  it('previews a percent move against its implied threshold', () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId('condition-kind-percent_move'));

    // Default is +10% of 100 = 110.
    expect(screen.getByTestId('condition-summary')).toHaveTextContent('10%');

    fireEvent.change(screen.getByTestId('condition-probe'), { target: { value: '109' } });
    expect(screen.getByTestId('condition-outcome')).toHaveTextContent('NO');

    fireEvent.change(screen.getByTestId('condition-probe'), { target: { value: '110' } });
    expect(screen.getByTestId('condition-outcome')).toHaveTextContent('YES');
  });

  it('previews a range against both bounds', () => {
    render(<Harness initial={{ kind: 'range', lower: 90, upper: 110, inclusive: true }} />);

    fireEvent.change(screen.getByTestId('condition-probe'), { target: { value: '100' } });
    expect(screen.getByTestId('condition-outcome')).toHaveTextContent('YES');

    fireEvent.change(screen.getByTestId('condition-probe'), { target: { value: '120' } });
    expect(screen.getByTestId('condition-outcome')).toHaveTextContent('NO');
  });

  it('honours the inclusive toggle at a bound', () => {
    render(<Harness initial={{ kind: 'range', lower: 90, upper: 110, inclusive: true }} />);

    fireEvent.change(screen.getByTestId('condition-probe'), { target: { value: '110' } });
    expect(screen.getByTestId('condition-outcome')).toHaveTextContent('YES');

    fireEvent.click(screen.getByTestId('range-inclusive'));
    expect(screen.getByTestId('condition-outcome')).toHaveTextContent('NO');
  });

  // An invalid condition has no meaningful outcome, so the builder must not
  // show a confident YES or NO for one.
  it('withholds the preview while the condition is invalid', () => {
    render(<Harness initial={{ kind: 'range', lower: 90, upper: 110, inclusive: true }} />);

    fireEvent.change(screen.getByTestId('range-upper'), { target: { value: '50' } });

    expect(screen.getByTestId('condition-preview-invalid')).toBeInTheDocument();
    expect(screen.queryByTestId('condition-outcome')).not.toBeInTheDocument();
  });

  it('shows a field-level message for an inverted range', () => {
    render(<Harness initial={{ kind: 'range', lower: 90, upper: 110, inclusive: true }} />);

    fireEvent.change(screen.getByTestId('range-upper'), { target: { value: '50' } });

    expect(screen.getByRole('alert')).toHaveTextContent('below the upper bound');
  });

  it('reports validity to the parent as it changes', () => {
    const onValidityChange = vi.fn();

    function ValidityHarness() {
      const [condition, setCondition] = React.useState<Condition>({
        kind: 'range',
        lower: 90,
        upper: 110,
        inclusive: true,
      });

      return (
        <ConditionBuilder
          value={condition}
          onChange={setCondition}
          onValidityChange={onValidityChange}
        />
      );
    }

    render(<ValidityHarness />);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);

    fireEvent.change(screen.getByTestId('range-upper'), { target: { value: '10' } });
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it('lets a number field be cleared without fighting the keystroke', () => {
    render(<Harness />);

    const input = screen.getByTestId('target-price');

    fireEvent.change(input, { target: { value: '' } });

    // The field keeps what was typed rather than snapping back to a number.
    expect((input as HTMLInputElement).value).toBe('');
  });
});

describe('defaultConditionFor', () => {
  it('seeds each kind from the reference price', () => {
    expect(defaultConditionFor('target_price', 250)).toEqual({
      kind: 'target_price',
      direction: 'above',
      price: 250,
    });

    expect(defaultConditionFor('percent_move', 250)).toMatchObject({ basePrice: 250 });

    const range = defaultConditionFor('range', 100);
    expect(range).toMatchObject({ kind: 'range', lower: 90, upper: 110 });
  });

  // A missing or nonsensical reference must not produce a condition that
  // fails its own schema.
  it('falls back to a usable default for a bad reference price', () => {
    for (const reference of [0, -5, Number.NaN]) {
      const condition = defaultConditionFor('target_price', reference);

      expect(condition).toMatchObject({ price: 100 });
    }
  });
});

describe('pinnableTargetsFor / applyPinnedTarget', () => {
  it('exposes one target for target_price and writes it back to price', () => {
    const condition: Condition = { kind: 'target_price', direction: 'above', price: 100 };
    const targets = pinnableTargetsFor(condition);

    expect(targets).toEqual([{ id: 'price', label: 'Target price', price: 100 }]);
    expect(applyPinnedTarget(condition, 'price', 120)).toMatchObject({ price: 120 });
  });

  it('exposes the reference price for percent_move and writes it back to basePrice', () => {
    const condition: Condition = { kind: 'percent_move', direction: 'up', percent: 10, basePrice: 100 };
    const targets = pinnableTargetsFor(condition);

    expect(targets).toEqual([{ id: 'basePrice', label: 'Reference price', price: 100 }]);
    expect(applyPinnedTarget(condition, 'basePrice', 90)).toMatchObject({ basePrice: 90 });
  });

  it('exposes two independent targets for range, each writing back to its own bound', () => {
    const condition: Condition = { kind: 'range', lower: 90, upper: 110, inclusive: true };
    const targets = pinnableTargetsFor(condition);

    expect(targets).toEqual([
      { id: 'lower', label: 'Lower bound', price: 90 },
      { id: 'upper', label: 'Upper bound', price: 110 },
    ]);
    expect(applyPinnedTarget(condition, 'lower', 95)).toMatchObject({ lower: 95, upper: 110 });
    expect(applyPinnedTarget(condition, 'upper', 130)).toMatchObject({ lower: 90, upper: 130 });
  });

  it('leaves the condition unchanged for an id that does not belong to it', () => {
    const condition: Condition = { kind: 'target_price', direction: 'above', price: 100 };

    expect(applyPinnedTarget(condition, 'lower', 50)).toBe(condition);
  });
});

describe('PriceChartCrosshairPinner', () => {
  const series: FormattedChartData[] = Array.from({ length: 10 }, (_, i) => ({
    time: `${i}`,
    value: 90 + i,
  }));

  /** jsdom does not compute layout, so a drag interaction needs a stubbed rect. */
  function stubChartRect(height = 220) {
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      top: 0,
      left: 0,
      right: 600,
      bottom: height,
      width: 600,
      height,
      x: 0,
      y: 0,
      toJSON: () => {},
    })) as unknown as typeof Element.prototype.getBoundingClientRect;
  }

  it('renders one draggable slider per target with its current price', () => {
    render(
      <PriceChartCrosshairPinner
        data={series}
        targets={[{ id: 'price', label: 'Target price', price: 100 }]}
        onTargetChange={() => {}}
      />,
    );

    const handle = screen.getByTestId('crosshair-hitarea-price');
    expect(handle).toHaveAttribute('role', 'slider');
    expect(handle).toHaveAttribute('aria-valuenow', '100');
  });

  it('moves the target price on mouse drag, using the pinned Y position', () => {
    stubChartRect(220);
    const onTargetChange = vi.fn();

    render(
      <PriceChartCrosshairPinner
        data={series}
        targets={[{ id: 'price', label: 'Target price', price: 99 }]}
        onTargetChange={onTargetChange}
      />,
    );

    fireEvent.mouseDown(screen.getByTestId('crosshair-hitarea-price'));
    fireEvent.mouseMove(window, { clientY: 0 });

    expect(onTargetChange).toHaveBeenCalledWith('price', expect.any(Number));
    // Dragging to the very top of the chart should pin near the highest visible price.
    const [, calledPrice] = onTargetChange.mock.calls[0];
    expect(calledPrice).toBeGreaterThan(99);

    fireEvent.mouseUp(window);
  });

  it('moves the target price on touch drag as well as mouse drag', () => {
    stubChartRect(220);
    const onTargetChange = vi.fn();

    render(
      <PriceChartCrosshairPinner
        data={series}
        targets={[{ id: 'price', label: 'Target price', price: 99 }]}
        onTargetChange={onTargetChange}
      />,
    );

    fireEvent.touchStart(screen.getByTestId('crosshair-hitarea-price'));
    fireEvent.touchMove(window, { touches: [{ clientY: 220 }] });

    expect(onTargetChange).toHaveBeenCalled();

    fireEvent.touchEnd(window);
  });

  it('supports keyboard nudging as a fallback for assistive technology', () => {
    const onTargetChange = vi.fn();

    render(
      <PriceChartCrosshairPinner
        data={series}
        targets={[{ id: 'price', label: 'Target price', price: 99 }]}
        onTargetChange={onTargetChange}
      />,
    );

    const handle = screen.getByTestId('crosshair-hitarea-price');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(onTargetChange).toHaveBeenLastCalledWith('price', expect.any(Number));

    const upValue = onTargetChange.mock.calls[0][1];
    expect(upValue).toBeGreaterThan(99);

    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    const downValue = onTargetChange.mock.calls[1][1];
    expect(downValue).toBeLessThan(99);
  });

  it('does not respond to drag or keyboard input while disabled', () => {
    const onTargetChange = vi.fn();

    render(
      <PriceChartCrosshairPinner
        data={series}
        targets={[{ id: 'price', label: 'Target price', price: 99 }]}
        onTargetChange={onTargetChange}
        disabled
      />,
    );

    const handle = screen.getByTestId('crosshair-hitarea-price');
    expect(handle).toHaveAttribute('tabindex', '-1');

    fireEvent.mouseDown(handle);
    fireEvent.mouseMove(window, { clientY: 0 });
    fireEvent.keyDown(handle, { key: 'ArrowUp' });

    expect(onTargetChange).not.toHaveBeenCalled();
  });

  it('shows a delta percentage relative to the reference price for each target', () => {
    render(
      <PriceChartCrosshairPinner
        data={series}
        targets={[{ id: 'price', label: 'Target price', price: 110 }]}
        referencePrice={100}
        onTargetChange={() => {}}
      />,
    );

    expect(screen.getByTestId('crosshair-delta-price')).toHaveTextContent('+10.0%');
  });

  it('shows a projected payout multiplier when payoutInput is given', () => {
    render(
      <PriceChartCrosshairPinner
        data={series}
        targets={[{ id: 'price', label: 'Target price', price: 110 }]}
        referencePrice={100}
        payoutInput={{ userStake: 100, winningPoolTotal: 400, losingPoolTotal: 400, feeBps: 200 }}
        onTargetChange={() => {}}
      />,
    );

    expect(screen.getByTestId('crosshair-multiplier-price')).toHaveTextContent('1.96x payout');
  });

  it('omits the payout multiplier readout when payoutInput is not given', () => {
    render(
      <PriceChartCrosshairPinner
        data={series}
        targets={[{ id: 'price', label: 'Target price', price: 110 }]}
        onTargetChange={() => {}}
      />,
    );

    expect(screen.queryByTestId('crosshair-multiplier-price')).not.toBeInTheDocument();
  });

  it('renders two independent sliders for a range condition', () => {
    render(
      <PriceChartCrosshairPinner
        data={series}
        targets={[
          { id: 'lower', label: 'Lower bound', price: 92 },
          { id: 'upper', label: 'Upper bound', price: 105 },
        ]}
        onTargetChange={() => {}}
      />,
    );

    expect(screen.getByTestId('crosshair-target-lower')).toBeInTheDocument();
    expect(screen.getByTestId('crosshair-target-upper')).toBeInTheDocument();
  });
});

describe('ConditionBuilder with priceSeries', () => {
  it('renders the crosshair chart when priceSeries is given, and hides it otherwise', () => {
    const series: FormattedChartData[] = [
      { time: '0', value: 95 },
      { time: '1', value: 100 },
      { time: '2', value: 105 },
    ];

    const { rerender } = render(<Harness />);
    expect(screen.queryByTestId('crosshair-chart')).not.toBeInTheDocument();

    rerender(
      <ConditionBuilder
        value={{ kind: 'target_price', direction: 'above', price: 100 }}
        onChange={() => {}}
        priceSeries={series}
      />,
    );

    expect(screen.getByTestId('crosshair-chart')).toBeInTheDocument();
  });

  it('dragging the chart crosshair updates the same condition the number field shows', () => {
    const series: FormattedChartData[] = Array.from({ length: 5 }, (_, i) => ({
      time: `${i}`,
      value: 95 + i,
    }));

    function PinnedHarness() {
      const [condition, setCondition] = React.useState<Condition>({
        kind: 'target_price',
        direction: 'above',
        price: 100,
      });

      return (
        <ConditionBuilder value={condition} onChange={setCondition} priceSeries={series} referencePrice={100} />
      );
    }

    render(<PinnedHarness />);

    fireEvent.mouseDown(screen.getByTestId('crosshair-hitarea-price'));
    fireEvent.mouseMove(window, { clientY: 0 });
    fireEvent.mouseUp(window);

    // The number field above should now reflect the dragged price.
    expect(screen.getByTestId('target-price')).not.toHaveValue('100');
  });
});
