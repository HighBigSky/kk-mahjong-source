# 领域模型与类型化：交付与验收

本轮完成领域模型与类型化。项目继续零依赖、原生 ES Module、无构建步骤；npm start 仍为 node server.js。未进入状态层与 ViewModel。

**1. 裸数字／裸字符串清查表及状态读取点**


本报告描述迁移前代码。`engine.js:行` 指冻结文件 `tests/fixtures/engine-before-domain.js` 的原始行号；`app.js:行` 指冻结文件 `output/domain-baseline/app.js` 的原始行号。不得将这些行号当作迁移后生产文件的行号。多处相同语义以行号列表归并，同一行重复出现会注明次数。

“规则”包含合法性、状态转换、AI 决策、发牌与计分；“展示”包含名称、日志、可访问文本、提示与渲染。AI 使用公开可见牌仍属于规则/决策语义。表内符号取自实际 `src/domain/tile.js` 与 `src/domain/model.js`。`rankOf` 为一基点数；原 `% 9` 结果为零基索引，迁移时必须同步调整比较界限。

## 裸牌码与牌码换算

| 文件:行 | 当前写法 | 语义（规则/展示） | 建议符号 |
| --- | --- | --- | --- |
| engine.js:9 | `type < 0`、`type > 33` | 展示：未知牌名称的输入范围；此处 33 是最大合法牌码，并非白板特判 | `isTileCode(type)` |
| engine.js:10 | `type < 27` | 展示：数牌/字牌名称分支 | `isNumbered(type)` |
| engine.js:10 | `type % 9` | 展示：数牌名称的零基点数索引 | `rankOf(type) - 1` |
| engine.js:10 | `Math.floor(type / 9)` | 展示：数牌花色名称索引 | `suitOf(type)` 与以 `SUIT` 为键的名称映射 |
| engine.js:10 | `type - 27` | 展示：字牌名称索引 | `type - TILE.EAST` |
| engine.js:14 | `type >= 27`、`'honor'` | 规则：返回字牌花色，供现有计分使用；兼有公开旧接口标签语义 | `TILE.EAST`、`SUIT.HONOR`；保留原公开花色标签 |
| engine.js:14 | `Math.floor(type / 9)` | 规则：数牌花色索引，供计分使用 | `SUIT_SIZE`；旧标签接口保留等价换算 |
| engine.js:18 | `type >= 0 && type < 34` | 规则：牌码合法范围 | `isTileCode(type)` / `TILE.MAN`、`TILE_TYPE_COUNT` |
| engine.js:24 | `type < 27` | 规则：癞子循环的数牌/字牌分支 | `isNumbered(type)` |
| engine.js:24 | `Math.floor(type / 9) * 9 + (type + 1) % 9` | 规则：同花色下一张，九循环到一 | `suitStartOf(type) + rankOf(type) % SUIT_SIZE` |
| engine.js:24 | `27 + (type - 26) % 7` | 规则：东南西北中发白七种字牌循环；26 是起点减一 | `TILE.EAST + rankOf(type) % HONOR_COUNT` |
| engine.js:29 | `Array(34)` | 规则：每种牌一个计数槽 | `TILE_TYPE_COUNT` |
| engine.js:31 | `tile < 0`、`tile > 33` | 规则：手牌牌码校验；33 是合法上界 | `isTileCode(tile)` |
| engine.js:31 | `++counts[tile] > 4` | 规则：同种牌最多四份，属于实物份数而非牌种编码 | `COPIES_PER_TILE` |
| engine.js:66 | `first < 27` | 规则：只有数牌可组成顺子 | `isNumbered(first)` |
| engine.js:67 | `Math.floor(first / 9) * 9` | 规则：当前数牌花色的牌码起点 | `suitStartOf(first)` |
| engine.js:69 | `first - 2`、`suitStart + 6` | 规则：包含首张自然牌的顺子起点范围；零基最晚起点为六 | 保留牌码偏移换算；上界用 `suitStart + MAX_SEQUENCE_START_RANK - 1` |
| engine.js:70 | `[start, start + 1, start + 2]` | 规则：构造三张连续牌码 | 允许保留的牌码换算 |
| engine.js:82 | `pair = 0; pair < 34` | 规则：遍历所有牌种选择将牌 | `TILE.MAN`、`TILE_TYPE_COUNT` |
| engine.js:97 | `hand.includes(31)` | 规则：暗手持红中不能胡 | `RED_DRAGON`（即 `TILE.RED`） |
| engine.js:111 | `draw = 0; draw < 34` | 规则：遍历可能的获胜进张 | `TILE.MAN`、`TILE_TYPE_COUNT` |
| engine.js:112 | `counts[draw] < 4` | 规则：该种牌未达四份才可作为实际进张 | `COPIES_PER_TILE` |
| engine.js:122、123 | `start < 34`、`start === 34` | 规则：牌种遍历及结束哨兵 | `TILE_TYPE_COUNT` |
| engine.js:133 | `start < 27` | 规则：顺子仅适用数牌 | `isNumbered(start)` |
| engine.js:133 | `start % 9 <= 6` | 规则：顺子起点不能晚于七 | `rankOf(start) <= MAX_SEQUENCE_START_RANK` |
| engine.js:133、134、136 | `start + 1`、`start + 2` | 规则：读取、临时移除及恢复顺子后两张牌码 | 允许保留的牌码换算 |
| engine.js:144 | `start < 27` | 规则：数牌搭子分支 | `isNumbered(start)` |
| engine.js:145、146 | `[1, 2]`、`start % 9 + distance > 8` | 规则：相邻/隔张搭子，不能跨花色 | 保留距离；边界用 `rankOf(start) + distance > SUIT_SIZE` |
| engine.js:154 | `visit(0, meldCount, 0, 0)` 的首个 0 | 规则：从最小牌码开始搜索；其他两个 0 是组数状态 | `visit(TILE.MAN, meldCount, 0, 0)` |
| engine.js:167 | `tile = 0; tile < 34` | 规则：AI 遍历所有牌种评估牌形 | `TILE.MAN`、`TILE_TYPE_COUNT` |
| engine.js:171 | `tile >= 27` | 规则：AI 对字牌对子使用原有权重 | `!isNumbered(tile)` |
| engine.js:172 | `tile >= 27` | 规则：AI 对单张字牌使用原有扣分 | `!isNumbered(tile)` |
| engine.js:173 | `tile < 27` | 规则：AI 数牌连接度分支 | `isNumbered(tile)` |
| engine.js:174 | `tile % 9` | 规则：AI 取得零基点数 | `rankOf(tile)`；下游比较同步改为一基 |
| engine.js:175 | `rank >= 2 && rank <= 6` | 规则：零基三至七的轻微 AI 权重 | 一基 `rank >= 3 && rank <= MAX_SEQUENCE_START_RANK`；权重不变 |
| engine.js:176 | `rank <= 7`、`tile + 1` | 规则：相邻张不得跨花色，零基起点不晚于八 | 一基 `rank < SUIT_SIZE`；保留牌码偏移 |
| engine.js:177 | `rank <= 6`、`tile + 2` | 规则：隔张不得跨花色，零基起点不晚于七 | 一基 `rank <= MAX_SEQUENCE_START_RANK`；保留牌码偏移 |
| engine.js:187、189 | `Array(34)` | 规则：可见牌计数与暗手计数槽 | `TILE_TYPE_COUNT` |
| engine.js:188 | `tile >= 0 && tile < 34` | 规则：可见牌牌码合法性 | `isTileCode(tile)` |
| engine.js:194 | `tile !== 31` | 规则：AI 判断可打普通牌以决定是否保留癞子 | `RED_DRAGON` |
| engine.js:197 | `tile === 31` | 规则：AI 禁止打出红中 | `RED_DRAGON` |
| engine.js:208 | `draw = 0; draw < 34` | 规则：AI 遍历获胜进张 | `TILE.MAN`、`TILE_TYPE_COUNT` |
| engine.js:210 | `4 - own[draw] - seen[draw]` | 规则：估计该牌墙外仍可用的实物份数 | `COPIES_PER_TILE` |
| engine.js:280 | `{ length: 136 }`、`Math.floor(index / 4)` | 规则：生成全副 136 张，每种四份 | `TOTAL_TILE_COUNT`、`COPIES_PER_TILE` |
| engine.js:290 | `nextWildTile(candidate) === 31` | 规则：癞子算到红中时触发已确定的例外 | `RED_DRAGON` |
| engine.js:294 | `lastIndexOf(33)` | 规则：取实际白板作皮子 | `TILE.WHITE` |
| engine.js:295 | `this.wildTile = 32` | 规则：例外局以发财作癞子 | `TILE.GREEN` |
| engine.js:336 | `tile === 31` | 规则：红中不能被吃、碰、普通杠或胡 | `RED_DRAGON` |
| engine.js:343 | `tile < 27` | 规则：吃牌仅适用数牌 | `isNumbered(tile)` |
| engine.js:344 | `start = tile - 2` | 规则：枚举包含目标牌的顺子起点 | 允许保留的牌码换算 |
| engine.js:345 | `start < 0` | 规则：顺子起点不得越过最小牌码 | `start < TILE.MAN` |
| engine.js:345 | `Math.floor(start / 9) !== Math.floor(tile / 9)` | 规则：顺子三张必须同花色 | `suitOf(start) !== suitOf(tile)` |
| engine.js:345 | `start % 9 > 6` | 规则：顺子起点不得晚于七 | `rankOf(start) > MAX_SEQUENCE_START_RANK` |
| engine.js:346 | `[start, start + 1, start + 2]` | 规则：吃牌顺子牌码列表 | 允许保留的牌码换算 |
| engine.js:368 | `counts[31] > 0` | 规则：暗手含红中，可考虑单张杠 | `counts[RED_DRAGON]` |
| engine.js:370 | `tile !== 31` | 规则：普通暗杠排除红中 | `RED_DRAGON` |
| engine.js:373 | `meld.tiles[0] !== 31` | 规则：普通补杠排除红中 | `RED_DRAGON` |
| engine.js:383 | `seat.hand[index] === 31` | 规则：禁止玩家直接打红中 | `RED_DRAGON` |
| engine.js:405 | `removeTiles(seat.hand, [31])` | 规则：单张红中杠从暗手移除一张红中 | `RED_DRAGON` |
| engine.js:406 | `seat.redGangs.push(31)` | 规则：移入独立红中杠记录 | `RED_DRAGON` |
| engine.js:487 | `seat.hand.every(value => value === 31)` | 规则：无牌可补且暗手只剩红中的流局条件 | `RED_DRAGON` |
| engine.js:519 | `hand.every(value => value === 31)` | 规则：摸牌后检查同一流局条件 | `RED_DRAGON` |
| app.js:99 | `hand.includes(31)` | 展示：持红中规则提示 | `RED_DRAGON` |
| app.js:116 | `type === 31`（五处） | 展示：特殊 class、可访问名称、不可打标记、title、杠角标 | `RED_DRAGON` |
| app.js:227 | `tiles: [31]` | 展示：红中杠选择项中的牌面 | `RED_DRAGON` |
| app.js:263 | `game.players[0].hand[index] === 31` | 展示/交互：点击红中显示提示；引擎另行保证禁打规则 | `RED_DRAGON` |

## 裸 phase 字面量

`PHASE` 是实际 `model.js` 中的常量；状态本身迁移为 `Phase` 判别联合对象。下表不包含动作种类的同名 `'discard'`，因为冻结源里的所有该字符串命中均为 phase，迁移后的动作使用 `ACTION.DISCARD`。

| 文件:行 | 当前写法 | 语义（规则/展示） | 建议符号 |
| --- | --- | --- | --- |
| engine.js:309 | `this.phase = 'discard'` | 规则：发牌后进入庄家出牌阶段 | `{ kind: PHASE.DISCARD, seat }` |
| engine.js:333 | `this.phase !== 'claim'` | 规则：抢牌动作前置阶段 | `this.phase.kind !== PHASE.CLAIM` |
| engine.js:358 | `this.phase === 'ended'` | 规则：结束后没有合法动作 | `this.phase.kind === PHASE.ENDED` |
| engine.js:359 | `this.phase === 'claim'` | 规则：抢牌动作分支 | `this.phase.kind === PHASE.CLAIM` |
| engine.js:362 | `this.phase !== 'discard'` | 规则：自家摸打动作前置阶段 | `this.phase.kind !== PHASE.DISCARD` |
| engine.js:380 | `this.phase !== 'discard'` | 规则：出牌前置阶段 | `this.phase.kind !== PHASE.DISCARD` |
| engine.js:387 | `this.phase = 'claim'` | 规则：出牌后收集各家响应 | `{ kind: PHASE.CLAIM, discard }` |
| engine.js:399 | `this.phase === 'discard'` | 规则：自摸胡和自家杠分支 | `this.phase.kind === PHASE.DISCARD` |
| engine.js:420 | `this.phase !== 'claim'` | 规则：抢牌动作前置阶段 | `this.phase.kind !== PHASE.CLAIM` |
| engine.js:434 | `this.phase !== 'claim'` | 规则：过牌前置阶段 | `this.phase.kind !== PHASE.CLAIM` |
| engine.js:441 | `this.phase !== 'claim'` | 规则：解析抢牌响应前置阶段 | `this.phase.kind !== PHASE.CLAIM` |
| engine.js:484 | `this.phase = 'discard'` | 规则：执行吃碰后由抢牌者出牌 | `{ kind: PHASE.DISCARD, seat }` |
| engine.js:516 | `this.phase = 'discard'` | 规则：摸牌后出牌 | `{ kind: PHASE.DISCARD, seat }` |
| engine.js:561 | `this.phase === 'ended'` | 规则：结束后 AI 停止 | `this.phase.kind === PHASE.ENDED` |
| engine.js:562 | `this.phase === 'claim'` | 规则：AI 抢牌响应分支 | `this.phase.kind === PHASE.CLAIM` |
| engine.js:576 | `this.phase !== 'discard'` | 规则：AI 摸打前置阶段 | `this.phase.kind !== PHASE.DISCARD` |
| engine.js:622 | `this.phase = 'ended'` | 规则：胡牌结算结束 | `{ kind: PHASE.ENDED, result }` |
| engine.js:634 | `this.phase = 'ended'` | 规则：流局结束 | `{ kind: PHASE.ENDED, result }` |
| app.js:92 | `game.phase === 'discard'` | 展示/交互：判断是否启用玩家手牌操作 | `game.phase.kind === PHASE.DISCARD` |
| app.js:136 | `game.phase !== 'ended'` | 展示：座位活动高亮 | `game.phase.kind !== PHASE.ENDED` |
| app.js:138 | `game.phase === 'ended'` | 展示：座位结束状态文本 | `game.phase.kind === PHASE.ENDED` |
| app.js:138 | `game.phase === 'discard'` | 展示：座位出牌/思考状态文本 | `game.phase.kind === PHASE.DISCARD` |
| app.js:143 | `game.phase !== 'ended'` | 展示：中央方位活动高亮 | `game.phase.kind !== PHASE.ENDED` |
| app.js:150 | `game.phase === 'ended'` | 展示：主提示结束消息 | `game.phase.kind === PHASE.ENDED` |
| app.js:153 | `game.phase === 'claim'` | 展示：等待响应提示 | `game.phase.kind === PHASE.CLAIM` |
| app.js:155 | `game.phase !== 'ended'` | 展示：思考中样式 | `game.phase.kind !== PHASE.ENDED` |
| app.js:159 | `game.phase === 'ended'` | 展示：手牌操作说明 | `game.phase.kind === PHASE.ENDED` |
| app.js:161 | `game.phase === 'ended'` | 展示：每局仅弹一次结算 | `game.phase.kind === PHASE.ENDED` |
| app.js:172 | `game.phase === 'ended'` | 展示/调度：结束后停止 UI 侧 AI 定时器 | `game.phase.kind === PHASE.ENDED` |
| app.js:225 | `game.phase === 'discard'` | 展示/交互：杠按钮展示自家杠选择 | `game.phase.kind === PHASE.DISCARD` |
| app.js:238 | `game.phase !== 'ended'` | 展示：结算弹窗前置条件 | `game.phase.kind !== PHASE.ENDED` |
| app.js:293 | `game.phase === 'ended'` | 展示/交互：结束时重开按钮直接进入下一局 | `game.phase.kind === PHASE.ENDED` |

冻结源重点命中数（包括同一行的重复出现）：

| 文件 | 裸 `31` | 裸 `33` | 裸 `32` | `'discard'` | `'claim'` | `'ended'` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| engine.js | 13 | 3 | 1 | 7 | 7 | 4 |
| app.js | 8 | 0 | 0 | 3 | 1 | 10 |

`engine.js` 中两处裸 33 是合法牌码上界，仅 `294` 行的 33 是白板特判。

## engine.js 的玩家与牌状态读取点

范围包括公开状态、以 `seat`/`player`/`hand`/`river`/`meld` 取出的别名、传入纯函数的牌状态，以及规则派生的计数和动作。`push`、`pop`、`splice`、`sort`、`+=`、`++` 等依赖旧值的原地修改标为“读后修改”；单纯赋值初始化不计作读取。方法调用不重复列出其内部已审计的读取，但列出调用点直接取出的状态参数。

### 纯函数与派生牌状态

