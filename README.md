# UNDERTONE / 字里行间观测站

UNDERTONE 是一个基于 TypeSafe Jev 的文字信号观测工具。它不生成新文案，而是把文本中的语气、意图、张力和不确定性整理为可比较的概率信号。

主要功能：

- 交互式雷达、信号条与 Choice 概率分布
- A/B 文本对照分析；两份文本各自独立请求，避免相互污染
- 低确定性提示、token 用量、估算成本和本地预算余额
- 浏览器本地保存最近 8 条观测，可恢复或导出 JSON
- 桌面与移动端响应式界面

## 三种镜头

| 镜头 | 适合内容 | 主要观测信号 |
| --- | --- | --- |
| 消息 | 聊天、邮件、通知、反馈 | 主导语气、核心意图、紧迫度、表达清晰度、期待回复、潜在张力 |
| 提案 | 产品介绍、项目方案、观点陈述 | 价值重心、可能反应、主张清晰度、可信度、价值具体程度、行动入口 |
| 故事 | 场景、短篇、剧本、对白 | 情绪底色、叙事作用、张力、推进速度、转折、角色能动性 |

Jev 以英文为主要训练语言。中文/CJK 可以使用，但结果适合探索和辅助判断；低确定性项目应由人复核。

## 环境要求

- Node.js 24 或更高版本
- 一个 TypeSafe API key

安装依赖：

```bash
npm install
```

复制 `.env.example` 为 `.env.local`，并填写自己的配置。不要把真实 key 提交到版本控制。

```dotenv
TYPESAFE_API_KEY=<your-typesafe-api-key>
TYPESAFE_BUDGET_USD=0.25
TYPESAFE_MODEL=jev-latest
PORT=8787
```

配置说明：

| 变量 | 必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `TYPESAFE_API_KEY` | 是 | 无 | 仅由服务端读取，不会打包进浏览器代码 |
| `TYPESAFE_BUDGET_USD` | 否 | `0.25` | 本地累计支出护栏，单位为美元 |
| `TYPESAFE_MODEL` | 否 | `jev-latest` | 请求使用的 TypeSafe 模型 |
| `PORT` | 否 | `8787` | 本地 API 与生产静态站点端口 |

服务固定绑定 `127.0.0.1`。`.env.local` 已列入 `.gitignore`；前端不会读取 `TYPESAFE_API_KEY`，也不需要任何 `VITE_` 前缀的密钥变量。

## 运行

开发模式同时启动 API 与 Vite：

```bash
npm run dev
```

- 前端：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787`

生产构建与本地运行：

```bash
npm run build
npm start
```

`npm run build` 会先执行前后端 TypeScript 检查，再把前端输出到 `dist/`。随后 `npm start` 由 Express 在 `http://127.0.0.1:8787` 同时提供 API 和构建后的前端。

## 测试

```bash
# 单元与服务测试
npm test

# 监听模式
npm run test:watch

# 前后端类型检查
npm run check

# Playwright 端到端测试（桌面 + 移动端）
npm run test:e2e
```

首次运行端到端测试时，如果本机没有 Playwright 浏览器，请先安装 Chromium：

```bash
npx playwright install chromium
```

E2E 使用模拟 API，不会调用 TypeSafe，也不会消耗额度。

## 预算与账本

默认本地预算为 **$0.25**。每次请求前，服务端会保守预留可能的输入费用；响应成功后再按实际输入 token 记账。当余额不足时，新请求会被本地拒绝。

账本默认位于：

```text
data/usage.json
```

进程锁位于 `data/usage.json.lock`。整个 `data/` 目录已忽略，不应提交。账本记录累计费用、输入/输出 token、请求数及短期预留，不保存分析原文或结果。

本地预算只是应用侧的保护措施，不是 TypeSafe 账户的账单上限，也不能替代供应商侧的预算与告警。网络超时、断线或异常响应可能已经产生上游费用，因此服务端会按保守策略记账。删除账本只会清除本地统计，不会撤销真实费用。

## 隐私边界

- 提交分析时，文本会从浏览器发送到本机 Express 服务，再发送到 `api.typesafe.ai`。第三方如何处理数据以 TypeSafe 的条款和隐私政策为准。
- API key 只保存在本地服务端环境中。不要把 key 写入前端源码、URL、截图、日志或提交记录。
- 服务端不会把分析原文或结果写入磁盘；短期去重只保留在进程内存中。
- 最近 8 条观测的原文和结果保存在当前浏览器的 `localStorage`。清除站点数据即可移除；JSON 导出由用户主动触发。
- 不要提交密码、密钥、身份信息、医疗/财务资料或未经授权的机密文本。
