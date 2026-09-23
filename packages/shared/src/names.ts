// TODO(open-question #6): 참여자 표시 이름 방식 미정. 입장 시 자동 이름 부여 + 변경 가능 (임시안)
const NOUNS = ['눈사람', '루돌프', '펭귄', '북극곰', '눈토끼', '진저쿠키', '꼬마요정', '썰매', '호두까기', '벙어리장갑', '눈송이', '솔방울'];

export function autoName(random: () => number = Math.random): string {
  const noun = NOUNS[Math.floor(random() * NOUNS.length)];
  return `${noun} ${1 + Math.floor(random() * 99)}`;
}

export const OWNER_DEFAULT_NAME = '방장';
