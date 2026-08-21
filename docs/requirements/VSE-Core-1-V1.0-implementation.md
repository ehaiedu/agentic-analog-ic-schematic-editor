# VSE-Core-1 V1.0 需求冻结与实施追踪

## 1. 基线身份

| 字段 | 值 |
|---|---|
| 产品基线 | VSE-Core-1 V1.0 |
| 冻结源文件 | `Virtuoso原理图编辑器_最小核心版本需求规格说明书_V1.0.docx` |
| 冻结源 SHA256 | `d9060cb54fd43fb9e2cf50f53d84fad4a5ca2987a8fdc79c8357a0433585516a` |
| 公开需求副本 | [`Virtuoso原理图编辑器_最小核心版本需求规格说明书_V1.0.docx`](./Virtuoso原理图编辑器_最小核心版本需求规格说明书_V1.0.docx) |
| 公开副本 SHA256 | `d0cfbdb024a5d570678bf7e4413541114717176fd94d14c9ebff90ffe96f8649` |
| 公开审计时间 | 2026-08-21 +08:00 |
| 本文件作用 | 保存需求来源、冻结约束和实现追踪；不替代原始 DOCX |

公开 DOCX 与冻结源的正文等价，仅清理了 Office 文档中的作者、机器标识和修订会话元数据。后续若修改要求，必须新增版本化需求文件、记录新 SHA256 和变更决策；不得直接覆盖本表中的来源记录，也不得用修改追踪文字的方式降低原要求。

## 2. 冻结规则

原文约束词按以下规则执行：

- **必须**：V1.0 发布阻断项。对应实现、自动化验收或发布证据任一缺失，都不得把 V1.0 标记为完成。
- **应当**：原则上必须完成。只有形成书面豁免才允许延期；豁免至少包含需求编号、原因、风险、临时措施、批准人、失效日期和回补版本。
- **可以**：可选优化，不阻断 V1.0，但实现后仍须满足数据、Undo/Redo、持久化和确定性不变量。

实施状态定义：

- **已实现**：运行路径已接入，自动化测试覆盖要求的正常、边界和失败路径，且当前质量门禁通过。
- **部分**：存在 UI、类型、算法或脚手架，但未形成完整运行闭环、缺少关键场景、未接入正式数据流，或测试未通过。
- **未实现**：没有有效运行实现，或只有占位 UI/声明而无行为。

冻结门禁：

1. “必须”项只有在代码、自动化测试、可重复验收证据三者齐全时才能关闭。
2. 手工截图、演示视频和“代码看起来存在”不能单独作为完成证据。
3. Preview、Ghost、Hover、Halo、Snap Cue 不得写入正式数据库或 Undo 栈。
4. 所有正式数据库修改必须通过统一事务；绕过事务直接修改 X6 Graph 的功能不能判定完成。
5. 几何兼容以 0 DBU 差异为门槛；拓扑兼容以 Logical Net、成员、Terminal-Net、显式名称和 Global 属性完全一致为门槛。
6. 当前类型检查、单测、AT 回放或 Golden Diff 任一发布门禁失败，V1.0 即为阻断状态。
7. 未提交代码仅可记为“部分”，合并后必须重新运行本文件列出的证据命令并更新审计基点。

## 3. 当前质量门禁快照

2026-07-15 当前开发线执行：

```powershell
npm test
```

结果：

- TypeScript 类型检查通过。
- Vinext 生产构建通过，包含 `/api/projects/:id/recovery` 路由。
- 领域与账户单元测试 37 项全部通过；覆盖 v3 migration、物理/逻辑拓扑、T 接、普通交叉、显式 Junction、同名 Label、No Connect 冲突、canonical serialization、四类 revision、CommandTransaction 和确定性 Marker。
- 唯一构建提示是客户端 chunk 大于 500 kB，不影响本次正确性门禁，但仍需在性能阶段做代码分割。
- 现有测试尚未使用完整 `AT-xxx` 浏览器事件回放，也没有 Golden Geometry/Topology/Interaction Trace、截图 Diff 或规格规模性能基准。

因此，当前代码质量门禁已通过，但完整 AT/Golden/性能与统一领域事务门禁尚未关闭，整体仍为 **V1.0 发布阻断**。

## 4. 第 1–40 章实施矩阵

