import { createClient } from "@deepgram/sdk";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey || apiKey.startsWith("your-")) {
    return NextResponse.json({ error: "请在 .env.local 中配置 DEEPGRAM_API_KEY，并重启开发服务器。" }, { status: 503, headers });
  }
  try {
    const deepgram = createClient(apiKey);
    const { result: projects, error: projectsError } = await deepgram.manage.getProjects();
    if (projectsError) {
      return NextResponse.json({ error: "无法访问 Deepgram 项目，请检查 Key 是否有效，以及是否有查询项目的权限。" }, { status: 502, headers });
    }
    const project = projects?.projects[0];
    if (!project) {
      return NextResponse.json({ error: "没有找到 Deepgram 项目，请先在 Deepgram 控制台创建项目。" }, { status: 502, headers });
    }
    const { result, error } = await deepgram.manage.createProjectKey(project.project_id, {
      comment: "Interview transcription session", scopes: ["usage:write"], tags: ["next.js"], time_to_live_in_seconds: 60,
    });
    if (error || !result?.key) {
      return NextResponse.json({ error: "无法创建 Deepgram 临时密钥，请检查主 Key 是否有创建项目密钥的权限。" }, { status: 502, headers });
    }
    return NextResponse.json({ key: result.key }, { headers });
  } catch {
    return NextResponse.json({ error: "无法连接 Deepgram，请检查网络后重试。" }, { status: 502, headers });
  }
}
