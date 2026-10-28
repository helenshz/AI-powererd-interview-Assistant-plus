// Return actionable errors without exposing upstream request data or credentials.
export function groqErrorResponse(error: unknown): Response {
  const failure = error as { status?: number; code?: string; error?: { code?: string } } | null;
  const upstreamStatus = failure?.status;
  const code = failure?.code || failure?.error?.code;
  let status = 503;
  let message = "无法连接 Groq 问答服务，请检查网络后重试。";
  if (code === 'empty_completion') {
    status = 502;
    message = "模型未生成回答，自动重试后仍为空。请缩短问题或转写内容后重新生成。";
  } else if (upstreamStatus === 401) {
    message = "Groq Key 无效或已过期，请检查 .env.local 中的 GROQ_API_KEY，然后重启服务。";
  } else if (upstreamStatus === 403) {
    message = "Groq 拒绝访问，请检查账户及模型的访问权限。";
  } else if (upstreamStatus === 404 || code === "model_not_found" || code === "model_decommissioned") {
    message = "Groq 模型不存在、已停用或当前账户无权访问，请检查 GROQ_MODEL。";
  } else if (upstreamStatus === 429) {
    status = 429;
    message = "已达到 Groq 请求频率或用量限制，请稍后重试，并查看控制台用量。";
  } else if (upstreamStatus === 400 || upstreamStatus === 413) {
    status = 400;
    message = "Groq 无法处理此请求，请缩短转写内容，并检查模型配置。";
  } else if (upstreamStatus && upstreamStatus >= 500) {
    message = "Groq 服务暂时异常，请稍后重试。";
  }
  return Response.json({ error: message }, { status });
}