| 章 | 要求主题 | 状态 | 对应文件 | 当前验收证据 | 剩余缺口 / 发布阻断 |
|---:|---|---|---|---|---|
| 1 | 术语和强制级别 | 已实现 | `docs/requirements/VSE-Core-1-V1.0-implementation.md` | 本文件冻结“必须/应当/可以”及完成定义 | 后续变更仍须执行版本化和书面豁免规则 |
| 2 | 兼容基线 | 部分 | `config/vse-core-1.json`、`lib/compatibilityProfile.ts`、`components/SchematicCanvas.tsx` | 已声明网格、按键、颜色、选择和命名配置；部分 Canvas 行为已引用 | 缺 Virtuoso 参考事件记录和几何/拓扑/交互对照；大量行为仍硬编码，配置未全链路生效 |
| 3 | 第一版本功能边界 | 部分 | `package.json`、`lib/schematic.ts`、`components/AnalogWorkbench.tsx` | 工程定位为单页、标量 schematic，未引入 Bus/Hierarchy 等非 V1 范围 | V1 必选闭环尚不完整；底层 Master、Terminal、参数系统对 Bus/Hierarchy/PDK 的扩展边界不足 |
| 4 | 发布完成标准 | 部分 | `tests/netlist.test.ts`、`tests/schematicValidation.test.ts`、`tests/vseCore.test.ts`、`package.json` | 类型检查、生产构建和 37/37 单元测试通过 | 无 20+ Instance、10+ Top Pin、50+ Wire 等端到端设计验收；无完整 0 DBU、拓扑重开一致和事件回放门禁 |
| 5 | 总体软件架构要求 | 部分 | `lib/designStore.ts`、`lib/commandEngine.ts`、`lib/connectivity.ts`、`lib/schematic.ts` | 已出现纯 TS Store、事务快照、物理/逻辑网络和 revision 类型 | Canvas 仍以 X6 Graph 为事实源；正式修改未统一经过 Store；ID 可复用且非 UUID；Wire 坐标校验仍可接收小数后静默吸附 |
| 6 | 主界面需求 | 部分 | `components/AnalogWorkbench.tsx`、`app/globals.css` | 已有器件栏、Canvas、底部面板、Agent、状态栏和可调整面板 | 原规格菜单、状态项和命令入口不完整；部分功能仅按钮占位；需要以用户确认后的布局变更记录映射规格 |
| 7 | 画布与视觉系统 | 部分 | `components/SchematicCanvas.tsx`、`app/globals.css` | X6 已支持缩放、平移、Fit、点/网格、Wire hover/selection halo、Snap cue 雏形 | 无 View History、高 DPI 验收、临时关闭 Snap；Preview 仍以临时 X6 Cell 实现而非独立 overlay；无坐标漂移回放测试 |
| 8 | 命令引擎 | 部分 | `lib/commandEngine.ts`、`components/SchematicCanvas.tsx` | 有纯 reducer；运行 UI 已接入 Select/Wire/No Connect、F3、F4、Enter、Backspace 和分层 Esc | reducer 尚未成为运行时唯一入口；Pre/Post/Infix 和多数编辑命令仍在 Canvas 内直接实现 |
| 9 | 数据模型 | 部分 | `lib/schematic.ts`、`lib/schematicValidation.ts` | v3 已增加 CellView envelope、独立 Junction/Label/NoConnect/Note/Marker 和四类 revision | 无 SymbolMaster、TerminalDefinition、MasterRef、独立 TopLevelPin；Instance ID/CellView ID 不稳定；旧 utility DeviceKind 与新对象双重表示；没有 branded/safe-integer DBU |
| 10 | Symbol Library 和器件选择 | 部分 | `lib/schematic.ts`、`components/x6Symbols.ts`、`components/DeviceSymbolPreview.tsx`、`components/AnalogWorkbench.tsx` | 有基础 MOS、R/C/L、源、Pin、VDD/GND 图形和搜索 UI | 无 SymbolLibraryService、Library/Cell/View/Master 稳定身份、revision、recent/refresh、missing-master placeholder；缺 generic block；Palette 仍硬编码 |
| 11 | Create Instance | 部分 | `components/SchematicCanvas.tsx`、`lib/schematic.ts`、`components/AnalogWorkbench.tsx` | 点击/拖放可创建器件，支持旋转/镜像和默认参数 | 无完整 Ghost 状态机和中键旋转验收；命名会复用删除后的最小编号；手工重名不阻断；无 typed parameter schema、engineering parser 和原子 callback |
| 12 | Create Pin | 部分 | `lib/schematic.ts`、`components/SchematicCanvas.tsx` | input/output/bidir 可作为 palette node 放置和连接 | TopLevelPin 仍伪装为普通器件 Node；无独立数据模型、方向/名称专用流程、移动 Pin 的 Stretch 行为和重复名完整检查闭环 |
| 13 | No Connect | 部分 | `lib/schematic.ts`、`lib/schematicValidation.ts`、`lib/connectivity.ts`、`lib/checkEngine.ts`、`components/SchematicCanvas.tsx` | 已有独立对象 schema、画布端子点击添加/移除、红色 × overlay，并能检查 `NO_CONNECT_AND_WIRE` | position 随 Terminal 更新尚无浏览器验收；仍未进入领域事务 Undo/Redo |
| 14 | Create Wire | 部分 | `components/SchematicCanvas.tsx`、`lib/commandEngine.ts`、`lib/schematicGeometry.ts` | 支持 Pin/空白/Wire endpoint/segment 起线、多 corner、正交预览、Enter/双击完成、Backspace 回退、分层 Esc 和 F3 三种路由模式 | 右键 Finish 菜单未实现；旧 drag-connect 是兼容旁路；纯 Command Engine 尚未成为唯一入口；缺浏览器事件回放 |
| 15 | Wire 几何规则 | 部分 | `lib/schematicGeometry.ts`、`lib/connectivity.ts`、`components/SchematicCanvas.tsx` | 有正交 segment、point-on-segment、交点、共线/零长度 normalize 和显式 Junction 逻辑 | normalize 未作为每次提交的统一事务后置条件；线段分割只改 X6 vertex，未建立稳定拓扑点对象；旧/新 Junction 表示混用；缺完整 AT-037–044 |
| 16 | Snap Engine | 部分 | `components/SchematicCanvas.tsx`、`config/vse-core-1.json` | `findSnapCandidate` 已按 Pin、endpoint、Junction、segment、grid，再按距离和 stableId 排序 | 算法仍嵌在 Canvas；无独立可测试引擎、有效性过滤、z-order 规则和 hysteresis/锁定；配置未完全驱动；无 AT-006/007 证据 |
| 17 | Connectivity Extraction | 部分 | `lib/connectivity.ts`、`lib/netlist.ts`、`lib/schematicGeometry.ts` | 已分出 `PhysicalNetComponent`/`LogicalNet`，按真实 Wire 几何、Terminal、Label、Global `!` 进行提取 | 匿名 netN 依排序重编号，不具跨编辑稳定身份；无前一版本 component matching；未做增量提取；名称冲突/短接边界和交叉重叠需 Golden 测试；现有旧测试失败 |
| 18 | Net Label | 部分 | `lib/schematic.ts`、`lib/schematicValidation.ts`、`components/SchematicCanvas.tsx`、`lib/connectivity.ts` | v3 Label 绑定 `wireId + segmentIndex + anchorPoint`，可由 palette 附着到 Wire | Stretch、normalize、删 segment 后的附着维护不完整；无 Direct Edit；名称合法性、冲突和 Undo 未完整测试；Canvas 仍转换成 legacy netlabel node 渲染 |
| 19 | Selection Engine | 部分 | `components/SchematicCanvas.tsx`、`app/globals.css` | 支持单选、多选修饰键、框选、Wire 大命中区和选择 halo | 无 Selection Filter UI/逻辑、重叠对象轮选、F4 partial endpoint、独立 Hit-Test 顺序引擎；X6 默认选择仍是权威；无 AT-060–062 |
| 20 | Move 与 Stretch | 部分 | `components/SchematicCanvas.tsx`、`lib/commandEngine.ts` | X6 支持移动完整 Node，连接 Edge 可随端口移动；配置声明 full/simple/flight | Move 与 Stretch 未真正分离；无 FULL/SIMPLE/FLIGHT 实现闭环、partial stretch、拓扑身份保持和一个原子事务恢复；连接线 reroute 依赖 X6 |
| 21 | Copy | 部分 | `components/SchematicCanvas.tsx` | X6 clone 后以新 Cell ID 持久化，并为复制的 Instance/Top Pin 重新分配名称 | Wire/Label 组合复制与连续参考点 Copy 尚未形成领域事务；无浏览器验收 |
| 22 | Rotate 和 Mirror | 部分 | `lib/schematic.ts`、`components/SchematicCanvas.tsx` | 支持 90° rotate 和一类 mirror；已有端口变换单测 | 未覆盖全部 8 orientation 的运行命令、连接 Wire 重路由、文本可读方向和原子 Undo；只有 X6 batch，不是核心事务 |
| 23 | Delete | 部分 | `components/SchematicCanvas.tsx` | 删除 Instance 前会把外部 TerminalRef 转为原 Pin 精确坐标并保留 dangling Wire；删除 Wire 同时清理附着 Label 和孤立 Junction | 单个 Wire segment 删除与领域事务化恢复仍缺；NoConnect 清理由投影重建完成但缺事件验收 |
| 24 | Properties | 部分 | `components/AnalogWorkbench.tsx`、`components/SchematicCanvas.tsx` | 双击或 `q` 打开属性窗；表单先编辑草稿，点击 Apply 后以一次 X6 batch 写入 | 仅 Node 且自由文本；无 Wire/Pin/Label typed form、Mixed 多选和完整字段校验；仍非核心 DesignStore 事务 |
| 25 | Direct Text Edit | 未实现 | `lib/commandEngine.ts` | 仅声明 `direct-text-edit` command ID | 无 `t` 命令、画布内文本编辑器、名称/参数校验、callback 和回滚；属性浮窗不能替代 Direct Edit |
| 26 | Dynamic Net Highlight | 部分 | `lib/connectivity.ts`、`components/SchematicCanvas.tsx`、`app/globals.css` | hover Wire 会按 Logical Net 高亮全网；Current 使用绿色，Stale 使用橙色 | 每次 hover 仍全量提取 connectivity，无空间/拓扑缓存；缺规格规模性能测试和 Label/Pin hover 入口 |
| 27 | 右键菜单 | 未实现 | 无有效运行文件 | 未发现 Canvas/object context menu 行为 | 空白、Instance、Wire、Pin、Marker 和活动 Wire 的上下文菜单均缺失 |
| 28 | Undo/Redo | 部分 | `lib/designStore.ts`、`components/SchematicCanvas.tsx` | `DesignStore` 有 100 容量 before/after 快照；X6 History 已接入；完成 Wire 尝试合成一次 history command | `DesignStore` 未接入 Canvas；正式对象仍直接改 Graph；事务没有 created/deleted/modified patch 和 connectivity before/after；Copy/Properties/Stretch 等原子性未保证 |
| 29 | Save、Open 和恢复 | 部分 | `lib/persistence.ts`、`lib/schematicValidation.ts`、`app/api/projects/[id]/route.ts`、`app/api/projects/[id]/recovery/route.ts`、`db/schema.ts` | 有 v1/v2→v3 migration、canonical JSON、D1 CAS 保存、独立 recovery API 和恢复提示 | 无 immutable project version/校验和；无模拟写失败原子性测试；Recovery 不是事务日志；缺 missing-master placeholder；v3 Wire point 仍可小数后静默改变 |
| 30 | Save 与 Check & Save | 部分 | `components/AnalogWorkbench.tsx`、`lib/checkEngine.ts`、`lib/schematic.ts` | UI 有 Save、Check & Save；保存后更新 savedRevision，Check 更新 connectivity/check revision；Recovery 与正式保存分离 | Revision 更新未由所有 Canvas 编辑驱动；Clean/Modified/Stale/Checked/ReadOnly 状态未完整展示；Check & Save 无端到端一致性测试 |
| 31 | V1.0 检查规则 | 部分 | `lib/checkEngine.ts`、`lib/netlist.ts`、`lib/connectivity.ts` | `DEFAULT_RULES` 已列出规格要求的 11 Error 和 8 Warning，并支持 enabled/severity/parameters override | 多条规则只有注册项、没有产生逻辑或边界覆盖；无规则配置 UI/持久化；UNBOUND_MASTER 因无 Master 模型不可实现；当前 ERC 旧测试失败 |
| 32 | Marker | 部分 | `lib/schematic.ts`、`lib/checkEngine.ts`、`components/AnalogWorkbench.tsx`、`components/SchematicCanvas.tsx` | Marker 有确定性 ID/bbox/revision/status、底部列表、Canvas 虚线 overlay；双击列表可定位 | 无 next/prev、filter、waive 和完整 obsolete/orphan 生命周期测试；缺浏览器定位验收 |
| 33 | Modified 和 Connectivity Stale | 部分 | `lib/schematic.ts`、`components/AnalogWorkbench.tsx`、`components/SchematicCanvas.tsx`、`tests/vseCore.test.ts` | 四类 revision、dirty/stale 状态、Canvas design revision 更新、动态高亮状态色和 revision 单测已接入 | 哪些命令影响 connectivity 尚未由统一 command metadata 强制；缺浏览器状态转换验收 |
| 34 | 性能要求 | 未实现 | `lib/schematicValidation.ts` | schema 设置了部分最大对象数量 | 无核心空间索引、增量 connectivity、性能 fixture 或 latency benchmark；嵌套遍历无法证明达到 5k Instance/20k segment/5k Label/2k Net 目标 |
| 35 | 确定性要求 | 部分 | `lib/persistence.ts`、`lib/connectivity.ts`、`lib/checkEngine.ts` | 对象、issue、marker 和 JSON key 有稳定排序；序列化已有 canonical 函数 | ID/名称可复用，匿名网会重编号；依赖 localeCompare；X6 事件顺序未收敛；无 shuffle/property-based/replay 确定性测试 |
| 36 | Compatibility Profile | 部分 | `config/vse-core-1.json`、`lib/compatibilityProfile.ts` | 已外置部分 keymap、mouse、grid、wire、selection、naming、text、colors | 仅 TypeScript 强制断言，无运行时 schema；大量 UI/Canvas 常量未读取 profile；没有版本和迁移策略 |
| 37 | 核心验收测试 | 部分 | `tests/netlist.test.ts`、`tests/developmentAccount.test.ts`、`tests/schematicValidation.test.ts`、`tests/vseCore.test.ts` | 37 个开发单测全部通过，覆盖核心 v3、拓扑、No Connect、事务、revision 与 Marker | 原文 73 个 AT 尚未建立完整事件 trace；无浏览器事件驱动和 Golden 证据，不能作为发布完成证据 |
| 38 | Golden Reference 对照机制 | 未实现 | 无 | 无 screenshot/geometry/topology/interaction trace 基线或 diff 产物 | 需要冻结 Virtuoso 参考场景、容差、更新审批和 CI artifact；0 DBU 和拓扑 0 差异必须阻断发布 |
| 39 | 推荐开发顺序 | 部分 | `lib/designStore.ts`、`lib/commandEngine.ts`、`lib/connectivity.ts`、`lib/checkEngine.ts`、`lib/persistence.ts` | 已按领域拆出部分 Stage 1/4/7 脚手架 | 实际仍先由 X6 承担数据库和历史，依赖顺序倒置；须先让 Core Store 成为唯一事实源，再继续补交互 |
| 40 | 第一版本最终定义 | 未实现 | 全工程 | 已有可操作 demo、账户/项目壳、基础器件/Wire/网表 | Direct Edit、Stretch、事务 Undo、稳定 DB/ID、完整 Save/Open/Check/Marker/Highlight 和全部验收门禁均未完成；不得发布为 V1.0 |

