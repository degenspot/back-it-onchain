import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import { ProfitMatrix } from './ProfitMatrix';

/** Renders the matrix as a controlled component with real state. */
function Harness({
  initialStake = 100,
  initialSurgeFee,
  ...rest
}: {
  initialStake?: number;
  initialSurgeFee?: number;
  existingWinningPoolTotal: number;
  existingLosingPoolTotal: number;
  protocolFeeBps?: number;
  disabled?: boolean;
}) {
  const [stakeAmount, setStakeAmount] = React.useState(initialStake);
  const [surgeFeeBps, setSurgeFeeBps] = React.useState(initialSurgeFee ?? 0);

  return (
    <ProfitMatrix
      stakeAmount={stakeAmount}
      onStakeAmountChange={setStakeAmount}
      surgeFeeBps={surgeFeeBps}
      onSurgeFeeBpsChange={initialSurgeFee !== undefined ? setSurgeFeeBps : undefined}
      {...rest}
    />
  );
}

describe('ProfitMatrix', () => {
  it('renders the current projection and a scenario matrix row per default scenario', () => {
    render(<Harness existingWinningPoolTotal={100} existingLosingPoolTotal={100} />);

    expect(screen.getByTestId('current-net')).toBeInTheDocument();
    expect(screen.getByTestId('current-profit')).toBeInTheDocument();
    expect(screen.getByTestId('current-multiplier')).toBeInTheDocument();
    expect(screen.getByTestId('current-breakeven')).toBeInTheDocument();

    expect(screen.getByTestId('scenario-row-current')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-row-pool_doubles')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-row-opposing_plus_1000')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-row-dominant_outcome')).toBeInTheDocument();
  });

  it('updates the current projection live as the stake slider moves', () => {
    render(<Harness existingWinningPoolTotal={100} existingLosingPoolTotal={300} initialStake={0} />);

    const before = screen.getByTestId('current-net').textContent;

    fireEvent.change(screen.getByTestId('stake-amount-slider'), { target: { value: '200' } });

    const after = screen.getByTestId('current-net').textContent;

    expect(after).not.toBe(before);
    expect(screen.getByTestId('stake-amount-value')).toHaveTextContent('$200.00');
  });

  it('shows a surge fee slider only when a change handler is given, and reacts to it', () => {
    const { rerender } = render(<Harness existingWinningPoolTotal={100} existingLosingPoolTotal={100} />);

    expect(screen.queryByTestId('surge-fee-slider')).not.toBeInTheDocument();

    rerender(
      <Harness existingWinningPoolTotal={100} existingLosingPoolTotal={100} initialSurgeFee={0} />,
    );

    const netBefore = screen.getByTestId('current-net').textContent;
    fireEvent.change(screen.getByTestId('surge-fee-slider'), { target: { value: '300' } });
    const netAfter = screen.getByTestId('current-net').textContent;

    expect(screen.getByTestId('surge-fee-value')).toHaveTextContent('3.00%');
    expect(netAfter).not.toBe(netBefore);
  });

  it('reflects the protocol fee in the current projection', () => {
    render(
      <Harness existingWinningPoolTotal={100} existingLosingPoolTotal={100} initialStake={100} protocolFeeBps={0} />,
    );

    const noFeeNet = screen.getByTestId('current-net').textContent;

    const { unmount } = render(
      <Harness
        existingWinningPoolTotal={100}
        existingLosingPoolTotal={100}
        initialStake={100}
        protocolFeeBps={1000}
      />,
    );

    const feeNet = screen.getAllByTestId('current-net')[1].textContent;

    expect(feeNet).not.toBe(noFeeNet);
    unmount();
  });

  it('handles zero opposing stake without rendering NaN anywhere in the matrix', () => {
    render(<Harness existingWinningPoolTotal={0} existingLosingPoolTotal={0} initialStake={50} />);

    const cells = screen.getAllByTestId(/^scenario-(net|profit|multiplier|breakeven)-/);
    cells.forEach((cell) => expect(cell.textContent).not.toMatch(/NaN/));
  });

  it('handles a fully dominant outcome scenario without rendering NaN or Infinity', () => {
    render(<Harness existingWinningPoolTotal={1_000} existingLosingPoolTotal={0} initialStake={50} />);

    const dominantRow = screen.getByTestId('scenario-row-dominant_outcome');
    expect(dominantRow.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('disables both sliders when disabled is set', () => {
    render(
      <Harness
        existingWinningPoolTotal={100}
        existingLosingPoolTotal={100}
        initialSurgeFee={0}
        disabled
      />,
    );

    expect(screen.getByTestId('stake-amount-slider')).toBeDisabled();
    expect(screen.getByTestId('surge-fee-slider')).toBeDisabled();
  });

  it('accepts a custom scenario list in place of the defaults', () => {
    render(
      <ProfitMatrix
        stakeAmount={100}
        onStakeAmountChange={() => {}}
        existingWinningPoolTotal={100}
        existingLosingPoolTotal={100}
        scenarios={[{ id: 'custom', label: 'My custom scenario', losingPoolDelta: 50 }]}
      />,
    );

    expect(screen.getByTestId('scenario-row-custom')).toHaveTextContent('My custom scenario');
    expect(screen.queryByTestId('scenario-row-current')).not.toBeInTheDocument();
  });
});
