import assert from "node:assert/strict";
import test from "node:test";

import { summarizeInitialProjectTitle } from "../lib/project-title";

test("summarizes Chinese project requests into short topics", () => {
  assert.equal(
    summarizeInitialProjectTitle(
      "请帮我设计一个登录页面",
      "新项目",
    ),
    "登录页面",
  );
  assert.equal(
    summarizeInitialProjectTitle("我在准备面试", "新对话"),
    "面试准备",
  );
  assert.equal(
    summarizeInitialProjectTitle(
      "构建一个贪吃蛇 Web App，支持方向键控制、计分和重新开始",
      "新 Web App",
    ),
    "贪吃蛇 Web App",
  );
  assert.equal(
    summarizeInitialProjectTitle(
      "构造一个复古像素风俄罗斯方块前端应用，支持键盘移动、旋转和快速下落",
      "新 Web App",
    ),
    "复古像素风俄罗斯方块前端应用",
  );
});

test("summarizes English requests and removes implementation details", () => {
  assert.equal(
    summarizeInitialProjectTitle(
      "Build a snake game with keyboard controls and score tracking",
      "New project",
    ),
    "Snake game",
  );
});

test("keeps an existing short topic but never copies long prose", () => {
  assert.equal(
    summarizeInitialProjectTitle("俄罗斯方块", "新 Web App"),
    "俄罗斯方块",
  );
  assert.equal(
    summarizeInitialProjectTitle(
      "这是一个很长的描述，其中包含许多背景信息但没有清晰的请求性结构，因此不能直接作为项目标题",
      "新项目",
    ),
    "新项目",
  );
});

test("uses the caller fallback for greetings and ambiguous input", () => {
  assert.equal(summarizeInitialProjectTitle("你好", "新对话"), "新对话");
  assert.equal(summarizeInitialProjectTitle("continue", "Draft"), "Draft");
  assert.equal(summarizeInitialProjectTitle("", "新 Web App"), "新 Web App");
});
