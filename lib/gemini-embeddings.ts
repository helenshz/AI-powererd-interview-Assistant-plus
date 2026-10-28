// Uploads and queries must use the same model and vector dimensions.
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

export async function generateTextEmbedding(text: string): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key.startsWith("your-")) throw new Error("请配置 GEMINI_API_KEY 并重启服务。");
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error("无法连接 Gemini 向量服务，请检查网络后重试。");
  }
  if (!response.ok) {
    if (response.status === 429) throw new Error("Gemini 向量服务额度不足或请求过于频繁，请检查配额后重试。");
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new Error("Gemini 向量请求被拒绝，请检查 API Key、地区和模型权限，以及输入长度。");
    }
    if (response.status === 404) throw new Error(`Gemini 向量模型 ${EMBEDDING_MODEL} 不可用。`);
    throw new Error(`Gemini 向量服务请求失败（HTTP ${response.status}）。`);
  }
  const data = await response.json();
  const values: unknown = data.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS ||
      !values.every(value => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("Gemini 返回的向量维度或格式不正确。");
  }
  const norm = Math.hypot(...values);
  if (!norm) throw new Error("Gemini 返回了无效的零向量。");
  return values.map(value => value / norm);
}
