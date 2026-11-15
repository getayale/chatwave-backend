import redisClient from "./redis.js";

export const getCache = async <T>(
  key: string,
): Promise<T | null> => {
  const cachedData = await redisClient.get(key);

  if (!cachedData) {
    return null;
  }

  return JSON.parse(cachedData) as T;
};

export const setCache = async (
  key: string,
  data: unknown,
  expirationSeconds: number,
): Promise<void> => {
  await redisClient.set(key, JSON.stringify(data), {
    EX: expirationSeconds,
  });
};

export const deleteCache = async (
  key: string,
): Promise<void> => {
  await redisClient.del(key);
};