| 方法与原始行号 | 读取点 | 语义 | 作用及契约 |
| --- | --- | --- | --- |
| `tileName`：9–10 | `type` 合法性、数牌/字牌分界、点数、花色、字牌索引 | 展示 | 把牌码映射成中文名；不判断动作是否合法 |
| `tileSuit`：14 | `type` 花色分界及花色索引 | 规则 | `_finishWin` 用于清一色/字一色判定；保留旧接口返回字符串 |
| `validTile`：18；`nextWildTile`：23–24 | `type` 的类型、范围、花色与点数 | 规则 | 牌码校验和下一张癞子计算 |
| `countsOf`：28、30–31 | `hand` 数组类型及每一牌码；`counts[tile]` 自增前值（读后修改） | 规则 | 构建计数并拒绝非法牌码或超过四份 |
| `isSevenPairs`：37–38 | `hand`、`hand.length`、每种牌的计数及偶数性 | 规则 | 七对判定 |
| `isWinning`：43–49 | `meldCount`、`hand` 类型/长度/牌码、`wildTile` 合法性及 `counts[wildTile]` | 规则 | 胡牌输入契约和可替代牌份数；49 行只修改局部计数副本 |
| `isWinning`：51 | `meldCount`、`counts` 每种奇数份数、`wilds` | 规则 | 无副露时七对/癞子补对分支 |
| `groupsRemain`：54、57、60、62、64、66–75 | `counts` 首个非零牌、全部计数缓存键、刻子份数、顺子各张计数（局部读后修改/恢复） | 规则 | 四组分解；只改本次函数内计数副本 |
| `isWinning`：83–88 | `counts[pair]`、`wilds`、`meldCount`（局部计数读后修改/恢复） | 规则 | 枚举自然将牌与癞子补将 |
| `isWinning`：91 | `wilds`、`meldCount` | 规则 | 纯癞子将牌分支 |
| `canWin`：97 | `hand` 中红中、`hand`、`meldCount`、`wildTile` | 规则 | 实际胡牌资格额外限制 |
| `calculateShanten`：102–108 | `hand` 计数、`meldCount`、`wildTile`、`counts[wildTile]`、过滤后的自然牌 | 规则 | 向听/AI 估计；不是显示格式计算 |
| `calculateShanten`：112 | `counts[draw]`、`hand`、`meldCount`、`wildTile` | 规则 | 零向听时枚举精确获胜进张 |
| `visit`：122、127、130–149、152 | `counts[start]`、全部计数缓存键、相邻牌计数、刻子/对子/搭子的局部移除与恢复 | 规则 | 向听搜索；不修改玩家实际手牌 |
| `calculateShanten`：154–158 | `meldCount`、`hand` 的原始计数、每种牌可成的对子数 | 规则 | 初始搜索状态和七对距离 |
| `handShape`：164、168–177 | `hand` 计数、当前牌份数、字牌/数牌/点数、相邻与隔张份数 | 规则 | AI 牌形估值；原有权重必须保持 |
| `chooseDiscard`：185–189 | `hand` 类型/长度/计数、`melds` 或 `melds.length`、每张 `visible` 牌码、`seen[tile]` 自增前值 | 规则 | AI/hint 候选输入及可见份数 |
| `chooseDiscard`：194–201 | `wildTile`、`hand` 各张牌/索引/长度、候选是否红中或癞子、过滤后的剩余暗手 | 规则 | 过滤不可打牌和癞子保留策略 |
| `chooseDiscard`：202、204、209–210 | `remaining`、`meldCount`、`wildTile`、`seen[tile]`、`own[draw]`、`seen[draw]` | 规则 | 向听、牌形和有效进张份数排序 |
| `hasClaim`：237 | `actions.hu/peng/gang/chi.length` | 规则 | 判断是否必须等待响应 |
| `removeTiles`：241–247 | `hand` 副本、`tiles` 列表、每个牌码在副本中的位置、`hand.length`（最终读后修改） | 规则 | 原子式验证并移除一组实物牌 |
| `sameSequence`：252–253 | `left` 数组类型/长度、`right.length`、左侧排序副本牌码、`right[index]` | 规则 | 验证吃牌候选顺序无关地相同 |

### MahjongGame 持久状态与动作读取

| 方法与原始行号 | 读取点 | 语义 | 作用及契约 |
| --- | --- | --- | --- |
| `constructor`：263、265、269–270 | `options` 类型、`options.names[index]`、`options.laizi`、`options.seed` | 名称为展示；开关与种子为规则 | 读取外部初始化配置；构造器没有读取既有玩家状态 |
| `newRound`：275、277、279 | `this.laiziEnabled` 默认值；`this.round` 比较、自增和轮庄换算 | 规则 | 重新发牌是否保留轮次/庄家及场子开关 |
| `newRound`：281–283 | `this.wall.length`、`this._random()`、`this.wall[index/target]`（交换读后修改） | 规则 | 以现有随机序列洗牌 |
| `newRound`：288–289、293–294 | `this.laiziEnabled`、`this.wall` 的 pop/push/splice/lastIndexOf（读后修改） | 规则 | 取皮子与红中癞子例外的实际牌转移 |
| `newRound`：301、305、307 | `this.players` 枚举；`player.hand` 的 push/sort；`this.wall.pop()`（读后修改） | 规则 | 重置目标玩家集合、发牌及暗手排序；302 行各数组赋值本身仅写入 |
| `newRound`：308、318 | `this.dealer` | 规则 | 当前座位与庄家额外摸牌 |
| `newRound`：316 | `this.round`、`this.players[this.dealer].name` | 展示 | 开局 events 文本；姓名不影响规则 |
| `newRound`：317 | `this.laiziEnabled`、`this.indicatorTile`、`this.wildTile` | 展示 | 皮子/癞子 events 文本 |
| `_log`：323–324 | `this.events` 的 push、length、shift（读后修改） | 展示 | 保存最多 80 条用户可观察日志；兼为回归对照输出 |
| `_validPlayer`：328 | 参数 `player` 的整数性与范围 | 规则 | 座位合法性；没有读取玩家对象 |
| `_rawClaimActions`：333 | `this.phase`、`this.pendingDiscard` 是否存在及 `.from` | 规则 | 仅其他家可响应当前出牌 |
| `_rawClaimActions`：334–340 | `this.players[player]`、`pendingDiscard.tile`、`seat.hand`、`seat.melds.length`、`this.wildTile` | 规则 | 红中排除、胡牌资格和普通副露组数上限 |
| `_rawClaimActions`：341–343、348 | `counts[tile]`、`this.wall.length`、`pendingDiscard.from`、吃牌各候选计数 | 规则 | 碰/杠/吃资格；补牌余量；只能吃上家 |
| `_rawClaimActions`：352 | 派生 `actions.hu/peng/gang/chi.length`（经 `hasClaim`） | 规则 | 是否向该玩家提供过牌响应 |
| `getActions`：358–362 | `this.phase`、`this._responses[player]`、`this.current` | 规则 | 已结束、已响应或非当前座位时返回空动作 |
| `getActions`：363–366 | `this.players[player]`、`seat.hand`、`this.lastDraw.player`、`seat.melds.length`、`this.wildTile` | 规则 | 自摸资格要求当前确实摸过牌 |
| `getActions`：367–374 | `this.wall.length`、`counts[RED]`、`seat.melds.length`、每组 `meld.kind/tiles[0]`、对应手牌计数 | 规则 | 红中杠、暗杠和补杠候选 |
| `discard`：380–384 | `this.phase`、`this.current`、`this.players[player].hand.length`、`seat.hand[index]`、`seat.hand.splice`（读后修改） | 规则 | 回合、索引和禁打红中校验；牌从暗手移出 |
| `discard`：385 | `seat.discards.push`（读后修改） | 规则 | 实物牌加入该家牌河 |
| `discard`：390 | `seat.name`、移出的 `tile` | 展示 | 出牌 events 文本 |
| `claim`：398–403 | `getActions(player)` 派生动作、`this.phase`、`this.current`、`actions.hu/redGang` | 规则 | 自摸胡和红中杠资格 |
| `claim`：404–406 | `this.players[player]`、`seat.hand`、`seat.redGangs`（读后修改） | 规则 | 红中实物从暗手转移至独立记录 |
| `claim`：408 | `seat.name` | 展示 | 红中杠 events 文本 |
| `claim`：413–415 | `actions.concealedGangs/addedGangs`、传入 `tiles[0]` 或牌码、默认 `choices[0]`、`choices.includes(tile)` | 规则 | 校验自家杠选牌；保持旧签名默认选择行为 |
| `claim`：420–426 | `this.phase`、`this._responses[player]`、`actions.chi[0]` 与候选、`actions[action]`、传入 `tiles` | 规则 | 防重复响应，验证吃/碰/杠/胡后登记动作 |
| `pass`：434 | `this.phase`、`this._responses[player]`、`getActions(player).pass` | 规则 | 只能对有权响应且尚未响应的当前出牌过牌 |
| `_tryResolveClaims`：441、443 | `this.phase`、`this.pendingDiscard`、各家派生抢牌动作、`this._responses[player]` | 规则 | 等待所有必要的抢牌响应 |
| `_tryResolveClaims`：445、447–451 | `pendingDiscard.from`、`this._responses`、每条 `response.action`、响应者座位 | 规则 | 胡优先于碰杠优先于吃；同级按距离排序 |
| `_executeClaim`：462–465 | `response.player/action`、`pendingDiscard.tile/from`、`this.players[player]`、`this.players[from].discards` | 规则 | 确定抢牌者、来源与实物所在牌河 |
| `_executeClaim`：467–468 | `river.lastIndexOf(tile)`、`river.splice`（读后修改） | 规则 | 被抢的牌从牌河移除，禁止重复所有权 |
| `_executeClaim`：474–475、479、482–483 | `seat.hand` push/sort/remove、`response.tiles`、`seat.melds.push`（读后修改） | 规则 | 胡牌补入暗手，或从暗手扣牌并构造实际副露 |
| `_executeClaim`：485 | `seat.name`、被抢 `tile` 与 `action` | 展示 | 吃碰杠 events 文本 |
| `_executeClaim`：487 | `this.wall.length`、`seat.hand.length`、`seat.hand` 每张牌 | 规则 | 无补牌且仅剩红中的流局条件 |
| `_selfGang`：493、495–496、499–501 | `this.players[player]`、`seat.hand`、`seat.melds`、`group.kind/tiles[0]`、原 `meld.tiles`（读后修改） | 规则 | 暗杠扣四张；补杠扣一张并升级已有碰组 |
| `_selfGang`：497、502 | `seat.name`、杠出的 `tile` | 展示 | 暗杠/补杠 events 文本 |
| `_drawTile`：510、513–515 | `this.wall.length`、`this.wall.pop()`、`this.players[player].hand`、push/sort（读后修改） | 规则 | 检查流局并转移摸入实物牌 |
| `_drawTile`：517 | `hand.lastIndexOf(tile)` | 展示/交互元数据 | 记录摸入牌在排序暗手中的索引；`lastDraw.player` 另有自摸合法性用途 |
| `_drawTile`：518 | `this.players[player].name`、摸入 `tile`、参数 `player/replacement` | 展示 | 自己日志显示牌名，对手日志隐藏牌面 |
| `_drawTile`：519 | `this.wall.length`、`hand.length`、每张 `hand` 牌码 | 规则 | 无余牌且暗手只剩红中的流局条件 |
| `_visibleTiles`：527–528 | `this.indicatorTile`、`this.players`、各家 `discards/redGangs/melds`、每组 `meld.tiles` | 规则 | AI 只能使用已公开实物牌估算剩余份数；不是 UI 渲染读取 |
| `_botClaim`：533–535 | `actions.hu/gang`、`pendingDiscard.tile`、`this.wildTile` | 规则 | AI 优先胡、避免抢癞子、优先可用明杠 |
| `_botClaim`：536–538 | `this.players[player]`、`pendingDiscard.tile`、`seat.hand`、`seat.melds.length`、`this.wildTile` | 规则 | 抢牌前向听状态 |
| `_botClaim`：542–549、552 | `actions.peng/chi`、`seat.hand` 副本、`candidate.tiles/action`、`seat.melds` 副本、`this.wildTile`、公开牌 | 规则 | 模拟吃碰后出牌的效果；只修改候选副本 |
| `_botClaim`：553 | `this.wall.length`、`candidate.action` | 规则 | 保持原有 AI 余牌阈值策略 |
| `advanceAI`：561–563、566 | `this.phase`、`pendingDiscard.from`、`this._responses[player]` | 规则 | 结束检测及按顺序选择尚未响应的电脑 |
| `advanceAI`：567–571 | 派生 `actions`、`choice.action/tiles` | 规则 | 执行 AI 抢牌或过牌；内部状态读取见对应方法 |
| `advanceAI`：576–585 | `this.phase`、`this.current`、`actions.hu/redGang/concealedGangs/addedGangs`、`this.wildTile`、`this.players[player].hand/melds`、公开牌 | 规则 | AI 自家胡/杠/出牌优先序及候选选择 |
| `_finishWin`：594–595 | `this.players[winner]`、`seat.hand`、`seat.melds`、每组 `meld.tiles` | 规则 | 合并获胜者实际牌面供计分 |
| `_finishWin`：599–604、608–609 | `seat.hand`、`seat.melds.length`、每组 `meld.kind`、自然牌计数、合并牌的花色 | 规则 | 自然成牌、七对、碰碰胡、清一色/字一色的现有演示计分 |
| `_finishWin`：619 | `this.players[player].score`（`+=` 读后修改） | 规则 | 将现有演示分差写入累计积分 |
| `_finishWin`：626 | `seat.hand` 复制 | 展示/结果契约 | 保存获胜暗手快照，不新增实物牌所有权 |
| `_finishWin`：627 | `this.players[from].name` | 展示 | 点炮原因文案 |
| `_finishWin`：630 | `seat.name`、`this.result.patterns`、本地 `scoreDelta[winner]` | 展示 | 获胜 events 文本 |
| `_finishDraw`：633–643 | 无既有玩家/牌状态读取；仅使用传入或默认 `reason` 并调用 `_log` | 展示（原因文本）；结果写入属规则 | 本方法对 phase/result/winner 等为直接写入，不应误列为读取 |

补充边界：冻结源没有读取 `meld.from/concealed/added`、`lastDraw.tile/replacement/index` 来决定规则（`lastDraw.index` 由 UI 使用）；没有读取 `winner` 来决定引擎动作；`result` 仅在 630 行读取其 `patterns` 形成日志。`_responses`、`pendingDiscard`、`lastDraw` 是已有牌/动作的引用和元数据，不是额外实物牌。

## 不应当作牌码替换的数字

- `engine.js:38` 的 14、`304` 的 13 是手牌张数；`43–44、87、91、103、124、130、133、141、144、340、369` 的 4 是普通面子数量上限。
- `341–342` 的 2/3、`370` 的 4、`479` 的 4/3、`495–496` 的 4、`542` 的 3 是组成碰/杠/刻子的张数；不是 `TILE` 编码。它们可在另一个明确范围内抽取结构常量，本轮保持既有行为。
- `279、315、328、343、389、442、451、455–456、470、564–565、612、614、619` 的 4 是四人座位/响应/分数配置。实际 `model.js` 提供 `PLAYER_COUNT`；`player === 0` 中的 0 是人类座位，不是一万。
- `104、118、124、158` 的 8/6 是向听计算基值；`171` 的 7/6、`175–177` 的 0.12/2.3/1.1、`204` 的 3/0.2、`212` 的 10、`553` 的 48 是 AI 权重或阈值。
- `266` 的 1000、`324` 的 80 是起始分数、事件日志上限；`596–617` 的 10/20/30/3 是演示计分和三家支付倍率。
- `223–228` 的大整数、移位量和分母属于随机算法；不得为消除数字命中而修改。
- `app.js:36` 的 60/84 是 SVG viewBox；`121` 的 12/8 是牌河显示上限；其余音频频率、时长、定时器和座位数均非牌码。
- 数组索引 `[0]`、计数初始化 0、失败哨兵 -1、`splice(..., 1)` 的元素个数、排序差值均非牌码。

本报告只识别现有语义，不补充玩法或计分规则。


**2. 新增文件完整内容**

tile.js 集中编码；model.js 保留指定判别联合并补齐引擎契约；invariants.js 校验实牌、红中与阶段。HandTile 类型按骨架定义，当前 players[].hand 保持 TileCode[] 的既有接口。jsconfig 只对 engine.js 和 src/domain 做 strict/checkJs；DOM 与 Node 测试的全面类型迁移属于后续范围。

tests/fixtures/engine-before-domain.js 是修改前原样副本，仅供测试，不参与游戏加载；测试校验其 SHA256 不得变化：56093a20c2c02563463d7202dda9615c6c219f8423e771ea95b9d0e5cea57111。下面也附上完整内容以便独立复核基准。

### src/domain/tile.js

```js
// @ts-check

/** The only authority for the game's physical tile encoding. */
export const TILE = Object.freeze({
  MAN: 0, PIN: 9, SOU: 18,
  EAST: 27, SOUTH: 28, WEST: 29, NORTH: 30,
  RED: 31, GREEN: 32, WHITE: 33,
});

export const SUIT = Object.freeze({ MAN: 'man', PIN: 'pin', SOU: 'sou', HONOR: 'honor' });
const NUMBERED_SUITS = /** @type {const} */ ([SUIT.MAN, SUIT.PIN, SUIT.SOU]);
export const RED_DRAGON = TILE.RED;
export const SUIT_SIZE = 9;
export const HONOR_COUNT = 7;
export const TILE_TYPE_COUNT = 34;
export const COPIES_PER_TILE = 4;
export const TOTAL_TILE_COUNT = TILE_TYPE_COUNT * COPIES_PER_TILE;
export const MAX_SEQUENCE_START_RANK = SUIT_SIZE - 2;

/** @typedef {number} TileCode A tile kind encoded as an integer from 0 through 33. */
/** @typedef {typeof SUIT[keyof typeof SUIT]} Suit */

/**
 * @param {unknown} tile
 * @returns {tile is TileCode}
 */
export function isTileCode(tile) {
  return typeof tile === 'number' && Number.isInteger(tile) && tile >= TILE.MAN && tile < TILE_TYPE_COUNT;
}

/**
 * @param {TileCode} tile
 * @returns {boolean}
 */
export const isNumbered = tile => tile >= TILE.MAN && tile < TILE.EAST;

/**
 * @param {TileCode} tile
 * @returns {Suit}
 */
export const suitOf = tile => tile < TILE.EAST
  ? NUMBERED_SUITS[(tile / SUIT_SIZE) | 0]
  : SUIT.HONOR;

/**
 * Numbered ranks are 1..9; honor ranks follow east through white as 1..7.
 * @param {TileCode} tile
 * @returns {number}
 */
export const rankOf = tile => tile < TILE.EAST ? (tile % SUIT_SIZE) + 1 : tile - TILE.EAST + 1;

/**
 * The encoding base of a tile's suit, including the honor cycle.
 * @param {TileCode} tile
 * @returns {TileCode}
 */
export const suitStartOf = tile => tile < TILE.EAST ? ((tile / SUIT_SIZE) | 0) * SUIT_SIZE : TILE.EAST;

/**
 * Convert a suit and a one-based rank back to the physical tile encoding.
 * @param {Suit} suit
 * @param {number} rank
 * @returns {TileCode}
 */
export function tileCode(suit, rank) {
  const bases = { [SUIT.MAN]: TILE.MAN, [SUIT.PIN]: TILE.PIN, [SUIT.SOU]: TILE.SOU, [SUIT.HONOR]: TILE.EAST };
  const maximum = suit === SUIT.HONOR ? HONOR_COUNT : SUIT_SIZE;
  if (!Object.hasOwn(bases, suit) || !Number.isInteger(rank) || rank < 1 || rank > maximum) {
    throw new RangeError('A tile needs a known suit and a rank within that suit.');
  }
  return bases[suit] + rank - 1;
}
```

