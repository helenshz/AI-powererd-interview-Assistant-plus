// Return actionable errors without exposing upstream request data or credentials.
export function groqErrorResponse(error: unknown): Response {
  const failure = error as { status?: number; code?: string; error?: { code?: string } } | null;
  const upstreamStatus = failure?.status;
  const code = failure?.code || failure?.error?.code;
  let status = 503;
  let message = "无法连接问答模型服务，请检查网络后重试。";
  if (code === 'configuration_error') {
    message = "模型配置不完整，请检查 .env.local 中的 LLM_PROVIDER、API Key、模型名称和 API 地址。";
  } else if (code === 'empty_completion') {
    status = 502;
    message = "模型未生成回答，自动重试后仍为空。请缩短问题或转写内容后重新生成。";
  } else if (upstreamStatus === 401) {
    message = "模型 API Key 无效或已过期，请检查所选服务的密钥，然后重启服务。";
  } else if (upstreamStatus === 402) {
    status = 402;
    message = "模型服务账户余额不足（HTTP 402）。请到所选服务的平台检查 API 余额，或切换到已配置的其他模型服务。";
  } else if (upstreamStatus === 403) {
    message = "模型服务拒绝访问，请检查账户及模型的访问权限。";
  } else if (upstreamStatus === 404 || code === "model_not_found" || code === "model_decommissioned") {
    message = "模型不存在、已停用或当前账户无权访问，请检查 LLM_MODEL（Groq 也可使用 GROQ_MODEL）。";
  } else if (upstreamStatus === 429) {
    status = 429;
    message = "已达到模型服务的请求频率或用量限制，请稍后重试，并查看控制台用量。";
  } else if (upstreamStatus === 400 || upstreamStatus === 413 || upstreamStatus === 422) {
    status = 400;
    message = "模型无法处理此请求，请缩短转写内容，并检查模型配置。";
  } else if (upstreamStatus && upstreamStatus >= 500) {
    message = "模型服务暂时异常，请稍后重试。";
  }
  return Response.json({ error: message }, { status });
}
