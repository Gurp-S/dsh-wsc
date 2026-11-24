# dsh-wsc

**给 DeepSeek Harness 的长会话压缩保留工作状态和可回查的证据。**

WSC（Work State Compaction）是 DeepSeek Harness 的社区压缩后端，包名 `@xeyo/dsh-wsc`。它在 `cordis` 预设中接替原生的 `compaction-basic`，把用户要求、工作状态和回查入口整理成一份检查点。继续任务时，可以按事件编号（如 `#19`）回查当时改了什么、跑了什么。

[安装与试用](#安装与试用) · [检查点格式](docs/checkpoint-format.md) · [完整实验报告](experiments/过往实验/2026-11-24-final-benchmark/README.md)

![WSC 从会话事件生成检查点，并按序号回查相关证据](docs/assets/compaction-flow.gif)

## 与 DSH 原生压缩的对照

在一组 40 轮的实验中，助手连续改造同一个命令行工具。WSC 和 DSH 原生压缩各跑 8 次。按实验设定的模型用量单价折算，并计入压缩调用，**WSC 的单次运行成本中位数低约 47%**。

| 指标 | WSC | DSH 原生压缩 |
| --- | ---: | ---: |
| 估算成本中位数 | **¥0.720** | ¥1.356 |
| 压缩次数中位数 | **16** | 35 |
| 耗时中位数 | **2,117 秒** | 2,718 秒 |
| 最后一轮问答答对数 | 40/48 | 40/48 |

WSC 的 8 次运行中，最终工作区均通过全部 54 项检查。报告还列出了其他任务、不同配置的结果，以及成本如何计算。 [完整实验报告与逐次结果](experiments/过往实验/2026-11-24-final-benchmark/) · [评测场景与运行说明](experiments/README.md)

## 安装与试用

在已有 DeepSeek Harness 的环境中，把插件链接到所用配置目录下的 `node_modules/@xeyo/dsh-wsc`。Windows 可用目录联接（junction）。把以下内容加到所用的 `cordis` 预设配置中，启用 WSC 并停用原生压缩。 [最小配置](profiles/default.cordis.patch.yml) · [Desktop 配置示例](profiles/README.md)

```yaml
- id: wsc-config
  name: "@xeyo/dsh-wsc"
  config:
    mode: active

- id: compaction-basic
  disabled: true

- insert:
    - id: wsc-engine
      name: "@xeyo/dsh-wsc/engine"
```

- **确认生效**。在已有一段历史的会话中，可以让助手调用 `compact_context` 请求压缩。DSH 会在下一次模型请求前处理。压缩完成后，可以在会话的 `compaction/summary` 事件里看到 WSC 检查点。
- **恢复原生压缩**。移除 WSC 的配置，恢复预设原先的 `compaction-basic` 配置，再重新加载 DSH 配置。
- **模型用量**。WSC 沿用当前会话的模型配置，整理历史记录会额外调用模型。 [日志位置与用量统计](experiments/README.md)

## 检查点是什么样

例如，用户要求把税率改为 `0.07`、报表上限改为 `500`，并保留 API 字段名。继续任务时遇到一句「测试通过」，助手可以按检查点里的编号回查是哪次测试。测试覆盖哪些文件和改动，以原始命令和结果为准。

```text
用户要求（原话）
1. "把 TAX_RATE 改成 0.07，报表上限改成 500，别改 API 字段名"

当前记录
- 保留 API 字段名。
- 报表上限设为 500。
- src/tax.py 中的 TAX_RATE 为 0.07。

修改与检查
- #18 修改了 src/report.py。
- #19 运行 pytest，报告 4 项检查通过。

回查入口
- 使用 read_evidence 查看 #18 的原始修改记录。
```

`read_history` 可以按编号查看历史消息，`read_evidence` 可以读取已保存的原始记录。上面是简化的中文示例。实际检查点还可能包含最新请求、最近修改和工具返回的数值。 [检查点格式与回查方法](docs/checkpoint-format.md)

## 压缩如何工作

1. **选取历史。** WSC 根据上下文用量决定压缩哪段历史，让每次工具调用和它的结果保持成对。默认最多使用 `256000` tokens 的上下文容量，模型的可用容量更小时以模型为准。默认用到容量的 `80%` 会触发强制压缩。模型主动请求压缩时，如果预计腾不出至少 `15%` 的空间，这次请求可以跳过。
2. **整理要点。** WSC 为这段历史的消息编号，让模型结合已有记录提出新增或修正的要点。通常调用模型一次，历史太长时分段处理，失败时可能重试。WSC 会检查引用，以及部分名称和数值能否在原文中找到，并记录未通过的条目。
3. **生成检查点。** `lib/passage.js` 按固定顺序展示用户要求、当前记录、工作状态和回查入口。相同的用户请求只展示一次，部分旧值会从当前记录中收起。空间不足时，先缩减回查入口、工具返回的数值和当前记录。工作状态标为「未验证」。

压缩之前，WSC 也可以缩短重复的读取结果和部分命令日志。原文保存成功后才会缩短展示内容。压缩完成后，会重新开始记录哪些读取结果重复。 [简化工具输出的方法](docs/denoise.md) · [设计取舍](docs/design-notes.md)

## 开发与验证

```bash
npm test
```

- [`index.js`](index.js)、[`engine.js`](engine.js)、[`client.js`](client.js) 对应配置、压缩后端和设置页。
- [`lib/`](lib/) 包含整理历史、生成检查点和回查原文的代码。
- [`profiles/`](profiles/) 提供安装配置示例。
- [`tests/`](tests/) 包含可离线运行的测试。
- [`experiments/`](experiments/) 包含评测脚本、场景和[历次实验记录](experiments/过往实验/)。

许可证为 [MIT](LICENSE)。
