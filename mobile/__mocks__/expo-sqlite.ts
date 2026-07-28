// In-memory mock for expo-sqlite — can be enhanced if needed
export async function openDatabaseAsync(_name: string): Promise<any> {
  return {
    execAsync: async () => {},
    runAsync: async () => {},
    getAllAsync: async () => [],
    getFirstAsync: async () => null,
  };
}
