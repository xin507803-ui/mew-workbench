/* 机械工程师工作台 — 应用逻辑
   全部数据存在 localStorage，并可导出为 JSON 文件。 */
(function () {
  "use strict";

  var C = window.CURRICULUM;
  var STORE_KEY = "mew.state.v1";
  var SCHEMA = 1;
  var DAY = 86400000;

  /* ---------- 工具 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function todayISO(d) {
    var t = d ? new Date(d) : new Date();
    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / DAY); }
  function addDays(iso, n) { return todayISO(new Date(new Date(iso).getTime() + n * DAY)); }
  function nowISO() { return new Date().toISOString(); }

  var ALL = [];
  C.modules.forEach(function (m) {
    m.items.forEach(function (it) { it._mod = m; ALL.push(it); });
  });
  var BY_ID = {};
  ALL.forEach(function (it) { BY_ID[it.id] = it; });

  /* ---------- 状态 ---------- */
  function blankState() {
    return {
      schema: SCHEMA, createdAt: nowISO(), exportedAt: null,
      settings: { startDate: todayISO(), dailyMinutes: 60, owner: "" },
      items: {}, evidence: [], gates: [], done: {}
    };
  }
  var state = blankState();

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var p = JSON.parse(raw);
      if (p && p.schema === SCHEMA) { state = p; return true; }
      if (p && p.items) { state = Object.assign(blankState(), p); state.schema = SCHEMA; return true; }
    } catch (e) { console.warn("读取进度失败", e); }
    return false;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { flash("存不进去了：浏览器存储满了或被禁用。赶紧先存一份到电脑。"); }
  }
  function rec(id) {
    if (!state.items[id]) {
      state.items[id] = { lv: 0, due: null, interval: 0, ease: 2.3, reps: 0, lastAt: null, basis: "", due_short: false };
    }
    return state.items[id];
  }
  /* 只读：不创建记录，避免浏览行为污染存储 */
  function lvOf(id) { return state.items[id] ? state.items[id].lv : 0; }

  /* ---------- 间隔重复（简化 SM-2） ---------- */
  var STEPS = [1, 3, 7, 16, 35, 75, 150];
  function schedule(id, verdict) {
    var r = rec(id);
    var today = todayISO();
    if (verdict === "same") {
      r.reps += 1;
      r.ease = Math.min(2.8, r.ease + 0.05);
      var iv = STEPS[Math.min(r.reps - 1, STEPS.length - 1)];
      r.interval = Math.round(iv * (r.ease / 2.3));
      r.due = addDays(today, r.interval);
      r.due_short = false;
    } else if (verdict === "partial") {
      r.reps = Math.max(1, Math.round(r.reps * 0.5));
      r.ease = Math.max(1.6, r.ease - 0.15);
      r.interval = Math.max(1, Math.round(r.interval * 0.5) || 1);
      r.due = addDays(today, r.interval);
      r.due_short = false;
    } else {
      r.reps = 0;
      r.ease = Math.max(1.5, r.ease - 0.3);
      r.interval = 1;
      r.due = addDays(today, 1);
      r.due_short = true;
    }
    r.lastAt = today;
    return r;
  }

  function isDue(id) {
    var r = state.items[id];
    if (!r || !r.due || r.lv === 0) return false;
    return daysBetween(r.due, todayISO()) >= 0;
  }
  function evidenceFor(id) {
    return state.evidence.filter(function (e) { return (e.itemIds || []).indexOf(id) >= 0; });
  }
  function gatesFor(id) {
    return state.gates.filter(function (g) { return g.itemId === id; });
  }
  function diffCount(id) {
    return gatesFor(id).filter(function (g) { return g.verdict === "diff"; }).length;
  }

  /* ---------- 标记 ---------- */
