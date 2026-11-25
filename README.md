# dsh-wsc

**给 DeepSeek Harness 的长会话压缩保留工作状态和可回查的证据。**

WSC（Work State Compaction）是 DeepSeek Harness 的社区压缩后端，包名 `@gurp-s/dsh-wsc`。它在 `cordis` 预设中接替原生的 `compaction-basic`，把用户要求、工作状态和回查入口整理成一份检查点。继续任务时，可以按事件编号（如 `#19`）回查当时改了什么、跑了什么。

**它能解决什么问题**

例如：代码已经改到第二版，测试却只跑了一个测试替身。上下文里是「修改 `src/flags.py`，加入 `FEATURE_X`」和「测试通过」，模型摘要后可能变成「`src/flags.py` 已修改，测试通过」，之后无法确认它验证的是哪一版代码。WSC 的回执会写进检查点：「`src/flags.py` 已修改（#2）；测试 #81 通过，但 #81 只验证 synthetic suite，不验证 `src/flags.py`」，并把这条检查标成 `unknown`；检查点只剩一句「测试通过」时，也可以按 #81 通过 `read_evidence` 取回当时的原始命令和输出，确认它覆盖了哪些文件，避免把没验证过的改动当成已验证。

[安装与试用](#安装与试用) · [检查点格式](https://github.com/Gurp-S/dsh-wsc/blob/main/docs/checkpoint-format.md) · [完整实验报告](https://github.com/Gurp-S/dsh-wsc/blob/main/experiments/过往实验/2026-11-24-final-benchmark/README.md)

**具体的机制图：**

![WSC 从会话事件生成检查点，并按序号回查相关证据](https://raw.githubusercontent.com/Gurp-S/dsh-wsc/main/docs/assets/compaction-flow.gif)

## 与 DSH 原生压缩的对照

下面两组实验的成本都按实验设定的模型用量单价折算，并计入压缩调用。

**同一任务，20 次重复。** 在 40 轮实验中连续改造同一个命令行工具，WSC 和 DSH 原生压缩各跑 20 次。**WSC 的单次运行成本中位数低约 40%**。

| 指标 | WSC | DSH 原生压缩 |
| --- | ---: | ---: |
| 估算成本中位数 | **¥0.805** | ¥1.343 |
| 压缩次数中位数 | **17** | 34 |
| 耗时中位数 | **1,938 秒** | 2,248 秒 |
| 最后一轮问答答对数 | 101/120 | 99/120 |

WSC 的 20 次运行中，18 次通过全部 54 项检查，另外 2 次各少 1 项；DSH 原生压缩有 5 次未通过全部检查，最差一次为 49/54。报告还列出了其他任务、不同配置的结果，以及成本如何计算。 [完整实验报告与逐次结果](https://github.com/Gurp-S/dsh-wsc/tree/main/experiments/过往实验/2026-11-24-final-benchmark) · [评测场景与运行说明](https://github.com/Gurp-S/dsh-wsc/blob/main/experiments/README.md)

**十个不同任务，各 1 次。** 另外十组 6–40 轮实验，每组换一个新任务（库存 CSV 报表、博客 slug 与目录、矩阵运算 CLI、时区时段合并、密码规则、JSON 递归 diff、工具函数集、配置合并、噪声日志、弱规格样例），共 54 项隐藏检查。**WSC 的十组总成本低约 12%，单次运行成本中位数低约 14%，10 组中 7 组更低**。

| 指标 | WSC | DSH 原生压缩 |
| --- | ---: | ---: |
| 十组总成本 | **¥2.542** | ¥2.886 |
| 单次成本中位数 | **¥0.283** | ¥0.328 |
| 压缩次数中位数 | **5** | 6 |
| 隐藏检查通过 | 54/54 | 54/54 |

WSC 在库存 CSV（−49%）、短配置（−50%）、JSON diff（−39%）上优势最大；在时区时段（+45%，多 3 次压缩）和噪声日志（+20%）上更贵。十次运行两边都通过全部隐藏检查；最终工作区的自身测试，WSC 10 次全部跑绿，原生有 1 次未跑绿（测试写法问题）。单次样本波动较大，逐组成本、检查结果与代码质量记录见 [十组任务实验记录](https://github.com/Gurp-S/dsh-wsc/blob/main/experiments/过往实验/2026-11-25-transfer-10/README.md)。

## 附带的上下文治理

除了生成检查点，WSC 还在工具结果进入请求历史之前做一层确定性的上下文治理，让历史更短、更稳，同时不丢原文。

| 机制 | 触发条件 | 做什么 | 保留什么 |
| --- | --- | --- | --- |
| 重复读取折叠 | 同一路径再次读取，且内容哈希不变 | 替换成「与第 N 次读取相同」的指针 | 文件一改就重新展开 |
| 完全相同结果折叠 | 任意工具结果与之前某次完全一致 | 折叠成指向之前结果的指针 | 只处理全等 |
| 相同失败折叠 | shell 失败输出按行归一化（ANSI、地址、UUID、耗时、行号、百分比）后整段相同 | 折叠成之前的失败 | 只折叠完全相同的失败集合 |
| 命令族摘要 | pytest、`npm test`、`node --test`、tsc、常用 git 命令；shell 输出 1000 字符起介入 | 整理成结构化摘要 | pytest 保留失败与汇总；tsc 保留全部 `error TS`；`git diff` 原文透传 |
| 噪声行清理 | 进度条、计时、纯空行 | 删除无信息行 | 只删无信息行 |
| 重复堆叠折叠 | 连续 6 行及以上完全相同 | 折叠成 `×N` | 少于 6 行不动 |
| diff 摘要 | 大补丁 | 只保留文件与增删统计 | 需要逐行时从外置存储取原文 |
| JSON 结构摘要 | 大 JSON | 只保留键结构 | 需要字段值时从外置存储取原文 |
| 头尾截断 | 超出预算的日志；shell 保留头 4000 / 尾 1500 字符，非 shell 800 / 300 | 保留头尾，从被丢弃的中段救回错误段 | 尾部已有错误时不重复摘录 |
| 运行边界 | 仅成功的工具结果；文本长度 1200–200000 字符 | 先把原文写入外置存储，再改写展示内容 | 没有外置存储或写入失败时保持原文（fail-open） |
| 压缩后重置 | 每次压缩完成 | 重新开始记录重复读取 | 不把压缩前的去重判断带进新上下文 |
| 大结果回查 | 被折叠或截断的内容 | 检查点只带摘要和入口，原文留在外置存储 | 可按事件编号或结果 ID 用 `read_evidence` 取回 |

这些变换都是确定性的，不调用模型，也不改写失败结果。[简化工具输出的方法](https://github.com/Gurp-S/dsh-wsc/blob/main/docs/denoise.md) · [设计取舍](https://github.com/Gurp-S/dsh-wsc/blob/main/docs/design-notes.md)

## 安装与试用

在已有 DeepSeek Harness 的环境中，把插件链接到所用配置目录下的 `node_modules/@gurp-s/dsh-wsc`。Windows 可用目录联接（junction），也可以在该配置目录执行 `npm install @gurp-s/dsh-wsc` 代替目录联接。把以下内容加到所用的 `cordis` 预设配置中，启用 WSC 并停用原生压缩。 [最小配置](https://github.com/Gurp-S/dsh-wsc/blob/main/profiles/default.cordis.patch.yml) · [Desktop 配置示例](https://github.com/Gurp-S/dsh-wsc/blob/main/profiles/README.md)

```yaml
- id: wsc-config
  name: "@gurp-s/dsh-wsc"
  config:
    mode: active

- id: compaction-basic
  disabled: true

- insert:
    - id: wsc-engine
      name: "@gurp-s/dsh-wsc/engine"
```

- **确认生效**。在已有一段历史的会话中，可以让助手调用 `compact_context` 请求压缩。DSH 会在下一次模型请求前处理。压缩完成后，可以在会话的 `compaction/summary` 事件里看到 WSC 检查点。
- **恢复原生压缩**。移除 WSC 的配置，恢复预设原先的 `compaction-basic` 配置，再重新加载 DSH 配置。
- **模型用量**。WSC 沿用当前会话的模型配置，整理历史记录会额外调用模型。 [日志位置与用量统计](https://github.com/Gurp-S/dsh-wsc/blob/main/experiments/README.md)

## 检查点是什么样

例如，用户要求把导出的日期统一成 ISO 格式、单页最多 50 条，并保留 API 字段名。继续任务时遇到一句「测试通过」，助手可以按检查点里的编号回查是哪次测试。测试覆盖哪些文件和改动，以原始命令和结果为准。

```text
用户要求（原话）
1. "导出的日期统一成 ISO 格式，单页最多 50 条，别改字段名"

当前记录
- 保留 API 字段名。
- 单页上限设为 50。
- src/export.py 的日期输出为 ISO 格式（YYYY-MM-DD）。

修改与检查
- #24 修改了 src/export.py。
- #25 运行 pytest，报告 3 项检查通过。
- #26 修改了 tests/test_export.py。

回查入口
- 使用 read_evidence 查看 #24 的原始修改记录。
```

`read_history` 可以按编号查看历史消息，`read_evidence` 可以读取已保存的原始记录。上面是简化的中文示例。实际检查点还可能包含最新请求、最近修改和工具返回的数值。 [检查点格式与回查方法](https://github.com/Gurp-S/dsh-wsc/blob/main/docs/checkpoint-format.md)

## 压缩如何工作

1. **选取历史。** WSC 根据上下文用量决定压缩哪段历史，让每次工具调用和它的结果保持成对。默认最多使用 `256000` tokens 的上下文容量，模型的可用容量更小时以模型为准。默认用到容量的 `80%` 会触发强制压缩。模型主动请求压缩时，如果预计腾不出至少 `15%` 的空间，这次请求可以跳过。
2. **整理要点。** WSC 为这段历史的消息编号，让模型结合已有记录提出新增或修正的要点。通常调用模型一次，历史太长时分段处理，失败时可能重试。WSC 会检查引用，以及部分名称和数值能否在原文中找到，并记录未通过的条目。
3. **生成检查点。** `lib/passage.js` 按固定顺序展示用户要求、当前记录、工作状态和回查入口。相同的用户请求只展示一次，部分旧值会从当前记录中收起。空间不足时，先缩减回查入口、工具返回的数值和当前记录。工作状态标为「未验证」。

去重与截断在工具结果进入请求历史之前完成，具体规则见[附带的上下文治理](#附带的上下文治理)。

## 开发与验证

```bash
npm test
```

- [`index.js`](https://github.com/Gurp-S/dsh-wsc/blob/main/index.js)、[`engine.js`](https://github.com/Gurp-S/dsh-wsc/blob/main/engine.js)、[`client.js`](https://github.com/Gurp-S/dsh-wsc/blob/main/client.js) 对应配置、压缩后端和设置页。
- [`lib/`](https://github.com/Gurp-S/dsh-wsc/tree/main/lib) 包含整理历史、生成检查点和回查原文的代码。
- [`profiles/`](https://github.com/Gurp-S/dsh-wsc/tree/main/profiles) 提供安装配置示例。
- [`tests/`](https://github.com/Gurp-S/dsh-wsc/tree/main/tests) 包含可离线运行的测试。
- [`experiments/`](https://github.com/Gurp-S/dsh-wsc/tree/main/experiments) 包含评测脚本、场景和[历次实验记录](https://github.com/Gurp-S/dsh-wsc/tree/main/experiments/过往实验)。

许可证为 [MIT](https://github.com/Gurp-S/dsh-wsc/blob/main/LICENSE)。
