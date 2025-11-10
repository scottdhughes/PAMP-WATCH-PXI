/**
 * Risk Direction Utilities
 *
 * Utilities for working with the risk_direction metadata field.
 * The risk_direction field indicates how changes in an indicator's value
 * relate to overall market risk.
 */

import type { RiskDirection } from '../shared/types.js';
import { pxiMetricDefinitions } from '../shared/pxiMetrics.js';

/**
 * Get the risk direction for a specific indicator
 */
export function getRiskDirection(indicatorId: string): RiskDirection | undefined {
  const metric = pxiMetricDefinitions.find((m) => m.id === indicatorId);
  return metric?.riskDirection;
}

/**
 * Determine if an increase in the indicator value represents increased risk
 *
 * @param indicatorId - The metric identifier
 * @returns true if higher values = more risk, false if higher values = less risk
 */
export function isIncreaseRisky(indicatorId: string): boolean {
  const riskDirection = getRiskDirection(indicatorId);
  return riskDirection === 'higher_is_more_risk';
}

/**
 * Interpret a raw value change in terms of risk
 *
 * @param indicatorId - The metric identifier
 * @param valueChange - The change in raw value (positive = increase)
 * @returns Description of the risk implication
 */
export function interpretValueChange(
  indicatorId: string,
  valueChange: number,
): {
  direction: 'increasing' | 'decreasing' | 'unchanged';
  riskImplication: 'increased_risk' | 'decreased_risk' | 'neutral';
  description: string;
} {
  if (valueChange === 0) {
    return {
      direction: 'unchanged',
      riskImplication: 'neutral',
      description: 'No change in indicator value',
    };
  }

  const riskDirection = getRiskDirection(indicatorId);
  const direction = valueChange > 0 ? 'increasing' : 'decreasing';

  if (!riskDirection) {
    return {
      direction,
      riskImplication: 'neutral',
      description: 'Unknown risk direction for indicator',
    };
  }

  let riskImplication: 'increased_risk' | 'decreased_risk';
  let description: string;

  if (riskDirection === 'higher_is_more_risk') {
    // Higher value = more risk
    if (valueChange > 0) {
      riskImplication = 'increased_risk';
      description = 'Increasing value indicates rising risk';
    } else {
      riskImplication = 'decreased_risk';
      description = 'Decreasing value indicates falling risk';
    }
  } else {
    // Higher value = less risk (safe haven behavior)
    if (valueChange > 0) {
      riskImplication = 'decreased_risk';
      description = 'Increasing value indicates falling risk (safe haven)';
    } else {
      riskImplication = 'increased_risk';
      description = 'Decreasing value indicates rising risk';
    }
  }

  return { direction, riskImplication, description };
}

/**
 * Get all indicators grouped by risk direction
 */
export function getIndicatorsByRiskDirection(): {
  higher_is_more_risk: string[];
  higher_is_less_risk: string[];
} {
  const result = {
    higher_is_more_risk: [] as string[],
    higher_is_less_risk: [] as string[],
  };

  pxiMetricDefinitions.forEach((metric) => {
    result[metric.riskDirection].push(metric.id);
  });

  return result;
}

/**
 * Get a human-readable description of the risk direction
 */
export function getRiskDirectionDescription(indicatorId: string): string {
  const metric = pxiMetricDefinitions.find((m) => m.id === indicatorId);
  if (!metric) return 'Unknown indicator';

  const { label, riskDirection } = metric;

  if (riskDirection === 'higher_is_more_risk') {
    return `${label}: Higher values indicate increased market risk`;
  } else {
    return `${label}: Higher values indicate decreased market risk (safe haven behavior)`;
  }
}

/**
 * Example usage and documentation
 */
export const examples = {
  // Example 1: Check if VIX increase is risky
  vixIncrease: () => {
    const result = interpretValueChange('vix', 5.0);
    // Returns: { direction: 'increasing', riskImplication: 'increased_risk', ... }
    return result;
  },

  // Example 2: Check if USD increase is risky
  usdIncrease: () => {
    const result = interpretValueChange('usd', 2.5);
    // Returns: { direction: 'increasing', riskImplication: 'decreased_risk', ... }
    // Because higher USD = flight to safety
    return result;
  },

  // Example 3: Get all indicators by risk direction
  groupedIndicators: () => {
    const grouped = getIndicatorsByRiskDirection();
    // Returns:
    // {
    //   higher_is_more_risk: ['hyOas', 'igOas', 'vix', 'u3', 'nfci'],
    //   higher_is_less_risk: ['usd', 'btcReturn']
    // }
    return grouped;
  },

  // Example 4: Get description for each indicator
  allDescriptions: () => {
    return pxiMetricDefinitions.map((metric) => ({
      id: metric.id,
      description: getRiskDirectionDescription(metric.id),
    }));
  },
};
