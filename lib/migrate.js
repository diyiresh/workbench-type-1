"use strict";

const { nowIso, id } = require("./default-store");
const { ensureLifeSystem } = require("./life-learning");
const { ensureBriefHub } = require("./brief-hub");
const { ensureDepartmentSystem } = require("./department");
const { ensureCollaboration } = require("./collaboration");
const { migrateArchive } = require("./archive");

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftCalendarDate(dateText, days) {
  const d = new Date(`${dateText}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function currentWeekPlan(today) {
  const date = new Date(`${today}T12:00:00Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const start = shiftCalendarDate(today, -mondayOffset);
  const end = shiftCalendarDate(start, 6);
  const items = [
    ["看三份简报", "把指挥舱模块排成你真正要盯的顺序", "给一个 Agent 下达一条指令"],
    ["公文或调研择一线推进", "英语 20 分钟"],
    ["推进一个在办项目并打卡进度"],
    ["检查本周风险和阻塞"],
    ["每日复盘 + 生成周报初稿"],
    ["学习战线补一条笔记"],
    ["回顾本周决定，安排下周第一步"],
  ];
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return {
    id: `plan-week-${start}`,
    title: `本周安排（${start.slice(5).replace("-", "/")}–${end.slice(5).replace("-", "/")}）`,
    period: "week", start, end,
    focus: "把工作台当成指挥台用起来：先看简报，再看风险和下一步。",
    slots: items.map((slot, index) => ({ day: weekdays[index], date: shiftCalendarDate(start, index), items: slot })),
    updatedAt: nowIso(),
  };
}

function defaultModules() {
  return [
    { id: "mod-schedule", type: "schedule", title: "今日行程", order: 10, importance: 5 },
    { id: "mod-crew", type: "crew", title: "舰队动态", order: 20, importance: 5 },
    { id: "mod-bench", type: "project", title: "统筹工作台", order: 30, importance: 5, taskId: "t-bench-v1" },
    { id: "mod-spinach", type: "project", title: "奔腾带菠菜", order: 40, importance: 4, taskId: "t-spinach-p2" },
    { id: "mod-dji", type: "project", title: "大疆有礼", order: 50, importance: 4, taskId: "t-dji-gift" },
    { id: "mod-gov", type: "project", title: "公文规范事业部", order: 60, importance: 3, taskId: "t-gov-pipeline" },
    { id: "mod-learn", type: "learn", title: "学习战线", order: 70, importance: 3 },
    { id: "mod-life", type: "life", title: "生活战线", order: 80, importance: 2 },
    { id: "mod-ops", type: "ops", title: "经营报告", order: 90, importance: 3 },
  ];
}

function defaultFronts() {
  const created = nowIso();
  return {
    learn: [
      { id: "ln-ai", title: "学习 AI / 对照 Kiro Crew", progress: 55, note: "已从「单轮写码」改到「长期执行」心智；工作台要变成秘书而不是看板。", updatedAt: created },
      { id: "ln-en", title: "英语（绑在真实工作材料上）", progress: 20, note: "每天 20 分钟：读一段、写三句进展。", updatedAt: created },
    ],
    life: [
      { id: "lf-rhythm", title: "作息与开机仪式", progress: 40, note: "打开工作台 = 先看三份简报，再进指挥舱。不把生活细节写进红区。", updatedAt: created },
      { id: "lf-health", title: "健康占位", progress: 0, note: "由你补一条可执行的下一小步。", updatedAt: created },
    ],
  };
}

function ensureV2(store) {
  if (!store.meta) store.meta = {};
  const prev = store.meta.version || "";
  store.meta.version = "0.2.0";
  store.meta.title = store.meta.title || "统筹工作台";
  store.meta.role = "董事长";
  store.meta.secretary = "私人秘书 · 本机";
  store.meta.motto = "把控全局，计划未来。";
  if (!store.briefingRecipes) {
    store.briefingRecipes = [
      { id: "ops", title: "经营简报", generator: "ops", enabled: true },
      { id: "crew", title: "舰队简报", generator: "crew", enabled: true },
      { id: "fronts", title: "工作 / 学习 / 生活", generator: "fronts", enabled: true },
    ];
  }
  if (!Array.isArray(store.modules) || !store.modules.length) store.modules = defaultModules();
  if (!Array.isArray(store.inbox)) store.inbox = [];
  if (!store.fronts) store.fronts = defaultFronts();
  if (!store.meta.briefingDismissedOn) store.meta.briefingDismissedOn = "";
  const today = ymd();
  store.plans = Array.isArray(store.plans) ? store.plans : [];
  const current = store.plans.find((item) => item.start <= today && today <= item.end);
  if (!current) {
    // 只清理本迁移曾生成的旧默认周计划；用户自建计划原样保留。
    store.plans = store.plans.filter((item) => item.archived || (!String(item.id || "").startsWith("plan-w38") && !String(item.id || "").startsWith("plan-week-")));
    store.plans.unshift(currentWeekPlan(today));
  }
  for (const a of store.agents || []) {
    if (!a.lastSync) a.lastSync = a.updatedAt || store.meta.updatedAt || nowIso();
    if (a.unread == null) a.unread = 0;
  }
  ensureV3(store);
  if (prev && prev !== store.meta.version) {
    store.events = store.events || [];
    store.events.unshift({
      id: id("ev"),
      type: "session",
      text: `工作台升级为 v${store.meta.version}：指令生命周期、全员通告、责任路由、催报黄灯、决策台、任务拆解、知识资产、文件报送通道、模型路由。`,
      agentId: "workbuddy",
      createdAt: nowIso(),
    });
  }
  return store;
}

// v0.3：指令系统升级 + 模块责任制。全部为补默认值，不破坏既有数据。
// v0.3.1：决策台/任务拆解/知识资产/文件报送/模型路由。
function ensureV3(store) {
  store.meta.version = "0.3.1";
  const tasks = store.tasks || [];
  for (const m of store.modules || []) {
    if (m.type === "project" && !m.ownerAgentId) {
      const t = m.taskId ? tasks.find((x) => x.id === m.taskId) : null;
      if (t && t.ownerAgentId) m.ownerAgentId = t.ownerAgentId;
    }
  }
  for (const msg of store.inbox || []) {
    if (!msg.status) msg.status = "queued";
    if (!msg.from) msg.from = "chairman";
  }
  if (!store.remote) store.remote = { slack: { enabled: false }, telegram: { enabled: false }, outbox: [] };
  if (!store.remote.llm) {
    store.remote.llm = {
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5:7b",
      apiKey: "",
      enabled: false,
    };
  }
  if (!Array.isArray(store.prompts)) store.prompts = [];
  ensureV4(store);
  return store;
}

// v0.4：主题系统 + 每日行程。日程单独入台账，避免从浏览器 localStorage
// 或第三方同步服务复制出第二套数据源。
function ensureV4(store) {
  store.meta.version = "0.4.0";
  if (!store.meta.theme) store.meta.theme = "violet";
  if (!Array.isArray(store.agendas)) store.agendas = [];
  ensureV5(store);
  return store;
}

// v0.5：每日行程多视图、材料路径、重点事项半日前提醒与日程报告。
function ensureV5(store) {
  store.meta.version = "0.5.0";
  store.remote = store.remote || {};
  if (!store.remote.reminder) {
    store.remote.reminder = { provider: "pushplus", token: "", enabled: false, importedFrom: "", migratedAt: "" };
  }
  for (const agenda of store.agendas || []) {
    if (!Array.isArray(agenda.materials)) {
      const legacy = agenda.materialPath ? [agenda.materialPath] : [];
      agenda.materials = legacy.map((item) => ({ path: String(item) }));
    }
  }
  ensureV6(store);
  return store;
}

// v0.6：生活 / 学习双星系。繁星继续引用 agendas，银河才有独立执行记录。
function ensureV6(store) {
  store.meta.version = "0.6.0";
  ensureLifeSystem(store, ymd(), nowIso());
  ensureV7(store);
  return store;
}

// v0.7：跨 Agent 简报中心。外部 Agent 继续各自调度，工作台只做统一收件与阅读。
function ensureV7(store) {
  store.meta.version = "0.7.0";
  ensureBriefHub(store);
  if (!(store.briefingRecipes || []).some((item) => item.id === "agents")) {
    store.briefingRecipes.push({ id: "agents", title: "跨 Agent 简报", generator: "agents", enabled: true });
  }
  store.specs = store.specs || [];
  if (!store.specs.some((item) => item.id === "spec-workbench-v07-brief-hub")) {
    store.specs.unshift({
      id: "spec-workbench-v07-brief-hub",
      title: "本机统筹工作台 v0.7 跨 Agent 简报中心",
      checklist: [
        { id: "b71", text: "四个默认来源进入同一台账", done: true },
        { id: "b72", text: "HTTP 与 dropbox 两种投递方式", done: true },
        { id: "b73", text: "外部运行 ID 与内容指纹去重", done: true },
        { id: "b74", text: "按来源查看、迟到状态与已读管理", done: true },
        { id: "b75", text: "开屏显示跨 Agent 最新摘录", done: true },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }
  ensureV8(store);
  ensureV9(store);
  return store;
}

// v0.8：虚拟部门。目标只录入一次，按主管、执行、独立复核、整合四阶段推进。
function ensureV8(store) {
  store.meta.version = "0.8.0";
  ensureDepartmentSystem(store);
  store.specs = store.specs || [];
  if (!store.specs.some((item) => item.id === "spec-workbench-v08-virtual-department")) {
    store.specs.unshift({
      id: "spec-workbench-v08-virtual-department",
      title: "本机统筹工作台 v0.8 虚拟部门",
      checklist: [
        { id: "d81", text: "一个目标形成四岗位工作链", done: true },
        { id: "d82", text: "前置依赖与独立复核状态机", done: true },
        { id: "d83", text: "模型执行、人工回填与返工闭环", done: true },
        { id: "d84", text: "目标草稿跨页面本地保留", done: true },
        { id: "d85", text: "沿用现有三套主题与视觉组件", done: true },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }
  return store;
}

// v0.9：项目群聊与成果对象。保留 v0.8 既有部门数据，新增统一协作台账。
function ensureV9(store) {
  ensureCollaboration(store);
  store.meta.version = "0.10.0";
  migrateArchive(store);
  store.specs = store.specs || [];
  if (!store.specs.some((item) => item.id === "spec-workbench-v09-collaboration")) {
    store.specs.unshift({
      id: "spec-workbench-v09-collaboration",
      title: "本机统筹工作台 v0.9 项目协作台账",
      checklist: [
        { id: "c91", text: "项目消息与任务、阶段关联", done: true },
        { id: "c92", text: "成果对象、版本与复核状态", done: true },
        { id: "c93", text: "人工/外部 Agent 统一回写入口", done: true },
        { id: "c94", text: "项目房间短轮询展示", done: true },
      ],
      createdAt: nowIso(), updatedAt: nowIso(),
    });
  }
  return store;
}

module.exports = { ensureV2, ymd, defaultModules };
