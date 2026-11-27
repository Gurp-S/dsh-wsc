window.__ModuleLoader__.load({
  id: '@gurp-s/dsh-wsc',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'wsc'
    const ENTRY = 'wsc-config'

    const DICT = {
      en: {
        nav: 'Context compaction',
        title: 'Context compaction',
        intro: 'WSC replaces the shipped summarizer inside the active agent preset. Values below are live.',
        mode: 'Mode',
        modeActive: 'Active',
        modeShadow: 'Shadow (measure only)',
        modeOff: 'Off',
        secTrigger: 'Compaction trigger',
        secCheckpoint: 'Checkpoint content',
        secExtraction: 'Extraction',
        secTools: 'Tools',
        capacityPercent: 'Window share (%)',
        effectiveWindow: 'Working window (tokens, 0 = model window)',
        warn: 'Warning threshold',
        force: 'Forced compaction',
        minReclaim: 'Minimum reclaim (%)',
        ledgerCap: 'Ledger byte cap (0 = unlimited)',
        controlCap: 'Control quote cap (bytes, 0 = unlimited)',
        controlItemMax: 'Older request cap (bytes, 0 = off; newest always kept)',
        ledgerFloor: 'Keep at least one ledger entry under the cap',
        promoteLatest: 'Name the latest request as next when nothing matched',
        ledgerDenoise: 'Fold superseded ledger entries',
        evidenceRows: 'Evidence index rows (0 = off)',
        latest: 'Pin the latest request',
        recent: 'Recent changes and checks',
        verify: 'Entry verification',
        verifyLiteral: 'Literal anchors (default)',
        verifyCite: 'Citation only',
        verifyQuote: 'Verbatim quote',
        segment: 'Extraction segment (bytes)',
        entries: 'Entries per segment',
        effort: 'Extraction reasoning effort',
        effortInherit: 'Inherit session',
        effortOff: 'Off',
        effortLow: 'Low',
        effortMedium: 'Medium',
        effortHigh: 'High',
        verifyHint: 'Literal anchors: numbers, paths and identifiers in an entry must appear in the cited message, otherwise the entry is rejected. This blocks fabricated values but cannot prove a prose rationale. Citation only checks that the cited message exists. Verbatim quote requires exact supporting text; it is the strongest check and costs more output tokens.',
        denoise: 'Denoise tool output',
        evidence: 'Register the history retrieval tool',
        hint: 'Thresholds are shares of the capacity. A warning-triggered compaction is skipped when it would reclaim less than the minimum.',
        unavailable: 'This profile does not serve the WSC configuration.',
        saved: 'Saved',
        failed: 'Not saved',
        statusRunning: 'WSC compacting',
        statusPrepared: 'WSC finalizing',
        statusDone: 'WSC compacted',
        statusDeclined: 'WSC skipped (history kept)',
        statusCancelled: 'WSC cancelled (history kept)',
        statusSeg: 'seg',
        statusEntries: 'entries',
        statusRetry: 'retry',
        statusWaiting: 'waiting for the model',
        statusDetails: 'Details',
        statusPhase: 'Phase',
        statusUsage: 'Tokens',
        statusOutput: 'Output',
        statusElapsed: 'Elapsed',
        statusUpdated: 'Updated',
      },
      zh: {
        nav: '上下文压缩',
        title: '上下文压缩',
        intro: 'WSC 替换当前 agent preset 里的摘要器，下面的值即时生效。',
        mode: '模式',
        modeActive: '启用',
        modeShadow: '影子（只测量）',
        modeOff: '关闭',
        secTrigger: '压缩触发',
        secCheckpoint: '检查点内容',
        secExtraction: '抽取',
        secTools: '工具',
        capacityPercent: '窗口占比（%）',
        effectiveWindow: '有效窗口（token，0 = 模型窗口）',
        warn: '警告阈值',
        force: '强制压缩阈值',
        minReclaim: '最小回收比例（%）',
        ledgerCap: '账本字节上限（0 = 不限）',
        controlCap: '逐字需求上限（字节，0 = 不限）',
        controlItemMax: '旧单条请求上限（字节，0 = 关闭；最新一条总是完整保留）',
        ledgerFloor: '达到上限时至少保留一条账本',
        promoteLatest: '无可匹配工作时把最新请求写进 next',
        ledgerDenoise: '折叠账本旧版本',
        evidenceRows: '证据索引行数（0 = 关闭）',
        latest: '置顶最新请求',
        recent: '最近改动与检查',
        verify: '条目校验',
        verifyLiteral: '字面锚点（默认）',
        verifyCite: '仅校验引用',
        verifyQuote: '逐字引文',
        segment: '抽取分段（字节）',
        entries: '每段条目上限',
        effort: '抽取推理强度',
        effortInherit: '继承会话',
        effortOff: '关闭',
        effortLow: '低',
        effortMedium: '中',
        effortHigh: '高',
        verifyHint: '字面锚点：条目里的数字、路径、标识符必须出现在被引用的消息里，否则丢弃；能挡住编造值，但不能证明散文式理由。仅校验引用：只要求引用存在，最便宜。逐字引文：模型必须给出原文，引擎逐字核对，最强但输出更多。',
        denoise: '工具输出去噪',
        evidence: '注册历史回读工具',
        hint: '阈值按窗口容量的比例计算；提示触发的压缩若回收量低于最小比例，会被跳过。',
        unavailable: '当前 profile 没有提供 WSC 配置。',
        saved: '已保存',
        failed: '未保存',
        statusRunning: 'WSC 压缩中',
        statusPrepared: 'WSC 收尾中',
        statusDone: 'WSC 压缩完成',
        statusDeclined: 'WSC 未执行（历史保留）',
        statusCancelled: 'WSC 已取消（历史保留）',
        statusSeg: '段',
        statusEntries: '条',
        statusRetry: '重试',
        statusWaiting: '等待模型返回',
        statusDetails: '详情',
        statusPhase: '阶段',
        statusUsage: 'Token',
        statusOutput: '输出',
        statusElapsed: '已用',
        statusUpdated: '更新于',
      },
    }

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

    const readSnapshot = (form) => {
      try {
        return form === undefined ? undefined : form.getSnapshot()
      } catch {
        return undefined
      }
    }

    const styles = {
      page: { padding: '8px 0 24px', display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 640 },
      title: { color: 'var(--dsw-alias-label-primary)', fontSize: 16, fontWeight: 500, margin: '0 0 4px' },
      intro: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: '20px', margin: '0 0 12px' },
      row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.18))',
      },
      label: { color: 'var(--dsw-alias-label-primary)', fontSize: 14 },
      section: {
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        fontWeight: 600,
        margin: '18px 0 2px',
      },
      hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px', marginTop: 12 },
      control: {
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3))',
        borderRadius: 6,
        padding: '4px 8px',
        fontSize: 13,
        minWidth: 160,
      },
      number: {
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3))',
        borderRadius: 6,
        padding: '4px 8px',
        fontSize: 13,
        width: 96,
        textAlign: 'right',
      },
    }

    function Row({ label, children }) {
      return h('div', { style: styles.row }, h('span', { style: styles.label }, label), children)
    }

    function Page(props) {
      const form = props.form
      const t = props.t
      const [snapshot, setSnapshot] = React.useState(() => readSnapshot(form))
      const [status, setStatus] = React.useState('')

      React.useEffect(() => {
        if (form === undefined || typeof form.subscribe !== 'function') return undefined
        return form.subscribe(() => setSnapshot(readSnapshot(form)))
      }, [form])

      if (snapshot === undefined || snapshot.value === undefined) {
        return h('div', { style: styles.page }, h('div', { style: styles.intro }, t('unavailable')))
      }

      const value = snapshot.value
      const write = (key, next) => {
        if (form === undefined || typeof form.mutate !== 'function') return
        setStatus('')
        Promise.resolve(form.mutate([{ op: 'set', path: [key], value: next }]))
          .then(() => setStatus('saved'))
          .catch(() => setStatus('failed'))
      }

      const mode = h(
        'select',
        { style: styles.control, value: value.mode ?? 'active', onChange: (event) => write('mode', event.target.value) },
        h('option', { value: 'active' }, t('modeActive')),
        h('option', { value: 'shadow' }, t('modeShadow')),
        h('option', { value: 'off' }, t('modeOff')),
      )

      const verification = h(
        'select',
        {
          style: styles.control,
          value: value.nosigVerification ?? 'literal',
          onChange: (event) => write('nosigVerification', event.target.value),
        },
        h('option', { value: 'literal' }, t('verifyLiteral')),
        h('option', { value: 'cite' }, t('verifyCite')),
        h('option', { value: 'quote' }, t('verifyQuote')),
      )

      const number = (key, min, max, step = 0.01, disabled = false) =>
        h('input', {
          style: styles.number,
          type: 'number',
          min,
          max,
          step,
          disabled,
          defaultValue: value[key],
          onBlur: (event) => {
            const parsed = Number(event.target.value)
            if (Number.isFinite(parsed)) write(key, clamp(parsed, min, max))
          },
        })

      const percent = (key, fallback) =>
        h('input', {
          style: styles.number,
          type: 'number',
          min: 0,
          max: 100,
          step: 1,
          defaultValue: Math.round((value[key] ?? fallback) * 100),
          onBlur: (event) => {
            const parsed = Number(event.target.value)
            if (Number.isFinite(parsed)) write(key, clamp(parsed, 0, 100) / 100)
          },
        })

      const check = (key) =>
        h('input', {
          type: 'checkbox',
          checked: value[key] !== false,
          onChange: (event) => write(key, event.target.checked),
        })

      const effort = h(
        'select',
        {
          style: styles.control,
          value: value.nosigReasoningEffort ?? '',
          onChange: (event) => write('nosigReasoningEffort', event.target.value),
        },
        h('option', { value: '' }, t('effortInherit')),
        h('option', { value: 'off' }, t('effortOff')),
        h('option', { value: 'low' }, t('effortLow')),
        h('option', { value: 'medium' }, t('effortMedium')),
        h('option', { value: 'high' }, t('effortHigh')),
      )

      return h(
        'div',
        { style: styles.page },
        h('h2', { style: styles.title }, t('title')),
        h('p', { style: styles.intro }, t('intro')),
        h(Row, { label: t('mode') }, mode),

        h('h3', { style: styles.section }, t('secTrigger')),
        h(Row, { label: t('effectiveWindow') }, number('effectiveWindowTokens', 0, 1000000, 1000)),
        h(Row, { label: t('capacityPercent') }, number('capacityPercent', 1, 100, 1)),
        h(Row, { label: t('warn') }, number('warnRatio', 0.5, 0.95)),
        h(Row, { label: t('force') }, number('forceRatio', 0.5, 0.99)),
        h(Row, { label: t('minReclaim') }, percent('minReclaimRatio', 0.15)),

        h('h3', { style: styles.section }, t('secCheckpoint')),
        h(Row, { label: t('ledgerCap') }, number('ledgerCapBytes', 0, 65536, 1)),
        h(Row, { label: t('controlCap') }, number('controlMaxBytes', 0, 65536, 1)),
        h(Row, { label: t('controlItemMax') }, number('controlItemMaxBytes', 0, 65536, 1)),
        h(Row, { label: t('ledgerFloor') }, check('ledgerFloor')),
        h(Row, { label: t('promoteLatest') }, check('promoteLatestRequest')),
        h(Row, { label: t('ledgerDenoise') }, check('ledgerDenoise')),
        h(Row, { label: t('evidenceRows') }, number('evidenceIndexRows', 0, 20, 1)),
        h(Row, { label: t('latest') }, check('passageLatest')),
        h(Row, { label: t('recent') }, check('passageRecent')),

        h('h3', { style: styles.section }, t('secExtraction')),
        h(Row, { label: t('verify') }, verification),
        h(Row, { label: t('segment') }, number('nosigSegmentBytes', 4096, 200000, 1)),
        h(Row, { label: t('entries') }, number('nosigEntryCap', 1, 50, 1)),
        h(Row, { label: t('effort') }, effort),

        h('h3', { style: styles.section }, t('secTools')),
        h(Row, { label: t('denoise') }, check('denoise')),
        h(Row, { label: t('evidence') }, check('evidenceTool')),

        h('p', { style: styles.hint }, t('verifyHint')),
        h('p', { style: styles.hint }, t('hint')),
        status === '' ? null : h('p', { style: styles.hint }, t(status)),
      )
    }

    const STATUS_URL = '/plugins/dsh-wsc/status'
    const STATUS_POLL_MS = 1500
    const STATUS_HOLD_MS = 12 * 1000
    const STATUS_STALE_MS = 10 * 60 * 1000
    // A segment call can legitimately take a minute; only past this point does
    // the line say the model has not answered yet.
    const STATUS_STALL_MS = 90 * 1000
    const statusStyles = {
      // Same width and centering as the goal bar and the todo panel, so the
      // left edge lines up with the composer column instead of the window.
      wrap: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        boxSizing: 'border-box',
        width: 'calc(100% - 2 * var(--dsh-composer-side-clearance, 16px)'
          + ' - 4 * var(--dsh-composer-dock-inset, 8px))',
        maxWidth: 'calc(var(--dsh-composer-card-max-width, 952px)'
          + ' - 4 * var(--dsh-composer-dock-inset, 8px))',
        margin: '0 auto',
      },
      button: {
        display: 'flex',
        flexDirection: 'column',
        alignSelf: 'flex-start',
        maxWidth: '100%',
        padding: '2px 10px 4px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3))',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: 12,
        lineHeight: '18px',
        textAlign: 'left',
        cursor: 'pointer',
        overflow: 'hidden',
      },
      row: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
      dot: { width: 6, height: 6, borderRadius: '50%', flex: 'none' },
      text: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      chevron: { flex: 'none', opacity: 0.55, fontSize: 10, lineHeight: '12px' },
      track: {
        position: 'relative',
        height: 2,
        marginTop: 2,
        borderRadius: 1,
        overflow: 'hidden',
        background: 'rgba(128,128,128,0.25)',
      },
      fill: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        borderRadius: 1,
        transition: 'width 300ms ease-out',
      },
      sweep: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: '35%',
        opacity: 0.5,
        animation: 'wsc-status-sweep 0.9s linear infinite',
      },
      panel: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 12px',
        borderRadius: 'var(--dsw-radius-lg, 12px)',
        background: 'var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2))',
        backdropFilter: 'var(--dsw-menu-backdrop-filter, none)',
        boxShadow: 'var(--dsw-elevation-panel, none)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 12,
        lineHeight: '18px',
        whiteSpace: 'normal',
        overflow: 'hidden',
      },
      panelRow: { display: 'flex', justifyContent: 'space-between', gap: 12 },
      panelKey: { opacity: 0.65, flex: 'none' },
      panelValue: { textAlign: 'right', wordBreak: 'break-word' },
      panelMessage: { marginTop: 4, wordBreak: 'break-word' },
    }

    const formatTokens = (value) => {
      if (!Number.isFinite(value) || value < 0) return undefined
      if (value < 1000) return String(Math.round(value))
      const thousands = value / 1000
      return `${thousands >= 100 ? thousands.toFixed(0) : thousands.toFixed(1)}k`
    }

    function StatusLine(props) {
      const sessionId = props.sessionId
      const t = props.t
      const [status, setStatus] = React.useState(null)
      const [expanded, setExpanded] = React.useState(false)
      const [now, setNow] = React.useState(() => Date.now())
      const [flash, setFlash] = React.useState(false)
      const lastDone = React.useRef(null)
      const shownTokens = React.useRef(0)
      const realTokens = React.useRef(0)
      const realTokensAt = React.useRef(0)
      const live = status?.phase === 'running' || status?.phase === 'prepared'

      // The poll is slow enough that a long segment looks frozen; a ticker keeps
      // elapsed time moving, and the expanded token counter smoother.
      React.useEffect(() => {
        if (!live) return undefined
        const timer = setInterval(() => setNow(Date.now()), expanded ? 250 : 1000)
        return () => clearInterval(timer)
      }, [live, expanded])

      React.useEffect(() => {
        const done = status?.segmentsDone
        if (!live || !Number.isInteger(done)) return undefined
        const previous = lastDone.current
        lastDone.current = done
        if (previous !== null && done > previous) {
          setFlash(true)
          const timer = setTimeout(() => setFlash(false), 300)
          return () => clearTimeout(timer)
        }
        return undefined
      }, [live, status?.segmentsDone])

      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined
        let stopped = false
        let timer
        const load = async () => {
          try {
            const response = await fetch(
              `${STATUS_URL}?sessionId=${encodeURIComponent(sessionId)}`,
              { cache: 'no-store' },
            )
            if (!response.ok) return
            const body = await response.json()
            if (!stopped) setStatus(body?.status ?? null)
          } catch {
            // A host without the status route simply renders no line.
          }
        }
        const loop = async () => {
          await load()
          if (!stopped) timer = setTimeout(loop, STATUS_POLL_MS)
        }
        loop()
        return () => {
          stopped = true
          clearTimeout(timer)
        }
      }, [sessionId])

      if (status === null || status.sessionId !== sessionId) return null
      const at = Date.parse(status.at ?? '')
      const age = Number.isFinite(at) ? Math.max(0, now - at) : 0
      if (!live && age > STATUS_HOLD_MS) return null
      if (live && age > STATUS_STALE_MS) return null

      const label = {
        running: t('statusRunning'),
        prepared: t('statusPrepared'),
        done: t('statusDone'),
        declined: t('statusDeclined'),
        cancelled: t('statusCancelled'),
      }[status.phase]
      if (label === undefined) return null

      const stalled = live && age > STATUS_STALL_MS
      const seconds = Math.floor(age / 1000)
      const from = formatTokens(status.fromTokens)
      const to = formatTokens(status.toTokens)
      const total = Number.isInteger(status.segmentsTotal) && status.segmentsTotal > 0
        ? status.segmentsTotal
        : 0
      const done = Number.isInteger(status.segmentsDone) ? status.segmentsDone : 0
      const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0

      // Cumulative output tokens are written once per finished segment. Between
      // segments the counter creeps forward at a steady pace so it shows work
      // in progress instead of freezing, and resyncs to the exact value when
      // the next segment lands. The creep is capped at roughly one segment.
      const realOutput = Number.isInteger(status.outputTokens) ? status.outputTokens : undefined
      let shownOutput = realOutput
      if (realOutput !== undefined) {
        if (realOutput < realTokens.current) {
          realTokens.current = realOutput
          realTokensAt.current = now
          shownTokens.current = realOutput
        } else if (realOutput > realTokens.current) {
          realTokens.current = realOutput
          realTokensAt.current = now
        }
        const creep = live && total > 0 && done < total
          ? Math.min(2500, Math.max(0, (now - realTokensAt.current) / 1000) * 90)
          : 0
        shownTokens.current = Math.max(shownTokens.current, realOutput + creep)
        shownOutput = Math.floor(shownTokens.current)
      }
      const count = (value) => Math.floor(value).toLocaleString('en-US')

      const parts = [label]
      if (from !== undefined && live) parts.push(`${from} → …`)
      else if (from !== undefined && to !== undefined) {
        parts.push(`${from} → ${to}`)
        if (status.toTokens < status.fromTokens) {
          parts.push(`-${Math.round((1 - status.toTokens / status.fromTokens) * 100)}%`)
        }
      }
      if (live && total > 0) parts.push(`${t('statusSeg')} ${done}/${total}`)
      if (live && Number.isInteger(status.retried) && status.retried > 0) {
        parts.push(`${t('statusRetry')} ${status.retried}`)
      }
      if (live) parts.push(`${seconds}s`)
      if (stalled) parts.push(t('statusWaiting'))
      if (!live && Number.isInteger(status.accepted)) {
        parts.push(`${status.accepted} ${t('statusEntries')}`)
      }
      if (!live && status.phase !== 'done'
          && typeof status.message === 'string' && status.message !== '') {
        parts.push(status.message.length > 60 ? `${status.message.slice(0, 60)}…` : status.message)
      }

      const dotColor = live ? '#d9822b' : (status.phase === 'done' ? '#2f9e5f' : '#9a9a9a')
      const track = live || status.phase === 'done'
        ? h('div', { style: statusStyles.track },
            h('div', {
              style: {
                ...statusStyles.fill,
                width: `${status.phase === 'done' ? 100 : percent}%`,
                background: dotColor,
              },
            }),
            live
              ? h('div', {
                  style: {
                    ...statusStyles.sweep,
                    background: `linear-gradient(90deg, transparent, ${dotColor}, transparent)`,
                    animationDuration: stalled ? '1.8s' : '0.9s',
                  },
                })
              : null,
          )
        : null

      const detail = (key, value) => value === undefined
        ? null
        : h('div', { style: statusStyles.panelRow },
            h('span', { style: statusStyles.panelKey }, key),
            h('span', { style: statusStyles.panelValue }, value))
      const details = expanded
        ? h('div', { style: statusStyles.panel },
            detail(t('statusPhase'), label),
            detail(t('statusSeg'), total > 0 ? `${done}/${total}` : undefined),
            detail(t('statusUsage'), from === undefined
              ? undefined
              : `${from} → ${to ?? '…'}`),
            detail(t('statusOutput'), shownOutput === undefined
              ? undefined
              : `${live ? '≈ ' : ''}${count(shownOutput)}`),
            detail(t('statusRetry'), Number.isInteger(status.retried) && status.retried > 0
              ? String(status.retried)
              : undefined),
            detail(t('statusEntries'), !live && Number.isInteger(status.accepted)
              ? String(status.accepted)
              : undefined),
            detail(live ? t('statusElapsed') : t('statusUpdated'), `${seconds}s`),
            typeof status.message === 'string' && status.message !== ''
              ? h('div', { style: statusStyles.panelMessage }, status.message)
              : null,
          )
        : null

      // Details open upward, above the capsule, like the todo panel; the dock
      // grows away from the composer.
      return h('div', { style: statusStyles.wrap, 'data-wsc-status': status.phase },
        details,
        h('button', {
          type: 'button',
          style: statusStyles.button,
          title: parts.join(' · '),
          'aria-expanded': expanded,
          'aria-label': `${parts.join(' · ')} (${t('statusDetails')})`,
          onClick: () => setExpanded((value) => !value),
        },
        h('div', { style: statusStyles.row },
          h('span', {
            style: {
              ...statusStyles.dot,
              background: dotColor,
              ...(live ? { animation: 'wsc-status-pulse 1.2s ease-in-out infinite' } : {}),
            },
          }),
          h('span', {
            style: { ...statusStyles.text, ...(flash ? { color: dotColor } : {}) },
          }, parts.join(' · ')),
          h('span', { style: statusStyles.chevron }, expanded ? '▾' : '▸'),
        ),
        track),
        details)
    }

    // The package is loaded through both its bundle entry and its engine
    // insert; each instance runs this client, which rendered the status line
    // and the settings page twice. One process registers once.
    const REGISTERED = '__dshWscClientRegistered'

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        if (typeof window !== 'undefined') {
          if (window[REGISTERED] === true) return
          window[REGISTERED] = true
        }
        ctx.effect(() => ctx.locale.register(NS, DICT), 'wsc: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'wsc',
              order: 25,
              label: () => t('nav'),
              locale: NS,
              inject: () => {
                let form
                try {
                  form = ctx.configForms.get(ENTRY)
                } catch {
                  form = undefined
                }
                return { form, t }
              },
            },
            Page,
          ),
        )

        // One line above the composer: compaction is a long pause, and without
        // a visible phase it looks like the model stopped responding. The dock
        // orders entries ascending; 0 puts the line on the same level as the
        // todo panel, above the goal banner (10).
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {}
          const id = 'wsc-status-keyframes'
          if (document.getElementById(id) !== null) return () => {}
          const tag = document.createElement('style')
          tag.id = id
          tag.textContent = '@keyframes wsc-status-pulse{0%,100%{opacity:.35}50%{opacity:1}}'
            + '@keyframes wsc-status-sweep{0%{transform:translateX(-110%)}'
            + '100%{transform:translateX(320%)}}'
            + '@media (prefers-reduced-motion: reduce){[data-wsc-status] *{animation:none!important}}'
          document.head.appendChild(tag)
          return () => { try { tag.remove() } catch { /* already gone */ } }
        }, 'wsc: status keyframes')

        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'wsc-status',
              order: 0,
              locale: NS,
              inject: (sessionId) => ({ sessionId, t }),
            },
            StatusLine,
          ),
        )
      },
    }
  },
})
