/**
 * Kernel Density Estimation utility
 * Uses Gaussian kernel with Silverman's rule of thumb for bandwidth selection.
 */

export interface KDEPoint {
  x: number;
  y: number;
}

export function calculateKDE(values: number[], numPoints: number = 100): { x: number[]; y: number[] } {
  if (values.length === 0) return { x: [], y: [] };

  // Filter out non-finite values
  const cleanValues = values.filter(v => Number.isFinite(v));
  if (cleanValues.length === 0) return { x: [], y: [] };

  const localMin = cleanValues.reduce((a, b) => Math.min(a, b), Infinity);
  const localMax = cleanValues.reduce((a, b) => Math.max(a, b), -Infinity);
  const localRange = localMax - localMin;

  // Handle case where all values are the same
  if (localRange === 0) {
    return {
      x: [localMin - 1, localMin, localMin + 1],
      y: [0, cleanValues.length, 0]
    };
  }

  // Silverman's rule of thumb for bandwidth
  const mean = cleanValues.reduce((a, b) => a + b, 0) / cleanValues.length;
  const std = Math.sqrt(cleanValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / cleanValues.length);
  // Ensure minimum bandwidth to avoid numerical issues
  const bandwidth = Math.max(1e-10, 1.06 * std * Math.pow(cleanValues.length, -0.2));

  const x: number[] = [];
  const y: number[] = [];

  for (let i = 0; i < numPoints; i++) {
    const xi = localMin + (localRange * i) / (numPoints - 1);
    x.push(xi);

    // Gaussian kernel - use normalized calculation for numerical stability
    let yi = 0;
    for (const v of cleanValues) {
      const z = (xi - v) / bandwidth;
      yi += Math.exp(-0.5 * z * z);
    }
    y.push(yi / (cleanValues.length * bandwidth * Math.sqrt(2 * Math.PI)));
  }

  return { x, y };
}