## 5. 优先整改边界

为避免继续在 X6 层堆叠不可验证行为，建议固定以下依赖方向：

```text
Canvas 事件
  -> Command / CommandSession
  -> DesignStore.execute(CommandTransaction)
  -> Core SchematicDocument
  -> Connectivity / Check / Persistence
  -> X6 Renderer 投影
```

禁止的反向路径：

```text
X6 Graph 任意突变 -> 扫描 Graph -> 反向生成正式数据库
```

推荐模块边界：

```text
core/model          整数 DBU、稳定 ID、CellView、Instance、TopLevelPin、Wire、Label、Junction、NoConnect
core/store          唯一 DesignStore、CommandTransaction、History
core/symbols        SymbolMaster、TerminalDefinition、ParameterDefinition、Registry、MissingMaster
core/geometry       normalize、transform、spatial index、Snap Engine
core/connectivity   Physical component、Logical net、命名、稳定匿名网身份
core/checks         Rule registry、Check Engine、Marker lifecycle
core/persistence    canonical format、migration、atomic version、recovery
adapters/x6         renderer、event controller、overlay、hit-test adapter
```

## 6. AT-001–AT-105 测试追踪策略

### 6.1 追踪规则

1. 每个原文定义的 AT 必须有唯一测试用例，测试名以 AT 编号开头，例如 `AT-037 endpoint-to-segment creates T junction`。
2. 每个测试记录：需求版本和 SHA、Compatibility Profile 版本、fixture hash、事件 trace、最终 canonical document、geometry snapshot、topology snapshot、Undo 栈摘要和截图路径。
3. 浏览器交互使用真实 pointer/keyboard/wheel 事件，不直接调用内部 handler 冒充验收。
4. 几何断言使用 DBU，不使用屏幕像素；视觉命中和截图允许定义独立像素容差。
5. Connectivity 测试同时断言 PhysicalNetComponent 与 LogicalNet，不能只比较网表字符串。
6. Undo/Redo 测试比较 canonical document、selection、revision 和 connectivity，不只看画布截图。
7. 每个 AT 的 CI 结果写入 `artifacts/acceptance/<commit>/<AT-ID>/`；发布清单只接受当前提交产生的通过结果。
8. 当前仓库没有任何正式 AT 测试。已有单测只能作为开发辅助，补上编号和完整事件/领域证据前不得回填“通过”。

