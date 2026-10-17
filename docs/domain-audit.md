# 领域模型迁移：冻结源审计

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