function mark(lv, cls) {
  var h = '<span class="mark lv' + lv + (cls ? " " + cls : "") + '" aria-hidden="true">';
  for (var i = 1; i <= 5; i++) {
    // 0 级不画"下一级"虚线：图例里虚线代表"待复习"，
    // 还没开始的知识点全顶着虚线，会让整套记号语言自相矛盾。
    h += '<i class="' + (i <= lv ? "on" : (i === lv + 1 && lv > 0 ? "next" : "")) + '"></i>';
  }
  return h + "</span>";
}
  function lvName(lv) { return C.ladder[lv] ? C.ladder[lv].name : "—"; }

  /* ---------- 今日任务 ---------- */
  function stageNow() {
    var elapsed = Math.floor(daysBetween(state.settings.startDate, todayISO()) / 30.44);
    var s = C.stages[0];
    C.stages.forEach(function (st) {
      var m = st.months.match(/(\d+)/);
      var start = m ? parseInt(m[1], 10) : 1;
      if (elapsed + 1 >= start) s = st;
    });
    return { stage: s, month: Math.min(24, elapsed + 1) };
  }

  function coreItems() { return ALL.filter(function (i) { return i._mod.depth === "core"; }); }

  function buildTasks() {
    var tasks = [];
    var seen = {};
    function push(t) {
      if (seen[t.item.id]) return;
      seen[t.item.id] = 1;
      tasks.push(t);
    }

    var due = ALL.filter(function (i) { return isDue(i.id); })
      .sort(function (a, b) { return (state.items[a.id].due < state.items[b.id].due ? -1 : 1); });
    due.slice(0, 6).forEach(function (i) {
      push({
      kind: diffCount(i.id) > 0 ? "和 AI 对不上" : "该复习了", item: i,
        why: diffCount(i.id) > 0
          ? "这条你已经和 AI 对不上 " + diffCount(i.id) + " 次了，先重练它。"
          : "到日子了，用你自己的话复述一遍就行。"
      });
    });

    var weak = coreItems().filter(function (i) { return lvOf(i.id) < 3; })
      .sort(function (a, b) { return lvOf(a.id) - lvOf(b.id); });
    weak.slice(0, 3).forEach(function (i) {
      push({ kind: "今天该练", item: i, why: (i._mod.name) + " 是你的主攻方向，这条现在还是「" + lvName(lvOf(i.id)) + "」。" });
    });

    var noEv = ALL.filter(function (i) { return lvOf(i.id) >= 3 && evidenceFor(i.id).length === 0; });
    noEv.slice(0, 2).forEach(function (i) {
      push({ kind: "补个作品", item: i, why: "已经到 " + lvOf(i.id) + " 级了，但还没有拿得出手的东西作证明，补一个。" });
    });

    var budget = Math.max(3, Math.min(8, Math.round(state.settings.dailyMinutes / 12)));
    return tasks.slice(0, budget);
  }

  /* ---------- 视图：今日 ---------- */
  function renderToday() {
    var st = stageNow();
    var tasks = buildTasks();
    var doneToday = Object.keys(state.done).filter(function (k) { return state.done[k] === todayISO(); }).length;
    var totalGate = state.gates.length;
    var totalDiff = state.gates.filter(function (g) { return g.verdict === "diff"; }).length;
    var lvSum = ALL.reduce(function (s, i) { return s + lvOf(i.id); }, 0);
    var coreLv = coreItems().reduce(function (s, i) { return s + lvOf(i.id); }, 0);

    var html = '';
    html += '<div class="view-head"><h2>今日</h2><p class="note">现在是第 ' + (C.stages.indexOf(st.stage) + 1) + ' 阶段「' + esc(st.stage.name) + '」（' + esc(st.stage.months) + '）。' +
      esc(st.stage.daily) + '</p></div>';

    if (!state.exportedAt || daysBetween(state.exportedAt.slice(0, 10), todayISO()) >= 14) {
      html += '<div style="padding-top:16px"><div class="notice"><span><b>该存一份了。</b>你的进度只存在这个浏览器里，清一下缓存就没了。' +
        (state.exportedAt ? '上次存档：' + esc(state.exportedAt.slice(0, 10)) + '。' : '还没存过。') +
        '</span><button class="btn" data-act="export">存一份到电脑</button></div></div>';
    }

    html += '<div class="cols" style="padding-top:22px">';
    html += '<div><div class="view-head" style="padding-top:0;border-bottom:1px solid var(--ink)"><h2 style="font-size:17px">今天要做的</h2>' +
      '<span class="code">共 ' + tasks.length + ' 条 · 已完成 ' + doneToday + '</span></div>';
    if (!tasks.length) {
      html += '<div class="empty" style="margin-top:16px"><h3>今天没有要做的</h3>' +
        '<p>该复习的都练完了，主攻方向也都过了 3 级。你可以自己挑一条来练，或者去「能力清单」里调整等级。</p></div>';
    } else {
      html += '<div class="list" style="margin-top:0">';
      tasks.forEach(function (t, idx) {
        html += taskRow(t, idx);
      });
      html += '</div>';
    }
    html += '</div>';

    html += '<aside style="padding-top:0">';
    html += panel("我的进度", [
      stat("现在在哪", st.stage.name + " · 第 " + st.month + " 个月"),
      stat("全部等级", lvSum + " / " + (ALL.length * 5), "共 " + ALL.length + " 条"),
      stat("设计与工艺", coreLv + " / " + (coreItems().length * 5), "你的主攻方向"),
      stat("练习次数", totalGate, "和 AI 对不上 " + totalDiff + " 次"),
      stat("作品数", state.evidence.length, "能证明 " + ALL.filter(function (i) { return evidenceFor(i.id).length > 0; }).length + " 条")
    ]);
    html += panelLegend();
    html += '</aside></div>';
    $("#view-today").innerHTML = html;
  }

  function taskRow(t, idx) {
    var lv = lvOf(t.item.id);
    return '<article class="task" data-task="' + esc(t.item.id) + '">' +
      '<div class="task-head">' +
      '<span class="kind">' + esc(t.kind) + '</span>' +
      '<span class="code">' + esc(t.item.id) + '</span>' +
      '<h3>' + esc(t.item.name) + '</h3>' +
      '<span class="code" style="margin-left:auto">' + mark(lv) + ' ' + lv + ' 级</span>' +
      '</div>' +
      '<p class="sub" style="font-size:13px;color:var(--ink-2);margin-top:8px">' + esc(t.why) + '</p>' +
      '<div style="margin-top:12px"><button class="btn primary" data-act="open-gate" data-id="' + esc(t.item.id) + '">开始做题</button> ' +
      '<button class="btn ghost" data-act="open-item" data-id="' + esc(t.item.id) + '">先看看这条是什么</button></div>' +
      '<div class="gate-slot" data-slot="' + esc(t.item.id) + '"></div>' +
      '</article>';
  }

  function panel(title, rows) {
    return '<div class="panel"><div class="panel-h"><h3>' + esc(title) + '</h3></div><div class="panel-b">' +
      '<dl style="margin:0">' + rows.join("") + '</dl></div></div>';
  }
  function stat(k, v, sub) {
    return '<div class="stat"><dt>' + esc(k) + '</dt><dd>' + esc(v) + (sub ? '<span style="font-family:var(--sans);font-size:12px;color:var(--ink-3);margin-left:8px">' + esc(sub) + '</span>' : "") + '</dd></div>';
  }
  function panelLegend() {
    return '<div class="panel"><div class="panel-h"><h3>标记怎么看</h3><span class="code">看线的样子</span></div><div class="panel-b">' +
      '<div class="tagline" style="margin-bottom:8px"><u class="solid"></u>实线：已经会了</div>' +
      '<div class="tagline" style="margin-bottom:8px"><u class="dash"></u>虚线：该复习了</div>' +
      '<div class="tagline" style="margin-bottom:8px"><u class="short" style="border-top-color:var(--seal)"></u>红点线：和 AI 对不上</div>' +
      '<div class="tagline" style="margin-bottom:8px"><u class="dbl"></u>双线：最熟的一档</div>' +
      '<div class="tagline"><u class="blank"></u>空白：还没开始</div>' +
      '</div></div>';
  }

  /* ---------- 手动闸门 ---------- */
  function openGate(slot, id) {
    var it = BY_ID[id];
    if (!it) return;
    var r = rec(id);
    var hist = gatesFor(id);
    var diffs = hist.filter(function (g) { return g.verdict === "diff"; }).length;

    slot.innerHTML =
      '<div class="gate">' +
        '<div class="gate-h"><strong>先自己写，再看 AI 怎么说</strong>' +
          '<span class="sealmark">' + (hist.length ? "练过 " + hist.length + " 次 · 对不上 " + diffs + " 次" : "第一次练") + '</span>' +
        '</div>' +
        '<div class="gate-q"><p class="q">' + esc(it.gate) + '</p>' +
          '<p class="hint">别查资料、别问 AI。写下你的答案和理由；不确定就写清你不确定什么。</p></div>' +
        '<div class="gate-input">' +
          '<label for="ans-' + esc(id) + '" style="font-size:13px;color:var(--ink-2);display:block;margin-bottom:6px">我的答案</label>' +
          '<textarea id="ans-' + esc(id) + '" data-ans="' + esc(id) + '" placeholder="先写结论，再写理由，最后写你不确定的地方。"></textarea>' +
          '<div class="gate-actions">' +
            '<button class="btn primary" data-act="unseal" data-id="' + esc(id) + '" disabled>打开看 AI 答案</button>' +
            '<span class="why" data-why="' + esc(id) + '">写满 20 个字才能打开</span>' +
          '</div>' +
        '</div>' +
        '<div class="seal-wrap" data-seal="' + esc(id) + '">' +
          '<div class="seal-cover"><p>AI 的答案在这里面。先写完你自己的，再打开。</p></div>' +
          '<div class="seal-body">' +
            '<table class="compare">' +
              '<tr><th>打开后做这些</th><th>内容</th></tr>' +
              '<tr><td>去问 AI</td><td><pre>' + esc(it.probe) + '</pre>' +
                '<div style="margin-top:8px"><button class="btn tiny" data-act="copy" data-copy="' + esc(it.probe) + '">复制</button></div></td></tr>' +
              '<tr><td>做到这样算会了（3 级）</td><td>' + esc(it.l3) + '</td></tr>' +
              '<tr><td>做到这样算很懂了（5 级）</td><td>' + esc(it.l5) + '</td></tr>' +
              '<tr><td>出处</td><td>' + esc(it.ref) + '</td></tr>' +
            '</table>' +
            '<p class="hint" style="margin-top:12px">一条一条比。对不上的地方，才是你真正要补的。</p>' +
            '<div class="verdict">' +
              '<button class="btn" data-act="verdict" data-id="' + esc(id) + '" data-v="same">基本对上了</button>' +
              '<button class="btn" data-act="verdict" data-id="' + esc(id) + '" data-v="partial">对了一半</button>' +
              '<button class="btn diff" data-act="verdict" data-id="' + esc(id) + '" data-v="diff">差得比较远</button>' +
            '</div>' +
            '<div style="margin-top:12px"><label class="help" style="font-size:13px;color:var(--ink-2);display:block;margin-bottom:6px">哪里对不上？（可以不写，写了才会进复习清单）</label>' +
            '<textarea data-note="' + esc(id) + '" style="min-height:64px" placeholder="哪里不一致？正确的是什么？"></textarea></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var ta = $('[data-ans="' + id + '"]', slot);
    var btn = $('[data-act="unseal"]', slot);
    var why = $('[data-why="' + id + '"]', slot);
    ta.addEventListener("input", function () {
      var n = ta.value.trim().length;
      btn.disabled = n < 20;
      why.textContent = n < 20 ? ("还差 " + (20 - n) + " 个字才能打开") : "可以打开了。";
    });
    ta.focus();
    slot.scrollIntoView({ block: "nearest" });
  }

  function unseal(id) {
    var w = $('[data-seal="' + id + '"]');
    if (w) w.classList.add("open");
  }

  function recordGate(id, verdict) {
    var slot = $('[data-slot="' + id + '"]') || $('[data-detail="' + id + '"]');
    var ans = $('[data-ans="' + id + '"]');
    var note = $('[data-note="' + id + '"]');
    var g = {
      id: "g" + Date.now(), itemId: id, at: nowISO(),
      answer: ans ? ans.value.trim() : "", verdict: verdict,
      note: note ? note.value.trim() : ""
    };
    state.gates.push(g);
    var r = schedule(id, verdict);
    state.done[id] = todayISO();
    save();
    var msg = {
      same: "记下了。下次复习：" + r.due + "。",
      partial: "记下了。对了一半，过 " + r.interval + " 天再练一次。",
      diff: "记下了。明天再练一次。"
    }[verdict];
    if (slot) {
      var box = document.createElement("div");
      box.className = "notice";
      box.style.marginTop = "14px";
      var canUp = verdict === "same" && r.lv < 5;
      box.innerHTML = '<span><b>' + esc(msg) + '</b>' + (canUp ? ' 想升级的话，去「能力清单」里填个理由。' : "") + '</span>' +
        '<button class="btn" data-act="close-gate" data-id="' + esc(id) + '">关掉</button>';
      slot.appendChild(box);
    }
    refresh();
  }

  /* ---------- 视图：能力矩阵 ---------- */
  var mFilter = { mod: "all", lv: "all", q: "" };

  function renderMatrix() {
    var rows = "";
    C.modules.forEach(function (m) {
      if (mFilter.mod !== "all" && mFilter.mod !== m.code) return;
      var items = m.items.filter(function (it) {
        var lv = lvOf(it.id);
        if (mFilter.lv === "low" && lv > 2) return false;
        if (mFilter.lv === "mid" && (lv < 3 || lv > 4)) return false;
        if (mFilter.lv === "high" && lv < 5) return false;
        if (mFilter.lv === "nodata" && !isDue(it.id)) return false;
        if (mFilter.q) {
          var s = (it.id + " " + it.name + " " + it.en).toLowerCase();
          if (s.indexOf(mFilter.q.toLowerCase()) < 0) return false;
        }
        return true;
      });
      if (!items.length) return;
      var avg = m.items.reduce(function (s, i) { return s + lvOf(i.id); }, 0) / m.items.length;
      rows += '<tr class="mod"><th colspan="6">' + esc(m.name) + ' · ' + esc(m.en) +
        '<small>' + esc(m.code) + ' · ' + m.items.length + ' 条 · 平均 ' + avg.toFixed(2) + (m.depth === "core" ? ' · 主攻' : ' · 辅助') + '</small></th></tr>';
      items.forEach(function (it) {
        var lv = lvOf(it.id);
        var r = state.items[it.id] || { due: null };
        var ev = evidenceFor(it.id).length;
        var d = diffCount(it.id);
        rows += '<tr><td class="num">' + esc(it.id) + '</td>' +
          '<td><b style="font-weight:600">' + esc(it.name) + '</b><div class="en" style="font-family:var(--mono);font-size:11px;color:var(--ink-3)">' + esc(it.en) + '</div></td>' +
          '<td class="num">' + mark(lv) + ' <span style="margin-left:6px">' + lv + '</span></td>' +
          '<td class="num">' + (r.due ? esc(r.due) : "—") + (isDue(it.id) ? ' <span style="color:var(--seal)">该复习</span>' : "") + '</td>' +
          '<td class="num">' + ev + (d ? ' <span style="color:var(--seal)">对不上 ' + d + '</span>' : "") + '</td>' +
          '<td class="act"><button class="btn tiny" data-act="open-item" data-id="' + esc(it.id) + '">打开</button></td></tr>';
        rows += '<tr hidden data-detail-row="' + esc(it.id) + '"><td colspan="6" style="background:var(--paper-2)">' +
          '<div data-detail="' + esc(it.id) + '"></div></td></tr>';
      });
    });
    if (!rows) rows = '<tr><td colspan="6" style="padding:26px;color:var(--ink-2)">没有符合条件的。</td></tr>';

    $("#view-matrix").innerHTML =
      '<div class="view-head"><h2>能力清单</h2><p class="note">等级看你做出来过什么，不看你觉得会不会。想升级，要么挂一个作品，要么写清楚你凭什么。</p></div>' +
      '<div class="filters">' +
        '<label>模块 <select data-f="mod"><option value="all">全部</option>' +
          C.modules.map(function (m) { return '<option value="' + m.code + '"' + (mFilter.mod === m.code ? " selected" : "") + '>' + esc(m.name) + '</option>'; }).join("") +
        '</select></label>' +
        '<label>等级 <select data-f="lv">' +
          ["all:全部", "low:0–2 级（还没上手）", "mid:3–4 级（能自己做、能发现错）", "high:5 级（最熟）", "nodata:今天该复习"].map(function (o) {
            var v = o.split(":")[0];
            return '<option value="' + v + '"' + (mFilter.lv === v ? " selected" : "") + '>' + esc(o.split(":")[1]) + '</option>';
          }).join("") +
        '</select></label>' +
        '<label>搜索 <input type="search" data-f="q" value="' + esc(mFilter.q) + '" placeholder="名称、编号、英文"></label>' +
        '<span class="code" style="margin-left:auto">共 ' + ALL.length + ' 条</span>' +
      '</div>' +
      '<div class="tablewrap"><table class="grid"><thead><tr>' +
        '<th>编号</th><th>练什么</th><th>等级</th><th>下次复习</th><th>作品 / 对不上</th><th style="text-align:right">操作</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function openItem(id, inMatrix) {
    var it = BY_ID[id];
    var r = state.items[id] || { lv: 0, basis: "", due: null };
    var host = inMatrix ? $('[data-detail="' + id + '"]') : $('[data-slot="' + id + '"]');
    if (!host) return;
    if (inMatrix) {
      var row = $('[data-detail-row="' + id + '"]');
      if (row && !row.hidden) { row.hidden = true; host.innerHTML = ""; return; }
      if (row) row.hidden = false;
    }

    var evs = evidenceFor(id);
    var hist = gatesFor(id);
    var lvOpts = C.ladder.map(function (l) {
      return '<option value="' + l.lv + '"' + (l.lv === r.lv ? " selected" : "") + '>' + l.lv + ' 级 · ' + esc(l.name) + '</option>';
    }).join("");

    host.innerHTML =
      '<div class="panel" style="margin:14px 0">' +
        '<div class="panel-h"><h3>' + esc(it.id) + ' · ' + esc(it.name) + '</h3><span class="code">' + esc(it._mod.name) + '</span></div>' +
        '<div class="panel-b">' +
          '<p style="font-size:14px;color:var(--ink-2);max-width:68ch">' + esc(it.why) + '</p>' +
          '<table class="compare" style="margin-top:14px">' +
            '<tr><td>会做了（3 级）</td><td>' + esc(it.l3) + '</td></tr>' +
            '<tr><td>很懂了（5 级）</td><td>' + esc(it.l5) + '</td></tr>' +
            '<tr><td>出处</td><td>' + esc(it.ref) + '</td></tr>' +
            (hist.length ? '<tr><td>上次练</td><td>' + esc(new Date(hist[hist.length - 1].at).toLocaleDateString("zh-CN")) + ' · ' +
              (hist[hist.length - 1].verdict === "same" ? "基本对上了" : hist[hist.length - 1].verdict === "partial" ? "对了一半" : "差得比较远") +
              (hist[hist.length - 1].note ? "：" + esc(hist[hist.length - 1].note) : "") + '</td></tr>' : '') +
          '</table>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;align-items:center">' +
            '<button class="btn primary" data-act="gate-here" data-id="' + esc(id) + '">做一道题</button>' +
            '<button class="btn" data-act="add-evidence" data-id="' + esc(id) + '">加一个作品</button>' +
            '<span class="code">' + (evs.length ? "挂了 " + evs.length + " 个作品" : "还没挂作品") + '</span>' +
          '</div>' +
          '<div style="margin-top:18px;border-top:1px solid var(--rule);padding-top:14px">' +
            '<div class="field"><label for="lv-' + esc(id) + '">改等级</label>' +
            '<div class="field-row"><select id="lv-' + esc(id) + '" data-lvsel="' + esc(id) + '">' + lvOpts + '</select>' +
            '<input type="text" data-lvbasis="' + esc(id) + '" value="' + esc(r.basis || "") + '" placeholder="凭什么：作品名、项目、或你做过什么"></div>' +
            '<span class="help">规矩：升到 3 级以上，如果没挂作品，这一栏必须写清楚。空着不给升。</span></div>' +
            '<button class="btn" data-act="set-lv" data-id="' + esc(id) + '">保存</button>' +
          '</div>' +
          '<div data-gate-host="' + esc(id) + '" style="margin-top:14px"></div>' +
        '</div>' +
      '</div>';
  }

  function setLevel(id) {
    var sel = $('[data-lvsel="' + id + '"]');
    var basis = $('[data-lvbasis="' + id + '"]');
    if (!sel) return;
    var lv = parseInt(sel.value, 10);
    var r = rec(id);
    var hasEv = evidenceFor(id).length > 0;
    if (lv > r.lv && lv >= 3 && !hasEv && !basis.value.trim()) {
      flash("等级没变。升到 3 级以上，得挂一个作品，或者写清楚你凭什么。");
      basis.focus();
      return;
    }
    r.lv = lv;
    r.basis = basis.value.trim();
    if (!r.due && lv > 0) r.due = todayISO();
    save();
    flash("记下了：" + BY_ID[id].name + " → " + lv + " 级（" + lvName(lv) + "）。");
    refresh();
  }

  /* ---------- 视图：路线 ---------- */
  function renderRoute() {
    var core = coreItems();
    var atLeast = function (n) { return core.filter(function (i) { return lvOf(i.id) >= n; }).length; };
    var pct = function (n) { return core.length ? Math.round(atLeast(n) / core.length * 100) : 0; };
    var checks = [
      { max: 1, pct: pct(1), need: 60 },
      { max: 3, pct: pct(3), need: 60 },
      { max: 4, pct: pct(4), need: 40 },
      { max: 5, pct: pct(5), need: 25 }
    ];
    var st = stageNow();
    var elapsedMonths = Math.floor(daysBetween(state.settings.startDate, todayISO()) / 30.44) + 1;

    var html = '<div class="view-head"><h2>24 个月路线</h2><p class="note">' +
      '设计与工艺共 ' + core.length + ' 条，是你的主攻方向。能不能进下一阶段，看这 ' + core.length + ' 条的等级，不看学了多久。' +
      '你现在在第 ' + Math.min(24, elapsedMonths) + ' 个月。</p></div>';

    html += '<div class="panel" style="margin-top:22px"><div class="panel-h"><h3>能不能进下一阶段</h3><span class="code">现在的情况</span></div><div class="panel-b">' +
      '<dl style="margin:0">' +
      checks.map(function (c) {
        return '<div class="stat"><dt>' + c.max + ' 级以上的比例</dt><dd>' + c.pct + '%' +
          '<span style="font-family:var(--sans);font-size:12px;color:var(--ink-3);margin-left:8px">要求 ' + c.need + '%</span></dd></div>';
      }).join("") + '</dl></div></div>';

    C.stages.forEach(function (s, i) {
      var isNow = s.id === st.stage.id;
      html += '<section class="stage">' +
        '<div class="stage-h"><h3>' + esc(s.name) + '</h3><span class="span">' + esc(s.months) + ' · 约 ' + s.weeks + ' 周</span>' +
        '<span class="state">' + (isNow ? "你在这里" : (i < C.stages.indexOf(st.stage) ? "已经走过" : "还没到")) + '</span></div>' +
        '<div class="stage-goal">' +
          '<div><h4>开始这一阶段前</h4><ul>' + s.entry.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul></div>' +
          '<div><h4>这一阶段结束时</h4><ul>' + s.exit.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul></div>' +
          '<div><h4>怎么练</h4><ul><li>' + esc(s.daily) + '</li><li>' + esc(s.weekly) + '</li></ul></div>' +
        '</div></section>';
    });

    html += '<div class="panel"><div class="panel-h"><h3>等级怎么算</h3><span class="code">所有模块共用</span></div><div class="panel-b">' +
      '<table class="compare">' + C.ladder.map(function (l) {
        return '<tr><td>' + l.lv + ' 级 · ' + esc(l.name) + '</td><td>' + esc(l.def) + '</td></tr>';
      }).join("") + '</table></div></div>';

    $("#view-route").innerHTML = html;
  }

  /* ---------- 视图：证据库 ---------- */
  function renderEvidence() {
    var list = state.evidence.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var opts = ALL.map(function (i) { return '<option value="' + esc(i.id) + '">' + esc(i.id + " · " + i.name) + '</option>'; }).join("");

    var html = '<div class="view-head"><h2>作品与记录</h2><p class="note">' +
      '一张图纸、一份计算书、一次拆机记录、一次失效分析，都算。等级只有挂了作品才算数。</p></div>';

    html += '<div class="cols" style="padding-top:22px"><div>';
    if (!list.length) {
      html += '<div class="empty"><h3>还什么都没有</h3><p>先把手头已经有的东西放进来——课程设计、拆机记录、实习日志，都算。三条就够启动。</p>' +
        '<ol><li>去「能力清单」，找到你确实会做的那些</li><li>点「加一个作品」，写清它是什么、放在哪、能证明什么</li><li>再把等级调上去，就不用写理由了</li></ol></div>';
    } else {
      html += '<div style="border-top:1px solid var(--rule)">';
      list.forEach(function (e) {
        html += '<article class="ev"><h3>' + esc(e.title) + '</h3>' +
          '<div class="meta">' + esc(e.date) + ' · ' + esc(e.kind) + '</div>' +
          (e.desc ? '<p class="desc">' + esc(e.desc) + '</p>' : "") +
          '<div class="chips">' + (e.itemIds || []).map(function (id) { return '<span class="chip">' + esc(id) + '</span>'; }).join("") + '</div>' +
          '<div style="margin-top:10px"><button class="btn tiny" data-act="del-evidence" data-id="' + esc(e.id) + '">删掉</button></div>' +
          '</article>';
      });
      html += '</div>';
    }
    html += '</div><aside>';
    html += '<div class="panel"><div class="panel-h"><h3>加一个作品</h3></div><div class="panel-b">' +
      '<div class="field"><label for="ev-title">这是什么</label><input id="ev-title" placeholder="例：减速箱拆机记录"></div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="ev-kind">类型</label><select id="ev-kind">' +
          ["图纸/模型", "计算书", "工艺文件", "拆机报告", "失效分析", "试验记录", "项目成品", "实习记录", "其他"].map(function (k) { return '<option>' + k + '</option>'; }).join("") +
        '</select></div>' +
        '<div class="field"><label for="ev-date">日期</label><input id="ev-date" type="date" value="' + todayISO() + '"></div>' +
      '</div>' +
      '<div class="field"><label for="ev-desc">它能证明你会做什么（选填）</label><textarea id="ev-desc" placeholder="一句话：这份东西能证明我做得了哪件事。"></textarea></div>' +
      '<div class="field"><label for="ev-items">挂到哪几条上（按住 Ctrl 多选）</label><select id="ev-items" multiple size="7" style="font-size:13px">' + opts + '</select>' +
        '<span class="help">选 1–5 条最贴切的就行，别全选。</span></div>' +
      '<button class="btn primary" data-act="add-ev">保存</button>' +
      '</div></div></aside></div>';
    $("#view-evidence").innerHTML = html;
  }

  /* ---------- 视图：数据 ---------- */
  function renderData() {
    var bytes = 0;
    try { bytes = (localStorage.getItem(STORE_KEY) || "").length; } catch (e) { bytes = -1; }
    var html = '<div class="view-head"><h2>数据与备份</h2><p class="note">' +
      '你的进度存在这个浏览器里。换电脑、清缓存、重装浏览器都会丢，所以存一份不是可选项。</p></div>';

    html += '<div class="cols" style="padding-top:22px"><div>';
    html += '<div class="panel"><div class="panel-h"><h3>存一份 / 搬走</h3><span class="code">JSON</span></div><div class="panel-b">' +
      '<p style="font-size:14px;color:var(--ink-2);max-width:66ch">存下来的文件里是全部等级、复习安排、作品和练习记录，拿到任何一台电脑都能装回去。</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">' +
        '<button class="btn primary" data-act="export">存一份到电脑</button>' +
        '<button class="btn" data-act="import">从存档装回来</button>' +
        '<button class="btn" data-act="export-md">导出一份文字报告</button>' +
      '</div>' +
      '<input type="file" id="fileInput" accept="application/json,.json" hidden>' +
        '<div class="field" style="margin-top:18px"><label>装回来的时候</label>' +
          '<select id="importMode"><option value="merge">两份合起来：留着现在的，按时间取新的</option><option value="replace">用文件里的全部替换掉现在这份</option></select></div>' +
      '</div></div>';

    html += '<div class="panel"><div class="panel-h"><h3>每天练多久</h3></div><div class="panel-b">' +
      '<div class="field-row">' +
        '<div class="field"><label for="set-min">每天打算练多久（分钟）</label><input id="set-min" type="number" min="20" max="240" step="5" value="' + state.settings.dailyMinutes + '"><span class="help">决定「今日」里排几条。</span></div>' +
        '<div class="field"><label for="set-start">从哪天开始算</label><input id="set-start" type="date" value="' + esc(state.settings.startDate) + '"><span class="help">路线按这个日期算你现在第几个月。</span></div>' +
      '</div>' +
      '<button class="btn" data-act="save-settings">保存</button>' +
      '</div></div>';

    html += '<div class="panel"><div class="panel-h"><h3>小心操作</h3></div><div class="panel-b">' +
      '<p style="font-size:14px;color:var(--ink-2);max-width:66ch">清空会删掉全部等级、作品和练习记录，删了就找不回来。清空之前先存一份。</p>' +
      '<button class="btn seal" style="margin-top:12px" data-act="reset">清空所有进度</button>' +
      '</div></div>';
    html += '</div><aside>';
    html += panel("存档信息", [
      stat("已经开始练的", ALL.filter(function (i) { return lvOf(i.id) > 0; }).length, "共 " + ALL.length + " 条"),
      stat("练习记录", state.gates.length),
      stat("作品", state.evidence.length),
      stat("占用大小", bytes < 0 ? "读不到" : (Math.max(1, Math.round(bytes / 1024)) + " KB")),
      stat("上次存档", state.exportedAt ? state.exportedAt.slice(0, 10) : "从来没存过")
    ]);
    html += '<div class="panel"><div class="panel-h"><h3>关于这两种文件</h3></div><div class="panel-b">' +
      '<p style="font-size:13px;color:var(--ink-2)">JSON 是给机器读的存档，带版本号（schema ' + SCHEMA + '），能装回来。文字报告是给人看的，能贴进简历，但装不回来。</p>' +
      '</div></div></aside></div>';
    $("#view-data").innerHTML = html;
  }

  /* ---------- 数据操作 ---------- */
  function doExport() {
    state.exportedAt = nowISO();
    save();
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "机械工程师工作台-进度-" + todayISO() + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    flash("存好了。把文件放到网盘或 U 盘，别只留在这台电脑上。");
    refresh();
  }

  function mergeState(incoming) {
    var mode = ($("#importMode") && $("#importMode").value) || "merge";
    if (mode === "replace") { state = incoming; state.schema = SCHEMA; return; }
    Object.keys(incoming.items || {}).forEach(function (id) {
      var a = state.items[id], b = incoming.items[id];
      if (!a || !a.updatedAt || (b.updatedAt && b.updatedAt > a.updatedAt)) state.items[id] = b;
    });
    var have = {};
    state.gates.forEach(function (g) { have[g.id] = 1; });
    (incoming.gates || []).forEach(function (g) { if (!have[g.id]) state.gates.push(g); });
    have = {};
    state.evidence.forEach(function (e) { have[e.id] = 1; });
    (incoming.evidence || []).forEach(function (e) { if (!have[e.id]) state.evidence.push(e); });
    Object.assign(state.done, incoming.done || {});
    if (incoming.settings && incoming.settings.startDate) state.settings.startDate = incoming.settings.startDate;
  }

  function doImport(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var p = JSON.parse(fr.result);
        if (!p || !p.items) throw new Error("文件里没有进度数据");
        mergeState(p);
        save();
    flash("装回来了。现在有 " + state.gates.length + " 次练习记录、" + state.evidence.length + " 个作品。");
        refresh();
    } catch (e) { flash("装不回来：" + e.message); }
    };
    fr.readAsText(file);
  }

  function buildMdReport() {
    var lines = [];
    lines.push("# 机械工程师工作台 · 我的学习记录");
    lines.push("");
    lines.push("- 生成日期：" + todayISO());
    lines.push("- 起始日期：" + state.settings.startDate);
    lines.push("- 练习次数：" + state.gates.length + "（其中和 AI 对不上 " + state.gates.filter(function (g) { return g.verdict === "diff"; }).length + " 次）");
    lines.push("- 作品数：" + state.evidence.length);
    lines.push("");
    lines.push("## 我的等级");
    lines.push("");
    lines.push("| 模块 | 编号与内容 | 等级 | 说明 | 下次复习 | 作品 | 对不上 |");
    lines.push("|---|---|---|---|---|---|---|");
    ALL.forEach(function (it) {
      var r = state.items[it.id];
      if (!r || r.lv === 0) return;
      lines.push("| " + it._mod.name + " | " + it.id + " " + it.name + " | " + r.lv + " | " + lvName(r.lv) + " | " + (r.due || "—") + " | " + evidenceFor(it.id).length + " | " + diffCount(it.id) + " |");
    });
    lines.push("");
    lines.push("## 作品清单");
    lines.push("");
    state.evidence.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (e) {
      lines.push("### " + e.title + "（" + e.date + " · " + e.kind + "）");
      if (e.desc) lines.push("", e.desc);
    if ((e.itemIds || []).length) lines.push("", "对应：" + e.itemIds.join("、"));
      lines.push("");
    });
    lines.push("## 和 AI 对不上的地方");
    lines.push("");
    var diffs = state.gates.filter(function (g) { return g.verdict !== "same"; });
    if (!diffs.length) lines.push("（暂时没有）");
    diffs.forEach(function (g) {
      var it = BY_ID[g.itemId] || { name: g.itemId, id: g.itemId };
      lines.push("- " + g.at.slice(0, 10) + " · " + it.id + " " + it.name + " · " + (g.verdict === "diff" ? "差得比较远" : "对了一半"));
      if (g.note) lines.push("  - 哪里对不上：" + g.note);
      if (g.answer) lines.push("  - 我当时写的：" + g.answer.replace(/\n/g, " "));
    });
    return lines.join("\n");
  }

  function doExportMd() {
    var blob = new Blob([buildMdReport()], { type: "text/markdown" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "机械工程师工作台-报告-" + todayISO() + ".md";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    flash("报告存好了，可以直接贴进简历。");
  }

  /* ---------- 提示 ---------- */
  var flashTimer = null;
  function flash(msg) {
    var el = $("#flash");
    if (!el) {
      el = document.createElement("div");
      el.id = "flash";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:40;max-width:min(680px,92vw)";
      document.body.appendChild(el);
    }
    el.innerHTML = '<div class="notice"><span>' + esc(msg) + '</span></div>';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.innerHTML = ""; }, 5200);
  }

  /* ---------- 路线导轨 ---------- */
  function renderRail() {
    var track = $("#railTrack");
    var html = "";
    var starts = [1, 5, 11, 19];
    for (var m = 1; m <= 24; m++) {
      var left = ((m - 1) / 24) * 100;
      var major = starts.indexOf(m) >= 0;
      html += '<span class="rail-tick' + (major ? " major" : "") + '" style="left:' + left + '%"></span>';
    }
    var spans = [[1, 4], [5, 10], [11, 18], [19, 24]];
    spans.forEach(function (s) {
      var l = ((s[0] - 1) / 24) * 100, w = ((s[1] - s[0] + 1) / 24) * 100;
      html += '<span class="rail-stage" style="left:' + l + '%;width:' + w + '%"></span>';
    });
    html += '<span class="rail-marker" id="railMarker"></span>';
    track.innerHTML = html;

    $("#railLabels").innerHTML = C.stages.map(function (s) {
      return '<li><b>' + esc(s.name) + '</b>' + esc(s.months) + '</li>';
    }).join("");
  }
  function updateRail() {
    var st = stageNow();
    var mk = $("#railMarker");
    if (!mk) return;
    var frac = Math.max(0, Math.min(1, st.month / 24));
    mk.style.left = "calc(" + (frac * 100) + "% - 5px)";
    mk.title = "第 " + st.month + " 个月 · " + st.stage.name;
    $("#railTrack").setAttribute("aria-label", "24 个月路线：当前第 " + st.month + " 个月，" + st.stage.name + "阶段");
  }

  /* ---------- 视图切换 ---------- */
  var currentView = "today";
  var RENDER = { today: renderToday, matrix: renderMatrix, route: renderRoute, evidence: renderEvidence, data: renderData };

  function show(view) {
    currentView = view;
    $$("#tabs button").forEach(function (b) {
      var on = b.dataset.view === view;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    $$(".view").forEach(function (s) { s.hidden = s.id !== "view-" + view; });
    RENDER[view]();
    var el = $("#view-" + view);
    if (el) el.focus({ preventScroll: true });
  }

  function counts() {
    $("#cntToday").textContent = buildTasks().length || "";
    $("#cntMatrix").textContent = ALL.length;
    $("#cntEvidence").textContent = state.evidence.length || "";
  }

  function refresh() {
    counts();
    updateRail();
    RENDER[currentView]();
    var d = new Date();
    $("#metaDate").textContent = "今天 " + todayISO();
    var activeDays = Object.keys(state.done).length;
    $("#metaDays").textContent = "练过 " + activeDays + " 条";
    $("#metaStore").textContent = "进度只在本机浏览器";
  }

  /* ---------- 事件 ---------- */
  function onClick(e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var act = b.dataset.act;
    var id = b.dataset.id;

    if (act === "open-gate") {
      var slot = $('[data-slot="' + id + '"]');
      if (slot && !slot.innerHTML) openGate(slot, id);
      else if (slot) slot.innerHTML = "";
      return;
    }
    if (act === "gate-here") {
      var host = $('[data-gate-host="' + id + '"]');
      if (host) { openGate(host, id); }
      return;
    }
    if (act === "open-item") {
      if (currentView === "matrix") openItem(id, true);
      else {
        show("matrix");
        setTimeout(function () { openItem(id, true); }, 0);
      }
      return;
    }
    if (act === "unseal") { unseal(id); return; }
    if (act === "verdict") { recordGate(id, b.dataset.v); return; }
    if (act === "close-gate") {
      var s = $('[data-slot="' + id + '"]');
      if (s) s.innerHTML = "";
      var h = $('[data-gate-host="' + id + '"]');
      if (h) h.innerHTML = "";
      return;
    }
    if (act === "copy") {
      var txt = b.dataset.copy;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { flash("复制好了。"); }, function () { flash("没复制成功，手动选中吧。"); });
      else flash("这个浏览器不给自动复制，手动选中吧。");
      return;
    }
    if (act === "set-lv") { setLevel(id); return; }
    if (act === "add-evidence") {
      show("evidence");
      setTimeout(function () {
        var sel = $("#ev-items");
        if (sel) Array.prototype.forEach.call(sel.options, function (o) { if (o.value === id) o.selected = true; });
        var t = $("#ev-title"); if (t) t.focus();
      }, 0);
      return;
    }
    if (act === "add-ev") {
      var title = $("#ev-title").value.trim();
      if (!title) { flash("先写清楚这是什么。"); $("#ev-title").focus(); return; }
      var sel2 = $("#ev-items");
      var ids = Array.prototype.filter.call(sel2.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
      state.evidence.push({
        id: "e" + Date.now(), title: title, kind: $("#ev-kind").value,
        date: $("#ev-date").value || todayISO(), desc: $("#ev-desc").value.trim(), itemIds: ids
      });
      save(); flash("存好了，现在有 " + state.evidence.length + " 个作品。"); refresh();
      return;
    }
    if (act === "del-evidence") {
      state.evidence = state.evidence.filter(function (x) { return x.id !== id; });
      save(); refresh(); return;
    }
    if (act === "export") { doExport(); return; }
    if (act === "export-md") { doExportMd(); return; }
    if (act === "import") { $("#fileInput").click(); return; }
    if (act === "save-settings") {
      state.settings.dailyMinutes = Math.max(20, Math.min(240, parseInt($("#set-min").value, 10) || 60));
      state.settings.startDate = $("#set-start").value || state.settings.startDate;
      save(); flash("已保存。"); refresh(); return;
    }
    if (act === "reset") {
      if (confirm("清空所有进度、作品和练习记录？删了就找不回来。建议先存一份。")) {
        state = blankState(); save(); flash("清空了。"); refresh();
      }
      return;
    }
  }

  function onChange(e) {
    var f = e.target.dataset.f;
    if (f) {
      if (f === "q") { clearTimeout(onChange._t); onChange._t = setTimeout(function () { mFilter.q = e.target.value; renderMatrix(); }, 180); return; }
      mFilter[f] = e.target.value; renderMatrix(); return;
    }
    if (e.target.id === "fileInput" && e.target.files[0]) {
      doImport(e.target.files[0]);
      e.target.value = "";
    }
  }

  function onKeydown(e) {
    if (e.target.id === "tabs" || e.target.closest("#tabs")) {
      var keys = { ArrowRight: 1, ArrowLeft: -1 };
      if (!keys[e.key]) return;
      var btns = $$("#tabs button");
      var i = btns.indexOf(document.activeElement);
      var n = (i + keys[e.key] + btns.length) % btns.length;
      btns[n].focus(); show(btns[n].dataset.view);
      e.preventDefault();
    }
  }

  /* ---------- 启动 ---------- */
  function init() {
    var had = load();
    renderRail();
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("keydown", onKeydown);
    $("#tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-view]");
      if (b) show(b.dataset.view);
    });

    if (!had) {
      state.settings.startDate = todayISO();
      save();
      setTimeout(function () {
      flash("第一次打开：先随便看看，然后去「今日」做第一道题。进度只存在这个浏览器里，记得定期存一份。");
      }, 500);
    }
    var want = (location.search.match(/[?&]view=([a-z]+)/) || [])[1];
    show(RENDER[want] ? want : "today");
    refresh();

    if (location.search.indexOf("selftest") >= 0) selfTest();
    if (location.search.indexOf("audit") >= 0) audit();
  }

  /* ---------- 几何与对比度审计（仅在网址带 ?audit=1 时运行） ---------- */
  function audit() {
    function toRGB(c) {
      if (!c) return null;
      c = String(c).trim();
      if (c.charAt(0) === "#") {
        var h = c.slice(1);
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      }
      var m = c.match(/[\d.]+/g);
      return m ? [parseFloat(m[0]), parseFloat(m[1]), parseFloat(m[2])] : null;
    }
    function lum(c) {
      var rgb = toRGB(c);
      if (!rgb) return null;
      var v = rgb.map(function (x) {
        x = x / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    }
    function ratio(a, b) {
      var la = lum(a), lb = lum(b);
      if (la == null || lb == null) return 0;
      return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
    }
    var cs = getComputedStyle(document.documentElement);
    function tok(n) { return cs.getPropertyValue(n).trim(); }
    var R = {};
    R.contrast = [
      ["正文墨 on 纸", ratio(tok("--ink"), tok("--paper"))],
      ["次级墨 on 纸", ratio(tok("--ink-2"), tok("--paper"))],
      ["三级墨 on 纸 (下限 4.5)", ratio(tok("--ink-3"), tok("--paper"))],
      ["朱红 on 纸", ratio(tok("--seal"), tok("--paper"))],
      ["纸字 on 墨底", ratio(tok("--paper"), tok("--ink"))],
      ["纸字 on 朱红", ratio(tok("--paper"), tok("--seal"))],
      ["次级墨 on 纸2", ratio(tok("--ink-2"), tok("--paper-2"))],
      ["三级墨 on 纸2", ratio(tok("--ink-3"), tok("--paper-2"))],
      ["三级墨 on 纸3", ratio(tok("--ink-3"), tok("--paper-3"))],
      ["朱红 on 纸2", ratio(tok("--seal"), tok("--paper-2"))],
      ["朱红 on 朱红淡洗", ratio(tok("--seal"), tok("--seal-2"))],
      ["正文墨 on 朱红淡洗", ratio(tok("--ink"), tok("--seal-2"))]
    ];

    function inScroller(el) {
      var p = el.parentElement;
      while (p && p !== document.body) {
        var o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll") return true;
        p = p.parentElement;
      }
      return false;
    }
    var all = $$("#view-" + currentView + " *").concat($$(".head *"), $$(".rail *"));
    var vw = document.documentElement.clientWidth;
    var pageOverflow = document.documentElement.scrollWidth - vw;
    var clipped = [], offscreen = [], shadows = [], radii = [], small = [], radiiOK = { "0px": 1, "2px": 1, "50%": 1, "1px": 1 };
    all.forEach(function (el) {
      var s = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (el.scrollWidth > el.clientWidth + 1 && s.overflowX === "visible" && el.clientWidth > 0) {
        clipped.push(el.tagName.toLowerCase() + "." + (el.className || "").toString().split(" ")[0] + " (" + el.clientWidth + "→" + el.scrollWidth + ")");
      }
      if (r.right > vw + 1 && s.position !== "fixed" && !inScroller(el)) {
        offscreen.push(el.tagName.toLowerCase() + "." + (el.className || "").toString().split(" ")[0] + " right=" + Math.round(r.right));
      }
      if (s.boxShadow && s.boxShadow !== "none") shadows.push(el.tagName.toLowerCase() + "." + (el.className || "").toString().split(" ")[0] + " → " + s.boxShadow);
      if (!radiiOK[s.borderTopLeftRadius] && el.tagName !== "BODY") radii.push(el.tagName.toLowerCase() + "." + (el.className || "").toString().split(" ")[0] + " → " + s.borderTopLeftRadius);
      if ((el.tagName === "BUTTON" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") && (r.height < 28 || r.width < 28)) {
        small.push(el.tagName.toLowerCase() + " \"" + (el.textContent || "").trim().slice(0, 12) + "\" " + Math.round(r.width) + "×" + Math.round(r.height));
      }
    });
    var fs = {}, colors = {};
    all.forEach(function (el) {
      var s = getComputedStyle(el);
      if (el.children.length === 0 && (el.textContent || "").trim()) {
        fs[s.fontSize + " / " + s.lineHeight + " @ " + s.fontWeight] = (fs[s.fontSize + " / " + s.lineHeight + " @ " + s.fontWeight] || 0) + 1;
        colors[s.color] = (colors[s.color] || 0) + 1;
      }
    });
    R.geometry = { viewport: vw, pageHorizontalOverflow: pageOverflow, clippedCount: clipped.length, offscreenCount: offscreen.length };
    R.clipped = clipped.slice(0, 12);
    R.offscreen = offscreen.slice(0, 12);
    R.shadows = shadows.slice(0, 6);
    R.nonStandardRadii = radii.slice(0, 8);
    R.smallTargets = small.slice(0, 10);
    R.typeScale = fs;
    R.textColors = colors;
    var pre = document.createElement("pre");
    pre.id = "audit";
    pre.style.cssText = "position:fixed;inset:0;z-index:99;background:#15181B;color:#F3F2EE;font:11px/1.5 monospace;padding:14px;margin:0;overflow:auto;white-space:pre-wrap";
    pre.textContent = JSON.stringify(R, null, 1);
    document.body.appendChild(pre);
  }

  /* ---------- 自检（仅在网址带 ?selftest=1 时运行） ---------- */
  function selfTest() {
    var out = [];
    function ok(name, cond, extra) { out.push((cond ? "PASS  " : "FAIL  ") + name + (extra ? "  → " + extra : "")); }
    try {
      ok("课程数据载入", ALL.length > 100 && C.modules.length >= 10, ALL.length + " 个知识点 / " + C.modules.length + " 个模块");
      ok("今日任务生成", buildTasks().length > 0, buildTasks().length + " 项");

      var id = coreItems()[0].id;
      show("today");
      var slot = $('[data-slot="' + id + '"]');
      if (!slot) { slot = document.createElement("div"); slot.setAttribute("data-slot", id); $("#view-today").appendChild(slot); }
      openGate(slot, id);
      var ta = $('[data-ans="' + id + '"]', slot);
      var btn = $('[data-act="unseal"]', slot);
      ok("闸门先锁后开", ta && btn && btn.disabled, ta ? "初始禁用 = " + btn.disabled : "找不到输入框");

      ta.value = "我的判断是这里应该用过渡配合，因为需要定期拆装，同时要考虑温升带来的变化。";
      ta.dispatchEvent(new Event("input"));
      ok("写满后才能拆封", !btn.disabled);
      btn.click();
      ok("拆封后显示对照", $('[data-seal="' + id + '"]', slot).classList.contains("open"));

      var before = state.gates.length;
      $('[data-act="verdict"][data-id="' + id + '"][data-v="same"]', slot).click();
      ok("记录一次闸门", state.gates.length === before + 1, "共 " + state.gates.length + " 次");
      ok("排期已生成", !!state.items[id].due, "下次复习 " + state.items[id].due);

      show("matrix");
      openItem(id, true);
      var sel = $('[data-lvsel="' + id + '"]');
      var basis = $('[data-lvbasis="' + id + '"]');
      sel.value = "3";
      basis.value = "";
      $('[data-act="set-lv"][data-id="' + id + '"]').click();
      ok("无证据不给升级", lvOf(id) === 0, "当前 " + lvOf(id) + " 级");
      basis.value = "依据：拆机报告里的实测尺寸与配合判断";
      $('[data-act="set-lv"][data-id="' + id + '"]').click();
      ok("填了依据才升级", lvOf(id) === 3, "当前 " + lvOf(id) + " 级");

      show("evidence");
      $("#ev-title").value = "自检证据";
      $("#ev-desc").value = "由自检流程写入";
      var opt = Array.prototype.filter.call($("#ev-items").options, function (o) { return o.value === id; })[0];
      if (opt) opt.selected = true;
      $('[data-act="add-ev"]').click();
      ok("证据已保存", state.evidence.length === 1 && evidenceFor(id).length === 1);

      var md = buildMdReport();
      ok("报告可导出", md.indexOf("# 机械工程师工作台") === 0 && md.indexOf(id) > 0, md.length + " 字符");

      var snap = JSON.parse(JSON.stringify(state));
      var incoming = { items: {}, gates: [{ id: "gX", itemId: id, at: nowISO(), verdict: "diff" }], evidence: [], done: {} };
      mergeState(incoming);
      ok("导入合并生效", state.gates.length === snap.gates.length + 1, "合并后 " + state.gates.length + " 次闸门");

      show("route");
      ok("路线视图渲染", $("#view-route").innerHTML.indexOf("24 个月") > 0);
      show("data");
      // 断言不要绑死具体文案：查控件是否存在，文案怎么改都不会误报。
      ok("数据视图渲染",
        Boolean($('#view-data [data-act="export"]')) &&
        Boolean($('#view-data [data-act="import"]')) &&
        Boolean($('#view-data #importMode')));
      show("today");

      state = blankState(); save();
      ok("清空可用", Object.keys(state.items).length === 0);
    } catch (e) {
      out.push("FAIL  运行时异常 → " + (e && e.message));
    }
    var fails = out.filter(function (l) { return l.indexOf("FAIL") === 0; }).length;
    document.title = (fails ? "SELFTEST FAIL " + fails : "SELFTEST PASS") + " · 机械工程师工作台";
    var pre = document.createElement("pre");
    pre.id = "selftest";
    pre.style.cssText = "position:fixed;inset:0;z-index:99;background:#15181B;color:#F3F2EE;font:12px/1.6 monospace;padding:16px;margin:0;overflow:auto;white-space:pre-wrap";
    pre.textContent = out.join("\n");
    document.body.appendChild(pre);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
