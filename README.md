# dsh-wsc

**让 DeepSeek Harness 在压缩长会话后，还能查到之前改了什么、跑过什么检查。**

WSC（Work State Compaction）是 DeepSeek Harness 的社区插件。会话需要压缩时，它会把用户要求、最近的修改和检查结果整理成一份简短的工作记录。需要细节时，助手可以按记录里的编号回查原始对话或工具输出。

例如，第 `#19` 条记录显示测试通过，第 `#23` 条记录又改了同一个文件。两条记录的顺序一目了然，助手可以回查测试命令和输出，判断那次测试对应的是哪次改动。

## 安装与试用

将下载的插件源码链接到 DSH 所用配置目录下的 `node_modules/@xeyo/dsh-wsc`。然后把下面这段配置加到实际使用的 `cordis` 预设里。 [完整配置示例](profiles/README.md)

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

- **试一次压缩。** 在已有一段历史的会话中，可以让助手调用 `compact_context`。压缩完成后，请助手按编号回查一条修改或检查记录。 [查看记录与回查方式](docs/checkpoint-format.md)
- **恢复原来的压缩。** 撤销上面的配置改动并重新加载 DSH。

WSC 沿用当前会话的模型配置。整理工作记录时会调用模型，这部分也会产生模型用量。

## 实际跑下来怎么样

我们让 WSC 和 DSH 的原生压缩各跑 8 次，每次用 40 轮对话改造同一个命令行工具。把正常对话和压缩的模型调用都算进去，**WSC 的单次运行估算成本中位数低约 47%**，压缩次数的中位数从 **35 次降到 16 次**。两种方案在最后一轮问答里答对的问题数相同。 [完整结果与计费方式](experiments/过往实验/2026-11-24-final-benchmark/README.md)

## 更多资料

- [压缩过程图](docs/assets/compaction-flow.gif)和[设计说明](docs/design-notes.md)
- [如何缩短重复的工具输出并保留原文](docs/denoise.md)
- [如何运行对照实验](experiments/README.md)

开发者可运行 `npm test` 检查插件。许可证为 [MIT](LICENSE)。
