function assessPagesStatus(commit, runs, legacyBuild) {
  const pagesRuns = runs.filter(run => run.head_sha === commit &&
    (run.path === "dynamic/pages/pages-build-deployment" || run.name === "pages build and deployment"));
  pagesRuns.sort((first, second) =>
    (Date.parse(second.updated_at || "") || 0) - (Date.parse(first.updated_at || "") || 0) || Number(second.id) - Number(first.id));
  const latest = pagesRuns[0];
  if (latest) {
    if (latest.status !== "completed") {
      return { status: "pending", source: "actions", message: latest.status === "queued" ? "GitHub Pages 正在排队发布" : "GitHub Pages 正在发布网站" };
    }
    if (latest.conclusion === "success") return { status: "complete", source: "actions" };
    return { status: "failed", source: "actions", message: `GitHub Pages 发布任务已结束，结果为 ${latest.conclusion || "unknown"}` };
  }
  if (legacyBuild?.commit === commit) {
    if (legacyBuild.status === "built") return { status: "complete", source: "legacy" };
    if (legacyBuild.status === "errored") return { status: "failed", source: "legacy", message: legacyBuild.error?.message || "GitHub Pages 构建失败" };
  }
  return { status: "pending", message: "正在等待 GitHub Pages 创建发布任务" };
}

module.exports = { assessPagesStatus };
