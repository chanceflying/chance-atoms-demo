import type { AppRecord, AppSpec, AppValue, FieldSpec, FieldType } from "./domain";
import { parseAppSpec } from "./validation";

type Locale = "en" | "zh";

const themes = {
  indigo: { accent: "#635bff", background: "#f5f7fb" },
  blue: { accent: "#2563eb", background: "#f5f8fc" },
  green: { accent: "#168764", background: "#f3f8f5" },
  amber: { accent: "#c66a16", background: "#fbf7f1" },
  dark: { accent: "#8b7cff", background: "#111827" },
} as const;

function field(
  id: string,
  label: string,
  type: FieldType,
  required = false,
  placeholder = "",
  options: string[] = [],
): FieldSpec {
  return { id, label, type, required, placeholder, options };
}

function record(
  id: string,
  values: Array<[fieldId: string, value: AppValue]>,
): AppRecord {
  return { id, values: values.map(([fieldId, value]) => ({ fieldId, value })) };
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function localeFor(text: string): Locale {
  return /[\u3400-\u9fff]/.test(text) ? "zh" : "en";
}

function bugTracker(locale: Locale): AppSpec {
  const zh = locale === "zh";
  return {
    schemaVersion: 1,
    title: zh ? "缺陷追踪器" : "Bug Tracker",
    description: zh
      ? "集中记录、分派并推动产品缺陷从发现走向解决。"
      : "Capture, assign, and move product issues from report to resolution.",
    entityName: zh ? "缺陷" : "issue",
    entityNamePlural: zh ? "缺陷" : "issues",
    layout: "table",
    theme: { ...themes.indigo },
    fields: [
      field("title", zh ? "标题" : "Title", "text", true, zh ? "简要描述问题" : "Summarize the issue"),
      field(
        "status",
        zh ? "状态" : "Status",
        "select",
        true,
        "",
        zh ? ["待处理", "处理中", "已解决"] : ["Open", "In progress", "Resolved"],
      ),
      field(
        "priority",
        zh ? "优先级" : "Priority",
        "select",
        true,
        "",
        zh ? ["高", "中", "低"] : ["High", "Medium", "Low"],
      ),
      field("assignee", zh ? "负责人" : "Assignee", "text", false, zh ? "负责人姓名" : "Owner name"),
      field("createdAt", zh ? "创建日期" : "Created", "date", true),
      field("description", zh ? "问题描述" : "Description", "textarea", false, zh ? "复现步骤与预期结果" : "Steps to reproduce and expected result"),
    ],
    features: { search: true, stats: true, filterField: "status" },
    seedData: zh
      ? [
          record("bug-001", [["title", "结算页优惠券失效"], ["status", "处理中"], ["priority", "高"], ["assignee", "林夏"], ["createdAt", "2026-07-28"], ["description", "选择优惠券后总价没有更新。"]]),
          record("bug-002", [["title", "移动端筛选器遮挡按钮"], ["status", "待处理"], ["priority", "中"], ["assignee", "周屿"], ["createdAt", "2026-07-30"], ["description", "窄屏下筛选面板高度超出视口。"]]),
          record("bug-003", [["title", "导出文件名乱码"], ["status", "已解决"], ["priority", "低"], ["assignee", "陈晓"], ["createdAt", "2026-07-24"], ["description", "中文项目名导出时未正确编码。"]]),
        ]
      : [
          record("bug-001", [["title", "Coupon total does not refresh"], ["status", "In progress"], ["priority", "High"], ["assignee", "Maya"], ["createdAt", "2026-07-28"], ["description", "The checkout total stays unchanged after applying a coupon."]]),
          record("bug-002", [["title", "Mobile filters cover actions"], ["status", "Open"], ["priority", "Medium"], ["assignee", "Noah"], ["createdAt", "2026-07-30"], ["description", "The filter drawer exceeds the viewport on narrow screens."]]),
          record("bug-003", [["title", "Export filename is garbled"], ["status", "Resolved"], ["priority", "Low"], ["assignee", "Ari"], ["createdAt", "2026-07-24"], ["description", "Unicode project names were not encoded correctly."]]),
        ],
    acceptanceCriteria: zh
      ? ["可以新增、编辑和删除缺陷", "可以搜索标题、负责人和描述", "可以按状态筛选并查看统计", "刷新后由宿主应用恢复数据"]
      : ["Create, edit, and delete issues", "Search title, assignee, and description", "Filter by status and see live counts", "Restore data through the host after refresh"],
  };
}

function leadCrm(locale: Locale): AppSpec {
  const zh = locale === "zh";
  const stages = zh ? ["新线索", "已联系", "方案中", "已赢单"] : ["New", "Contacted", "Proposal", "Won"];
  return {
    schemaVersion: 1,
    title: zh ? "销售线索中心" : "Lead Pipeline",
    description: zh ? "跟进客户联系人、商机阶段和下一步行动。" : "Keep contacts, deal stages, and next actions in one focused pipeline.",
    entityName: zh ? "线索" : "lead",
    entityNamePlural: zh ? "线索" : "leads",
    layout: "cards",
    theme: { ...themes.blue },
    fields: [
      field("company", zh ? "公司" : "Company", "text", true, zh ? "客户公司" : "Account name"),
      field("contact", zh ? "联系人" : "Contact", "text", true, zh ? "联系人姓名" : "Primary contact"),
      field("email", zh ? "邮箱" : "Email", "text", false, "name@example.com"),
      field("stage", zh ? "阶段" : "Stage", "select", true, "", stages),
      field("dealValue", zh ? "预计金额" : "Deal value", "number", false, zh ? "预计合同金额" : "Expected value"),
      field("nextFollowUp", zh ? "下次跟进" : "Next follow-up", "date", false),
      field("notes", zh ? "备注" : "Notes", "textarea", false, zh ? "背景与下一步" : "Context and next step"),
    ],
    features: { search: true, stats: true, filterField: "stage" },
    seedData: zh
      ? [
          record("lead-001", [["company", "澄海科技"], ["contact", "许然"], ["email", "ran@example.com"], ["stage", "方案中"], ["dealValue", 88000], ["nextFollowUp", "2026-08-03"], ["notes", "确认安全评审时间。"]]),
          record("lead-002", [["company", "北辰设计"], ["contact", "孟遥"], ["email", "yao@example.com"], ["stage", "已联系"], ["dealValue", 32000], ["nextFollowUp", "2026-08-01"], ["notes", "发送零售行业案例。"]]),
        ]
      : [
          record("lead-001", [["company", "Northstar Labs"], ["contact", "Mina Park"], ["email", "mina@example.com"], ["stage", "Proposal"], ["dealValue", 18000], ["nextFollowUp", "2026-08-03"], ["notes", "Confirm security review timing."]]),
          record("lead-002", [["company", "Canvas & Co."], ["contact", "Sam Reed"], ["email", "sam@example.com"], ["stage", "Contacted"], ["dealValue", 7500], ["nextFollowUp", "2026-08-01"], ["notes", "Share the retail case study."]]),
        ],
    acceptanceCriteria: zh
      ? ["可以维护线索完整信息", "可以搜索公司与联系人", "可以按阶段筛选", "金额和线索数量会实时统计"]
      : ["Maintain complete lead details", "Search companies and contacts", "Filter the pipeline by stage", "Update lead and value counts live"],
  };
}

function habitTracker(locale: Locale): AppSpec {
  const zh = locale === "zh";
  return {
    schemaVersion: 1,
    title: zh ? "习惯打卡" : "Habit Garden",
    description: zh ? "用轻量的打卡记录培养稳定、可持续的习惯。" : "Build steady routines with a lightweight habit check-in board.",
    entityName: zh ? "习惯" : "habit",
    entityNamePlural: zh ? "习惯" : "habits",
    layout: "cards",
    theme: { ...themes.green },
    fields: [
      field("habit", zh ? "习惯" : "Habit", "text", true, zh ? "想坚持的事情" : "What do you want to practice?"),
      field("category", zh ? "分类" : "Category", "select", true, "", zh ? ["健康", "学习", "生活"] : ["Health", "Learning", "Wellbeing"]),
      field("frequency", zh ? "频率" : "Frequency", "select", true, "", zh ? ["每天", "工作日", "每周"] : ["Daily", "Weekdays", "Weekly"]),
      field("streak", zh ? "连续天数" : "Streak", "number", false, zh ? "连续完成天数" : "Consecutive days"),
      field("completed", zh ? "今天已完成" : "Done today", "checkbox", false),
      field("notes", zh ? "提示" : "Cue", "textarea", false, zh ? "如何让它更容易开始？" : "How will you make it easy to start?"),
    ],
    features: { search: true, stats: true, filterField: "category" },
    seedData: zh
      ? [
          record("habit-001", [["habit", "晨间拉伸 10 分钟"], ["category", "健康"], ["frequency", "每天"], ["streak", 12], ["completed", true], ["notes", "瑜伽垫前一晚放到床边。"]]),
          record("habit-002", [["habit", "阅读 20 页"], ["category", "学习"], ["frequency", "每天"], ["streak", 5], ["completed", false], ["notes", "午饭后先读一章。"]]),
        ]
      : [
          record("habit-001", [["habit", "10-minute morning stretch"], ["category", "Health"], ["frequency", "Daily"], ["streak", 12], ["completed", true], ["notes", "Leave the mat beside the bed."]]),
          record("habit-002", [["habit", "Read 20 pages"], ["category", "Learning"], ["frequency", "Daily"], ["streak", 5], ["completed", false], ["notes", "Start one chapter after lunch."]]),
        ],
    acceptanceCriteria: zh
      ? ["可以新增和管理习惯", "可以按分类筛选", "可以标记今日完成状态", "统计会随打卡实时变化"]
      : ["Add and manage habits", "Filter habits by category", "Mark today's completion", "Reflect check-ins in live stats"],
  };
}

function taskTracker(locale: Locale): AppSpec {
  const zh = locale === "zh";
  return {
    schemaVersion: 1,
    title: zh ? "团队任务看板" : "Task Board",
    description: zh ? "快速管理任务状态、优先级、负责人和截止时间。" : "Track ownership, priority, status, and due dates without the clutter.",
    entityName: zh ? "任务" : "task",
    entityNamePlural: zh ? "任务" : "tasks",
    layout: "table",
    theme: { ...themes.indigo },
    fields: [
      field("task", zh ? "任务" : "Task", "text", true, zh ? "需要完成什么？" : "What needs to be done?"),
      field("status", zh ? "状态" : "Status", "select", true, "", zh ? ["待开始", "进行中", "已完成"] : ["To do", "Doing", "Done"]),
      field("priority", zh ? "优先级" : "Priority", "select", true, "", zh ? ["高", "中", "低"] : ["High", "Medium", "Low"]),
      field("owner", zh ? "负责人" : "Owner", "text", false, zh ? "负责人姓名" : "Owner name"),
      field("dueDate", zh ? "截止日期" : "Due date", "date", false),
      field("done", zh ? "已完成" : "Complete", "checkbox", false),
    ],
    features: { search: true, stats: true, filterField: "status" },
    seedData: zh
      ? [
          record("task-001", [["task", "完成用户访谈总结"], ["status", "进行中"], ["priority", "高"], ["owner", "乔木"], ["dueDate", "2026-08-02"], ["done", false]]),
          record("task-002", [["task", "更新上线检查清单"], ["status", "待开始"], ["priority", "中"], ["owner", "安然"], ["dueDate", "2026-08-05"], ["done", false]]),
        ]
      : [
          record("task-001", [["task", "Summarize customer interviews"], ["status", "Doing"], ["priority", "High"], ["owner", "Jamie"], ["dueDate", "2026-08-02"], ["done", false]]),
          record("task-002", [["task", "Refresh launch checklist"], ["status", "To do"], ["priority", "Medium"], ["owner", "Robin"], ["dueDate", "2026-08-05"], ["done", false]]),
        ],
    acceptanceCriteria: zh
      ? ["可以新增、编辑和删除任务", "可以按状态筛选", "可以搜索任务与负责人", "完成情况会实时统计"]
      : ["Create, edit, and delete tasks", "Filter tasks by status", "Search tasks and owners", "Update completion statistics live"],
  };
}

function expenseTracker(locale: Locale): AppSpec {
  const zh = locale === "zh";
  return {
    schemaVersion: 1,
    title: zh ? "费用记录" : "Expense Ledger",
    description: zh ? "清晰记录日常支出、分类和报销状态。" : "Log spending, categories, payment methods, and reimbursements clearly.",
    entityName: zh ? "费用" : "expense",
    entityNamePlural: zh ? "费用" : "expenses",
    layout: "table",
    theme: { ...themes.amber },
    fields: [
      field("description", zh ? "费用说明" : "Description", "text", true, zh ? "这笔钱花在了哪里？" : "What was this for?"),
      field("category", zh ? "分类" : "Category", "select", true, "", zh ? ["餐饮", "交通", "办公", "差旅", "其他"] : ["Meals", "Transport", "Office", "Travel", "Other"]),
      field("amount", zh ? "金额" : "Amount", "number", true, zh ? "金额" : "Amount"),
      field("spentOn", zh ? "日期" : "Date", "date", true),
      field("paymentMethod", zh ? "支付方式" : "Payment", "select", false, "", zh ? ["公司卡", "个人垫付", "现金"] : ["Company card", "Personal card", "Cash"]),
      field("reimbursed", zh ? "已报销" : "Reimbursed", "checkbox", false),
      field("notes", zh ? "备注" : "Notes", "textarea", false),
    ],
    features: { search: true, stats: true, filterField: "category" },
    seedData: zh
      ? [
          record("expense-001", [["description", "客户午餐"], ["category", "餐饮"], ["amount", 268], ["spentOn", "2026-07-29"], ["paymentMethod", "个人垫付"], ["reimbursed", false], ["notes", "三人商务午餐。"]]),
          record("expense-002", [["description", "机场快线"], ["category", "交通"], ["amount", 50], ["spentOn", "2026-07-27"], ["paymentMethod", "公司卡"], ["reimbursed", true], ["notes", "出差往返。"]]),
        ]
      : [
          record("expense-001", [["description", "Customer lunch"], ["category", "Meals"], ["amount", 86], ["spentOn", "2026-07-29"], ["paymentMethod", "Personal card"], ["reimbursed", false], ["notes", "Lunch for three attendees."]]),
          record("expense-002", [["description", "Airport train"], ["category", "Transport"], ["amount", 24], ["spentOn", "2026-07-27"], ["paymentMethod", "Company card"], ["reimbursed", true], ["notes", "Return business trip."]]),
        ],
    acceptanceCriteria: zh
      ? ["可以新增、编辑和删除费用", "可以搜索说明与备注", "可以按分类筛选", "金额与报销状态会实时统计"]
      : ["Create, edit, and delete expenses", "Search descriptions and notes", "Filter by category", "Update amount and reimbursement stats live"],
  };
}

function contentPlanner(locale: Locale): AppSpec {
  const zh = locale === "zh";
  const status = zh ? ["待选题", "制作中", "待审核", "已发布"] : ["Idea", "In production", "Review", "Published"];
  return {
    schemaVersion: 1,
    title: zh ? "内容发布日历" : "Content Calendar",
    description: zh ? "集中管理选题、渠道、负责人和发布时间。" : "Plan topics, channels, owners, and publishing dates in one place.",
    entityName: zh ? "内容" : "content item",
    entityNamePlural: zh ? "内容" : "content items",
    layout: "table",
    theme: { ...themes.blue },
    fields: [
      field("topic", zh ? "选题" : "Topic", "text", true, zh ? "内容主题" : "Content topic"),
      field("channel", zh ? "发布渠道" : "Channel", "select", true, "", zh ? ["公众号", "视频号", "小红书", "官网"] : ["Blog", "LinkedIn", "YouTube", "Newsletter"]),
      field("owner", zh ? "负责人" : "Owner", "text", false, zh ? "负责人姓名" : "Owner name"),
      field("publishDate", zh ? "计划日期" : "Publish date", "date", true),
      field("status", zh ? "制作状态" : "Status", "select", true, "", status),
      field("notes", zh ? "备注" : "Notes", "textarea", false),
    ],
    features: { search: true, stats: true, filterField: "status" },
    seedData: zh
      ? [
          record("content-001", [["topic", "秋季新品幕后故事"], ["channel", "公众号"], ["owner", "林夏"], ["publishDate", "2026-08-06"], ["status", "制作中"], ["notes", "等待摄影素材。"]]),
          record("content-002", [["topic", "客户案例一分钟短片"], ["channel", "视频号"], ["owner", "周屿"], ["publishDate", "2026-08-10"], ["status", "待审核"], ["notes", "法务审核字幕。"]]),
          record("content-003", [["topic", "产品更新月报"], ["channel", "官网"], ["owner", "陈晓"], ["publishDate", "2026-08-14"], ["status", "待选题"], ["notes", "汇总本月上线项。"]]),
        ]
      : [
          record("content-001", [["topic", "Fall launch behind the scenes"], ["channel", "Blog"], ["owner", "Maya"], ["publishDate", "2026-08-06"], ["status", "In production"], ["notes", "Waiting on photography."]]),
          record("content-002", [["topic", "Customer story short"], ["channel", "YouTube"], ["owner", "Noah"], ["publishDate", "2026-08-10"], ["status", "Review"], ["notes", "Review captions."]]),
        ],
    acceptanceCriteria: zh
      ? ["可以新增、编辑和删除内容计划", "可以搜索选题和负责人", "可以按制作状态筛选", "可以查看内容数量统计"]
      : ["Create, edit, and delete content plans", "Search topics and owners", "Filter by production status", "See live content counts"],
  };
}

function inspectionTracker(locale: Locale): AppSpec {
  const zh = locale === "zh";
  const statuses = zh ? ["待处理", "处理中", "已关闭"] : ["Open", "In progress", "Closed"];
  return {
    schemaVersion: 1,
    title: zh ? "设备巡检台" : "Equipment Inspections",
    description: zh ? "登记巡检结果、风险等级与处理进度，减少遗漏。" : "Log inspections, risk levels, and resolution progress without gaps.",
    entityName: zh ? "巡检记录" : "inspection",
    entityNamePlural: zh ? "巡检记录" : "inspections",
    layout: "cards",
    theme: { ...themes.amber },
    fields: [
      field("device", zh ? "设备名称" : "Equipment", "text", true, zh ? "设备或资产名称" : "Equipment name"),
      field("area", zh ? "区域" : "Area", "text", true),
      field("inspector", zh ? "巡检人" : "Inspector", "text", true),
      field("inspectionDate", zh ? "巡检日期" : "Inspection date", "date", true),
      field("riskLevel", zh ? "风险等级" : "Risk", "select", true, "", zh ? ["低", "中", "高"] : ["Low", "Medium", "High"]),
      field("status", zh ? "处理状态" : "Status", "select", true, "", statuses),
      field("notes", zh ? "备注" : "Notes", "textarea", false),
    ],
    features: { search: true, stats: true, filterField: "status" },
    seedData: zh
      ? [
          record("inspection-001", [["device", "空压机 A-03"], ["area", "一号车间"], ["inspector", "王宁"], ["inspectionDate", "2026-07-30"], ["riskLevel", "中"], ["status", "处理中"], ["notes", "压力表波动，已提交检修。"]]),
          record("inspection-002", [["device", "消防泵 F-02"], ["area", "地下机房"], ["inspector", "赵青"], ["inspectionDate", "2026-07-29"], ["riskLevel", "低"], ["status", "已关闭"], ["notes", "运行正常，已完成例行保养。"]]),
        ]
      : [
          record("inspection-001", [["device", "Compressor A-03"], ["area", "Plant 1"], ["inspector", "Alex"], ["inspectionDate", "2026-07-30"], ["riskLevel", "Medium"], ["status", "In progress"], ["notes", "Pressure gauge fluctuates; repair requested."]]),
          record("inspection-002", [["device", "Fire pump F-02"], ["area", "Basement"], ["inspector", "Robin"], ["inspectionDate", "2026-07-29"], ["riskLevel", "Low"], ["status", "Closed"], ["notes", "Routine service completed."]]),
        ],
    acceptanceCriteria: zh
      ? ["可以新增、编辑和删除巡检记录", "可以搜索设备、区域和巡检人", "可以按处理状态筛选", "可以查看风险与记录统计"]
      : ["Create, edit, and delete inspections", "Search equipment, areas, and inspectors", "Filter by resolution status", "See live risk and record counts"],
  };
}

function genericTracker(locale: Locale): AppSpec {
  const zh = locale === "zh";
  return {
    schemaVersion: 1,
    title: zh ? "智能记录台" : "Smart Tracker",
    description: zh ? "一个可搜索、可筛选并支持完整增删改的轻量记录工具。" : "A flexible, searchable collection with full create, edit, and delete actions.",
    entityName: zh ? "记录" : "record",
    entityNamePlural: zh ? "记录" : "records",
    layout: "cards",
    theme: { ...themes.blue },
    fields: [
      field("name", zh ? "名称" : "Name", "text", true, zh ? "记录名称" : "Record name"),
      field("status", zh ? "状态" : "Status", "select", true, "", zh ? ["待处理", "进行中", "已完成"] : ["Backlog", "Active", "Complete"]),
      field("owner", zh ? "负责人" : "Owner", "text", false),
      field("updatedOn", zh ? "更新日期" : "Updated", "date", false),
      field("notes", zh ? "备注" : "Notes", "textarea", false),
    ],
    features: { search: true, stats: true, filterField: "status" },
    seedData: zh
      ? [record("record-001", [["name", "示例记录"], ["status", "进行中"], ["owner", "项目成员"], ["updatedOn", "2026-07-31"], ["notes", "你可以编辑或删除这条记录。"]])]
      : [record("record-001", [["name", "Example record"], ["status", "Active"], ["owner", "Project member"], ["updatedOn", "2026-07-31"], ["notes", "Edit or delete this starter record."]])],
    acceptanceCriteria: zh
      ? ["可以新增、编辑和删除记录", "可以搜索所有文本字段", "可以按状态筛选", "数据变化会通知宿主应用"]
      : ["Create, edit, and delete records", "Search across text fields", "Filter by status", "Notify the host when data changes"],
  };
}

function copySpec(spec: AppSpec): AppSpec {
  return JSON.parse(JSON.stringify(spec)) as AppSpec;
}

function ensureField(spec: AppSpec, next: FieldSpec) {
  if (!spec.fields.some((candidate) => candidate.id === next.id)) spec.fields.push(next);
}

function removeField(spec: AppSpec, id: string) {
  if (spec.fields.length <= 1 || !spec.fields.some((candidate) => candidate.id === id)) return;
  spec.fields = spec.fields.filter((candidate) => candidate.id !== id);
  spec.seedData = spec.seedData.map((entry) => ({
    ...entry,
    values: entry.values.filter((value) => value.fieldId !== id),
  }));
  if (spec.features.filterField === id) {
    spec.features.filterField = spec.fields.find((candidate) => candidate.type === "select")?.id ?? null;
  }
}

function requestedTitle(text: string): string | null {
  const match = text.match(
    /(?:rename(?:\s+(?:it|app))?\s+to|call\s+(?:it\s+)?|title\s*(?:is|to|:)|命名为|叫做|改名为|名称改为)\s*["“']?([^"”'\n,，。]{2,60})/i,
  );
  return match?.[1]?.trim() ?? null;
}

function applyRequests(specInput: AppSpec, request: string, locale: Locale): AppSpec {
  const spec = copySpec(specInput);
  const normalized = request.toLowerCase();
  const zh = locale === "zh";

  const title = requestedTitle(request);
  if (title) spec.title = title.slice(0, 100);

  if (containsAny(normalized, ["dark", "night mode", "深色", "暗色", "黑色主题"])) {
    spec.theme = { ...themes.dark };
  } else if (containsAny(normalized, ["light theme", "light mode", "浅色", "亮色主题"])) {
    spec.theme.background = "#f5f7fb";
  }
  const color = request.match(/#[0-9a-fA-F]{6}\b/)?.[0];
  if (color) spec.theme.accent = color.toLowerCase();

  if (containsAny(normalized, ["card layout", "cards layout", "card view", "卡片", "看板"])) {
    spec.layout = "cards";
  }
  if (containsAny(normalized, ["table layout", "table view", "列表", "表格"])) {
    spec.layout = "table";
  }

  if (containsAny(normalized, ["due date", "deadline", "截止日期", "截止时间"])) {
    ensureField(spec, field("dueDate", zh ? "截止日期" : "Due date", "date", false));
  }
  if (containsAny(normalized, ["priority", "优先级"])) {
    ensureField(spec, field("priority", zh ? "优先级" : "Priority", "select", false, "", zh ? ["高", "中", "低"] : ["High", "Medium", "Low"]));
  }
  if (containsAny(normalized, ["assignee", "owner", "负责人", "执行人"])) {
    ensureField(spec, field("owner", zh ? "负责人" : "Owner", "text", false, zh ? "负责人姓名" : "Owner name"));
  }
  if (containsAny(normalized, ["phone", "mobile", "手机号", "手机号码", "电话号码", "联系电话"])) {
    ensureField(spec, field("phone", zh ? "联系电话" : "Phone", "text", false, zh ? "输入联系电话" : "Enter a phone number"));
  }
  if (containsAny(normalized, ["email", "e-mail", "邮箱", "电子邮件"])) {
    ensureField(spec, field("email", zh ? "邮箱" : "Email", "text", false, zh ? "输入邮箱" : "Enter an email address"));
  }
  if (containsAny(normalized, ["budget", "amount", "金额", "预算"])) {
    ensureField(spec, field("amount", zh ? "金额" : "Amount", "number", false, zh ? "输入金额" : "Enter an amount"));
  }
  if (containsAny(normalized, ["notes", "remark", "备注", "说明"])) {
    ensureField(spec, field("notes", zh ? "备注" : "Notes", "textarea", false, zh ? "补充信息" : "Add context"));
  }

  if (containsAny(normalized, ["remove due date", "without due date", "删除截止日期", "移除截止日期"])) removeField(spec, "dueDate");
  if (containsAny(normalized, ["remove priority", "without priority", "删除优先级", "移除优先级"])) removeField(spec, "priority");
  if (containsAny(normalized, ["remove owner", "without owner", "删除负责人", "移除负责人"])) {
    removeField(spec, "owner");
    removeField(spec, "assignee");
  }

  if (containsAny(normalized, ["no search", "disable search", "不要搜索", "关闭搜索"])) spec.features.search = false;
  else if (containsAny(normalized, ["search", "搜索"])) spec.features.search = true;
  if (containsAny(normalized, ["no stats", "disable stats", "不要统计", "关闭统计"])) spec.features.stats = false;
  else if (containsAny(normalized, ["stats", "statistics", "统计"])) spec.features.stats = true;

  for (const candidate of spec.fields) {
    if (
      candidate.type === "select" &&
      containsAny(normalized, [
        `filter by ${candidate.id.toLowerCase()}`,
        `filter on ${candidate.id.toLowerCase()}`,
        `按${candidate.label.toLowerCase()}筛选`,
      ])
    ) {
      spec.features.filterField = candidate.id;
    }
  }

  return parseAppSpec(spec);
}

/**
 * A deterministic, offline-safe generation fallback. It intentionally produces
 * only declarative AppSpec data; no prompt text is ever turned into JavaScript.
 */
export function deterministicAgent(
  prompt: string,
  previousSpec?: AppSpec,
  instruction?: string,
): AppSpec {
  const request = (instruction ?? prompt).trim();
  const locale = localeFor(`${prompt} ${request}`);

  if (previousSpec) return applyRequests(parseAppSpec(previousSpec), request, locale);

  const normalized = prompt.trim().toLowerCase();
  let base: AppSpec;
  if (containsAny(normalized, ["bug", "issue tracker", "defect", "缺陷", "问题追踪", "故障追踪"])) {
    base = bugTracker(locale);
  } else if (containsAny(normalized, ["lead", "crm", "sales pipeline", "customer pipeline", "销售线索", "客户线索", "客户管理", "商机"])) {
    base = leadCrm(locale);
  } else if (containsAny(normalized, ["content calendar", "editorial calendar", "publishing plan", "内容发布", "内容日历", "选题", "发布计划"])) {
    base = contentPlanner(locale);
  } else if (containsAny(normalized, ["inspection", "equipment check", "maintenance check", "巡检", "点检", "设备检查"])) {
    base = inspectionTracker(locale);
  } else if (containsAny(normalized, ["habit", "streak", "check-in", "习惯", "打卡"])) {
    base = habitTracker(locale);
  } else if (containsAny(normalized, ["expense", "spending", "reimbursement", "费用", "记账", "报销", "支出"])) {
    base = expenseTracker(locale);
  } else if (containsAny(normalized, ["task", "todo", "to-do", "任务", "待办"])) {
    base = taskTracker(locale);
  } else {
    base = genericTracker(locale);
  }

  return applyRequests(base, prompt, locale);
}
