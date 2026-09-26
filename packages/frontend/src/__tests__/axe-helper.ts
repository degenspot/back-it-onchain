import axe from 'axe-core';

/**
 * Runs an axe-core audit restricted to the WCAG 2.1 A/AA rule sets (FE-038).
 *
 * Scoping to the tags the issue actually targets keeps the suite from failing
 * on best-practice rules that are not part of the AA conformance bar.
 */
export async function auditA11y(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    },
    // jsdom has no layout engine, so colour-contrast cannot be evaluated here.
    // It is deliberately excluded rather than silently reported as passing;
    // contrast needs a real browser or a design-token review.
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

/** Formats violations into a readable assertion message. */
export function formatViolations(violations: axe.Result[]): string {
  if (violations.length === 0) return 'no violations';
  return violations
    .map((v) => {
      const targets = v.nodes.map((n) => n.target.join(' ')).join(', ');
      return `[${v.impact ?? 'unknown'}] ${v.id}: ${v.help} (${targets})`;
    })
    .join('\n');
}
