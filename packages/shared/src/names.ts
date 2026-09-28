// 참여자 이름 (확정): 처음 들어올 때 닉네임을 정하고, 비워 두면 자동 이름. 들어온 뒤에도 바꿀 수 있다
const NOUNS = ['눈사람', '루돌프', '펭귄', '북극곰', '눈토끼', '진저쿠키', '꼬마요정', '썰매', '호두까기', '벙어리장갑', '눈송이', '솔방울'];

export function autoName(random: () => number = Math.random): string {
  const noun = NOUNS[Math.floor(random() * NOUNS.length)];
  return `${noun} ${1 + Math.floor(random() * 99)}`;
}

export const OWNER_DEFAULT_NAME = '방장';
