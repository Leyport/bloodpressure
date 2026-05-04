export interface BpReading {
  date: Date;
  systolic: number;
  diastolic: number;
  pulse?: number;
  notes?: string;
}

export type BpCategory = 'Normal' | 'Elevated' | 'High Stage 1' | 'High Stage 2' | 'Crisis' | 'Low';

export function getBpCategory(systolic: number, diastolic: number): BpCategory {
  if (systolic > 180 || diastolic > 120) return 'Crisis';
  if (systolic >= 140 || diastolic >= 90) return 'High Stage 2';
  if (systolic >= 130 || diastolic >= 80) return 'High Stage 1';
  if (systolic >= 120 && diastolic < 80) return 'Elevated';
  if (systolic < 90 || diastolic < 60) return 'Low';
  return 'Normal';
}

export interface SavedDataset {
  id: string;
  name: string;
  savedAt: string;
  readingCount: number;
  readings: SerializedReading[];
}

export interface SerializedReading {
  date: string;
  systolic: number;
  diastolic: number;
  pulse?: number;
  notes?: string;
}

export const BP_CATEGORY_COLORS: Record<BpCategory, string> = {
  'Normal': '#22c55e',
  'Elevated': '#eab308',
  'High Stage 1': '#f97316',
  'High Stage 2': '#ef4444',
  'Crisis': '#7c3aed',
  'Low': '#3b82f6',
};
