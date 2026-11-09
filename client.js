// 侧栏折叠 & 显示管理 · 浏览器半边
//
// 两部分能力：
//  1. 折叠：在侧栏面板列表与「工作区」之间的接缝上放一条折叠条，点一下把面板列表
//     收起，整段高度让给工作区（小屏幕的主要痛点）。
//  2. 显示管理：这个壳把插件内容同时铺在四个地方 —— 左侧面板列表、对话窗口顶部、
//     对话窗口底部、设置页。插件装多了，每一处都会挤。这里按条目控制这四处
//     显示什么。
//
// 边界（重要）：本插件只管「显示」，不管「启用」。它不会写 cordis.patch.yml、
// 不改市场状态、不卸载或禁用任何插件 —— 那些是插件市场的职责。这里隐藏一个条目
// 只是让它从界面上不出现，插件本身照常运行，随时能在这里打开。
//
// 本插件自己也遵守同一套规则：它可以在侧栏出现（面板入口 + 管理页），也可以在
// 设置页出现（一整页开关），两个位置至少保留一个 —— 全关掉就再也找不回来了。
//
// 实现要点：
//  - 折叠条是侧栏里的**真实子元素**（portal 进工作区容器，排在接缝处），不用
//    `position: fixed` 追坐标 —— 后者只是「碰巧压在缝上」，侧栏一滑动、一收进
//    抽屉就脱开浮在对话区上。
//  - 隐藏由本插件插入的样式表完成，卸载时整表撤掉；不写宿主的内联样式、不改 <html>。
//  - 槽位条目的包装元素只有 `data-slot` 与 `display:contents`，没有 id。这里把
//    「槽位#条目 id」写到包装元素自己的 data 属性上，样式表据此隐藏。条目 id 与
//    文案来自 `ctx.slots.entriesOfSlot`，不读别的插件的组件源码。
//  - 管理页是主面板里的一页，父级列容器强制 `overflow:hidden` 且自身不滚动，
//    因此这一页自己就是滚动容器（`overflow-y:auto` + 视口高度上限），否则内容一多
//    就顶出可视区、既滑不动也点不到下面。
//  - 颜色全部取宿主 --dsw-alias-* 令牌。
window.__ModuleLoader__.load({
  id: 'dsh-display-manager',
  factory: (require) => {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /* ────────────────────────────── 常量 ────────────────────────────── */

    const NS = 'display-manager'
    const STORE_KEY = 'dsh-display-manager:state/v1'
    const FOLD_STORAGE_KEY = 'dsh-display-manager:collapsed'
    /** 侧栏列容器窄于这个宽度时视为图标栏，不提供折叠条。 */
    const RAIL_MAX_WIDTH = 200
    /** 条目包装元素上的标记，样式表按它隐藏。 */
    const MARK = 'data-dshfold-id'
    /** 本插件自己的条目 id，不参与「隐藏显示」管理。 */
    const SELF_ID = 'display-manager'

    /**
     * 四个区域。
     *
     * 每个区域由两类槽位组成：
     *  - `list`：一槽多个条目，每条带自己的 id，可由 `entriesOfSlot` 枚举（命名以 `id` 为准）。
     *  - `single`：整槽只有一个控件、**没有 id**（打开右侧边栏、权限、模型选择这类），
     *    只能按槽位名识别，命名用槽位名最后一段。
     * `rowMode: 'button'` 表示条目只是按钮里的一枚图标，要连同整行按钮一起隐藏。
     */
    const REGIONS = [
      {
        key: 'panels',
        title: '左侧面板列表',
        hint: '侧栏里「插件 / 插件市场 / 任务看板 …」这些入口',
        slots: [{ slot: 'sidebar.panellist', kind: 'list' }],
        rowMode: 'button',
      },
      {
        key: 'header',
        title: '对话窗口顶部',
        hint: '会话标题旁的操作、右端工具与角落按钮',
        slots: [
          { slot: 'conversation.session.header.actions', kind: 'list' },
          { slot: 'conversation.session.header.utilities', kind: 'list' },
          { slot: 'conversation.session.header.corner', kind: 'single' },
          { slot: 'conversation.session.header.lineage', kind: 'single' },
          { slot: 'conversation.header.leading', kind: 'single' },
        ],
        rowMode: 'wrapper',
      },
      {
        key: 'views',
        title: '对话窗口标签栏',
        hint: '「对话 / 轨迹 / 上下文 / 编队」这一排视图切换按钮',
        // 这一排不是某个插件的槽位条目，而是宿主按 `conversation.view` 的注册
        // 渲染出来的标签页。因此枚举条目用槽位，标记落点按标签文字对齐。
        slots: [{ slot: 'conversation.view', kind: 'tabs' }],
        rowMode: 'wrapper',
      },
      {
        key: 'footer',
        title: '对话窗口底部',
        hint: '输入框左右的控件、框上方与下方的附加条',
        slots: [
          { slot: 'conversation.input.left', kind: 'list' },
          { slot: 'conversation.input.right', kind: 'list' },
          { slot: 'conversation.input.dock', kind: 'list' },
          { slot: 'conversation.composer.dock', kind: 'list' },
          { slot: 'conversation.input.permission', kind: 'single' },
          { slot: 'conversation.input.model', kind: 'single' },
          { slot: 'conversation.input.plan', kind: 'single' },
          { slot: 'conversation.input.activity', kind: 'single' },
          { slot: 'conversation.input.attachments', kind: 'single' },
        ],
        rowMode: 'wrapper',
      },
      {
        key: 'settings',
        title: '设置页',
        hint: '设置左侧那串分区',
        slots: [{ slot: 'settings.section', kind: 'list' }],
        rowMode: 'wrapper',
        // 设置左侧的导航行由宿主按分区注册渲染，它不是槽位包装元素（没有
        // data-slot），只能靠「文字与条目文案完全相同」认领。
        navLabels: true,
      },
    ]

    /* ────────────────────────────── 文案 ────────────────────────────── */

    const DICT = {
      zh: {
        'grip.collapse': '收起上方面板',
        'grip.expand': '展开上方面板',
        'grip.collapseHint': '收起面板列表，把高度让给工作区',
        'grip.expandHint': '展开面板列表',
        'panel.title': '显示管理',
        'panel.sub': '选择这些地方显示什么。这里只控制「显示」，不启用或停用插件；被关掉的条目随时能在这里打开。',
        'panel.empty': '这个区域目前没有可管理的条目。',
        'panel.self': '本插件的位置',
        'panel.selfHint': '两个位置至少保留一个。',
        'panel.inSidebar': '显示在侧栏',
        'panel.inSettings': '显示在设置页',
        'panel.keepOne': '至少保留一个位置：先打开另一个，再关这个。',
        'panel.hiddenCount': '{0} 项已隐藏',
        'panel.showAll': '全部显示',
        'panel.hideAll': '全部隐藏',
        'panel.unknown': '未命名条目',
        'panel.singleTag': '单例控件',
        'panel.notHideable': '暂不可隐藏',
        'panel.notHideableHint': '这一组控件在当前布局里共用同一个容器，分不出哪个是哪个，所以暂时无法单独隐藏。',
        'settings.section': '显示管理',
        'settings.title': '这些地方显示什么',
        'settings.desc': '插件装得越多，侧栏、对话窗口上下方和设置页越挤。这里按条目关掉不需要的显示；不会启用或停用插件。',
      },
      en: {
        'grip.collapse': 'Collapse the panel list',
        'grip.expand': 'Expand the panel list',
        'grip.collapseHint': 'Hide the panel list to give the workspaces region its height',
        'grip.expandHint': 'Show the panel list',
        'panel.title': 'What shows where',
        'panel.sub': 'Choose what appears in each place. This only controls visibility — it never enables or disables a plugin. Anything you hide can be restored here.',
        'panel.empty': 'Nothing to manage in this region yet.',
        'panel.self': 'This plugin',
        'panel.selfHint': 'Keep at least one of its two places.',
        'panel.inSidebar': 'Show in the sidebar',
        'panel.inSettings': 'Show in Settings',
        'panel.keepOne': 'Keep at least one place: turn the other on first.',
        'panel.hiddenCount': '{0} hidden',
        'panel.showAll': 'Show all',
        'panel.hideAll': 'Hide all',
        'panel.unknown': 'Unnamed entry',
        'panel.singleTag': 'single control',
        'panel.notHideable': 'cannot hide yet',
        'panel.notHideableHint': 'These controls share one container in the current layout, so they cannot be told apart and hidden individually.',
        'settings.section': 'What shows where',
        'settings.title': 'What shows where',
        'settings.desc': 'The more plugins you install, the busier the sidebar, the composer area and Settings get. Hide what you do not need — this never enables or disables a plugin.',
      },
    }

    /* ────────────────────────────── 样式 ────────────────────────────── */

    const BASE_CSS = `
/* 折叠条是侧栏布局里的一个真实项：插在面板列表与工作区之间的接缝上，
   跟着侧栏一起位移、裁切、收进抽屉。不再 fixed 浮在视口上。 */
.dshsf-seat {
  flex: none;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  height: 18px;
  /* 座位是侧栏列的直接子项，和面板列表共用同一个内容盒，左右天然对齐；
     它占的是面板列表 margin-bottom 让出的那道缝，因此不再另加外边距。 */
  margin: 0;
  padding: 0;
  overflow: hidden;
}
/* 折叠条被卸下（窄图标栏）时容器是空的，别在侧栏里留一道空隙。 */
.dshsf-seat:empty { display: none; }
.dshsf-grip {
  z-index: 1;
  box-sizing: border-box;
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  height: 18px;
  margin: 0;
  padding: 0 4px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  cursor: pointer;
  pointer-events: auto;
  -webkit-app-region: no-drag;
  transition: color 120ms ease;
}
.dshsf-grip:hover { color: var(--dsw-alias-label-primary); }
.dshsf-grip:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 40%, transparent); }
.dshsf-grip > .dshsf-line {
  flex: 1 1 auto; height: 1px; border-radius: 1px;
  background: var(--dsw-alias-border-l1); opacity: .5;
  transition: opacity 120ms ease;
}
.dshsf-grip:hover > .dshsf-line { opacity: 1; }
.dshsf-grip > .dshsf-chip {
  display: flex; align-items: center; justify-content: center; flex: none;
  width: 18px; height: 18px; border-radius: 9px; opacity: .8;
  transition: background-color 120ms ease, opacity 120ms ease;
}
.dshsf-grip:hover > .dshsf-chip { opacity: 1; background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 12%, transparent)); }
.dshsf-grip svg { display: block; pointer-events: none; }

/* 两处宿主给的容器不一样，高度都由它们决定，这里不要写死数：
   - 主面板：AppFrame 的网格行 minmax(0,1fr)，底下还有一行输入区。这一页是列向
     flex 的孩子，靠 flex:1 + min-height:0 撑满并自己滚。
   - 设置弹窗：外层 .options 已经是滚动容器，也没有 flex 上下文；这里退化成普通
     块级流，靠内容撑高，由外层统一滚 —— 再套一层带高度的滚动容器会把底部裁掉。
   因此只声明「可以滚」和「允许被压缩」，不声明具体高度。 */
.dshsf-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: 16px 20px 28px;
  color: var(--dsw-alias-label-primary);
}
.dshsf-root { display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 780px; font-size: 13px; }
.dshsf-head { display: flex; flex-direction: column; gap: 4px; }
.dshsf-title { font-size: 15px; font-weight: 600; margin: 0; }
.dshsf-sub { color: var(--dsw-alias-label-secondary); margin: 0; line-height: 1.55; }
.dshsf-group { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.dshsf-groupHead { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 10px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshsf-groupTitle { font-weight: 600; }
.dshsf-groupHint { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dshsf-groupActions { margin-left: auto; display: flex; gap: 6px; align-items: center; }
.dshsf-row { display: flex; align-items: center; gap: 10px; padding: 8px 14px; }
.dshsf-row + .dshsf-row { border-top: 1px solid var(--dsw-alias-border-l1); }
.dshsf-rowLabel { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshsf-rowId { color: var(--dsw-alias-label-secondary); font-size: 11.5px; margin-left: 6px; }
.dshsf-empty { padding: 12px 14px; color: var(--dsw-alias-label-secondary); }
.dshsf-btn {
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent; color: var(--dsw-alias-label-primary);
  border-radius: 7px; padding: 3px 9px; font: inherit; font-size: 12px; cursor: pointer;
}
.dshsf-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.dshsf-btn[disabled] { opacity: .45; cursor: not-allowed; }
.dshsf-switch {
  flex: none; position: relative; width: 34px; height: 20px; padding: 0;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  background: transparent; cursor: pointer; transition: background-color 140ms ease, border-color 140ms ease;
}
.dshsf-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dshsf-switch:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); }
.dshsf-switch > .dshsf-knob {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
  transition: transform 140ms ease, border-color 140ms ease;
}
.dshsf-switch[aria-checked="true"] > .dshsf-knob { transform: translateX(14px); border-color: transparent; background: #fff; }
.dshsf-note { color: var(--dsw-alias-state-warn-primary); font-size: 12px; }
`

    /**
     * 单例槽位的可读文案。这些槽位没有注册项 id，文案只能由本插件给。
     * 名称取该控件在界面上的实际作用，不用槽位全名。
     */
    const SINGLE_LABELS = {
      'conversation.session.header.corner': ['右上角按钮', 'Header corner'],
      'conversation.session.header.lineage': ['标题面包屑', 'Title breadcrumb'],
      'conversation.header.leading': ['头部前置导航', 'Header leading nav'],
      'conversation.input.permission': ['访问模式（权限）', 'Access mode (permission)'],
      'conversation.input.model': ['模型选择', 'Model picker'],
      'conversation.input.plan': ['计划控制', 'Plan control'],
      'conversation.input.activity': ['运行状态', 'Activity'],
      'conversation.input.attachments': ['附件栏', 'Attachment rail'],
    }

    /** 当前界面语言是否为英文。 */
    function isEnglish(ctx) {
      try {
        const snapshot = ctx.locale.getSnapshot()
        const active = snapshot?.active ?? document.documentElement.lang
        return /^en\b/i.test(String(active))
      } catch {
        return false
      }
    }

    /** 取单例槽位的文案。 */
    function singleLabel(ctx, slot) {
      const pair = SINGLE_LABELS[slot]
      if (pair === undefined) return slot.split('.').slice(-1)[0]
      return isEnglish(ctx) ? pair[1] : pair[0]
    }

    function defaultState() {
      return {
        /** 侧栏出现本插件入口与管理页。 */
        inSidebar: true,
        /** 设置页出现本插件分区。 */
        inSettings: true,
        /** 被隐藏的条目，键为「槽位#条目 id」。 */
        hidden: {},
      }
    }

    function loadState() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY)
        if (raw === null) return defaultState()
        const parsed = JSON.parse(raw)
        return {
          ...defaultState(),
          inSidebar: parsed.inSidebar !== false,
          inSettings: parsed.inSettings !== false,
          hidden: parsed.hidden && typeof parsed.hidden === 'object' ? parsed.hidden : {},
        }
      } catch {
        return defaultState()
      }
    }

    function saveState(state) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(state))
      } catch {
        /* 隐私模式下写不进去，只影响下次打开 */
      }
    }

    /** 极简快照 store：订阅者拿最新状态，写入后通知。 */
    function createStore(initial) {
      let current = initial
      const listeners = new Set()
      return {
        get: () => current,
        set(next) {
          current = next
          saveState(current)
          for (const listener of listeners) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    /* ─────────────────────────── 槽位条目读取 ─────────────────────────── */

    /** 解析槽位注册的可读文案。label 可以是字符串或 thunk。 */
    function resolveLabel(options) {
      const raw = options?.label
      if (typeof raw === 'function') {
        try {
          const value = raw()
          if (typeof value === 'string' && value !== '') return value
        } catch {
          /* 取文案失败时退回 id */
        }
      }
      if (typeof raw === 'string' && raw !== '') return raw
      const id = options?.id
      return typeof id === 'string' ? id : ''
    }

    /**
     * 读一个区域当前所有条目：list 按 id 枚举，single 按槽位名各算一项。
     * @returns [{ token, id, label, slot, kind }]，token 是写进 DOM 的稳定键。
     */
    function regionEntries(ctx, region) {
      const out = []
      for (const { slot, kind } of region.slots) {
        if (kind === 'single') {
          // 单例槽位没有注册项 id，用槽位名最后一段做标识；文案由本插件给。
          let entries = []
          try {
            entries = ctx.slots.entriesOfSlot(slot)
          } catch {
            entries = []
          }
          // 只有真被占用时才列出来：空槽位列进去点了也没有任何变化。
          if (entries.length > 0) {
            const short = slot.split('.').slice(-1)[0]
            out.push({ token: `${slot}#${short}`, id: short, slot, kind, label: singleLabel(ctx, slot) })
          }
          continue
        }

        let entries = []
        try {
          entries = ctx.slots.entriesOfSlot(slot)
        } catch {
          entries = []
        }
        for (const entry of entries ?? []) {
          const options = entry?.options ?? entry
          const id = typeof options?.id === 'string' ? options.id : null
          if (id === null) continue
          out.push({
            token: `${slot}#${id}`,
            id,
            slot,
            kind,
            label: resolveLabel(options) || id,
          })
        }
      }
      return out
    }
    /**
     * 一个区域里可被隐藏的条目。
     *
     * 本插件自己的入口一律排除：它出现在侧栏（管理页）与设置页（这一页）两处，
     * 位置由上面「本插件的位置」两个开关管理。要是也列进这里，用户就能在自己
     * 的页面里把入口藏掉，然后没有任何地方能再打开 —— 那正是要避免的死路。
     */
    function manageableEntries(ctx, region) {
      return regionEntries(ctx, region).filter((entry) => entry.id !== SELF_ID)
    }

    /* ───────────────────────────── 折叠条 ───────────────────────────── */

    function boxOf(el) {
      if (el === null) return null
      let box = el.getBoundingClientRect()
      if (box.width === 0 && box.height === 0 && el.firstElementChild !== null) {
        box = el.firstElementChild.getBoundingClientRect()
      }
      return box.width > 0 && box.height > 0 ? box : null
    }

    /**
     * 折叠条要住进的那一格：侧栏里包住「工作区」槽位的那个 flex 列。
     *
     * 只在它自己的布局里找位置 —— 折叠条插进去当第一个孩子，正好落在面板列表
     * 与工作区之间的接缝上。它于是跟着侧栏一起位移/裁切/收进抽屉，任何视口宽度
     * 都不会脱开；也不再需要读矩形去摆 `left/top`。
     *
     * 返回的是本插件自己的容器，不是宿主那个列：容器由这里创建、只挂在宿主列下
     * 当布局项，React 只管容器内部。宿主重排自己的孩子时不会碰到我们，我们也不
     * 参与宿主的 diff。
     */
    const SEAT_ATTR = 'data-dsh-display-manager-seat'

    function ensureSeat() {
      // 槽位包装元素是 display:contents，它的父元素是「工作区」那一格，
      // 再往上是侧栏的列容器 —— 面板列表和「工作区」都是这个列的直接子项。
      const region = document.querySelector('[data-slot="sidebar.workspaces"]')
      const area = region?.parentElement ?? null
      const column = area?.parentElement ?? null
      if (!(area instanceof HTMLElement) || !(column instanceof HTMLElement)) return null
      let seat = column.querySelector(`:scope > [${SEAT_ATTR}]`)
      if (seat === null) {
        seat = document.createElement('div')
        seat.setAttribute(SEAT_ATTR, '')
        seat.className = 'dshsf-seat'
        // 插在「工作区」那一格前面 = 面板列表与工作区之间的接缝。
        // 只插一次，之后由 MutationObserver 在它被宿主重排掉时补回来。
        column.insertBefore(seat, area)
      }
      return seat
    }

    function dropSeat(seat) {
      seat?.remove()
    }

    /**
     * 折叠条该不该出现：侧栏列窄于 RAIL_MAX_WIDTH 时是图标栏（或抽屉已收起），
     * 没有面板列表可折叠，整条不出现。这里只量宽度做显隐判断，不参与定位。
     */
    function seamVisible() {
      const column = document.querySelector('[data-slot="sidebar"] > div')
      const box = boxOf(column)
      return box !== null && box.width >= RAIL_MAX_WIDTH
    }

    function FoldGrip({ t }) {
      const [folded, setFolded] = React.useState(() => {
        try {
          return window.localStorage.getItem(FOLD_STORAGE_KEY) === '1'
        } catch {
          return false
        }
      })
      const [seat, setSeat] = React.useState(null)
      const [visible, setVisible] = React.useState(false)

      React.useEffect(() => {
        if (!folded) return undefined
        const tag = document.createElement('style')
        tag.setAttribute('data-plugin', 'dsh-display-manager')
        tag.textContent = '[data-slot="sidebar"] > div > nav { display: none !important; }'
        document.head.appendChild(tag)
        return () => tag.remove()
      }, [folded])

      React.useEffect(() => {
        try {
          window.localStorage.setItem(FOLD_STORAGE_KEY, folded ? '1' : '0')
        } catch {
          /* 忽略 */
        }
      }, [folded])

      // 座位只在挂载时建一次，不随折叠状态重建 —— 否则每次点折叠条都会先
      // 拆掉容器、portal 落进游离节点，闪一下再挂回去。
      React.useEffect(() => {
        let frame = 0
        let seat = null
        const read = () => {
          frame = 0
          const shown = seamVisible()
          if (!shown) {
            dropSeat(seat)
            seat = null
          } else if (seat === null || !seat.isConnected) {
            seat = ensureSeat()
          }
          setSeat((current) => (current === seat ? current : seat))
          const live = shown && seat !== null
          setVisible((current) => (current === live ? current : live))
        }
        const schedule = () => {
          if (frame === 0) frame = window.requestAnimationFrame(read)
        }
        schedule()
        const observer = new ResizeObserver(schedule)
        for (const node of document.querySelectorAll('[data-slot="sidebar"], [data-slot="sidebar"] > div, [data-slot="sidebar"] > div nav, [data-slot="sidebar.workspaces"]')) {
          observer.observe(node)
        }
        const mutations = new MutationObserver(schedule)
        const slot = document.querySelector('[data-slot="sidebar"]')
        if (slot !== null) mutations.observe(slot, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-sidebar-collapsed'] })
        window.addEventListener('resize', schedule)
        return () => {
          if (frame !== 0) window.cancelAnimationFrame(frame)
          observer.disconnect()
          mutations.disconnect()
          window.removeEventListener('resize', schedule)
          dropSeat(seat)
          seat = null
        }
      }, [])

      if (seat === null || !visible) return null
      const label = folded ? t('grip.expand') : t('grip.collapse')
      // 只挂进本插件自己的座位容器：宿主不 diff 它，也不再需要任何坐标。
      return ReactDOM.createPortal(h('button', {
        type: 'button',
        className: 'dshsf-grip',
        'data-dsh-display-manager-grip': '',
        'aria-expanded': !folded,
        'aria-label': label,
        title: folded ? t('grip.expandHint') : t('grip.collapseHint'),
        onClick: () => setFolded((value) => !value),
      }, [
        h('span', { key: 'l', className: 'dshsf-line', 'aria-hidden': 'true' }),
        h('span', { key: 'c', className: 'dshsf-chip', 'aria-hidden': 'true' },
          h('svg', {
            width: 11, height: 11, viewBox: '0 0 12 12', fill: 'none',
            stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
          }, h('path', { d: folded ? 'M3 4.5L6 7.5L9 4.5' : 'M3 7.5L6 4.5L9 7.5' }))),
        h('span', { key: 'r', className: 'dshsf-line', 'aria-hidden': 'true' }),
      ]), seat)
    }

    /* ─────────────────────────── 显示标记与样式 ─────────────────────────── */

    /**
     * 从一棵 DOM 子树里认出「这是哪个槽位条目」。
     *
     * 槽位条目的包装元素只有 `data-slot`，没有 id；而且同一槽位的多个条目会被
     * 渲染进**同一个容器**（`header.actions` 就是这样：4 个条目、3 个 DOM 节点，
     * 中间还夹着宿主自己的控件），靠下标对齐根本对不上。
     *
     * 但宿主渲染每条时都会经过一个带 `entry.options.id` 的组件，那个组件在
     * React fiber 树上。于是沿 fiber 的 return 链往上找，命中
     * `props.entry.options.id` 就拿到了这条的真实 id —— 精确、与顺序无关，
     * 也不需要读别的插件的组件源码。
     */
    function fiberOf(el) {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
      return key === undefined ? null : el[key]
    }

    function entryIdOf(el) {
      let fiber = fiberOf(el)
      let guard = 0
      while (fiber !== null && guard < 16) {
        const props = fiber.memoizedProps
        const id = props?.entry?.options?.id
        if (typeof id === 'string') return { id, slot: props?.slotKey ?? null }
        fiber = fiber.return
        guard += 1
      }
      return null
    }

    /**
     * 把一个区域里的条目与真实 DOM 对上，并把条目身份写到 DOM 上。
     *
     * 三条路径，按可靠性排序：
     *  1. `kind: 'single'`：整槽一个控件，按槽位名标记。
     *  2. fiber 认领：每个候选节点沿 fiber 链找到自己的 `entry.options.id`，
     *     精确匹配。这是主路径，`header.actions` / `composer.dock` 这类
     *     「多条目挤一个容器」的情况靠它解决。
     *  3. 兜底：fiber 认不出来时（例如非 React 渲染的宿主控件，或设置页里
     *     那排独立导航按钮），退回到「数量严格一致 + 文字/Aria 精确匹配」。
     *     仍然认不出就不标记 —— 宁可这一项暂时隐藏不了，也不能把标记打到
     *     宿主自己的控件上（那会藏掉「更多操作」这种必要按钮）。
     *
     * @returns 该区域内「确实能隐藏」的条目 token 集合，管理页据此启用/禁用开关。
     */
    function markRegion(ctx, region, result) {
      const entries = regionEntries(ctx, region)
      for (const { slot, kind } of region.slots) {
        const wrappers = Array.from(document.querySelectorAll(`[data-slot="${slot}"]`))
        const slotEntries = entries.filter((entry) => entry.slot === slot)

        if (kind === 'single') {
          if (wrappers.length === 0 || slotEntries.length === 0) continue
          const wrapper = wrappers[0]
          const target = region.rowMode === 'button' ? (wrapper.closest('button') ?? wrapper) : wrapper
          if (target.getAttribute(MARK) !== slotEntries[0].token) {
            target.setAttribute(MARK, slotEntries[0].token)
          }
          result.ok.add(slotEntries[0].token)
          continue
        }

        // 标签栏这类槽位：包装元素里没有条目，条目是宿主按注册渲染的标签页。
        if (kind === 'tabs') {
          markTabs(ctx, slot, slotEntries, result.ok)
          continue
        }

        if (slotEntries.length === 0) continue

        // 设置页：导航行不在槽位包装元素里（包装元素只承载「当前选中那页」的内容），
        // 所以除了按包装元素标记内容区，还要按文字认领导航行。
        if (region.navLabels) markSettingsNav(ctx, slot, slotEntries, result.ok)

        // 这个区域当前没渲染（例如管理页占着主区域），就什么都不判定：条目留在
        // 「未观测」状态，管理页据此仍然允许操作 —— 隐藏会在下次渲染时生效。
        if (wrappers.length === 0) continue

        // 候选落点：槽位包装元素的直接子元素（没有子元素时就是包装元素自己）。
        // 注意 `composer.dock` 这类：多个条目直接是包装元素的孩子。
        const candidates = []
        for (const wrapper of wrappers) {
          if (wrapper.children.length === 0) candidates.push(wrapper)
          else candidates.push(...Array.from(wrapper.children))
        }

        // 主路径：按 fiber 上的真实条目 id 认领。
        let claimed = 0
        for (const candidate of candidates) {
          const info = entryIdOf(candidate)
          if (info === null || info.slot !== slot) continue
          const entry = slotEntries.find((item) => item.id === info.id)
          if (entry === undefined) continue
          const host = region.rowMode === 'button' ? (candidate.closest('button') ?? candidate) : candidate
          if (host.getAttribute(MARK) !== entry.token) host.setAttribute(MARK, entry.token)
          result.ok.add(entry.token)
          claimed += 1
        }
        if (claimed > 0) continue

        // 兜底：fiber 认不出来时，数量严格一一对应才按下标标记。
        if (candidates.length === slotEntries.length) {
          candidates.forEach((candidate, index) => {
            const entry = slotEntries[index]
            if (entry === undefined) return
            const host = region.rowMode === 'button' ? (candidate.closest('button') ?? candidate) : candidate
            if (host.getAttribute(MARK) !== entry.token) host.setAttribute(MARK, entry.token)
            result.ok.add(entry.token)
          })
          continue
        }

        // 最后兜底：只按 aria-label / 文字精确匹配，匹配上的才标记。
        const remaining = [...slotEntries]
        const labelOf = (target) => target.getAttribute?.('aria-label')
          ?? target.querySelector?.('[aria-label]')?.getAttribute('aria-label')
          ?? target.innerText?.replace(/\s+/g, ' ').trim()
          ?? ''
        for (const candidate of candidates) {
          const label = labelOf(candidate)
          if (label === '') continue
          const hit = remaining.find((entry) => entry.label === label)
          if (hit === undefined) continue
          const host = region.rowMode === 'button' ? (candidate.closest('button') ?? candidate) : candidate
          if (host.getAttribute(MARK) !== hit.token) host.setAttribute(MARK, hit.token)
          result.ok.add(hit.token)
          remaining.splice(remaining.indexOf(hit), 1)
        }
      }
    }

    /**
     * 视图标签栏：`conversation.view` 的条目由宿主渲染成一排 `<button role="tab">`，
     * 按钮本身不在槽位包装元素里。tab 的 React key 就是视图 id，按它对上。
     */
    function markTabs(ctx, slot, slotEntries, markable) {
      const tabs = Array.from(document.querySelectorAll('button[role="tab"]'))
        .filter((tab) => tab.closest('[data-slot="conversation.session.header"]') !== null)
      if (tabs.length === 0) return
      for (const tab of tabs) {
        const key = fitsTabId(tab)
        if (key === null) continue
        const entry = slotEntries.find((item) => item.id === key)
        if (entry === undefined) continue
        if (tab.getAttribute(MARK) !== entry.token) tab.setAttribute(MARK, entry.token)
        markable.add(entry.token)
      }
    }

    /** 视图标签按钮的 React key，就是该视图注册时的 id（chat / trajectory / …）。 */
    function fitsTabId(tab) {
      let fiber = fiberOf(tab)
      let guard = 0
      while (fiber !== null && guard < 6) {
        if (typeof fiber.key === 'string' && fiber.key !== '' && fiber.key !== 'null') return fiber.key
        fiber = fiber.return
        guard += 1
      }
      return null
    }

    /**
     * 设置页左侧导航。
     *
     * 这一排不是槽位包装元素：宿主按 `settings.section` 的注册渲染成普通按钮，
     * 按钮上没有 `data-slot`，fiber 上也拿不到 entry（导航和内容是分开渲染的）。
     * 唯一可靠的对照是与条目的 display label 完全相同。认不出的一律不动。
     */
    function markSettingsNav(ctx, slot, slotEntries, markable) {
      const dialog = document.querySelector('[role="dialog"]')
      if (dialog === null) return
      const known = new Set()
      for (const entry of slotEntries) {
        for (const text of [entry.label, entry.id]) if (text !== '') known.add(text)
      }
      const buttons = Array.from(dialog.querySelectorAll('button'))
      for (const button of buttons) {
        // 只要导航行：撑满一行、左对齐、没有 aria-haspopup 的那类。
        if (button.closest('[data-slot]') !== null) continue
        const text = button.innerText?.replace(/\s+/g, ' ').trim() ?? ''
        if (text === '' || text.length > 24 || !known.has(text)) continue
        const entry = slotEntries.find((item) => item.label === text || item.id === text)
        if (entry === undefined) continue
        if (button.getAttribute(MARK) !== entry.token) button.setAttribute(MARK, entry.token)
        markable.add(entry.token)
      }
    }

    /**
     * 当前能隐藏的条目 token；只有「该区域确实渲染过」时才判定。
     *
     * 这里不能把「没标记上」直接当成「藏不了」：管理页占着主区域时，会话头部/
     * 底部/标签栏根本没渲染，此时所有条目都会「没标记上」。因此额外记一份
     * `observed` —— 该区域这一轮真的渲染过。管理页只看这两个集合的交集：
     *  - 在 `observed` 且在 `ok`：可隐藏，开关可用；
     *  - 在 `observed` 但不在 `ok`：这一组真的分不出来，开关置灰并说明；
     *  - 不在 `observed`：当前没渲染，仍然允许操作（隐藏后在会话里生效）。
     */
    const markableTokens = new Set()
    const observedTokens = new Set()
    /** 标记变化后通知管理页重渲染用的回调集合。 */
    const markerListeners = new Set()

    function markAll(ctx) {
      const result = { ok: new Set() }

      // 哪些区域这一轮真的渲染了：以「槽位包装元素存在」为准。
      const renderedRegions = new Set()
      for (const region of REGIONS) {
        for (const { slot, kind } of region.slots) {
          if (kind === 'tabs') {
            if (document.querySelector('[data-slot="conversation.session.header"]') !== null) renderedRegions.add(region.key)
            continue
          }
          if (document.querySelector(`[data-slot="${slot}"]`) !== null) {
            renderedRegions.add(region.key)
          }
        }
      }

      for (const region of REGIONS) {
        try {
          markRegion(ctx, region, result)
        } catch (error) {
          console.error('[display-manager] marking', region.key, 'failed', error)
        }
      }

      const before = markableTokens.size + ':' + observedTokens.size
      markableTokens.clear()
      observedTokens.clear()
      for (const token of result.ok) markableTokens.add(token)
      // 只为「确实渲染过」的区域登记观测结果。
      for (const region of REGIONS) {
        if (!renderedRegions.has(region.key)) continue
        for (const entry of regionEntries(ctx, region)) observedTokens.add(entry.token)
      }
      if (before !== markableTokens.size + ':' + observedTokens.size) {
        for (const listener of markerListeners) listener()
      }
    }

    /** 生成隐藏样式：被隐藏的条目一条 `display:none`。 */
    function hiddenCss(state) {
      const tokens = new Set()
      for (const list of Object.values(state.hidden)) {
        for (const token of list) tokens.add(token)
      }
      if (tokens.size === 0) return ''
      const rules = []
      for (const token of tokens) {
        const escaped = String(token).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        rules.push(`[${MARK}="${escaped}"] { display: none !important; }`)
      }
      return rules.join('\n')
    }

    /* ─────────────────────────── 管理页与设置分区 ─────────────────────────── */

    function Switch({ checked, onChange, label, disabled }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        className: 'dshsf-switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        title: label,
        disabled: disabled ? true : undefined,
        onClick: onChange,
      }, h('span', { className: 'dshsf-knob', 'aria-hidden': 'true' }))
    }

    /**
     * 管理页本体：四个区域 + 本插件自身位置。
     * 设置页那一份也是这个组件 —— 用户点开设置就能操作，不必先跳主面板。
     */
    function ManagerBody({ ctx, store, t }) {
      const [, force] = React.useState(0)
      const [notice, setNotice] = React.useState('')
      // 语言切换后重渲染，文案跟着变。
      // 订阅 store 与标记结果：位置或可隐藏集合变了都要重渲染。
      React.useEffect(() => store.subscribe(() => force((n) => n + 1)), [store])
      React.useEffect(() => {
        const listener = () => force((n) => n + 1)
        markerListeners.add(listener)
        return () => {
          markerListeners.delete(listener)
        }
      }, [])
      React.useEffect(() => {
        if (notice === '') return undefined
        const timer = window.setTimeout(() => setNotice(''), 3500)
        return () => window.clearTimeout(timer)
      }, [notice])

      const state = store.get()
      const hiddenSet = new Set(Object.values(state.hidden).flat())
      const isHidden = (token) => hiddenSet.has(token)

      const commit = (next) => store.set(next)

      const toggleEntry = (token) => {
        const all = new Set(hiddenSet)
        if (all.has(token)) all.delete(token)
        else all.add(token)
        commit({ ...state, hidden: { all: [...all] } })
      }

      const setRegion = (region, hideAll) => {
        const all = new Set(hiddenSet)
        for (const entry of manageableEntries(ctx, region)) {
          if (hideAll) all.add(entry.token)
          else all.delete(entry.token)
        }
        commit({ ...state, hidden: { all: [...all] } })
      }

      /** 本插件的位置：两个都关掉会把入口彻底藏起来，所以拦住最后一个。 */
      const setOwn = (key) => {
        const nextSidebar = key === 'inSidebar' ? !state.inSidebar : state.inSidebar
        const nextSettings = key === 'inSettings' ? !state.inSettings : state.inSettings
        if (!nextSidebar && !nextSettings) {
          setNotice(t('panel.keepOne'))
          return
        }
        commit({ ...state, inSidebar: nextSidebar, inSettings: nextSettings })
      }

      return h('div', { className: 'dshsf-root' }, [
        h('div', { key: 'head', className: 'dshsf-head' }, [
          h('h2', { key: 't', className: 'dshsf-title' }, t('panel.title')),
          h('p', { key: 's', className: 'dshsf-sub' }, t('panel.sub')),
        ]),

        h('section', { key: 'self', className: 'dshsf-group' }, [
          h('div', { key: 'h', className: 'dshsf-groupHead' }, [
            h('span', { key: 't', className: 'dshsf-groupTitle' }, t('panel.self')),
            h('span', { key: 'x', className: 'dshsf-groupHint' }, t('panel.selfHint')),
            notice !== '' ? h('span', { key: 'n', className: 'dshsf-groupActions dshsf-note' }, notice) : null,
          ]),
          h('div', { key: 'a', className: 'dshsf-row' }, [
            h('span', { key: 'l', className: 'dshsf-rowLabel' }, t('panel.inSidebar')),
            h(Switch, {
              key: 's',
              checked: state.inSidebar,
              label: t('panel.inSidebar'),
              onChange: () => setOwn('inSidebar'),
            }),
          ]),
          h('div', { key: 'b', className: 'dshsf-row' }, [
            h('span', { key: 'l', className: 'dshsf-rowLabel' }, t('panel.inSettings')),
            h(Switch, {
              key: 's',
              checked: state.inSettings,
              label: t('panel.inSettings'),
              onChange: () => setOwn('inSettings'),
            }),
          ]),
        ]),

        ...REGIONS.map((region) => {
          const entries = manageableEntries(ctx, region)
          const hiddenCount = entries.filter((entry) => isHidden(entry.token)).length
          // 只有「这一区域当前确实渲染过、但这条确实没对上 DOM」才判定为不可隐藏
          // （多个条目挤在同一个容器里、分不出谁是谁）。区域没渲染时不判定 ——
          // 用户仍然可以关掉，隐藏会在会话里生效。
          const canHide = (entry) => !observedTokens.has(entry.token) || markableTokens.has(entry.token)
          const hideable = entries.filter(canHide)
          return h('section', { key: region.key, className: 'dshsf-group' }, [
            h('div', { key: 'h', className: 'dshsf-groupHead' }, [
              h('span', { key: 't', className: 'dshsf-groupTitle' }, region.title),
              h('span', { key: 'x', className: 'dshsf-groupHint' }, region.hint),
              h('span', { key: 'a', className: 'dshsf-groupActions' }, [
                hiddenCount > 0
                  ? h('span', { key: 'c', className: 'dshsf-groupHint' }, t('panel.hiddenCount').replace('{0}', String(hiddenCount)))
                  : null,
                h('button', {
                  key: 'all',
                  type: 'button',
                  className: 'dshsf-btn',
                  disabled: hideable.length === 0,
                  onClick: () => setRegion(region, false),
                }, t('panel.showAll')),
                h('button', {
                  key: 'none',
                  type: 'button',
                  className: 'dshsf-btn',
                  disabled: hideable.length === 0,
                  onClick: () => setRegion(region, true),
                }, t('panel.hideAll')),
              ]),
            ]),
            entries.length === 0
              ? h('div', { key: 'e', className: 'dshsf-empty' }, t('panel.empty'))
              : entries.map((entry) => h('div', { key: entry.token, className: 'dshsf-row' }, [
                h('span', { key: 'l', className: 'dshsf-rowLabel' }, [
                  entry.label,
                  // list 条目显示注册 id；single 条目没有 id，显示位置标记，
                  // 让「同一区域里不同槽位」也能分辨。
                  h('span', { key: 'id', className: 'dshsf-rowId' },
                    entry.kind === 'single' ? t('panel.singleTag') : entry.id),
                ]),
                canHide(entry)
                  ? null
                  : h('span', { key: 'why', className: 'dshsf-rowId', title: t('panel.notHideableHint') }, t('panel.notHideable')),
                h(Switch, {
                  key: 's',
                  checked: !isHidden(entry.token),
                  label: canHide(entry) ? entry.label : `${entry.label} — ${t('panel.notHideableHint')}`,
                  disabled: !canHide(entry),
                  onChange: () => toggleEntry(entry.token),
                }),
              ])),
          ])
        }),
      ])
    }

    /** 侧栏打开的管理页：外面套一层自己的滚动容器。 */
    function ManagerPage({ ctx, store, t }) {
      return h('div', { className: 'dshsf-page' }, h(ManagerBody, { ctx, store, t }))
    }

    /** 设置页里的一整页：同样直接可操作。 */
    function SettingsSection({ ctx, store, t }) {
      return h('div', { className: 'dshsf-page' }, h(ManagerBody, { ctx, store, t }))
    }

    /* ───────────────────────────── 入口图标 ───────────────────────────── */

    function PanelIcon(props) {
      const size = (props && props.size) || 18
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, [
        h('path', { key: 'a', d: 'M4 6h7' }),
        h('path', { key: 'b', d: 'M4 12h10' }),
        h('path', { key: 'c', d: 'M4 18h6' }),
        h('path', { key: 'd', d: 'M17 9l3 3-3 3' }),
      ])
    }

    /* ────────────────────────────── 装配 ────────────────────────────── */

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'display-manager: dictionaries')
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.setAttribute('data-plugin', 'dsh-display-manager')
        tag.textContent = BASE_CSS
        document.head.appendChild(tag)
        return () => tag.remove()
      }, 'display-manager: base styles')

      const store = createStore(loadState())

      // 隐藏样式表：状态变化时整体重写。只影响显示，不碰插件启用状态。
      let hiddenTag = null
      const renderHiddenCss = () => {
        if (hiddenTag === null) return
        hiddenTag.textContent = hiddenCss(store.get())
      }
      ctx.effect(() => {
        hiddenTag = document.createElement('style')
        hiddenTag.setAttribute('data-plugin', 'dsh-display-manager')
        hiddenTag.setAttribute('data-dsh-fold-hidden', '')
        hiddenTag.textContent = hiddenCss(store.get())
        document.head.appendChild(hiddenTag)
        const off = store.subscribe(renderHiddenCss)
        return () => {
          off()
          hiddenTag?.remove()
          hiddenTag = null
        }
      }, 'display-manager: hidden styles')

      // 条目标记：DOM 变化、槽位增减、窗口尺寸变化都重新打标。
      ctx.effect(() => {
        let frame = 0
        const run = () => {
          frame = 0
          markAll(ctx)
        }
        const schedule = () => {
          if (frame === 0) frame = window.requestAnimationFrame(run)
        }
        schedule()
        const observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true, subtree: true })
        const disposers = []
        for (const region of REGIONS) {
          for (const { slot } of region.slots) {
            try {
              disposers.push(ctx.slots.subscribe(slot, schedule))
            } catch {
              /* 槽位可能还没声明 */
            }
          }
        }
        window.addEventListener('resize', schedule)
        return () => {
          if (frame !== 0) window.cancelAnimationFrame(frame)
          observer.disconnect()
          for (const dispose of disposers) {
            try { dispose() } catch { /* 忽略 */ }
          }
          window.removeEventListener('resize', schedule)
        }
      }, 'display-manager: entry markers')

      // 折叠条。
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'display-manager',
        order: 0,
      }, () => h(FoldGrip, { t })))

      // 两个自己出现的位置：按状态随时注册/注销。
      let disposeSidebar = null
      let disposeMain = null
      let disposeSettings = null

      const syncOwnEntries = () => {
        const state = store.get()

        if (state.inSidebar) {
          if (disposeSidebar === null) {
            disposeSidebar = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
              name: 'sidebar.panellist',
              id: SELF_ID,
              order: 90,
              label: () => t('panel.title'),
            }, PanelIcon))
          }
          if (disposeMain === null) {
            disposeMain = ctx.slots.inject('main', () => ctx.slots.register({
              name: 'main',
              key: SELF_ID,
            }, () => h(ManagerPage, { ctx, store, t })))
          }
        } else {
          disposeSidebar?.(); disposeSidebar = null
          disposeMain?.(); disposeMain = null
        }

        if (state.inSettings) {
          if (disposeSettings === null) {
            disposeSettings = ctx.slots.inject('settings.section', () => ctx.slots.register({
              name: 'settings.section',
              id: SELF_ID,
              order: 90,
              label: () => t('settings.section'),
            }, () => h(SettingsSection, { ctx, store, t })))
          }
        } else {
          disposeSettings?.(); disposeSettings = null
        }

        // 位置变了，标记也要重算（本插件自己的行不计入管理，但 DOM 会变）。
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => markAll(ctx))
        }
      }

      syncOwnEntries()
      ctx.effect(() => {
        const off = store.subscribe(syncOwnEntries)
        return () => {
          off()
          disposeSidebar?.(); disposeSidebar = null
          disposeMain?.(); disposeMain = null
          disposeSettings?.(); disposeSettings = null
        }
      }, 'display-manager: own entries')
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
