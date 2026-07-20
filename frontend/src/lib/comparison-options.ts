import type { AnalysisType, SessionConfig } from '@/types';

export interface ConditionOption {
  key: string;
  label: string;
  group: Record<string, string>;
}

export interface Comparison {
  group1: Record<string, string>;
  group2: Record<string, string>;
}

const DIA_BOOKKEEPING_COLUMNS = new Set(['experiment', 'replicate', 'batch']);
const TMT_BOOKKEEPING_COLUMNS = new Set(['replicate', 'role', 'channel_role']);

function isTmtAnalysis(analysisType: AnalysisType | null): boolean {
  return analysisType === 'tmt' || analysisType === 'ptm';
}

function getConditionColumns(
  rows: Array<Record<string, string | number>>,
  analysisType: AnalysisType | null
): string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      const normalized = column.toLowerCase();
      const excluded = isTmtAnalysis(analysisType)
        ? TMT_BOOKKEEPING_COLUMNS.has(normalized)
        : DIA_BOOKKEEPING_COLUMNS.has(normalized);
      if (!excluded) columns.add(column);
    }
  }
  return Array.from(columns).sort();
}

export function conditionGroupKey(group: Record<string, string>): string {
  return JSON.stringify(
    Object.entries(group).sort(([left], [right]) => left.localeCompare(right))
  );
}

export function getConditionOptions(
  analysisType: AnalysisType | null,
  config: SessionConfig
): ConditionOption[] {
  const rows: Array<Record<string, string | number>> = isTmtAnalysis(analysisType)
    ? Object.values(config.tmt_channel_mapping ?? {})
    : Object.values(config.metadata_columns ?? {});
  const columns = getConditionColumns(rows, analysisType);
  const options = new Map<string, ConditionOption>();

  for (const row of rows) {
    const group: Record<string, string> = {};
    for (const column of columns) {
      group[column] = String(row[column] ?? '').trim();
    }
    const values = columns.map((column) => group[column]).filter(Boolean);
    if (values.length === 0) continue;

    const key = conditionGroupKey(group);
    if (!options.has(key)) {
      options.set(key, { key, label: values.join('+'), group });
    }
  }

  return Array.from(options.values()).sort(
    (left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key)
  );
}

export function generateReferenceComparisons(
  options: ConditionOption[],
  referenceKey: string
): Comparison[] {
  const reference = options.find((option) => option.key === referenceKey);
  if (!reference) return [];

  return options
    .filter((option) => option.key !== referenceKey)
    .map((option) => ({
      group1: { ...option.group },
      group2: { ...reference.group },
    }));
}
