---
name: 机械工程师工作台
description: 以工业选型目录为世界的能力训练台
colors:
  signal-vermilion: "#A8331E"
  vermilion-wash: "#F0DBD5"
  catalog-paper: "#F3F2EE"
  catalog-paper-shade: "#E9E7E1"
  punched-band: "#DCD9D2"
  press-black: "#15181B"
  ink-secondary: "#434A51"
  ink-tertiary: "#575E65"
  hairline: "#C7C4BC"
  hairline-strong: "#A9A69E"
typography:
  display:
    fontFamily: "Source Han Sans SC, Noto Sans SC, Microsoft YaHei, PingFang SC, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Source Han Sans SC, Noto Sans SC, Microsoft YaHei, PingFang SC, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Source Han Sans SC, Noto Sans SC, Microsoft YaHei, PingFang SC, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Source Han Sans SC, Noto Sans SC, Microsoft YaHei, PingFang SC, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "Source Han Sans SC, Noto Sans SC, Microsoft YaHei, PingFang SC, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  title-sm:
    fontFamily: "Source Han Sans SC, Noto Sans SC, Microsoft YaHei, PingFang SC, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.35
  label:
    fontFamily: "Source Han Sans SC, Noto Sans SC, Microsoft YaHei, PingFang SC, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.02em"
  data:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, SFMono-Regular, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.03em"
  data-sm:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, SFMono-Regular, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.03em"
rounded:
  control: "2px"
  surface: "2px"
spacing:
  hairline-gap: "8px"
  row: "14px"
  panel: "16px"
  sheet: "24px"
  section: "40px"
components:
  button:
    backgroundColor: "{colors.catalog-paper}"
    textColor: "{colors.press-black}"
    rounded: "{rounded.control}"
    padding: "7px 13px"
  button-hover:
    backgroundColor: "{colors.press-black}"
    textColor: "{colors.catalog-paper}"
  button-primary:
    backgroundColor: "{colors.press-black}"
    textColor: "{colors.catalog-paper}"
    rounded: "{rounded.control}"
    padding: "7px 13px"
  button-primary-hover:
    backgroundColor: "{colors.signal-vermilion}"
    textColor: "{colors.catalog-paper}"
  button-seal:
    backgroundColor: "{colors.catalog-paper}"
    textColor: "{colors.signal-vermilion}"
    rounded: "{rounded.control}"
    padding: "7px 13px"
  panel:
    backgroundColor: "{colors.catalog-paper}"
    rounded: "{rounded.surface}"
    padding: "16px"
  panel-header:
    backgroundColor: "{colors.catalog-paper-shade}"
    padding: "11px 16px"
  input:
    backgroundColor: "{colors.catalog-paper}"
    textColor: "{colors.press-black}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  chip:
    backgroundColor: "{colors.catalog-paper}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    padding: "1px 6px"
  gate-seal:
    backgroundColor: "{colors.punched-band}"
    textColor: "{colors.ink-secondary}"
    padding: "26px 14px"
---

# Design System: 机械工程师工作台

## Overview

**Creative North Star: "The Selection Catalog"（选型手册）**

这个工作台不是仪表盘，是一本摊开的工业选型手册：MISUMI、SKF、THK 那种纸上印出来的东西。密排的规格表、页边的零件号、一条贯穿全书的索引、以及印在纸上的规则线。用户是机械专业的学生，这类手册是他每天真的在翻的东西，所以界面不需要向他解释自己在做什么——密度、编号和规则线已经说明了一切。

纸面是唯一的底色层，深度只由纸的三种调子（`#F3F2EE` / `#E9E7E1` / `#DCD9D2`）和 1px 规则线表达，没有一处阴影。强调色只有一个：验收朱红 `#A8331E`，它只出现在三种场合——判断分歧、逾期、不可逆的危险操作，以及那条封住 AI 答案的穿孔封条。其余全部靠**线形**区分：实线已达标、虚线待复习、点线有分歧、双线达 5 级、空白未开始。这不是风格选择，是"状态不靠颜色也能读"的硬要求。

整个界面围绕一个动作组织：**手动闸门**。先写下自己的判断，才允许拆开封条看 AI 的对照。因此页面上最重要的视觉元素不是任何一块数据，而是那条压在 AI 答案上的穿孔带——它必须是可见的、可被拆开的、拆开后确实消失的。

**Key Characteristics:**

- 纸面、细规则线、无阴影、无圆角堆叠
- 单一强调色，占比极低；状态一律用线形承载
- 等宽字体只用于零件号、测量值、日期这类真实数据，不做装饰
- 密排表格是主要版面，密度是特征不是缺点
- 顶部一条 24 个月导轨，当前位置是一枚朱红三角

## Colors

整套配色是"一种纸 + 一种墨 + 一支朱笔"。

### Primary

- **Signal Vermilion 验收朱红**（#A8331E）：唯一的强调色。只用于判断分歧、逾期未复习、清空这类不可逆操作、以及手动闸门的封条与拆封后出现的对照问题标记。它在任何一个屏幕上占的面积都应该很小——它的珍贵就是它的作用。
- **Vermilion Wash 朱红淡洗**（#F0DBD5）：朱红的唯一底色变体，用于提醒条的背景（例如"该备份了"）。文字仍用 Press Black，不用灰。

