// ===== 赛制说明视图：用最直观的方式讲清 2026 的新赛制 =====
export function renderFormat(root, data) {
  const m = data.meta;
  root.innerHTML = `
    <div class="view-head">
      <h2>2026 世界杯赛制一览</h2>
      <p>这是世界杯历史上规模最大的一届，下面用数字和对比帮你 30 秒看懂改动。</p>
    </div>

    <div class="format-hero">
      <div class="stat"><div class="num">${m.teamCount}</div><div class="lbl">参赛球队（上届 32）</div></div>
      <div class="stat"><div class="num">${m.groupCount}</div><div class="lbl">小组数（上届 8）</div></div>
      <div class="stat"><div class="num">${m.totalMatches}</div><div class="lbl">总比赛场次（上届 64）</div></div>
      <div class="stat"><div class="num gold">8</div><div class="lbl">夺冠需踢场次（上届 7）</div></div>
      <div class="stat"><div class="num">3</div><div class="lbl">联合东道主国家</div></div>
      <div class="stat"><div class="num">16</div><div class="lbl">承办城市</div></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h3>📊 新旧赛制对比</h3>
        <table class="compare-table">
          <tr><th>项目</th><th>2022 卡塔尔</th><th>2026 美加墨</th></tr>
          <tr><td>参赛队</td><td>32</td><td class="new">48</td></tr>
          <tr><td>分组</td><td>8 组 × 4 队</td><td class="new">12 组 × 4 队</td></tr>
          <tr><td>小组赛场次</td><td>48</td><td class="new">72</td></tr>
          <tr><td>出线名额</td><td>16</td><td class="new">32</td></tr>
          <tr><td>淘汰赛轮次</td><td>16强起</td><td class="new">32强起（新增1/16决赛）</td></tr>
          <tr><td>总场次</td><td>64</td><td class="new">104</td></tr>
          <tr><td>夺冠场次</td><td>7 场</td><td class="new">8 场</td></tr>
        </table>
      </div>

      <div class="card">
        <h3>🏆 出线规则</h3>
        <ol class="steps">
          <li><b>小组前两名直接晋级</b>：12 组 × 2 = 24 队</li>
          <li><b>成绩最好的 8 个小组第三名</b>也晋级 → 这是新赛制最特别的一点</li>
          <li>合计 <b>32 队</b>进入 1/16 决赛（淘汰赛第一轮）</li>
        </ol>
        <p class="muted" style="margin-top:10px;font-size:13px;">
          💡 也就是说，小组第三也有超过一半的概率出线（8/12）——这意味着小组赛容错率变高了。
        </p>
        <h3 style="margin-top:16px;">⚖️ 平分判定顺序</h3>
        <ol class="steps">
          ${m.format.tiebreakers.map((t, i) => `<li>${i === 0 ? '<b>' + t + '</b>' : t}</li>`).join('')}
        </ol>
      </div>

      <div class="card">
        <h3>🥊 淘汰赛怎么踢</h3>
        <ol class="steps">
          <li><b>1/16 决赛</b>（32→16）—— 新增轮次</li>
          <li><b>1/8 决赛</b>（16→8）</li>
          <li><b>1/4 决赛</b>（8→4）</li>
          <li><b>半决赛</b>（4→2）</li>
          <li><b>决赛</b> —— 7月19日 纽约</li>
        </ol>
        <p class="muted" style="margin-top:10px;font-size:13px;">
          规则时间打平 → 加时 30 分钟 → 仍平则点球决胜。
        </p>
      </div>

      <div class="card">
        <h3>🛤️ 两条半区通道（新规）</h3>
        <p style="font-size:13.5px;line-height:1.7;color:var(--text-dim);">
          ${m.format.note}<br><br>
          排名最高的 <b style="color:var(--accent)">西班牙</b>（第1）和卫冕冠军
          <b style="color:var(--accent)">阿根廷</b>（第2）被分入不同半区，
          只有各自一路赢到底，才会在决赛相遇。
        </p>
        <h3 style="margin-top:16px;">🏟️ 东道主</h3>
        <p style="font-size:13.5px;line-height:1.7;color:var(--text-dim);">
          美国（承办最多，78场/11球场）、加拿大、墨西哥联合举办。<br>
          揭幕战：<b>墨西哥 vs 南非</b>，6月11日，墨西哥城阿兹特克体育场。<br>
          决赛：7月19日，纽约/新泽西大都会人寿体育场。
        </p>
      </div>
    </div>

    <div class="bracket-note" style="margin-top:18px;">
      <b>📌 关于"8 个最好第三名"的对位</b><br>
      这是 2026 赛制最绕的部分：哪些小组第三对上哪个小组第一，并不固定。
      FIFA 准备了 <b>495 种预案</b>——对应 12 个小组第三中"哪 8 个出线"的所有组合。
      要等 72 场小组赛全部踢完，才能确定最终对阵。本站的「淘汰赛」页会标出每个候选来源组。
    </div>
  `;
}
