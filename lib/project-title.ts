const MAX_TITLE_LENGTH = 36;

const UNRELIABLE_TOPIC_KEYS = new Set([
  "你好",
  "您好",
  "嗨",
  "哈喽",
  "谢谢",
  "感谢",
  "好的",
  "可以",
  "继续",
  "开始",
  "新对话",
  "对话",
  "聊天",
  "项目",
  "应用",
  "功能",
  "页面",
  "问题",
  "需求",
  "hi",
  "hello",
  "hey",
  "thanks",
  "thankyou",
  "ok",
  "okay",
  "continue",
  "start",
  "chat",
  "conversation",
  "project",
  "app",
  "application",
  "feature",
  "page",
  "question",
]);

function titleKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function cleanTitle(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[。！？!?.,，；;：:]+$/u, "")
    .trim();
}

function reliableTitle(value: string): string | null {
  const title = cleanTitle(value);
  const key = titleKey(title);
  if (
    title.length < 2 ||
    title.length > MAX_TITLE_LENGTH ||
    /^(?:这是|这个是|这里是|this is(?:\s|$)|there is(?:\s|$))/iu.test(title) ||
    !key ||
    UNRELIABLE_TOPIC_KEYS.has(key)
  ) {
    return null;
  }
  return title;
}

function trimChineseDetails(value: string): string {
  const [topic] = value.split(/[，,。；;\n]/u, 1);
  return topic.trim();
}

function trimEnglishDetails(value: string): string {
  return value
    .split(/\s+(?:with|that|which|including|supporting|using|so that)\s+/i, 1)[0]
    .trim();
}

/**
 * Creates a short, deterministic project title from the user's first input.
 * This helper is intentionally client-safe: it has no runtime, filesystem, or
 * network dependencies. It only returns the input when it is already a short,
 * topic-like phrase; ambiguous or sentence-like input falls back explicitly.
 */
export function summarizeInitialProjectTitle(
  input: string,
  fallback: string,
): string {
  const fallbackTitle = cleanTitle(fallback) || "新项目";
  const source = cleanTitle(typeof input === "string" ? input : "");
  if (!source) return fallbackTitle;

  let summary = source;
  let transformed = false;
  const preparingMatch = summary.match(
    /^我(?:最近|现在)?(?:正在|在)?准备(.{2,32})$/u,
  );
  if (preparingMatch) {
    summary = `${preparingMatch[1]}准备`;
    transformed = true;
  } else if (/[\u3400-\u9fff]/u.test(summary)) {
    const chinesePrefixes = [
      /^(?:请问|想请教(?:一下)?|我想(?:请教|了解|知道|咨询)(?:一下)?|我(?:想|需要|希望)(?:要)?|能不能|能否|可以(?:帮我)?|请(?:你)?|麻烦(?:你)?|帮我|帮忙|给我)[\s，,:：]*/u,
      /^(?:如何|怎么|怎样|为什么|是否|应该如何|该如何)[\s，,:：]*/u,
      /^(?:分析|整理|总结|规划|制定|设计|实现|创建|构造|构建|搭建|开发|生成|写|介绍|解释|讲解|讲讲|聊聊|讨论|优化|排查|修复|评估|看看|做)(?:一下|下)?(?:一个可运行的|一个|一份|个|款|这个|关于)?[\s，,:：]*/u,
      /^(?:一个|一份|个|这个|关于)[\s，,:：]*/u,
    ];
    for (let pass = 0; pass < 4; pass += 1) {
      const before = summary;
      for (const prefix of chinesePrefixes) summary = summary.replace(prefix, "");
      if (summary === before) break;
      transformed = true;
    }
    const withoutQuestionEnding = summary.replace(
      /(?:可以吗|行吗|好吗|怎么办|怎么做|是什么|有哪些|吗|呢|吧)$/u,
      "",
    );
    if (withoutQuestionEnding !== summary) transformed = true;
    summary = trimChineseDetails(withoutQuestionEnding);
    if (summary !== withoutQuestionEnding) transformed = true;
  } else {
    const englishPrefixes = [
      /^(?:please|could you|can you|would you|will you|help me(?: to)?|i (?:want|need|would like) to|how (?:do i|can i|to)|what is|tell me about)\s+/i,
      /^(?:analyze|summarize|plan|design|create|build|make|develop|write|explain|discuss|review|fix)\s+/i,
      /^(?:a|an|the)\s+/i,
    ];
    for (let pass = 0; pass < 4; pass += 1) {
      const before = summary;
      for (const prefix of englishPrefixes) summary = summary.replace(prefix, "");
      if (summary === before) break;
      transformed = true;
    }
    const withoutDetails = trimEnglishDetails(summary);
    if (withoutDetails !== summary) transformed = true;
    summary = withoutDetails;
    if (/^[a-z]/.test(summary)) {
      summary = `${summary[0].toUpperCase()}${summary.slice(1)}`;
    }
  }

  const title = reliableTitle(summary);
  if (!title) return fallbackTitle;

  // A short noun phrase is already a usable summary. Longer unchanged input is
  // treated as prose so the UI never presents a truncated copy as a title.
  if (!transformed && source.length > 18) return fallbackTitle;
  return title;
}
