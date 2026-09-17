/**
 * 공구의 때 해석 — 여는 때(start_at)와 닫는 때(deadline).
 *
 * 공구는 '오늘 밤 11시 마감'이 흔합니다. 날짜까지만 다루면 그런 공구를 '오늘 마감'
 * 으로밖에 못 적고, 아침에 본 사람과 밤 11시 반에 본 사람이 같은 안내를 받습니다.
 *
 * 그렇다고 시각을 필수로 만들 수는 없습니다. '10월 3일까지'처럼 날짜만 적힌 공구가
 * 훨씬 많고, 없는 시각을 자정으로 지어내면 그날 낮에 이미 지난 것으로 보입니다.
 * 그래서 **시각은 선택**입니다.
 */

/** 날짜만. 예) 2026-10-03 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** 날짜와 시각. 예) 2026-10-03T23:00 */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export type ParsedDeadline = {
  at: Date;
  /** 시각이 적혀 있었는지. 없으면 그날이 끝날 때까지로 봅니다. */
  hasTime: boolean;
};

export function parseScheduleAt(raw: string | null | undefined): ParsedDeadline | null {
  const value = raw?.trim();
  if (!value) return null;

  const hasTime = DATE_TIME.test(value);
  if (!hasTime && !DATE_ONLY.test(value)) return null;

  // 기기의 시간대로 읽습니다. '밤 11시 마감'은 그 글을 올린 사람과 보는 사람이
  // 같은 나라에 있다는 전제 아래 쓰인 말이라, UTC로 해석하면 아홉 시간이 어긋납니다.
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = hasTime ? timePart.split(':').map(Number) : [23, 59];

  const at = new Date(year, month - 1, day, hour, minute, hasTime ? 0 : 59, 999);
  if (Number.isNaN(at.getTime())) return null;

  return { at, hasTime };
}

/** 화면에 적을 말. 시각이 있으면 함께 보입니다. */
export function formatScheduleAt(raw: string): string {
  const parsed = parseScheduleAt(raw);
  if (!parsed) return raw;

  const [datePart, timePart] = raw.trim().split('T');
  return parsed.hasTime ? `${datePart} ${timePart}` : datePart;
}

export type DeadlineNote = { text: string; expired: boolean };

/**
 * 얼마나 남았는지.
 *
 * 시각이 없으면 그날이 끝날 때까지로 봅니다. 마감 당일 낮에 '지났다'고 하면
 * 아직 신청할 수 있는 공구를 놓칩니다.
 *
 * 시각이 있으면 그 순간으로 봅니다. 이때는 '오늘 마감'으로는 부족합니다.
 * 밤 11시 마감을 밤 10시에 본 사람에게 필요한 말은 '1시간 남음'입니다.
 */
export function describeDeadline(raw: string, now = new Date()): DeadlineNote | null {
  const value = raw.trim();
  if (!value) return null;

  const parsed = parseScheduleAt(value);
  // 형식이 다르면 AI가 적어준 말을 그대로 보여줍니다. 읽을 수 없다고 지워버리면
  // 원문에 있던 정보가 사라집니다.
  if (!parsed) return { text: value, expired: false };

  const label = formatScheduleAt(value);
  const remainMs = parsed.at.getTime() - now.getTime();

  if (remainMs < 0) {
    const days = Math.floor(-remainMs / 86400000);
    return {
      text: days > 0 ? `${label} · ${days}일 지남` : `${label} · 마감 지남`,
      expired: true,
    };
  }

  // 하루가 안 남았고 시각까지 아는 경우에만 시간으로 셉니다. 날짜만 아는 건을
  // 시간으로 세면 '23시간 남음'처럼 있지도 않은 정밀도를 말하게 됩니다.
  if (parsed.hasTime && remainMs < 86400000) {
    const hours = Math.floor(remainMs / 3600000);
    if (hours >= 1) return { text: `${label} · ${hours}시간 남음`, expired: false };

    const minutes = Math.max(1, Math.floor(remainMs / 60000));
    return { text: `${label} · ${minutes}분 남음`, expired: false };
  }

  const days = Math.floor(remainMs / 86400000);
  return {
    text: days === 0 ? `${label} · 오늘 마감` : `${label} · ${days}일 남음`,
    expired: false,
  };
}

/**
 * 언제 여는지.
 *
 * 마감과 말이 반대입니다. 마감은 '지났다'가 나쁜 소식이지만 시작은 '열렸다'가
 * 좋은 소식입니다. 같은 함수로 적으면 열린 공구에 '지남'이라고 적히게 됩니다.
 */
export function describeStart(raw: string, now = new Date()): DeadlineNote | null {
  const value = raw.trim();
  if (!value) return null;

  const parsed = parseScheduleAt(value);
  if (!parsed) return { text: value, expired: false };

  const label = formatScheduleAt(value);

  // 여는 때는 '그 순간'입니다. 시각을 모르면 그날 아침으로 봅니다. 마감처럼 하루의
  // 끝으로 보면, 10월 3일 오픈인 공구가 그날 밤까지 '아직 안 열림'이 됩니다.
  const at = parsed.hasTime
    ? parsed.at
    : new Date(parsed.at.getFullYear(), parsed.at.getMonth(), parsed.at.getDate(), 0, 0, 0, 0);

  const remainMs = at.getTime() - now.getTime();

  // expired는 여기서 '이미 열렸다'는 뜻입니다. 부르는 쪽이 색을 다르게 씁니다.
  if (remainMs <= 0) {
    return { text: `${label} · 열림`, expired: true };
  }

  if (parsed.hasTime && remainMs < 86400000) {
    const hours = Math.floor(remainMs / 3600000);
    if (hours >= 1) return { text: `${label} · ${hours}시간 뒤 시작`, expired: false };

    const minutes = Math.max(1, Math.floor(remainMs / 60000));
    return { text: `${label} · ${minutes}분 뒤 시작`, expired: false };
  }

  const days = Math.floor(remainMs / 86400000);
  return {
    text: days === 0 ? `${label} · 오늘 시작` : `${label} · ${days}일 뒤 시작`,
    expired: false,
  };
}
