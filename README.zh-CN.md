# DSH AgentDeck · 代理工具箱

[![DSH 插件](https://img.shields.io/badge/DeepSeek%20Harness-plugin-2563eb)](https://github.com/deepseek-ai/deepseek-harness)
[![DSH 兼容版本](https://img.shields.io/badge/DSH-0.2.2--rc.3-blue)](package.json)
[![CI](https://github.com/oh-dsh-plugins/dsh-agentdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/oh-dsh-plugins/dsh-agentdeck/actions/workflows/ci.yml)
[![MIT 许可证](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![npm 版本](https://img.shields.io/npm/v/dsh-agentdeck)](https://www.npmjs.com/package/dsh-agentdeck)

[English](README.md) | 简体中文

面向 DeepSeek Harness（DSH）的第三方插件，提供开箱即用的场景代理和原生管理页面。通过 DSH 自身的子代理生命周期委派研究、实现、审查和界面验证任务，同时明确管理模型参数与角色定义版本。

## 功能

- **16 个完整代理：**13 个基础角色和 3 个专业变体，均包含指令、预期输入、交付物、技能及工具能力。
- **原生委派：**保留 DSH 的授权、调用者身份、取消、持久化、完成通知，并与 Agent Teams 共存。
- **原生设置页面：**以中文或英文管理代理、任务与结果、诊断，沿用宿主的明暗主题。
- **真实模型选择：**发现已配置的提供商、模型 ID 和支持的思考等级；支持继承父代理、固定模型，以及最多 3 个候选项和一个默认项。
- **明确的资源设置：**角色或候选项的单次输出上限、总输入上下文预算、有界原生恢复，以及未知容量的明确提示。
- **可扩展定义：**派生角色、编辑 YAML、导入导出、重置覆盖项、加载用户和项目定义目录；运行中的任务保留原始快照。
- **限定工具范围：**内置 16 个技能和 4 个标准库辅助脚本；浏览器会话归创建它的具体子代理所有。

AgentDeck 不增加分类模型或独立执行循环。配置了某项能力或模型声明，不代表获得任务授权，也不保证上游实际容量。

## 环境要求

| 组件 | 支持基线 |
| --- | --- |
| AgentDeck | `0.2.11` |
| DeepSeek Harness | **`0.2.2-rc.3`**；不声明兼容其他版本 |
| Node.js | `>=24.9.0` |
| 开发环境 | `PATH` 中可找到 DSH CLI；宿主依赖链接脚本使用 POSIX shell |
| 可选能力 | 已有网页服务、原生工具或受支持的浏览器集成 |

DSH 提供自身的同伴依赖（peer dependencies）。不要为了满足本插件，在活动配置档中单独升级这些宿主包。

## 安装

将 npm 上的发行版本安装到兼容的 DSH 配置档：

```sh
dsh plugin --profile web add dsh-agentdeck@0.2.11
```

使用其他配置档（profile）时，将 `web` 替换为实际名称。DSH 插件管理器负责安装软件包并应用原生组合补丁。管理器提示需要重启时，重启 DSH，再刷新已有 Harness 页面。

### GitHub Release 安装包

从 [GitHub Releases](https://github.com/oh-dsh-plugins/dsh-agentdeck/releases/latest) 下载 `dsh-agentdeck-0.2.11.tgz` 和 `SHA256SUMS`。`.tgz` 附件是包含编译后运行文件的 npm 安装包；GitHub 自动生成的源码压缩包不包含这些构建结果。

```sh
shasum -a 256 -c SHA256SUMS
dsh plugin --profile web add ./dsh-agentdeck-0.2.11.tgz
```

### 从源码构建

如需构建并安装本地归档：

```sh
git clone https://github.com/oh-dsh-plugins/dsh-agentdeck.git
cd dsh-agentdeck
npm ci --ignore-scripts
npm run dev:link-host
npm run build
mkdir -p artifacts
npm pack --ignore-scripts --pack-destination artifacts
dsh plugin --profile web add ./artifacts/dsh-agentdeck-0.2.11.tgz
```

使用其他配置档（profile）时，将 `web` 替换为实际名称。`dev:link-host` 查找已安装的 DSH CLI，并将其现有公开同伴依赖链接到当前项目，不修改宿主或活动配置档。CLI 位于其他位置时，可通过 `AGENTDECK_DSH_ROOT` 指定已安装的 DSH 包目录。

插件管理器提示需要重启时，重启 DSH，再刷新已有 Harness 页面。仅更新软件包文件，不代表所有受影响模块都已重新加载。

## 快速开始

1. 打开「**设置 → 代理工具箱**」，页面包含「代理」「任务与结果」「诊断」。
2. 查看代理；需要时选择一个活动会话，以查看该会话的模型授权和实际设置。选择会话不会授予权限。
3. 让主代理委派范围明确的任务，例如：“使用 code-scout 找到这个功能的实现位置，再让 implementer 完成已授权的修改。”
4. 阅读原生完成通知；需要更多证据时，再查看任务详情或分页结果。

已知文件的小修改、简短任务可以直接处理。缺少依赖、角色停用或显式角色 ID 无效时，会返回诊断，不会悄悄切换到其他专业角色。

### 内置代理

| 代理 | 用途 |
| --- | --- |
| `general` | 使用读取和研究能力处理未匹配任务 |
| `code-scout` | 定位文件、符号、职责及调用路径 |
| `researcher` | 使用一手资料回答有边界的问题 |
| `reader` | 阅读材料并产出可追溯的综合结果 |
| `architect` | 比较可行设计并解释取舍 |
| `implementer` | 实现限定范围的修改并运行相关检查 |
| `test-runner` | 运行已有检查并保留实际退出状态 |
| `test-designer` | 设计行为与失败边界测试 |
| `debugger` | 复现故障并隔离已验证的原因 |
| `reviewer` | 审查具体变更，报告可操作缺陷 |
| `ui-verifier` | 检查并操作实际界面 |
| `data-analyst` | 以可复现计算分析已授权数据 |
| `docs-writer` | 根据当前已验证行为编写文档 |
| `security-reviewer` | 审查可达的信任边界缺陷 |
| `performance-debugger` | 以测量研究可复现的慢路径 |
| `long-document-reader` | 通过有界证据索引阅读长材料 |

最后三个是完整专业变体。角色默认是叶子代理，不继续委派。只读角色不获得源码编辑、shell、求值器或进一步委派工具。项目检查属于单独的执行能力；辅助工具只运行已有 `test`、`check`、`lint`、`typecheck` 脚本及其冒号变体，不安装依赖。

### 主代理工具

| 工具 | 行为 |
| --- | --- |
| `scene_agent_catalog` | 列出或读取角色、发现模型、预览设置、读取精简候选项及任务；保存和重置请使用所有者管理页面 |
| `scene_agent_start` | 启动原生子代理并返回会话 ID；省略角色时使用 `general` |
| `scene_agent_control` | 使用 `childId` 查看状态、继续或中断直属子代理 |
| `scene_agent_result` | 读取证据和分页输出。续页传入 `nextOffset` 作为 `offset`，并附带 `resultRevision` |

原生完成通知异步到达。AgentDeck 子代理 ID 与 Agent Teams 成员名称属于不同命名空间。空闲状态本身不代表任务成功完成。

## 定制

所有者设置页支持启停、真实提供商／模型／思考等级选择、输出与输入预算、YAML 编辑、派生、导入导出及重置。保存冲突会保留草稿。修改作用于新启动任务；运行中的任务保留原角色、技能、辅助脚本版本及已选模型。

**批量配置助手**按需展示跟随会话、指定模型或共享的 1–3 个独立候选。已有一致的继承配置无需保存；默认保护已有覆盖、禁用／文件所有的角色及未保存草稿，允许替换只解锁手动选择。保存前审阅数量摘要、资源差异及逐项继承影响；退出候选模式必须明确迁移或重置资源。中途失败会保留已成功的前缀，不自动重试或承诺整体回滚。详见[批量操作契约](docs/ui-contract.md#progressive-batch-setup)。

定义优先级依次为：出厂默认 → 插件自有的用户覆盖项 → `customAgentDirs` 配置目录 → 活动项目的 `.dsh/agentdeck` 目录。文件定义的角色应在源文件修改，或派生到新 ID。损坏的显式定义保持无效并给出诊断，不静默恢复为出厂内容。

```yaml
schemaVersion: 1
id: concise-reviewer
extends: reviewer
title:
  en: Concise reviewer
  zh: 精简审查员
instructions:
  append: |
    Focus on behavioral defects. Return file locations, triggers and fixes.
context:
  targetTokens: 16000
  elasticTokens: 32000
```

数组支持整体替换或 `add`／`remove`／`replace`；指令支持 `append`／`replace`。已有版本 1 定义保留原版本标识；版本 2 增加输出上限和候选池。

### 模型、候选项与输出

继承或固定模型的角色可在版本 2 中设置 `output.maxTokens`。输出优先级为：角色上限 → 父代理实际上限 → 宿主报告的原生默认值。清除继承覆盖项使用 `output: null`。

所有者可配置一个小型候选池：

```yaml
schemaVersion: 2
id: bounded-reader
extends: reader
model:
  mode: auto
  defaultCandidate: normal
  candidates:
    - id: normal
      purpose: Bounded reading and synthesis
      provider: your-provider
      model: your-authorized-model
      reasoning:
        mode: model-default
      maxTokens: 4096
reasoning:
  mode: model-default
```

请替换为实际已配置且获授权的提供商／模型组合。每个池包含 1 至 3 个候选项和一个默认项；每项独立拥有输出及思考设置。使用角色 ID 和 `action: candidates` 调用 `scene_agent_catalog`，再将返回的 `revision` 及可选 `candidateId`／`candidateReason` 传入 `scene_agent_start`。省略候选项时使用默认项。过期、无效或未授权选择在启动前失败，不会尝试其他模型。

提供商、模型 ID 和思考等级来自宿主适配器。模型发现、会话授权、参数校验、实际提示词准入是不同检查。未知输出或窗口保持未知。输出上限针对单次请求，不是金额或累计用量预算。

### 插件选项

原生插件设置提供：

```yaml
customAgentDirs: []
projectConfigDirectory: .dsh/agentdeck
allowNativeFallback: true
```

受约束的兜底仅适用于未修改的出厂 `general`，且必须在任何委派发生前、完整组合无法加载时触发。它使用持久化的最小原生预设，保留角色指令、叶子限制、技能、模型／输出策略和隔离压缩。可选工具可能缺失，结果会明确说明。它不重试原生策略拒绝、容量拒绝、不确定启动或已接受子代理。

## 上下文恢复与浏览器支持

目标和弹性预算统计**每次请求的全部输入**，包括指令、工具、技能、历史及待处理材料。已知上下文窗口扣除输出预留和自适应余量。固定提示词及工具成本在子代理内测量；实际组装前，页面不承诺可用材料容量。

每份快照配置原生隔离压缩和有界溢出恢复。宿主压缩集成可能覆盖原生策略；AgentDeck 不绕过它们，也不增加第二套压缩器。无法修复的输入会给出诊断，不重试原任务原文。

浏览器角色在首个模型请求前选择一个已准入后端：

- **BrowserSkill：**激活公开技能，读取唯一活动插件配置的 CLI 路径，并执行最长 5 秒的只读状态检查。要求扩展响应且版本兼容、本地验证处于 Required 模式并已有配对设备。AgentDeck 不启动守护进程或修改配对。显式会话必须归具体子代理所有；正常完成、取消和销毁时，通过原生管线只关闭该子代理记录的会话。
- **MCP：**完整且受支持的工具命名空间提供有限的观察和交互工具。原生执行负责检查实际连接；脚本、注入请求头、调试／规则／重放路径及文件传输被拒绝。不提供新建页面；关闭页面要求已有归属记录。

记录中的浏览器实测使用 BrowserSkill `0.5.0`。普通角色列表只做轻量静态检查；浏览器角色预览执行有界检查。尚未适配 Computer Use 的脚本接口。所需浏览器和网页服务必须已在 DSH 中可用。

## 数据与移除

AgentDeck 在原生 `dsh_agentdeck` 存储域保存用户覆盖项、不可变角色／技能快照、辅助脚本哈希和启动回执。记录可能包含任务描述、已选路由及可选选择理由。原生会话日志仍是执行记录，可能包含委派材料和结果。

没有独立 AgentDeck 分析服务、分类端点或凭证库。子代理模型请求使用已配置的 DSH 提供商；网页和浏览器操作使用已安装的宿主服务，仍遵循各服务的数据处理方式。

停用或移除插件会撤销工具和管理页面，不删除原生对话、项目定义或持久化插件记录；卸载不等于擦除数据。如需恢复旧任务，请保留原快照要求的受支持依赖。

## 开发与验证

安装依赖并链接相同版本的 DSH 宿主后：

```sh
npm run typecheck
npm test
npm run check:pack
```

记录中的完整测试在固定基线上通过 **173 项**，包括原生委派、拒绝、取消、冷恢复、Team 共存、原子配置更新和浏览器归属。安装了公开 BrowserSkill 包时，可启用其适配测试。另一次真实独立子代理探针以确定性本地模型响应验证自有窗口及清理，付费模型调用为零。

参见[验证范围](docs/validation.md)、[贡献指南](CONTRIBUTING.md)、[核心契约](docs/core-contract.md)、[客户端／宿主契约](docs/ui-contract.md)及[更新记录](CHANGELOG.md)。测试与页面检查不构成相对强原生基线的模型质量、词元、费用或延迟提升证据。

## 自动发布

拉取请求和推送到 `main` 会运行 CI。推送与包版本一致的 `vX.Y.Z` 标签后，工作流先运行完整检查，再通过 npm 可信发布上传已测试的安装包、核对公开下载字节，最后创建包含 `.tgz` 和校验文件的 GitHub Release。稳定版使用 npm `latest`，预发布使用 `next`。包维护者需先完成一次 npm 可信发布配置，具体步骤见[中英双语发布指南](docs/releasing.md)。

## 安全与许可证

漏洞报告请遵循[安全政策](SECURITY.md)。普通问题或功能建议请使用 [GitHub Issues](https://github.com/oh-dsh-plugins/dsh-agentdeck/issues)，并在示例中移除凭证、私有路径及会话内容。

采用 [MIT 许可证](LICENSE)，另见[第三方声明](THIRD_PARTY_NOTICES.md)。本项目独立维护，与 DeepSeek、OpenAI 无隶属关系。