### 6.2 计划测试层与文件

| AT 范围 | 原文场景 | 计划自动化层 | 建议文件 | 必须保存的证据 | 当前状态 |
|---|---|---|---|---|---|
| AT-001 | Ctrl+滚轮缩放，鼠标下设计点保持 | Browser event replay + geometry | `tests/acceptance/canvas-navigation.spec.ts` | trace、viewport matrix、0 DBU document diff、截图 | 未建立 |
| AT-002 | Shift+滚轮仅水平平移 | Browser event replay | 同上 | trace、x/y viewport delta | 未建立 |
| AT-003 | Fit 全部进入视口并留边距 | Browser + screenshot | 同上 | bbox、viewport、截图 | 未建立 |
| AT-004 | 高倍缩放往返对象坐标无漂移 | Browser + canonical document | 同上 | zoom trace、0 DBU diff | 未建立 |
| AT-005 | Grid Snap 提交坐标严格位于 Snap Grid | Core command + Browser | `tests/acceptance/grid-snap.spec.ts` | transaction、DBU modulo 断言 | 未建立 |
| AT-006 | Pin 与 Grid 相邻时 Pin Snap 优先 | Core Snap + Browser | `tests/acceptance/snap-engine.spec.ts` | 候选排序 trace、最终 endpoint | 未建立 |
| AT-007 | Hover 重叠对象可轮选全部候选 | Browser hit-test | `tests/acceptance/selection.spec.ts` | candidate list、cycle trace、截图 | 未建立 |
| AT-010 | 连续放置 20 个 NMOS，名称唯一且命令保持活动 | Browser + Core transaction | `tests/acceptance/create-instance.spec.ts` | 20 个 transaction、ID/name 集合、session state | 未建立 |
| AT-011 | 放置时中键旋转，Ghost/Pin 立即更新 | Browser + screenshot + geometry | 同上 | Ghost overlay、8 orientation point snapshot | 未建立 |
| AT-012 | 参数后放置，显示值和保存值一致 | Browser + serialization | 同上 | parameter literal/value、reopen diff | 未建立 |
| AT-013 | 参数非法阻止提交并显示错误 | Browser + parameter unit | 同上 | validation result、0 transaction、截图 | 未建立 |
| AT-014 | Instance 放到 Wire 上，仅 Pin 精确重合连接 | Core connectivity + Browser | 同上 | geometry/topology snapshots | 未建立 |
| AT-015 | Undo 放置一次删除一个实例 | Core history + Browser | 同上 | history depth、document diff | 未建立 |
| AT-016 | Redo 恢复名称和 ID | Core history | 同上 | exact ID/name before-after | 未建立 |
| AT-017 | Master 丢失时占位且保留 Instance | Persistence + Browser | `tests/acceptance/missing-master.spec.ts` | placeholder、Marker、round-trip JSON | 未建立 |
| AT-020 | 放置 input Pin，保存名称/方向/位置 | Browser + persistence | `tests/acceptance/create-pin.spec.ts` | TopLevelPin snapshot、reopen diff | 未建立 |
| AT-021 | Wire 接 Pin 建立连接 | Core connectivity + Browser | 同上 | physical/logical topology | 未建立 |
| AT-022 | Pin 移离 Wire 后断开 | Core Stretch + connectivity | 同上 | before/after topology | 未建立 |
| AT-023 | 重复 Pin 名产生 Check Error | Check Engine | 同上 | exact rule ID、Marker | 未建立 |
| AT-024 | 修改 Pin 名更新 Logical Net | Direct Edit + connectivity | 同上 | revision/stale/re-extract snapshots | 未建立 |
| AT-030 | Pin 到 Pin 形成一个 Logical Net | Core connectivity + Browser | `tests/acceptance/wire.spec.ts` | physical/logical snapshot | 未建立 |
| AT-031 | H-first 顶点水平优先 | Core route + Browser | 同上 | exact DBU vertex list | 未建立 |
| AT-032 | V-first 顶点垂直优先 | Core route + Browser | 同上 | exact DBU vertex list | 未建立 |
| AT-033 | 单击 corner 后固定并继续预览 | Browser command replay | 同上 | session trace、overlay、正式 DB 不变 | 未建立 |
| AT-034 | Backspace 删除最后未完成 corner | Browser command replay | 同上 | fixed point trace、Undo depth 不变 | 未建立 |
| AT-035 | 第一次 Esc 取消当前未提交部分 | Browser command replay | 同上 | session trace、正式 DB 不变 | 未建立 |
| AT-036 | 第二次 Esc 退出 Wire 命令 | Browser command replay | 同上 | final IDLE state | 未建立 |
| AT-037 | Endpoint 到 Segment 分割并建立 T 连接 | Core geometry/connectivity + Browser | `tests/acceptance/wire-topology.spec.ts` | split points、physical/logical snapshot、single transaction | 未建立 |
| AT-038 | Segment 穿过 Segment 默认不连接 | Core connectivity | 同上 | two physical components | 未建立 |
| AT-039 | 交叉处加 Junction 后四向连接 | Core connectivity + Browser | 同上 | junction object、one physical component | 未建立 |
| AT-040 | 删除 Junction 后恢复不连接 | Core connectivity + history | 同上 | before/after/undo topology | 未建立 |
| AT-041 | 零长度段自动清除 | Core normalize | `tests/unit/wire-normalize.test.ts` | normalized point list | 未建立 |
| AT-042 | 共线三点自动合并 | Core normalize | 同上 | normalized point list | 未建立 |
| AT-043 | 视觉接近但未 Snap 不连接 | Core connectivity + Browser | `tests/acceptance/wire-topology.spec.ts` | DBU distance、separate nets | 未建立 |
| AT-044 | 悬空结束保留 Wire 并产生 Warning | Check Engine + Browser | 同上 | Wire object、`DANGLING_WIRE` Marker | 未建立 |
| AT-050 | 两个同名 stub 合并一个 Logical Net | Core naming | `tests/acceptance/net-naming.spec.ts` | two physical/one logical snapshot | 未建立 |
| AT-051 | 一条物理网两个名称产生 Error | Core naming + Check | 同上 | exact conflict rule、objectRefs | 未建立 |
| AT-052 | 删除一个 Label 后重新解析 | Core command/connectivity | 同上 | transaction、new topology | 未建立 |
| AT-053 | `vdd!` 标为 Global | Core naming | 同上 | global flag、canonical name | 未建立 |
| AT-054 | 匿名网络生成稳定 netN | Core anonymous identity | 同上 | stable ID/name snapshot | 未建立 |
| AT-055 | 连续 Check 不无原因改变匿名名 | Core determinism | 同上 | repeated canonical topology equality | 未建立 |
| AT-056 | Direct Edit 改名后 connectivity stale | Direct Edit + revision | 同上 | revision transition | 未建立 |
| AT-060 | Shift 多选添加和移除 | Browser selection | `tests/acceptance/selection-edit.spec.ts` | selection trace | 未建立 |
| AT-061 | Filter 禁止 Wire 后 Wire 不可选 | Browser hit-test | 同上 | filter state、candidate list | 未建立 |
| AT-062 | F4 Partial Selection 可选 endpoint | Browser command replay | 同上 | partial object identity、截图 | 未建立 |
| AT-063 | Stretch 已连接 Instance 时 Wire 动态跟随 | Browser + overlay + geometry | `tests/acceptance/stretch.spec.ts` | preview trace、final DBU geometry | 未建立 |
| AT-064 | Stretch 后 Net identity 保持 | Core connectivity | 同上 | stable logical identity | 未建立 |
| AT-065 | Stretch Undo 全恢复 Instance/Wire/Junction | Core history | 同上 | canonical exact equality | 未建立 |
| AT-066 | Copy Instance 产生新名称和新 ID | Core command + Browser | `tests/acceptance/copy-transform-delete.spec.ts` | ID/name allocator evidence | 未建立 |
| AT-067 | 连续 Copy 每个目标产生副本 | Browser command replay | 同上 | session/transaction list | 未建立 |
| AT-068 | Rotate 已连接 Instance 时 Wire 重路由 | Core command + geometry | 同上 | orientation/terminal/wire snapshot | 未建立 |
| AT-069 | Delete 中间 Wire 段后 Net 拆分 | Core command/connectivity | 同上 | topology before/after/undo | 未建立 |
| AT-070 | Delete Instance 保留外部 dangling Wire | Core command/check | 同上 | dangling Wire、Marker | 未建立 |
| AT-080 | `q` 打开正确对象属性 | Browser property UI | `tests/acceptance/properties-direct-edit.spec.ts` | selected object ID、form snapshot | 未建立 |
| AT-081 | 修改 Instance Name 校验唯一性 | Parameter/name core + Browser | 同上 | rejected transaction/error UI | 未建立 |
| AT-082 | 多选不同参数显示 Mixed | Browser property UI | 同上 | form state、截图 | 未建立 |
| AT-083 | `t` 修改参数并执行 Callback | Direct Edit + callback unit | 同上 | input、patches、single transaction | 未建立 |
| AT-084 | Callback 失败完整回滚 | Core transaction | 同上 | before/after equality、history depth | 未建立 |
| AT-085 | `t` 修改 Wire Name 后全网重解析 | Direct Edit + connectivity | 同上 | stale/current revisions、topology | 未建立 |
| AT-090 | Save/reopen 几何完全一致 | API + persistence + Browser | `tests/acceptance/save-check-recovery.spec.ts` | 0 DBU canonical geometry diff | 未建立 |
| AT-091 | Save/reopen 拓扑一致 | API + connectivity | 同上 | topology snapshot diff | 未建立 |
| AT-092 | 只 Save 允许 connectivity 保持 stale | Revision state + API | 同上 | four revisions before/after | 未建立 |
| AT-093 | Check & Save 更新 connectivityRevision | Check + API | 同上 | four revisions、saved blob | 未建立 |
| AT-094 | 命名短路 Marker 可定位 | Check + Browser Marker overlay | 同上 | marker objectRefs/bbox、zoom trace | 未建立 |
| AT-095 | 修复后再 Check Marker 消失 | Check Engine | 同上 | marker set diff | 未建立 |
| AT-096 | 保存失败时旧文件仍可打开 | Repository failure injection | 同上 | injected failure、old checksum/reopen | 未建立 |
| AT-097 | Autosave 恢复最近完整事务 | Recovery API + Browser | 同上 | transaction boundary、recovered checksum | 未建立 |
| AT-100 | 移动器件和四根 Wire 一次 Undo 全恢复 | Core transaction + Browser | `tests/acceptance/undo-redo.spec.ts` | one history entry、canonical equality | 未建立 |
| AT-101 | 删除 Net Label 后 Undo 恢复名称连接 | Core history/connectivity | 同上 | topology/name exact equality | 未建立 |
| AT-102 | 添加 Junction 后 Undo 恢复不连接交叉 | Core history/connectivity | 同上 | topology exact equality | 未建立 |
| AT-103 | 100 次随机操作全 Undo 回到初始状态 | Property-based Core history | `tests/property/history.property.test.ts` | seed、command log、initial equality | 未建立 |
| AT-104 | Undo 后全部 Redo 回到最终状态 | Property-based Core history | 同上 | seed、final equality | 未建立 |
| AT-105 | Preview 后 Esc 不增加 Undo 栈 | Browser + Core history | `tests/acceptance/undo-redo.spec.ts` | history depth、formal DB equality | 未建立 |

