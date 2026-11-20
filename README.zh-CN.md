# DSH AgentDeck · 代理工具箱

[![DSH 插件](https://img.shields.io/badge/DeepSeek%20Harness-plugin-2563eb)](https://github.com/deepseek-ai/deepseek-harness)
[![DSH 兼容版本](https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.1-blue)](package.json)
[![CI](https://github.com/oh-dsh-plugins/dsh-agentdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/oh-dsh-plugins/dsh-agentdeck/actions/workflows/ci.yml)
[![MIT 许可证](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![npm 版本](https://img.shields.io/npm/v/dsh-agentdeck)](https://www.npmjs.com/package/dsh-agentdeck)

[English](README.md) | 简体中文

面向 DeepSeek Harness（DSH）的第三方插件，提供开箱即用的场景代理和原生管理页面。通过 DSH 自身的子代理生命周期委派研究、实现、审查和界面验证任务，同时明确管理模型参数与角色定义版本。

## 功能

- **16 个完整代理：**13 个基础角色和 3 个专业变体，均包含指令、预期输入、交付物、技能及工具能力。
- **原生委派：**保留 DSH 的授权、调用者身份、取消、持久化、完成通知，并与 Agent Teams 共存。
- **原生设置页面：**以中文或英文管理代理、任务与结果、诊断，沿用宿主的明暗主题。
- **真实模型选择：**发现已配置提供商、模型及思考等级；支持继承、固定模型和带默认项的候选池。
- **每角色 AI 建议：**选择独立的建议生成器，采用模型与推理配置到草稿；新任务沿用原生上下文恢复，无独立资源配额。
- **可扩展定义：**派生角色、编辑 YAML、导入导出、重置覆盖项、加载用户和项目定义目录；运行中的任务保留原始快照。
- **限定工具范围：**内置 16 个技能和 4 个标准库辅助脚本；浏览器会话归创建它的具体子代理所有。

AgentDeck 不增加分类模型或独立执行循环。配置了某项能力或模型声明，不代表获得任务授权，也不保证上游实际容量。

## 环境要求

| 组件 | 支持基线 |
| --- | --- |
| AgentDeck | `0.3.0` |
| DeepSeek Harness | **`>=0.2.2-rc.1`**；已发布宿主验证覆盖 `rc.1` 至 `rc.5`，未来版本须通过相同行为验收 |
| Node.js | `>=24.9.0` |
| 开发环境 | `PATH` 中可找到 DSH CLI；宿主依赖链接脚本使用 POSIX shell |
| 可选能力 | 已有网页服务、原生工具或受支持的浏览器集成 |

DSH 提供自身的同伴依赖（peer dependencies）。不要为了满足本插件，在活动配置档中单独升级这些宿主包。

## 安装

将 npm 上的发行版本安装到兼容的 DSH 配置档：

```sh
dsh plugin --profile web add dsh-agentdeck@0.3.0
```

使用其他配置档（profile）时，将 `web` 替换为实际名称。DSH 插件管理器负责安装软件包并应用原生组合补丁。管理器提示需要重启时，重启 DSH，再刷新已有 Harness 页面。

### GitHub Release 安装包

从 [GitHub Releases](https://github.com/oh-dsh-plugins/dsh-agentdeck/releases/latest) 下载 `dsh-agentdeck-0.3.0.tgz` 和 `SHA256SUMS`。`.tgz` 附件是包含编译后运行文件的 npm 安装包；GitHub 自动生成的源码压缩包不包含这些构建结果。

```sh
shasum -a 256 -c SHA256SUMS
dsh plugin --profile web add ./dsh-agentdeck-0.3.0.tgz
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
dsh plugin --profile web add ./artifacts/dsh-agentdeck-0.3.0.tgz
```

使用其他配置档（profile）时，将 `web` 替换为实际名称。`dev:link-host` 查找已安装的 DSH CLI，并将其现有公开同伴依赖链接到当前项目，不修改宿主或活动配置档。CLI 位于其他位置时，可通过 `AGENTDECK_DSH_ROOT` 指定已安装的 DSH 包目录。

插件管理器提示需要重启时，重启 DSH，再刷新已有 Harness 页面。仅更新软件包文件，不代表所有受影响模块都已重新加载。

## 快速开始

1. 打开「**设置 → 代理工具箱**」，页面包含「代理」「任务与结果」「诊断」。
2. 查看代理；需要时选择一个活动会话，以查看该会话的模型授权和实际设置。选择会话不会授予权限。
3. 让主代理委派范围明确的任务，例如：“使用 code-scout 找到这个功能的实现位置，再让 implementer 完成已授权的修改。”
4. 阅读原生完成通知；需要更多证据时，再查看任务详情或分页结果。

已知文件的小修改、简短任务可以直接处理。缺少依赖、角色停用或显式角色 ID 无效时，会返回诊断，不会悄悄切换到其他专业角色。

### 跨机器迁移模型配置

在「**设置 → 代理工具箱 → 代理**」选择「**导出模型配置**」，勾选需要的角色。JSON 文件包含已保存的模型模式、推理强度，以及候选标识、用途、顺序和默认项；不包含提供商连接、密钥、路径、指令或技能，也不会导出未保存草稿。

在另一台机器上保持「会话上下文」未选择，再点击「**导入模型配置**」。逐项确认目标角色，将缺失的提供商、模型或不支持的推理强度映射到本机选项。可取消勾选以跳过角色，也可跳过单个候选；至少保留一个候选，跳过默认候选前需先明确选择新的默认项。继承模式跟随目标机器的配置。本机没有的角色需明确选择目标；由其他来源维护的角色需回到其来源编辑。

点击「**预览变更**」检查前后配置，再「**采用到草稿**」。最后逐个使用角色原有的保存按钮；保存时仍会检查最新版本与继承影响。已有未保存草稿会受到保护。导入只迁移配置偏好，不会授予模型权限。

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

所有者设置页支持启停、真实提供商／模型／思考等级选择、YAML 编辑、派生、导入导出及重置。固定模型和候选模式各自在角色编辑页提供 AI 建议；用于生成建议的模型独立选择，无需选择会话。采用只修改草稿，正常保存后生效。运行中的任务保留原始快照。

AI 建议说明当前模式下的模型、推理设置、候选用途和默认项，并展示采用前后的变化。不会批量修改其他角色。生成错误直接展示实际阶段和原因，长响应可展开查看；过期建议不能采用。详见[客户端与 Host 契约](docs/ui-contract.md)。

定义优先级依次为：出厂默认 → 插件自有的用户覆盖项 → `customAgentDirs` 配置目录 → 活动项目的 `.dsh/agentdeck` 目录。文件定义的角色应在源文件修改，或派生到新 ID。损坏的显式定义保持无效并给出诊断，不静默恢复为出厂内容。

```yaml
schemaVersion: 3
id: concise-reviewer
extends: reviewer
title:
  en: Concise reviewer
  zh: 精简审查员
instructions:
  append: |
    Focus on behavioral defects. Return file locations, triggers and fixes.
```

数组支持整体替换或 `add`／`remove`／`replace`；指令支持 `append`／`replace`。版本 1／2 继续可读，并为新任务规范化为版本 3；旧输出与上下文配额不再生效。读取不会重写来源文件，历史运行快照保持原策略。

### 模型与候选项

角色使用原生模型参数继承与宿主上下文恢复策略。AgentDeck 不再配置输出上限、目标／弹性上下文预算或退出候选时的资源迁移。切到固定模型时带入默认候选，切到继承时恢复原生继承；所有修改先进入草稿。

所有者可配置一个小型候选池：

```yaml
schemaVersion: 3
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
reasoning:
  mode: model-default
```

请替换为实际已配置且获授权的提供商／模型组合。候选池至少一项，必须有默认项；每项包含用途和推理设置。使用角色 ID 和 `action: candidates` 调用 `scene_agent_catalog`，再把返回的 `revision` 与可选 `candidateId`／`candidateReason` 传入 `scene_agent_start`。省略候选项时使用默认项。过期、无效或未授权选择在原生启动前失败，不尝试其他模型。

模型目录与可选元数据只用于展示，不是 AI 生成建议的提前禁用条件。生成器按用户所选路由实际调用，错误保留原因与响应。子任务执行继续由原生模型授权和参数校验负责；未知模型窗口保持未知。

### 插件选项

原生插件设置提供：

```yaml
customAgentDirs: []
projectConfigDirectory: .dsh/agentdeck
allowNativeFallback: true
```

受约束的兜底仅适用于未修改的出厂 `general`，且必须在任何委派发生前、完整组合无法加载时触发。持久化最小原生预设保留角色指令、叶子限制、技能、模型设置和宿主恢复继承。缺失的可选工具会明确报告；不重试原生拒绝、不确定启动或已接受的子代理。

## 上下文恢复与浏览器支持

新任务不再设独立的角色输入或输出配额。实际窗口和参数遵循原生模型选择与继承规则，自动压缩使用宿主已有服务。历史 policyVersion: 1 快照继续按原限制恢复；新任务使用无配额的 policyVersion: 2。

原生恢复可在请求前压缩历史，也可在供应商报告标准上下文超限后缩减历史并重试当前请求，保持同一子会话与已有工具结果。无法缩减的固定输入仍可能失败。输出截断保留文本并标记不完整，可在原子任务继续，不误报完成。

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
