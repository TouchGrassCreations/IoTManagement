export function createInventoryResponseGuard() {
  let revision = 0;
  return {
    beginLoad() {
      const startedAt = ++revision;
      return {
        apply(callback: () => void): boolean {
          if (startedAt !== revision) return false;
          callback();
          return true;
        },
      };
    },
    recordMutation(): void { revision += 1; },
  };
}