### src/domain/model.js

```js
// @ts-check

/** @typedef {import('./tile.js').TileCode} TileCode */
/** @typedef {0|1|2|3} PlayerId */

export const PLAYER_COUNT = 4;

export const PHASE = Object.freeze({
  DEALING: 'dealing', DISCARD: 'discard', CLAIM: 'claim', ENDED: 'ended',
});

export const ACTION = Object.freeze({
  DISCARD: 'discard', CHI: 'chi', PENG: 'peng', GANG: 'gang',
  RED_GANG: 'redGang', HU: 'hu', PASS: 'pass',
});

/**
 * @typedef {{kind:'chi', tiles:TileCode[], from:PlayerId, concealed:false}
 *          | {kind:'peng', tiles:TileCode[], from:PlayerId, concealed:false}
 *          | {kind:'gang', tiles:TileCode[], from:PlayerId, concealed:boolean, added?:boolean}} Meld
 */

/** @typedef {Pick<Meld, 'kind'|'tiles'>} MeldLike */
/** @typedef {{id:string, code:TileCode, drawn:boolean}} HandTile */
/** @typedef {{tile:TileCode, from:PlayerId}} PendingDiscard */
/** @typedef {{name:string, points:number}} ScoreBreakdown */

/**
 * @typedef {{kind:'win', type:'win', winner:PlayerId, from:PlayerId|null, selfDraw:boolean,
 *            points:number, scoreDelta:number[], patterns:string[], breakdown:ScoreBreakdown[],
 *            hand:TileCode[], reason:string, scoringNote:string}
 *          | {kind:'draw', type:'draw', winner:null, from:null, selfDraw:false,
 *            points:0, scoreDelta:number[], patterns:string[], breakdown:ScoreBreakdown[],
 *            reason:string, scoringNote:string}} GameResult
 */

/**
 * @typedef {{kind:'dealing', dealt:number}
 *          | {kind:'discard', seat:PlayerId}
 *          | {kind:'claim', discard:PendingDiscard}
 *          | {kind:'ended', result:GameResult}} Phase
 */

/**
 * @typedef {{kind:'discard', player:PlayerId, index:number}
 *          | {kind:'chi', player:PlayerId, sequence:TileCode[]}
 *          | {kind:'peng', player:PlayerId}
 *          | {kind:'gang', player:PlayerId, tile:TileCode, mode:'exposed'|'concealed'|'added'}
 *          | {kind:'redGang', player:PlayerId}
 *          | {kind:'hu', player:PlayerId, selfDraw:boolean}
 *          | {kind:'pass', player:PlayerId}} Action
 */

/**
 * @typedef {{name:string, hand:TileCode[], melds:Meld[], redGangs:TileCode[],
 *            discards:TileCode[], score:number}} PlayerState
 */

/**
 * The existing getActions result describes choices, rather than a submitted Action.
 * @typedef {{hu:boolean, peng:boolean, gang:boolean, redGang:boolean, chi:TileCode[][],
 *            pass:boolean, concealedGangs:TileCode[], addedGangs:TileCode[]}} AvailableActions
 */
/** @typedef {AvailableActions} Actions */

/**
 * @typedef {{action:'chi', tiles:TileCode[]}
 *          | {action:'hu', tiles?:undefined}
 *          | {action:'peng', tiles?:TileCode[]}
 *          | {action:'gang', tiles?:undefined}
 *          | {action:'pass', tiles?:undefined}} ClaimResponse
 */

/** @typedef {{player:PlayerId, tile:TileCode, index:number, replacement:boolean}} LastDraw */
/** @typedef {{seed?:unknown, names?:string[], laizi?:boolean}} GameOptions */
/** @typedef {{restart?:boolean, laizi?:boolean}} NewRoundOptions */

/**
 * The public state shape. Pending discard and last draw reference physical tiles
 * already owned by a river or a hand; they do not own additional copies.
 * @typedef {{players:PlayerState[], wall:TileCode[], phase:Phase, current:PlayerId,
 *            dealer:PlayerId, round:number, pendingDiscard:PendingDiscard|null,
 *            result:GameResult|null, winner:PlayerId|null, lastDraw:LastDraw|null,
 *            events:string[], laiziEnabled:boolean, indicatorTile:TileCode|null,
 *            wildTile:TileCode|null}} GameState
 */

/**
 * @param {unknown} player
 * @returns {player is PlayerId}
 */
export function isPlayerId(player) {
  return typeof player === 'number' && Number.isInteger(player) && player >= 0 && player < PLAYER_COUNT;
}
```

### src/domain/invariants.js

```js
// @ts-check

import { COPIES_PER_TILE, RED_DRAGON, TILE_TYPE_COUNT, TOTAL_TILE_COUNT, isTileCode } from './tile.js';
import { PHASE, PLAYER_COUNT, isPlayerId } from './model.js';

/** @typedef {import('./tile.js').TileCode} TileCode */
/** @typedef {import('./model.js').GameState} GameState */
/** @typedef {import('./model.js').Phase} Phase */

/**
 * Collect owning locations only, so a pending discard or last draw is not counted twice.
 * @param {GameState} state
 * @returns {TileCode[]}
 */
export function collectPhysicalTiles(state) {
  return [
    ...state.wall,
    ...state.players.flatMap(player => [
      ...player.hand, ...player.discards, ...player.redGangs,
      ...player.melds.flatMap(meld => meld.tiles),
    ]),
    ...(state.indicatorTile === null ? [] : [state.indicatorTile]),
  ];
}

/**
 * Check an explicit transition. Repeating a phase may update its payload or be a
 * no-op. A redeal passes through DEALING even when newRound is called mid-round.
 * @param {Phase} previous
 * @param {Phase} next
 * @returns {void}
 */
export function assertPhaseTransition(previous, next) {
  /** @type {Record<Phase['kind'], readonly Phase['kind'][]>} */
  const allowed = {
    [PHASE.DEALING]: [PHASE.DEALING, PHASE.DISCARD],
    [PHASE.DISCARD]: [PHASE.DISCARD, PHASE.CLAIM, PHASE.ENDED, PHASE.DEALING],
    [PHASE.CLAIM]: [PHASE.CLAIM, PHASE.DISCARD, PHASE.ENDED, PHASE.DEALING],
    [PHASE.ENDED]: [PHASE.ENDED, PHASE.DEALING],
  };
  if (!previous || !next || !allowed[previous.kind]?.includes(next.kind)) {
    throw new Error(`Illegal phase transition: ${previous?.kind} -> ${next?.kind}`);
  }
}

/**
 * Assert physical tile ownership and the rules represented in public state.
 * Pass the previous phase to validate a transition without hidden history.
 * @param {GameState} state
 * @param {Phase} [previousPhase]
 * @returns {void}
 */
export function assertInvariants(state, previousPhase) {
  if (state.players.length !== PLAYER_COUNT) throw new Error('A game needs exactly four players.');
  /** @type {number[]} */
  const counts = Array(TILE_TYPE_COUNT).fill(0);
  const tiles = collectPhysicalTiles(state);
  if (tiles.length !== TOTAL_TILE_COUNT) {
    throw new Error(`Tile conservation failed: expected ${TOTAL_TILE_COUNT}, received ${tiles.length}.`);
  }
  for (const tile of tiles) {
    if (!isTileCode(tile)) throw new Error(`Invalid physical tile code: ${tile}.`);
    if (++counts[tile] > COPIES_PER_TILE) throw new Error(`Tile ${tile} has more than ${COPIES_PER_TILE} copies.`);
  }
  if (!state.phase || !Object.values(PHASE).includes(state.phase.kind)) throw new Error('Unknown phase.');
  if (previousPhase) assertPhaseTransition(previousPhase, state.phase);
  if (state.phase.kind === PHASE.DISCARD) {
    if (!isPlayerId(state.phase.seat) || state.phase.seat !== state.current) {
      throw new Error('Discard phase must identify the current player.');
    }
  }
  if (state.phase.kind === PHASE.CLAIM) {
    const discard = state.pendingDiscard;
    if (!discard || !isPlayerId(discard.from) || !isTileCode(discard.tile) ||
        discard.tile !== state.phase.discard.tile || discard.from !== state.phase.discard.from ||
        state.players[discard.from].discards.at(-1) !== discard.tile) {
      throw new Error('Claim phase must identify the pending river tile.');
    }
  }
  if (state.phase.kind === PHASE.ENDED && (!state.result || state.phase.result.kind !== state.result.kind)) {
    throw new Error('Ended phase must include the game result.');
  }
  if (state.result?.kind === 'win') {
    const winner = state.result.winner;
    if (state.phase.kind !== PHASE.ENDED || !isPlayerId(winner) || state.winner !== winner) {
      throw new Error('A winning result must identify the ended game winner.');
    }
    if (state.players[winner].hand.includes(RED_DRAGON)) {
      throw new Error('A winning concealed hand cannot contain an undeclared red dragon.');
    }
  }
}
```

### jsconfig.json

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "strict": true,
    "noEmit": true,
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "node",
    "lib": ["es2022", "dom"]
  },
  "include": ["engine.js", "src/domain/**/*.js"]
}
```

### tests/domain-invariants.mjs

```js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as before from './fixtures/engine-before-domain.js';

const baselineOnly = process.env.MAHJONG_BASELINE_ONLY === '1';
const beforePath = new URL('./fixtures/engine-before-domain.js', import.meta.url);
const expectedBaselineHash = '56093a20c2c02563463d7202dda9615c6c219f8423e771ea95b9d0e5cea57111';

const hash = value => createHash('sha256').update(value).digest('hex');
const phaseKind = game => typeof game.phase === 'string' ? game.phase : game.phase.kind;

/** The exact pre-refactor seeded PRNG, extracted unchanged for action sampling. */
function makeRandom(seed) {
  let state = 2166136261;
  for (const letter of String(seed)) state = Math.imul(state ^ letter.charCodeAt(0), 16777619);
  if (!state) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Count physical owners only: pendingDiscard, lastDraw, result.hand are references. */
function physicalTiles(game) {
  return [
    ...game.wall,
    ...game.players.flatMap(player => [
      ...player.hand, ...player.discards, ...player.redGangs,
      ...player.melds.flatMap(meld => meld.tiles),
    ]),
    ...(game.indicatorTile === null ? [] : [game.indicatorTile]),
  ];
}

function assertPhysicalConservation(game) {
  const tiles = physicalTiles(game);
  assert.equal(tiles.length, 136, 'exactly 136 physical tiles are owned');
  const counts = Array(34).fill(0);
  for (const tile of tiles) {
    assert.ok(Number.isInteger(tile) && tile >= 0 && tile < 34, 'valid physical tile');
    assert.ok(++counts[tile] <= 4, `tile ${tile} has at most four copies`);
  }
  assert.deepEqual(counts, Array(34).fill(4));
  assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 4000);
}

function observableState(game) {
  return {
    round: game.round, dealer: game.dealer, current: game.current,
    phase: phaseKind(game), wall: game.wall, players: game.players,
    laiziEnabled: game.laiziEnabled, indicatorTile: game.indicatorTile, wildTile: game.wildTile,
    pendingDiscard: game.pendingDiscard, lastDraw: game.lastDraw,
    winner: game.winner, result: game.result,
  };
}

function assertEquivalent(oldGame, newGame, context) {
  // Compare the actual serialized text at every step, including the 80-entry rolling log.
  assert.equal(JSON.stringify(newGame.events), JSON.stringify(oldGame.events), `${context}: events bytes`);
  assert.deepEqual(observableState(newGame), observableState(oldGame), `${context}: observable state`);
  assertPhysicalConservation(oldGame);
  assertPhysicalConservation(newGame);
}

function legalActions(game) {
  const phase = phaseKind(game);
  if (phase === 'ended') return [];
  const choices = [];
  const seats = phase === 'claim' ? [0, 1, 2, 3] : [game.current];
  for (const player of seats) {
    const available = game.getActions(player);
    if (available.hu) choices.push({ kind: 'hu', player, selfDraw: phase === 'discard' });
    if (available.redGang) choices.push({ kind: 'redGang', player });
    for (const tile of available.concealedGangs) choices.push({ kind: 'gang', player, tile, mode: 'concealed' });
    for (const tile of available.addedGangs) choices.push({ kind: 'gang', player, tile, mode: 'added' });
    if (available.gang) choices.push({ kind: 'gang', player, tile: game.pendingDiscard.tile, mode: 'exposed' });
    if (available.peng) choices.push({ kind: 'peng', player });
    for (const sequence of available.chi) choices.push({ kind: 'chi', player, sequence: [...sequence] });
    if (available.pass) choices.push({ kind: 'pass', player });
    if (phase === 'discard') {
      game.players[player].hand.forEach((tile, index) => {
        if (tile !== 31) choices.push({ kind: 'discard', player, index });
      });
    }
  }
  return choices;
}

function chooseRandomAction(game, random) {
  const actions = legalActions(game);
  assert.ok(actions.length, `no legal action in ${phaseKind(game)}`);
  const wins = actions.filter(action => action.kind === 'hu');
  if (wins.length) return wins[Math.floor(random() * wins.length)];
  const special = actions.filter(action => action.kind === 'redGang' || action.kind === 'gang');
  if (special.length && random() < 0.75) return special[Math.floor(random() * special.length)];
  return actions[Math.floor(random() * actions.length)];
}

/** Execute the same typed command against the frozen old public API. */
function executeOld(game, action) {
  switch (action.kind) {
    case 'discard': return game.discard(action.player, action.index);
    case 'pass': return game.pass(action.player);
    case 'chi': return game.claim(action.player, 'chi', action.sequence);
    case 'gang': return game.claim(action.player,
      { exposed: 'gang', concealed: 'concealedGang', added: 'addedGang' }[action.mode], action.tile);
    default: return game.claim(action.player, action.kind);
  }
}

function recordAction(report, action) {
  const key = action.kind === 'gang' ? `gang:${action.mode}` : action.kind;
  report.actions[key] = (report.actions[key] ?? 0) + 1;
}

function playRandomPair(oldGame, newGame, random, checkInvariants, report, seed) {
  const transcript = createHash('sha256');
  let steps = 0;
  assertEquivalent(oldGame, newGame, `${seed}: deal`);
  checkInvariants(newGame);
  while (phaseKind(oldGame) !== 'ended') {
    assert.ok(steps < 1000, `${seed}: the round must finish`);
    const action = chooseRandomAction(oldGame, random);
    const previousPhase = structuredClone(newGame.phase);
    assert.equal(executeOld(oldGame, action), true, `${seed}: old legal action ${JSON.stringify(action)}`);
    const executed = baselineOnly ? executeOld(newGame, action) : newGame.applyAction(action.player, action);
    assert.equal(executed, true, `${seed}: new legal action ${JSON.stringify(action)}`);
    assertEquivalent(oldGame, newGame, `${seed}: step ${steps}`);
    checkInvariants(newGame, previousPhase);
    transcript.update(JSON.stringify(newGame.events));
    transcript.update('\n');
    recordAction(report, action);
    steps++;
  }
  assert.deepEqual(newGame.players.map(player => player.score), oldGame.players.map(player => player.score));
  assert.deepEqual(newGame.result, oldGame.result);
  report.steps += steps;
  report.results[oldGame.result.kind]++;
  const entry = {
    seed, steps, laizi: oldGame.laiziEnabled, round: oldGame.round, dealer: oldGame.dealer,
    result: oldGame.result.kind, scores: newGame.players.map(player => player.score),
    oldEventsSha256: hash(JSON.stringify(oldGame.events)),
    newEventsSha256: hash(JSON.stringify(newGame.events)),
    stepLogsSha256: transcript.digest('hex'),
  };
  report.rounds.push(entry);
}

/** AI calls are also compared, so the typed compatibility adapter stays covered. */
function playAIPair(oldGame, newGame, checkInvariants, report, seed) {
  let steps = 0;
  assertEquivalent(oldGame, newGame, `${seed}: AI deal`);
  checkInvariants(newGame);
  while (phaseKind(oldGame) !== 'ended') {
    assert.ok(steps < 1500, `${seed}: AI round must finish`);
    const previousPhase = structuredClone(newGame.phase);
    const available = oldGame.getActions(0);
    let oldResult;
    let newResult;
    if (phaseKind(oldGame) === 'claim' && available.pass) {
      const action = available.hu ? { kind: 'hu', player: 0, selfDraw: false } : { kind: 'pass', player: 0 };
      oldResult = executeOld(oldGame, action);
      newResult = baselineOnly ? executeOld(newGame, action) : newGame.applyAction(0, action);
      recordAction(report, action);
    } else if (phaseKind(oldGame) === 'discard' && oldGame.current === 0) {
      let action;
      if (available.hu) action = { kind: 'hu', player: 0, selfDraw: true };
      else if (available.redGang) action = { kind: 'redGang', player: 0 };
      else action = {
        kind: 'discard', player: 0,
        index: before.chooseDiscard(oldGame.players[0].hand, oldGame.players[0].melds, [], oldGame.wildTile),
      };
      oldResult = executeOld(oldGame, action);
      newResult = baselineOnly ? executeOld(newGame, action) : newGame.applyAction(0, action);
      recordAction(report, action);
    } else {
      oldResult = oldGame.advanceAI();
      newResult = newGame.advanceAI();
      report.aiCalls++;
    }
    assert.equal(oldResult, true, `${seed}: AI old progress`);
    assert.equal(newResult, true, `${seed}: AI new progress`);
    assertEquivalent(oldGame, newGame, `${seed}: AI step ${steps}`);
    checkInvariants(newGame, previousPhase);
    steps++;
  }
  report.aiSteps += steps;
}

