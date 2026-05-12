const knownUpstreamWarningCodes = ['DEP0176', 'DEP0190'];

const splitNodeOptions = (value) =>
  String(value || '')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

export const mergeNodeOptionsWithKnownWarningSuppressions = ({
  nodeOptions = '',
  warningCodes = knownUpstreamWarningCodes,
} = {}) => {
  const parts = splitNodeOptions(nodeOptions);
  const existing = new Set(parts);

  for (const code of warningCodes) {
    const option = `--disable-warning=${code}`;
    if (!existing.has(option)) {
      parts.push(option);
      existing.add(option);
    }
  }

  return parts.join(' ');
};

export const buildNodeWarningPolicyEnv = ({ env = process.env } = {}) => ({
  ...env,
  NODE_OPTIONS: mergeNodeOptionsWithKnownWarningSuppressions({
    nodeOptions: env.NODE_OPTIONS,
  }),
});
