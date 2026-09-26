import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import {
  MAX_OUTCOMES,
  MIN_OUTCOMES,
  MultiOutcomeSelector,
  defaultOutcomes,
  type OutcomeOption,
} from './MultiOutcomeSelector';

/** Renders the selector as a controlled component with real state. */
function Harness({ initial }: { initial?: OutcomeOption[] }) {
  const [outcomes, setOutcomes] = React.useState<OutcomeOption[]>(initial ?? defaultOutcomes(2));

  return <MultiOutcomeSelector value={outcomes} onChange={setOutcomes} />;
}

function rowsCount() {
  return screen.getAllByRole('listitem').length;
}

describe('MultiOutcomeSelector', () => {
  it('starts with the minimum of two outcomes by default', () => {
    render(<Harness />);

    expect(rowsCount()).toBe(2);
    expect(screen.getByTestId('outcome-count-hint')).toHaveTextContent('2 of 32 outcomes');
  });

  it('adds outcomes up to the 32 ceiling and then disables the add button', () => {
    render(<Harness initial={defaultOutcomes(31)} />);

    expect(rowsCount()).toBe(31);
    expect(screen.getByTestId('outcome-add')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('outcome-add'));

    expect(rowsCount()).toBe(MAX_OUTCOMES);
    expect(screen.getByTestId('outcome-add')).toBeDisabled();
  });

  it('removes outcomes down to the 2 floor and then disables remove', () => {
    render(<Harness initial={defaultOutcomes(3)} />);

    const [first] = screen.getAllByTestId(/^outcome-remove-/);
    fireEvent.click(first);

    expect(rowsCount()).toBe(MIN_OUTCOMES);

    const remaining = screen.getAllByTestId(/^outcome-remove-/);
    remaining.forEach((button) => expect(button).toBeDisabled());
  });

  it('recomputes an even split when every outcome has zero reserve', () => {
    render(<Harness initial={defaultOutcomes(4)} />);

    const percentages = screen.getAllByTestId(/^outcome-percent-/);

    percentages.forEach((node) => expect(node).toHaveTextContent('25.0%'));
  });

  it('normalizes percentages proportionally to reserves and they sum to 100', () => {
    render(
      <Harness
        initial={[
          { id: 'a', label: 'Yes', reserve: 300 },
          { id: 'b', label: 'No', reserve: 100 },
        ]}
      />,
    );

    expect(screen.getByTestId('outcome-percent-a')).toHaveTextContent('75.0%');
    expect(screen.getByTestId('outcome-percent-b')).toHaveTextContent('25.0%');
  });

  it('updates a label in place without disturbing other outcomes', () => {
    render(<Harness initial={defaultOutcomes(3)} />);

    const labels = screen.getAllByTestId(/^outcome-label-/);
    fireEvent.change(labels[1], { target: { value: 'Draw' } });

    expect(screen.getAllByTestId(/^outcome-label-/)[1]).toHaveValue('Draw');
    expect(rowsCount()).toBe(3);
  });

  it('moves focus between rows with ArrowDown and ArrowUp', () => {
    render(<Harness initial={defaultOutcomes(3)} />);

    const labels = screen.getAllByTestId(/^outcome-label-/);
    labels[0].focus();

    fireEvent.keyDown(labels[0], { key: 'ArrowDown' });
    expect(labels[1]).toHaveFocus();

    fireEvent.keyDown(labels[1], { key: 'ArrowDown' });
    expect(labels[2]).toHaveFocus();

    fireEvent.keyDown(labels[2], { key: 'ArrowUp' });
    expect(labels[1]).toHaveFocus();
  });

  it('renders one donut segment per outcome with an accessible label', () => {
    render(<Harness initial={defaultOutcomes(5)} />);

    const donut = screen.getByTestId('outcome-donut');
    expect(donut).toHaveAttribute('role', 'img');
    expect(donut.querySelectorAll('[data-testid^="donut-segment-"]')).toHaveLength(5);
  });

  it('disables all controls when disabled is set', () => {
    function DisabledHarness() {
      const [outcomes, setOutcomes] = React.useState<OutcomeOption[]>(defaultOutcomes(3));
      return <MultiOutcomeSelector value={outcomes} onChange={setOutcomes} disabled />;
    }

    render(<DisabledHarness />);

    screen.getAllByTestId(/^outcome-label-/).forEach((input) => expect(input).toBeDisabled());
    screen.getAllByTestId(/^outcome-remove-/).forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByTestId('outcome-add')).toBeDisabled();
  });
});

describe('defaultOutcomes', () => {
  it('clamps below the minimum up to 2', () => {
    expect(defaultOutcomes(0)).toHaveLength(MIN_OUTCOMES);
  });

  it('clamps above the maximum down to 32', () => {
    expect(defaultOutcomes(50)).toHaveLength(MAX_OUTCOMES);
  });

  it('generates unique ids for every outcome', () => {
    const outcomes = defaultOutcomes(10);
    expect(new Set(outcomes.map((o) => o.id)).size).toBe(10);
  });
});