原需求没有定义 AT-008、009、018、019、025–029、045–049、057–059、071–079、086–089、098、099；不得自行伪造这些编号。新增验收项应使用新的需求版本或独立扩展命名空间，例如 `ATX-001`。

## 7. Golden Reference 和 CI 产物约定

建议每个 AT 使用如下目录：

```text
tests/fixtures/acceptance/<AT-ID>/
  initial.schematic.json
  events.json
  expected.schematic.json
  expected.geometry.json
  expected.topology.json
  expected.interaction.json
  expected.png
```

CI 运行产物：

```text
artifacts/acceptance/<commit>/<AT-ID>/
  actual.schematic.json
  actual.geometry.json
  actual.topology.json
  actual.interaction.json
  actual.png
  screenshot-diff.png
  result.json
```

发布判定：

- Geometry Diff：正式 DB 坐标必须 0 DBU 差异。
- Topology Diff：Logical Net、Physical Component、Terminal membership、显式名称和 Global 属性必须 0 差异。
- Interaction Trace：状态机阶段、提交次数、Undo 深度和 selection 必须完全一致。
- Screenshot Diff：使用批准的像素阈值，仅用于视觉层，不能掩盖几何或拓扑失败。
- Golden 更新必须单独评审，说明参考来源和变化原因；不得在修复失败测试时自动覆盖 expected。

## 8. 下一次更新本矩阵的条件

满足以下任一条件时更新本文件：

- 需求源发布新版本或 SHA 改变。
- 核心模块合并到主分支并实际接入运行路径。
- 新增或关闭 AT 测试。
- 修改 Compatibility Profile。
- 发布门禁结果发生变化。

每次更新必须记录新的 commit、工作树状态、类型检查、单测、AT 和 Golden Diff 结果。只有所有“必须”项关闭且 AT/Golden 门禁通过，才能把第 40 章改为“已实现”。