function assertNegativeCases(NewGame, checkInvariants) {
  const missing = new NewGame({ seed: 'negative-missing' });
  missing.wall.pop();
  assert.throws(() => checkInvariants(missing), /./, 'lost physical tile must fail');

  const copies = new NewGame({ seed: 'negative-five-copies' });
  const removed = copies.wall[0];
  copies.wall[0] = (removed + 1) % 34;
  assert.throws(() => checkInvariants(copies), /./, 'five copies must fail even with total 136');

  const redWinner = new NewGame({ seed: 'negative-red-winner' });
  if (!redWinner.players[0].hand.includes(31)) {
    const index = redWinner.wall.indexOf(31);
    assert.ok(index >= 0);
    [redWinner.players[0].hand[0], redWinner.wall[index]] = [redWinner.wall[index], redWinner.players[0].hand[0]];
  }
  redWinner.winner = 0;
  redWinner.result = { kind: 'win', winner: 0 };
  redWinner.phase = { kind: 'ended', result: redWinner.result };
  assertPhysicalConservation(redWinner);
  assert.throws(() => checkInvariants(redWinner), /./, 'red dragon in winning concealed hand must fail');

  const transition = new NewGame({ seed: 'negative-phase' });
  assert.throws(() => checkInvariants(transition, { kind: 'ended', result: { kind: 'draw' } }), /./,
    'ended -> discard without a deal boundary must fail');
}