### Neutral

- **Catalog Paper 手册纸**（#F3F2EE）：全站底色，也是面板与输入框的底。
- **Catalog Paper Shade 手册纸阴影层**（#E9E7E1）：第二层中性色。用于面板标题条、表格表头、悬停行、以及需要"陷下去"的区域。
- **Punched Band 穿孔带**（#DCD9D2）：第三层，只给封条和表头这类需要与纸面明确分离的条带。
- **Press Black 印刷黑**（#15181B）：正文与标题。是带蓝调的近黑，不是纯黑。
- **Ink Secondary 次级墨**（#434A51）：说明文字、次级标签。对纸面对比度约 8.5:1。
- **Ink Tertiary 三级墨**（#575E65）：编号、时间戳这类最弱的元信息。对纸面 5.9:1、对第二层纸色 5.3:1、对第三层 4.7:1——三层纸面上都过 4.5:1，这是允许的最低一档，不再往下放。
- **Hairline 细线**（#C7C4BC）/ **Hairline Strong 粗线**（#A9A69E）：所有分隔。表格内部用细线，区块边界用细线，章节边界用 Press Black。

### Named Rules

**The Line-Form Rule.** 状态永远不靠色相区分。已达标是实线，待复习是虚线，有分歧是朱红点线，达 5 级是双线，未开始是空白。任何新的状态都必须先问"它长什么样"，而不是"它是什么颜色"。

**The One Red Rule.** 验收朱红在任何一个屏幕上的占比不超过 10%。它标记的是需要你立刻注意的东西，不是装饰。

**The Three Tones Rule.** 深度只用三层纸色加规则线表达。不引入第四层灰，不引入阴影。

## Typography

**Display Font:** Source Han Sans SC（回退 Noto Sans SC / Microsoft YaHei / PingFang SC / system-ui）
**Body Font:** 同上，单一字族承担全部界面文字
**Label/Mono Font:** JetBrains Mono（回退 Cascadia Mono / Consolas / ui-monospace），只用于零件号、测量值、日期、统计数字

**Character:** 中文黑体承担全部层级，因为工业手册本来就是这样排的；等宽字只在真正是数据的地方出现——`DES-014`、`2026-09-15`、`8.5:1`。这是"等宽用于数据"而不是"等宽用于显得技术"。字距统一收紧到 -0.02em 左右，让密排中文不散。

### Hierarchy

- **Display**（700，23px，1.25，-0.03em）：只有刊头的工作台名。
- **Headline**（700，20px，1.25）：视图标题。
- **Title**（650，17px，1.35）：段落级小标题，例如今日清单的区头。
- **Title-sm**（600，15px，1.35）：知识点名、面板标题、任务标题。
- **Body**（400，15px，1.6，≤68ch）：正文与说明。表格可以更密（120ch+ 也可以）。
- **Body-sm**（400，14px，1.6）：封条文案、闸门说明、表格正文。
- **Label**（600，13px，+0.02em）：字段标签、按钮、状态词。
- **Data**（400，12px，+0.03em，tabular-nums）：编号、日期、等级数字。
- **Data-sm**（400，11px，+0.03em）：表头与最密的表内元信息。

**梯度只有八级：11 / 12 / 13 / 14 / 15 / 17 / 20 / 23。**任何新字号都必须落在这八级上；需要"稍微大一点"时，改字重或字距，不加新尺寸。

### Named Rules

**The Mono-For-Data Rule.** 等宽字体只能出现在真实的编码、测量值、日期与统计数字上。不要用它做标签、标题或装饰。

**The Fixed-Scale Rule.** 字号固定，不用流体缩放。这是每天盯着看很多遍的工具，一致性比戏剧性重要。

**The Eight-Step Rule.** 版面只允许 11 / 12 / 13 / 14 / 15 / 17 / 20 / 23 这八级字号。加一级新尺寸之前，先试字重和字距。

## Layout

内容最大宽度 1500px，左右留白 24px。刊头下方是 24 个月导轨，再下方是视图切换，然后是内容。

两种版面模型：**任务流**（今日视图）与**规格表**（能力矩阵）。今日视图用 `1fr + 320px` 的双栏，间距 40px，1080px 以下收成单栏。能力矩阵是一张 `min-width: 860px` 的表格，窄屏横向滚动——这是刻意的选择：密排规格表在手机上本来就该横着看，把列砍掉会让编号和等级失去对齐关系。

列表行用四栏网格：编号 96px / 主体 1fr / 复习日 132px / 操作 116px，栏距 16px，820px 以下折成两栏。

## Elevation & Depth

**没有阴影。**整个系统是平的，深度只由三层纸色和 1px 规则线表达。悬停不抬升元素，只改变底色到 Catalog Paper Shade；焦点用 2px 朱红轮廓加 2px 偏移；边框与阴影不同时出现——本系统只有边框。

### Named Rules

