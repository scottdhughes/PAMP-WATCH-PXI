export const classifyMetricState = (zScore) => {
    if (zScore >= 2)
        return 'PAMP';
    if (zScore <= -2)
        return 'Stress';
    if (Math.abs(zScore) >= 1)
        return 'Caution';
    return 'Stable';
};