export async function runDomainRegression({ writeReport = true } = {}) {
  const source = await readFile(beforePath);
  assert.equal(hash(source), expectedBaselineHash, 'frozen pre-refactor engine must never change');
  const current = baselineOnly ? before : await import('../engine.js');
  const actionRandom = baselineOnly ? makeRandom : current.makeRandom;
  assert.equal(typeof actionRandom, 'function', 'reuse the engine seeded PRNG');
  if (!baselineOnly) {
    const originalRandom = makeRandom('domain-random-algorithm-proof');
    const domainRandom = actionRandom('domain-random-algorithm-proof');
    for (let index = 0; index < 1000; index++) assert.equal(domainRandom(), originalRandom(), 'seeded PRNG unchanged');
  }
  const checkInvariants = baselineOnly ? assertPhysicalConservation
    : (await import('../src/domain/invariants.js')).assertInvariants;
  const report = {
    mode: baselineOnly ? 'baseline-old-vs-old' : 'old-vs-domain',
    baselineSha256: expectedBaselineHash,
    randomRounds: 200, aiRounds: 8, steps: 0, aiSteps: 0, aiCalls: 0,
    results: { win: 0, draw: 0 }, actions: {}, rounds: [], failures: [],
  };
  for (const laizi of [false, true]) {
    const series = laizi ? 'wild' : 'normal';
    const oldGame = new before.MahjongGame({ seed: `domain-${series}-0`, laizi });
    const newGame = new current.MahjongGame({ seed: `domain-${series}-0`, laizi });
    for (let round = 0; round < 100; round++) {
      const seed = `domain-${series}-${round}`;
      if (round > 0) {
        const options = { restart: round % 9 === 0, laizi };
        oldGame.newRound(seed, options);
        newGame.newRound(seed, options);
      }
      playRandomPair(oldGame, newGame, actionRandom(`${seed}:actions`), checkInvariants, report, seed);
    }
  }
  for (let round = 0; round < 8; round++) {
    const seed = `domain-ai-${round}`;
    const options = { seed, laizi: round >= 4 };
    playAIPair(new before.MahjongGame(options), new current.MahjongGame(options), checkInvariants, report, seed);
  }
  if (!baselineOnly) {
    assertNegativeCases(current.MahjongGame, checkInvariants);
    report.negativeCases = ['lost-tile', 'five-copies', 'red-winning-hand', 'illegal-phase-transition'];
  }
  for (const kind of ['discard', 'chi', 'peng', 'gang:exposed', 'gang:concealed', 'gang:added', 'redGang', 'hu', 'pass']) {
    assert.ok(report.actions[kind] > 0, `sample must exercise ${kind}`);
  }
  if (writeReport) {
    const output = new URL('../output/', import.meta.url);
    await mkdir(output, { recursive: true });
    await writeFile(new URL('domain-invariants-report.json', output), JSON.stringify(report, null, 2) + '\n');
    if (baselineOnly) await writeFile(new URL('domain-invariants-baseline-report.json', output), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runDomainRegression();
  console.log(`PASS ${report.mode}: ${report.randomRounds} seeded random rounds, ${report.steps} random steps; ${report.aiRounds} AI rounds, ${report.aiSteps} AI steps.`);
  console.log(`Action coverage: ${JSON.stringify(report.actions)}`);
  console.log(`Result coverage: ${JSON.stringify(report.results)}`);
  console.log(`Every step: 136 physical tiles, at most 4 copies, identical events bytes, scores and physical state.`);
  console.log(`Sample logs SHA256: ${JSON.stringify(report.rounds[0])}`);
  console.log('Report: output/domain-invariants-report.json');
}
```

### tests/domain.test.js

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runDomainRegression } from './domain-invariants.mjs';
import { MahjongGame as CurrentGame } from '../engine.js';
import { MahjongGame as OldGame } from './fixtures/engine-before-domain.js';
import { assertInvariants } from '../src/domain/invariants.js';

test('domain migration preserves 200 seeded rounds, every physical tile, logs, scores and AI decisions', async () => {
  await runDomainRegression();
});

function preparedGame(Game, { hand, melds = [], discard = null }) {
  const game = new Game({ seed: 'domain-adapter-fixture' });
  const objectPhase = typeof game.phase === 'object';
  const remaining = Array(34).fill(4);
  for (const player of game.players) {
    player.hand = []; player.melds = []; player.redGangs = []; player.discards = [];
  }
  game.players[0].hand = [...hand].sort((a, b) => a - b);
  game.players[0].melds = structuredClone(melds);
  for (const tile of [...hand, ...melds.flatMap(meld => meld.tiles)]) assert.ok(--remaining[tile] >= 0);
  if (discard !== null) {
    game.players[3].discards.push(discard);
    assert.ok(--remaining[discard] >= 0);
  }
  for (let seat = 1; seat < 4; seat++) {
    for (let draw = 0; draw < 13; draw++) {
      const tile = remaining.findIndex(count => count > 0);
      game.players[seat].hand.push(tile);
      remaining[tile]--;
    }
  }
  game.wall = remaining.flatMap((count, tile) => Array(count).fill(tile));
  game.current = discard === null ? 0 : 3;
  game.pendingDiscard = discard === null ? null : { tile: discard, from: 3 };
  game.phase = objectPhase
    ? discard === null ? { kind: 'discard', seat: 0 } : { kind: 'claim', discard: game.pendingDiscard }
    : discard === null ? 'discard' : 'claim';
  game.lastDraw = discard === null
    ? { player: 0, tile: game.players[0].hand.at(-1), index: game.players[0].hand.length - 1, replacement: false }
    : null;
  game.winner = null;
  game.result = null;
  game.events = [];
  game._responses = Array(4).fill(null);
  return game;
}

function assertAdapterState(oldGame, newGame) {
  assert.equal(JSON.stringify(newGame.events), JSON.stringify(oldGame.events));
  for (const key of ['players', 'wall', 'current', 'pendingDiscard', 'lastDraw', 'result', 'winner']) {
    assert.deepEqual(newGame[key], oldGame[key], key);
  }
  assert.equal(newGame.phase.kind, oldGame.phase);
  assertInvariants(newGame);
}

for (const [mode, aliases, hand, melds] of [
  ['concealed', ['concealedGang', 'concealed-gang', 'anGang'],
    [1, 1, 1, 1, 0, 2, 3, 9, 10, 11, 18, 19, 20, 27], []],
  ['added', ['addedGang', 'added-gang', 'buGang'],
    [1, 0, 2, 3, 9, 10, 11, 18, 19, 20, 27],
    [{ kind: 'peng', tiles: [1, 1, 1], from: 3, concealed: false }]],
]) {
  test(`deprecated claim preserves ${mode} kong aliases and omitted/scalar/array tile defaults`, () => {
    for (const alias of aliases) {
      for (const tiles of [undefined, 1, [1]]) {
        const oldGame = preparedGame(OldGame, { hand, melds });
        const newGame = preparedGame(CurrentGame, { hand, melds });
        assert.equal(oldGame.claim(0, alias, tiles), true);
        assert.equal(newGame.claim(0, alias, tiles), true);
        assertAdapterState(oldGame, newGame);
      }
    }
  });
}

test('deprecated claim preserves the default first chi sequence', () => {
  const options = { hand: [0, 2, 3, 5, 7, 9, 11, 13, 15, 18, 20, 22, 27], discard: 1 };
  const oldGame = preparedGame(OldGame, options);
  const newGame = preparedGame(CurrentGame, options);
  assert.equal(oldGame.claim(0, 'chi'), true);
  assert.equal(newGame.claim(0, 'chi'), true);
  assertAdapterState(oldGame, newGame);
  for (let seat = 1; seat < 4; seat++) {
    if (oldGame.getActions(seat).pass) {
      assert.equal(oldGame.pass(seat), true);
      assert.equal(newGame.pass(seat), true);
      assertAdapterState(oldGame, newGame);
    }
  }
});

test('typed actions reject malformed or mismatched commands without mutating the game', () => {
  const game = new CurrentGame({ seed: 'domain-action-validation' });
  const snapshot = JSON.stringify(game);
  const invalidActions = [
    null, undefined, 'discard', {}, { kind: 'unknown', player: 0 },
    { kind: 'discard', player: 1, index: 0 },
    { kind: 'discard', player: 0, index: -1 },
    { kind: 'discard', player: 0, index: '0' },
    { kind: 'gang', player: 0, tile: 1, mode: 'invalid' },
    { kind: 'gang', player: 0, tile: 1 },
    { kind: 'chi', player: 0, sequence: '012' },
    { kind: 'chi', player: 0, sequence: [0, 1] },
  ];
  for (const action of invalidActions) {
    assert.equal(game.applyAction(0, action), false, JSON.stringify(action));
    assert.equal(JSON.stringify(game), snapshot, 'rejected action has no observable side effects');
  }
  assertInvariants(game);
});
```

### tests/tile-domain.test.js

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TILE, SUIT, TILE_TYPE_COUNT, isTileCode, isNumbered, suitOf, rankOf, tileCode,
} from '../src/domain/tile.js';
import { tileName, tileSuit, nextWildTile } from '../engine.js';
import * as before from './fixtures/engine-before-domain.js';

test('tile and suit constants are frozen public contracts', () => {
  assert.ok(Object.isFrozen(TILE));
  assert.ok(Object.isFrozen(SUIT));
  assert.throws(() => { TILE.RED = TILE.WHITE; }, TypeError);
  assert.throws(() => { SUIT.MAN = 'other'; }, TypeError);
});

test('every physical tile encoding roundtrips through its suit and one-based rank', () => {
  const encodings = new Set();
  for (let code = TILE.MAN; code < TILE_TYPE_COUNT; code++) {
    assert.ok(isTileCode(code), `legal tile ${code}`);
    const restored = tileCode(suitOf(code), rankOf(code));
    assert.equal(restored, code, `roundtrip tile ${code}`);
    encodings.add(restored);
  }
  assert.equal(encodings.size, TILE_TYPE_COUNT);
});

test('suit boundaries keep one-based ranks and honors in their own cycle', () => {
  const boundaries = [
    [TILE.MAN, SUIT.MAN, 1, true], [TILE.PIN - 1, SUIT.MAN, 9, true],
    [TILE.PIN, SUIT.PIN, 1, true], [TILE.SOU - 1, SUIT.PIN, 9, true],
    [TILE.SOU, SUIT.SOU, 1, true], [TILE.EAST - 1, SUIT.SOU, 9, true],
    [TILE.EAST, SUIT.HONOR, 1, false], [TILE.RED, SUIT.HONOR, 5, false],
    [TILE.GREEN, SUIT.HONOR, 6, false], [TILE.WHITE, SUIT.HONOR, 7, false],
  ];
  for (const [code, suit, rank, numbered] of boundaries) {
    assert.equal(suitOf(code), suit);
    assert.equal(rankOf(code), rank);
    assert.equal(isNumbered(code), numbered);
    assert.equal(tileCode(suit, rank), code);
  }
});

test('invalid codes and suit-rank combinations cannot enter the tile domain', () => {
  for (const code of [-1, TILE_TYPE_COUNT, 1.5, NaN, Infinity, -Infinity, null, undefined, '1', true, {}, []]) {
    assert.equal(isTileCode(code), false, `reject ${String(code)}`);
  }
  for (const [suit, rank] of [
    [SUIT.MAN, 0], [SUIT.PIN, 10], [SUIT.SOU, 1.5], [SUIT.HONOR, 8],
    [SUIT.MAN, NaN], ['unknown', 1], ['toString', 1], ['constructor', 1], ['__proto__', 1],
  ]) {
    assert.throws(() => tileCode(suit, rank), RangeError, `reject ${suit} rank ${rank}`);
  }
});

test('all legacy tile names, suit labels and wild cycles match the frozen pre-migration engine', () => {
  for (let code = TILE.MAN; code < TILE_TYPE_COUNT; code++) {
    assert.equal(tileName(code), before.tileName(code), `name ${code}`);
    assert.equal(tileSuit(code), before.tileSuit(code), `legacy suit ${code}`);
    assert.equal(nextWildTile(code), before.nextWildTile(code), `wild cycle ${code}`);
  }
  for (const code of [-10, -1, 0.5, 26.5, 33.5, TILE_TYPE_COUNT, NaN, Infinity, null, undefined, '9']) {
    assert.equal(tileName(code), before.tileName(code), `invalid name ${String(code)}`);
    assert.equal(tileSuit(code), before.tileSuit(code), `invalid legacy suit ${String(code)}`);
    assert.equal(nextWildTile(code), before.nextWildTile(code), `invalid wild ${String(code)}`);
  }
});
```

### tests/fixtures/engine-before-domain.js

```js
/** Dependency-free rules and turn orchestration for the four-seat teaching game. */

const SUIT_NAMES = ['万', '筒', '条'];
const NUM_NAMES = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR_NAMES = ['东', '南', '西', '北', '中', '发', '白'];
const DEFAULT_NAMES = ['你', '云舟', '阿福', '小棠'];

export function tileName(type) {
  if (!Number.isInteger(type) || type < 0 || type > 33) return '未知牌';
  return type < 27 ? NUM_NAMES[type % 9] + SUIT_NAMES[Math.floor(type / 9)] : HONOR_NAMES[type - 27];
}

export function tileSuit(type) {
  return type >= 27 ? 'honor' : ['wan', 'tong', 'tiao'][Math.floor(type / 9)];
}

function validTile(type) {
  return Number.isInteger(type) && type >= 0 && type < 34;
}

/** Numbered suits wrap at nine; all seven honors share one cycle. */
export function nextWildTile(type) {
  if (!validTile(type)) return null;
  return type < 27 ? Math.floor(type / 9) * 9 + (type + 1) % 9 : 27 + (type - 26) % 7;
}

function countsOf(hand) {
  if (!Array.isArray(hand)) return null;
  const counts = Array(34).fill(0);
  for (const tile of hand) {
    if (!Number.isInteger(tile) || tile < 0 || tile > 33 || ++counts[tile] > 4) return null;
  }
  return counts;
}

function isSevenPairs(hand) {
  const counts = countsOf(hand);
  return hand.length === 14 && counts && counts.every(count => count % 2 === 0);
}

/** Standard four groups + a pair, or seven pairs with no exposed groups. */
export function isWinning(hand, meldCount = 0, wildTile = null) {
  if (!Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4 ||
      !Array.isArray(hand) || hand.length !== (4 - meldCount) * 3 + 2 ||
      (wildTile !== null && !validTile(wildTile))) return false;
  const counts = countsOf(hand);
  if (!counts) return false;
  const wilds = wildTile === null ? 0 : counts[wildTile];
  if (wildTile !== null) counts[wildTile] = 0;
  // In this teaching variant a four-of-a-kind can supply two of the seven pairs.
  if (meldCount === 0 && counts.reduce((odd, count) => odd + count % 2, 0) <= wilds) return true;
  const memo = new Map();
  function groupsRemain(groups, remainingWilds) {
    const first = counts.findIndex(count => count > 0);
    if (first < 0) return remainingWilds === groups * 3;
    if (groups === 0) return false;
    const key = counts.join('') + ':' + groups + ':' + remainingWilds;
    if (memo.has(key)) return memo.get(key);
    let matched = false;
    const naturalTriple = Math.min(3, counts[first]);
    if (3 - naturalTriple <= remainingWilds) {
      counts[first] -= naturalTriple;
      matched = groupsRemain(groups - 1, remainingWilds - (3 - naturalTriple));
      counts[first] += naturalTriple;
    }
    if (!matched && first < 27) {
      const suitStart = Math.floor(first / 9) * 9;
      // A wild can precede the first natural tile, e.g. wild, eight, nine.
      for (let start = Math.max(suitStart, first - 2); start <= Math.min(first, suitStart + 6); start++) {
        const natural = [start, start + 1, start + 2].filter(tile => counts[tile] > 0);
        const neededWilds = 3 - natural.length;
        if (neededWilds > remainingWilds) continue;
        for (const tile of natural) counts[tile]--;
        matched = groupsRemain(groups - 1, remainingWilds - neededWilds);
        for (const tile of natural) counts[tile]++;
        if (matched) break;
      }
    }
    memo.set(key, matched);
    return matched;
  }
  for (let pair = 0; pair < 34; pair++) {
    if (!counts[pair]) continue;
    const natural = Math.min(2, counts[pair]);
    if (2 - natural > wilds) continue;
    counts[pair] -= natural;
    const matched = groupsRemain(4 - meldCount, wilds - (2 - natural));
    counts[pair] += natural;
    if (matched) return true;
  }
  return wilds >= 2 && groupsRemain(4 - meldCount, wilds - 2);
}

// Red dragons are dedicated single-tile kong tiles. They cannot be discarded,
// and every concealed red must be declared before Hu.
function canWin(hand, meldCount, wildTile) {
  return !hand.includes(31) && isWinning(hand, meldCount, wildTile);
}

/** -1 means complete, 0 means one winning draw away. Used only by the AI/hint. */
export function calculateShanten(hand, meldCount = 0, wildTile = null) {
  const counts = countsOf(hand);
  if (!counts || !Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4 ||
      (wildTile !== null && !validTile(wildTile))) return 8;
  if (wildTile !== null && counts[wildTile] > 0) {
    if (isWinning(hand, meldCount, wildTile)) return -1;
    const natural = hand.filter(tile => tile !== wildTile);
    const estimate = Math.max(0, calculateShanten(natural, meldCount) - counts[wildTile]);
    if (estimate === 0) {
      // Validate ready hands exactly; farther distances remain a compact AI heuristic.
      for (let draw = 0; draw < 34; draw++) {
        if (counts[draw] < 4 && isWinning([...hand, draw], meldCount, wildTile)) return 0;
      }
      return 1;
    }
    return estimate;
  }
  let best = 8;
  const visited = new Set();
  function visit(start, groups, partials, pair) {
    if (best === -1) return;
    while (start < 34 && counts[start] === 0) start++;
    if (start === 34) {
      best = Math.min(best, 8 - 2 * groups - Math.min(partials, 4 - groups) - pair);
      return;
    }
    const key = counts.join('') + ':' + groups + ':' + partials + ':' + pair;
    if (visited.has(key)) return;
    visited.add(key);
    if (groups < 4 && counts[start] >= 3) {
      counts[start] -= 3; visit(start, groups + 1, partials, pair); counts[start] += 3;
    }
    if (groups < 4 && start < 27 && start % 9 <= 6 && counts[start + 1] && counts[start + 2]) {
      counts[start]--; counts[start + 1]--; counts[start + 2]--;
      visit(start, groups + 1, partials, pair);
      counts[start]++; counts[start + 1]++; counts[start + 2]++;
    }
    if (counts[start] >= 2) {
      counts[start] -= 2;
      if (!pair) visit(start, groups, partials, 1);
      if (partials < 4) visit(start, groups, partials + 1, pair);
      counts[start] += 2;
    }
    if (partials < 4 && start < 27) {
      for (const distance of [1, 2]) {
        if (start % 9 + distance > 8 || !counts[start + distance]) continue;
        counts[start]--; counts[start + distance]--;
        visit(start, groups, partials + 1, pair);
        counts[start]++; counts[start + distance]++;
      }
    }
    counts[start]--; visit(start, groups, partials, pair); counts[start]++;
  }
  visit(0, meldCount, 0, 0);
  if (meldCount === 0) {
    const original = countsOf(hand);
    const pairs = original.reduce((total, count) => total + Math.floor(count / 2), 0);
    best = Math.min(best, 6 - pairs);
  }
  return best;
}

function handShape(hand) {
  const counts = countsOf(hand);
  if (!counts) return -1000;
  let value = 0;
  for (let tile = 0; tile < 34; tile++) {
    const count = counts[tile];
    if (!count) continue;
    if (count >= 3) value += 12;
    else if (count === 2) value += tile >= 27 ? 7 : 6;
    else if (tile >= 27) value -= 3;
    if (tile < 27) {
      const rank = tile % 9;
      value += count * (rank >= 2 && rank <= 6 ? 0.12 : 0);
      if (rank <= 7) value += Math.min(count, counts[tile + 1]) * 2.3;
      if (rank <= 6) value += Math.min(count, counts[tile + 2]) * 1.1;
    }
  }
  return value;
}

/** Returns a legal discard index, or -1 when no discard is possible. */
export function chooseDiscard(hand, melds = [], visible = [], wildTile = null) {
  if (!Array.isArray(hand) || hand.length === 0) return -1;
  const meldCount = Number.isInteger(melds) ? melds : melds.length;
  const seen = Array(34).fill(0);
  for (const tile of visible) if (Number.isInteger(tile) && tile >= 0 && tile < 34) seen[tile]++;
  const own = countsOf(hand) || Array(34).fill(0);
  let bestIndex = -1;
  let bestDistance = Infinity;
  let bestValue = -Infinity;
  const visited = new Set();
  const keepWilds = validTile(wildTile) && hand.some(tile => tile !== 31 && tile !== wildTile);
  for (let index = 0; index < hand.length; index++) {
    const tile = hand[index];
    if (tile === 31) continue;
    if (keepWilds && tile === wildTile) continue;
    if (visited.has(tile)) continue;
    visited.add(tile);
    const remaining = hand.filter((_, position) => position !== index);
    const distance = calculateShanten(remaining, meldCount, wildTile);
    if (distance > bestDistance) continue;
    let value = handShape(wildTile === null ? remaining : remaining.filter(value => value !== wildTile)) + Math.min(seen[tile], 3) * 0.2;
    if (distance === 0) {
      // Prefer a ready hand whose winning tiles still have copies outside it.
      let winningCopies = 0;
      for (let draw = 0; draw < 34; draw++) {
        if (isWinning([...remaining, draw], meldCount, wildTile)) {
          winningCopies += Math.max(0, 4 - own[draw] - seen[draw]);
        }
      }
      value += winningCopies * 10;
    }
    if (distance < bestDistance || value > bestValue) {
      bestIndex = index; bestDistance = distance; bestValue = value;
    }
  }
  return bestIndex;
}

function makeRandom(seed) {
  let state = 2166136261;
  for (const letter of String(seed)) state = Math.imul(state ^ letter.charCodeAt(0), 16777619);
  if (!state) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function emptyActions() {
  return { hu: false, peng: false, gang: false, redGang: false, chi: [], pass: false, concealedGangs: [], addedGangs: [] };
}

function hasClaim(actions) {
  return actions.hu || actions.peng || actions.gang || actions.chi.length > 0;
}

function removeTiles(hand, tiles) {
  const remaining = [...hand];
  for (const tile of tiles) {
    const index = remaining.indexOf(tile);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  hand.splice(0, hand.length, ...remaining);
  return true;
}

function sameSequence(left, right) {
  return Array.isArray(left) && left.length === right.length &&
    [...left].sort((a, b) => a - b).every((tile, index) => tile === right[index]);
}

/**
 * Human is seat 0. Call advanceAI() until it returns false after each human move.
 * Claim responses are collected before priority is resolved; a lower claim can lose.
 * No flower tiles, dead wall, multiple winners, or robbing an added kong in this variant.
 */
export class MahjongGame {
  constructor(options = {}) {
    if (typeof options !== 'object' || options === null) options = { seed: options };
    this.players = DEFAULT_NAMES.map((name, index) => ({
      name: options.names?.[index] || name,
      hand: [], melds: [], redGangs: [], discards: [], score: 1000,
    }));
    this.round = 0;
    this.laiziEnabled = Boolean(options.laizi);
    this._random = makeRandom(options.seed ?? `${Date.now()}-${Math.random()}`);
    this.newRound();
  }

  /** A restart redeals the current round; a new round rotates the dealer counterclockwise. */
  newRound(seed, { restart = false, laizi = this.laiziEnabled } = {}) {
    if (seed !== undefined) this._random = makeRandom(seed);
    if (!restart || this.round === 0) this.round++;
    // Seats are bottom (0), right (1), top (2), and left (3).
    this.dealer = (this.round - 1) % 4;
    this.wall = Array.from({ length: 136 }, (_, index) => Math.floor(index / 4));
    for (let index = this.wall.length - 1; index > 0; index--) {
      const target = Math.floor(this._random() * (index + 1));
      [this.wall[index], this.wall[target]] = [this.wall[target], this.wall[index]];
    }
    this.laiziEnabled = Boolean(laizi);
    this.indicatorTile = null;
    this.wildTile = null;
    if (this.laiziEnabled) {
      const candidate = this.wall.pop();
      if (nextWildTile(candidate) === 31) {
        // A red-dragon wildcard conflicts with its special kong role. This
        // table instead exposes a real white dragon and uses green as wild.
        this.wall.push(candidate);
        this.indicatorTile = this.wall.splice(this.wall.lastIndexOf(33), 1)[0];
        this.wildTile = 32;
      } else {
        this.indicatorTile = candidate;
        this.wildTile = nextWildTile(candidate);
      }
    }
    for (const player of this.players) {
      player.hand = []; player.melds = []; player.redGangs = []; player.discards = [];
    }
    for (let deal = 0; deal < 13; deal++) {
      for (const player of this.players) player.hand.push(this.wall.pop());
    }
    for (const player of this.players) player.hand.sort((a, b) => a - b);
    this.current = this.dealer;
    this.phase = 'discard';
    this.pendingDiscard = null;
    this.winner = null;
    this.result = null;
    this.lastDraw = null;
    this.events = [];
    this._responses = Array(4).fill(null);
    this._log(`第 ${this.round} 局开始，${this.players[this.dealer].name}坐庄，庄家先出牌。`);
    if (this.laiziEnabled) this._log(`翻出皮子${tileName(this.indicatorTile)}，${tileName(this.wildTile)}为本局癞子。`);
    this._drawTile(this.dealer);
    return this;
  }

  _log(message) {
    this.events.push(message);
    if (this.events.length > 80) this.events.shift();
  }

  _validPlayer(player) {
    return Number.isInteger(player) && player >= 0 && player < 4;
  }

  _rawClaimActions(player) {
    const actions = emptyActions();
    if (this.phase !== 'claim' || !this.pendingDiscard || !this._validPlayer(player) || player === this.pendingDiscard.from) return actions;
    const seat = this.players[player];
    const tile = this.pendingDiscard.tile;
    if (tile === 31) return actions;
    const counts = countsOf(seat.hand);
    if (!counts) return actions;
    actions.hu = canWin([...seat.hand, tile], seat.melds.length, this.wildTile);
    if (seat.melds.length < 4) {
      actions.peng = counts[tile] >= 2;
      actions.gang = counts[tile] >= 3 && this.wall.length > 0;
      if (player === (this.pendingDiscard.from + 1) % 4 && tile < 27) {
        for (let start = tile - 2; start <= tile; start++) {
          if (start < 0 || Math.floor(start / 9) !== Math.floor(tile / 9) || start % 9 > 6) continue;
          const sequence = [start, start + 1, start + 2];
          const needed = sequence.filter(value => value !== tile);
          if (needed.every(value => counts[value] > 0)) actions.chi.push(sequence);
        }
      }
    }
    actions.pass = hasClaim(actions);
    return actions;
  }

  getActions(player = 0) {
    const actions = emptyActions();
    if (!this._validPlayer(player) || this.phase === 'ended') return actions;
    if (this.phase === 'claim') {
      return this._responses[player] ? actions : this._rawClaimActions(player);
    }
    if (this.phase !== 'discard' || this.current !== player) return actions;
    const seat = this.players[player];
    const counts = countsOf(seat.hand);
    if (!counts) return actions;
    actions.hu = this.lastDraw?.player === player && canWin(seat.hand, seat.melds.length, this.wildTile);
    if (this.wall.length > 0) {
      actions.redGang = counts[31] > 0;
      if (seat.melds.length < 4) {
        actions.concealedGangs = counts.flatMap((count, tile) => count === 4 && tile !== 31 ? [tile] : []);
      }
      actions.addedGangs = seat.melds
        .filter(meld => meld.kind === 'peng' && meld.tiles[0] !== 31 && counts[meld.tiles[0]] > 0)
        .map(meld => meld.tiles[0]);
    }
    return actions;
  }

  discard(player, index) {
    if (!this._validPlayer(player) || this.phase !== 'discard' || this.current !== player ||
        !Number.isInteger(index) || index < 0 || index >= this.players[player].hand.length) return false;
    const seat = this.players[player];
    if (seat.hand[index] === 31) return false;
    const [tile] = seat.hand.splice(index, 1);
    seat.discards.push(tile);
    this.pendingDiscard = { tile, from: player };
    this.phase = 'claim';
    this.lastDraw = null;
    this._responses = Array(4).fill(null);
    this._log(`${seat.name}打出${tileName(tile)}。`);
    this._tryResolveClaims();
    return true;
  }

  claim(player, action, tiles) {
    if (!this._validPlayer(player)) return false;
    action = ({ 'concealed-gang': 'concealedGang', 'added-gang': 'addedGang', 'anGang': 'concealedGang', 'buGang': 'addedGang' })[action] || action;
    const actions = this.getActions(player);
    if (this.phase === 'discard' && this.current === player) {
      if (action === 'hu' && actions.hu) {
        this._finishWin(player, null, true); return true;
      }
      if (action === 'redGang' && actions.redGang) {
        const seat = this.players[player];
        removeTiles(seat.hand, [31]);
        seat.redGangs.push(31);
        this.lastDraw = null;
        this._log(`${seat.name}红中杠，补摸一张牌。`);
        this._drawTile(player, true);
        return true;
      }
      if (action === 'concealedGang' || action === 'addedGang') {
        const choices = action === 'concealedGang' ? actions.concealedGangs : actions.addedGangs;
        const tile = Array.isArray(tiles) ? tiles[0] : tiles ?? choices[0];
        if (!choices.includes(tile)) return false;
        this._selfGang(player, action, tile); return true;
      }
      return false;
    }
    if (this.phase !== 'claim' || this._responses[player]) return false;
    if (action === 'chi') {
      const sequence = tiles ?? actions.chi[0];
      const selected = actions.chi.find(candidate => sameSequence(sequence, candidate));
      if (!selected) return false;
      this._responses[player] = { action, tiles: [...selected] };
    } else if (['hu', 'peng', 'gang'].includes(action) && actions[action]) {
      this._responses[player] = { action };
    } else return false;
    this._tryResolveClaims();
    return true;
  }

  pass(player = 0) {
    if (!this._validPlayer(player) || this.phase !== 'claim' || this._responses[player] || !this.getActions(player).pass) return false;
    this._responses[player] = { action: 'pass' };
    this._tryResolveClaims();
    return true;
  }

  _tryResolveClaims() {
    if (this.phase !== 'claim' || !this.pendingDiscard) return false;
    for (let player = 0; player < 4; player++) {
      if (hasClaim(this._rawClaimActions(player)) && !this._responses[player]) return false;
    }
    const { from } = this.pendingDiscard;
    const priority = { hu: 3, gang: 2, peng: 2, chi: 1 };
    const choices = this._responses
      .map((response, player) => response && priority[response.action] ? { ...response, player } : null)
      .filter(Boolean)
      .sort((left, right) => priority[right.action] - priority[left.action] ||
        (left.player - from + 4) % 4 - (right.player - from + 4) % 4);
    if (choices.length) this._executeClaim(choices[0]);
    else {
      this.pendingDiscard = null;
      this._responses = Array(4).fill(null);
      this._drawTile((from + 1) % 4);
    }
    return true;
  }

  _executeClaim(response) {
    const { player, action } = response;
    const { tile, from } = this.pendingDiscard;
    const seat = this.players[player];
    const river = this.players[from].discards;
    // Claimed tiles leave the river; each physical tile belongs to exactly one place.
    const riverIndex = river.lastIndexOf(tile);
    if (riverIndex >= 0) river.splice(riverIndex, 1);
    this.pendingDiscard = null;
    this._responses = Array(4).fill(null);
    this.current = player;
    this.lastDraw = null;
    if (action === 'hu') {
      seat.hand.push(tile);
      seat.hand.sort((a, b) => a - b);
      this._finishWin(player, from, false);
      return;
    }
    const meldTiles = action === 'chi' ? response.tiles : Array(action === 'gang' ? 4 : 3).fill(tile);
    const needed = [...meldTiles];
    needed.splice(needed.indexOf(tile), 1);
    removeTiles(seat.hand, needed);
    seat.melds.push({ kind: action, tiles: [...meldTiles], from, concealed: false });
    this.phase = 'discard';
    this._log(`${seat.name}${{ chi: '吃', peng: '碰', gang: '明杠' }[action]}${tileName(tile)}。`);
    if (action === 'gang') this._drawTile(player, true);
    else if (this.wall.length === 0 && seat.hand.length > 0 && seat.hand.every(value => value === 31)) {
      this._finishDraw('牌墙已空，红中无法补杠，本局流局');
    }
  }

  _selfGang(player, action, tile) {
    const seat = this.players[player];
    if (action === 'concealedGang') {
      removeTiles(seat.hand, Array(4).fill(tile));
      seat.melds.push({ kind: 'gang', tiles: Array(4).fill(tile), from: player, concealed: true });
      this._log(`${seat.name}暗杠${tileName(tile)}。`);
    } else {
      removeTiles(seat.hand, [tile]);
      const meld = seat.melds.find(group => group.kind === 'peng' && group.tiles[0] === tile);
      meld.kind = 'gang'; meld.tiles.push(tile); meld.added = true;
      this._log(`${seat.name}补杠${tileName(tile)}。`);
    }
    this.lastDraw = null;
    this._drawTile(player, true);
  }

  _drawTile(player, replacement = false) {
    this.current = player;
    if (!this.wall.length) {
      this._finishDraw(); return false;
    }
    const tile = this.wall.pop();
    const hand = this.players[player].hand;
    hand.push(tile); hand.sort((a, b) => a - b);
    this.phase = 'discard';
    this.lastDraw = { player, tile, index: hand.lastIndexOf(tile), replacement };
    this._log(player === 0 ? `你${replacement ? '补' : '摸'}到${tileName(tile)}。` : `${this.players[player].name}${replacement ? '补牌' : '摸牌'}。`);
    if (this.wall.length === 0 && hand.length > 0 && hand.every(value => value === 31)) {
      this._finishDraw('牌墙已空，红中无法补杠，本局流局');
    }
    return true;
  }

  _visibleTiles() {
    return [
      ...(this.indicatorTile === null ? [] : [this.indicatorTile]),
      ...this.players.flatMap(player => [...player.discards, ...player.redGangs, ...player.melds.flatMap(meld => meld.tiles)]),
    ];
  }

  _botClaim(player, actions) {
    if (actions.hu) return { action: 'hu' };
    if (this.pendingDiscard.tile === this.wildTile) return { action: 'pass' };
    if (actions.gang) return { action: 'gang' };
    const seat = this.players[player];
    const tile = this.pendingDiscard.tile;
    const before = calculateShanten(seat.hand, seat.melds.length, this.wildTile);
    let best = null;
    let bestDistance = before;
    const candidates = [];
    if (actions.peng) candidates.push({ action: 'peng', tiles: Array(3).fill(tile) });
    for (const sequence of actions.chi) candidates.push({ action: 'chi', tiles: sequence });
    for (const candidate of candidates) {
      const remaining = [...seat.hand];
      const needed = [...candidate.tiles]; needed.splice(needed.indexOf(tile), 1);
      if (!removeTiles(remaining, needed)) continue;
      const melds = [...seat.melds, { kind: candidate.action, tiles: candidate.tiles }];
      const discard = chooseDiscard(remaining, melds, this._visibleTiles(), this.wildTile);
      if (discard < 0) continue;
      remaining.splice(discard, 1);
      const after = calculateShanten(remaining, melds.length, this.wildTile);
      if (after < bestDistance || (after === bestDistance && !best && (this.wall.length < 48 || candidate.action === 'peng'))) {
        best = candidate; bestDistance = after;
      }
    }
    return best || { action: 'pass' };
  }

  advanceAI() {
    if (this.phase === 'ended') return false;
    if (this.phase === 'claim') {
      const from = this.pendingDiscard.from;
      for (let distance = 1; distance < 4; distance++) {
        const player = (from + distance) % 4;
        if (player === 0 || this._responses[player]) continue;
        const actions = this._rawClaimActions(player);
        if (!hasClaim(actions)) continue;
        const choice = this._botClaim(player, actions);
        if (choice.action === 'pass') this.pass(player);
        else this.claim(player, choice.action, choice.tiles);
        return true;
      }
      return this._tryResolveClaims();
    }
    if (this.phase !== 'discard' || this.current === 0) return false;
    const player = this.current;
    const actions = this.getActions(player);
    if (actions.hu) return this.claim(player, 'hu');
    if (actions.redGang) return this.claim(player, 'redGang');
    const concealed = actions.concealedGangs.find(tile => tile !== this.wildTile);
    if (concealed !== undefined) return this.claim(player, 'concealedGang', concealed);
    const added = actions.addedGangs.find(tile => tile !== this.wildTile);
    if (added !== undefined) return this.claim(player, 'addedGang', added);
    const discard = chooseDiscard(this.players[player].hand, this.players[player].melds, this._visibleTiles(), this.wildTile);
    if (discard < 0) {
      this._finishDraw('牌墙已空，红中无法补杠，本局流局');
      return true;
    }
    return this.discard(player, discard);
  }

  _finishWin(winner, from, selfDraw) {
    const seat = this.players[winner];
    const allTiles = [...seat.hand, ...seat.melds.flatMap(meld => meld.tiles)];
    const breakdown = [{ name: '基础胡牌', points: 10 }];
    // Shape bonuses use only an independently valid natural interpretation;
    // wildcard substitutions have no specified bonus schedule yet.
    const naturalWin = isWinning(seat.hand, seat.melds.length);
    if (naturalWin && seat.melds.length === 0 && isSevenPairs(seat.hand)) breakdown.push({ name: '七对', points: 10 });
    else if (naturalWin) {
      const counts = countsOf(seat.hand);
      if (seat.melds.every(meld => meld.kind !== 'chi') && counts &&
          counts.filter(count => count === 2).length === 1 && counts.every(count => count === 0 || count === 2 || count === 3)) {
        breakdown.push({ name: '碰碰胡', points: 10 });
      }
    }
    const suits = new Set(allTiles.map(tileSuit));
    if (naturalWin && suits.size === 1) breakdown.push({ name: suits.has('honor') ? '字一色' : '清一色', points: suits.has('honor') ? 30 : 20 });
    if (selfDraw) breakdown.push({ name: '自摸', points: 10 });
    const points = breakdown.reduce((total, item) => total + item.points, 0);
    const scoreDelta = Array(4).fill(0);
    if (selfDraw) {
      for (let player = 0; player < 4; player++) if (player !== winner) scoreDelta[player] = -points;
      scoreDelta[winner] = points * 3;
    } else {
      scoreDelta[from] = -points * 3; scoreDelta[winner] = points * 3;
    }
    for (let player = 0; player < 4; player++) this.players[player].score += scoreDelta[player];
    this.winner = winner;
    this.current = winner;
    this.phase = 'ended';
    this.pendingDiscard = null;
    this.result = {
      kind: 'win', type: 'win', winner, from, selfDraw, points, scoreDelta,
      patterns: breakdown.map(item => item.name), breakdown, hand: [...seat.hand],
      reason: selfDraw ? '自摸' : `${this.players[from].name}点炮`,
      scoringNote: '演示计分：基础 10；七对、碰碰胡、自摸各加 10，清一色加 20，字一色加 30。自摸其余三家各付单份，点炮一家付三份。杠不单独计分。',
    };
    this._log(`${seat.name}${selfDraw ? '自摸胡牌' : '胡牌'}！${this.result.patterns.join(' · ')}，获得 ${scoreDelta[winner]} 分。`);
  }

  _finishDraw(reason = '牌墙已空，本局流局') {
    this.phase = 'ended';
    this.pendingDiscard = null;
    this.winner = null;
    this.lastDraw = null;
    this.result = {
      kind: 'draw', type: 'draw', winner: null, from: null, selfDraw: false,
      points: 0, scoreDelta: [0, 0, 0, 0], patterns: [], breakdown: [],
      reason, scoringNote: '演示计分，流局不扣分。',
    };
    this._log(`${reason}。`);
  }
}
```

**3. engine.js 关键 diff**

以下是实际 diff 的关键片段；全部差异保存在 output/domain-engine.diff。公共 tileSuit() 继续返回旧 wan/tong/tiao/honor 标签；新 suitOf() 使用 man/pin/sou/honor。牌码点数由零基转为一基时同步调整原比较界限，AI 权重、随机源和计分保留原值。

applyAction 是统一动作入口，校验 action.player 与调用席位一致；claim 的旧别名、缺省吃牌序列及杠参数通过薄适配转换。phase 的所有内部迁移经过 _setPhase/assertPhaseTransition，重发经过 dealing，保留任意时点 newRound/restart 的既有行为。

```diff
diff --git a/tests/fixtures/engine-before-domain.js b/engine.js
index 1754fc7..5508cd3 100644
--- a/tests/fixtures/engine-before-domain.js
+++ b/engine.js
@@ -1,61 +1,98 @@
+// @ts-check
 /** Dependency-free rules and turn orchestration for the four-seat teaching game. */
 
-const SUIT_NAMES = ['万', '筒', '条'];
+import {
+  TILE, SUIT, RED_DRAGON, TILE_TYPE_COUNT, TOTAL_TILE_COUNT, COPIES_PER_TILE,
+  SUIT_SIZE, HONOR_COUNT, MAX_SEQUENCE_START_RANK,
+  isTileCode, isNumbered, suitOf, rankOf, suitStartOf,
+} from './src/domain/tile.js';
+import { PHASE, ACTION, isPlayerId } from './src/domain/model.js';
+import { assertPhaseTransition } from './src/domain/invariants.js';
+
+/** @typedef {import('./src/domain/model.js').TileCode} TileCode */
+/** @typedef {import('./src/domain/model.js').PlayerId} PlayerId */
+/** @typedef {import('./src/domain/model.js').PlayerState} PlayerState */
+/** @typedef {import('./src/domain/model.js').Meld} Meld */
+/** @typedef {import('./src/domain/model.js').MeldLike} MeldLike */
+/** @typedef {import('./src/domain/model.js').Phase} Phase */
+/** @typedef {import('./src/domain/model.js').Action} Action */
+/** @typedef {import('./src/domain/model.js').AvailableActions} AvailableActions */
+/** @typedef {import('./src/domain/model.js').ClaimResponse} ClaimResponse */
+/** @typedef {import('./src/domain/model.js').GameResult} GameResult */
+/** @typedef {import('./src/domain/model.js').PendingDiscard} PendingDiscard */
+/** @typedef {import('./src/domain/model.js').LastDraw} LastDraw */
+/** @typedef {import('./src/domain/model.js').GameOptions} GameOptions */
+/** @typedef {import('./src/domain/model.js').NewRoundOptions} NewRoundOptions */
+
+const SUIT_NAMES = { [SUIT.MAN]: '万', [SUIT.PIN]: '筒', [SUIT.SOU]: '条', [SUIT.HONOR]: '' };
 const NUM_NAMES = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
 const HONOR_NAMES = ['东', '南', '西', '北', '中', '发', '白'];
 const DEFAULT_NAMES = ['你', '云舟', '阿福', '小棠'];
 
+/** @param {unknown} type @returns {string} */
 export function tileName(type) {
-  if (!Number.isInteger(type) || type < 0 || type > 33) return '未知牌';
-  return type < 27 ? NUM_NAMES[type % 9] + SUIT_NAMES[Math.floor(type / 9)] : HONOR_NAMES[type - 27];
+  if (!isTileCode(type)) return '未知牌';
+  return isNumbered(type) ? NUM_NAMES[rankOf(type) - 1] + SUIT_NAMES[suitOf(type)] : HONOR_NAMES[type - TILE.EAST];
 }
 
+/** Legacy public suit labels are preserved for existing callers.
+ * @param {TileCode} type @returns {'wan'|'tong'|'tiao'|'honor'|undefined}
+ */
 export function tileSuit(type) {
-  return type >= 27 ? 'honor' : ['wan', 'tong', 'tiao'][Math.floor(type / 9)];
-}
-
-function validTile(type) {
-  return Number.isInteger(type) && type >= 0 && type < 34;
+  const names = /** @type {const} */ (['wan', 'tong', 'tiao']);
+  return type >= TILE.EAST ? SUIT.HONOR : names[Math.floor(type / SUIT_SIZE)];
 }
 
-/** Numbered suits wrap at nine; all seven honors share one cycle. */
+/** Numbered suits wrap at nine; all seven honors share one cycle.
+ * @param {unknown} type @returns {TileCode|null}
+ */
 export function nextWildTile(type) {
-  if (!validTile(type)) return null;
-  return type < 27 ? Math.floor(type / 9) * 9 + (type + 1) % 9 : 27 + (type - 26) % 7;
+  if (!isTileCode(type)) return null;
+  return isNumbered(type) ? suitStartOf(type) + rankOf(type) % SUIT_SIZE : TILE.EAST + rankOf(type) % HONOR_COUNT;
 }
 
+/** @param {readonly TileCode[]} hand @returns {number[]|null} */
 function countsOf(hand) {
   if (!Array.isArray(hand)) return null;
-  const counts = Array(34).fill(0);
+  /** @type {number[]} */
+  const counts = Array(TILE_TYPE_COUNT).fill(0);
   for (const tile of hand) {
-    if (!Number.isInteger(tile) || tile < 0 || tile > 33 || ++counts[tile] > 4) return null;
+    if (!isTileCode(tile) || ++counts[tile] > COPIES_PER_TILE) return null;
   }
   return counts;
 }
 
+/** @param {readonly TileCode[]} hand @returns {boolean} */
 function isSevenPairs(hand) {
   const counts = countsOf(hand);
-  return hand.length === 14 && counts && counts.every(count => count % 2 === 0);
+  return hand.length === 14 && counts !== null && counts.every(count => count % 2 === 0);
 }
 
-/** Standard four groups + a pair, or seven pairs with no exposed groups. */
+/** Standard four groups + a pair, or seven pairs with no exposed groups.
+ * @param {readonly TileCode[]} hand @param {number} [meldCount]
+ * @param {TileCode|null} [wildTile] @returns {boolean}
+ */
 export function isWinning(hand, meldCount = 0, wildTile = null) {
   if (!Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4 ||
       !Array.isArray(hand) || hand.length !== (4 - meldCount) * 3 + 2 ||
-      (wildTile !== null && !validTile(wildTile))) return false;
-  const counts = countsOf(hand);
-  if (!counts) return false;
+      (wildTile !== null && !isTileCode(wildTile))) return false;
+  const initialCounts = countsOf(hand);
+  if (!initialCounts) return false;
+  const counts = initialCounts;
   const wilds = wildTile === null ? 0 : counts[wildTile];
   if (wildTile !== null) counts[wildTile] = 0;
   // In this teaching variant a four-of-a-kind can supply two of the seven pairs.
   if (meldCount === 0 && counts.reduce((odd, count) => odd + count % 2, 0) <= wilds) return true;
+  /** @type {Map<string, boolean>} */
   const memo = new Map();
+  /** @param {number} groups @param {number} remainingWilds @returns {boolean} */
   function groupsRemain(groups, remainingWilds) {
     const first = counts.findIndex(count => count > 0);
     if (first < 0) return remainingWilds === groups * 3;
     if (groups === 0) return false;
     const key = counts.join('') + ':' + groups + ':' + remainingWilds;
-    if (memo.has(key)) return memo.get(key);
+    const cached = memo.get(key);
+    if (cached !== undefined) return cached;
     let matched = false;
     const naturalTriple = Math.min(3, counts[first]);
     if (3 - naturalTriple <= remainingWilds) {
@@ -259,8 +316,35 @@ function sameSequence(left, right) {
  * No flower tiles, dead wall, multiple winners, or robbing an added kong in this variant.
  */
 export class MahjongGame {
+  /** @type {TileCode[]} */
+  wall = [];
+  /** @type {PlayerId} */
+  dealer = 0;
+  /** @type {PlayerId} */
+  current = 0;
+  /** @type {Phase} */
+  phase = { kind: PHASE.DEALING, dealt: 0 };
+  /** @type {PendingDiscard|null} */
+  pendingDiscard = null;
+  /** @type {PlayerId|null} */
+  winner = null;
+  /** @type {GameResult|null} */
+  result = null;
+  /** @type {LastDraw|null} */
+  lastDraw = null;
+  /** @type {string[]} */
+  events = [];
+  /** @type {(ClaimResponse|null)[]} */
+  _responses = [];
+  /** @type {TileCode|null} */
+  indicatorTile = null;
+  /** @type {TileCode|null} */
+  wildTile = null;
+
+  /** @param {GameOptions|string|number|boolean|null} [options] */
   constructor(options = {}) {
     if (typeof options !== 'object' || options === null) options = { seed: options };
+    /** @type {PlayerState[]} */
     this.players = DEFAULT_NAMES.map((name, index) => ({
       name: options.names?.[index] || name,
       hand: [], melds: [], redGangs: [], discards: [], score: 1000,
@@ -271,13 +355,16 @@ export class MahjongGame {
     this.newRound();
   }
 
-  /** A restart redeals the current round; a new round rotates the dealer counterclockwise. */
+  /** A restart redeals the current round; a new round rotates the dealer counterclockwise.
+   * @param {unknown} [seed] @param {NewRoundOptions} [options] @returns {this}
+   */
   newRound(seed, { restart = false, laizi = this.laiziEnabled } = {}) {
+    this._setPhase({ kind: PHASE.DEALING, dealt: 0 });
     if (seed !== undefined) this._random = makeRandom(seed);
     if (!restart || this.round === 0) this.round++;
     // Seats are bottom (0), right (1), top (2), and left (3).
-    this.dealer = (this.round - 1) % 4;
-    this.wall = Array.from({ length: 136 }, (_, index) => Math.floor(index / 4));
+    this.dealer = /** @type {PlayerId} */ ((this.round - 1) % 4);
+    this.wall = Array.from({ length: TOTAL_TILE_COUNT }, (_, index) => Math.floor(index / COPIES_PER_TILE));
     for (let index = this.wall.length - 1; index > 0; index--) {
       const target = Math.floor(this._random() * (index + 1));
       [this.wall[index], this.wall[target]] = [this.wall[target], this.wall[index]];
@@ -286,13 +373,13 @@ export class MahjongGame {
     this.indicatorTile = null;
     this.wildTile = null;
     if (this.laiziEnabled) {
-      const candidate = this.wall.pop();
-      if (nextWildTile(candidate) === 31) {
+      const candidate = /** @type {TileCode} */ (this.wall.pop());
+      if (nextWildTile(candidate) === RED_DRAGON) {
         // A red-dragon wildcard conflicts with its special kong role. This
         // table instead exposes a real white dragon and uses green as wild.
         this.wall.push(candidate);
-        this.indicatorTile = this.wall.splice(this.wall.lastIndexOf(33), 1)[0];
-        this.wildTile = 32;
+        this.indicatorTile = this.wall.splice(this.wall.lastIndexOf(TILE.WHITE), 1)[0];
+        this.wildTile = TILE.GREEN;
       } else {
         this.indicatorTile = candidate;
         this.wildTile = nextWildTile(candidate);
@@ -319,30 +406,39 @@ export class MahjongGame {
     return this;
   }
 
+  /** @param {Phase} next @returns {void} */
+  _setPhase(next) {
+    assertPhaseTransition(this.phase, next);
+    this.phase = next;
+  }
+
+  /** @param {string} message @returns {void} */
   _log(message) {
     this.events.push(message);
     if (this.events.length > 80) this.events.shift();
   }
 
+  /** @param {unknown} player @returns {player is PlayerId} */
   _validPlayer(player) {
-    return Number.isInteger(player) && player >= 0 && player < 4;
+    return isPlayerId(player);
   }
 
+  /** @param {number} player @returns {AvailableActions} */
   _rawClaimActions(player) {
     const actions = emptyActions();
-    if (this.phase !== 'claim' || !this.pendingDiscard || !this._validPlayer(player) || player === this.pendingDiscard.from) return actions;
+    if (this.phase.kind !== PHASE.CLAIM || !this.pendingDiscard || !this._validPlayer(player) || player === this.pendingDiscard.from) return actions;
     const seat = this.players[player];
     const tile = this.pendingDiscard.tile;
-    if (tile === 31) return actions;
+    if (tile === RED_DRAGON) return actions;
     const counts = countsOf(seat.hand);
     if (!counts) return actions;
     actions.hu = canWin([...seat.hand, tile], seat.melds.length, this.wildTile);
     if (seat.melds.length < 4) {
       actions.peng = counts[tile] >= 2;
       actions.gang = counts[tile] >= 3 && this.wall.length > 0;
-      if (player === (this.pendingDiscard.from + 1) % 4 && tile < 27) {
+      if (player === (this.pendingDiscard.from + 1) % 4 && isNumbered(tile)) {
         for (let start = tile - 2; start <= tile; start++) {
-          if (start < 0 || Math.floor(start / 9) !== Math.floor(tile / 9) || start % 9 > 6) continue;
+          if (start < TILE.MAN || suitOf(start) !== suitOf(tile) || rankOf(start) > MAX_SEQUENCE_START_RANK) continue;
           const sequence = [start, start + 1, start + 2];
           const needed = sequence.filter(value => value !== tile);
           if (needed.every(value => counts[value] > 0)) actions.chi.push(sequence);
@@ -392,75 +490,114 @@ export class MahjongGame {
     return true;
   }
 
-  claim(player, action, tiles) {
-    if (!this._validPlayer(player)) return false;
-    action = ({ 'concealed-gang': 'concealedGang', 'added-gang': 'addedGang', 'anGang': 'concealedGang', 'buGang': 'addedGang' })[action] || action;
+  /** Submit a typed command. The command seat must agree with its caller.
+   * @param {number} player @param {Action} action @returns {boolean}
+   */
+  applyAction(player, action) {
+    if (!this._validPlayer(player) || !action || typeof action !== 'object' || action.player !== player) return false;
+    if (action.kind === ACTION.DISCARD) return this.discard(player, action.index);
+    if (action.kind === ACTION.PASS) return this.pass(player);
     const actions = this.getActions(player);
-    if (this.phase === 'discard' && this.current === player) {
-      if (action === 'hu' && actions.hu) {
+    if (this.phase.kind === PHASE.DISCARD && this.current === player) {
+      if (action.kind === ACTION.HU && action.selfDraw === true && actions.hu) {
         this._finishWin(player, null, true); return true;
       }
-      if (action === 'redGang' && actions.redGang) {
+      if (action.kind === ACTION.RED_GANG && actions.redGang) {
         const seat = this.players[player];
-        removeTiles(seat.hand, [31]);
-        seat.redGangs.push(31);
+        removeTiles(seat.hand, [RED_DRAGON]);
+        seat.redGangs.push(RED_DRAGON);
         this.lastDraw = null;
         this._log(`${seat.name}红中杠，补摸一张牌。`);
         this._drawTile(player, true);
         return true;
       }
-      if (action === 'concealedGang' || action === 'addedGang') {
-        const choices = action === 'concealedGang' ? actions.concealedGangs : actions.addedGangs;
-        const tile = Array.isArray(tiles) ? tiles[0] : tiles ?? choices[0];
-        if (!choices.includes(tile)) return false;
-        this._selfGang(player, action, tile); return true;
+      if (action.kind === ACTION.GANG && (action.mode === 'concealed' || action.mode === 'added')) {
+        const choices = action.mode === 'concealed' ? actions.concealedGangs : actions.addedGangs;
+        if (!choices.includes(action.tile)) return false;
+        this._selfGang(player, action.mode, action.tile); return true;
       }
       return false;
     }
-    if (this.phase !== 'claim' || this._responses[player]) return false;
-    if (action === 'chi') {
-      const sequence = tiles ?? actions.chi[0];
-      const selected = actions.chi.find(candidate => sameSequence(sequence, candidate));
+    if (this.phase.kind !== PHASE.CLAIM || this._responses[player]) return false;
+    if (action.kind === ACTION.CHI) {
+      const selected = actions.chi.find(candidate => sameSequence(action.sequence, candidate));
       if (!selected) return false;
-      this._responses[player] = { action, tiles: [...selected] };
-    } else if (['hu', 'peng', 'gang'].includes(action) && actions[action]) {
-      this._responses[player] = { action };
+      this._responses[player] = { action: ACTION.CHI, tiles: [...selected] };
+    } else if (action.kind === ACTION.HU && action.selfDraw === false && actions.hu) {
+      this._responses[player] = { action: ACTION.HU };
+    } else if (action.kind === ACTION.PENG && actions.peng) {
+      this._responses[player] = { action: ACTION.PENG };
+    } else if (action.kind === ACTION.GANG && action.mode === 'exposed' &&
+               action.tile === this.pendingDiscard?.tile && actions.gang) {
+      this._responses[player] = { action: ACTION.GANG };
     } else return false;
     this._tryResolveClaims();
     return true;
   }
 
+  /** Legacy strings and optional tiles are translated into one typed command.
+   * @deprecated Use applyAction(player, action).
+   * @param {number} player @param {string} action
+   * @param {TileCode|TileCode[]|null} [tiles] @returns {boolean}
+   */
+  claim(player, action, tiles) {
+    if (!this._validPlayer(player)) return false;
+    /** @type {Record<string, string>} */
+    const aliases = { 'concealed-gang': 'concealedGang', 'added-gang': 'addedGang', anGang: 'concealedGang', buGang: 'addedGang' };
+    const kind = aliases[action] || action;
+    if (kind === ACTION.HU) return this.applyAction(player, { kind: ACTION.HU, player, selfDraw: this.phase.kind === PHASE.DISCARD });
+    if (kind === ACTION.RED_GANG) return this.applyAction(player, { kind: ACTION.RED_GANG, player });
+    if (kind === ACTION.PENG) return this.applyAction(player, { kind: ACTION.PENG, player });
+    if (kind === ACTION.GANG) {
+      if (!this.pendingDiscard) return false;
+      return this.applyAction(player, { kind: ACTION.GANG, player, tile: this.pendingDiscard.tile, mode: 'exposed' });
+    }
+    if (kind === ACTION.CHI) {
+      const sequence = tiles ?? this.getActions(player).chi[0];
+      return Array.isArray(sequence) && this.applyAction(player, { kind: ACTION.CHI, player, sequence });
+    }
+    if (kind === 'concealedGang' || kind === 'addedGang') {
+      const choices = this.getActions(player)[kind === 'concealedGang' ? 'concealedGangs' : 'addedGangs'];
+      const tile = Array.isArray(tiles) ? tiles[0] : tiles ?? choices[0];
+      if (tile === undefined) return false;
+      return this.applyAction(player, { kind: ACTION.GANG, player, tile, mode: kind === 'concealedGang' ? 'concealed' : 'added' });
+    }
+    return false;
+  }
+
+  /** @param {number} [player] @returns {boolean} */
   pass(player = 0) {
-    if (!this._validPlayer(player) || this.phase !== 'claim' || this._responses[player] || !this.getActions(player).pass) return false;
+    if (!this._validPlayer(player) || this.phase.kind !== PHASE.CLAIM || this._responses[player] || !this.getActions(player).pass) return false;
     this._responses[player] = { action: 'pass' };
     this._tryResolveClaims();
     return true;
   }
 
+  /** @returns {boolean} */
   _tryResolveClaims() {
-    if (this.phase !== 'claim' || !this.pendingDiscard) return false;
+    if (this.phase.kind !== PHASE.CLAIM || !this.pendingDiscard) return false;
     for (let player = 0; player < 4; player++) {
       if (hasClaim(this._rawClaimActions(player)) && !this._responses[player]) return false;
     }
     const { from } = this.pendingDiscard;
     const priority = { hu: 3, gang: 2, peng: 2, chi: 1 };
     const choices = this._responses
-      .map((response, player) => response && priority[response.action] ? { ...response, player } : null)
-      .filter(Boolean)
+      .flatMap((response, player) => response && response.action !== ACTION.PASS && isPlayerId(player) ? [{ ...response, player }] : [])
       .sort((left, right) => priority[right.action] - priority[left.action] ||
         (left.player - from + 4) % 4 - (right.player - from + 4) % 4);
     if (choices.length) this._executeClaim(choices[0]);
     else {
       this.pendingDiscard = null;
       this._responses = Array(4).fill(null);
-      this._drawTile((from + 1) % 4);
+      this._drawTile(/** @type {PlayerId} */ ((from + 1) % 4));
     }
     return true;
   }
 
+  /** @param {Exclude<ClaimResponse, {action:'pass'}> & {player:PlayerId}} response @returns {void} */
   _executeClaim(response) {
     const { player, action } = response;
-    const { tile, from } = this.pendingDiscard;
+    const { tile, from } = /** @type {PendingDiscard} */ (this.pendingDiscard);
     const seat = this.players[player];
     const river = this.players[from].discards;
     // Claimed tiles leave the river; each physical tile belongs to exactly one place.
@@ -614,24 +763,24 @@ export class MahjongGame {
       for (let player = 0; player < 4; player++) if (player !== winner) scoreDelta[player] = -points;
       scoreDelta[winner] = points * 3;
     } else {
-      scoreDelta[from] = -points * 3; scoreDelta[winner] = points * 3;
+      scoreDelta[/** @type {PlayerId} */ (from)] = -points * 3; scoreDelta[winner] = points * 3;
     }
     for (let player = 0; player < 4; player++) this.players[player].score += scoreDelta[player];
     this.winner = winner;
     this.current = winner;
-    this.phase = 'ended';
     this.pendingDiscard = null;
     this.result = {
       kind: 'win', type: 'win', winner, from, selfDraw, points, scoreDelta,
       patterns: breakdown.map(item => item.name), breakdown, hand: [...seat.hand],
-      reason: selfDraw ? '自摸' : `${this.players[from].name}点炮`,
+      reason: selfDraw ? '自摸' : `${this.players[/** @type {PlayerId} */ (from)].name}点炮`,
       scoringNote: '演示计分：基础 10；七对、碰碰胡、自摸各加 10，清一色加 20，字一色加 30。自摸其余三家各付单份，点炮一家付三份。杠不单独计分。',
     };
+    this._setPhase({ kind: PHASE.ENDED, result: this.result });
     this._log(`${seat.name}${selfDraw ? '自摸胡牌' : '胡牌'}！${this.result.patterns.join(' · ')}，获得 ${scoreDelta[winner]} 分。`);
   }
 
+  /** @param {string} [reason] @returns {void} */
   _finishDraw(reason = '牌墙已空，本局流局') {
-    this.phase = 'ended';
     this.pendingDiscard = null;
     this.winner = null;
     this.lastDraw = null;
@@ -640,6 +789,7 @@ export class MahjongGame {
       points: 0, scoreDelta: [0, 0, 0, 0], patterns: [], breakdown: [],
       reason, scoringNote: '演示计分，流局不扣分。',
     };
+    this._setPhase({ kind: PHASE.ENDED, result: this.result });
     this._log(`${reason}。`);
   }
 }
```

**4. app.js 同步改动 diff**

仅导入语义常量并同步所有 phase.kind 读取；六个既有规则/UI 测试文件相应更新 phase 对象夹具和断言，原 55 项覆盖全部保留。

```diff
diff --git a/output/domain-baseline/app.js b/app.js
index 0862413..f05136c 100644
--- a/output/domain-baseline/app.js
+++ b/app.js
@@ -1,4 +1,6 @@
 import { MahjongGame, tileName, chooseDiscard } from './engine.js';
+import { RED_DRAGON } from './src/domain/tile.js';
+import { PHASE } from './src/domain/model.js';
 
 const $ = selector => document.querySelector(selector);
 const game = new MahjongGame({ names: ['你', '云舟', '阿福', '小棠'] });
@@ -89,14 +91,14 @@ function syncSettings() {
   $('#sound-btn').setAttribute('aria-pressed', String(preferences.sound));
 }
 
-function humanTurn() { return game.phase === 'discard' && game.current === 0; }
+function humanTurn() { return game.phase.kind === PHASE.DISCARD && game.current === 0; }
 function modalOpen() { return Boolean(document.querySelector('dialog[open]')); }
 
 function render() {
   const hand = game.players[0].hand;
   const actions = game.getActions(0);
   const myTurn = humanTurn();
-  const hasRed = hand.includes(31);
+  const hasRed = hand.includes(RED_DRAGON);
   $('#score').textContent = game.players[0].score.toLocaleString('zh-CN');
   $('#wall-count').textContent = game.wall.length;
   $('#round-label').textContent = `第 ${game.round} 局 · ${game.dealer === 0 ? '你' : displayNames[game.dealer]}坐庄`;
@@ -113,7 +115,7 @@ function render() {
     .filter(entry => entry.index !== drawnIndex)
     .sort((left, right) => right.type - left.type);
   if (drawnIndex >= 0 && drawnIndex < hand.length) order.push({ type: hand[drawnIndex], index: drawnIndex });
-  $('#hand').innerHTML = order.map(({ type, index }) => `<button class="tile ${type === 31 ? 'red-kong-tile' : ''} ${type === game.wildTile ? 'is-wild' : ''} ${index === drawnIndex ? 'drawn' : ''} ${index === selected ? 'selected' : ''} ${index === hinted ? 'hinted' : ''}" data-index="${index}" aria-label="${tileName(type)}${type === 31 ? '，只能杠出，不能打出' : ''}${type === game.wildTile ? '，癞子' : ''}${index === drawnIndex ? '，摸到的牌' : ''}" aria-disabled="${!myTurn || type === 31}" aria-pressed="${index === selected}" ${type === 31 ? 'title="红中只能单张杠出，补摸一张牌"' : ''} ${!myTurn ? 'disabled' : ''}>${face(type)}${type === 31 ? '<span class="red-kong-marker" aria-hidden="true">杠</span>' : ''}${wildMarker(type)}${preferences.names ? `<span class="tile-name">${tileName(type)}</span>` : ''}</button>`).join('');
+  $('#hand').innerHTML = order.map(({ type, index }) => `<button class="tile ${type === RED_DRAGON ? 'red-kong-tile' : ''} ${type === game.wildTile ? 'is-wild' : ''} ${index === drawnIndex ? 'drawn' : ''} ${index === selected ? 'selected' : ''} ${index === hinted ? 'hinted' : ''}" data-index="${index}" aria-label="${tileName(type)}${type === RED_DRAGON ? '，只能杠出，不能打出' : ''}${type === game.wildTile ? '，癞子' : ''}${index === drawnIndex ? '，摸到的牌' : ''}" aria-disabled="${!myTurn || type === RED_DRAGON}" aria-pressed="${index === selected}" ${type === RED_DRAGON ? 'title="红中只能单张杠出，补摸一张牌"' : ''} ${!myTurn ? 'disabled' : ''}>${face(type)}${type === RED_DRAGON ? '<span class="red-kong-marker" aria-hidden="true">杠</span>' : ''}${wildMarker(type)}${preferences.names ? `<span class="tile-name">${tileName(type)}</span>` : ''}</button>`).join('');
 
   for (let player = 0; player < 4; player++) {
     const seat = game.players[player];
@@ -133,32 +135,32 @@ function render() {
     redBadge.textContent = `中×${seat.redGangs.length}`;
     redBadge.title = `${displayNames[player]}已杠出 ${seat.redGangs.length} 张红中`;
     redBadge.setAttribute('aria-label', redBadge.title);
-    $(`#opponent-${player}`).classList.toggle('is-active', game.current === player && game.phase !== 'ended');
+    $(`#opponent-${player}`).classList.toggle('is-active', game.current === player && game.phase.kind !== PHASE.ENDED);
     $(`#opponent-${player}`).classList.toggle('is-claiming', player === 0 && actions.pass);
-    $(`#state-${player}`).textContent = game.phase === 'ended' ? (game.winner === player ? '胡牌了' : '本局结束') : player === 0 && actions.pass ? '请选择操作' : game.current === player && game.phase === 'discard' ? (player === 0 ? '请出牌' : '思考中…') : '等待中';
+    $(`#state-${player}`).textContent = game.phase.kind === PHASE.ENDED ? (game.winner === player ? '胡牌了' : '本局结束') : player === 0 && actions.pass ? '请选择操作' : game.current === player && game.phase.kind === PHASE.DISCARD ? (player === 0 ? '请出牌' : '思考中…') : '等待中';
     if (player === 0) continue;
     $(`#backs-${player}`).innerHTML = seat.hand.map(() => '<span class="back"></span>').join('');
     $(`#backs-${player}`).setAttribute('aria-label', `${displayNames[player]}的${seat.hand.length}张暗牌`);
   }
-  document.querySelectorAll('.direction').forEach(element => element.classList.toggle('active', Number(element.dataset.player) === game.current && game.phase !== 'ended'));
+  document.querySelectorAll('.direction').forEach(element => element.classList.toggle('active', Number(element.dataset.player) === game.current && game.phase.kind !== PHASE.ENDED));
 
   const enabled = { chi: actions.chi.length > 0, peng: actions.peng, gang: actions.redGang || actions.gang || actions.concealedGangs.length > 0 || actions.addedGangs.length > 0, hu: actions.hu, pass: actions.pass };
   for (const [action, available] of Object.entries(enabled)) $(`#action-${action}`).disabled = !available;
   $('#action-gang').title = actions.redGang ? '可杠出一张红中，补摸一张牌' : '杠牌';
 
   let message;
-  if (game.phase === 'ended') message = game.winner === null ? '牌墙已空，本局流局' : game.winner === 0 ? '好牌，胡了！' : `${displayNames[game.winner]}${game.result.selfDraw ? '自摸' : '胡牌'}，下局再来`;
+  if (game.phase.kind === PHASE.ENDED) message = game.winner === null ? '牌墙已空，本局流局' : game.winner === 0 ? '好牌，胡了！' : `${displayNames[game.winner]}${game.result.selfDraw ? '自摸' : '胡牌'}，下局再来`;
   else if (actions.pass) message = hasRed ? `${displayNames[game.pendingDiscard.from]}打出${tileName(game.pendingDiscard.tile)}；手中有红中，不能胡牌` : `${displayNames[game.pendingDiscard.from]}打出${tileName(game.pendingDiscard.tile)}，请选择操作`;
   else if (myTurn) message = actions.hu ? '好牌来了，可以自摸胡牌！' : selected >= 0 ? `已选${tileName(hand[selected])}，再点一次打出` : hasRed ? '红中只能杠出，须清空手中红中才能胡牌' : '轮到你了，请选择一张牌打出';
-  else message = game.phase === 'claim' ? '等待其他玩家响应…' : `${displayNames[game.current]}正在思考…`;
+  else message = game.phase.kind === PHASE.CLAIM ? '等待其他玩家响应…' : `${displayNames[game.current]}正在思考…`;
   $('#turn-text').textContent = message;
-  $('.turn-message').classList.toggle('thinking', !myTurn && !actions.pass && game.phase !== 'ended');
+  $('.turn-message').classList.toggle('thinking', !myTurn && !actions.pass && game.phase.kind !== PHASE.ENDED);
   $('#last-event').textContent = game.events.at(-1) || '祝你手气好';
   $('#action-caption').textContent = actions.pass ? '响应出牌' : '对局操作';
   $('#action-context').textContent = actions.hu ? '胡牌可用' : hasRed ? '先杠出红中，才能胡牌' : actions.concealedGangs.length ? '可暗杠' : actions.addedGangs.length ? '可补杠' : actions.pass ? '胡 > 碰杠 > 吃' : '好牌，慢慢打';
-  $('#hand-instruction').textContent = game.phase === 'ended' ? '点击「重新开局」再来一局' : !myTurn ? '等待轮到你时出牌' : '点选手牌，再点一次打出';
+  $('#hand-instruction').textContent = game.phase.kind === PHASE.ENDED ? '点击「重新开局」再来一局' : !myTurn ? '等待轮到你时出牌' : '点选手牌，再点一次打出';
   syncSettings();
-  if (game.phase === 'ended' && resultShown !== game.round) {
+  if (game.phase.kind === PHASE.ENDED && resultShown !== game.round) {
     resultShown = game.round;
     persist();
     setTimeout(showResult, 350);
@@ -169,7 +171,7 @@ function stopTimer() { clearTimeout(timer); timer = null; }
 
 function scheduleAI() {
   stopTimer();
-  if (modalOpen() || game.phase === 'ended') return;
+  if (modalOpen() || game.phase.kind === PHASE.ENDED) return;
   // Claim responses are collected one at a time, including while a human chooses.
   timer = setTimeout(() => {
     timer = null;
@@ -222,9 +224,9 @@ function performAction(action) {
     if (actions.chi.length === 1) return moveDone(game.claim(0, 'chi', actions.chi[0]));
     return selectOptions('选择吃牌组合', actions.chi.map(sequence => ({ tiles: sequence, label: '吃这组', action: 'chi', value: sequence })));
   }
-  if (action === 'gang' && game.phase === 'discard') {
+  if (action === 'gang' && game.phase.kind === PHASE.DISCARD) {
     const options = [
-      ...(actions.redGang ? [{ tiles: [31], label: '红中杠 · 补摸1张', action: 'redGang' }] : []),
+      ...(actions.redGang ? [{ tiles: [RED_DRAGON], label: '红中杠 · 补摸1张', action: 'redGang' }] : []),
       ...actions.concealedGangs.map(type => ({ tiles: Array(4).fill(type), label: '暗杠', action: 'concealedGang', value: type })),
       ...actions.addedGangs.map(type => ({ tiles: Array(4).fill(type), label: '补杠', action: 'addedGang', value: type })),
     ];
@@ -235,7 +237,7 @@ function performAction(action) {
 }
 
 function showResult() {
-  if (game.phase !== 'ended') return;
+  if (game.phase.kind !== PHASE.ENDED) return;
   const result = game.result;
   $('#result-title').textContent = result.kind === 'draw' ? '好牌，下局再来' : game.winner === 0 ? '好牌，胡了！' : `${displayNames[game.winner]}胡牌`;
   $('#result-avatar').src = avatars[game.winner ?? 0];
@@ -260,7 +262,7 @@ $('#hand').addEventListener('click', event => {
   const button = event.target.closest('button[data-index]');
   if (!button || !humanTurn()) return;
   const index = Number(button.dataset.index);
-  if (game.players[0].hand[index] === 31) {
+  if (game.players[0].hand[index] === RED_DRAGON) {
     toast(game.getActions(0).redGang ? '红中只能杠出，请点击「杠」补摸一张' : '红中只能杠出，当前无余牌可补杠');
     return;
   }
@@ -290,7 +292,7 @@ $('#hint-btn').addEventListener('click', () => {
 $('#rules-btn').addEventListener('click', () => openModal('#rules-dialog'));
 $('#settings-btn').addEventListener('click', () => openModal('#settings-dialog'));
 $('#restart-btn').addEventListener('click', () => {
-  if (game.phase === 'ended') return newRound();
+  if (game.phase.kind === PHASE.ENDED) return newRound();
   openModal('#restart-dialog');
 });
 $('#confirm-restart').addEventListener('click', () => newRound({ restart: true }));
```

**5. 验证命令与实际结果**

先冻结旧引擎并建立安全网，旧旧基准通过后才修改生产代码。普通与癞子各 100 局，覆盖四家随机合法动作、轮庄及重开；每步比较整个 events 数组的 JSON 文本以及牌墙、手牌、副露、红中杠、结果、分数。日志上限 80 条，因此逐步比较而非只比较最后 80 条。另比较 8 局 AI 决策，并验证现有随机算法连续 1,000 个输出保持一致。

```sh
npm test
```

```text

> queqi-mahjong@1.0.0 test
> node --test tests/*.test.js

✔ domain migration preserves 200 seeded rounds, every physical tile, logs, scores and AI decisions (1603.2629ms)
✔ deprecated claim preserves concealed kong aliases and omitted/scalar/array tile defaults (2.3857ms)
✔ deprecated claim preserves added kong aliases and omitted/scalar/array tile defaults (1.0071ms)
✔ deprecated claim preserves the default first chi sequence (0.4526ms)
✔ typed actions reject malformed or mismatched commands without mutating the game (0.3136ms)
✔ recognizes a standard winning hand and does not mutate unsorted input (2.2625ms)
✔ recognizes seven pairs and a concealed hand completed by an exposed meld (0.3005ms)
✔ does not treat honors or neighboring suits as sequences (0.1478ms)
✔ rejects an incomplete hand and an incorrect exposed-meld count (0.1204ms)
✔ deals 136 tiles deterministically with one dealer draw (2.1715ms)
✔ rotates the dealer counterclockwise and deals the extra tile to that seat over eight rounds (15.2044ms)
✔ a restart keeps the current round, dealer and scores while resetting the table (0.5458ms)
✔ the next round rotates dealer after either a dealer win or a drawn round (1.1943ms)
✔ rejects out-of-turn and invalid-index discards without losing tiles (0.2126ms)
✔ a legal discard moves exactly one tile from hand to the discard pile (0.4849ms)
✔ chi is available only to the next seat and consumes the two matching hand tiles (0.6934ms)
✔ peng takes a discard from any seat and gives the claimant a discard without drawing (0.2933ms)
✔ an exposed gang consumes three hand tiles plus the discard and draws a replacement (0.2468ms)
✔ concealed and added gangs each draw exactly one replacement (0.5872ms)
✔ AI waits for a human claim response and passing draws for the next player (0.3399ms)
✔ a higher-priority peng defeats a submitted chi (0.7675ms)
✔ hu takes priority over peng and transfers the winning discard into the hand (0.6315ms)
✔ competing hu claims choose the nearest seat after the discarder (0.5214ms)
✔ seeded AI rounds finish without stalls or creating or losing physical tiles (205.0445ms)
✔ indicator successors cycle within each numbered suit and all seven honors (0.9289ms)
✔ the optional mode defaults off and enabled games reveal exactly one tile before dealing (12.3523ms)
✔ a 北 indicator conflict instead exposes a real 白 with 发 wild, while an ordinary 白 still points to 东 (0.3163ms)
✔ new rounds retain the optional mode, and explicit changes and restarts reset it consistently (0.6851ms)
✔ wildcards complete sequences at their beginning, middle, and end and can supply the pair (0.7845ms)
✔ wildcards support seven pairs, an all-wild group, and exposed-hand remainders (0.1814ms)
✔ one wildcard cannot join distinct honors or tiles across a suit boundary into a sequence (0.2474ms)
✔ invalid physical hands and meld counts remain invalid when wildcards are enabled (0.1706ms)
✔ wildcard decomposition agrees with an independent exhaustive substitution oracle (26.2658ms)
✔ wildcards enable real self-draw and discard wins without altering physical tile identities (3.1171ms)
✔ a wildcard substitutes only in winning evaluation and cannot fabricate a chi or peng (1.2888ms)
✔ red dragons stay optional single-tile kongs alongside a distinct wildcard (0.6906ms)
✔ eight complete optional-mode AI rounds conserve tiles, scores, and the revealed indicator (247.0515ms)
✔ red discards are rejected without state changes for every seat (4.8598ms)
✔ discard hints never select red and distinguish a legal wildcard discard from no legal tile (5.1455ms)
✔ an injected red discard cannot grant Hu, peng, or an ordinary exposed kong (1.1614ms)
✔ four red dragons offer only individual special kongs, with ordinary kong APIs rejected (0.9481ms)
✔ a legacy exposed red peng cannot be upgraded through the ordinary added-kong API (1.2517ms)
✔ AI with an empty wall keeps its red and discards an ordinary tile (3.6797ms)
✔ AI with only reds and an empty wall ends the round instead of stalling or discarding red (1.1ms)
✔ the human last-wall red draw automatically resolves an otherwise blocked red-only turn (0.5878ms)
✔ a final replacement red resolves a blocked turn while retaining the declared kong and all tiles (0.9615ms)
✔ last-wall chi or peng that leaves only reds also resolves the human turn as a draw (1.3875ms)
✔ a complete concealed red pair blocks self-draw Hu without changing the game (0.6961ms)
✔ held reds and an incoming red each block a mathematically complete discard win (0.787ms)
✔ a held red cannot be discarded, and declaring it can enable an ordinary winning replacement (0.4566ms)
✔ AI handles the red prerequisite before declaring an otherwise complete hand (0.3382ms)
✔ one held red dragon is an optional action anywhere in the player’s discard turn (0.4059ms)
✔ a single-red kong replaces exactly one tile and keeps the player’s turn and ordinary meld slots (0.263ms)
✔ each of four held reds can be declared individually without creating four ordinary melds (0.4332ms)
✔ a replacement red dragon may itself be declared with a further replacement draw (0.1813ms)
✔ red-kong calls outside the owner’s discard turn leave the game unchanged (2.3427ms)
✔ an empty wall disables red kong, while the last wall tile can supply one final replacement (0.9157ms)
✔ red declarations stay separate from both concealed and exposed winning hand shapes (0.5129ms)
✔ AI declares its single red, draws once, then continues with its discard (1.0704ms)
✔ restarting or advancing a round clears every declared red and redeals all 136 tiles (0.6016ms)
✔ tile and suit constants are frozen public contracts (0.882ms)
✔ every physical tile encoding roundtrips through its suit and one-based rank (0.2966ms)
✔ suit boundaries keep one-based ranks and honors in their own cycle (0.3552ms)
✔ invalid codes and suit-rank combinations cannot enter the tile domain (0.3482ms)
✔ all legacy tile names, suit labels and wild cycles match the frozen pre-migration engine (0.5592ms)
ℹ tests 65
ℹ suites 0
ℹ pass 65
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1711.5375
```

```sh
node tests/domain-invariants.mjs
```

```text
PASS old-vs-domain: 200 seeded random rounds, 20371 random steps; 8 AI rounds, 278 AI steps.
Action coverage: {"discard":16813,"chi":982,"redGang":774,"gang:exposed":21,"pass":1337,"peng":443,"gang:added":34,"gang:concealed":15,"hu":24}
Result coverage: {"win":23,"draw":177}
Every step: 136 physical tiles, at most 4 copies, identical events bytes, scores and physical state.
Sample logs SHA256: {"seed":"domain-normal-0","steps":105,"laizi":false,"round":1,"dealer":0,"result":"draw","scores":[1000,1000,1000,1000],"oldEventsSha256":"c0c136da9ab877823c1064dcbf2b2536e34787b2d8ac34f4cc06814e54f2c242","newEventsSha256":"c0c136da9ab877823c1064dcbf2b2536e34787b2d8ac34f4cc06814e54f2c242","stepLogsSha256":"b26bcb15b8fe376b662a006ff9ddb1d9bef790edfe06d92e04f364014ba3473e"}
Report: output/domain-invariants-report.json
```

字面量扫描使用本机已有 GNU grep；下列每项 stdout/stderr 均为空，exit 1 表示无匹配。阶段采用 -F -f 读取三行带引号的模式，避免 Windows 外部命令参数解析改变引号。

```text
grep -n \b31\b engine.js
stdout: ""
stderr: ""
exit: 1

grep -n \b32\b engine.js
stdout: ""
stderr: ""
exit: 1

grep -n \b33\b engine.js
stdout: ""
stderr: ""
exit: 1

grep -nF -f output/domain-phase-literals.txt engine.js
stdout: ""
stderr: ""
exit: 1
```

output/domain-phase-literals.txt 的实际内容：

```text
'discard'
'claim'
'ended'
```

同 seed 胡牌样例的实际对比；200 局各步日志哈希和最终分数也已与旧旧基准报告逐项 deepEqual：

```json
{
  "seed": "domain-normal-22",
  "steps": 84,
  "scores": [
    1000,
    1030,
    970,
    1000
  ],
  "oldEventsSha256": "0941bd077a0e1f53c1149ffd913a0cde9eec23b2a0b0d1cb6feccf0ef5e5695d",
  "newEventsSha256": "0941bd077a0e1f53c1149ffd913a0cde9eec23b2a0b0d1cb6feccf0ef5e5695d",
  "all200StepHashesAndScoresMatchBaseline": true
}
```

```sh
node output/domain-validation-evidence.mjs
```

```json
{
  "scans": [
    {
      "command": "grep -n \\b31\\b engine.js",
      "exitCode": 1,
      "stdout": "",
      "stderr": ""
    },
    {
      "command": "grep -n \\b32\\b engine.js",
      "exitCode": 1,
      "stdout": "",
      "stderr": ""
    },
    {
      "command": "grep -n \\b33\\b engine.js",
      "exitCode": 1,
      "stdout": "",
      "stderr": ""
    },
    {
      "command": "grep -nF -f output/domain-phase-literals.txt engine.js",
      "exitCode": 1,
      "stdout": "",
      "stderr": ""
    }
  ],
  "comparison": {
    "rounds": 200,
    "randomSteps": 20371,
    "aiRounds": 8,
    "aiSteps": 278,
    "sample": {
      "seed": "domain-normal-22",
      "steps": 84,
      "laizi": false,
      "round": 21,
      "dealer": 0,
      "result": "win",
      "scores": [
        1000,
        1030,
        970,
        1000
      ],
      "oldEventsSha256": "0941bd077a0e1f53c1149ffd913a0cde9eec23b2a0b0d1cb6feccf0ef5e5695d",
      "newEventsSha256": "0941bd077a0e1f53c1149ffd913a0cde9eec23b2a0b0d1cb6feccf0ef5e5695d",
      "stepLogsSha256": "f4847e68a5118cef3527021751d62e44f4d8a576ce1d2d11f041a5f0ac26074c"
    },
    "allStepHashesAndFinalScoresMatchBaseline": true
  },
  "visuals": {
    "files": 6,
    "changed": 0
  },
  "ui": {
    "seed": "domain-ui-complete-round",
    "phase": "ended",
    "result": "win",
    "scores": [
      980,
      1060,
      980,
      980
    ],
    "clicks": {
      "hint": 19,
      "discard": 19,
      "pass": 11,
      "redGang": 0,
      "hu": 0
    },
    "resultDialogOpen": true,
    "errors": []
  },
  "tsc": {
    "available": false,
    "command": "where.exe tsc",
    "exitCode": 1,
    "stdout": "",
    "stderr": "INFO: Could not find files for the given pattern(s)."
  }
}
```

历史单机竖屏布局测试已移除；当前展示验收命令见 README 的验证章节。

完整新发牌对局通过真实提示、手牌及过牌按钮和现有 AI 定时器推进。只用 newRound(seed) 初始化，没有直接调用 discard/claim/advanceAI 推进；19 次出牌、11 次过后云舟自摸，phase ended，结算弹窗开启，四家分数 [980,1060,980,980]，控制台/网络错误 0。已目视检查结算截图 output/domain-ui-complete-round.png；完整事件见 output/domain-ui-complete-round.json。

index.html 与五个 CSS 的 SHA256 前后比对：6 个文件，变更 0。package.json 的 dependencies/devDependencies 仍为空，start/test 命令保持原样。

本机编译器探测的实际结果：

```json
{
  "available": false,
  "command": "where.exe tsc",
  "exitCode": 1,
  "stdout": "",
  "stderr": "INFO: Could not find files for the given pattern(s)."
}
```

**6. 遗留项**

本机没有可用 tsc，本轮未执行 TypeScript 编译检查，也未安装编译器或任何依赖。已完成 JSDoc 静态审查及运行时验证；编辑器按 jsconfig.json 检查。若本机以后已有编译器，正确指定配置的命令为 npx --no-install tsc --noEmit --checkJs -p jsconfig.json。不能把静态人工审查称为 tsc 通过。

本轮在领域模型与类型化结束。状态层、ViewModel、偏好持久化重构与调度器重构均未开始。
