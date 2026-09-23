export interface Season {
  id: string;
  themeId: string;
  /** 화면 부제: "들렀다감 · {subtitle}" */
  subtitle: string;
  /** 문구용 이름: "지난 시즌에 완성된 {roomNoun} 방이 없어요" */
  roomNoun: string;
  defaultTitle: string;
  startsAt: number;
  /** 이 시각부터 방은 읽기 전용(archived)이 되고 지난 시즌 둘러보기에 편입된다 */
  endsAt: number;
}

const kst = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) - 9 * 3600_000;

// TODO(open-question #10): 시즌 기간 미정. 12월 1일 ~ 12월 31일(KST) 임시안.
// 시작 전에도 방을 만들 수 있게 두었다(시즌 전 미리 꾸미기). 막아야 하면 currentSeason에서 startsAt을 확인할 것.
export const SEASONS: Season[] = [
  {
    id: 'xmas-2026',
    themeId: 'pixel',
    subtitle: '겨울 트리 꾸미기',
    roomNoun: '겨울 트리',
    defaultTitle: '우리 거실 트리',
    startsAt: kst(2026, 12, 1),
    endsAt: kst(2027, 1, 1),
  },
];

export function seasonById(id: string): Season | undefined {
  return SEASONS.find(s => s.id === id);
}

/** 지금 방을 만들 수 있는 시즌 (끝나지 않은 시즌 중 가장 먼저 끝나는 것) */
export function currentSeason(now: number): Season | undefined {
  return SEASONS.filter(s => s.endsAt > now).sort((a, b) => a.endsAt - b.endsAt)[0];
}

/** 가장 최근에 끝난 시즌 */
export function lastEndedSeason(now: number): Season | undefined {
  return SEASONS.filter(s => s.endsAt <= now).sort((a, b) => b.endsAt - a.endsAt)[0];
}

export function isSeasonOver(seasonId: string, now: number): boolean {
  const s = seasonById(seasonId);
  return !!s && s.endsAt <= now;
}
