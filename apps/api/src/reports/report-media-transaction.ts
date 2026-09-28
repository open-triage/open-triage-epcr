/** Retry only fully rolled-back transactions, preserving command identity and authorization checks. */
export async function retryMediaTransaction<T>(transaction: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await transaction();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (attempt >= 3 || (code !== "40001" && code !== "40P01")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}
