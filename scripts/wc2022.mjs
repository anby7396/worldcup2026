// ===== 2022 卡塔尔世界杯历史数据 =====
// 用于模型回测。包含小组赛 + 淘汰赛全部 64 场比赛。
// elo 字段：赛前（2022-11-20）World Football Elo Ratings 快照。
// 注意：淘汰赛若进入加时/点球，hs/as 记录的是 90 分钟比分；ko 字段标注晋级方。

export const wc2022 = {
  teamsElo: {
    QAT: 1680, ECU: 1846, SEN: 1687, NED: 2040,
    ENG: 1920, IRN: 1817, USA: 1798, WAL: 1790,
    ARG: 2141, KSA: 1640, MEX: 1821, POL: 1814,
    FRA: 2005, AUS: 1719, DEN: 1869, TUN: 1687,
    ESP: 2048, CRC: 1743, GER: 1963, JPN: 1798,
    BEL: 1979, CAN: 1765, MAR: 1779, CRO: 1923,
    BRA: 2169, SRB: 1892, SUI: 1902, CMR: 1610,
    POR: 2004, GHA: 1567, URU: 1936, KOR: 1786,
  },
  // 小组赛 + 淘汰赛，h/a 为主队/客队的 ID，hs/as 为 90 分钟比分
  matches: [
    // 小组赛
    { h: 'QAT', a: 'ECU', hs: 0, as: 2, stage: 'group' },
    { h: 'ENG', a: 'IRN', hs: 6, as: 2, stage: 'group' },
    { h: 'SEN', a: 'NED', hs: 0, as: 2, stage: 'group' },
    { h: 'USA', a: 'WAL', hs: 1, as: 1, stage: 'group' },
    { h: 'ARG', a: 'KSA', hs: 1, as: 2, stage: 'group' },
    { h: 'DEN', a: 'TUN', hs: 0, as: 0, stage: 'group' },
    { h: 'MEX', a: 'POL', hs: 0, as: 0, stage: 'group' },
    { h: 'FRA', a: 'AUS', hs: 4, as: 1, stage: 'group' },
    { h: 'MAR', a: 'CRO', hs: 0, as: 0, stage: 'group' },
    { h: 'GER', a: 'JPN', hs: 1, as: 2, stage: 'group' },
    { h: 'ESP', a: 'CRC', hs: 7, as: 0, stage: 'group' },
    { h: 'BEL', a: 'CAN', hs: 1, as: 0, stage: 'group' },
    { h: 'SUI', a: 'CMR', hs: 1, as: 0, stage: 'group' },
    { h: 'URU', a: 'KOR', hs: 0, as: 0, stage: 'group' },
    { h: 'POR', a: 'GHA', hs: 3, as: 2, stage: 'group' },
    { h: 'BRA', a: 'SRB', hs: 2, as: 0, stage: 'group' },
    { h: 'WAL', a: 'IRN', hs: 0, as: 2, stage: 'group' },
    { h: 'QAT', a: 'SEN', hs: 1, as: 3, stage: 'group' },
    { h: 'NED', a: 'ECU', hs: 1, as: 1, stage: 'group' },
    { h: 'ENG', a: 'USA', hs: 0, as: 0, stage: 'group' },
    { h: 'TUN', a: 'AUS', hs: 0, as: 1, stage: 'group' },
    { h: 'POL', a: 'KSA', hs: 2, as: 0, stage: 'group' },
    { h: 'FRA', a: 'DEN', hs: 2, as: 1, stage: 'group' },
    { h: 'ARG', a: 'MEX', hs: 2, as: 0, stage: 'group' },
    { h: 'JPN', a: 'CRC', hs: 0, as: 1, stage: 'group' },
    { h: 'BEL', a: 'MAR', hs: 0, as: 2, stage: 'group' },
    { h: 'CRO', a: 'CAN', hs: 4, as: 1, stage: 'group' },
    { h: 'ESP', a: 'GER', hs: 1, as: 1, stage: 'group' },
    { h: 'CMR', a: 'SRB', hs: 3, as: 3, stage: 'group' },
    { h: 'KOR', a: 'GHA', hs: 2, as: 3, stage: 'group' },
    { h: 'BRA', a: 'SUI', hs: 1, as: 0, stage: 'group' },
    { h: 'POR', a: 'URU', hs: 2, as: 0, stage: 'group' },
    { h: 'ECU', a: 'SEN', hs: 1, as: 2, stage: 'group' },
    { h: 'NED', a: 'QAT', hs: 2, as: 0, stage: 'group' },
    { h: 'IRN', a: 'USA', hs: 0, as: 1, stage: 'group' },
    { h: 'WAL', a: 'ENG', hs: 0, as: 3, stage: 'group' },
    { h: 'TUN', a: 'FRA', hs: 1, as: 0, stage: 'group' },
    { h: 'AUS', a: 'DEN', hs: 1, as: 0, stage: 'group' },
    { h: 'POL', a: 'ARG', hs: 0, as: 2, stage: 'group' },
    { h: 'KSA', a: 'MEX', hs: 1, as: 2, stage: 'group' },
    { h: 'CRO', a: 'BEL', hs: 0, as: 0, stage: 'group' },
    { h: 'CAN', a: 'MAR', hs: 1, as: 2, stage: 'group' },
    { h: 'JPN', a: 'ESP', hs: 2, as: 1, stage: 'group' },
    { h: 'CRC', a: 'GER', hs: 2, as: 4, stage: 'group' },
    { h: 'KOR', a: 'POR', hs: 2, as: 1, stage: 'group' },
    { h: 'GHA', a: 'URU', hs: 0, as: 2, stage: 'group' },
    { h: 'CMR', a: 'BRA', hs: 1, as: 0, stage: 'group' },
    { h: 'SRB', a: 'SUI', hs: 2, as: 3, stage: 'group' },
    // 1/8 决赛（90 分钟比分；点球大战由 ko 标注）
    { h: 'NED', a: 'USA', hs: 3, as: 1, stage: 'ko' },
    { h: 'ARG', a: 'AUS', hs: 2, as: 1, stage: 'ko' },
    { h: 'FRA', a: 'POL', hs: 3, as: 1, stage: 'ko' },
    { h: 'ENG', a: 'SEN', hs: 3, as: 0, stage: 'ko' },
    { h: 'JPN', a: 'CRO', hs: 1, as: 1, stage: 'ko', winner: 'a' }, // CRO 点球胜
    { h: 'BRA', a: 'KOR', hs: 4, as: 1, stage: 'ko' },
    { h: 'MAR', a: 'ESP', hs: 0, as: 0, stage: 'ko', winner: 'h' }, // MAR 点球胜
    { h: 'POR', a: 'SUI', hs: 6, as: 1, stage: 'ko' },
    // 1/4 决赛
    { h: 'CRO', a: 'BRA', hs: 1, as: 1, stage: 'ko', winner: 'h' }, // CRO 点球胜
    { h: 'NED', a: 'ARG', hs: 2, as: 2, stage: 'ko', winner: 'a' }, // ARG 点球胜
    { h: 'MAR', a: 'POR', hs: 1, as: 0, stage: 'ko' },
    { h: 'ENG', a: 'FRA', hs: 1, as: 2, stage: 'ko' },
    // 半决赛
    { h: 'ARG', a: 'CRO', hs: 3, as: 0, stage: 'ko' },
    { h: 'FRA', a: 'MAR', hs: 2, as: 0, stage: 'ko' },
    // 三四名
    { h: 'CRO', a: 'MAR', hs: 2, as: 1, stage: 'ko' },
    // 决赛（3-3 后阿根廷点球胜）
    { h: 'ARG', a: 'FRA', hs: 3, as: 3, stage: 'ko', winner: 'h' },
  ],
};
