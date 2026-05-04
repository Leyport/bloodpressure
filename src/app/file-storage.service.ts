import { Injectable } from '@angular/core';
import { BpReading, SavedDataset } from './bp.model';

const STORAGE_KEY = 'bp_datasets';

@Injectable({ providedIn: 'root' })
export class FileStorageService {

  list(): SavedDataset[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  save(name: string, readings: BpReading[]): SavedDataset {
    const datasets = this.list();
    const dataset: SavedDataset = {
      id: crypto.randomUUID(),
      name: name.trim(),
      savedAt: new Date().toISOString(),
      readingCount: readings.length,
      readings: readings.map(r => ({
        date: r.date.toISOString(),
        systolic: r.systolic,
        diastolic: r.diastolic,
        ...(r.pulse !== undefined && { pulse: r.pulse }),
        ...(r.notes !== undefined && { notes: r.notes }),
      })),
    };
    datasets.unshift(dataset);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets));
    return dataset;
  }

  load(id: string): BpReading[] | null {
    const dataset = this.list().find(d => d.id === id);
    if (!dataset) return null;
    return dataset.readings.map(r => ({
      date: new Date(r.date),
      systolic: r.systolic,
      diastolic: r.diastolic,
      ...(r.pulse !== undefined && { pulse: r.pulse }),
      ...(r.notes !== undefined && { notes: r.notes }),
    }));
  }

  rename(id: string, newName: string): void {
    const datasets = this.list().map(d =>
      d.id === id ? { ...d, name: newName.trim() } : d
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets));
  }

  delete(id: string): void {
    const updated = this.list().filter(d => d.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }
}
