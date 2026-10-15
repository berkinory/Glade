const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

// Reads of unmodified pages come straight from the mmap window, so the page cache mostly holds
// pages written through the WAL, and SQLite never returns it once full. Measured on a 480MB
// database under a write-heavy workload, 32MB matched 128MB on speed while using ~95MB less
// memory; 16MB slowed writes by about 30%.
const CACHE_SIZE_PRAGMA = -(32 * MIB) / 1024;

export interface SqliteMemoryBudget {
  readonly cacheSizePragma: number;

  readonly mmapSizeBytes: number;
}

export function resolveSqliteMemoryBudget(totalMemoryBytes: number): SqliteMemoryBudget {
  const total = Number.isFinite(totalMemoryBytes) && totalMemoryBytes > 0 ? totalMemoryBytes : 0;
  if (total >= 24 * GIB) {
    return { cacheSizePragma: CACHE_SIZE_PRAGMA, mmapSizeBytes: 1 * GIB };
  }
  if (total >= 12 * GIB) {
    return { cacheSizePragma: CACHE_SIZE_PRAGMA, mmapSizeBytes: 512 * MIB };
  }
  return { cacheSizePragma: CACHE_SIZE_PRAGMA, mmapSizeBytes: 256 * MIB };
}
