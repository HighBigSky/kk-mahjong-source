// @ts-check
// 本次确认的结算口径；其余番型分值仍沿用现有引擎。
export const SCORE_RULES = Object.freeze({base:10, redGang:1, piziGang:1, wildGang:2, replacementWin:1});
export const SCORING_TEXT = Object.freeze({
  redGang:'红中杠', piziGang:'痞子杠', wildGang:'赖子杠', replacementWin:'杠上开花',
  note:'底分10；红中杠、痞子杠其余三家各付10，赖子杠各付20；开杠立即结算，荒庄保留杠分。原番型分值不变，杠上开花额外加10。屁胡自摸三家各付一份，屁胡接胡放铳一家付一份；大胡三家各付一份。',
});
