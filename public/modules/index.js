// 模块注册表：加一种模块类型 = 在这里 import 一份清单，主框架零改动。
// 每份清单自带 card / detail，渲染失败由 safe() 隔离为单卡错误，不塌整页。
import { safe } from "../js/core.js";

import schedule from "./schedule.js";
import crew from "./crew.js";
import project from "./project.js";
import learn from "./learn.js";
import life from "./life.js";
import ops from "./ops.js";

export const REGISTRY = { schedule, crew, project, learn, life, ops };

export function manifestFor(m) {
  return REGISTRY[m.type] || REGISTRY.project;
}

export function renderCard(m) {
  const mf = manifestFor(m);
  return safe(() => mf.card(m), `模块「${m.title}」`);
}

export function renderDetail(m) {
  const mf = manifestFor(m);
  return safe(() => (mf.detail ? mf.detail(m) : ""), `模块「${m.title}」详情`);
}