**The Flat-By-Default Rule.** 表面静止时是平的。任何深度都必须来自纸色分层或规则线，不允许 shadow。

## Shapes

圆角一律 2px，只为了让边框在屏幕像素上不显得锯齿，而不是为了"柔和"。表格与页边完全直角。边框统一 1px；分区边界与刊头底边用 Press Black 的 1px，形成手册里那种章节线。唯一允许的装饰性几何是封条上的 2px 虚线穿孔。按钮一律不用胶囊形，小控件（chip）例外。

## Components

### Buttons

- **Shape:** 2px 圆角，1px Press Black 边框，无阴影
- **Primary:** Press Black 底 + 纸色文字，`7px 13px`。每个操作区只有一个。
- **Hover / Focus:** 悬停反相为墨底纸字，200ms；`:active` 下移 1px；焦点是 2px 朱红轮廓 + 2px 偏移
- **Secondary:** 同形状，边框降到 Hairline Strong，字重降到 500。用于"次要但相关"的动作
- **Seal（朱红描边）:** 只给不可逆操作（清空进度）与脱离主流程的动作
- **Tiny:** `4px 9px` / 12px，只出现在表格行内
- **Disabled:** 边框降为 Hairline、文字降为 Ink Tertiary、底色变 Paper Shade，且悬停不变——禁用态必须一眼看出不会响应

### Chips

- **Style:** 纸色底，1px Hairline Strong 边框，2px 圆角，等宽 10.5px 的 Ink Secondary 文字。承载知识点编号这类引用。
- **State:** 目前只读，不可点击。

### Cards / Containers

这里不用卡片，用**面板**和**表格行**。

- **Corner Style:** 2px 圆角
- **Background:** 纸色，标题条用 Catalog Paper Shade
- **Border:** 1px Hairline Strong
- **Shadow Strategy:** 无
- **Internal Padding:** 面板 16px，标题条 `11px 16px`，表格单元 `9px 12px`，列表行 `14px 4px`

### Inputs / Fields

- **Style:** 1px Hairline Strong 边框，纸色底，2px 圆角，14px 正文
- **Focus:** 2px 朱红轮廓，偏移 2px
- **Placeholder:** Ink Tertiary（4.9:1），不再更浅

### Navigation

顶部页签，底部 2px 下划线标记选中（Press Black）。选中项字重 700，未选中 550 并降为 Ink Secondary。悬停给 Paper Shade 底。右侧可挂一个等宽的小计数。

### State Mark（标志性组件）

五个 14×2px 的线段组成的等级记号。已达标是 3px 实线；下一级是 2px 虚线；未达标是 Paper Shade 的底纹；达 5 级时最后一段加双线。旁边永远跟一个等宽数字（`3`），因为线形给人看，数字给数据看。这个组件是全站状态语言的核心。

**0 级时五段全部留空，不画"下一级"的虚线。**虚线在图例里代表"待复习"，如果还没开始的知识点也顶着虚线，同一套记号就有了两种含义，整套语言立刻失效。

### Manual Gate（标志性组件）

手动闸门是全站最重要的组件，由四层组成：标题条（含"历史 N 次 · 分歧 N 次"）、题目区、输入区、以及被穿孔带盖住的对照区。封条是 `Punched Band` 底 + 2px 虚线穿孔，文案是"AI 对照被封在这里。先写下你的判断。"。只有输入达到 20 字，拆封按钮才解除禁用。拆封时封条上移、透明度归零、高度收为 0（200ms），对照区展开。自评按钮里"明显不一致"是唯一使用朱红实底的状态——它标记的是产品最看重的输出，而不是错误。

## Do's and Don'ts

### Do:

- **Do** 用线形表达状态：实线 / 虚线 / 点线 / 双线 / 空白，先于任何颜色决定。
- **Do** 把朱红留给判断分歧、逾期、不可逆操作和封条四处，占比压在 10% 以内。
- **Do** 用 Ink Tertiary（#575E65）作为最浅的文字；它必须在全部三层纸色上都过 4.5:1，这是下限。
- **Do** 让编号、日期、等级数字用等宽加 tabular-nums 对齐，这样一列数字能竖着扫。
- **Do** 保持 2px 圆角与 1px 边框这套唯一的形状语言，包括禁用态。
- **Do** 让 0 级保持全空：虚线只表示"待复习"，不表示"还没开始"。
- **Do** 让密集的表格横着滚，而不是砍列——列之间的对齐关系就是信息。

### Don't:

- **Don't** 引入阴影、玻璃模糊、渐变文字或任何发光；深度只有三层纸色和规则线。
- **Don't** 用色相区分状态。色盲用户必须能读出全部状态。
- **Don't** 把内容做成"图标 + 标题 + 正文"的同尺寸卡片阵列；这里的容器是规格表与列表行。
- **Don't** 在标题上方加小标签（kicker）。标题自己承担自己的重量。
- **Don't** 用 emoji 或 Unicode 字符当图标。本系统不用图标，用文字与线形。
- **Don't** 把等宽字体当作"技术感"装饰用在标签或标题上。
- **Don't** 用胶囊形按钮或 12px 以上的圆角。
